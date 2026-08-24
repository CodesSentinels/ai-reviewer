/**
 * github-only-feature-matrix.test.ts — GitHub-only 全功能矩阵（TEST-016/017）
 *
 * TEST-016/017 要的是「无任何 GitLab 配置 / GitLab API 不可达时，GitHub **全功能**
 * 通过」。既有的 `github-only.integration.test.ts` 只覆盖了自动审查和 `help`
 * 命令——其余能力（行级评论、release notes、状态 marker、其他命令、对话回复）
 * 虽然各自都有测试，却**从未与 GitLab 故障注入组合运行**。
 *
 * 组合才是这两条的重点：单独看每个功能都是好的，但只要有一处在初始化阶段碰了
 * GitLab（读环境变量、构造 client、import SDK），GitHub-only 部署就会在那个功能
 * 上失败，而分开跑的测试一个都发现不了。
 *
 * 所以这里把功能套件参数化，在两种条件下各跑一遍：
 *
 *   absent      —— 清空全部 GITLAB_ 与 CI_ 前缀变量（TEST-016）
 *   unreachable —— 变量存在，但 @gitbeaker 一旦被 import 就抛（TEST-017）
 *
 * 每轮结束都断言 gitbeaker 从未被加载——那是「真的没碰 GitLab」最直接的证据。
 */
import {describe, expect, test, jest, beforeEach, afterEach} from '@jest/globals'

jest.mock('../src/tokenizer', () => ({getTokenCount: () => 10}))
jest.mock('../src/platform/logger', () => ({
  getLogger: () => ({info: jest.fn(), warning: jest.fn(), error: jest.fn(), debug: jest.fn()})
}))

// ─── GitHub 出口 ─────────────────────────────────────────────────────────────
const octokitState: any = {
  pulls: {
    get: jest.fn<any>(),
    listCommits: jest.fn<any>(),
    listReviewComments: jest.fn<any>(),
    listReviews: jest.fn<any>(),
    createReview: jest.fn<any>(),
    submitReview: jest.fn<any>(),
    createReviewComment: jest.fn<any>(),
    createReplyForReviewComment: jest.fn<any>(),
    deletePendingReview: jest.fn<any>(),
    deleteReviewComment: jest.fn<any>(),
    updateReviewComment: jest.fn<any>(),
    update: jest.fn<any>()
  },
  issues: {
    listComments: jest.fn<any>(),
    createComment: jest.fn<any>(),
    updateComment: jest.fn<any>(),
    deleteComment: jest.fn<any>()
  },
  repos: {
    compareCommits: jest.fn<any>(),
    getContent: jest.fn<any>(),
    getCollaboratorPermissionLevel: jest.fn<any>()
  },
  git: {getTree: jest.fn<any>()},
  users: {getAuthenticated: jest.fn<any>()},
  graphql: jest.fn<any>(),
  reactions: {
    createForIssueComment: jest.fn<any>(),
    createForPullRequestReviewComment: jest.fn<any>()
  }
}
jest.mock('../src/octokit', () => ({octokit: octokitState}))

/** GitLab SDK 一旦被 import 就抛——等价于「GitLab 完全不可达」的最坏情况 */
const gitbeakerLoads = {count: 0}
jest.mock('@gitbeaker/rest', () => {
  gitbeakerLoads.count++
  throw new Error('GitLab API unreachable — @gitbeaker must not be loaded on the GitHub path')
})

import {codeReview} from '../src/review'
import {_resetBotIdentity, initBotGreeting} from '../src/commenter'
import {_resetBotLoginCache} from '../src/github/review-thread'
import {_resetWriteQueues} from '../src/description-state'
import {dispatchCommentEvent} from '../src/commands/dispatcher'
import {_resetBootstrap, bootstrapCommands} from '../src/commands/bootstrap'
import {_resetPermissionCache} from '../src/commands/permission'
import {_resetRateLimit} from '../src/commands/rate-limit'
import {handleIssueConversation} from '../src/conversation'
import {GitHubPlatform} from '../src/platform/github-platform'
import {setPlatform, resetPlatform} from '../src/platform/git-platform'
import {setExecCtx} from '../src/platform/run-context'
import {setStateNamespace} from '../src/platform/state-namespace'
import {stripWriteMarkers} from '../src/platform/write-marker'
import type {ExecutionContext} from '../src/platform/execution-context'

