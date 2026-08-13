/**
 * orchestrator 单元测试（ARCH-025~027）
 *
 * 覆盖：
 * - handleExecCtxError：unknown_event → skip，其他 → fatal
 * - dispatchEvent：pr_* → codeReview，comment_* → handleCommentEvent，其他 → skip
 * - runOrchestrator：ConfigError fail-closed，完整编排流程
 */
import {describe, expect, test, jest, beforeEach} from '@jest/globals'
import type {Bot} from '../src/bot'
import {ExecutionContextError} from '../src/platform/execution-context'
import type {Logger} from '../src/platform/logger'

// mock 依赖模块，避免拉起真实 Bot/review/commenter
jest.mock('../src/commenter', () => ({
  initBotGreeting: jest.fn(),
  getCommentGreeting: () => 'bot'
}))
jest.mock('../src/review', () => ({
  codeReview: jest.fn<() => Promise<void>>().mockResolvedValue(undefined)
}))
jest.mock('../src/command-handler', () => ({
  handleCommentEvent: jest.fn<() => Promise<void>>().mockResolvedValue(undefined)
}))

import {handleExecCtxError, dispatchEvent, runOrchestrator} from '../src/platform/orchestrator'
import {codeReview} from '../src/review'
import {handleCommentEvent} from '../src/command-handler'
import {ConfigError} from '../src/platform/config-provider'

function mockLogger(): Logger {
  return {
    info: jest.fn(),
    warning: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}

function mockExecCtx(eventKind: string): any {
  return {
    platform: 'github',
    eventKind,
    changeRequestId: 42,
    headSha: 'abc123',
    baseSha: 'def456',
    projectPath: 'owner/repo'
  }
}

describe('handleExecCtxError（ARCH-026）', () => {
  test('unknown_event → skip，不调用 onFailed', () => {
    const logger = mockLogger()
    const onFailed = jest.fn()
    const err = new ExecutionContextError('unknown', 'github', 'unknown_event')
    const result = handleExecCtxError(err, logger, onFailed)
    expect(result).toBe('skip')
    expect(logger.warning).toHaveBeenCalled()
    expect(onFailed).not.toHaveBeenCalled()
  })

  test('其他 ExecutionContextError → fatal + onFailed', () => {
    const logger = mockLogger()
    const onFailed = jest.fn()
    const err = new ExecutionContextError('bad payload', 'github', 'missing_required_field')
    const result = handleExecCtxError(err, logger, onFailed)
    expect(result).toBe('fatal')
    expect(onFailed).toHaveBeenCalledWith(
      expect.stringContaining('Failed to build ExecutionContext')
    )
  })

  test('普通 Error → fatal + onFailed 带 backtrace', () => {
    const logger = mockLogger()
    const onFailed = jest.fn()
    const result = handleExecCtxError(new Error('boom'), logger, onFailed)
    expect(result).toBe('fatal')
    expect(onFailed).toHaveBeenCalledWith(expect.stringContaining('boom'))
  })

  test('非 Error 值 → fatal + onFailed', () => {
    const logger = mockLogger()
    const onFailed = jest.fn()
    const result = handleExecCtxError('string error', logger, onFailed)
    expect(result).toBe('fatal')
    expect(onFailed).toHaveBeenCalled()
  })
})

describe('dispatchEvent（ARCH-027）', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('pr_opened → codeReview', async () => {
    const bots = {lightBot: {} as any, heavyBot: {} as any}
    await dispatchEvent({
      execCtx: mockExecCtx('pr_opened'),
      options: {} as any,
      prompts: {} as any,
      logger: mockLogger(),
      createBots: () => bots
    })
    expect(codeReview).toHaveBeenCalledTimes(1)
    expect(handleCommentEvent).not.toHaveBeenCalled()
  })

  test('pr_synchronize → codeReview', async () => {
    await dispatchEvent({
      execCtx: mockExecCtx('pr_synchronize'),
      options: {} as any,
      prompts: {} as any,
      logger: mockLogger(),
      createBots: () => ({lightBot: {} as any, heavyBot: {} as any})
    })
    expect(codeReview).toHaveBeenCalledTimes(1)
  })

  test('comment_created → handleCommentEvent', async () => {
    await dispatchEvent({
      execCtx: mockExecCtx('comment_created'),
      options: {} as any,
      prompts: {} as any,
      logger: mockLogger(),
      createBots: () => ({lightBot: {} as any, heavyBot: {} as any})
    })
    expect(handleCommentEvent).toHaveBeenCalledTimes(1)
    expect(codeReview).not.toHaveBeenCalled()
  })

  test('review_comment_created → handleCommentEvent', async () => {
    await dispatchEvent({
      execCtx: mockExecCtx('review_comment_created'),
      options: {} as any,
      prompts: {} as any,
      logger: mockLogger(),
      createBots: () => ({lightBot: {} as any, heavyBot: {} as any})
    })
    expect(handleCommentEvent).toHaveBeenCalledTimes(1)
  })

  test('metadata_updated → skip（不调用模型）', async () => {
    const logger = mockLogger()
    await dispatchEvent({
      execCtx: mockExecCtx('metadata_updated'),
      options: {} as any,
      prompts: {} as any,
      logger,
      createBots: jest.fn<() => {lightBot: Bot; heavyBot: Bot} | null>()
    })
    expect(codeReview).not.toHaveBeenCalled()
    expect(handleCommentEvent).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('does not trigger model calls')
    )
  })

  test('createBots 返回 null → 不调用 codeReview', async () => {
    await dispatchEvent({
      execCtx: mockExecCtx('pr_opened'),
      options: {} as any,
      prompts: {} as any,
      logger: mockLogger(),
      createBots: () => null
    })
    expect(codeReview).not.toHaveBeenCalled()
  })
})

