/**
 * release-notes-dual-platform.test.ts — §8.6 Release Notes（REVIEW-019~027）
 *
 * release notes 是**共享审查核心**的产物，两个平台走同一条路径：同一份 prompt、
 * 同一个开关语义，差异只在 description 的 marker 命名空间。
 *
 * 真正值得钉的是写入侧：description 是**用户和两个平台共享**的一块正文，
 * 里面同时可能有用户原文、pause/resume marker、另一平台的 release notes 区块。
 * 「只替换自己那一段」必须逐条验证，而不是相信实现。
 */
import {describe, expect, test, jest, beforeEach} from '@jest/globals'

jest.mock('../src/tokenizer', () => ({getTokenCount: () => 10}))
jest.mock('../src/github/review-thread', () => ({
  fetchThreadStatusMap: jest.fn<any>().mockResolvedValue(new Map())
}))

const BOT = 'bot'
const BASE = 'b'.repeat(40)
const HEAD = 'h'.repeat(40)

const platformState: any = {
  getChangeRequest: jest.fn<any>(),
  compareDiff: jest.fn<any>(),
  getFileContent: jest.fn<any>(),
  listRepositoryTree: jest.fn<any>(),
  listComments: jest.fn<any>(),
  listReviewComments: jest.fn<any>(),
  createComment: jest.fn<any>(),
  updateComment: jest.fn<any>(),
  deleteComment: jest.fn<any>(),
  deleteReviewComment: jest.fn<any>(),
  listChangeRequestCommits: jest.fn<any>(),
  submitReviewComments: jest.fn<any>(),
  updateChangeRequestBody: jest.fn<any>(),
  deletePendingReview: jest.fn<any>(),
  getAuthenticatedLogin: jest.fn<any>()
}
jest.mock('../src/platform/git-platform', () => ({getPlatform: () => platformState}))

const logs: string[] = []
jest.mock('../src/platform/logger', () => ({
  getLogger: () => ({
    info: (m: string) => logs.push(m),
    warning: (m: string) => logs.push(m),
    error: (m: string) => logs.push(m),
    debug: () => {}
  })
}))

import {codeReview} from '../src/review'
import {Commenter, _resetBotIdentity, initBotGreeting} from '../src/commenter'
import {_resetWriteQueues} from '../src/description-state'
import {setExecCtx} from '../src/platform/run-context'
import {setStateNamespace} from '../src/platform/state-namespace'
import {STATE_MARKERS, stateMarker} from '../src/state-markers'
import {setReviewState} from '../src/review-state'
import type {ExecutionContext, Platform} from '../src/platform/execution-context'

/** 可辨识的提示词：按内容而不是调用序号定位阶段 */
const taggedPrompts: any = {
  renderSummarizeFileDiff: () => 'PROMPT_FILE_SUMMARY',
  renderSummarizeChangesets: () => 'PROMPT_MERGE',
  renderSummarize: () => 'PROMPT_FINAL_SUMMARY',
  renderSummarizeReleaseNotes: () => 'PROMPT_RELEASE_NOTES',
  renderSummarizeShort: () => 'PROMPT_SHORT',
  renderReviewFileDiff: () => 'PROMPT_REVIEW ---new_hunk---'
}

/** 记录每次模型调用的提示词，便于断言「哪个阶段被调用过」 */
const seenPrompts: string[] = []
function makeBot(releaseNotes = '- 新增了 X 功能'): any {
  return {
    chat: jest.fn<any>(async (prompt: string) => {
      seenPrompts.push(String(prompt))
      if (String(prompt) === 'PROMPT_RELEASE_NOTES') return [releaseNotes, {}, []]
      if (String(prompt).includes('---new_hunk---')) return ['2-2:\n有问题\n', {}, []]
      return ['LGTM', {}, []]
    })
  }
}

