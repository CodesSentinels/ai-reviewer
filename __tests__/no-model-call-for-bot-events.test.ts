/**
 * no-model-call-for-bot-events.test.ts — bot/system/self 事件不调用模型（§14.4 TEST-028）
 *
 * 反馈循环是这个项目最贵的失败模式：reviewer 自己的回帖再次触发命令，每一轮都
 * 是一次完整的模型调用，而且没有任何东西会喊停。所以「谁的评论不该进入模型流程」
 * 必须钉死在**模型边界**上，而不是钉在「日志里打了 ignored」上。
 *
 * 已有覆盖（本文件不重复）：
 *   github-execution-context.test.ts  GitHub 侧 isBot 的推导（user.type / [bot] 后缀）
 *   command-mention-identity.test.ts  GitLab 侧 isBot 的推导（CMD-006 权威命名）
 *   gitlab-note-hook-rules.test.ts    system note / 非 MR note 判定
 *   orchestrator.test.ts              metadata_updated → skip
 *
 * 那些验的都是「判定本身对不对」。本文件验的是**判定的后果**：判成 bot/self 之后，
 * 模型层到底有没有被碰。断言一律落在三个可观测的模型入口上——
 * `getReviewBots`（构造 Bot 的工厂）、`codeReview`、两个 conversation 入口——
 * 任何一个被调用都算失败。
 *
 * 每组都带一个真人对照组：少了它，「模型没被调用」可能只是因为整条链路根本没通。
 */
import {describe, expect, test, jest, beforeEach} from '@jest/globals'

jest.mock('@actions/core', () => ({info: jest.fn(), warning: jest.fn(), error: jest.fn()}))

const reviewState = {codeReview: jest.fn<(...a: any[]) => Promise<void>>()}
jest.mock('../src/review', () => ({codeReview: (...a: any[]) => reviewState.codeReview(...a)}))

const conversationState = {
  handleConversation: jest.fn<(...a: any[]) => Promise<void>>(),
  handleIssueConversation: jest.fn<(...a: any[]) => Promise<void>>()
}
jest.mock('../src/conversation', () => ({
  handleConversation: (...a: any[]) => conversationState.handleConversation(...a),
  handleIssueConversation: (...a: any[]) => conversationState.handleIssueConversation(...a)
}))

/**
 * commenter 保持真实——命令链路上有好几处间接依赖它（`review-commit-ids` 要
 * `Commenter`/`summarizeTag`，reply 要 `getCommentGreeting`）。只把 `isOwnAuthor`
 * 换成可控替身：它代表「平台能不能查出这条评论是不是我自己发的」，正是本文件
 * 要枚举的三种取值（是 / 不是 / 查不出）。
 */
const commenterState = {
  isOwnAuthor: jest.fn<(login: string) => Promise<boolean | null>>()
}
jest.mock('../src/commenter', () => {
  const actual = jest.requireActual('../src/commenter') as any
  return {...actual, isOwnAuthor: (login: string) => commenterState.isOwnAuthor(login)}
})

const platformCalls = {
  createComment: jest.fn<(...a: any[]) => Promise<any>>(),
  replyToReviewComment: jest.fn<(...a: any[]) => Promise<any>>(),
  addReaction: jest.fn<(...a: any[]) => Promise<any>>()
}

jest.mock('../src/platform/git-platform', () => {
  const actual = jest.requireActual('../src/platform/git-platform') as any
  return {
    ...actual,
    getPlatform: () => ({
      getChangeRequest: async () => ({
        number: 42,
        title: 't',
        body: 'b',
        state: 'open',
        baseSha: 'b'.repeat(40),
        headSha: 'a'.repeat(40),
        baseRef: 'main',
        headRef: 'feat',
        author: 'alice'
      }),
      getCollaboratorPermission: async () => 'write',
      getAuthenticatedLogin: async () => 'ai-reviewer-pat',
      listComments: async () => [],
      listReviewComments: async () => [],
      listChangeRequestCommits: async () => [],
      getFileContent: async () => null,
      updateComment: async () => undefined,
      updateChangeRequestBody: async () => undefined,
      createComment: platformCalls.createComment,
      replyToReviewComment: platformCalls.replyToReviewComment,
      addReaction: platformCalls.addReaction
    })
  }
})

