/**
 * review.characterization.test.ts — 改造前特征化测试（阶段零 · C2）
 *
 * 目的：review.ts（40 处直接引用 `@actions/github` context，ExecutionContext
 * 改造范围内风险最高的文件）当前零单元测试覆盖。本测试钉死改造前
 * codeReview() 的控制流行为基线——重点是 context.payload 驱动的
 * SHA/事件判断逻辑，而不是 AI 审查内容本身（模型响应用固定 mock 打桩）。
 *
 * 改造后（review.ts 消费 execCtx 首参数）须原样重跑本文件全部用例，
 * 断言须保持一致（9.2 节 U5）。参考 docs/tasks/execution-context-design.md 第 9.0 节。
 */
import {describe, expect, test, jest, beforeEach} from '@jest/globals'

// --- mocks（复用 __tests__/command-dispatcher.test.ts 的既有约定） ---

jest.mock('@actions/core', () => ({
  getInput: jest.fn().mockReturnValue(''),
  info: jest.fn(),
  warning: jest.fn(),
  error: jest.fn()
}))

const mockContext: any = {
  eventName: 'pull_request',
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
jest.mock('../../src/platform/git-platform', () => ({
  getPlatform: () => platformState
}))
jest.mock('../../src/platform/logger', () => ({
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
jest.mock('../../src/commenter', () => ({
  Commenter: jest.fn().mockImplementation(() => commenterState),
  getCommentGreeting: () => '🤖 AI Reviewer',
  initBotGreeting: jest.fn(),
  commentTag: () => '<!-- bot-comment -->',
  commentReplyTag: () => '<!-- bot-reply -->',
  rawSummaryStartTag: () => '<!-- raw-summary-start -->',
  rawSummaryEndTag: () => '<!-- raw-summary-end -->',
  shortSummaryStartTag: () => '<!-- short-summary-start -->',
  shortSummaryEndTag: () => '<!-- short-summary-end -->',
  summarizeTag: () => '<!-- summarize -->'
}))

jest.mock('../../src/tokenizer', () => ({getTokenCount: () => 0}))

jest.mock('../../src/github/review-thread', () => ({
  fetchThreadStatusMap: jest.fn<() => Promise<Map<string, boolean>>>().mockResolvedValue(new Map())
}))

import {codeReview} from '../../src/review'
import {Options} from '../../src/options'
import {Prompts} from '../../src/prompts'

const IGNORE_KEYWORD = '@ai-reviewer: ignore'

function makeOptions(overrides: Partial<{disableReleaseNotes: boolean}> = {}): Options {
  return new Options(
    false, // debug
    false, // disableReview
    overrides.disableReleaseNotes ?? true, // disableReleaseNotes（简化深场景：默认跳过 release notes 分支）
    '0', // maxFiles
    false, // reviewSimpleChanges（false 才会解析 [TRIAGE] 分类标签）
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
    false, // enableDependencyAnalysis（关闭，避免额外 mock repo-tree/dependency-analyzer）
    '50',
    true,
    true,
    false // enableLintTools（关闭，避免额外 mock lint 子系统）
  )
}

function makeBot(response = 'ok'): any {
  return {
    chat: jest
      .fn<() => Promise<[string, Record<string, unknown>, unknown[]]>>()
      .mockResolvedValue([response, {}, []])
  }
}

/**
 * codeReview() 的 execCtx 首参（T7，2026-07-23 新增）。review.ts 内部仍是
 * 双轨过渡态——除 enableDependencyAnalysis 分支（本文件测试全部关闭）外，
 * 现有 40 处调用点继续读取模块级 context/repo，不读取本参数，因此这里的
 * 字段取值不影响下方任何既有断言，只需满足类型签名。
 */
function makeExecCtx(overrides: Partial<Record<string, any>> = {}): any {
  return {
    platform: 'github',
    projectPath: 'octo/demo',
    projectId: 'octo/demo',
    changeRequestId: 42,
    eventKind: 'pr_opened',
    actor: {login: 'someone', isBot: false},
    baseSha: 'base-sha-0001',
    headSha: 'head-sha-0001',
    raw: {},
    ...overrides
  }
}

/**
 * ARCH-005：PR 详情不再来自 context.payload.pull_request，而是
 * IGitPlatform.getChangeRequest()。这里直接构造它的返回形状。
 */
function setChangeRequest(overrides: Record<string, any> = {}): void {
  platformState.getChangeRequest.mockResolvedValue({
    number: 42,
    title: 'Add characterization test fixtures',
    body: 'This PR adds baseline fixtures.',
    state: 'open',
    baseSha: 'base-sha-0001',
    headSha: 'head-sha-0001',
    baseRef: 'main',
    headRef: 'feature',
    author: 'someone',
    ...overrides
  })
}

describe('codeReview() — 改造前控制流行为基线', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    setChangeRequest()
    commenterState.getDescription.mockImplementation((body: string) => body ?? '')
    commenterState.findCommentWithTag.mockResolvedValue(null)
    commenterState.getAllCommitIds.mockResolvedValue([])
    commenterState.addInProgressStatus.mockReturnValue('IN_PROGRESS')
    commenterState.addReviewedCommitId.mockReturnValue('<!-- reviewed-commit-ids -->')
  })

  test('非 PR 类事件（非命令触发）→ 直接跳过，不调用任何 platform API', async () => {
    await codeReview(
      makeExecCtx({eventKind: 'metadata_updated'}),
      makeBot(),
      makeBot(),
      makeOptions(),
      new Prompts('', '')
    )

    expect(platformState.compareDiff).not.toHaveBeenCalled()
    expect(commenterState.comment).not.toHaveBeenCalled()
  })

  test('PR 详情取不到（getChangeRequest 抛错）→ 跳过，不调用后续 platform API', async () => {
    platformState.getChangeRequest.mockRejectedValue(new Error('not found'))

    await codeReview(makeExecCtx(), makeBot(), makeBot(), makeOptions(), new Prompts('', ''))

    expect(platformState.compareDiff).not.toHaveBeenCalled()
    expect(commenterState.comment).not.toHaveBeenCalled()
  })

  test('PR 处于 paused 状态 → 跳过，不查询 diff', async () => {
    setChangeRequest({
      body: '<!-- codesentinel-review-state:start -->\nstate: paused\n<!-- codesentinel-review-state:end -->\nSome description'
    })

    await codeReview(makeExecCtx(), makeBot(), makeBot(), makeOptions(), new Prompts('', ''))

    expect(platformState.compareDiff).not.toHaveBeenCalled()
    expect(commenterState.comment).not.toHaveBeenCalled()
  })

  test('PR 描述含 ignore 关键词 → 跳过，不查询 diff', async () => {
    setChangeRequest({body: `Description. ${IGNORE_KEYWORD}`})
    commenterState.getDescription.mockReturnValue(`Description. ${IGNORE_KEYWORD}`)

    await codeReview(makeExecCtx(), makeBot(), makeBot(), makeOptions(), new Prompts('', ''))

    expect(platformState.compareDiff).not.toHaveBeenCalled()
  })

  test('无增量变更（compareCommits 返回空 files）→ 查询一次 diff 后跳过，不发布评论', async () => {
    platformState.compareDiff.mockResolvedValue({files: [], commits: []})

    await codeReview(makeExecCtx(), makeBot(), makeBot(), makeOptions(), new Prompts('', ''))

    expect(platformState.compareDiff).toHaveBeenCalled()
    expect(commenterState.comment).not.toHaveBeenCalled()
  })

  test('首次审查：incremental 与 targetBranch diff 均从 base sha 起算（历史无 reviewed commit）', async () => {
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

    await codeReview(
      makeExecCtx(),
      makeBot('[TRIAGE]: APPROVED\nAdds a comment line.'),
      makeBot(),
      makeOptions(),
      new Prompts('', '')
    )

    // 首次审查：两次 compareCommits 的 base 均为 PR base sha（不存在历史 reviewed commit）
    expect(platformState.compareDiff).toHaveBeenCalledTimes(2)
    for (const call of platformState.compareDiff.mock.calls) {
      expect(call[0]).toBe('octo') // owner
      expect(call[1]).toBe('demo') // repo
      expect(call[2]).toBe('base-sha-0001') // base
      expect(call[3]).toBe('head-sha-0001') // head
    }

    // in-progress 摘要 + 最终摘要，各发布一次（commenter.comment 共 2 次，均为 summarizeTag() + replace）
    expect(commenterState.comment).toHaveBeenCalledTimes(2)
    for (const call of commenterState.comment.mock.calls) {
      expect(call[1]).toBe('<!-- summarize -->')
      expect(call[2]).toBe('replace')
    }

    // 最终摘要中必须包含隐藏的原始/精简摘要状态标签（供下次增量审查解析）
    const finalCommentBody = commenterState.comment.mock.calls[1][0] as string
    expect(finalCommentBody).toContain('<!-- raw-summary-start -->')
    expect(finalCommentBody).toContain('<!-- short-summary-start -->')

    // APPROVED 分类的文件不进入逐行审查缓冲区
    expect(commenterState.bufferReviewComment).not.toHaveBeenCalled()

    // 审查完成后仍提交一次 submitReview（记录状态消息 + reviewed commit marker）
    expect(commenterState.submitReview).toHaveBeenCalledTimes(1)
    expect(commenterState.submitReview.mock.calls[0][0]).toBe(42)
  })

  test('reviewMode="full" → 忽略历史 reviewed commit，强制从 PR base sha 开始', async () => {
    // 即使存在历史摘要评论和 reviewed commit block，full 模式也必须忽略它们
    commenterState.findCommentWithTag.mockResolvedValue({
      body: 'existing summary body'
    })
    commenterState.getReviewedCommitIdsBlock.mockReturnValue('<!-- reviewed: old-sha -->')
    commenterState.getAllCommitIds.mockResolvedValue(['old-sha', 'head-sha-0001'])
    commenterState.getHighestReviewedCommitId.mockReturnValue('old-sha')
    platformState.compareDiff.mockResolvedValue({files: [], commits: []})

    await codeReview(makeExecCtx(), makeBot(), makeBot(), makeOptions(), new Prompts('', ''), {
      mode: 'full'
    })

    expect(platformState.compareDiff.mock.calls[0][2]).toBe('base-sha-0001') // base（不是 'old-sha'）
  })

  test('增量审查：存在历史 reviewed commit 时，diff 从该 commit 而非 base sha 起算', async () => {
    setChangeRequest({headSha: 'head-sha-0002'})
    commenterState.findCommentWithTag.mockResolvedValue({
      body: 'existing summary body'
    })
    commenterState.getReviewedCommitIdsBlock.mockReturnValue('<!-- reviewed: head-sha-0001 -->')
    commenterState.getAllCommitIds.mockResolvedValue(['head-sha-0001', 'head-sha-0002'])
    commenterState.getHighestReviewedCommitId.mockReturnValue('head-sha-0001')
    platformState.compareDiff.mockResolvedValue({files: [], commits: []})

    await codeReview(makeExecCtx(), makeBot(), makeBot(), makeOptions(), new Prompts('', ''))

    expect(platformState.compareDiff.mock.calls[0][2]).toBe('head-sha-0001') // base：从上次审查的 commit 起，不是 base sha
    expect(platformState.compareDiff.mock.calls[0][3]).toBe('head-sha-0002') // head
  })
})
