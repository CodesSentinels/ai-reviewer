/**
 * platform/orchestrator.ts - 平台无关运行时编排（ARCH-025~027）
 *
 * 从 main.ts 中抽取的共享编排逻辑：
 * - dispatchEvent：eventKind → codeReview/handleCommentEvent/skip（ARCH-027）
 * - runOrchestrator：完整编排流程（ARCH-025），供两个入口复用
 *
 * handleExecCtxError 已拆到 exec-ctx-error-handler.ts（ARCH-026），
 * 避免 gitlab-trigger.ts 通过本模块间接拉入 GitHub 侧依赖。
 *
 * 不 import @actions/core——日志和错误处理通过回调参数注入。
 */

import type {Bot} from '../bot'
import {initBotGreeting} from '../commenter'
import {handleCommentEvent} from '../command-handler'
import type {Options} from '../options'
import type {ConfigProvider} from './config-provider'
import {ConfigError} from './config-provider'
import {handleExecCtxError} from './exec-ctx-error-handler'
import type {ExecutionContext} from './execution-context'
import type {Logger} from './logger'
import {Prompts} from '../prompts'
import {codeReview} from '../review'

// re-export 供已有消费方（tests/main.ts）不需要改 import 路径
export {handleExecCtxError} from './exec-ctx-error-handler'

/**
 * 事件分发（ARCH-027）。
 *
 * 将 eventKind 映射到共享核心的处理函数：
 * - pr_opened/pr_synchronize/pr_reopened → codeReview
 * - comment_created/review_comment_created → handleCommentEvent
 * - 其余 → skip
 */
export async function dispatchEvent(deps: {
  execCtx: ExecutionContext
  options: Options
  prompts: Prompts
  logger: Logger
  createBots: () => {lightBot: Bot; heavyBot: Bot} | null
}): Promise<void> {
  const {execCtx, options, prompts, logger, createBots} = deps

  if (
    execCtx.eventKind === 'pr_opened' ||
    execCtx.eventKind === 'pr_synchronize' ||
    execCtx.eventKind === 'pr_reopened'
  ) {
    const bots = createBots()
    if (bots == null) return
    await codeReview(execCtx, bots.lightBot, bots.heavyBot, options, prompts)
  } else if (
    execCtx.eventKind === 'comment_created' ||
    execCtx.eventKind === 'review_comment_created'
  ) {
    await handleCommentEvent({
      execCtx,
      options,
      prompts,
      getReviewBots: createBots
    })
  } else {
    logger.info(`Skipped: eventKind ${execCtx.eventKind} does not trigger model calls`)
  }
}

/** 编排依赖注入（ARCH-025） */
export interface OrchestratorDeps {
  configProvider: ConfigProvider
  createExecCtx: () => ExecutionContext
  logger: Logger

  onFailed: (msg: string) => void

  createBots: (options: Options) => {lightBot: Bot; heavyBot: Bot} | null

  earlyReaction?: (execCtx: ExecutionContext, reaction: string) => Promise<void>
}

/**
 * 完整运行时编排（ARCH-025）。
 *
 * 配置读取 → 构造 ExecutionContext → 事件分发 → 错误处理。
 * main.ts 和 gitlab-trigger.ts 调用此函数，只需提供平台差异部分。
 */
export async function runOrchestrator(deps: OrchestratorDeps): Promise<void> {
  const {configProvider, createExecCtx, logger, onFailed, createBots} = deps

  // 1. 读取配置（ConfigError → fail closed）
  let options: Options
  try {
    options = configProvider.getOptions()
    initBotGreeting(options.botIcon, options.botName)
    configProvider.print((msg: string) => logger.info(msg))
  } catch (e) {
    if (e instanceof ConfigError) {
      onFailed(`Configuration error [${e.platform}:${e.field}]: ${e.message}`)
    } else if (e instanceof Error) {
      onFailed(`Failed to read configuration: ${e.message}`)
    } else {
      onFailed(`Failed to read configuration: ${e}`)
    }
    return
  }

  // 2. 构造 ExecutionContext
  let execCtx: ExecutionContext
  try {
    execCtx = createExecCtx()
  } catch (e) {
    handleExecCtxError(e, logger, onFailed)
    return
  }

  logger.info(`Event: platform=${execCtx.platform} eventKind=${execCtx.eventKind}`)

  // 3. 评论事件 ACK
  if (
    deps.earlyReaction &&
    (execCtx.eventKind === 'comment_created' || execCtx.eventKind === 'review_comment_created')
  ) {
    await deps.earlyReaction(execCtx, options.commandAckReaction)
  }

  // 4. 构建提示词
  const promptConfig = configProvider.getPromptConfig()
  const prompts = new Prompts(promptConfig.summarize, promptConfig.summarizeReleaseNotes)

  // 5. 事件分发
  try {
    await dispatchEvent({
      execCtx,
      options,
      prompts,
      logger,
      createBots: () => createBots(options)
    })
  } catch (e: any) {
    if (e instanceof Error) {
      onFailed(`Failed to run: ${e.message}, backtrace: ${e.stack}`)
    } else {
      onFailed(`Failed to run: ${e}, backtrace: ${e.stack}`)
    }
  }
}