function makeOptions(over: Record<string, any> = {}): any {
  const limits = {
    requestTokens: 100000,
    responseTokens: 1000,
    maxTokens: 101000,
    knowledgeCutOff: ''
  }
  return {
    debug: false,
    disableReview: false,
    disableReleaseNotes: false,
    maxFiles: 0,
    reviewSimpleChanges: true,
    reviewCommentLGTM: false,
    pathFilters: {check: () => true},
    checkPath: () => true,
    systemMessage: '',
    openaiLightModel: 'l',
    openaiHeavyModel: 'h',
    openaiConcurrencyLimit: 2,
    githubConcurrencyLimit: 2,
    enableWebSearch: false,
    enableShell: false,
    enableLintTools: false,
    enableDependencyAnalysis: false,
    lintReportPath: '',
    botIcon: '🤖',
    botName: 'CodeSentinel',
    botLogin: BOT,
    maxReviewComments: 20,
    lightTokenLimits: limits,
    heavyTokenLimits: limits,
    language: 'zh-CN',
    ...over
  }
}

function useCtx(platform: Platform = 'github'): ExecutionContext {
  setStateNamespace(platform)
  const ctx: any = {
    platform,
    projectPath: platform === 'github' ? 'octo/demo' : 'group/subgroup/demo',
    projectId: platform === 'github' ? 'octo/demo' : '77',
    changeRequestId: 1,
    eventKind: 'pr_opened',
    actor: {login: 'alice', isBot: false},
    baseSha: BASE,
    headSha: HEAD,
    raw: {}
  }
  setExecCtx(ctx)
  return ctx
}

/** 有状态的 description：写入会真的改变后续读到的内容 */
function statefulDescription(initial: string): {get: () => string} {
  let stored = initial
  platformState.getChangeRequest.mockImplementation(async () => ({
    number: 1,
    title: 't',
    body: stored,
    state: 'open',
    baseSha: BASE,
    headSha: HEAD,
    baseRef: 'main',
    headRef: 'feature',
    author: 'alice'
  }))
  platformState.updateChangeRequestBody.mockImplementation(
    async (_o: any, _r: any, _n: any, body: string) => {
      stored = body
    }
  )
  return {get: () => stored}
}

beforeEach(() => {
  jest.clearAllMocks()
  logs.length = 0
  seenPrompts.length = 0
  _resetBotIdentity()
  _resetWriteQueues()
  initBotGreeting('🤖', 'CodeSentinel', BOT)
  statefulDescription('用户自己写的描述')
  platformState.compareDiff.mockResolvedValue({
    files: [{filename: 'a.ts', status: 'modified', patch: '@@ -1,2 +1,3 @@\n a\n+x\n b'}],
    commits: [{sha: HEAD}]
  })
  platformState.getFileContent.mockResolvedValue('a\nb')
  platformState.listRepositoryTree.mockResolvedValue({files: [], truncated: false})
  platformState.listComments.mockResolvedValue([])
  platformState.listReviewComments.mockResolvedValue([])
  platformState.createComment.mockResolvedValue({id: 1, body: '', author: BOT})
  platformState.updateComment.mockResolvedValue(undefined)
  platformState.deleteComment.mockResolvedValue(undefined)
  platformState.deleteReviewComment.mockResolvedValue(undefined)
  platformState.listChangeRequestCommits.mockResolvedValue([])
  platformState.submitReviewComments.mockImplementation(async (..._a: any[]) => ({
    delivered: [...((_a[4] ?? []) as any[])],
    failed: []
  }))
  platformState.deletePendingReview.mockResolvedValue(undefined)
  platformState.getAuthenticatedLogin.mockResolvedValue(BOT)
})

