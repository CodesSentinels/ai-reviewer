/**
 * summary-order-dual-platform.test.ts — 双平台回测：摘要必须排在行级审查之前，且只有一条（#236）
 *
 * 流程是：先发「审查中」摘要 → 生成摘要与审查 → 提交行级评论 → 把同一条摘要原地改成完整内容。
 * 摘要因此总是时间线上最早的那条。线上出过的故障是：机器人认不出自己的摘要
 * （GitHub 上作者是 `github-actions[bot]`，回退值是 `github-actions`），最后一步改成
 * 新发一条——摘要排到审查之后，「审查中」横幅残留。
 *
 * 这里用内存里的 PR/MR 时间线（评论按创建顺序编号，更新不改变位置）跑真实的
 * codeReview + Commenter，覆盖两个平台各自真实的身份形态，比较同一组断言。
 */
import {describe, expect, test, jest, beforeEach} from '@jest/globals'

jest.mock('../src/tokenizer', () => ({getTokenCount: () => 10}))
jest.mock('../src/github/review-thread', () => ({
  fetchThreadStatusMap: jest.fn<any>().mockResolvedValue(new Map())
}))

interface Note {
  id: number
  body: string
  author: string
  seq: number
}

/** 时间线：notes 是顶层评论，events 记录所有写操作的先后 */
const timeline: {
  notes: Note[]
  events: Array<{seq: number; kind: string; id?: number}>
  seq: number
} = {
  notes: [],
  events: [],
  seq: 0
}
let SUMMARY_MARKER = ''
let AUTHOR = ''
let LOGIN_LOOKUP: () => Promise<string> = async () => ''

