/**
 * review-execctx-consistency.test.ts — review.ts 双轨一致性断言（U5）
 *
 * review.ts 的 codeReview() 在 T7 新增了 execCtx 首参数，但内部仍以模块级
 * `context`/`repo`（`@actions/github`）为主要数据源（dual-track 过渡态，
 * 见设计文档 6.3 节）。唯二真正读取 execCtx 的地方是 Phase 0 依赖分析调用
 * getRepoFileTree()/analyzeDependencies() 时的 `execCtx.headSha || context.
 * payload.pull_request.head.sha` 回退表达式。本测试验证：
 *   1. 正常场景下 execCtx（由 createGitHubExecutionContext() 真实构造）与
 *      context 两条数据源对同一事件算出的 headSha 一致；
 *   2. execCtx.headSha 为空（评论触发场景）时，回退表达式正确退回到
 *      context.payload.pull_request.head.sha，不会传出 undefined/空值。
 *
 * 参考 docs/tasks/execution-context-design.md 第 9.2 节 U5。
 */
import {describe, expect, test, jest, beforeEach} from '@jest/globals'

jest.mock('@actions/core', () => ({
  getInput: jest.fn().mockReturnValue(''),
  info: jest.fn(),
  warning: jest.fn(),
  error: jest.fn()
}))

const mockContext: any = {
  eventName: 'pull_request',
  actor: 'someone',
  payload: {},
  repo: {owner: 'octo', repo: 'demo'}
}
jest.mock('@actions/github', () => ({context: mockContext}))

const platformState = {
  compareDiff: jest.fn<(...a: any[]) => Promise<any>>(),
  getFileContent: jest.fn<(...a: any[]) => Promise<any>>(),
  getChangeRequest: jest.fn<(...a: any[]) => Promise<any>>(),
  listRepositoryTree: jest.fn<(...a: any[]) => Promise<any>>()
}
jest.mock('../src/platform/git-platform', () => ({
  getPlatform: () => platformState
}))
jest.mock('../src/platform/logger', () => ({
  getLogger: () => ({
    info: jest.fn(),
    warning: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })
}))

const commenterState = {
  getDescription: jest.fn((body: string) => body ?? ''),
  findCommentWithTag: jest.fn<() => Promise<any>>().mockResolvedValue(null),
  getAllCommitIds: jest.fn<() => Promise<any[]>>().mockResolvedValue([]),
  getHighestReviewedCommitId: jest.fn().mockReturnValue(''),
  getReviewedCommitIds: jest.fn().mockReturnValue([]),
  getReviewedCommitIdsBlock: jest.fn().mockReturnValue(''),
  getRawSummary: jest.fn().mockReturnValue(''),
  getShortSummary: jest.fn().mockReturnValue(''),
  addInProgressStatus: jest.fn().mockReturnValue('IN_PROGRESS'),
  comment: jest.fn<(...a: any[]) => Promise<void>>().mockResolvedValue(undefined),
  updateDescription: jest.fn<(...a: any[]) => Promise<void>>().mockResolvedValue(undefined),
  submitReview: jest.fn<(...a: any[]) => Promise<void>>().mockResolvedValue(undefined),
  addReviewedCommitId: jest.fn().mockReturnValue('<!-- reviewed-commit-ids -->'),
  bufferReviewComment: jest.fn<(...a: any[]) => Promise<void>>().mockResolvedValue(undefined),
  listReviewComments: jest.fn<() => Promise<any[]>>().mockResolvedValue([]),
  getCommentChainsWithinRange: jest.fn<(...a: any[]) => Promise<string>>().mockResolvedValue('')
}
jest.mock('../src/commenter', () => ({
  Commenter: jest.fn().mockImplementation(() => commenterState),
  commentTag: () => '<!-- bot-comment -->',
  commentReplyTag: () => '<!-- bot-reply -->',
  rawSummaryStartTag: () => '<!-- raw-summary-start -->',
  rawSummaryEndTag: () => '<!-- raw-summary-end -->',
  shortSummaryStartTag: () => '<!-- short-summary-start -->',
  shortSummaryEndTag: () => '<!-- short-summary-end -->',
  summarizeTag: () => '<!-- summarize -->'
}))

jest.mock('../src/tokenizer', () => ({getTokenCount: () => 0}))

jest.mock('../src/github/review-thread', () => ({
  fetchThreadStatusMap: jest.fn<() => Promise<Map<string, boolean>>>().mockResolvedValue(new Map())
}))

const repoTreeState = {
  getRepoFileTree: jest
    .fn<(...a: any[]) => Promise<{files: string[]; truncated: boolean}>>()
    .mockResolvedValue({files: [], truncated: false})
}
jest.mock('../src/repo-tree', () => ({
  getRepoFileTree: (...a: any[]) => repoTreeState.getRepoFileTree(...a)
}))

