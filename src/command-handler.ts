/**
 * command-handler.ts - 评论事件的顶层入口
 *
 * 被 main.ts 调用，用于处理 issue_comment 与 pull_request_review_comment 事件。
 *
 * 职责:
 *   1. 启动命令注册表（只需一次）
 *   2. 调用 dispatcher 处理事件
 *   3. 当 dispatcher 判定为 "fallback_conversation" 时，
 *      透传给既有的 handleReviewComment（对话式追问），
 *      但仅当事件是 pull_request_review_comment 时才透传
 *      （issue_comment 场景的对话由迭代二成员 D 后续扩展）。
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
import {handleReviewComment} from './review-comment'

// eslint-disable-next-line camelcase
const context = github_context

export interface HandleCommentEventDeps {
  heavyBot: Bot
  lightBot: Bot
  options: Options
  prompts: Prompts
}

export async function handleCommentEvent(
  deps: HandleCommentEventDeps
): Promise<void> {
  bootstrapCommands()

  const triggerReview = async (mode: ReviewCommandMode): Promise<void> => {
    await codeReview(deps.lightBot, deps.heavyBot, deps.options, deps.prompts, {
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
    // 既有对话式追问仅支持 pull_request_review_comment
    if (context.eventName === 'pull_request_review_comment') {
      await handleReviewComment(deps.heavyBot, deps.options, deps.prompts)
    } else {
      info(
        'commentEvent: conversation fallback skipped (issue_comment 对话由后续迭代支持)'
      )
    }
  }
}
