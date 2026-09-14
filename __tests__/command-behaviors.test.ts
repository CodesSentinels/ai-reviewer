/**
 * command-behaviors.test.ts — 命令行为（§9.3 CMD-017~026）
 *
 * 六个命令此前住在 `handlers/stubs.ts` 里，只有 `command-dispatcher.test.ts`
 * 顺带跑过其中几条的 happy path。本文件从 `dispatchCommentEvent` 入口进，按
 * CMD-025/026 的要求把**每个命令 × 每种事件形态 × 每类失败**跑一遍。
 *
 * 之所以不直接调 handler：CMD-025 要覆盖「顶层 note 和 discussion reply」，
 * 这两条路径的差异（回帖用 createComment 还是 replyToReviewComment、幂等
 * marker 写在哪）全在 dispatcher 与 Reply 里，直接调 handler 一概测不到。
 *
 * ## 矩阵怎么算「全」
 *
 * 命令清单来自下面的 COMMANDS 表，它必须与 registry 实际注册的命令完全一致
 * （有一条守卫用例盯着）。加了新命令却忘了补矩阵会直接红。
 *
 * CMD-026 的四类失败并非对每个命令都成立，按适用性分：
 *
 *   权限不足 / 权限查询失败 —— 全部命令都跑。`help` 的 minPermission 是 read，
 *                              期望是**放行**，它同时充当对照组：证明前面那些
 *                              FORBIDDEN 不是「所有命令都被无差别拒了」
 *   重复事件               —— 全部命令都跑，幂等是 dispatcher 层的公共行为
 *   旧 SHA                 —— 只有读 HEAD 的命令适用（review / full review /
 *                              summary），其余命令与 SHA 无关
 *   API 部分失败           —— 只有产生外部写入的命令适用（触发审查、写
 *                              description、resolve discussions）
 */
import {describe, expect, test, beforeEach, jest} from '@jest/globals'

import type {ExecutionContext, Platform} from '../src/platform/execution-context'
import {setExecCtx} from '../src/platform/run-context'

jest.mock('../src/platform/logger', () => ({
  getLogger: () => ({info: jest.fn(), warning: jest.fn(), error: jest.fn(), debug: jest.fn()})
}))

const platformState: Record<string, any> = {
  listComments: jest.fn<any>(),
  createComment: jest.fn<any>(),
  updateComment: jest.fn<any>(),
  getCollaboratorPermission: jest.fn<any>(),
  getChangeRequest: jest.fn<any>(),
  updateChangeRequestBody: jest.fn<any>(),
  replyToReviewComment: jest.fn<any>(),
  addReaction: jest.fn<any>(),
  getAuthenticatedLogin: jest.fn<any>(),
  fetchUnresolvedBotThreads: jest.fn<any>(),
  resolveThreads: jest.fn<any>(),
  fetchThreadStatusMap: jest.fn<any>()
}
jest.mock('../src/platform/git-platform', () => ({getPlatform: () => platformState}))

import {dispatchCommentEvent} from '../src/commands/dispatcher'
import {_resetBootstrap, bootstrapCommands} from '../src/commands/bootstrap'
import {_resetPermissionCache} from '../src/commands/permission'
import {_resetRateLimit} from '../src/commands/rate-limit'
import {setStateNamespace} from '../src/platform/state-namespace'
import {getRegistry} from '../src/commands/registry'
import {_resetBotIdentity, initBotGreeting} from '../src/commenter'
import {stateMarker} from '../src/state-markers'

const HEAD = 'a'.repeat(40)
const stubOptions: any = {
  commandAckReaction: 'eyes',
  botIcon: '🦉',
  botLogin: 'ai-reviewer',
  disableReview: false,
  disableReleaseNotes: false,
  maxFiles: 150,
  reviewSimpleChanges: false,
  reviewCommentLGTM: false,
  maxReviewComments: 20,
  openaiLightModel: 'gpt-5.4-nano',
  openaiHeavyModel: 'gpt-5.4-mini',
  openaiConcurrencyLimit: 4,
  githubConcurrencyLimit: 4,
  enableDependencyAnalysis: true,
  maxDependencyFiles: 50,
  enableWebSearch: false,
  enableShell: false,
  enableLintTools: false,
  language: 'zh-CN'
}

type Shape = 'top_level' | 'review_thread'