describe('runOrchestrator（ARCH-025）', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('ConfigError → onFailed 且不调用模型', async () => {
    const onFailed = jest.fn()
    await runOrchestrator({
      configProvider: {
        platform: 'github',
        getOptions: () => {
          throw new ConfigError('bad', 'github', 'max_files')
        },
        getPromptConfig: () => ({summarize: '', summarizeReleaseNotes: ''}),
        getBotConfig: () => ({icon: '', name: '', platformLogin: ''}),
        print: () => {}
      },
      createExecCtx: () => mockExecCtx('pr_opened'),
      logger: mockLogger(),
      onFailed,
      createBots: () => ({lightBot: {} as any, heavyBot: {} as any})
    })
    expect(onFailed).toHaveBeenCalledWith(expect.stringContaining('Configuration error'))
    expect(codeReview).not.toHaveBeenCalled()
  })

  test('unknown_event → 跳过，不 onFailed', async () => {
    const onFailed = jest.fn()
    const logger = mockLogger()
    await runOrchestrator({
      configProvider: {
        platform: 'github',
        getOptions: () =>
          ({
            botIcon: 'x',
            botName: 'y',
            commandAckReaction: ''
          } as any),
        getPromptConfig: () => ({summarize: '', summarizeReleaseNotes: ''}),
        getBotConfig: () => ({icon: '', name: '', platformLogin: ''}),
        print: () => {}
      },
      createExecCtx: () => {
        throw new ExecutionContextError('unknown', 'github', 'unknown_event')
      },
      logger,
      onFailed,
      createBots: () => ({lightBot: {} as any, heavyBot: {} as any})
    })
    expect(onFailed).not.toHaveBeenCalled()
    expect(logger.warning).toHaveBeenCalled()
  })

  test('正常 pr_opened → codeReview 被调用', async () => {
    const onFailed = jest.fn()
    await runOrchestrator({
      configProvider: {
        platform: 'github',
        getOptions: () =>
          ({
            botIcon: 'x',
            botName: 'y',
            commandAckReaction: ''
          } as any),
        getPromptConfig: () => ({summarize: '', summarizeReleaseNotes: ''}),
        getBotConfig: () => ({icon: '', name: '', platformLogin: ''}),
        print: () => {}
      },
      createExecCtx: () => mockExecCtx('pr_opened'),
      logger: mockLogger(),
      onFailed,
      createBots: () => ({lightBot: {} as any, heavyBot: {} as any})
    })
    expect(onFailed).not.toHaveBeenCalled()
    expect(codeReview).toHaveBeenCalledTimes(1)
  })
})
