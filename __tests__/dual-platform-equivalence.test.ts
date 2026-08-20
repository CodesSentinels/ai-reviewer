/**
 * dual-platform-equivalence.test.ts — 跨平台语义等价（§14.2 TEST-012~015）
 *
 * §14.2 要的不是「两边都能跑」——那在各章的双平台矩阵里已经验过。它要的是
 * **同一份改动喂进去，两个平台产出的东西在语义上一致**：摘要说的是同一件事，
 * 行级问题落在同一位置说同一句话，命令的业务结果相同。差的只能是平台 URL、
 * ID、作者和展示格式（TEST-015）。
 *
 * ## 为什么必须经过真实 adapter
 *
 * 第一版把 `getPlatform()` 整个 mock 成同一个替身，只换 execCtx.platform 和账号。
 * 那样两次运行是「同一共享核心 + 同一 mock adapter」，只能证明共享核心不因
 * platform 分叉——`GitHubPlatform` 与 `GitLabPlatform` 在 diff 映射、行号计算或
 * 写入结构上真的分歧了，测试照样绿。而那恰恰是双平台最容易出问题的地方。
 *
 * 现在改为：两侧各自注入**平台原生 API 响应**（GitHub 走 octokit 形状，GitLab 走
 * gitbeaker 形状），经各自真实 adapter 归一化后送进同一个共享核心，再比较
 * ① 共享核心的产物 ② adapter 实际发出的写入参数。
 *
 * 归一化器（helpers/semantic-equivalence.ts）是这套判定的单点故障——抹多了什么
 * 都"等价"。所以最后一节专门反向验证：真实的内容差异必须比不过去。
 */
import {describe, expect, test, jest, beforeEach} from '@jest/globals'

import {normalizeForComparison, normalizeFindings} from './helpers/semantic-equivalence'

jest.mock('../src/tokenizer', () => ({getTokenCount: () => 10}))
// 只覆盖 fetchThreadStatusMap（审查流程用来判断旧评论是否已 resolved）。
// 整个模块 mock 掉的话，resolve 命令用到的 getBotLogin/fetchUnresolvedBotThreads/
// batchResolve 全变成 undefined——命令直接抛错，正向用例根本跑不到 adapter。
jest.mock('../src/github/review-thread', () => ({
  ...(jest.requireActual('../src/github/review-thread') as object),
  fetchThreadStatusMap: jest.fn<any>().mockResolvedValue(new Map())
}))
jest.mock('../src/platform/logger', () => ({
  getLogger: () => ({info: jest.fn(), warning: jest.fn(), error: jest.fn(), debug: jest.fn()})
}))

// ─── GitHub 的唯一出口：octokit ──────────────────────────────────────────────
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
  graphql: jest.fn<any>(),
  users: {getAuthenticated: jest.fn<any>()},
  reactions: {
    createForIssueComment: jest.fn<any>(),
    createForPullRequestReviewComment: jest.fn<any>()
  }
}
jest.mock('../src/octokit', () => ({octokit: octokitState}))

// ─── GitLab 的唯一出口：@gitbeaker/rest ─────────────────────────────────────
const gitbeaker: any = {
  MergeRequests: {show: jest.fn<any>(), allCommits: jest.fn<any>(), edit: jest.fn<any>()},
  Repositories: {compare: jest.fn<any>(), allRepositoryTrees: jest.fn<any>()},
  RepositoryFiles: {show: jest.fn<any>()},
  MergeRequestNotes: {
    all: jest.fn<any>(),
    create: jest.fn<any>(),
    edit: jest.fn<any>(),
    remove: jest.fn<any>()
  },
  MergeRequestDiscussions: {
    all: jest.fn<any>(),
    create: jest.fn<any>(),
    addNote: jest.fn<any>(),
    editNote: jest.fn<any>(),
    removeNote: jest.fn<any>(),
    resolve: jest.fn<any>()
  },
  MergeRequestNoteAwardEmojis: {award: jest.fn<any>()},
  ProjectMembers: {show: jest.fn<any>(), all: jest.fn<any>()},
  Users: {all: jest.fn<any>(), showCurrentUser: jest.fn<any>()}
}
jest.mock('@gitbeaker/rest', () => ({Gitlab: jest.fn().mockImplementation(() => gitbeaker)}))

