/**
 * command-handler.test.ts — handleCommentEvent() 回归测试（U4）
 *
 * command-handler.ts 在 ARCH-005/T5 完成了全量迁移（execCtx 取代直接
 * import @actions/github），但此前没有任何专门测试覆盖过它。本文件补齐这块
 * 覆盖，验证 execCtx 正确透传给 dispatchCommentEvent/codeReview，以及
 * fallback_conversation 分支按 execCtx.eventKind 正确二选一（不误触发/不双发）。
 * 对齐 docs/tasks/execution-context-design.md 第 9.2 节 U4 / TODO TEST-001。
 */
import {describe, expect, test, jest, beforeEach} from '@jest/globals'

jest.mock('@actions/core', () => ({
  info: jest.fn()
}))

const bootstrapState = {bootstrapCommands: jest.fn()}
jest.mock('./../src/commands/bootstrap', () => ({
  bootstrapCommands: (...a: any[]) => bootstrapState.bootstrapCommands(...a)
}))

const dispatcherState = {
  dispatchCommentEvent: jest.fn<(...a: any[]) => Promise<any>>()
}
jest.mock('./../src/commands/dispatcher', () => ({
  dispatchCommentEvent: (...a: any[]) => dispatcherState.dispatchCommentEvent(...a)
}))

const reviewState = {codeReview: jest.fn<(...a: any[]) => Promise<void>>()}
jest.mock('./../src/review', () => ({
  codeReview: (...a: any[]) => reviewState.codeReview(...a)
}))

const conversationState = {
  handleConversation: jest.fn<(...a: any[]) => Promise<void>>(),
  handleIssueConversation: jest.fn<(...a: any[]) => Promise<void>>()
}
jest.mock('./../src/conversation', () => ({
  handleConversation: (...a: any[]) => conversationState.handleConversation(...a),
  handleIssueConversation: (...a: any[]) => conversationState.handleIssueConversation(...a)
}))

import {handleCommentEvent} from '../src/command-handler'

function makeExecCtx(overrides: Record<string, any> = {}): any {
  return {
    platform: 'github',
    projectPath: 'octo/demo',
    projectId: 'octo/demo',
    changeRequestId: 42,
    eventKind: 'comment_created',
    actor: {login: 'alice', isBot: false},
    baseSha: '',
    headSha: '',
    raw: {},
    ...overrides
  }
}

const stubOptions: any = {}
const stubPrompts: any = {}
const lightBot: any = {chat: jest.fn()}
const heavyBot: any = {chat: jest.fn()}

