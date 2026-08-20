/**
 * state-idempotency-retry.test.ts — 重复投递与写前 HEAD 校验（§10 STATE-011~015）
 *
 * 这一章要的是**同一条规则覆盖两个平台**。此前不是这样：
 *
 *   GitLab job Retry / webhook 重投 → gitlab-trigger.ts 入口拦住（EVENT-013）
 *   GitHub workflow rerun           → 没有任何拦截
 *
 * GitHub rerun 的后果不是多打一条日志。`review.ts` 决定 diff 起点时，若最高已审
 * commit 恰好等于当前 HEAD，会走「已是最新」分支回退到 base commit 重跑**整份**
 * diff——一次点击 rerun 就是一轮完整模型调用，外加重新发布摘要与行级评论。
 *
 * 所以判定挪进平台无关的 `review-idempotency.ts`，由共享分发层
 * （orchestrator.dispatchEvent）统一把关。本文件从 `dispatchEvent` 入口验证。
 *
 * STATE-011/012（写 note/discussion 前重读 HEAD、变化则不写旧结果）由 REVIEW-003
 * 在 `review.ts` 内实现，覆盖在 `review-head-freshness.test.ts`；这里补的是
 * §10 的视角：两个平台共用同一套判定，且与本章的幂等规则不冲突。
 */
import {describe, expect, test, beforeEach, jest} from '@jest/globals'

import type {ExecutionContext, Platform} from '../src/platform/execution-context'

const platformState: Record<string, any> = {
  listComments: jest.fn<any>(),
  getChangeRequest: jest.fn<any>(),
  getAuthenticatedLogin: jest.fn<any>()
}
jest.mock('../src/platform/git-platform', () => ({getPlatform: () => platformState}))

const reviewState = {codeReview: jest.fn<any>()}
jest.mock('../src/review', () => ({codeReview: (...a: any[]) => reviewState.codeReview(...a)}))

const commandState = {handleCommentEvent: jest.fn<any>()}
jest.mock('../src/command-handler', () => ({
  handleCommentEvent: (...a: any[]) => commandState.handleCommentEvent(...a)
}))

import {dispatchEvent} from '../src/platform/orchestrator'
import {hasHeadBeenReviewed, buildReviewIdempotencyKey} from '../src/review-idempotency'
import {setStateNamespace} from '../src/platform/state-namespace'
import {setExecCtx} from '../src/platform/run-context'
import {_resetBotIdentity, initBotGreeting} from '../src/commenter'
import {stateMarker} from '../src/state-markers'

const HEAD = 'a'.repeat(40)
const OTHER = 'd'.repeat(40)

const logs: string[] = []
const logger: any = {
  info: (m: string) => logs.push(m),
  warning: (m: string) => logs.push(m),
  error: (m: string) => logs.push(m),
  debug: () => {}
}

function makeCtx(platform: Platform, headSha = HEAD): ExecutionContext {
  setStateNamespace(platform)
  const ctx = {
    platform,
    projectPath: platform === 'gitlab' ? 'group/demo' : 'octo/demo',
    projectId: '77',
    changeRequestId: 42,
    eventKind: 'pr_synchronize',
    actor: {login: 'alice', isBot: false},
    baseSha: 'b'.repeat(40),
    headSha,
    raw: {}
  } as ExecutionContext
  setExecCtx(ctx)
  return ctx
}

async function dispatch(platform: Platform, headSha = HEAD): Promise<void> {
  await dispatchEvent({
    execCtx: makeCtx(platform, headSha),
    options: {} as any,
    prompts: {} as any,
    logger,
    createBots: () => ({lightBot: {} as any, heavyBot: {} as any})
  })
}

/**
 * 种一条 summary comment，其 reviewed-commit-ids 区块里含指定 SHA。
 *
 * 必须先钉住命名空间再构造 marker——`stateMarker()` 按当前命名空间求值，
 * 而命名空间是跨用例的全局状态，直接在测试体里拼会种出另一个平台的 marker，
 * 被测代码找不到就静默当成「没审过」，用例随即变成空跑。
 */
function seedReviewed(platform: Platform, ...shas: string[]): void {
  seedReviewedBy('ai-reviewer', platform, ...shas)
}

/** 同上，但可指定评论作者——用于伪造场景 */
function seedReviewedBy(author: string, platform: Platform, ...shas: string[]): void {
  setStateNamespace(platform)
  const ids = shas.map(s => `<!-- ${s} -->`).join('\n')
  platformState.listComments.mockResolvedValue([
    {
      id: 1,
      author,
      body:
        `摘要\n${stateMarker('commitIdsStart')}\n${ids}\n` +
        `${stateMarker('commitIdsEnd')}\n${stateMarker('summarize')}`
    }
  ])
}

