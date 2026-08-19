/**
 * gitlab-trigger-dispatch.integration.test.ts — GitLab 入口 → 共享核心的**真实**
 * 端到端链路（REVIEW-001 / CMD-003 / EVENT-018）
 *
 * 为什么单独建这个文件：gitlab-trigger.test.ts 验的是入口自身的校验与日志，
 * 新加的接线断言只检查源码里出没出现 `runOrchestrator(`——那种断言证明不了
 * 事件真的流到了 codeReview / dispatcher。事实上第一版接线就有两处断链，
 * 45/45 全绿却一条都没抓到：
 *
 *   1. GitLab note 上下文没填 comment.body，而 dispatcher 以
 *      `typeof comment.body === 'string'` 判定「可解析的评论」——
 *      结果**所有** GitLab 命令在解析前就被当成 missing comment body 丢弃；
 *   2. actor.isBot 恒为 false，isSelfNote() 没接进任何生产路径——
 *      bot 自己的回帖会再次触发命令，形成反馈循环。
 *
 * 所以这里一律断言**下游可观测的副作用**（平台 API 被怎么调用），不看日志文本，
 * 也不看源码字符串。
 */
import {describe, expect, test, jest, beforeEach, afterEach} from '@jest/globals'
import * as realFs from 'fs'
import * as os from 'os'
import * as path from 'path'

// ─── 依赖替身 ──────────────────────────────────────────────────────────────
// Bot 的 p-retry 是纯 ESM，tokenizer 在加载期要 wasm——都与本文件关注点无关
jest.mock('../src/bot-factory', () => ({
  createBots: () => ({
    lightBot: {chat: jest.fn(async () => ['', {}, []])},
    heavyBot: {chat: jest.fn(async () => ['', {}, []])}
  })
}))
jest.mock('../src/tokenizer', () => ({getTokenCount: () => 0}))

/** 记录所有平台侧写操作，断言只看它们 */
const platformCalls = {
  createComment: jest.fn<(...a: any[]) => Promise<any>>(),
  addReaction: jest.fn<(...a: any[]) => Promise<any>>(),
  compareDiff: jest.fn<(...a: any[]) => Promise<any>>(),
  replyToReviewComment: jest.fn<(...a: any[]) => Promise<any>>()
}

const BOT_LOGIN = 'ai-reviewer-bot'

/**
 * 自检结果可控：设为 Error 时模拟凭据无法解析身份（401 / 网络故障）。
 *
 * 必须从 gitbeaker 这一层控制——verifyBotIdentity 拿的是入口自己 new 出来的
 * GitLabPlatform 实例，不经过被 mock 的 getPlatform()。先前把开关放在
 * getPlatform() 的替身里，结果自检始终成功，那两条降级用例全是空跑。
 */
let credentialIdentity: string | Error = BOT_LOGIN

/**
 * 用真实的 GitLabPlatform 会把断言拖进 gitbeaker 的实现细节，这里只替换
 * getPlatform()——被测对象是「入口 → 编排 → 共享核心」这段链路本身。
 */
jest.mock('../src/platform/git-platform', () => {
  const actual = jest.requireActual('../src/platform/git-platform') as any
  return {
    ...actual,
    getPlatform: () => ({
      getAuthenticatedLogin: async () => BOT_LOGIN,
      getChangeRequest: async () => ({
        number: 42,
        title: 'MR title',
        body: 'MR body',
        state: 'open',
        baseSha: 'b'.repeat(40),
        headSha: 'a'.repeat(40),
        baseRef: 'main',
        headRef: 'feature',
        author: 'alice'
      }),
      getCollaboratorPermission: async () => 'write',
      listComments: async () => [],
      listReviewComments: async () => [],
      listChangeRequestCommits: async () => [],
      getFileContent: async () => null,
      listRepositoryTree: async () => ({files: [], truncated: false}),
      updateComment: async () => undefined,
      updateChangeRequestBody: async () => undefined,
      createComment: platformCalls.createComment,
      addReaction: platformCalls.addReaction,
      compareDiff: platformCalls.compareDiff,
      replyToReviewComment: platformCalls.replyToReviewComment
    })
  }
})

// GitLabPlatform 构造时会实例化 gitbeaker 客户端，挡掉真实网络
jest.mock('@gitbeaker/rest', () => ({
  Gitlab: jest.fn().mockImplementation(() => ({
    Users: {
      showCurrentUser: async () => {
        if (credentialIdentity instanceof Error) throw credentialIdentity
        return {username: credentialIdentity}
      }
    }
  }))
}))

// ─── 事件夹具 ──────────────────────────────────────────────────────────────

function mrOpenPayload(): any {
  return {
    object_kind: 'merge_request',
    project: {id: 77, path_with_namespace: 'group/demo'},
    user: {username: 'alice'},
    object_attributes: {
      iid: 42,
      action: 'open',
      source_project_id: 77,
      target_project_id: 77,
      last_commit: {id: 'a'.repeat(40)},
      oldrev: 'b'.repeat(40)
    }
  }
}

