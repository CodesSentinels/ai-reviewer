/**
 * execution-context.integration.test.ts — main.ts → ExecutionContext →
 * codeReview()/handleCommentEvent() 全链路集成测试（I1）
 *
 * 阶段零/二的既有测试都在链路的某一层做了 mock 隔断：
 *   - main.characterization.test.ts：codeReview/handleCommentEvent 被 mock，
 *     只验证 main.ts 的分发逻辑本身。
 *   - review-execctx-consistency.test.ts（U5）：直接调用 codeReview()，
 *     不经过 main.ts 的事件分发。
 *   - command-dispatcher.test.ts：triggerReview 被 mock，不真正跑 codeReview。
 *   - command-handler.test.ts（U4）：dispatchCommentEvent/codeReview 被 mock。
 *
 * 本文件是唯一一处让 main.ts（真实 run()）→ createGitHubExecutionContext
 * （真实）→ command-handler/dispatcher（真实）→ codeReview（真实）全部串联、
 * 只在最外层 I/O 边界（octokit/Bot/Commenter/文件系统）打桩的测试，验证这条
 * "从 GitHub 事件到实际业务逻辑"的链路没有断点。
 *
 * 覆盖 I1 要求的 pull_request（自动审查）+ issue_comment（命令分发）两类事件；
 * pull_request_review_comment 与 issue_comment 在 dispatcher.ts 里走几乎相同
 * 的代码路径（差异只在如何取 PR number/comment），且已被 command-dispatcher.
 * test.ts 和 main.characterization.test.ts 分别独立验证过，本文件不重复第三个
 * 全链路场景，是刻意的范围取舍。
 *
 * 参考 docs/tasks/execution-context-design.md 第 9.3 节 I1。
 */
import {describe, expect, test, jest, beforeEach} from '@jest/globals'

const coreState = {
  getBooleanInput: jest.fn<(name: string) => boolean>(),
  getMultilineInput: jest.fn<(...a: any[]) => string[]>().mockReturnValue([]),
  info: jest.fn(),
  warning: jest.fn(),
  error: jest.fn(),
  setFailed: jest.fn()
}
// 数值型 input 必须给合法字符串——main.ts 把 getInput() 的结果直接传给 Options
// 构造函数，空字符串会被 parseInt/parseFloat 成 NaN，导致 codeReview 内部的
// maxFiles/token 预算判断全部失效（体现为"一个文件都不处理"）。
const NUMERIC_INPUT_DEFAULTS: Record<string, string> = {
  max_files: '0',
  openai_model_temperature: '0.0',
  openai_retries: '3',
  openai_timeout_ms: '120000',
  openai_concurrency_limit: '6',
  github_concurrency_limit: '6',
  max_dependency_files: '50',
  max_review_comments: '20',
  debug_resolve_inject_failures: '0'
}
const getInputMock = jest.fn<(name: string) => string>((name: string) => {
  return NUMERIC_INPUT_DEFAULTS[name] ?? ''
})
jest.mock('@actions/core', () => ({
  getInput: (...a: any[]) => getInputMock(...(a as [string])),
  getBooleanInput: (...a: any[]) => coreState.getBooleanInput(...(a as [string])),
  getMultilineInput: (...a: any[]) => coreState.getMultilineInput(...a),
  info: (...a: any[]) => coreState.info(...a),
  warning: (...a: any[]) => coreState.warning(...a),
  error: (...a: any[]) => coreState.error(...a),
  setFailed: (...a: any[]) => coreState.setFailed(...a)
}))

const mockContext: any = {
  eventName: '',
  actor: 'someone',
  payload: {},
  repo: {owner: 'octo', repo: 'demo'}
}
jest.mock('@actions/github', () => ({context: mockContext}))

// main.ts 是 `new Bot(...)`（非 type-only），必须 mock 掉，否则会因缺少
// OPENAI_API_KEY 在 createBots() 内部抛错，导致后续分支永远走不到。
const botState = {chat: jest.fn<() => Promise<[string, Record<string, unknown>, unknown[]]>>()}
jest.mock('../src/bot', () => ({
  Bot: jest.fn().mockImplementation(() => ({chat: (...a: any[]) => botState.chat(...(a as []))})),
  OpenAIOptions: jest.fn()
}))