const BASE = 'b'.repeat(40)
const HEAD = 'h'.repeat(40)
const BOT = 'ai-reviewer[bot]'

/** 两种故障条件 */
type Condition = 'absent' | 'unreachable'

const GITLAB_ENV_KEYS = [
  'GITLAB_PAT',
  'GITLAB_HOST',
  'GITLAB_BOT_USERNAME',
  'CI_SERVER_URL',
  'CI_JOB_TOKEN',
  'CI_PROJECT_URL',
  'CI_PIPELINE_SOURCE',
  'CI_COMMIT_SHA',
  'TRIGGER_PAYLOAD',
  'AI_REVIEWER_GITLAB_TIMEOUT_MS'
]

const savedEnv: Record<string, string | undefined> = {}

function applyCondition(condition: Condition): void {
  for (const key of GITLAB_ENV_KEYS) {
    if (!(key in savedEnv)) savedEnv[key] = process.env[key]
    delete process.env[key]
  }
  if (condition === 'unreachable') {
    // 变量齐全但实例打不通：SDK 一旦被加载就抛（见上方 @gitbeaker mock）
    process.env.GITLAB_PAT = 'glpat-unreachable'
    process.env.CI_SERVER_URL = 'https://gitlab.invalid'
    process.env.CI_JOB_TOKEN = 'job-token'
  }
}

const taggedPrompts: any = {
  renderSummarizeFileDiff: () => 'PROMPT_FILE_SUMMARY',
  renderSummarizeChangesets: () => 'PROMPT_MERGE',
  renderSummarize: () => 'PROMPT_FINAL_SUMMARY',
  renderSummarizeReleaseNotes: () => 'PROMPT_RELEASE_NOTES',
  renderSummarizeShort: () => 'PROMPT_SHORT',
  renderReviewFileDiff: () => 'PROMPT_REVIEW ---new_hunk---',
  // conversation.ts 既读 render* 也读原始模板串（用来数 $file_diff 出现次数）
  comment: '$file_diff',
  commentIssue: '$file_diff',
  renderCommentIssue: () => 'PROMPT_CONVERSATION',
  renderComment: () => 'PROMPT_CONVERSATION'
}