interface EventOpts {
  platform?: Platform
  shape?: Shape
  body: string
  commentId?: number
  actor?: string
  /** 模拟 dispatcher 开头那次 change request 查询失败（headSha 落空串） */
  headQueryFails?: boolean
}

let seq = 0

function makeCtx(o: EventOpts): ExecutionContext {
  const platform = o.platform ?? 'github'
  setStateNamespace(platform)
  const shape = o.shape ?? 'top_level'
  const ctx = {
    platform,
    projectPath: platform === 'gitlab' ? 'group/demo' : 'octo/demo',
    projectId: '77',
    changeRequestId: 42,
    eventKind: shape === 'top_level' ? 'comment_created' : 'review_comment_created',
    actor: {login: o.actor ?? 'alice', isBot: false},
    baseSha: 'b'.repeat(40),
    headSha: HEAD,
    comment:
      shape === 'top_level'
        ? {kind: 'top_level', id: o.commentId ?? ++seq + 1000, body: o.body}
        : {
            kind: 'review_thread',
            id: o.commentId ?? ++seq + 2000,
            body: o.body,
            path: 'src/a.ts',
            line: 12,
            threadId: 'disc-1'
          },
    raw: {}
  } as ExecutionContext
  setExecCtx(ctx)
  return ctx
}

interface RunResult {
  outcome: any
  /** 最终发给用户的正文（不论走哪条回帖路径） */
  message: string
  triggered: string[]
}

async function run(o: EventOpts, deps: {triggerFails?: boolean} = {}): Promise<RunResult> {
  const execCtx = makeCtx(o)
  if (o.headQueryFails === true) {
    // dispatcher 无论 execCtx 里带什么，都会现查一次 change request 补 head/base
    // SHA（CMD-017 要的「最新 HEAD」）。所以模拟「HEAD 未知」只能让这次查询失败，
    // 光在 execCtx 里塞空串没用——第一版就是这么写的，三条用例全是假的。
    platformState.getChangeRequest.mockRejectedValue(new Error('502 Bad Gateway'))
  }
  const triggered: string[] = []
  const outcome = await dispatchCommentEvent({
    execCtx,
    options: stubOptions,
    triggerReview: async (mode: string) => {
      triggered.push(mode)
      if (deps.triggerFails === true) throw new Error('review blew up')
    }
  })
  const bodies = [
    ...platformState.createComment.mock.calls.map((c: any[]) => c[3]),
    ...platformState.replyToReviewComment.mock.calls.map((c: any[]) => c[4]),
    ...platformState.updateComment.mock.calls.map((c: any[]) => c[3])
  ].filter((b): b is string => typeof b === 'string')
  return {outcome, message: bodies.join('\n---\n'), triggered}
}

/**
 * 往评论区放一条带「已审查 SHA」区块的摘要评论。
 *
 * **必须先钉住命名空间再构造 marker。** `stateMarker()` 在调用时按当前命名空间
 * 求值，而命名空间是上一条用例遗留的全局状态——直接在测试体里拼 marker，种出来
 * 的可能是 `ai-reviewer:gitlab:...`，而被测代码在 `ai-reviewer:github:...` 下找，
 * 于是「找不到区块 → 直接 return」，用例静默变成空跑。
 * 单跑会红、全量却绿，正是这个原因。
 */
function seedSummaryWithReviewedSha(sha: string, platform: Platform = 'github'): void {
  setStateNamespace(platform)
  platformState.listComments.mockResolvedValue([
    {
      id: 1,
      author: 'ai-reviewer',
      body:
        `摘要正文\n${stateMarker('commitIdsStart')}\n<!-- ${sha} -->\n` +
        `${stateMarker('commitIdsEnd')}\n${stateMarker('summarize')}`
    }
  ])
}

/** 有状态的 description：pause/resume 的读改写必须能真读回来 */
function statefulDescription(initial = '用户描述'): {get: () => string} {
  let stored = initial
  platformState.getChangeRequest.mockImplementation(async () => ({
    number: 42,
    title: 't',
    body: stored,
    state: 'open',
    baseSha: 'b'.repeat(40),
    headSha: HEAD,
    baseRef: 'main',
    headRef: 'feature',
    author: 'pr-author'
  }))
  platformState.updateChangeRequestBody.mockImplementation(async (..._a: any[]) => {
    stored = _a[3] as string
  })
  return {get: () => stored}
}