beforeEach(() => {
  jest.clearAllMocks()
  logs.length = 0
  // commenter 的身份缓存是模块级的；不清会让 fail-closed 分支被上一条用例的
  // 结果影响，依赖「读得到摘要评论」的断言静默空过。
  _resetBotIdentity()
  initBotGreeting('🦉', 'CodeSentinel', 'ai-reviewer')
  platformState.getAuthenticatedLogin = jest.fn<any>(async () => 'ai-reviewer')
  platformState.listComments.mockResolvedValue([])
  reviewState.codeReview.mockResolvedValue(undefined)
  commandState.handleCommentEvent.mockResolvedValue(undefined)
})

const PLATFORMS: Platform[] = ['github', 'gitlab']

describe('STATE-013/014：重复投递与 rerun 不重复发布结果', () => {
  test.each(PLATFORMS)('%s：HEAD 未审查过 → 正常执行审查', async platform => {
    await dispatch(platform)

    expect(reviewState.codeReview).toHaveBeenCalledTimes(1)
  })

  test.each(PLATFORMS)('%s：同一 HEAD 再次投递 → 跳过，不调模型', async platform => {
    seedReviewed(platform, HEAD)

    await dispatch(platform)

    expect(reviewState.codeReview).not.toHaveBeenCalled()
    expect(logs.join('\n')).toContain('already reviewed')
  })

  /**
   * 对照组。少了它，上面的「跳过」可能只是因为分发层压根没走到审查分支。
   */
  test.each(PLATFORMS)('%s：对照组——审过的是别的 SHA → 仍要执行', async platform => {
    seedReviewed(platform, OTHER)

    await dispatch(platform)

    expect(reviewState.codeReview).toHaveBeenCalledTimes(1)
  })

  test('GitHub workflow rerun：连续两次同 HEAD 分发只审一次', async () => {
    // 第一次：没有历史记录
    await dispatch('github')
    expect(reviewState.codeReview).toHaveBeenCalledTimes(1)

    // 审查成功后 review.ts 会把 HEAD 写进 summary；这里模拟那个结果
    seedReviewed('github', HEAD)

    await dispatch('github') // 用户点了 Re-run all jobs
    expect(reviewState.codeReview).toHaveBeenCalledTimes(1)
  })
})

describe('STATE-015：两个平台用同一条幂等规则', () => {
  /**
   * 规则相同不等于状态相通。GitHub PR #42 与 GitLab MR !42 完全可能指向同一个
   * commit，marker 带命名空间正是为此（STATE-007）——一边审过不能让另一边跳过。
   */
  test('GitHub 审过的 SHA 不会让 GitLab 跳过', async () => {
    seedReviewed('github', HEAD)

    await dispatch('gitlab')

    expect(reviewState.codeReview).toHaveBeenCalledTimes(1)
  })

  test('GitLab 审过的 SHA 不会让 GitHub 跳过', async () => {
    seedReviewed('gitlab', HEAD)

    await dispatch('github')

    expect(reviewState.codeReview).toHaveBeenCalledTimes(1)
  })

  test('幂等键带平台前缀，两平台同 project/MR/SHA 也不相同', () => {
    const gh = buildReviewIdempotencyKey('github', '77', 42, HEAD)
    const gl = buildReviewIdempotencyKey('gitlab', '77', 42, HEAD)

    expect(gh).not.toBe(gl)
    expect(gh).toContain(HEAD)
  })

  /**
   * 幂等是「省一次模型调用」，不是安全边界。查询失败时宁可再审一次，也不能因为
   * 这层读取失败让正常审查停摆——与 REVIEW-003 的 fail closed 方向相反，是有意的：
   * 那条错了会写脏数据，这条错了只是多花一次钱。
   */
  test.each(PLATFORMS)('%s：查询失败 → fail open，照常审查', async platform => {
    platformState.listComments.mockRejectedValue(new Error('502'))

    await dispatch(platform)

    expect(reviewState.codeReview).toHaveBeenCalledTimes(1)
  })

  test.each(PLATFORMS)('%s：HEAD 为空 → 判为未审查过，不误跳过', async platform => {
    seedReviewed(platform, HEAD)

    await dispatch(platform, '')

    expect(reviewState.codeReview).toHaveBeenCalledTimes(1)
  })

  test('没有 summary comment 时判为未审查过', async () => {
    platformState.listComments.mockResolvedValue([{id: 1, author: 'someone', body: '普通评论'}])

    expect(await hasHeadBeenReviewed('octo', 'demo', 42, HEAD)).toBe(false)
  })
})