const platformState: any = {
  getChangeRequest: jest.fn<any>(),
  compareDiff: jest.fn<any>(),
  getFileContent: jest.fn<any>(),
  listRepositoryTree: jest.fn<any>(),
  listComments: jest.fn<any>(async () => timeline.notes.map(n => ({...n, createdAt: `t${n.seq}`}))),
  listReviewComments: jest.fn<any>(async () => []),
  createComment: jest.fn<any>(async (_o: string, _r: string, _t: number, body: string) => {
    const note: Note = {id: ++timeline.seq + 1000, body, author: AUTHOR, seq: timeline.seq}
    timeline.notes.push(note)
    timeline.events.push({
      seq: timeline.seq,
      kind: body.includes(SUMMARY_MARKER) ? 'summary:create' : 'note:create',
      id: note.id
    })
    return {id: note.id, body, author: AUTHOR, createdAt: `t${note.seq}`}
  }),
  updateComment: jest.fn<any>(async (_o: string, _r: string, id: number, body: string) => {
    const note = timeline.notes.find(n => n.id === id)
    if (note) note.body = body
    timeline.events.push({
      seq: ++timeline.seq,
      kind: body.includes(SUMMARY_MARKER) ? 'summary:update' : 'note:update',
      id
    })
  }),
  deleteComment: jest.fn<any>(async (_o: string, _r: string, id: number) => {
    timeline.notes = timeline.notes.filter(n => n.id !== id)
    timeline.events.push({seq: ++timeline.seq, kind: 'note:delete', id})
  }),
  listChangeRequestCommits: jest.fn<any>(async () => []),
  submitReviewComments: jest.fn<any>(async (...a: any[]) => {
    timeline.events.push({seq: ++timeline.seq, kind: 'review:submit'})
    return {delivered: [...((a[4] ?? []) as any[])], failed: []}
  }),
  updateChangeRequestBody: jest.fn<any>(async () => undefined),
  deletePendingReview: jest.fn<any>(async () => undefined),
  getAuthenticatedLogin: jest.fn<any>(() => LOGIN_LOOKUP())
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
import {_resetBotIdentity, initBotGreeting} from '../src/commenter'
import {setExecCtx} from '../src/platform/run-context'
import {setStateNamespace} from '../src/platform/state-namespace'
import {stateMarker} from '../src/state-markers'
import {Prompts} from '../src/prompts'
import type {Platform} from '../src/platform/execution-context'

const BASE = 'b'.repeat(40)
const HEAD = 'h'.repeat(40)

/** 轻量模型：判定需要审查；重量模型：对新增的第 2 行给出一条行级评论 */
const lightBot = (): any => ({
  chat: jest.fn<any>(async () => ['[TRIAGE]: NEEDS_REVIEW\n概要', {}, []])
})
const heavyBot = (): any => ({
  chat: jest.fn<any>(async () => ['2-2:\n这里可能有问题。\n---', {}, []])
})

function makeOptions(botLogin: string): any {
  const limits = {
    requestTokens: 100000,
    responseTokens: 1000,
    maxTokens: 101000,
    knowledgeCutOff: ''
  }
  return {
    debug: false,
    disableReview: false,
    disableReleaseNotes: true,
    maxFiles: 0,
    reviewSimpleChanges: true,
    reviewCommentLGTM: true,
    pathFilters: {check: () => true},
    pathInstructions: {match: () => []},
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
    botName: 'bot',
    botLogin,
    maxReviewComments: 20,
    lightTokenLimits: limits,
    heavyTokenLimits: limits,
    language: 'zh-CN'
  }
}

function useCtx(platform: Platform): any {
  setStateNamespace(platform)
  SUMMARY_MARKER = stateMarker('summarize')
  const ctx: any = {
    platform,
    projectPath: platform === 'github' ? 'octo/demo' : 'group/sub/demo',
    projectId: platform === 'github' ? 'octo/demo' : '42',
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

beforeEach(() => {
  jest.clearAllMocks()
  logs.length = 0
  timeline.notes = []
  timeline.events = []
  timeline.seq = 0
  _resetBotIdentity()
  platformState.getChangeRequest.mockResolvedValue({
    number: 1,
    title: 't',
    body: 'body',
    state: 'open',
    baseSha: BASE,
    headSha: HEAD,
    baseRef: 'main',
    headRef: 'feature',
    author: 'alice'
  })
  platformState.compareDiff.mockResolvedValue({
    files: [{filename: 'a.ts', status: 'modified', patch: '@@ -1,2 +1,3 @@\n a\n+x\n b'}],
    commits: [{sha: HEAD}]
  })
  platformState.getFileContent.mockResolvedValue('a\nb')
  platformState.listRepositoryTree.mockResolvedValue({files: [], truncated: false})
})

/**
 * 两个平台各自真实的身份形态：
 * - lookup：平台层 getAuthenticatedLogin 实际会返回的值
 * - author：平台把这个令牌写出的评论标成的作者
 * - configured：workflow / CI 里显式配置的 bot 登录名（空 = 未配置）
 */
const SCENARIOS: Array<{
  name: string
  platform: Platform
  lookup: string
  author: string
  configured: string
}> = [
  {
    name: 'GitHub · GITHUB_TOKEN · 回退值 github-actions[bot]（当前平台层）',
    platform: 'github',
    lookup: 'github-actions[bot]',
    author: 'github-actions[bot]',
    configured: ''
  },
  {
    name: 'GitHub · GITHUB_TOKEN · 回退值 github-actions（线上出过故障的旧值）',
    platform: 'github',
    lookup: 'github-actions',
    author: 'github-actions[bot]',
    configured: ''
  },
  {
    name: 'GitHub · App 令牌 · 回退值猜错，靠写响应纠正',
    platform: 'github',
    lookup: 'github-actions[bot]',
    author: 'my-app[bot]',
    configured: ''
  },
  {
    name: 'GitHub · 显式配置 bot_github_login',
    platform: 'github',
    lookup: 'github-actions',
    author: 'my-app[bot]',
    configured: 'my-app[bot]'
  },
  {
    name: 'GitLab · Project Access Token · GET /user 返回 bot 用户名',
    platform: 'gitlab',
    lookup: 'project_42_bot_a1b2c3',
    author: 'project_42_bot_a1b2c3',
    configured: ''
  },
  {
    name: 'GitLab · Group Access Token',
    platform: 'gitlab',
    lookup: 'group_7_bot_d4e5f6',
    author: 'group_7_bot_d4e5f6',
    configured: ''
  },
  {
    name: 'GitLab · 个人 PAT · 显式配置用户名',
    platform: 'gitlab',
    lookup: 'review-bot',
    author: 'review-bot',
    configured: 'review-bot'
  }
]

describe.each(SCENARIOS)('$name', s => {
  async function run(): Promise<void> {
    AUTHOR = s.author
    LOGIN_LOOKUP = async () => s.lookup
    const ctx = useCtx(s.platform)
    initBotGreeting('🤖', 'bot', s.configured)
    await codeReview(ctx, lightBot(), heavyBot(), makeOptions(s.configured), new Prompts('', ''))
  }

  test('顶层评论只有一条摘要，「审查中」横幅没有残留', async () => {
    await run()

    const summaries = timeline.notes.filter(n => n.body.includes(SUMMARY_MARKER))
    expect(summaries).toHaveLength(1)
    expect(summaries[0].body).not.toContain('Currently reviewing')
    expect(timeline.notes).toHaveLength(1)
  })

  test('摘要是时间线上最早创建的评论，早于行级审查的提交', async () => {
    await run()

    const created = timeline.events.find(e => e.kind === 'summary:create')
    const submitted = timeline.events.find(e => e.kind === 'review:submit')
    expect(created).toBeDefined()
    expect(submitted).toBeDefined() // 对照：确实产生了行级审查，不是空跑
    expect(created!.seq).toBeLessThan(submitted!.seq)
  })

  test('最终摘要是把最初那条原地更新出来的：更新的就是第一次创建的那条，且发生在审查之后', async () => {
    await run()

    const created = timeline.events.find(e => e.kind === 'summary:create')!
    const updates = timeline.events.filter(e => e.kind === 'summary:update')
    const submitted = timeline.events.find(e => e.kind === 'review:submit')!

    expect(timeline.events.filter(e => e.kind === 'summary:create')).toHaveLength(1)
    expect(updates.length).toBeGreaterThan(0)
    for (const u of updates) expect(u.id).toBe(created.id)
    // 最后一次更新（完整摘要）在行级审查提交之后
    expect(updates[updates.length - 1].seq).toBeGreaterThan(submitted.seq)
  })

  test('没有产生任何删除（不是靠「先多发再删」凑出的单条）', async () => {
    await run()

    expect(timeline.events.filter(e => e.kind === 'note:delete')).toHaveLength(0)
  })

  test('日志里没有「别人的评论」误判，也没有身份对不上的告警', async () => {
    await run()

    const all = logs.join('\n')
    expect(all).not.toContain('authored by someone else')
    expect(all).not.toContain('do not match the resolved bot identity')
  })
})

describe('对照：真人引用回复的保护在两个平台上都不退化', () => {
  test.each([
    ['github', 'github-actions[bot]', 'alice'],
    ['github', 'github-actions[bot]', 'github-actions'],
    ['gitlab', 'project_42_bot_a1b2c3', 'alice']
  ] as Array<[Platform, string, string]>)(
    '%s：作者 %s 的身份下，%s 的引用不会被覆盖或删除',
    async (platform, login, quoter) => {
      AUTHOR = login
      LOGIN_LOOKUP = async () => login
      const ctx = useCtx(platform)
      initBotGreeting('🤖', 'bot', '')
      timeline.notes.push({
        id: 500,
        body: `> 引用\n> ${SUMMARY_MARKER}\n我的意见`,
        author: quoter,
        seq: ++timeline.seq
      })

      await codeReview(ctx, lightBot(), heavyBot(), makeOptions(''), new Prompts('', ''))

      const quoted = timeline.notes.find(n => n.id === 500)
      expect(quoted?.body).toContain('我的意见')
      expect(timeline.events.some(e => e.id === 500)).toBe(false)
      // 我们自己的摘要仍然只有一条
      expect(
        timeline.notes.filter(n => n.author === login && n.body.includes(SUMMARY_MARKER))
      ).toHaveLength(1)
    }
  )
})