beforeEach(() => {
  _resetBootstrap()
  _resetPermissionCache()
  _resetRateLimit()
  // commenter 把解析出的 bot 身份缓存在模块级，跨用例不会自动清。不清的后果不是
  // 「偶尔串一下」——findCommentWithTag 在身份未知时**返回 null**（fail closed），
  // 于是任何依赖「找得到摘要评论」的用例都会静默变成空跑。
  _resetBotIdentity()
  initBotGreeting('🦉', 'CodeSentinel', 'ai-reviewer')
  bootstrapCommands()
  for (const k of Object.keys(platformState)) platformState[k].mockReset()

  platformState.listComments.mockResolvedValue([])
  platformState.createComment.mockResolvedValue({id: 9000, body: '', author: 'bot'})
  platformState.replyToReviewComment.mockResolvedValue({id: 9001, body: '', author: 'bot'})
  platformState.updateComment.mockResolvedValue(undefined)
  platformState.addReaction.mockResolvedValue(undefined)
  platformState.getAuthenticatedLogin.mockResolvedValue('ai-reviewer')
  platformState.getCollaboratorPermission.mockResolvedValue('write')
  platformState.fetchUnresolvedBotThreads.mockResolvedValue([])
  platformState.fetchThreadStatusMap.mockResolvedValue(new Map())
  platformState.resolveThreads.mockResolvedValue({ok: 0, failed: 0, failedItems: []})
  statefulDescription()
})

const PLATFORMS: Platform[] = ['github', 'gitlab']
const SHAPES: Shape[] = ['top_level', 'review_thread']

interface CommandSpec {
  name: string
  /** 最低权限；决定 read 用户会不会被 FORBIDDEN 挡住 */
  minPermission: 'read' | 'triage' | 'write'
  /** 会读取当前 HEAD —— 「旧 SHA / HEAD 未知」这类失败对它适用 */
  readsHead: boolean
}

/** 与 registry 注册的命令一一对应（下方有守卫用例） */
const COMMANDS: CommandSpec[] = [
  {name: 'help', minPermission: 'read', readsHead: false},
  {name: 'configuration', minPermission: 'triage', readsHead: false},
  {name: 'pause', minPermission: 'write', readsHead: false},
  {name: 'resume', minPermission: 'write', readsHead: false},
  {name: 'review', minPermission: 'write', readsHead: true},
  {name: 'full review', minPermission: 'write', readsHead: true},
  {name: 'summary', minPermission: 'write', readsHead: true},
  {name: 'resolve', minPermission: 'write', readsHead: false}
]

const COMMAND_NAMES = COMMANDS.map(c => c.name)

// ═════════════════ CMD-025：每个命令 × 顶层 note / discussion reply ═══════════

describe('CMD-025：每个命令在两种评论形态、两个平台上都能执行', () => {
  /**
   * 守卫：矩阵的命令清单必须等于 registry 实际注册的全部命令。
   *
   * 第一版这里是手写清单，漏了 `review`——而漏掉是看不出来的，矩阵照样全绿。
   * 有了这条，加了新命令却忘了补矩阵会直接红。
   */
  test('COMMANDS 表与 registry 注册的命令完全一致', () => {
    const registered = getRegistry()
      .listCommands()
      .map(c => c.name)
      .sort()
    expect([...COMMAND_NAMES].sort()).toEqual(registered)
  })

  const matrix: Array<[Platform, Shape, string]> = []
  for (const p of PLATFORMS)
    for (const s of SHAPES) for (const c of COMMAND_NAMES) matrix.push([p, s, c])

  test.each(matrix)('%s / %s / %s', async (platform, shape, command) => {
    const r = await run({platform, shape, body: `@ai-reviewer ${command}`})

    expect(r.outcome.kind).toBe('executed')
    expect(r.outcome.command).toBe(command)
    expect(r.outcome.error).toBeUndefined()
    expect(r.message).not.toBe('') // 确实回了帖，不是静默成功
  })

  test('行级评论回到同一 thread，而不是发成顶层评论', async () => {
    await run({shape: 'review_thread', body: '@ai-reviewer help'})

    expect(platformState.replyToReviewComment).toHaveBeenCalled()
    expect(platformState.createComment).not.toHaveBeenCalled()
  })

  test('顶层评论走 createComment', async () => {
    await run({shape: 'top_level', body: '@ai-reviewer help'})

    expect(platformState.createComment).toHaveBeenCalled()
    expect(platformState.replyToReviewComment).not.toHaveBeenCalled()
  })
})