function makeBot(): any {
  return {
    chat: jest.fn<any>(async (prompt: string) => {
      const p = String(prompt)
      if (p === 'PROMPT_RELEASE_NOTES') return ['- 新增了两个常量', {}, []]
      if (p === 'PROMPT_FINAL_SUMMARY') return ['本次改动新增了两个导出常量。', {}, []]
      if (p === 'PROMPT_CONVERSATION') return ['这是对话回复。', {}, []]
      if (p.includes('---new_hunk---')) return ['2-2:\n 这里应该用 const 断言。\n---\n', {}, []]
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
    enableWebSearch: true,
    enableShell: false,
    enableLintTools: false,
    enableDependencyAnalysis: false,
    lintReportPath: '',
    botIcon: '🤖',
    botName: 'CodeSentinel',
    botLogin: BOT,
    maxReviewComments: 20,
    commandAckReaction: 'eyes',
    language: 'zh-CN',
    lightTokenLimits: limits,
    heavyTokenLimits: limits,
    ...over
  }
}

interface Captured {
  notes: string[]
  description: string
  findings: Array<{path: string; line: number}>
}

function wire(out: Captured): void {
  let nextId = 1000
  octokitState.pulls.get.mockImplementation(async () => ({
    data: {
      number: 1,
      title: 'PR 标题',
      body: out.description,
      state: 'open',
      base: {sha: BASE, ref: 'main'},
      head: {sha: HEAD, ref: 'feature'},
      user: {login: 'alice'}
    }
  }))
  octokitState.pulls.update.mockImplementation(async (p: any) => {
    out.description = String(p.body)
    return {data: {}}
  })
  octokitState.repos.compareCommits.mockResolvedValue({
    data: {
      files: [
        {
          filename: 'src/a.ts',
          status: 'modified',
          patch: '@@ -1,3 +1,4 @@\n const a = 1\n+const b = 2\n const c = 3\n'
        }
      ],
      commits: [{sha: HEAD}]
    }
  })
  octokitState.repos.getContent.mockResolvedValue({
    data: {content: Buffer.from('const a = 1\nconst c = 3\n').toString('base64')}
  })
  octokitState.git.getTree.mockResolvedValue({data: {tree: [], truncated: false}})
  octokitState.pulls.listCommits.mockImplementation(async (p: any) =>
    Number(p.page ?? 1) === 1 ? {data: [{sha: HEAD}]} : {data: []}
  )
  octokitState.pulls.listReviewComments.mockResolvedValue({data: []})
  octokitState.pulls.listReviews.mockResolvedValue({data: []})
  octokitState.issues.listComments.mockResolvedValue({data: []})
  octokitState.users.getAuthenticated.mockResolvedValue({data: {login: BOT}})
  octokitState.repos.getCollaboratorPermissionLevel.mockResolvedValue({data: {permission: 'write'}})
  octokitState.pulls.deletePendingReview.mockResolvedValue({data: {}})
  octokitState.reactions.createForIssueComment.mockResolvedValue({data: {}})
  octokitState.graphql.mockResolvedValue({
    repository: {
      pullRequest: {reviewThreads: {nodes: [], pageInfo: {hasNextPage: false, endCursor: null}}}
    }
  })
  octokitState.issues.createComment.mockImplementation(async (p: any) => {
    out.notes.push(stripWriteMarkers(String(p.body)))
    return {data: {id: nextId++, body: String(p.body), user: {login: BOT}}}
  })
  octokitState.issues.updateComment.mockImplementation(async (p: any) => {
    out.notes.push(stripWriteMarkers(String(p.body)))
    return {data: {}}
  })
  octokitState.pulls.createReview.mockImplementation(async (p: any) => {
    for (const c of (p.comments ?? []) as any[]) out.findings.push({path: c.path, line: c.line})
    return {data: {id: 9000}}
  })
  octokitState.pulls.submitReview.mockResolvedValue({data: {}})
  octokitState.pulls.createReplyForReviewComment.mockImplementation(async (p: any) => {
    out.notes.push(stripWriteMarkers(String(p.body)))
    return {data: {id: nextId++, body: String(p.body), user: {login: BOT}}}
  })
}

function prepare(condition: Condition, initialDescription = '用户自己写的描述'): Captured {
  jest.clearAllMocks()
  gitbeakerLoads.count = 0
  resetPlatform()
  _resetBotIdentity()
  _resetBotLoginCache()
  _resetWriteQueues()
  _resetBootstrap()
  _resetPermissionCache()
  _resetRateLimit()
  applyCondition(condition)
  setStateNamespace('github')
  setPlatform(new GitHubPlatform())
  initBotGreeting('🤖', 'CodeSentinel', BOT)
  bootstrapCommands()

  const out: Captured = {notes: [], description: initialDescription, findings: []}
  wire(out)
  return out
}

function ctx(over: Record<string, any> = {}): ExecutionContext {
  const c: any = {
    platform: 'github',
    projectPath: 'octo/demo',
    projectId: 'octo/demo',
    changeRequestId: 1,
    eventKind: 'pr_opened',
    actor: {login: 'alice', isBot: false},
    baseSha: BASE,
    headSha: HEAD,
    raw: {},
    ...over
  }
  setExecCtx(c)
  return c
}

async function runCommand(command: string, out: Captured): Promise<void> {
  await dispatchCommentEvent({
    execCtx: ctx({
      eventKind: 'comment_created',
      comment: {kind: 'top_level', id: 4242, body: `@ai-reviewer ${command}`}
    }),
    options: makeOptions(),
    triggerReview: async () => {
      await codeReview(ctx(), makeBot(), makeBot(), makeOptions(), taggedPrompts, {
        mode: 'full',
        source: 'command'
      })
    }
  })
  void out
}

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  for (const k of Object.keys(savedEnv)) delete savedEnv[k]
})