function notePayload(over: {note: string; author?: string; discussionId?: string}): any {
  return {
    object_kind: 'note',
    project: {id: 77, path_with_namespace: 'group/demo'},
    project_id: 77,
    user: {username: over.author ?? 'alice'},
    merge_request: {iid: 42, last_commit: {id: 'a'.repeat(40)}},
    object_attributes: {
      id: 9001,
      action: 'create',
      note: over.note,
      noteable_type: 'MergeRequest',
      system: false,
      discussion_id: over.discussionId,
      // 2026-08-18 真实环境验证（Issue #118）纠正：真实 GitLab 上所有 note
      // 都带 discussion_id，只有行级 diff 评论会带 type: 'DiffNote'——用
      // discussionId 是否传入模拟"这是不是行级回复"时，两个字段必须一起给，
      // 否则不代表真实场景。
      type: over.discussionId != null ? 'DiffNote' : undefined
    }
  }
}

let payloadFile: string

async function runTrigger(payload: any): Promise<void> {
  realFs.writeFileSync(payloadFile, JSON.stringify(payload), 'utf8')
  jest.resetModules()
  await import('../src/gitlab-trigger')
  // 入口是自执行的 IIFE，让出若干轮微任务等整条链路跑完
  for (let i = 0; i < 12; i++) {
    await new Promise(resolve => setImmediate(resolve))
  }
}

