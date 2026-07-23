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
 *
 * 2026-07-23 更新（阶段一 T4 完成后）：main.ts 改为通过
 * `createGitHubExecutionContext()` 校验 payload 形状，不再仅凭
 * `GITHUB_EVENT_NAME` 字符串分发——mock context 必须提供真实形状的
 * payload（复用 fixtures/ 下的样例），否则会在 fail-closed 分支提前退出。
 * "未知事件" 场景下的 warning 文案也相应从
 * "this action only works on push events or pull_request" 改为
 * ExecutionContextError 的 "Unsupported GitHub event: <name>"——这是本次
 * 改造的既有行为变化（技术准确性提升，非需要还原的回归），已更新断言。
 */
import {describe, expect, test, jest, beforeEach} from '@jest/globals'
import prOpenedFixture from './fixtures/pr-opened.json'
import issueCommentFixture from './fixtures/issue-comment.json'
import pullRequestReviewCommentFixture from './fixtures/pull-request-review-comment.json'

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

// mock context 必须可变（每个用例改写 eventName/payload），createGitHubExecutionContext()
// 会读取 payload 里的 pull_request/comment/issue 等真实字段做形状校验。
const mockContext: any = {
  eventName: '',
  actor: 'test-user',
  payload: {},
  repo: {owner: 'octo', repo: 'demo'}
}
jest.mock('@actions/github', () => ({context: mockContext}))

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

/** 各事件对应的真实形状 payload（对齐 createGitHubExecutionContext 的字段读取） */
const PAYLOAD_BY_EVENT: Record<string, any> = {
  pull_request: {...prOpenedFixture, action: 'opened'},
  pull_request_target: {...prOpenedFixture, action: 'opened'},
  issue_comment: issueCommentFixture,
  pull_request_review_comment: pullRequestReviewCommentFixture,
  push: {}
}

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
    mockContext.eventName = eventName
    mockContext.payload = PAYLOAD_BY_EVENT[eventName] ?? {}
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

    const [execCtx, lightBot, heavyBot] = reviewState.codeReview.mock.calls[0] as any[]
    expect(execCtx.eventKind).toBe('pr_opened')
    expect(execCtx.changeRequestId).toBe(42)
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
    expect(arg.execCtx.eventKind).toBe('comment_created')
  })

  test('pull_request_review_comment → 先 tryEarlyReaction 再 handleCommentEvent，不调用 codeReview', async () => {
    await runMain('pull_request_review_comment')

    expect(earlyReactionState.tryEarlyReaction).toHaveBeenCalledTimes(1)
    expect(commandHandlerState.handleCommentEvent).toHaveBeenCalledTimes(1)
    expect(reviewState.codeReview).not.toHaveBeenCalled()

    const arg = commandHandlerState.handleCommentEvent.mock.calls[0][0] as any
    expect(arg.execCtx.eventKind).toBe('review_comment_created')
  })

  test('未知事件（如 push）→ fail closed 分支：只 warning "Unsupported GitHub event"，不调用 codeReview / handleCommentEvent', async () => {
    await runMain('push')

    expect(reviewState.codeReview).not.toHaveBeenCalled()
    expect(commandHandlerState.handleCommentEvent).not.toHaveBeenCalled()
    expect(earlyReactionState.tryEarlyReaction).not.toHaveBeenCalled()
    expect(coreState.setFailed).not.toHaveBeenCalled()
    expect(coreState.warning).toHaveBeenCalledWith(
      expect.stringContaining('Unsupported GitHub event: push')
    )
  })

  test('pull_request 事件但 payload 缺少 pull_request 字段 → fail closed（setFailed，不调用模型）', async () => {
    process.env.GITHUB_EVENT_NAME = 'pull_request'
    mockContext.eventName = 'pull_request'
    mockContext.payload = {action: 'opened'} // 缺少 pull_request 字段
    jest.resetModules()
    await import('../../src/main')
    await new Promise(resolve => setImmediate(resolve))

    expect(reviewState.codeReview).not.toHaveBeenCalled()
    expect(commandHandlerState.handleCommentEvent).not.toHaveBeenCalled()
    expect(coreState.setFailed).toHaveBeenCalledTimes(1)
    expect(coreState.setFailed.mock.calls[0][0]).toContain(
      'Failed to build ExecutionContext'
    )
  })
})