// ═════════════════ CMD-017/018/019：审查触发类 ═══════════════════════════════

describe('CMD-017 review：增量审查针对最新 HEAD', () => {
  test('暂停状态下触发增量审查', async () => {
    const store = statefulDescription('用户描述')
    await run({body: '@ai-reviewer pause'})
    expect(store.get()).toContain('review-state-start')

    const r = await run({body: '@ai-reviewer review'})
    expect(r.triggered).toEqual(['incremental'])
  })

  test('未暂停时不触发（增量审查本来就随 push 发生）', async () => {
    const r = await run({body: '@ai-reviewer review'})

    expect(r.triggered).toEqual([])
    expect(r.message).toContain('Review finished')
  })

  /**
   * dispatcher 开头查 change request 补 head/base SHA，那次查询失败时 headSha
   * 是空串。此时继续跑增量，结果会写到一个说不清的 SHA 上。
   */
  test('HEAD 未知（平台查询失败）→ 中止且不调模型', async () => {
    await run({body: '@ai-reviewer pause'}) // 先进入 paused
    const r = await run({body: '@ai-reviewer review', headQueryFails: true})

    expect(r.triggered).toEqual([])
    expect(r.message).toContain('无法获取当前 HEAD')
  })
})

describe('CMD-018 full review：全量 diff', () => {
  test('未审查过 → 触发全量', async () => {
    const r = await run({body: '@ai-reviewer full review'})
    expect(r.triggered).toEqual(['full'])
  })

  /**
   * 摘要评论里记着已审查的 SHA。已审过还重跑一次全量 = 白烧一轮模型调用。
   */
  test('当前 HEAD 已审查过 → 不重复触发', async () => {
    seedSummaryWithReviewedSha(HEAD)

    const r = await run({body: '@ai-reviewer full review'})

    expect(r.triggered).toEqual([])
    expect(r.message).toContain('already been reviewed')
  })

  test('HEAD 未知 → 中止，不会因为「查不到就当没审过」而重跑全量', async () => {
    const r = await run({body: '@ai-reviewer full review', headQueryFails: true})

    expect(r.triggered).toEqual([])
    expect(r.message).toContain('无法获取当前 HEAD')
  })
})

describe('CMD-019 summary：重建摘要', () => {
  test('触发 summary 模式（不是 full/incremental）', async () => {
    const r = await run({body: '@ai-reviewer summary'})
    expect(r.triggered).toEqual(['summary'])
  })

  test('HEAD 未知 → 中止（摘要会指向错误的 commit 范围）', async () => {
    const r = await run({body: '@ai-reviewer summary', headQueryFails: true})
    expect(r.triggered).toEqual([])
  })
})

// ═════════════════ CMD-020/021：pause / resume ══════════════════════════════

describe.each(PLATFORMS)('CMD-020/021 pause/resume（%s）', platform => {
  test('pause 把 marker 写进 description，且保留用户原文', async () => {
    const store = statefulDescription('作者自己写的描述')

    const r = await run({platform, body: '@ai-reviewer pause'})

    expect(store.get()).toContain(`ai-reviewer:${platform}:review-state-start`)
    expect(store.get()).toContain('作者自己写的描述')
    expect(r.message).toContain('已暂停')
  })

  test('resume 之后状态回到 active', async () => {
    const store = statefulDescription()
    await run({platform, body: '@ai-reviewer pause'})
    await run({platform, body: '@ai-reviewer resume'})

    expect(store.get()).toContain('state: active')
  })

  test('重复 pause 幂等：第二次不再写 description', async () => {
    statefulDescription()
    await run({platform, body: '@ai-reviewer pause'})
    const writesAfterFirst = platformState.updateChangeRequestBody.mock.calls.length

    const r = await run({platform, body: '@ai-reviewer pause'})

    expect(platformState.updateChangeRequestBody.mock.calls.length).toBe(writesAfterFirst)
    expect(r.message).toContain('已处于暂停状态')
  })

  test('重复 resume 幂等：本来就是 active，不写 description', async () => {
    statefulDescription()
    const r = await run({platform, body: '@ai-reviewer resume'})

    expect(platformState.updateChangeRequestBody).not.toHaveBeenCalled()
    expect(r.message).toContain('已处于启用状态')
  })

  /**
   * 「说暂停了其实没暂停」比「暂停失败」危险得多——用户不会再看一眼，
   * 直到下次 push 被审查才发现。
   *
   * 这条防线在 review-state.ts：updateDescriptionSection 写后校验不通过时
   * setReviewState 抛错，dispatcher 转成 INTERNAL 并把原因带出来。
   */
  test('写入未落盘 → 报错而不是谎报成功', async () => {
    statefulDescription()
    platformState.updateChangeRequestBody.mockResolvedValue(undefined) // 写了但不落盘

    const r = await run({platform, body: '@ai-reviewer pause'})

    expect(r.outcome.error).toBe('INTERNAL')
    expect(r.message).toContain('Failed to persist review state')
    expect(r.message).not.toContain('已暂停当前')
  })
})

