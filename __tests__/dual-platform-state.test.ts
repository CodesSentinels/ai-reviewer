/**
 * dual-platform-state.test.ts — 状态层在两个平台上的行为（STATE-001~004 / 007）
 *
 * 状态层是**共享**的：pause/resume 与 reviewed SHA 都由同一份代码写，
 * 平台差异只体现在两处——命名空间前缀，以及底下 IGitPlatform 的两个实现。
 * 所以这里的组织方式是「同一段状态代码，切换命名空间跑两遍」，断言：
 *
 *   1. 两边都能正确写入/读出自己的状态（STATE-002/003/004）；
 *   2. 一边写的 marker 另一边读不到，即便是同一个 commit SHA（STATE-007）。
 *
 * 第 2 条尤其重要：GitHub PR 和 GitLab MR 完全可能指向同一个 commit，
 * 若状态按 SHA 合并，一边审过另一边就会被当成"已审查"而跳过。
 */
import {describe, expect, test, jest, beforeEach} from '@jest/globals'

const platform = {
  getChangeRequest: jest.fn<(...a: any[]) => Promise<any>>(),
  updateChangeRequestBody: jest.fn<(...a: any[]) => Promise<any>>(),
  listComments: jest.fn<(...a: any[]) => Promise<any>>(async () => [])
}
jest.mock('../src/platform/git-platform', () => ({getPlatform: () => platform}))
jest.mock('../src/platform/logger', () => ({
  getLogger: () => ({info: jest.fn(), warning: jest.fn(), error: jest.fn(), debug: jest.fn()})
}))

import {setStateNamespace} from '../src/platform/state-namespace'
import {getReviewState, setReviewState, getReviewStateFromBody} from '../src/review-state'
import {stateMarker} from '../src/state-markers'
import {Commenter} from '../src/commenter'
import {hasBeenProcessed, legacyCmdReplyTag, buildCmdReplyTag} from '../src/commands/reply'
import {setExecCtx} from '../src/platform/run-context'
import type {ExecutionContext} from '../src/platform/execution-context'
import type {Platform} from '../src/platform/execution-context'

/** 有状态的平台替身：写入会真的改变后续读到的内容 */
function statefulStore(initial = ''): {get: () => string} {
  let stored = initial
  platform.getChangeRequest.mockImplementation(async () => ({body: stored}))
  platform.updateChangeRequestBody.mockImplementation(async (_o, _r, _n, body: string) => {
    stored = body as string
  })
  return {get: () => stored}
}

function useNamespace(ns: Platform, projectPath: string): void {
  setStateNamespace(ns)
  setExecCtx({
    platform: ns,
    projectPath,
    projectId: projectPath,
    changeRequestId: 42,
    eventKind: 'pr_opened',
    actor: {login: 'someone', isBot: false},
    baseSha: 'b'.repeat(40),
    headSha: 'a'.repeat(40),
    raw: {}
  } as ExecutionContext)
}

const PLATFORMS: Array<[Platform, string]> = [
  ['github', 'octo/demo'],
  ['gitlab', 'group/demo']
]

beforeEach(() => {
  jest.clearAllMocks()
})

describe.each(PLATFORMS)('%s：共享状态层的读写', (ns, projectPath) => {
  test('STATE-003：pause/resume 写入 description，读回一致', async () => {
    useNamespace(ns, projectPath)
    const store = statefulStore('用户描述')

    await setReviewState('o', 'r', 42, 'paused')
    expect(await getReviewState('o', 'r', 42)).toBe('paused')
    expect(store.get()).toContain('用户描述') // 用户正文不受影响

    await setReviewState('o', 'r', 42, 'active')
    expect(await getReviewState('o', 'r', 42)).toBe('active')
  })

  test('STATE-003：写入的 marker 带本平台命名空间', async () => {
    useNamespace(ns, projectPath)
    const store = statefulStore('')

    await setReviewState('o', 'r', 42, 'paused')
    expect(store.get()).toContain(`ai-reviewer:${ns}:review-state-start`)
  })

  test('STATE-004：reviewed SHA marker 带本平台命名空间', () => {
    useNamespace(ns, projectPath)
    const commenter = new Commenter()

    const body = commenter.addReviewedCommitId('摘要正文', 'a'.repeat(40))
    expect(body).toContain(`ai-reviewer:${ns}:commit-ids-reviewed-start`)
    expect(body).toContain('a'.repeat(40))
  })

  test('STATE-002：本平台写下的状态自己读得回来', () => {
    useNamespace(ns, projectPath)
    const paused = `${stateMarker('reviewStateStart')}\nstate: paused\n${stateMarker(
      'reviewStateEnd'
    )}`
    expect(getReviewStateFromBody(paused)).toBe('paused')
  })
})

