/**
 * github-only.integration.test.ts — GitLab 故障注入下的 GitHub 全功能回归（GH-017）
 *
 * github-only.test.ts 把 codeReview / handleCommentEvent 整体 mock 掉了，
 * 只能证明「事件分发不受 GitLab 影响」——那不等于 GH-017 要求的「全功能」。
 *
 * 本文件复用 execution-context.integration.test.ts 的全链路脚手架
 * （真实 main.ts → ExecutionContext → dispatcher → codeReview，只在 octokit /
 * Bot / Commenter 这层 I/O 边界打桩），在此基础上叠加两个条件：
 *
 * 1. 清空全部 GITLAB_* / CI_* / TRIGGER_PAYLOAD 变量
 * 2. `@gitbeaker/rest` 一被加载就抛错（等价于 GitLab 完全不可达的最坏情况）
 *
 * 结论若成立，说明真实的审查链路与命令链路都不经过 GitLab 任何代码。
 */
import {describe, expect, test, jest, beforeEach, afterEach} from '@jest/globals'

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
      createForIssueComment: (...a: any[]) => octokitState.createReactionForIssueComment(...a),
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

// GH-017：GitLab SDK 一旦被加载就抛错，等价于 GitLab 完全不可达
const gitbeakerLoads = {count: 0}
jest.mock('@gitbeaker/rest', () => {
  gitbeakerLoads.count++
  throw new Error('GitLab unreachable — @gitbeaker must not be loaded on the GitHub path')
})

/** 运行期需要清空的 GitLab 相关变量 */
const GITLAB_ENV_KEYS = [
  'GITLAB_PAT',
  'GITLAB_HOST',
  'GITLAB_BOT_USERNAME',
  'CI_SERVER_URL',
  'CI_JOB_TOKEN',
  'CI_PIPELINE_SOURCE',
  'CI_COMMIT_SHA',
  'TRIGGER_PAYLOAD',
  'AI_REVIEWER_GITLAB_TIMEOUT_MS'
]

describe('GH-017: GitLab 不可达时 GitHub 全功能仍然通过', () => {
  const savedEnv: Record<string, string | undefined> = {}

  beforeEach(() => {
    jest.clearAllMocks()
    gitbeakerLoads.count = 0
    delete process.env.GITHUB_EVENT_NAME
    for (const key of GITLAB_ENV_KEYS) {
      savedEnv[key] = process.env[key]
      delete process.env[key]
    }

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

    // ARCH-005：PR 详情统一经 octokit.pulls.get 现查
    octokitState.pullsGet.mockResolvedValue({
      data: {
        number: 42,
        title: 'GitHub-only regression',
        body: 'body',
        state: 'open',
        base: {sha: 'base-sha-0001', ref: 'main'},
        head: {sha: 'head-sha-0001', ref: 'feature'},
        user: {login: 'someone'}
      }
    })

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

  afterEach(() => {
    for (const key of GITLAB_ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key]
      else process.env[key] = savedEnv[key]
    }
  })

  async function runMain(): Promise<void> {
    jest.resetModules()
    await import('../src/main')
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))
  }

  test('自动审查链路：真实 codeReview 跑完，发布摘要评论，全程不加载 GitLab SDK', async () => {
    process.env.GITHUB_EVENT_NAME = 'pull_request'
    mockContext.eventName = 'pull_request'
    mockContext.payload = {
      action: 'opened',
      pull_request: {
        number: 42,
        title: 'Integration test PR',
        body: 'body',
        base: {sha: 'base-sha-0001'},
        head: {sha: 'head-sha-0001'}
      }
    }

    await runMain()

    // 真的走到了取 diff → 调模型 → 发摘要，而不是在分发层就被吞掉
    expect(octokitState.compareCommits).toHaveBeenCalled()
    expect(botState.chat).toHaveBeenCalled()
    expect(commenterState.comment).toHaveBeenCalledTimes(2)
    for (const call of commenterState.comment.mock.calls) {
      expect(call[1]).toBe('<!-- summarize -->')
      expect(call[2]).toBe('replace')
    }
    expect(coreState.setFailed).not.toHaveBeenCalled()
    expect(gitbeakerLoads.count).toBe(0)
  })

  test('命令链路：真实 dispatcher 路由 help 命令并经 octokit 回复，全程不加载 GitLab SDK', async () => {
    process.env.GITHUB_EVENT_NAME = 'issue_comment'
    mockContext.eventName = 'issue_comment'
    mockContext.payload = {
      action: 'created',
      issue: {number: 42, pull_request: {}},
      comment: {id: 9001, body: '@ai-reviewer help', user: {login: 'alice', type: 'User'}}
    }
    octokitState.getCollaboratorPermissionLevel.mockResolvedValue({data: {permission: 'read'}})
    octokitState.listComments.mockResolvedValue({data: []})
    octokitState.createComment.mockResolvedValue({data: {id: 5555}})
    octokitState.createReactionForIssueComment.mockResolvedValue({data: {id: 1}})

    await runMain()

    expect(octokitState.createComment).toHaveBeenCalled()
    const [callArgs] = octokitState.createComment.mock.calls[0] as any[]
    expect(callArgs.owner).toBe('octo')
    expect(callArgs.repo).toBe('demo')
    // 权限查询也走了真实 GitHub adapter
    expect(octokitState.getCollaboratorPermissionLevel).toHaveBeenCalled()
    expect(coreState.setFailed).not.toHaveBeenCalled()
    expect(gitbeakerLoads.count).toBe(0)
  })

  test('GitLab 变量存在但实例不可达时，审查链路结果不变', async () => {
    process.env.GITLAB_PAT = 'glpat-unreachable'
    process.env.CI_SERVER_URL = 'https://gitlab.invalid'
    process.env.GITHUB_EVENT_NAME = 'pull_request'
    mockContext.eventName = 'pull_request'
    mockContext.payload = {
      action: 'opened',
      pull_request: {
        number: 42,
        title: 'PR',
        body: 'body',
        base: {sha: 'base-sha-0001'},
        head: {sha: 'head-sha-0001'}
      }
    }

    await runMain()

    expect(octokitState.compareCommits).toHaveBeenCalled()
    expect(commenterState.comment).toHaveBeenCalledTimes(2)
    expect(coreState.setFailed).not.toHaveBeenCalled()
    expect(gitbeakerLoads.count).toBe(0)
  })
})