describe('REVIEW-019/025：两个平台走同一条生成路径', () => {
  test.each<[Platform]>([['github'], ['gitlab']])(
    '%s：使用同一份 release notes prompt',
    async platform => {
      const ctx = useCtx(platform)
      await codeReview(ctx, makeBot(), makeBot(), makeOptions(), taggedPrompts)

      expect(seenPrompts).toContain('PROMPT_RELEASE_NOTES')
    }
  )

  test('同一 fixture 在两平台生成语义等价的内容（差异只在 marker 命名空间）', async () => {
    const bodies: Record<string, string> = {}
    for (const platform of ['github', 'gitlab'] as Platform[]) {
      jest.clearAllMocks()
      _resetWriteQueues()
      const store = statefulDescription('用户自己写的描述')
      platformState.listComments.mockResolvedValue([])
      platformState.listReviewComments.mockResolvedValue([])
      platformState.createComment.mockResolvedValue({id: 1, body: '', author: BOT})
      platformState.getAuthenticatedLogin.mockResolvedValue(BOT)
      platformState.submitReviewComments.mockImplementation(async () => ({
        delivered: [],
        failed: []
      }))

      const ctx = useCtx(platform)
      await codeReview(ctx, makeBot(), makeBot(), makeOptions(), taggedPrompts)
      bodies[platform] = store.get()
    }

    // 正文内容一致，只有 marker 前缀不同
    const normalize = (s: string): string => s.replace(/ai-reviewer:(github|gitlab):/g, 'NS:')
    expect(normalize(bodies.gitlab)).toBe(normalize(bodies.github))
    // 防空跑：确实写进去了
    expect(bodies.github).toContain('新增了 X 功能')
  })
})

describe('REVIEW-024：关闭时完全跳过模型调用与 description 更新', () => {
  test('disable_release_notes=true → 不调用 release notes prompt', async () => {
    const ctx = useCtx()
    await codeReview(
      ctx,
      makeBot(),
      makeBot(),
      makeOptions({disableReleaseNotes: true}),
      taggedPrompts
    )

    expect(seenPrompts).not.toContain('PROMPT_RELEASE_NOTES')
    // 其它阶段照常，证明不是整轮没跑
    expect(seenPrompts).toContain('PROMPT_FINAL_SUMMARY')
  })

  test('disable_release_notes=true → 不写 description', async () => {
    const ctx = useCtx()
    const store = statefulDescription('用户自己写的描述')

    await codeReview(
      ctx,
      makeBot(),
      makeBot(),
      makeOptions({disableReleaseNotes: true}),
      taggedPrompts
    )

    expect(platformState.updateChangeRequestBody).not.toHaveBeenCalled()
    expect(store.get()).toBe('用户自己写的描述')
  })

  test('对照组：开启时两者都发生', async () => {
    const ctx = useCtx()
    await codeReview(ctx, makeBot(), makeBot(), makeOptions(), taggedPrompts)

    expect(seenPrompts).toContain('PROMPT_RELEASE_NOTES')
    expect(platformState.updateChangeRequestBody).toHaveBeenCalled()
  })

  test('模型返回空 → 不写 description（没内容就别动用户的描述）', async () => {
    const ctx = useCtx()
    const store = statefulDescription('用户自己写的描述')

    await codeReview(ctx, makeBot(), makeBot(''), makeOptions(), taggedPrompts)

    expect(store.get()).toBe('用户自己写的描述')
  })
})

