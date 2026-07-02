/**
 * command-handler.ts - 评论事件的顶层入口
 *
 * 被 main.ts 调用，用于处理 issue_comment 与 pull_request_review_comment 事件。
 *
 * 职责:
 *   1. 启动命令注册表（只需一次）
 *   2. 调用 dispatcher 处理事件
 */
import {info} from '@actions/core'
import {bootstrapCommands} from './commands/bootstrap'
import {dispatchCommentEvent} from './commands/dispatcher'
import type {Bot} from './bot'
import type {ReviewCommandMode} from './commands/types'
import type {Options} from './options'
import type {Prompts} from './prompts'
import {codeReview} from './review'

export interface HandleCommentEventDeps {
  heavyBot?: Bot
  lightBot?: Bot
  getReviewBots?: () => {heavyBot: Bot; lightBot: Bot} | null
  options: Options
  prompts: Prompts
}

export async function handleCommentEvent(
  deps: HandleCommentEventDeps
): Promise<void> {
  bootstrapCommands()

  const triggerReview = async (mode: ReviewCommandMode): Promise<void> => {
    const bots =
      deps.lightBot != null && deps.heavyBot != null
        ? {lightBot: deps.lightBot, heavyBot: deps.heavyBot}
        : deps.getReviewBots?.()

    if (bots == null) {
      throw new Error('OpenAI bot is unavailable for review command')
    }

    await codeReview(bots.lightBot, bots.heavyBot, deps.options, deps.prompts, {
      mode: mode === 'incremental' ? 'incremental' : 'full',
      source: 'command',
      summaryOnly: mode === 'summary'
    })
  }

  const outcome = await dispatchCommentEvent({
    options: deps.options,
    triggerReview
  })

  info(`commentEvent dispatcher outcome: ${JSON.stringify(outcome)}`)

  if (outcome.kind === 'fallback_conversation') {
    info('commentEvent: fallback_conversation is no longer used')
  }
}