describe('STATE-011/012：评论事件不受自动审查幂等影响', () => {
  /**
   * 幂等门禁只挡自动审查分支。命令与对话事件有自己的幂等（cmd-reply marker），
   * 若被这道门禁误伤，用户在一个「已审过」的 PR 上发任何命令都会石沉大海。
   */
  test.each(PLATFORMS)('%s：HEAD 已审查过，评论事件仍然分发', async platform => {
    seedReviewed(platform, HEAD)
    const ctx = makeCtx(platform)

    await dispatchEvent({
      execCtx: {...ctx, eventKind: 'comment_created'} as ExecutionContext,
      options: {} as any,
      prompts: {} as any,
      logger,
      createBots: () => ({lightBot: {} as any, heavyBot: {} as any})
    })

    expect(commandState.handleCommentEvent).toHaveBeenCalledTimes(1)
    expect(reviewState.codeReview).not.toHaveBeenCalled()
  })
})

/**
 * 伪造 summary marker（P0 回归）。
 *
 * marker 格式和 HEAD SHA 都是公开信息——任何能在 PR/MR 下评论的人都能贴一条带
 * 正确 marker 和当前 SHA 的评论。判定若不校验作者，这就是一个**任意用户可触发
 * 的审查静默开关**：伪造一条，共享分发层立刻判定「审过了」跳过整轮审查，而且
 * 日志里看起来一切正常，没有任何异常信号。
 */
describe('伪造 summary marker 不得关闭审查', () => {
  test.each(PLATFORMS)('%s：普通用户伪造的 summary → 不采信，照常审查', async platform => {
    seedReviewedBy('mallory', platform, HEAD)

    await dispatch(platform)

    expect(reviewState.codeReview).toHaveBeenCalledTimes(1)
  })

  test.each(PLATFORMS)('%s：伪造评论与真实 summary 并存 → 仍以真实的为准', async platform => {
    setStateNamespace(platform)
    const block = (sha: string): string =>
      `摘要\n${stateMarker('commitIdsStart')}\n<!-- ${sha} -->\n` +
      `${stateMarker('commitIdsEnd')}\n${stateMarker('summarize')}`
    // 伪造的那条声称当前 HEAD 审过了；真实的那条只审过别的 SHA
    platformState.listComments.mockResolvedValue([
      {id: 1, author: 'mallory', body: block(HEAD)},
      {id: 2, author: 'ai-reviewer', body: block(OTHER)}
    ])

    await dispatch(platform)

    expect(reviewState.codeReview).toHaveBeenCalledTimes(1)
  })

  test('bot 身份无法确认时不采信任何 summary（fail open：宁可多审一次）', async () => {
    _resetBotIdentity()
    initBotGreeting('🦉', 'CodeSentinel', '') // 未配置 botLogin
    platformState.getAuthenticatedLogin = jest.fn<any>(async () => {
      throw new Error('401')
    })
    seedReviewed('github', HEAD)

    await dispatch('github')

    expect(reviewState.codeReview).toHaveBeenCalledTimes(1)
  })

  test('对照组：作者确实是 reviewer 时才跳过（证明上面不是永远不跳）', async () => {
    seedReviewedBy('ai-reviewer', 'github', HEAD)

    await dispatch('github')

    expect(reviewState.codeReview).not.toHaveBeenCalled()
  })
})

/**
 * 把 STATE-011/012/015 收窄后的边界写成可执行断言。
 *
 * 收窄的验收文字若没有对应用例，下一次改动很容易在无人察觉的情况下把边界挪走，
 * 或者反过来——有人以为某个保证存在，实际并没有。
 */
/**
 * STATE-011/012 的粒度守卫。
 *
 * 四个发布阶段各一道门禁，**外加**行级评论批次内每条写入前一道。后者不是锦上
 * 添花：一批可能有十几条 discussion，只在批次之前检查的话，第一条写完 HEAD 就
 * 变了，剩下的仍然是基于旧 diff 的结论，照发不误。
 */
describe('STATE-011/012：门禁粒度到每次逻辑写入', () => {
  test('四个发布阶段各一道，另有一道供批次内逐条调用', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const src = require('fs').readFileSync('src/review.ts', 'utf8') as string

    for (const phase of [
      'in-progress banner',
      'release notes',
      'line-level review',
      'final summary',
      'line-level write'
    ]) {
      expect(src).toContain(`ensureHeadFresh('${phase}')`)
    }
  })

  test('新鲜度回调确实被传进 submitReview（不是定义了没接上）', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const src = require('fs').readFileSync('src/review.ts', 'utf8') as string
    expect(src).toMatch(/submitReview\([\s\S]{0,300}line-level write/)
  })
})

/**
 * adapter 层的逐条门禁行为（STATE-011/012）。
 *
 * 上面那两条只证明「回调接上了」。这里验证 adapter 真的会在中途停下，并且停下来
 * 的那些评论走的是第三个桶——不是 delivered（否则对应位置被取代的 resolved 旧
 * 讨论会被删掉），也不是 failed（否则会被顶层降级重新发出去，而那正是要避免的）。
 */