const octokitState = {
  compareCommits: jest.fn<(...a: any[]) => Promise<any>>(),
  getContent: jest.fn<(...a: any[]) => Promise<any>>(),
  pullsGet: jest.fn<(...a: any[]) => Promise<any>>(),
  getCollaboratorPermissionLevel: jest.fn<(...a: any[]) => Promise<any>>(),
  listComments: jest.fn<(...a: any[]) => Promise<any>>(),
  createComment: jest.fn<(...a: any[]) => Promise<any>>(),
  updateComment: jest.fn<(...a: any[]) => Promise<any>>(),
  createReactionForIssueComment: jest.fn<(...a: any[]) => Promise<any>>(),
  createReactionForPRComment: jest.fn<(...a: any[]) => Promise<any>>()
}
jest.mock('../src/octokit', () => ({
  octokit: {
    repos: {
      compareCommits: (...a: any[]) => octokitState.compareCommits(...a),
      getCollaboratorPermissionLevel: (...a: any[]) =>
        octokitState.getCollaboratorPermissionLevel(...a)
    },
    pulls: {
      get: (...a: any[]) => octokitState.pullsGet(...a)
    },
    issues: {
      listComments: (...a: any[]) => octokitState.listComments(...a),
      createComment: (...a: any[]) => octokitState.createComment(...a),
      updateComment: (...a: any[]) => octokitState.updateComment(...a)
    },
    reactions: {
      createForIssueComment: (...a: any[]) =>
        octokitState.createReactionForIssueComment(...a),
      createForPullRequestReviewComment: (...a: any[]) =>
        octokitState.createReactionForPRComment(...a)
    }
  }
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
  listReviewComments: jest.fn<() => Promise<any[]>>().mockResolvedValue([])
}
jest.mock('../src/commenter', () => ({
  Commenter: jest.fn().mockImplementation(() => commenterState),
  COMMENT_TAG: '<!-- bot-comment -->',
  COMMENT_REPLY_TAG: '<!-- bot-reply -->',
  RAW_SUMMARY_START_TAG: '<!-- raw-summary-start -->',
  RAW_SUMMARY_END_TAG: '<!-- raw-summary-end -->',
  SHORT_SUMMARY_START_TAG: '<!-- short-summary-start -->',
  SHORT_SUMMARY_END_TAG: '<!-- short-summary-end -->',
  SUMMARIZE_TAG: '<!-- summarize -->'
}))

jest.mock('../src/tokenizer', () => ({getTokenCount: () => 0}))
jest.mock('../src/github/review-thread', () => ({
  fetchThreadStatusMap: jest.fn<() => Promise<Map<string, boolean>>>().mockResolvedValue(new Map())
}))

function makePullRequestPayload(overrides: Record<string, any> = {}): any {
  return {
    number: 42,
    title: 'Integration test PR',
    body: 'body',
    base: {sha: 'base-sha-0001'},
    head: {sha: 'head-sha-0001'},
    ...overrides
  }
}

describe('I1: main.ts → ExecutionContext → codeReview/handleCommentEvent 全链路', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.GITHUB_EVENT_NAME
    coreState.getBooleanInput.mockReturnValue(false)
    coreState.getMultilineInput.mockReturnValue([])
    getInputMock.mockImplementation((name: string) => NUMERIC_INPUT_DEFAULTS[name] ?? '')
    botState.chat.mockResolvedValue(['[TRIAGE]: APPROVED\nLGTM', {}, []])

    mockContext.actor = 'someone'
    mockContext.payload = {}

    commenterState.getDescription.mockImplementation((body: string) => body ?? '')
    commenterState.findCommentWithTag.mockResolvedValue(null)
    commenterState.getAllCommitIds.mockResolvedValue([])
    commenterState.addInProgressStatus.mockReturnValue('IN_PROGRESS')
    commenterState.addReviewedCommitId.mockReturnValue('<!-- reviewed-commit-ids -->')

    octokitState.compareCommits.mockResolvedValue({
      data: {
        files: [
          {
            filename: 'src/foo.ts',
            status: 'modified',
            patch: '@@ -1,3 +1,4 @@\n line1\n line2\n+added line\n line3'
          }
        ],
        commits: [{sha: 'head-sha-0001'}]
      }
    })
    octokitState.getContent.mockResolvedValue({
      data: {type: 'file', content: Buffer.from('line1\nline2\nline3').toString('base64')}
    })
  })

  async function runMain(): Promise<void> {
    jest.resetModules()
    await import('../src/main')
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))
  }

  test('pull_request(opened) → 真实 codeReview 跑完全流程，最终发布带 SUMMARIZE_TAG 的摘要评论', async () => {
    process.env.GITHUB_EVENT_NAME = 'pull_request'
    mockContext.eventName = 'pull_request'
    mockContext.payload = {action: 'opened', pull_request: makePullRequestPayload()}

    await runMain()

    // in-progress 状态 + 最终摘要，两次 comment 调用，均带 SUMMARIZE_TAG + replace
    expect(commenterState.comment).toHaveBeenCalledTimes(2)
    for (const call of commenterState.comment.mock.calls) {
      expect(call[1]).toBe('<!-- summarize -->')
      expect(call[2]).toBe('replace')
    }
    // 证明真的走到了 diff 获取这一步（而不是在事件分发层就被吞掉）
    expect(octokitState.compareCommits).toHaveBeenCalled()
    expect(coreState.setFailed).not.toHaveBeenCalled()
  })

  test('issue_comment("@ai-reviewer help") → 真实 dispatcher 路由到 help handler，通过 octokit 发布回复', async () => {
    process.env.GITHUB_EVENT_NAME = 'issue_comment'
    mockContext.eventName = 'issue_comment'
    mockContext.payload = {
      action: 'created',
      issue: {number: 42, pull_request: {}},
      comment: {
        id: 9001,
        body: '@ai-reviewer help',
        user: {login: 'alice', type: 'User'}
      }
    }
    octokitState.getCollaboratorPermissionLevel.mockResolvedValue({
      data: {permission: 'read'} // help 命令只需 Reporter/read 级别权限
    })
    octokitState.listComments.mockResolvedValue({data: []})
    octokitState.createComment.mockResolvedValue({data: {id: 5555}})
    octokitState.createReactionForIssueComment.mockResolvedValue({data: {id: 1}})

    await runMain()

    // help 命令走顶层 issue comment 回复（issues.createComment），不需要 codeReview/Bot
    expect(octokitState.createComment).toHaveBeenCalled()
    const [callArgs] = octokitState.createComment.mock.calls[0] as any[]
    expect(callArgs.owner).toBe('octo')
    expect(callArgs.repo).toBe('demo')
    expect(callArgs.issue_number).toBe(42)
    expect(coreState.setFailed).not.toHaveBeenCalled()
    // help 命令不需要模型，Bot 不应被调用
    expect(botState.chat).not.toHaveBeenCalled()
  })
})