describe('REVIEW-021/022/023：只替换 reviewer 管理的区域', () => {
  test.each<[Platform]>([['github'], ['gitlab']])(
    '%s：用户原始描述保留，release notes 追加在自己的 marker 区块里',
    async platform => {
      const ctx = useCtx(platform)
      const store = statefulDescription('用户自己写的描述\n\n## 背景\n这个 MR 修了个 bug')

      await codeReview(ctx, makeBot(), makeBot(), makeOptions(), taggedPrompts)

      const body = store.get()
      expect(body).toContain('用户自己写的描述')
      expect(body).toContain('## 背景')
      expect(body).toContain(stateMarker('descriptionStart'))
      expect(body).toContain('新增了 X 功能')
    }
  )

  test('不覆盖另一平台的 release notes 区块', async () => {
    const ctx = useCtx('gitlab')
    const store = statefulDescription(
      [
        '用户自己写的描述',
        '<!-- ai-reviewer:github:release-notes-start -->',
        'GitHub 侧的发布说明',
        '<!-- ai-reviewer:github:release-notes-end -->'
      ].join('\n')
    )

    await codeReview(ctx, makeBot(), makeBot(), makeOptions(), taggedPrompts)

    const body = store.get()
    expect(body).toContain('GitHub 侧的发布说明')
    expect(body).toContain('ai-reviewer:github:release-notes-start')
    expect(body).toContain('新增了 X 功能')
  })

  /**
   * legacy marker 没有平台命名空间——它产生于双平台改造之前，那时只有 GitHub 版，
   * 所以正文里任何 legacy marker 必然是 GitHub 侧写下的。
   *
   * 早先 tagPairVariants 对两个平台都返回 legacy 形态，于是 MR description 里
   * 一个升级前由 GitHub 写入的 release notes 区块，会在 GitLab 首次运行时被
   * 识别成「自己的区块」而整段覆盖。
   */
  test('GitLab 不接管升级前 GitHub 写下的 legacy release-notes 区块', async () => {
    const ctx = useCtx('gitlab')
    const store = statefulDescription(
      [
        '用户自己写的描述',
        STATE_MARKERS.descriptionStart.legacy,
        '升级前 GitHub 写的发布说明',
        STATE_MARKERS.descriptionEnd.legacy
      ].join('\n')
    )

    await codeReview(ctx, makeBot(), makeBot(), makeOptions(), taggedPrompts)

    const body = store.get()
    expect(body).toContain('升级前 GitHub 写的发布说明') // 历史内容必须保住
    expect(body).toContain(STATE_MARKERS.descriptionStart.legacy) // 连同它的 marker
    expect(body).toContain('新增了 X 功能') // GitLab 另起自己的区块
    expect(body).toContain('ai-reviewer:gitlab:release-notes-start')
  })

  test('GitHub 仍然接管自己的 legacy 区块（就地更新，这才是「写新读旧」的本意）', async () => {
    const ctx = useCtx('github')
    const store = statefulDescription(
      [
        '用户自己写的描述',
        STATE_MARKERS.descriptionStart.legacy,
        '升级前写的发布说明',
        STATE_MARKERS.descriptionEnd.legacy
      ].join('\n')
    )

    await codeReview(ctx, makeBot(), makeBot(), makeOptions(), taggedPrompts)

    const body = store.get()
    expect(body).not.toContain('升级前写的发布说明') // 被新内容取代
    expect(body).toContain('新增了 X 功能')
    // 不产生第二个区块
    const legacyCount = body.split(STATE_MARKERS.descriptionStart.legacy).length - 1
    const currentCount = body.split(stateMarker('descriptionStart')).length - 1
    expect(legacyCount + currentCount).toBe(1)
  })

  test('不覆盖 pause/resume marker（同一份 description 上的另一种状态）', async () => {
    const ctx = useCtx('gitlab')
    const store = statefulDescription(
      [
        '用户自己写的描述',
        `${stateMarker('reviewStateStart')}`,
        'state: paused',
        `${stateMarker('reviewStateEnd')}`
      ].join('\n')
    )

    // paused 会让自动审查跳过，这里用命令触发绕开暂停语义，只验写入不互相覆盖
    await codeReview(ctx, makeBot(), makeBot(), makeOptions(), taggedPrompts, {
      source: 'command',
      mode: 'full'
    })

    const body = store.get()
    expect(body).toContain('state: paused')
    expect(body).toContain('新增了 X 功能')
    expect(body).toContain('用户自己写的描述')
  })

  test('二次运行更新既有区块，而不是追加第二份', async () => {
    const ctx = useCtx()
    const store = statefulDescription('用户自己写的描述')

    await codeReview(ctx, makeBot('- 第一版'), makeBot('- 第一版'), makeOptions(), taggedPrompts)
    _resetWriteQueues()
    await codeReview(ctx, makeBot('- 第二版'), makeBot('- 第二版'), makeOptions(), taggedPrompts)

    const body = store.get()
    const occurrences = body.split(stateMarker('descriptionStart')).length - 1
    expect(occurrences).toBe(1)
    expect(body).toContain('第二版')
    expect(body).not.toContain('第一版')
  })
})