import {handleCommentEvent} from '../src/command-handler'
import type {Platform} from '../src/platform/execution-context'

// ─── 模型边界 ───────────────────────────────────────────────────────────────

/** 三个模型入口的统一探针：任何一个被碰过就算「调用了模型」 */
function modelProbe(): {
  getReviewBots: () => {lightBot: any; heavyBot: any}
  wasTouched: () => boolean
  detail: () => string
} {
  const lightChat = jest.fn()
  const heavyChat = jest.fn()
  const factory = jest.fn(() => ({
    lightBot: {chat: lightChat},
    heavyBot: {chat: heavyChat}
  }))
  return {
    getReviewBots: factory as any,
    wasTouched: () =>
      factory.mock.calls.length > 0 ||
      lightChat.mock.calls.length > 0 ||
      heavyChat.mock.calls.length > 0 ||
      reviewState.codeReview.mock.calls.length > 0 ||
      conversationState.handleConversation.mock.calls.length > 0 ||
      conversationState.handleIssueConversation.mock.calls.length > 0,
    detail: () =>
      JSON.stringify({
        createBots: factory.mock.calls.length,
        lightChat: lightChat.mock.calls.length,
        heavyChat: heavyChat.mock.calls.length,
        codeReview: reviewState.codeReview.mock.calls.length,
        conversation: conversationState.handleConversation.mock.calls.length,
        issueConversation: conversationState.handleIssueConversation.mock.calls.length
      })
  }
}

// ─── 事件夹具 ───────────────────────────────────────────────────────────────

interface ActorSpec {
  login: string
  isBot: boolean
}

function execCtxFor(
  platform: Platform,
  actor: ActorSpec,
  body: string,
  eventKind: 'comment_created' | 'review_comment_created' = 'comment_created'
): any {
  return {
    platform,
    projectPath: 'octo/demo',
    projectId: platform === 'gitlab' ? '77' : 'octo/demo',
    changeRequestId: 42,
    eventKind,
    actor,
    baseSha: '',
    headSha: '',
    comment: {
      kind: eventKind === 'comment_created' ? 'top_level' : 'review_thread',
      id: 5001,
      body,
      path: 'src/a.ts',
      line: 3
    },
    raw: {}
  }
}

const OPTIONS: any = {botLogin: '', pathFilters: {check: () => true}}
const PROMPTS: any = {}

/** 跑一次评论事件，返回模型是否被碰过 */
async function runComment(execCtx: any): Promise<{touched: boolean; detail: string}> {
  const probe = modelProbe()
  await handleCommentEvent({
    execCtx,
    options: OPTIONS,
    prompts: PROMPTS,
    getReviewBots: probe.getReviewBots as any
  })
  return {touched: probe.wasTouched(), detail: probe.detail()}
}

const PLATFORMS: Platform[] = ['github', 'gitlab']

/** 期望值。失败时断言输出直接是「哪个模型入口被碰了几次」，不用再去翻日志 */
const NO_MODEL_CALL = 'no model call'
function noModelCall(r: {touched: boolean; detail: string}): string {
  return r.touched ? r.detail : NO_MODEL_CALL
}

