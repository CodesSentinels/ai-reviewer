/**
 * main.characterization.test.ts — 改造前特征化测试（阶段零 · C3）
 *
 * 目的：main.ts 当前零单元测试覆盖，是 ExecutionContext 改造（ARCH-001~006）
 * 入口层重写的第一个文件。本测试钉死改造前的事件分发行为基线：
 *   - GITHUB_EVENT_NAME 决定走 codeReview 还是 handleCommentEvent
 *   - 评论类事件（issue_comment / pull_request_review_comment）触发 tryEarlyReaction，
 *     pull_request 类事件不触发
 *   - 未知事件类型只 warning，不调用 codeReview / handleCommentEvent
 *
 * 改造后（main.ts 消费 ExecutionContext）须原样重跑本文件全部用例。
 * 参考 docs/tasks/execution-context-design.md 第 9.0 节。
 */
import {describe, expect, test, jest, beforeEach} from '@jest/globals'

// --- mocks（复用 __tests__/command-dispatcher.test.ts 的既有约定） ---

const coreState = {
  getInput: jest.fn().mockReturnValue(''),
  getBooleanInput: jest.fn().mockReturnValue(false),
  getMultilineInput: jest.fn().mockReturnValue([]),
  info: jest.fn(),
  warning: jest.fn(),
  error: jest.fn(),
  setFailed: jest.fn()
}
jest.mock('@actions/core', () => ({
  getInput: (...a: any[]) => coreState.getInput(...a),
  getBooleanInput: (...a: any[]) => coreState.getBooleanInput(...a),
  getMultilineInput: (...a: any[]) => coreState.getMultilineInput(...a),
  info: (...a: any[]) => coreState.info(...a),
  warning: (...a: any[]) => coreState.warning(...a),
  error: (...a: any[]) => coreState.error(...a),
  setFailed: (...a: any[]) => coreState.setFailed(...a)
}))

jest.mock('@actions/github', () => ({context: {eventName: '', payload: {}, repo: {owner: 'octo', repo: 'demo'}}}))

// main.ts 是 `new Bot(...)`（非 type-only），必须 mock 掉，否则会因缺少
// OPENAI_API_KEY 在 createBots() 内部抛错，导致 codeReview 分支永远走不到。
const botInstance = {chat: jest.fn()}
jest.mock('../../src/bot', () => ({
  Bot: jest.fn().mockImplementation(() => botInstance),
  // 不关心构造参数，返回值形状对本测试无意义（Bot 本身也被整体 mock 掉了）
  OpenAIOptions: jest.fn()
}))

const reviewState = {codeReview: jest.fn<(...a: any[]) => Promise<void>>().mockResolvedValue(undefined)}
jest.mock('../../src/review', () => ({codeReview: (...a: any[]) => reviewState.codeReview(...a)}))

const commandHandlerState = {
  handleCommentEvent: jest.fn<(...a: any[]) => Promise<void>>().mockResolvedValue(undefined)
}
jest.mock('../../src/command-handler', () => ({
  handleCommentEvent: (...a: any[]) => commandHandlerState.handleCommentEvent(...a)
}))

const earlyReactionState = {
  tryEarlyReaction: jest.fn<(...a: any[]) => Promise<void>>().mockResolvedValue(undefined)
}
jest.mock('../../src/commands/early-reaction', () => ({
  tryEarlyReaction: (...a: any[]) => earlyReactionState.tryEarlyReaction(...a)
}))

describe('main.ts run() — 改造前事件分发行为基线', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    coreState.getInput.mockReturnValue('')
    coreState.getBooleanInput.mockReturnValue(false)
    coreState.getMultilineInput.mockReturnValue([])
    reviewState.codeReview.mockResolvedValue(undefined)
    commandHandlerState.handleCommentEvent.mockResolvedValue(undefined)
    earlyReactionState.tryEarlyReaction.mockResolvedValue(undefined)
  })

  async function runMain(eventName: string): Promise<void> {
    process.env.GITHUB_EVENT_NAME = eventName
    jest.resetModules()
    // main.ts 顶层直接 `await run()`，import 该模块即触发执行
    await import('../../src/main')
    // 让内部尚未 flush 的微任务（early reaction / codeReview 的 mock resolve）走完
    await new Promise(resolve => setImmediate(resolve))
  }

  test('pull_request(opened) → 调用 codeReview，不调用 handleCommentEvent / tryEarlyReaction', async () => {
    await runMain('pull_request')

    expect(reviewState.codeReview).toHaveBeenCalledTimes(1)
    expect(commandHandlerState.handleCommentEvent).not.toHaveBeenCalled()
    expect(earlyReactionState.tryEarlyReaction).not.toHaveBeenCalled()

    const [lightBot, heavyBot] = reviewState.codeReview.mock.calls[0] as any[]
    expect(lightBot).toBe(botInstance)
    expect(heavyBot).toBe(botInstance)
  })

  test('pull_request_target → 与 pull_request 行为一致（走同一 codeReview 分支）', async () => {
    await runMain('pull_request_target')

    expect(reviewState.codeReview).toHaveBeenCalledTimes(1)
    expect(commandHandlerState.handleCommentEvent).not.toHaveBeenCalled()
  })

  test('issue_comment → 先 tryEarlyReaction 再 handleCommentEvent，不调用 codeReview', async () => {
    await runMain('issue_comment')

    expect(earlyReactionState.tryEarlyReaction).toHaveBeenCalledTimes(1)
    expect(commandHandlerState.handleCommentEvent).toHaveBeenCalledTimes(1)
    expect(reviewState.codeReview).not.toHaveBeenCalled()

    const arg = commandHandlerState.handleCommentEvent.mock.calls[0][0] as any
    expect(typeof arg.getReviewBots).toBe('function')
  })

  test('pull_request_review_comment → 先 tryEarlyReaction 再 handleCommentEvent，不调用 codeReview', async () => {
    await runMain('pull_request_review_comment')

    expect(earlyReactionState.tryEarlyReaction).toHaveBeenCalledTimes(1)
    expect(commandHandlerState.handleCommentEvent).toHaveBeenCalledTimes(1)
    expect(reviewState.codeReview).not.toHaveBeenCalled()
  })

  test('未知事件（如 push）→ 只 warning，不调用 codeReview / handleCommentEvent', async () => {
    await runMain('push')

    expect(reviewState.codeReview).not.toHaveBeenCalled()
    expect(commandHandlerState.handleCommentEvent).not.toHaveBeenCalled()
    expect(earlyReactionState.tryEarlyReaction).not.toHaveBeenCalled()
    expect(coreState.warning).toHaveBeenCalledWith(
      expect.stringContaining('this action only works on push events or pull_request')
    )
  })
})
