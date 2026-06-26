/**
 * command-handler.ts - 评论事件的顶层入口
 *
 * 被 main.ts 调用，用于处理 issue_comment 与 pull_request_review_comment 事件。
 *
 * 职责:
 *   1. 启动命令注册表（只需一次）
 *   2. 调用 dispatcher 处理事件
 *   3. 当 dispatcher 判定为 "fallback_conversation" 时，
 *      透传给成员 D 的对话式追问处理器 handleConversation，
 *      但仅当事件是 pull_request_review_comment 时才透传
 *      （issue_comment 场景的对话暂不支持）。
 */
import {info} from '@actions/core'
// eslint-disable-next-line camelcase
import {context as github_context} from '@actions/github'
import {bootstrapCommands} from './commands/bootstrap'
import {dispatchCommentEvent} from './commands/dispatcher'
import type {Bot} from './bot'
import type {ReviewCommandMode} from './commands/types'
import type {Options} from './options'
import type {Prompts} from './prompts'
import {codeReview} from './review'
import {handleConversation} from './conversation'

// eslint-disable-next-line camelcase
const context = github_context

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
    if (context.eventName === 'pull_request_review_comment') {
      const bots =
        deps.heavyBot != null
          ? {heavyBot: deps.heavyBot}
          : deps.getReviewBots?.()
      if (bots == null) {
        info(
          'commentEvent: conversation fallback skipped (OpenAI bot unavailable)'
        )
        return
      }
      // 对话式追问（成员 D · 2.3）仅支持 pull_request_review_comment。
      // handleConversation 已取代旧的 handleReviewComment（含意图识别 / 轮次上限 /
      // 上下文截断），两者都会向 thread 回帖，**不可同时调用**，否则重复回复 + 双倍 LLM 开销。
      await handleConversation(bots.heavyBot, deps.options, deps.prompts)
    } else {
      info(
        'commentEvent: conversation fallback skipped (issue_comment 对话暂不支持)'
      )
    }
  }
}