const CONDITIONS: Condition[] = ['absent', 'unreachable']

describe.each(CONDITIONS)('GitLab %s：GitHub 全功能矩阵（TEST-016/017）', condition => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('自动审查：发布摘要评论', async () => {
    const out = prepare(condition)
    await codeReview(ctx(), makeBot(), makeBot(), makeOptions(), taggedPrompts)

    expect(out.notes.some(n => n.includes('本次改动新增了两个导出常量'))).toBe(true)
    expect(gitbeakerLoads.count).toBe(0)
  })

  test('行级评论：经 createReview 落到正确位置', async () => {
    const out = prepare(condition)
    await codeReview(ctx(), makeBot(), makeBot(), makeOptions(), taggedPrompts)

    expect(out.findings).toEqual([{path: 'src/a.ts', line: 2}])
    expect(gitbeakerLoads.count).toBe(0)
  })

  test('release notes：写进 description 且保留用户原文', async () => {
    const out = prepare(condition)
    await codeReview(ctx(), makeBot(), makeBot(), makeOptions(), taggedPrompts)

    expect(out.description).toContain('新增了两个常量')
    expect(out.description).toContain('用户自己写的描述')
    expect(gitbeakerLoads.count).toBe(0)
  })

  test('状态 marker：reviewed SHA 写进摘要评论', async () => {
    const out = prepare(condition)
    await codeReview(ctx(), makeBot(), makeBot(), makeOptions(), taggedPrompts)

    expect(out.notes.some(n => n.includes('ai-reviewer:github:commit-ids-reviewed-start'))).toBe(
      true
    )
    expect(gitbeakerLoads.count).toBe(0)
  })

  test('Web search 开启不影响链路', async () => {
    const out = prepare(condition)
    await codeReview(
      ctx(),
      makeBot(),
      makeBot(),
      makeOptions({enableWebSearch: true}),
      taggedPrompts
    )

    expect(out.notes.length).toBeGreaterThan(0)
    expect(gitbeakerLoads.count).toBe(0)
  })

  test.each(['help', 'configuration', 'pause', 'resume', 'summary', 'full review', 'resolve'])(
    '命令 %s：正常回复',
    async command => {
      const out = prepare(condition)
      await runCommand(command, out)

      expect(out.notes.length).toBeGreaterThan(0)
      expect(gitbeakerLoads.count).toBe(0)
    }
  )

  test('pause/resume：状态 marker 真的写进 description', async () => {
    const out = prepare(condition)
    await runCommand('pause', out)

    expect(out.description).toContain('ai-reviewer:github:review-state-start')
    expect(out.description).toContain('state: paused')
    expect(gitbeakerLoads.count).toBe(0)
  })

  test('对话回复：@bot 追问得到回复', async () => {
    const out = prepare(condition)
    const conversationCtx = ctx({
      eventKind: 'comment_created',
      comment: {kind: 'top_level', id: 5001, body: '@ai-reviewer 这段为什么这样写？'}
    })

    await handleIssueConversation(conversationCtx, makeBot(), makeOptions(), taggedPrompts)

    expect(out.notes.some(n => n.includes('这是对话回复'))).toBe(true)
    expect(gitbeakerLoads.count).toBe(0)
  })
})

describe('两种条件产生相同结果（故障注入没有改变 GitHub 行为）', () => {
  test('absent 与 unreachable 的审查产物一致', async () => {
    const a = prepare('absent')
    await codeReview(ctx(), makeBot(), makeBot(), makeOptions(), taggedPrompts)
    const absentNotes = [...a.notes]
    const absentFindings = [...a.findings]
    const absentDescription = a.description

    const u = prepare('unreachable')
    await codeReview(ctx(), makeBot(), makeBot(), makeOptions(), taggedPrompts)

    expect(u.notes).toEqual(absentNotes)
    expect(u.findings).toEqual(absentFindings)
    expect(u.description).toBe(absentDescription)
  })
})
