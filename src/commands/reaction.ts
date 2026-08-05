/**
 * commands/reaction.ts - 命令 ACK 表情反应
 *
 * 当 dispatcher 识别到 `@bot <cmd>` 时，会在用户原评论上打一个表情反应
 * （默认 👀），以在正文回复之前先给一个可见的 "收到" 信号。
 *
 * 设计要点：
 * - content 值来自 action input `command_ack_reaction`，通过 options 透传
 * - 空字符串 / 'off' / 'none' 视为禁用
 * - 非法值会被丢弃并给 warning，不阻塞命令执行
 * - issue_comment 与 pull_request_review_comment 走不同 endpoint
 * - 任何失败都只打 warning，不让命令主流程受影响
 */
import {getPlatform} from '../platform/git-platform'
import {getLogger} from '../platform/logger'
import type {CommandEventName} from './types'

/** GitHub Reactions API 支持的合法取值 */
export type ReactionContent =
  | '+1'
  | '-1'
  | 'laugh'
  | 'confused'
  | 'heart'
  | 'hooray'
  | 'rocket'
  | 'eyes'

const VALID_REACTIONS: readonly ReactionContent[] = [
  '+1',
  '-1',
  'laugh',
  'confused',
  'heart',
  'hooray',
  'rocket',
  'eyes'
]

/**
 * 把 raw 配置归一化为合法的 ReactionContent；不合法或禁用时返回 null。
 */
export function normalizeReaction(raw: string | undefined): ReactionContent | null {
  if (raw == null) return null
  const trimmed = raw.trim().toLowerCase()
  if (trimmed === '' || trimmed === 'off' || trimmed === 'none' || trimmed === 'false') {
    return null
  }
  if ((VALID_REACTIONS as readonly string[]).includes(trimmed)) {
    return trimmed as ReactionContent
  }
  getLogger().warning(
    `command_ack_reaction "${raw}" is not a valid GitHub reaction ` +
      `(expected one of ${VALID_REACTIONS.join(', ')}); ACK reaction will be skipped.`
  )
  return null
}

export interface AckReactionParams {
  owner: string
  repo: string
  commentId: number
  eventName: CommandEventName
  /** 原始 options.commandAckReaction 值 */
  rawReaction: string | undefined
}

/**
 * 在触发命令的用户评论上加表情反应。失败只 warning，不抛错。
 */
export async function addAckReaction(params: AckReactionParams): Promise<void> {
  const content = normalizeReaction(params.rawReaction)
  if (content == null) {
    return
  }

  const logger = getLogger()
  try {
    const commentKind =
      params.eventName === 'pull_request_review_comment' ? 'review_comment' : 'issue_comment'
    await getPlatform().addReaction(
      params.owner,
      params.repo,
      params.commentId,
      content,
      commentKind
    )
    logger.info(
      `ack reaction "${content}" added on ${params.eventName} commentId=${params.commentId}`
    )
  } catch (e) {
    logger.warning(
      `addAckReaction failed (content=${content}, commentId=${params.commentId}): ${String(e)}`
    )
  }
}