/**
 * CMD-017 与 pause 的交互。
 *
 * 原实现在 pause 时调 `clearReviewedCommitIds()` 抹掉增量基线。而 `review`
 * 命令**只在暂停状态下才真正执行**，于是两者叠加的结果是：handler 传
 * `incremental`，`review.ts` 却因为找不到历史 reviewed SHA 走「首次审查」分支
 * 从 base commit 开始，跑的是整份 diff。「仅审查自上次审查以来的新增变更」
 * 完全落空，而且没有任何迹象——命令回复一切正常。
 */
describe('CMD-017/020：pause 必须保住增量基线', () => {
  const OLD_SHA = 'c'.repeat(40)

  test('pause 不清除已审查 SHA 记录', async () => {
    seedSummaryWithReviewedSha(OLD_SHA)

    const r = await run({body: '@ai-reviewer pause'})

    // 先确认命令**确实执行成功**了。少了这句，pause 因任何原因失败时都不会有
    // 改写动作，下面的检查就成了空过——第一版正是这样：单跑会红，全量却绿。
    expect(r.outcome.error).toBeUndefined()

    // 摘要评论没有被改写成「丢掉基线」的样子
    const droppedBaseline = [
      ...platformState.createComment.mock.calls.map((c: any[]) => c[3]),
      ...platformState.updateComment.mock.calls.map((c: any[]) => c[3])
    ].some((b: unknown) => typeof b === 'string' && b.includes('摘要正文') && !b.includes(OLD_SHA))

    expect(droppedBaseline).toBe(false)
  })

  /**
   * 上一条只看摘要正文，可能被将来的改写路径绕开。这条从**行为**上验证基线还在：
   * 让基线正好等于当前 HEAD，pause 之后 `full review` 必须仍认得出「已审过」。
   * 基线一旦被清掉，它就会重新跑一轮全量。
   */
  test('pause 之后基线仍可读：HEAD 已在基线中时 full review 不重跑', async () => {
    seedSummaryWithReviewedSha(HEAD)

    await run({body: '@ai-reviewer pause'})
    const r = await run({body: '@ai-reviewer full review'})

    expect(r.triggered).toEqual([])
    expect(r.message).toContain('already been reviewed')
  })
})

// ═════════════════ CMD-022：configuration ═══════════════════════════════════