describe('STATE-011/012：GitLab 逐条创建时中途停止', () => {
  const drafts = [
    {path: 'a.ts', line: 1, body: '第一条'},
    {path: 'b.ts', line: 2, body: '第二条'},
    {path: 'c.ts', line: 3, body: '第三条'}
  ]

  function makeAdapter(): any {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const {GitLabPlatform} = require('../src/platform/gitlab-platform')
    const adapter = new GitLabPlatform({
      host: 'https://gitlab.example.com',
      credential: {type: 'pat', value: 'glpat-test'},
      timeoutMS: 1000
    })
    adapter.createReviewComment = jest.fn<any>(async () => undefined)
    adapter.createComment = jest.fn<any>(async () => ({id: 1, body: '', author: 'bot'}))
    return adapter
  }

  test('第一条之后 HEAD 变化 → 剩余进 staleSkipped，且不再调用创建', async () => {
    const adapter = makeAdapter()
    let calls = 0
    const ensureFresh = async (): Promise<boolean> => ++calls <= 1

    const r = await adapter.submitReviewComments('g', 'demo', 42, 'sha', drafts, undefined, {
      ensureFresh
    })

    expect(r.delivered).toHaveLength(1)
    expect(r.staleSkipped).toHaveLength(2)
    expect(r.failed).toHaveLength(0)
    expect(adapter.createReviewComment).toHaveBeenCalledTimes(1)
  })

  test('对照组：HEAD 一直未变 → 三条全部投递', async () => {
    const adapter = makeAdapter()

    const r = await adapter.submitReviewComments('g', 'demo', 42, 'sha', drafts, undefined, {
      ensureFresh: async () => true
    })

    expect(r.delivered).toHaveLength(3)
    expect(r.staleSkipped).toHaveLength(0)
    expect(adapter.createReviewComment).toHaveBeenCalledTimes(3)
  })

  test('不传 hooks 时行为不变（老调用方与测试替身不受影响）', async () => {
    const adapter = makeAdapter()

    const r = await adapter.submitReviewComments('g', 'demo', 42, 'sha', drafts)

    expect(r.delivered).toHaveLength(3)
    expect(r.staleSkipped).toHaveLength(0)
  })
})

/**
 * commenter 侧对 staleSkipped 的处置（STATE-012）。
 *
 * 被跳过的评论必须同时排除在两条后续路径之外：
 *
 *   - 不能算 delivered：对应位置上被取代的 resolved 旧讨论会被删掉，
 *     结果是新发现没发、历史也没了
 *   - 不能算 failed：会走顶层降级把内容重新发出去，而「别发旧结论」正是初衷
 */
describe('STATE-012：被跳过的评论不触发旧讨论清理', () => {
  test('staleSkipped 的位置不删除既有 resolved 讨论', async () => {
    jest.resetModules()

    const platform: any = {
      listReviewComments: jest.fn<any>(async () => [
        // 同一位置上一条已 resolved 的 bot 旧评论——它是「待清理」的候选
        {
          id: 777,
          path: 'a.ts',
          line: 1,
          body: `旧发现\n${stateMarker('comment')}`,
          user: {login: 'ai-reviewer'},
          author: 'ai-reviewer'
        }
      ]),
      submitReviewComments: jest.fn<any>(async (..._a: any[]) => ({
        delivered: [],
        failed: [],
        staleSkipped: [{path: 'a.ts', line: 1, body: '新发现'}]
      })),
      deleteReviewComment: jest.fn<any>(async () => undefined),
      createComment: jest.fn<any>(async () => ({id: 1, body: '', author: 'ai-reviewer'})),
      getAuthenticatedLogin: jest.fn<any>(async () => 'ai-reviewer'),
      deletePendingReview: jest.fn<any>(async () => undefined)
    }
    jest.doMock('../src/platform/git-platform', () => ({getPlatform: () => platform}))

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const commenterMod = require('../src/commenter')
    commenterMod._resetBotIdentity()
    commenterMod.initBotGreeting('🦉', 'CodeSentinel', 'ai-reviewer')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('../src/platform/run-context').setExecCtx({
      platform: 'gitlab',
      projectPath: 'group/demo',
      projectId: '77',
      changeRequestId: 42,
      eventKind: 'pr_opened',
      actor: {login: 'a', isBot: false},
      baseSha: 'b',
      headSha: HEAD,
      raw: {}
    })

    const c = new commenterMod.Commenter()
    c.reviewCommentsBuffer.push({path: 'a.ts', startLine: 1, endLine: 1, message: '新发现'})
    await c.submitReview(42, 'sha', '状态', new Map([['a.ts:1', true]]), async () => false)

    expect(platform.deleteReviewComment).not.toHaveBeenCalled()
  })
})