describe('GitLab 入口 → 共享核心（真实分发，不看日志）', () => {
  const savedEnv = {...process.env}
  let logSpy: jest.SpiedFunction<typeof console.log>

  beforeEach(() => {
    jest.clearAllMocks()
    credentialIdentity = BOT_LOGIN
    payloadFile = path.join(realFs.mkdtempSync(path.join(os.tmpdir(), 'glctx-')), 'payload.json')

    // 清空 GitHub 侧变量：GitLab runner 上不存在，共享核心必须不依赖它们
    for (const k of ['GITHUB_REPOSITORY', 'GITHUB_EVENT_PATH', 'GITHUB_EVENT_NAME']) {
      delete process.env[k]
    }
    process.env.GITLAB_HOST = 'https://gitlab.example.com'
    process.env.GITLAB_PAT = 'glpat-testtesttesttest'
    process.env.TRIGGER_PAYLOAD = payloadFile
    process.env.OPENAI_API_KEY = 'sk-test'
    process.env.AI_REVIEWER_BOT_GITLAB_LOGIN = BOT_LOGIN

    platformCalls.compareDiff.mockResolvedValue({files: [], commits: []})
    platformCalls.createComment.mockResolvedValue({id: 1, body: '', author: BOT_LOGIN})
    platformCalls.addReaction.mockResolvedValue(undefined)
    platformCalls.replyToReviewComment.mockResolvedValue({id: 2, body: '', author: BOT_LOGIN})

    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
    jest.restoreAllMocks()
    process.env = {...savedEnv}
  })

  test('MR open → 真的进入 codeReview（查了 diff），而不是止步于日志', async () => {
    await runTrigger(mrOpenPayload())

    // compareDiff 只可能由 codeReview 发起：事件确实穿过编排层到了审查核心
    expect(platformCalls.compareDiff).toHaveBeenCalled()
    const [, , base, head] = platformCalls.compareDiff.mock.calls[0] as any[]
    expect(base).toBe('b'.repeat(40))
    expect(head).toBe('a'.repeat(40))
  })

  test('顶层 note 的 @ai-reviewer 命令 → 真的被 dispatcher 执行', async () => {
    await runTrigger(notePayload({note: '@ai-reviewer help'}))

    // help 的回复经 createComment 发出；第一版接线在这里完全静默
    expect(platformCalls.createComment).toHaveBeenCalled()
    const bodies = platformCalls.createComment.mock.calls.map(c => String((c as any[])[3]))
    expect(bodies.join('\n')).toMatch(/help|命令|Commands/i)
  })

  /**
   * Issue #124（2026-08-18 真实环境验证发现）：main.ts 一直传了 earlyReaction，
   * gitlab-trigger.ts 没传，真实 GitLab 命令从未收到 Award Emoji ACK。修复后
   * 用这条真实分发路径断言 addReaction 确实被调用，而不只是检查源码字符串。
   */
  test('顶层 note 的命令 → 触发 ACK 表情反应（Issue #124）', async () => {
    await runTrigger(notePayload({note: '@ai-reviewer help'}))

    expect(platformCalls.addReaction).toHaveBeenCalled()
  })

  test('discussion note 的命令 → 回到线程，而不是主评论区', async () => {
    await runTrigger(notePayload({note: '@ai-reviewer help', discussionId: 'disc-abc'}))

    const repliedToThread = platformCalls.replyToReviewComment.mock.calls.length > 0
    const postedTopLevel = platformCalls.createComment.mock.calls.length > 0
    expect(repliedToThread || postedTopLevel).toBe(true)
    // 线程内的命令不应只落在主评论区
    if (postedTopLevel && !repliedToThread) {
      throw new Error('discussion note 的回复落到了主评论区，没有回到线程')
    }
  })

  test('reviewer 自己发的 note → 被忽略，不产生任何写操作（EVENT-018 反馈循环）', async () => {
    await runTrigger(notePayload({note: '@ai-reviewer help', author: BOT_LOGIN}))

    expect(platformCalls.createComment).not.toHaveBeenCalled()
    expect(platformCalls.replyToReviewComment).not.toHaveBeenCalled()
    expect(platformCalls.addReaction).not.toHaveBeenCalled()
  })

  test('对照组：同样内容换成别人发 → 确实会回复（证明上一条不是空跑）', async () => {
    await runTrigger(notePayload({note: '@ai-reviewer help', author: 'someone-else'}))

    expect(
      platformCalls.createComment.mock.calls.length +
        platformCalls.replyToReviewComment.mock.calls.length
    ).toBeGreaterThan(0)
  })

  /**
   * 配置过期/写错是最常见的运维事故（换了 PAT 却忘了改
   * AI_REVIEWER_BOT_GITLAB_LOGIN）。早先自检成功时只用配置值作为唯一过滤身份，
   * 于是真实账号发出的 note 认不出来——反馈循环保护恰好在最该生效的场景下失效。
   */
  describe('配置身份与凭据真实身份不一致时（EVENT-018 边界）', () => {
    beforeEach(() => {
      process.env.AI_REVIEWER_BOT_GITLAB_LOGIN = 'wrong-bot'
    })

    test('真实凭据身份发出的 note 仍必须被忽略', async () => {
      await runTrigger(notePayload({note: '@ai-reviewer help', author: BOT_LOGIN}))

      expect(platformCalls.createComment).not.toHaveBeenCalled()
      expect(platformCalls.replyToReviewComment).not.toHaveBeenCalled()
      expect(platformCalls.addReaction).not.toHaveBeenCalled()
    })

    test('配置里那个（已过期的）身份发出的 note 同样被忽略', async () => {
      await runTrigger(notePayload({note: '@ai-reviewer help', author: 'wrong-bot'}))

      expect(platformCalls.createComment).not.toHaveBeenCalled()
      expect(platformCalls.replyToReviewComment).not.toHaveBeenCalled()
    })

    test('对照组：真人发的命令照常执行（证明上面两条不是把所有人都拦了）', async () => {
      await runTrigger(notePayload({note: '@ai-reviewer help', author: 'alice'}))

      expect(platformCalls.createComment).toHaveBeenCalled()
    })
  })

  /**
   * 自检失败（401 / 网络故障）时拿不到真实身份，配置值就是**唯一**的过滤依据。
   * 这条分支是注入回退验证暴露出来的覆盖缺口：把「失败时退回配置值」删掉，
   * 当时全部用例仍然全绿。
   */
  describe('凭据自检失败时（EVENT-018 降级路径）', () => {
    beforeEach(() => {
      credentialIdentity = new Error('401 Unauthorized')
      process.env.AI_REVIEWER_BOT_GITLAB_LOGIN = BOT_LOGIN
    })

    test('仍按配置身份过滤自评论，不因为自检失败就放行', async () => {
      await runTrigger(notePayload({note: '@ai-reviewer help', author: BOT_LOGIN}))

      expect(platformCalls.createComment).not.toHaveBeenCalled()
      expect(platformCalls.replyToReviewComment).not.toHaveBeenCalled()
    })

    test('对照组：真人发的命令照常执行', async () => {
      await runTrigger(notePayload({note: '@ai-reviewer help', author: 'alice'}))

      expect(platformCalls.createComment).toHaveBeenCalled()
    })
  })

  /**
   * CMD-002：GitLab 上 bot 通常以个人 PAT 身份发言，用户凭直觉 @ 的是那个真实
   * 账号，而不是文本别名。`deps.botMentions` 此前从未被传过，两个平台都只吃默认
   * 别名——注入回退验证时把接线删掉，纯函数用例一条都不红，所以在这里钉住。
   */
  describe('CMD-002：@ 配置的真实 PAT 账号也能触发命令', () => {
    beforeEach(() => {
      process.env.AI_REVIEWER_BOT_GITLAB_LOGIN = 'my-reviewer-pat'
      credentialIdentity = 'my-reviewer-pat'
    })

    test('@my-reviewer-pat help（别人发）→ 命令被执行', async () => {
      await runTrigger(notePayload({note: '@my-reviewer-pat help', author: 'alice'}))

      expect(platformCalls.createComment).toHaveBeenCalled()
    })

    test('文本别名同时仍然有效', async () => {
      await runTrigger(notePayload({note: '@ai-reviewer help', author: 'alice'}))

      expect(platformCalls.createComment).toHaveBeenCalled()
    })

    test('@ 别的账号不触发（防止上面两条其实是「什么都能触发」）', async () => {
      await runTrigger(notePayload({note: '@someone-else help', author: 'alice'}))

      expect(platformCalls.createComment).not.toHaveBeenCalled()
    })
  })

  test('非命令的普通 note → 不触发任何命令回复', async () => {
    await runTrigger(notePayload({note: '这段代码看起来没问题'}))

    expect(platformCalls.createComment).not.toHaveBeenCalled()
    expect(platformCalls.replyToReviewComment).not.toHaveBeenCalled()
  })
})