describe('CMD-022 configuration：只显示生效后的非敏感配置和来源', () => {
  test.each(PLATFORMS)('%s：每项都带来源', async platform => {
    const r = await run({platform, body: '@ai-reviewer configuration'})

    expect(r.message).toContain('max_files')
    expect(r.message).toContain(
      platform === 'gitlab' ? 'AI_REVIEWER_MAX_FILES' : 'Action input `max_files`'
    )
  })

  /**
   * GitHub 分不出「用户在 with: 里写了」和「用 action.yml 的 default」——带
   * default 的 input 在运行时同样会展开成 INPUT_<KEY>。按环境变量有无去标，
   * 会把默认值一律说成用户显式设置，用户会照着一个并不存在的配置去找。
   */
  test('GitHub：不声称能区分显式配置与默认值', async () => {
    const r = await run({platform: 'github', body: '@ai-reviewer configuration'})

    expect(r.message).toContain('action.yml 默认值')
    expect(r.message).not.toContain('默认值（未设置')
  })

  test('GitLab：能区分（CI 只注入用户定义过的变量）', async () => {
    const before = process.env.AI_REVIEWER_MAX_FILES
    delete process.env.AI_REVIEWER_MAX_FILES
    try {
      const r = await run({platform: 'gitlab', body: '@ai-reviewer configuration'})
      expect(r.message).toContain('默认值（未设置')
    } finally {
      if (before != null) process.env.AI_REVIEWER_MAX_FILES = before
    }
  })

  test('GitLab：显式设置过的项标为来自 CI 变量', async () => {
    process.env.AI_REVIEWER_MAX_FILES = '99'
    try {
      const r = await run({platform: 'gitlab', body: '@ai-reviewer configuration'})
      const row = r.message.split('\n').find(l => l.startsWith('| max_files '))
      expect(row).toContain('CI 变量 `AI_REVIEWER_MAX_FILES`')
      expect(row).not.toContain('默认值')
    } finally {
      delete process.env.AI_REVIEWER_MAX_FILES
    }
  })

  test('GitLab 上把强制关闭的项标注出来，而不是只显示 false', async () => {
    const r = await run({platform: 'gitlab', body: '@ai-reviewer configuration'})

    expect(r.message).toContain('enable_shell')
    expect(r.message).toContain('LOCAL-001')
    expect(r.message).toContain('LOCAL-002')
  })

  test('不泄露任何敏感值', async () => {
    const r = await run({body: '@ai-reviewer configuration'})

    // 匹配 secret 的**字面形态**，不匹配「API Key」这种词——正文末尾那句
    // 「API Key、PAT、Trigger token 不会在此显示」本身就含这个词，
    // 按词匹配等于守卫被自己的正确表述判为泄露（这个坑踩过两次）。
    expect(r.message).not.toMatch(/sk-[A-Za-z0-9]/)
    expect(r.message).not.toMatch(/glpat-[A-Za-z0-9]/)
    expect(r.message).not.toMatch(/gh[pous]_[A-Za-z0-9]/)
  })

  test('显示当前自动审查状态', async () => {
    statefulDescription()
    await run({body: '@ai-reviewer pause'})
    const r = await run({body: '@ai-reviewer configuration'})

    expect(r.message).toContain('paused')
  })
})

// ═════════════════ CMD-023：help ════════════════════════════════════════════

describe('CMD-023 help：命令、权限、前缀、评论身份', () => {
  test('列出全部已注册命令', async () => {
    const r = await run({body: '@ai-reviewer help'})

    for (const c of ['review', 'full review', 'summary', 'pause', 'resume', 'configuration']) {
      expect(r.message).toContain(c)
    }
  })

  test('GitLab 上把权限名翻译成 access level', async () => {
    const r = await run({platform: 'gitlab', body: '@ai-reviewer help'})

    expect(r.message).toContain('Developer(30)')
    expect(r.message).toContain('Reporter(20)')
  })

  test('展示触发前缀，且包含配置的真实账号', async () => {
    const r = await run({body: '@ai-reviewer help'})

    expect(r.message).toContain('@ai-reviewer')
    expect(r.message).toContain('身份发表评论')
  })

  test('说明作者豁免与 fail closed 规则', async () => {
    const r = await run({body: '@ai-reviewer help'})

    expect(r.message).toContain('豁免')
    expect(r.message).toContain('权限查询失败')
  })
})

// ═════════════════ CMD-026：无权限 / 重复 / 旧 SHA / API 部分失败 ════════════