describe('bot/system/self 事件不调用模型（TEST-028）', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    reviewState.codeReview.mockResolvedValue(undefined)
    conversationState.handleConversation.mockResolvedValue(undefined)
    conversationState.handleIssueConversation.mockResolvedValue(undefined)
    // 默认：身份可解析，且评论者不是 reviewer 自己
    commenterState.isOwnAuthor.mockResolvedValue(false)
    platformCalls.createComment.mockResolvedValue({id: 1})
    platformCalls.replyToReviewComment.mockResolvedValue({id: 1})
    platformCalls.addReaction.mockResolvedValue(undefined)
  })

  // ─── 1. bot 账号 ──────────────────────────────────────────────────────────

  describe('bot 账号发的评论', () => {
    for (const platform of PLATFORMS) {
      test(`${platform}：带合法命令的 bot 评论 → 模型零调用`, async () => {
        const r = await runComment(
          execCtxFor(
            platform,
            {login: 'github-actions[bot]', isBot: true},
            '@ai-reviewer full review'
          )
        )
        expect(noModelCall(r)).toBe(NO_MODEL_CALL)
      })

      test(`${platform}：bot 发的行级评论同样零调用`, async () => {
        const r = await runComment(
          execCtxFor(
            platform,
            {login: 'ai-bot[bot]', isBot: true},
            '@ai-reviewer 这段能不能优化',
            'review_comment_created'
          )
        )
        expect(noModelCall(r)).toBe(NO_MODEL_CALL)
      })
    }

    test('对照组：同样的正文由真人发出 → 模型确实被调用（证明上面不是空跑）', async () => {
      const r = await runComment(
        execCtxFor('github', {login: 'alice', isBot: false}, '@ai-reviewer full review')
      )
      expect(r.touched).toBe(true)
    })
  })

  // ─── 2. self（reviewer 自己的账号）─────────────────────────────────────────

  describe('reviewer 自己发的评论', () => {
    /**
     * 以真实账号（PAT / machine user）身份运行时，自己的评论**不带** `[bot]`
     * 后缀，`actor.isBot` 判不出来。
     *
     * GitLab 入口在 EVENT-018 把这种情况补成 `isBot=true` 再交给共享 dispatcher；
     * GitHub 那条路径没有等价物。两边都必须收敛到同一个结果，否则同一份配置在
     * GitHub 上就是一个自问自答的死循环。
     */
    for (const platform of PLATFORMS) {
      test(`${platform}：身份查得出是自己（isBot=false）→ 仍然零调用`, async () => {
        commenterState.isOwnAuthor.mockResolvedValue(true)
        const r = await runComment(
          execCtxFor(platform, {login: 'ai-reviewer-pat', isBot: false}, '@ai-reviewer full review')
        )
        expect(noModelCall(r)).toBe(NO_MODEL_CALL)
      })
    }

    test('GitLab 入口已把自评论标成 isBot → 共享层照样拦住', async () => {
      // EVENT-018 的产物形态：actor.isBot 被入口改写为 true
      const r = await runComment(
        execCtxFor('gitlab', {login: 'ai-reviewer-pat', isBot: true}, '@ai-reviewer full review')
      )
      expect(noModelCall(r)).toBe(NO_MODEL_CALL)
    })

    test('对照组：身份查得出不是自己 → 正常执行（不是把所有人都挡了）', async () => {
      commenterState.isOwnAuthor.mockResolvedValue(false)
      const r = await runComment(
        execCtxFor('github', {login: 'bob', isBot: false}, '@ai-reviewer full review')
      )
      expect(r.touched).toBe(true)
    })

    test('身份查不出来（null）→ 不因此把真人的命令一并挡下', async () => {
      // 这里刻意不 fail closed：身份解析失败是常态（token 缺 scope、API 抖动），
      // 一律拦下会让命令系统整体失效。真正的反馈循环由 isBot 与自评论 marker
      // 两道防线兜底，见 conversation.ts 的 REVIEW-018。
      commenterState.isOwnAuthor.mockResolvedValue(null)
      const r = await runComment(
        execCtxFor('github', {login: 'carol', isBot: false}, '@ai-reviewer full review')
      )
      expect(r.touched).toBe(true)
    })
  })

  // ─── 3. system 事件 ───────────────────────────────────────────────────────

  describe('system / 非评论事件', () => {
    for (const platform of PLATFORMS) {
      test(`${platform}：metadata_updated 不进入命令流程，模型零调用`, async () => {
        const ctx = execCtxFor(platform, {login: 'alice', isBot: false}, '@ai-reviewer full review')
        ctx.eventKind = 'metadata_updated'
        const r = await runComment(ctx)
        expect(noModelCall(r)).toBe(NO_MODEL_CALL)
      })

      test(`${platform}：unknown 事件同样零调用`, async () => {
        const ctx = execCtxFor(platform, {login: 'alice', isBot: false}, '@ai-reviewer full review')
        ctx.eventKind = 'unknown'
        const r = await runComment(ctx)
        expect(noModelCall(r)).toBe(NO_MODEL_CALL)
      })
    }
  })

  // ─── 4. 未 @ bot 的普通讨论 ────────────────────────────────────────────────

  describe('真人之间的普通讨论', () => {
    for (const platform of PLATFORMS) {
      test(`${platform}：没有 @ bot 的评论不触发模型`, async () => {
        const r = await runComment(
          execCtxFor(platform, {login: 'alice', isBot: false}, '这段代码我觉得没问题')
        )
        expect(noModelCall(r)).toBe(NO_MODEL_CALL)
      })
    }

    /**
     * 自评论过滤要查一次平台身份，而 PR 上绝大多数评论根本没 @ 过 bot。
     * 判定放在 parse 之后正是为了不让普通讨论付这次查询——把顺序调回 parse
     * 之前的话，每一条闲聊都会多打一次 API。
     */
    test('没有 @ bot 时根本不去查身份（不为普通讨论付这次 API）', async () => {
      await runComment(execCtxFor('github', {login: 'alice', isBot: false}, '这段代码我觉得没问题'))
      expect(commenterState.isOwnAuthor).not.toHaveBeenCalled()
    })

    test('对照组：@ 了 bot 才查身份（证明上一条不是「永远不查」）', async () => {
      await runComment(execCtxFor('github', {login: 'alice', isBot: false}, '@ai-reviewer help'))
      expect(commenterState.isOwnAuthor).toHaveBeenCalledWith('alice')
    })

    test('bot 账号的评论连身份都不用查（isBot 已经足够判定）', async () => {
      await runComment(execCtxFor('github', {login: 'x[bot]', isBot: true}, '@ai-reviewer help'))
      expect(commenterState.isOwnAuthor).not.toHaveBeenCalled()
    })
  })

  // ─── 5. 两平台结论一致 ────────────────────────────────────────────────────

  describe('同一类 actor 在两平台得到同样的结论', () => {
    const CASES: Array<{name: string; actor: ActorSpec; own: boolean | null}> = [
      {name: 'bot 账号', actor: {login: 'x[bot]', isBot: true}, own: false},
      {
        name: 'reviewer 自己（PAT 身份）',
        actor: {login: 'ai-reviewer-pat', isBot: false},
        own: true
      },
      {name: '真人', actor: {login: 'alice', isBot: false}, own: false}
    ]

    for (const c of CASES) {
      test(`${c.name}：GitHub 与 GitLab 的结论相同`, async () => {
        commenterState.isOwnAuthor.mockResolvedValue(c.own)
        const gh = await runComment(execCtxFor('github', c.actor, '@ai-reviewer full review'))
        jest.clearAllMocks()
        commenterState.isOwnAuthor.mockResolvedValue(c.own)
        platformCalls.createComment.mockResolvedValue({id: 1})
        platformCalls.addReaction.mockResolvedValue(undefined)
        const gl = await runComment(execCtxFor('gitlab', c.actor, '@ai-reviewer full review'))

        expect(noModelCall(gh)).toBe(noModelCall(gl))
      })
    }
  })
})