import {codeReview} from '../src/review'
import {_resetBotIdentity, initBotGreeting} from '../src/commenter'
import {_resetBotLoginCache} from '../src/github/review-thread'
import {_resetWriteQueues} from '../src/description-state'
import {dispatchCommentEvent} from '../src/commands/dispatcher'
import {_resetBootstrap, bootstrapCommands} from '../src/commands/bootstrap'
import {_resetPermissionCache} from '../src/commands/permission'
import {_resetRateLimit} from '../src/commands/rate-limit'
import {GitHubPlatform} from '../src/platform/github-platform'
import {GitLabPlatform} from '../src/platform/gitlab-platform'
import {setPlatform, resetPlatform} from '../src/platform/git-platform'
import {setExecCtx} from '../src/platform/run-context'
import {setStateNamespace} from '../src/platform/state-namespace'
import {stateMarker} from '../src/state-markers'
import {stripWriteMarkers} from '../src/platform/write-marker'
import type {ExecutionContext, Platform} from '../src/platform/execution-context'

const BASE = 'b'.repeat(40)
const HEAD = 'h'.repeat(40)

/** 两平台唯一的输入差异：坐标与账号 */
const SHAPE: Record<Platform, {projectPath: string; projectId: string; login: string}> = {
  github: {projectPath: 'octo/demo', projectId: 'octo/demo', login: 'ai-reviewer[bot]'},
  gitlab: {projectPath: 'group/subgroup/demo', projectId: '77', login: 'ai-reviewer'}
}

/**
 * 同一份逻辑改动，两套**平台原生**表示。
 *
 * 这是本文件的关键：不是两边喂同一个已归一化的对象，而是各自喂平台真实会返回的
 * 形状，让两个 adapter 各自去解析。adapter 之间的分歧就是这么暴露出来的。
 */
const LOGICAL_DIFF = [
  {path: 'src/a.ts', patch: '@@ -1,3 +1,4 @@\n const a = 1\n+const b = 2\n const c = 3\n'},
  {path: 'src/b.ts', patch: '@@ -1,2 +1,3 @@\n export const x = 1\n+export const y = 2\n'}
]

const taggedPrompts: any = {
  renderSummarizeFileDiff: () => 'PROMPT_FILE_SUMMARY',
  renderSummarizeChangesets: () => 'PROMPT_MERGE',
  renderSummarize: () => 'PROMPT_FINAL_SUMMARY',
  renderSummarizeReleaseNotes: () => 'PROMPT_RELEASE_NOTES',
  renderSummarizeShort: () => 'PROMPT_SHORT',
  renderReviewFileDiff: () => 'PROMPT_REVIEW ---new_hunk---'
}