describe('STATE-007：同一 commit SHA 也不得合并两平台状态', () => {
  const SAME_SHA = 'c'.repeat(40)

  test('GitHub 写的 pause，切到 GitLab 读不到（反之亦然）', async () => {
    useNamespace('github', 'octo/demo')
    const store = statefulStore('')
    await setReviewState('o', 'r', 42, 'paused')
    const githubBody = store.get()

    // 同一份 description 交给 GitLab 命名空间去读
    useNamespace('gitlab', 'group/demo')
    expect(getReviewStateFromBody(githubBody)).toBe('active')

    // 反向
    statefulStore('')
    await setReviewState('o', 'r', 42, 'paused')
    const gitlabBody = platform.updateChangeRequestBody.mock.calls.at(-1)?.[3] as string
    useNamespace('github', 'octo/demo')
    expect(getReviewStateFromBody(gitlabBody)).toBe('active')
  })

  test('同一 commit SHA 在两平台产生不同的 reviewed marker', () => {
    useNamespace('github', 'octo/demo')
    const githubBody = new Commenter().addReviewedCommitId('摘要', SAME_SHA)

    useNamespace('gitlab', 'group/demo')
    const gitlabBody = new Commenter().addReviewedCommitId('摘要', SAME_SHA)

    // 两边都记了同一个 SHA，但外层 marker 不同——不会互相当成"已审查"
    expect(githubBody).toContain(SAME_SHA)
    expect(gitlabBody).toContain(SAME_SHA)
    expect(githubBody).toContain('ai-reviewer:github:commit-ids-reviewed-start')
    expect(gitlabBody).toContain('ai-reviewer:gitlab:commit-ids-reviewed-start')
    expect(githubBody).not.toContain('ai-reviewer:gitlab:')
    expect(gitlabBody).not.toContain('ai-reviewer:github:')
  })

  test('对照组：同一平台内同一 SHA 确实会被认作已审查（证明上面不是恒不相等）', () => {
    useNamespace('gitlab', 'group/demo')
    const commenter = new Commenter()
    const body = commenter.addReviewedCommitId('摘要', SAME_SHA)
    const reviewed = commenter.getReviewedCommitIds(body)
    expect(reviewed).toContain(SAME_SHA)
  })
})

describe('STATE-001：同一段状态代码在两个平台下走各自的 adapter', () => {
  test('两个平台都经 IGitPlatform 读写，业务层不含平台分支', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('path')
    for (const rel of ['review-state.ts', 'description-state.ts', 'state-markers.ts']) {
      const code: string = fs
        .readFileSync(path.resolve(__dirname, '../src', rel), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '')
      // 状态层不得按平台分支：差异只允许体现在命名空间与 adapter 实现里
      expect(code).not.toMatch(/platform\s*===\s*['"](github|gitlab)['"]/)
      expect(code).not.toMatch(/from ['"]@actions\//)
      expect(code).not.toMatch(/from ['"]@gitbeaker\//)
    }
  })

  test('状态写入确实落到 IGitPlatform 上（而不是各自直连平台 SDK）', async () => {
    useNamespace('gitlab', 'group/demo')
    statefulStore('')
    await setReviewState('o', 'r', 42, 'paused')
    expect(platform.updateChangeRequestBody).toHaveBeenCalled()
  })
})

/**
 * legacy marker 归属（STATE-007 的历史格式面）
 *
 * legacy marker 没有平台前缀——它产生于双平台改造之前，那时只有 GitHub 版跑在
 * 线上。所以任何 legacy marker 必然是 GitHub 侧写下的，GitLab 不该认领。
 *
 * 早先「写新读旧」对两个平台一视同仁地接受 legacy 形态，后果不是 marker 长得
 * 不好看，而是 **GitLab 上的命令会被静默吞掉**：GitHub PR #42 和 GitLab MR !42
 * 各自的评论 ID 完全可能撞号，一旦撞上，GitLab 就把 GitHub 的历史回复当成
 * 「我已经回过了」。
 */
describe('legacy marker 只归 GitHub，GitLab 不认领', () => {
  const COMMENT_ID = 9527
  const CMD = 'help'

  function commentsContaining(body: string): void {
    platform.listComments.mockResolvedValue([{id: 1, body, author: 'ai-reviewer'}])
  }

  test('GitLab 遇到 legacy cmd-reply tag → 判为未处理，命令照常执行', async () => {
    useNamespace('gitlab', 'group/demo')
    commentsContaining(`上次的回复\n${legacyCmdReplyTag(COMMENT_ID, CMD)}`)

    expect(await hasBeenProcessed('o', 'r', 42, COMMENT_ID, CMD)).toBe(false)
  })

  test('GitHub 遇到 legacy cmd-reply tag → 仍判为已处理（升级不重复回复）', async () => {
    useNamespace('github', 'octo/demo')
    commentsContaining(`上次的回复\n${legacyCmdReplyTag(COMMENT_ID, CMD)}`)

    expect(await hasBeenProcessed('o', 'r', 42, COMMENT_ID, CMD)).toBe(true)
  })

  test('对照组：带本平台命名空间的 tag，两边都认自己的', async () => {
    for (const [ns, path] of PLATFORMS) {
      useNamespace(ns, path)
      const own = buildCmdReplyTag(COMMENT_ID, CMD)
      commentsContaining(`回复\n${own}`)
      expect(await hasBeenProcessed('o', 'r', 42, COMMENT_ID, CMD)).toBe(true)
    }
  })

  test('对照组：GitHub 命名空间的 tag，GitLab 读不到（STATE-007）', async () => {
    useNamespace('github', 'octo/demo')
    const githubTag = buildCmdReplyTag(COMMENT_ID, CMD)

    useNamespace('gitlab', 'group/demo')
    commentsContaining(`回复\n${githubTag}`)
    expect(await hasBeenProcessed('o', 'r', 42, COMMENT_ID, CMD)).toBe(false)
  })
})
