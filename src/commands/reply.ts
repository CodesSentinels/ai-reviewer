/**
 * commands/reply.ts - 统一评论回复工具
 *
 * 所有命令的输出必须经过此层，确保:
 * - 格式一致（Greeting + tag + body）
 * - 幂等标签（PROCESSED_TAG）统一注入
 * - ACK / 成功 / 失败 / 进度 四种状态通过 create+update 串联
 * - 错误码 → 用户可读文案的映射集中维护
 *
 * 设计要点:
 * - ack() 返回 ackId（新建的评论 id），失败时返回 null（降级为直接 reply）
 * - success/error 若收到 ackId 则 updateComment，否则 createComment
 * - error 文案带错误码，便于日志与用户排查
 */
import {getCommentGreeting} from '../commenter'
import {getPlatform} from '../platform/git-platform'
import {getLogger} from '../platform/logger'
import type {ErrorCode, Reply as IReply} from './types'

/** 命令回复评论的幂等标签前缀 */
export const CMD_REPLY_TAG_PREFIX = '<!-- codesentinel-cmd-reply'

export interface ReplyContext {
  owner: string
  repo: string
  /** Issue / PR number（issue_comment 和 PR 是同一 number） */
  issueNumber: number
  /** 原始触发评论的 id */
  originalCommentId: number
  /** 命令名（写入 tag 用于去重） */
  commandName: string
  /** 事件类型：当为 pull_request_review_comment 时回复到 thread */
  eventName?: 'issue_comment' | 'pull_request_review_comment'
}

/** 组装幂等 tag */
export function buildCmdReplyTag(
  originalCommentId: number,
  commandName: string
): string {
  return `${CMD_REPLY_TAG_PREFIX}:${originalCommentId}:${commandName} -->`
}

/** 错误码 → 用户可读文案 */
export function formatErrorMessage(code: ErrorCode, detail?: string): string {
  const base = ERROR_MESSAGES[code] ?? '命令执行出错'
  return detail ? `${base}\n\n详情: ${detail}` : base
}

const ERROR_MESSAGES: Record<ErrorCode, string> = {
  UNKNOWN_COMMAND:
    '❓ **未知命令**。发送 `@ai-reviewer help` 查看支持的命令列表。',
  INVALID_ARGS:
    '⚠️ **参数不合法**。命令参数仅接受字母、数字以及 `._-/:=` 字符。',
  FORBIDDEN: '🚫 **权限不足**。执行该命令需要仓库 `write` 及以上权限。',
  BOT_FORBIDDEN:
    '🚫 **Bot 权限不足**。请检查 workflow `permissions` 配置（pull-requests: write / contents: read）。',
  NOT_IMPLEMENTED: '🚧 **命令暂未实现**。该命令已在路线图中，等待实现。',
  RATE_LIMITED:
    '⏱️ **请求过于频繁**。同一用户在 60 秒内最多执行 10 条命令，请稍后再试。',
  DUPLICATE: 'ℹ️ **命令已处理**（重复事件已去重）。',
  INTERNAL: '💥 **命令执行失败**。错误已记录，请联系维护者。'
}

/**
 * Reply 实现
 */
export class Reply implements IReply {
  constructor(private readonly ctx: ReplyContext) {}

  async ack(message: string): Promise<number | null> {
    const body = this.wrap(`⏳ ${message}`)
    const platform = getPlatform()
    try {
      if (this.ctx.eventName === 'pull_request_review_comment') {
        const res = await platform.replyToReviewComment(
          this.ctx.owner,
          this.ctx.repo,
          this.ctx.issueNumber,
          this.ctx.originalCommentId,
          body
        )
        return res.id
      }
      const res = await platform.createComment(
        this.ctx.owner,
        this.ctx.repo,
        this.ctx.issueNumber,
        body
      )
      return res.id
    } catch (e) {
      getLogger().warning(`reply.ack failed: ${String(e)}`)
      return null
    }
  }

  async success(message: string, ackId?: number | null): Promise<void> {
    const body = this.wrap(message)
    await this.publish(body, ackId)
  }

  async error(
    code: ErrorCode,
    detail?: string,
    ackId?: number | null
  ): Promise<void> {
    const body = this.wrap(
      `${formatErrorMessage(code, detail)}\n\n\`错误码: ${code}\``
    )
    await this.publish(body, ackId)
    getLogger().info(`command error [${code}] ${detail ?? ''}`)
  }

  async progress(message: string, ackId: number): Promise<void> {
    const body = this.wrap(`⏳ ${message}`)
    try {
      await getPlatform().updateComment(
        this.ctx.owner,
        this.ctx.repo,
        ackId,
        body
      )
    } catch (e) {
      getLogger().warning(`reply.progress update failed: ${String(e)}`)
    }
  }

  /** 新建或更新评论 */
  private async publish(body: string, ackId?: number | null): Promise<void> {
    const platform = getPlatform()
    const logger = getLogger()
    if (ackId != null) {
      try {
        await platform.updateComment(this.ctx.owner, this.ctx.repo, ackId, body)
        return
      } catch (e) {
        logger.warning(
          `reply.publish update failed, falling back to create: ${String(e)}`
        )
      }
    }
    // 行级评论场景：回复到同一 review thread
    if (this.ctx.eventName === 'pull_request_review_comment') {
      try {
        await platform.replyToReviewComment(
          this.ctx.owner,
          this.ctx.repo,
          this.ctx.issueNumber,
          this.ctx.originalCommentId,
          body
        )
        return
      } catch (e) {
        logger.warning(
          `reply.publish review thread reply failed, falling back to issue comment: ${String(
            e
          )}`
        )
      }
    }
    try {
      await platform.createComment(
        this.ctx.owner,
        this.ctx.repo,
        this.ctx.issueNumber,
        body
      )
    } catch (e) {
      logger.warning(`reply.publish create failed: ${String(e)}`)
    }
  }

  private wrap(message: string): string {
    const tag = buildCmdReplyTag(
      this.ctx.originalCommentId,
      this.ctx.commandName
    )
    return `${tag}\n${getCommentGreeting()} · \`${
      this.ctx.commandName
    }\`\n\n${message}`
  }
}

/**
 * 扫描 issue 已有评论，判断该 (commentId, commandName) 是否已被处理过。
 * 用于 dispatcher 的幂等检查。
 */
export async function hasBeenProcessed(
  owner: string,
  repo: string,
  issueNumber: number,
  originalCommentId: number,
  commandName: string
): Promise<boolean> {
  const tag = buildCmdReplyTag(originalCommentId, commandName)
  try {
    const comments = await getPlatform().listComments(owner, repo, issueNumber)
    for (const c of comments) {
      if (typeof c.body === 'string' && c.body.includes(tag)) {
        return true
      }
    }
    return false
  } catch (e) {
    getLogger().warning(
      `hasBeenProcessed failed: ${String(e)} — treating as not processed`
    )
    return false
  }
}