describe('REVIEW-026/027：读最新值 → 只改自己那段 → 冲突重试', () => {
  test('release notes 与 pause/resume 交替写入，互不覆盖', async () => {
    const ctx = useCtx('gitlab')
    const store = statefulDescription('用户自己写的描述')

    await setReviewState('g', 'demo', 1, 'paused')
    await new Commenter().updateDescription(1, '### Summary\n- 发布说明')

    const body = store.get()
    expect(body).toContain('state: paused')
    expect(body).toContain('发布说明')
    expect(body).toContain('用户自己写的描述')
  })

  test('marker 损坏（缺结束标签）→ 放弃写入，不改坏用户描述', async () => {
    useCtx()
    const damaged = `用户描述\n${stateMarker('descriptionStart')}\n半个区块`
    const store = statefulDescription(damaged)

    await new Commenter().updateDescription(1, '### Summary\n- 新内容')

    expect(store.get()).toBe(damaged)
    expect(logs.join('\n')).toContain('Skipped adding release notes')
  })

  test('写入不落地 → 有限重试后如实报告，不谎报成功', async () => {
    useCtx()
    platformState.getChangeRequest.mockResolvedValue({body: '用户描述'})
    platformState.updateChangeRequestBody.mockResolvedValue(undefined) // 写了不生效

    await new Commenter().updateDescription(1, '### Summary\n- 新内容')

    expect(logs.join('\n')).toContain('Skipped adding release notes')
    expect(logs.join('\n')).toContain('conflict')
  })
})

describe('REVIEW-020：两侧配置映射', () => {
  test.each([
    ['false', false],
    ['true', true]
  ])('GitLab：AI_REVIEWER_DISABLE_RELEASE_NOTES="%s" → %s', (raw, expected) => {
    jest.resetModules()
    process.env.AI_REVIEWER_DISABLE_RELEASE_NOTES = raw as string
    process.env.GITLAB_HOST = 'https://gitlab.example.com'
    process.env.GITLAB_PAT = 'glpat-test'
    process.env.OPENAI_API_KEY = 'sk-test'

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const {GitLabConfigProvider} = require('../src/platform/gitlab-config-provider')
    expect(new GitLabConfigProvider().getOptions().disableReleaseNotes).toBe(expected)
    delete process.env.AI_REVIEWER_DISABLE_RELEASE_NOTES
  })

  test('GitLab：自定义 summarize_release_notes 提示词可覆盖', () => {
    jest.resetModules()
    process.env.AI_REVIEWER_SUMMARIZE_RELEASE_NOTES = '自定义发布说明提示词'
    process.env.GITLAB_HOST = 'https://gitlab.example.com'
    process.env.GITLAB_PAT = 'glpat-test'
    process.env.OPENAI_API_KEY = 'sk-test'

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const {GitLabConfigProvider} = require('../src/platform/gitlab-config-provider')
    const prompt = new GitLabConfigProvider().getPromptConfig()
    expect(prompt.summarizeReleaseNotes).toBe('自定义发布说明提示词')
    delete process.env.AI_REVIEWER_SUMMARIZE_RELEASE_NOTES
  })

  test('GitHub input 名保持不变（不得因双平台改造重命名）', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('path')
    const actionYml: string = fs.readFileSync(path.resolve(__dirname, '../action.yml'), 'utf8')
    expect(actionYml).toContain('disable_release_notes')
    expect(actionYml).toContain('summarize_release_notes')
  })
})