describe('CMD-026：每个命令的失败路径', () => {
  const needsPermission = COMMANDS.filter(c => c.minPermission !== 'read')

  test.each(needsPermission.map(c => [c.name]))(
    '%s：权限不足 → FORBIDDEN，且不产生副作用',
    async command => {
      platformState.getCollaboratorPermission.mockResolvedValue('read')

      const r = await run({body: `@ai-reviewer ${command}`, actor: 'stranger'})

      expect(r.outcome.error).toBe('FORBIDDEN')
      expect(r.triggered).toEqual([])
      expect(platformState.updateChangeRequestBody).not.toHaveBeenCalled()
      expect(platformState.resolveThreads).not.toHaveBeenCalled()
    }
  )

  /**
   * 对照组。help 的 minPermission 是 read，同样条件下必须放行——否则上面那批
   * FORBIDDEN 可能只是「所有命令都被无差别拒了」，证明不了权限矩阵真的生效。
   */
  test('对照组：read 权限下 help 仍可执行', async () => {
    platformState.getCollaboratorPermission.mockResolvedValue('read')

    const r = await run({body: '@ai-reviewer help', actor: 'stranger'})

    expect(r.outcome.error).toBeUndefined()
    expect(r.message).toContain('支持的命令')
  })

  test.each(COMMAND_NAMES.map(n => [n]))(
    '%s：权限查询失败 → fail closed（CMD-016）',
    async command => {
      platformState.getCollaboratorPermission.mockRejectedValue(new Error('500'))

      const r = await run({body: `@ai-reviewer ${command}`, actor: 'stranger'})

      expect(r.outcome.ok).toBe(false)
      expect(r.triggered).toEqual([])
      expect(platformState.updateChangeRequestBody).not.toHaveBeenCalled()
      expect(platformState.resolveThreads).not.toHaveBeenCalled()
    }
  )

  test.each(COMMAND_NAMES.map(n => [n]))('%s：重复事件 → DUPLICATE，不重复执行', async cmd => {
    const first = await run({body: `@ai-reviewer ${cmd}`, commentId: 5555})
    expect(first.outcome.error).toBeUndefined()

    const posted = platformState.createComment.mock.calls.map((c: any[]) => c[3]).join('\n')
    platformState.listComments.mockResolvedValue([{id: 1, body: posted, author: 'ai-reviewer'}])
    platformState.updateChangeRequestBody.mockClear()
    platformState.resolveThreads.mockClear()

    const again = await run({body: `@ai-reviewer ${cmd}`, commentId: 5555})

    expect(again.outcome.error).toBe('DUPLICATE')
    expect(again.triggered).toEqual([])
    expect(platformState.updateChangeRequestBody).not.toHaveBeenCalled()
    expect(platformState.resolveThreads).not.toHaveBeenCalled()
  })

  const headReaders = COMMANDS.filter(c => c.readsHead).map(c => [c.name])

  test.each(headReaders)('%s：HEAD 查询失败 → 中止，不基于未知 SHA 执行', async command => {
    await run({body: '@ai-reviewer pause'}) // review 需要 paused 才会真正执行
    platformState.createComment.mockClear()

    const r = await run({body: `@ai-reviewer ${command}`, headQueryFails: true})

    expect(r.triggered).toEqual([])
    expect(r.message).toContain('无法获取当前 HEAD')
  })

  test('审查执行中抛错 → 反馈给用户，不静默', async () => {
    const r = await run({body: '@ai-reviewer full review'}, {triggerFails: true})

    expect(r.outcome.ok).toBe(false)
    expect(r.message).not.toBe('')
  })

  test('resolve 部分失败 → 报出成功与失败条数，不谎报全成功', async () => {
    platformState.fetchUnresolvedBotThreads.mockResolvedValue([
      {id: 't1', isResolved: false, firstCommentAuthorLogin: 'ai-reviewer', path: 'a.ts', line: 1},
      {id: 't2', isResolved: false, firstCommentAuthorLogin: 'ai-reviewer', path: 'b.ts', line: 2}
    ])
    // batchResolve 逐条调用 resolveThreads([id])，返回 {failed, errors}
    platformState.resolveThreads.mockImplementation(async (ids: string[]) =>
      ids[0] === 't2'
        ? {failed: 1, errors: [new Error('Resource not accessible by integration')]}
        : {failed: 0, errors: []}
    )

    const r = await run({body: '@ai-reviewer resolve'})

    expect(r.message).toContain('成功解决')
    expect(r.message).toContain('1')
  })

  test('resolve 权限失败提示按平台给出（GitLab 不提 resolve_token）', async () => {
    platformState.fetchUnresolvedBotThreads.mockResolvedValue([
      {id: 't1', isResolved: false, firstCommentAuthorLogin: 'ai-reviewer', path: 'a.ts', line: 1}
    ])
    platformState.resolveThreads.mockResolvedValue({
      failed: 1,
      errors: [new Error('Resource not accessible by integration')]
    })

    const gitlab = await run({platform: 'gitlab', body: '@ai-reviewer resolve'})
    expect(gitlab.message).toContain('Developer(30)')
    expect(gitlab.message).not.toContain('resolve_token')

    platformState.createComment.mockClear()
    const github = await run({platform: 'github', body: '@ai-reviewer resolve'})
    expect(github.message).toContain('resolve_token')
  })
})