const dependencyAnalyzerState = {
  analyzeDependencies: jest
    .fn<(...a: any[]) => Promise<any>>()
    .mockResolvedValue({fileAnalyses: new Map(), treeTruncated: false})
}
jest.mock('../src/dependency-analyzer', () => ({
  analyzeDependencies: (...a: any[]) => dependencyAnalyzerState.analyzeDependencies(...a),
  formatCrossFileContext: jest.fn().mockReturnValue(''),
  formatDependencySummary: jest.fn().mockReturnValue(''),
  TREE_TRUNCATED_NOTICE: '> tree-truncated'
}))

import {codeReview} from '../src/review'
import {createGitHubExecutionContext} from '../src/platform/github-execution-context'
import {Options} from '../src/options'
import {Prompts} from '../src/prompts'

function makeOptions(): Options {
  return new Options(
    false, // debug
    false, // disableReview
    true, // disableReleaseNotes
    '0', // maxFiles
    false, // reviewSimpleChanges
    false, // reviewCommentLGTM
    null, // pathFilters
    '', // systemMessage
    'gpt-5.4-nano',
    'gpt-5.4-mini',
    '0.0',
    '3',
    '120000',
    '6',
    '6',
    'https://api.openai.com/v1',
    'en-US',
    true, // enableDependencyAnalysis — U5 专门测这条路径，必须打开
    '50',
    true,
    true,
    false // enableLintTools
  )
}

function makeBot(response = 'ok'): any {
  return {
    chat: jest
      .fn<() => Promise<[string, Record<string, unknown>, unknown[]]>>()
      .mockResolvedValue([response, {}, []])
  }
}

function makePullRequestPayload(overrides: Record<string, any> = {}): any {
  return {
    number: 42,
    title: 'Add dependency analysis path',
    body: 'body',
    base: {sha: 'base-sha-0001'},
    head: {sha: 'head-sha-0001'},
    ...overrides
  }
}