describe('handleCommentEvent()', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    dispatcherState.dispatchCommentEvent.mockResolvedValue({kind: 'ignored', reason: 'x'})
    reviewState.codeReview.mockResolvedValue(undefined)
    conversationState.handleConversation.mockResolvedValue(undefined)
    conversationState.handleIssueConversation.mockResolvedValue(undefined)
  })

  test('始终调用 bootstrapCommands()', async () => {
    await handleCommentEvent({execCtx: makeExecCtx(), options: stubOptions, prompts: stubPrompts})
    expect(bootstrapState.bootstrapCommands).toHaveBeenCalledTimes(1)
  })

  test('把 execCtx 和 options 透传给 dispatchCommentEvent，并提供 triggerReview 函数', async () => {
    const execCtx = makeExecCtx()
    await handleCommentEvent({execCtx, options: stubOptions, prompts: stubPrompts})

    expect(dispatcherState.dispatchCommentEvent).toHaveBeenCalledTimes(1)
    const arg = dispatcherState.dispatchCommentEvent.mock.calls[0][0] as any
    expect(arg.execCtx).toBe(execCtx)
    expect(arg.options).toBe(stubOptions)
    expect(typeof arg.triggerReview).toBe('function')
  })

  test('triggerReview("incremental") 调用 codeReview，execCtx 作为首参，mode=incremental', async () => {
    const execCtx = makeExecCtx()
    dispatcherState.dispatchCommentEvent.mockImplementation(async (deps: any) => {
      await deps.triggerReview('incremental')
      return {kind: 'executed', command: 'review', ok: true}
    })

    await handleCommentEvent({
      execCtx,
      lightBot,
      heavyBot,
      options: stubOptions,
      prompts: stubPrompts
    })

    expect(reviewState.codeReview).toHaveBeenCalledTimes(1)
    const [ctxArg, lb, hb, opts, prompts, runOptions] = reviewState.codeReview.mock
      .calls[0] as any[]
    expect(ctxArg).toBe(execCtx)
    expect(lb).toBe(lightBot)
    expect(hb).toBe(heavyBot)
    expect(opts).toBe(stubOptions)
    expect(prompts).toBe(stubPrompts)
    expect(runOptions).toEqual({mode: 'incremental', source: 'command', summaryOnly: false})
  })

  test('triggerReview("full") → mode=full, summaryOnly=false', async () => {
    dispatcherState.dispatchCommentEvent.mockImplementation(async (deps: any) => {
      await deps.triggerReview('full')
      return {kind: 'executed', command: 'full review', ok: true}
    })

    await handleCommentEvent({
      execCtx: makeExecCtx(),
      lightBot,
      heavyBot,
      options: stubOptions,
      prompts: stubPrompts
    })

    const runOptions = reviewState.codeReview.mock.calls[0][5]
    expect(runOptions).toEqual({mode: 'full', source: 'command', summaryOnly: false})
  })

  test('triggerReview("summary") → mode=full（非 incremental）, summaryOnly=true', async () => {
    dispatcherState.dispatchCommentEvent.mockImplementation(async (deps: any) => {
      await deps.triggerReview('summary')
      return {kind: 'executed', command: 'summary', ok: true}
    })

    await handleCommentEvent({
      execCtx: makeExecCtx(),
      lightBot,
      heavyBot,
      options: stubOptions,
      prompts: stubPrompts
    })

    const runOptions = reviewState.codeReview.mock.calls[0][5]
    expect(runOptions).toEqual({mode: 'full', source: 'command', summaryOnly: true})
  })

  test('triggerReview：lightBot/heavyBot 和 getReviewBots 均不可用时抛错，不调用 codeReview', async () => {
    dispatcherState.dispatchCommentEvent.mockImplementation(async (deps: any) => {
      await expect(deps.triggerReview('incremental')).rejects.toThrow(
        'OpenAI bot is unavailable for review command'
      )
      return {kind: 'executed', command: 'review', ok: false}
    })

    await handleCommentEvent({execCtx: makeExecCtx(), options: stubOptions, prompts: stubPrompts})
    expect(reviewState.codeReview).not.toHaveBeenCalled()
  })

  test('triggerReview：优先用直接传入的 lightBot/heavyBot，其次才用 getReviewBots()', async () => {
    const getReviewBots = jest.fn(() => ({lightBot, heavyBot}))
    dispatcherState.dispatchCommentEvent.mockImplementation(async (deps: any) => {
      await deps.triggerReview('incremental')
      return {kind: 'executed', command: 'review', ok: true}
    })

    await handleCommentEvent({
      execCtx: makeExecCtx(),
      lightBot,
      heavyBot,
      getReviewBots,
      options: stubOptions,
      prompts: stubPrompts
    })

    expect(getReviewBots).not.toHaveBeenCalled()
    expect(reviewState.codeReview).toHaveBeenCalledTimes(1)
  })

  test('outcome.kind !== fallback_conversation → 不触发任何对话式追问', async () => {
    dispatcherState.dispatchCommentEvent.mockResolvedValue({
      kind: 'executed',
      command: 'review',
      ok: true
    })

    await handleCommentEvent({
      execCtx: makeExecCtx({eventKind: 'review_comment_created'}),
      heavyBot,
      options: stubOptions,
      prompts: stubPrompts
    })

    expect(conversationState.handleConversation).not.toHaveBeenCalled()
    expect(conversationState.handleIssueConversation).not.toHaveBeenCalled()
  })

  test('fallback_conversation + eventKind=review_comment_created → 调用 handleConversation，不调用 handleIssueConversation', async () => {
    dispatcherState.dispatchCommentEvent.mockResolvedValue({kind: 'fallback_conversation'})
    const execCtx = makeExecCtx({eventKind: 'review_comment_created'})

    await handleCommentEvent({execCtx, heavyBot, options: stubOptions, prompts: stubPrompts})

    expect(conversationState.handleConversation).toHaveBeenCalledTimes(1)
    expect(conversationState.handleConversation).toHaveBeenCalledWith(
      execCtx,
      heavyBot,
      stubOptions,
      stubPrompts
    )
    expect(conversationState.handleIssueConversation).not.toHaveBeenCalled()
  })

  test('fallback_conversation + eventKind=comment_created → 调用 handleIssueConversation，不调用 handleConversation', async () => {
    dispatcherState.dispatchCommentEvent.mockResolvedValue({kind: 'fallback_conversation'})
    const execCtx = makeExecCtx({eventKind: 'comment_created'})

    await handleCommentEvent({execCtx, heavyBot, options: stubOptions, prompts: stubPrompts})

    expect(conversationState.handleIssueConversation).toHaveBeenCalledTimes(1)
    expect(conversationState.handleIssueConversation).toHaveBeenCalledWith(
      execCtx,
      heavyBot,
      stubOptions,
      stubPrompts
    )
    expect(conversationState.handleConversation).not.toHaveBeenCalled()
  })

  test('fallback_conversation + 不支持的 eventKind（如 pr_opened）→ 两个对话处理器都不调用', async () => {
    dispatcherState.dispatchCommentEvent.mockResolvedValue({kind: 'fallback_conversation'})

    await handleCommentEvent({
      execCtx: makeExecCtx({eventKind: 'pr_opened'}),
      heavyBot,
      options: stubOptions,
      prompts: stubPrompts
    })

    expect(conversationState.handleConversation).not.toHaveBeenCalled()
    expect(conversationState.handleIssueConversation).not.toHaveBeenCalled()
  })

  test('fallback_conversation 但 heavyBot 和 getReviewBots 均不可用 → 静默跳过，不抛错', async () => {
    dispatcherState.dispatchCommentEvent.mockResolvedValue({kind: 'fallback_conversation'})

    await expect(
      handleCommentEvent({
        execCtx: makeExecCtx({eventKind: 'comment_created'}),
        options: stubOptions,
        prompts: stubPrompts
      })
    ).resolves.toBeUndefined()

    expect(conversationState.handleConversation).not.toHaveBeenCalled()
    expect(conversationState.handleIssueConversation).not.toHaveBeenCalled()
  })
})