/** 确定性模型：两次运行的差异只可能来自平台，不可能来自模型 */
function makeBot(): any {
  return {
    chat: jest.fn<any>(async (prompt: string) => {
      const p = String(prompt)
      if (p === 'PROMPT_RELEASE_NOTES') return ['- 新增了 b 与 y 两个常量', {}, []]
      if (p === 'PROMPT_FINAL_SUMMARY') return ['本次改动新增了两个导出常量。', {}, []]
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
    enableWebSearch: false,
    enableShell: false,
    enableLintTools: false,
    enableDependencyAnalysis: false,
    lintReportPath: '',
    botIcon: '🤖',
    botName: 'CodeSentinel',
    botLogin: '',
    maxReviewComments: 20,
    commandAckReaction: 'eyes',
    language: 'zh-CN',
    lightTokenLimits: limits,
    heavyTokenLimits: limits,
    ...over
  }
}

interface RunOutput {
  /** 顶层评论正文（摘要、进度横幅、命令回复） */
  notes: string[]
  /** PR/MR description 最终内容 */
  description: string
  /** adapter 实际写出的行级评论：位置 + 正文 */
  findings: Array<{path: string; line: number; body: string}>
}

// ═══════════════════ 平台原生夹具接线 ═══════════════════════════════════════

function wireGitHub(out: RunOutput): void {
  const login = SHAPE.github.login
  let nextId = 1000

  octokitState.pulls.get.mockImplementation(async () => ({
    data: {
      number: 1,
      title: '同一份改动',
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
  // GitHub 原生 compare 形状：files[].filename / patch
  octokitState.repos.compareCommits.mockResolvedValue({
    data: {
      files: LOGICAL_DIFF.map(f => ({filename: f.path, status: 'modified', patch: f.patch})),
      commits: [{sha: HEAD}]
    }
  })
  octokitState.repos.getContent.mockResolvedValue({
    data: {content: Buffer.from('const a = 1\nconst c = 3\n').toString('base64')}
  })
  octokitState.git.getTree.mockResolvedValue({data: {tree: [], truncated: false}})
  // 必须按页返回：adapter 的 listChangeRequestCommits 是 do/while(data.length > 0)，
  // 每页都给同一条会无限翻页（真实 API 第二页返回空数组）
  octokitState.pulls.listCommits.mockImplementation(async (p: any) =>
    Number(p.page ?? 1) === 1 ? {data: [{sha: HEAD}]} : {data: []}
  )
  octokitState.pulls.listReviewComments.mockResolvedValue({data: []})
  octokitState.pulls.listReviews.mockResolvedValue({data: []})
  octokitState.issues.listComments.mockResolvedValue({data: []})
  octokitState.users.getAuthenticated.mockResolvedValue({data: {login}})
  octokitState.repos.getCollaboratorPermissionLevel.mockResolvedValue({data: {permission: 'write'}})
  octokitState.pulls.deletePendingReview.mockResolvedValue({data: {}})
  // resolve 走 GraphQL reviewThreads；默认无待解决线程，正向用例再覆盖
  octokitState.graphql.mockResolvedValue({
    repository: {
      pullRequest: {reviewThreads: {nodes: [], pageInfo: {hasNextPage: false, endCursor: null}}}
    }
  })
  octokitState.reactions.createForIssueComment.mockResolvedValue({data: {}})

  octokitState.issues.createComment.mockImplementation(async (p: any) => {
    out.notes.push(stripWriteMarkers(String(p.body)))
    return {data: {id: nextId++, body: String(p.body), user: {login}}}
  })
  octokitState.issues.updateComment.mockImplementation(async (p: any) => {
    out.notes.push(stripWriteMarkers(String(p.body)))
    return {data: {}}
  })
  // GitHub 一次 createReview 带整批评论：comments[].line
  octokitState.pulls.createReview.mockImplementation(async (p: any) => {
    for (const c of (p.comments ?? []) as any[]) {
      out.findings.push({path: c.path, line: c.line, body: stripWriteMarkers(String(c.body))})
    }
    return {data: {id: 9000}}
  })
  octokitState.pulls.submitReview.mockResolvedValue({data: {}})
  octokitState.pulls.createReviewComment.mockImplementation(async (p: any) => {
    out.findings.push({path: p.path, line: p.line, body: stripWriteMarkers(String(p.body))})
    return {data: {id: nextId++}}
  })
  octokitState.pulls.createReplyForReviewComment.mockImplementation(async (p: any) => {
    out.notes.push(stripWriteMarkers(String(p.body)))
    return {data: {id: nextId++, body: String(p.body), user: {login}}}
  })
}

function wireGitLab(out: RunOutput): void {
  const login = SHAPE.gitlab.login
  let nextId = 7000

  gitbeaker.MergeRequests.show.mockImplementation(async () => ({
    iid: 1,
    title: '同一份改动',
    description: out.description,
    state: 'opened',
    // GitLab 原生形状：diff_refs 而不是 base/head
    diff_refs: {base_sha: BASE, head_sha: HEAD, start_sha: BASE},
    sha: HEAD,
    target_branch: 'main',
    source_branch: 'feature',
    author: {username: 'alice'}
  }))
  gitbeaker.MergeRequests.edit.mockImplementation(async (..._a: any[]) => {
    const opts = _a[2]
    if (typeof opts?.description === 'string') out.description = opts.description
    return {}
  })
  // GitLab 原生 compare 形状：diffs[].new_path / diff
  gitbeaker.Repositories.compare.mockResolvedValue({
    commits: [{id: HEAD}],
    diffs: LOGICAL_DIFF.map(f => ({
      old_path: f.path,
      new_path: f.path,
      new_file: false,
      deleted_file: false,
      renamed_file: false,
      diff: f.patch
    }))
  })
  gitbeaker.RepositoryFiles.show.mockResolvedValue({
    content: Buffer.from('const a = 1\nconst c = 3\n').toString('base64')
  })
  gitbeaker.Repositories.allRepositoryTrees.mockResolvedValue([])
  gitbeaker.MergeRequests.allCommits.mockResolvedValue([{id: HEAD}])
  gitbeaker.MergeRequestNotes.all.mockResolvedValue([])
  gitbeaker.MergeRequestDiscussions.all.mockResolvedValue([])
  gitbeaker.Users.showCurrentUser.mockResolvedValue({username: login})
  // GitLab 权限查询是两步：Users.all 解析 username → id，再查 ProjectMembers
  gitbeaker.Users.all.mockImplementation(async (opts: any) => [
    {id: 5, username: String(opts?.username ?? 'alice')}
  ])
  // 用的是成员**列表**（all）而不是 show——列表能区分「确定不是成员」与「查询失败」
  gitbeaker.ProjectMembers.all.mockResolvedValue([{id: 5, access_level: 40}])
  gitbeaker.MergeRequestNoteAwardEmojis.award.mockResolvedValue({})

  gitbeaker.MergeRequestNotes.create.mockImplementation(async (..._a: any[]) => {
    const body = String(_a[2])
    out.notes.push(stripWriteMarkers(body))
    return {id: nextId++, body, author: {username: login}}
  })
  gitbeaker.MergeRequestNotes.edit.mockImplementation(async (..._a: any[]) => {
    const opts = _a[3]
    if (typeof opts?.body === 'string') out.notes.push(stripWriteMarkers(opts.body))
    return {}
  })
  // GitLab 逐条创建 discussion，位置在 position 里
  gitbeaker.MergeRequestDiscussions.create.mockImplementation(async (..._a: any[]) => {
    const body = String(_a[2])
    const position = _a[3]?.position ?? {}
    out.findings.push({
      path: String(position.newPath ?? position.new_path ?? ''),
      line: Number(position.newLine ?? position.new_line ?? 0),
      body: stripWriteMarkers(body)
    })
    return {id: `disc-${nextId++}`, notes: [{id: nextId++, body}]}
  })
  gitbeaker.MergeRequestDiscussions.addNote.mockImplementation(async (..._a: any[]) => ({
    id: nextId++,
    body: String(_a[4] ?? ''),
    author: {username: login}
  }))
}

function useCtx(platform: Platform, over: Record<string, any> = {}): ExecutionContext {
  setStateNamespace(platform)
  const shape = SHAPE[platform]
  const ctx: any = {
    platform,
    projectPath: shape.projectPath,
    projectId: shape.projectId,
    changeRequestId: 1,
    eventKind: 'pr_opened',
    actor: {login: 'alice', isBot: false},
    baseSha: BASE,
    headSha: HEAD,
    raw: {},
    ...over
  }
  setExecCtx(ctx)
  return ctx
}

/** 装配真实 adapter + 平台原生夹具 */
function prepare(platform: Platform, initialDescription = '用户自己写的描述'): RunOutput {
  jest.clearAllMocks()
  resetPlatform()
  _resetBotIdentity()
  _resetWriteQueues()
  // review-thread 的 bot 账号缓存也是模块级的。不清的话，GitLab 轮会拿到上一轮
  // GitHub 的账号名，fetchUnresolvedBotThreads 按作者过滤时一条都匹配不上，
  // resolve 正向用例静默变成空跑。
  _resetBotLoginCache()
  initBotGreeting('🤖', 'CodeSentinel', SHAPE[platform].login)

  const out: RunOutput = {notes: [], description: initialDescription, findings: []}
  if (platform === 'github') {
    setPlatform(new GitHubPlatform())
    wireGitHub(out)
  } else {
    setPlatform(
      new GitLabPlatform({
        host: 'https://gitlab.example.com',
        credential: {type: 'pat', value: 'glpat-test'},
        timeoutMS: 30_000
      })
    )
    wireGitLab(out)
  }
  return out
}

async function runReview(platform: Platform): Promise<RunOutput> {
  const out = prepare(platform)
  await codeReview(useCtx(platform), makeBot(), makeBot(), makeOptions(), taggedPrompts)
  return out
}

interface CommandRun {
  reply: string
  /** triggerReview 收到的模式序列 */
  modes: string[]
  out: RunOutput
}

/**
 * 跑一条命令。
 *
 * `triggerReview` **不是空函数**——它真的跑一遍共享审查核心。第一版注入空函数，
 * 结果 review / full review / summary 即使传错模式、根本没调 codeReview、没产出
 * 任何摘要或行级结果，用例照样绿：它只断言了「回帖了」。
 */
async function runCommand(
  platform: Platform,
  command: string,
  initialDescription?: string
): Promise<CommandRun> {
  const out = prepare(platform, initialDescription)
  _resetBootstrap()
  _resetPermissionCache()
  _resetRateLimit()
  bootstrapCommands()

  const modes: string[] = []
  const ctx = useCtx(platform, {
    eventKind: 'comment_created',
    comment: {kind: 'top_level', id: 4242, body: `@ai-reviewer ${command}`}
  })

  await dispatchCommentEvent({
    execCtx: ctx,
    options: makeOptions(),
    triggerReview: async (mode: any) => {
      modes.push(String(mode))
      await codeReview(ctx, makeBot(), makeBot(), makeOptions(), taggedPrompts, {
        mode: mode === 'incremental' ? 'incremental' : 'full',
        source: 'command',
        summaryOnly: mode === 'summary'
      })
    }
  })

  return {reply: out.notes.join('\n---\n'), modes, out}
}

/** 归一化时要抹掉的账号 */
const LOGIN_OPTS = {
  botLogins: [SHAPE.github.login, SHAPE.gitlab.login],
  actorLogins: ['alice']
}

beforeEach(() => {
  jest.clearAllMocks()
})

// ═══════════════════ TEST-012：摘要语义等价 ═════════════════════════════════

describe('TEST-012：同一改动经两平台 adapter 后产生语义等价的 summary', () => {
  test('摘要评论归一化后逐字相同', async () => {
    const gh = await runReview('github')
    const gl = await runReview('gitlab')

    const pick = (r: RunOutput): string =>
      normalizeForComparison(r.notes.filter(n => n.includes('summarize')).join('\n'), LOGIN_OPTS)

    expect(pick(gh)).toContain('本次改动新增了两个导出常量') // 防空跑
    expect(pick(gh)).toBe(pick(gl))
  })

  test('release notes 写进 description 的内容归一化后相同', async () => {
    const gh = await runReview('github')
    const gl = await runReview('gitlab')

    const a = normalizeForComparison(gh.description, LOGIN_OPTS)
    const b = normalizeForComparison(gl.description, LOGIN_OPTS)

    expect(a).toContain('新增了 b 与 y 两个常量')
    expect(a).toContain('用户自己写的描述') // 用户原文两边都保住
    expect(a).toBe(b)
  })

  test('两侧确实走了各自的原生 API（不是共用一个替身）', async () => {
    await runReview('github')
    expect(octokitState.repos.compareCommits).toHaveBeenCalled()
    expect(gitbeaker.Repositories.compare).not.toHaveBeenCalled()

    await runReview('gitlab')
    expect(gitbeaker.Repositories.compare).toHaveBeenCalled()
    expect(octokitState.repos.compareCommits).not.toHaveBeenCalled()
  })

  test('归一化前确实不同（否则这套判定什么都没证明）', async () => {
    const gh = await runReview('github')
    const gl = await runReview('gitlab')

    expect(gh.description).not.toBe(gl.description)
    expect(gh.description).toContain('ai-reviewer:github:')
    expect(gl.description).toContain('ai-reviewer:gitlab:')
  })
})

// ═══════════════════ TEST-013：行级问题语义等价 ═════════════════════════════

describe('TEST-013：两平台 adapter 写出的行级问题落在同一位置说同一句话', () => {
  test('位置与正文完全一致', async () => {
    const gh = await runReview('github')
    const gl = await runReview('gitlab')

    const a = normalizeFindings(gh.findings, LOGIN_OPTS)
    const b = normalizeFindings(gl.findings, LOGIN_OPTS)

    expect(a.length).toBeGreaterThan(0) // 防空跑
    expect(a).toEqual(b)
  })

  /**
   * 这条是改用真实 adapter 的直接收益：GitHub 把整批评论塞进一次 createReview 的
   * `comments[].line`，GitLab 逐条创建 discussion 并把行号放在 `position` 里。
   * 两条完全不同的映射路径，用同一个 mock adapter 时一条都跑不到。
   */
  test('行号来自各自的写入结构（createReview.comments vs discussion position）', async () => {
    await runReview('github')
    const ghComments = (octokitState.pulls.createReview.mock.calls as any[][])[0][0].comments
    expect(ghComments.map((c: any) => `${c.path}:${c.line}`).sort()).toEqual([
      'src/a.ts:2',
      'src/b.ts:2'
    ])

    await runReview('gitlab')
    const positions = (gitbeaker.MergeRequestDiscussions.create.mock.calls as any[][]).map(
      c => c[3].position
    )
    expect(
      positions.map(p => `${p.newPath ?? p.new_path}:${p.newLine ?? p.new_line}`).sort()
    ).toEqual(['src/a.ts:2', 'src/b.ts:2'])
  })

  test('两个文件都被审查到', async () => {
    const gh = await runReview('github')
    expect(gh.findings.map(f => f.path).sort()).toEqual(['src/a.ts', 'src/b.ts'])
  })
})

// ═══════════════════ TEST-014：命令结果语义等价 ═════════════════════════════

describe('TEST-014：所有评论命令的业务结果语义等价', () => {
  /**
   * 逐字比较的是**平台中立**的命令。`help` 与 `configuration` 不在其中——
   * 它们的正文按设计就该不同（access level 名称、CI 变量 vs Action input），
   * 那是 CMD-022/023 要求的功能，见下方单独一条。
   */
  const neutralCommands = ['pause', 'resume', 'review', 'full review', 'summary', 'resolve']

  test.each(neutralCommands)('%s：两平台回复归一化后相同', async command => {
    const gh = await runCommand('github', command)
    const gl = await runCommand('gitlab', command)

    expect(gh.reply).not.toBe('') // 防空跑
    expect(normalizeForComparison(gh.reply, LOGIN_OPTS)).toBe(
      normalizeForComparison(gl.reply, LOGIN_OPTS)
    )
  })

  /**
   * 审查类命令必须传对模式。少了这条，模式传错（例如 `review` 走全量）
   * 在「回帖内容相同」的层面完全看不出来。
   */
  test.each([
    ['full review', ['full']],
    ['summary', ['summary']]
  ] as Array<[string, string[]]>)('%s → triggerReview 收到 %s', async (command, expected) => {
    const gh = await runCommand('github', command)
    const gl = await runCommand('gitlab', command)

    expect(gh.modes).toEqual(expected)
    expect(gl.modes).toEqual(expected)
  })

  /**
   * `review` 只在暂停状态下才真正触发增量审查（CMD-017），
   * 未暂停时按设计不调模型——两平台的这条分支也必须一致。
   */
  test('review：未暂停时两平台都不触发审查', async () => {
    const gh = await runCommand('github', 'review')
    const gl = await runCommand('gitlab', 'review')

    expect(gh.modes).toEqual([])
    expect(gl.modes).toEqual([])
    expect(gh.reply).toContain('Review finished')
  })

  test('审查类命令确实产出了业务结果，不只是回帖', async () => {
    const gh = await runCommand('github', 'full review')
    const gl = await runCommand('gitlab', 'full review')

    // triggerReview 真的跑了共享核心：行级发现落地了
    expect(gh.out.findings.length).toBeGreaterThan(0)
    expect(normalizeFindings(gh.out.findings, LOGIN_OPTS)).toEqual(
      normalizeFindings(gl.out.findings, LOGIN_OPTS)
    )
  })

  /**
   * 上面几条只覆盖了 review / resume / resolve 的**无操作分支**——未暂停、没有
   * pause marker、没有待解决线程。那三条路径一次都没跑到，却按「所有命令语义
   * 等价」勾了完成。下面补正向场景。
   */

  /** 预置 paused 状态的 description（marker 带平台命名空间） */
  function pausedDescription(platform: Platform): string {
    setStateNamespace(platform)
    return [
      '用户自己写的描述',
      stateMarker('reviewStateStart'),
      'state: paused',
      stateMarker('reviewStateEnd')
    ].join('\n')
  }

  test('review（正向）：已暂停时两平台都触发增量审查，产物等价', async () => {
    const gh = await runCommand('github', 'review', pausedDescription('github'))
    const gl = await runCommand('gitlab', 'review', pausedDescription('gitlab'))

    expect(gh.modes).toEqual(['incremental'])
    expect(gl.modes).toEqual(['incremental'])

    // 真的跑出了审查产物，且两端一致
    expect(gh.out.findings.length).toBeGreaterThan(0)
    expect(normalizeFindings(gh.out.findings, LOGIN_OPTS)).toEqual(
      normalizeFindings(gl.out.findings, LOGIN_OPTS)
    )
  })

  test('resume（正向）：两平台都移除 pause marker 并保留用户原文', async () => {
    const gh = await runCommand('github', 'resume', pausedDescription('github'))
    const gl = await runCommand('gitlab', 'resume', pausedDescription('gitlab'))

    for (const [platform, run] of [
      ['github', gh],
      ['gitlab', gl]
    ] as Array<[Platform, CommandRun]>) {
      expect(run.out.description).toContain('用户自己写的描述') // 用户原文保住
      expect(run.out.description).not.toContain('state: paused') // 暂停状态已解除
      expect(run.out.description).toContain(`ai-reviewer:${platform}:review-state-start`)
    }

    expect(normalizeForComparison(gh.out.description, LOGIN_OPTS)).toBe(
      normalizeForComparison(gl.out.description, LOGIN_OPTS)
    )
  })

  test('resolve（正向）：两平台都解决掉 reviewer 创建的未解决线程', async () => {
    // GitHub：GraphQL reviewThreads
    const ghPrepare = (): void => {
      octokitState.graphql.mockImplementation(async (query: string) => {
        if (String(query).includes('reviewThreads')) {
          return {
            repository: {
              pullRequest: {
                reviewThreads: {
                  nodes: [
                    {
                      id: 'PRRT_1',
                      isResolved: false,
                      path: 'src/a.ts',
                      line: 2,
                      comments: {
                        nodes: [{author: {login: SHAPE.github.login}, body: '旧发现'}]
                      }
                    }
                  ],
                  pageInfo: {hasNextPage: false, endCursor: null}
                }
              }
            }
          }
        }
        return {}
      })
    }
    // GitLab：diff discussions
    const glPrepare = (): void => {
      gitbeaker.MergeRequestDiscussions.all.mockResolvedValue([
        {
          id: 'disc-1',
          notes: [
            {
              id: 11,
              type: 'DiffNote',
              system: false,
              resolved: false,
              resolvable: true,
              body: '旧发现',
              author: {username: SHAPE.gitlab.login},
              position: {new_path: 'src/a.ts', new_line: 2}
            }
          ]
        }
      ])
      gitbeaker.MergeRequestDiscussions.resolve.mockResolvedValue({})
    }

    const gh = await (async () => {
      const out = prepare('github')
      ghPrepare()
      _resetBootstrap()
      _resetPermissionCache()
      _resetRateLimit()
      bootstrapCommands()
      const ctx = useCtx('github', {
        eventKind: 'comment_created',
        comment: {kind: 'top_level', id: 4243, body: '@ai-reviewer resolve'}
      })
      await dispatchCommentEvent({execCtx: ctx, options: makeOptions()})
      // 必须在这里断言：下一个 prepare() 会 clearAllMocks，把调用记录清掉
      expect(octokitState.graphql.mock.calls.length).toBeGreaterThan(0)
      return out
    })()

    const gl = await (async () => {
      const out = prepare('gitlab')
      glPrepare()
      _resetBootstrap()
      _resetPermissionCache()
      _resetRateLimit()
      bootstrapCommands()
      const ctx = useCtx('gitlab', {
        eventKind: 'comment_created',
        comment: {kind: 'top_level', id: 4243, body: '@ai-reviewer resolve'}
      })
      await dispatchCommentEvent({execCtx: ctx, options: makeOptions()})
      expect(gitbeaker.MergeRequestDiscussions.resolve).toHaveBeenCalled()
      return out
    })()

    // 成功/失败计数语义相同（都是「解决了 1 条」）
    const ghReply = gh.notes.join('\n')
    const glReply = gl.notes.join('\n')
    expect(ghReply).toContain('已解决')
    expect(normalizeForComparison(ghReply, LOGIN_OPTS)).toBe(
      normalizeForComparison(glReply, LOGIN_OPTS)
    )
  })

  test.each(['help', 'configuration'])('%s：平台专有措辞是有意为之，不算语义差异', async cmd => {
    const gh = await runCommand('github', cmd)
    const gl = await runCommand('gitlab', cmd)

    const title = cmd === 'help' ? '支持的命令' : '当前审查配置'
    expect(gh.reply).toContain(title)
    expect(gl.reply).toContain(title)
  })
})

// ═══════════════════ TEST-015：允许哪些差异，不允许哪些 ═════════════════════

describe('TEST-015：归一化只抹平台差异，不抹真实差异', () => {
  const allowed: Array<[string, string, string]> = [
    [
      'marker 命名空间',
      '<!-- ai-reviewer:github:summarize -->',
      '<!-- ai-reviewer:gitlab:summarize -->'
    ],
    [
      '写操作 marker（含随机 opId）',
      '正文\n\n<!-- ai-reviewer:github:write:1:note:0123456789abcdef -->',
      '正文\n\n<!-- ai-reviewer:gitlab:write:1:review-comment:fedcba9876543210 -->'
    ],
    [
      '仓库 URL',
      '见 https://github.com/octo/demo/pull/1',
      '见 https://gitlab.example.com/g/p/-/merge_requests/1'
    ],
    ['评论 ID', 'comment id: 1001', 'comment id: 7001'],
    ['commit SHA', `已审查 ${'a'.repeat(40)}`, `已审查 ${'c'.repeat(40)}`],
    ['行尾空白与多余空行', '第一行   \n\n\n第二行', '第一行\n\n第二行']
  ]

  test.each(allowed)('允许：%s', (_label, a, b) => {
    expect(normalizeForComparison(a, LOGIN_OPTS)).toBe(normalizeForComparison(b, LOGIN_OPTS))
  })

  test('允许：账号名不同（GitHub App 名 vs GitLab PAT 用户名）', () => {
    expect(normalizeForComparison(`由 @${SHAPE.github.login} 发布`, LOGIN_OPTS)).toBe(
      normalizeForComparison(`由 @${SHAPE.gitlab.login} 发布`, LOGIN_OPTS)
    )
  })

  /**
   * 反向用例。归一化器是这套判定的单点故障——抹多了什么都"等价"，
   * 极端情况下把正文抹成空串，任何两个结果都能通过。
   */
  const notAllowed: Array<[string, string, string]> = [
    ['正文措辞', '这里应该用 const', '这里应该用 let'],
    ['marker 种类', '<!-- ai-reviewer:github:summarize -->', '<!-- ai-reviewer:github:comment -->'],
    ['行号', '2-2:\n 有问题', '5-5:\n 有问题'],
    ['文件路径', '见 src/a.ts', '见 src/b.ts'],
    ['正文里的普通数字（是语义，不是 ID）', '共 3 处问题', '共 5 处问题'],
    ['少了一整段内容', '第一段\n\n第二段', '第一段']
  ]

  test.each(notAllowed)('不允许：%s', (_label, a, b) => {
    expect(normalizeForComparison(a, LOGIN_OPTS)).not.toBe(normalizeForComparison(b, LOGIN_OPTS))
  })

  test('不允许：一边有 marker 一边没有', () => {
    expect(
      normalizeForComparison('正文\n\n<!-- ai-reviewer:github:summarize -->', LOGIN_OPTS)
    ).not.toBe(normalizeForComparison('正文', LOGIN_OPTS))
  })
})