describe('review.ts 双轨一致性（execCtx vs context，Phase 0 依赖分析调用）', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.GITHUB_EVENT_NAME = 'pull_request'
    mockContext.eventName = 'pull_request'
    mockContext.actor = 'someone'
    mockContext.payload = {
      action: 'opened',
      pull_request: makePullRequestPayload()
    }
    mockContext.repo = {owner: 'octo', repo: 'demo'}

    commenterState.getDescription.mockImplementation((body: string) => body ?? '')
    commenterState.findCommentWithTag.mockResolvedValue(null)
    commenterState.getAllCommitIds.mockResolvedValue([])
    commenterState.addInProgressStatus.mockReturnValue('IN_PROGRESS')
    commenterState.addReviewedCommitId.mockReturnValue('<!-- reviewed-commit-ids -->')

    platformState.compareDiff.mockResolvedValue({
      files: [
        {
          filename: 'src/foo.ts',
          status: 'modified',
          patch: '@@ -1,3 +1,4 @@\n line1\n line2\n+added line\n line3'
        }
      ],
      commits: [{sha: 'head-sha-0001'}]
    })
    platformState.getFileContent.mockResolvedValue('line1\nline2\nline3')

    repoTreeState.getRepoFileTree.mockResolvedValue({files: [], truncated: false})
    dependencyAnalyzerState.analyzeDependencies.mockResolvedValue({
      fileAnalyses: new Map(),
      treeTruncated: false
    })
  })

  test('execCtx（真实工厂构造）与 context 对同一事件算出的 headSha 一致', () => {
    // 前置断言：不依赖 codeReview 内部行为，直接验证两套构造路径本身的取值一致性——
    // 这是"双轨"这个词真正的含义：两套独立代码路径读同一个底层事件，必须得到相同答案。
    const execCtx = createGitHubExecutionContext()
    expect(execCtx.headSha).toBe(mockContext.payload.pull_request.head.sha)
    expect(execCtx.baseSha).toBe(mockContext.payload.pull_request.base.sha)
    expect(execCtx.changeRequestId).toBe(mockContext.payload.pull_request.number)
  })

  test('正常 PR 事件：getRepoFileTree/analyzeDependencies 收到的 ref/headSha 等于 execCtx.headSha 也等于 context.payload.pull_request.head.sha', async () => {
    const execCtx = createGitHubExecutionContext()
    expect(execCtx.headSha).toBe('head-sha-0001') // 前置确认 fixture 搭建正确

    await codeReview(
      execCtx,
      makeBot('[TRIAGE]: APPROVED\nLGTM'),
      makeBot(),
      makeOptions(),
      new Prompts('', '')
    )

    expect(repoTreeState.getRepoFileTree).toHaveBeenCalledTimes(1)
    const [ref, project] = repoTreeState.getRepoFileTree.mock.calls[0] as any[]
    expect(ref).toBe(execCtx.headSha)
    expect(ref).toBe(mockContext.payload.pull_request.head.sha)
    expect(project).toEqual({platform: 'github', owner: 'octo', repo: 'demo'})

    expect(dependencyAnalyzerState.analyzeDependencies).toHaveBeenCalledTimes(1)
    const depArgs = dependencyAnalyzerState.analyzeDependencies.mock.calls[0] as any[]
    const headShaArgPosition = 5 // (filesAndChanges, repoFiles, options, concurrencyLimit, project, headSha, patchScans)
    expect(depArgs[headShaArgPosition]).toBe(execCtx.headSha)
    expect(depArgs[headShaArgPosition]).toBe(mockContext.payload.pull_request.head.sha)
  })

  test('execCtx.headSha 为空（评论触发场景）时，回退到 context.payload.pull_request.head.sha，不传出空字符串', async () => {
    // 模拟评论触发命令场景：execCtx 来自评论事件（GitHub 工厂对 comment 事件固定
    // 返回空字符串 headSha，见 github-execution-context.ts），但 codeReview 内部
    // 的 context 仍然是完整的 PR 事件 payload（fromCommand 场景下 review.ts 会
    // 自行通过 octokit 补齐 context.payload.pull_request，这里直接构造等价结果）。
    const commentExecCtx: any = {
      platform: 'github',
      projectPath: 'octo/demo',
      projectId: 'octo/demo',
      changeRequestId: 42,
      eventKind: 'comment_created',
      actor: {login: 'alice', isBot: false},
      baseSha: '',
      headSha: '', // 关键：评论事件的 execCtx 天生没有 headSha
      comment: {kind: 'top_level', id: 1},
      raw: {}
    }
    expect(commentExecCtx.headSha).toBe('')

    await codeReview(
      commentExecCtx,
      makeBot('[TRIAGE]: APPROVED\nLGTM'),
      makeBot(),
      makeOptions(),
      new Prompts('', ''),
      {source: 'command', mode: 'incremental'}
    )

    expect(repoTreeState.getRepoFileTree).toHaveBeenCalledTimes(1)
    const [ref] = repoTreeState.getRepoFileTree.mock.calls[0] as any[]
    // 空字符串是 falsy，|| 回退到 context 的值，不会把空字符串传给下游
    expect(ref).toBe('head-sha-0001')
    expect(ref).toBe(mockContext.payload.pull_request.head.sha)
    expect(ref).not.toBe('')

    const depArgs = dependencyAnalyzerState.analyzeDependencies.mock.calls[0] as any[]
    expect(depArgs[5]).toBe('head-sha-0001')
  })

  // ─── DEP-004: 文件树截断的降级提示 ─────────────────────────────────────────

  describe('DEP-004: 文件树被截断时状态消息里必须有降级提示', () => {
    const runReview = async (): Promise<string> => {
      await codeReview(
        createGitHubExecutionContext(),
        makeBot('[TRIAGE]: APPROVED\nLGTM'),
        makeBot(),
        makeOptions(),
        new Prompts('', '')
      )
      // addInProgressStatus(existingBody, statusMsg) 的第二参就是状态消息
      const calls = commenterState.addInProgressStatus.mock.calls as any[]
      expect(calls.length).toBeGreaterThan(0)
      return calls[0][1] as string
    }

    test('truncated=true → statusMsg 含降级提示', async () => {
      repoTreeState.getRepoFileTree.mockResolvedValue({files: ['src/foo.ts'], truncated: true})
      expect(await runReview()).toContain('> tree-truncated')
    })

    test('truncated=false → statusMsg 不含降级提示', async () => {
      repoTreeState.getRepoFileTree.mockResolvedValue({files: ['src/foo.ts'], truncated: false})
      expect(await runReview()).not.toContain('> tree-truncated')
    })

    test('截断状态与目录回填器一起传给 analyzeDependencies（第 9 个参数）', async () => {
      repoTreeState.getRepoFileTree.mockResolvedValue({files: ['src/foo.ts'], truncated: true})
      await runReview()
      const depArgs = dependencyAnalyzerState.analyzeDependencies.mock.calls[0] as any[]
      expect(depArgs[8].truncated).toBe(true)
      // 截断时必须给出回填能力，否则第三层等于没接上
      expect(typeof depArgs[8].dirLister.listDirectory).toBe('function')
    })

    test('未截断时不传目录回填器（不为正常仓库付额外 API）', async () => {
      repoTreeState.getRepoFileTree.mockResolvedValue({files: ['src/foo.ts'], truncated: false})
      await runReview()
      const depArgs = dependencyAnalyzerState.analyzeDependencies.mock.calls[0] as any[]
      expect(depArgs[8]).toEqual({truncated: false, dirLister: undefined})
    })

    test('依赖分析本身抛错时，截断提示仍然出现（不因分析失败而丢信号）', async () => {
      repoTreeState.getRepoFileTree.mockResolvedValue({files: ['src/foo.ts'], truncated: true})
      dependencyAnalyzerState.analyzeDependencies.mockRejectedValue(new Error('boom'))
      expect(await runReview()).toContain('> tree-truncated')
    })
  })
})
