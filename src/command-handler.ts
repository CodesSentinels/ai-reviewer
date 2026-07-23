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
 *
 * ARCH-005：不再直接 import `@actions/github`，事件类型判断改用调用方
 * （main.ts）传入的 ExecutionContext.eventKind。
 */
import {info} from '@actions/core'
import {bootstrapCommands} from './commands/bootstrap'
import {dispatchCommentEvent} from './commands/dispatcher'
import type {Bot} from './bot'
import type {ReviewCommandMode} from './commands/types'
import type {Options} from './options'
import type {ExecutionContext} from './platform/execution-context'
import type {Prompts} from './prompts'
import {codeReview} from './review'
import {handleConversation, handleIssueConversation} from './conversation'

export interface HandleCommentEventDeps {
  execCtx: ExecutionContext
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

    await codeReview(
      deps.execCtx,
      bots.lightBot,
      bots.heavyBot,
      deps.options,
      deps.prompts,
      {
        mode: mode === 'incremental' ? 'incremental' : 'full',
        source: 'command',
        summaryOnly: mode === 'summary'
      }
    )
  }

  const outcome = await dispatchCommentEvent({
    execCtx: deps.execCtx,
    options: deps.options,
    triggerReview
  })

  info(`commentEvent dispatcher outcome: ${JSON.stringify(outcome)}`)

  if (outcome.kind === 'fallback_conversation') {
    // 行级评论与主评论区对话共用 heavyBot；仅在需要时构造。
    const bots =
      deps.heavyBot != null ? {heavyBot: deps.heavyBot} : deps.getReviewBots?.()
    if (bots == null) {
      info(
        'commentEvent: conversation fallback skipped (OpenAI bot unavailable)'
      )
      return
    }

    if (deps.execCtx.eventKind === 'review_comment_created') {
      // 行级评论对话式追问（含意图识别 / 轮次上限 / 上下文截断）。
      // handleConversation 与 handleIssueConversation 都会回帖，按事件类型二选一，
      // **不可同时调用**，否则重复回复 + 双倍 LLM 开销。
      await handleConversation(deps.execCtx, bots.heavyBot, deps.options, deps.prompts)
    } else if (deps.execCtx.eventKind === 'comment_created') {
      // PR 主评论区对话式追问（整个 PR 上下文 + 幂等去重 + 无关问题婉拒）。
      await handleIssueConversation(
        deps.execCtx,
        bots.heavyBot,
        deps.options,
        deps.prompts
      )
    } else {
      info(
        `commentEvent: conversation fallback skipped (unsupported eventKind ${deps.execCtx.eventKind})`
      )
    }
  }
}
