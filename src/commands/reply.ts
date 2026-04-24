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
import {getInput, info, warning} from '@actions/core'
import {octokit} from '../octokit'
import type {CommandEventName, ErrorCode, Reply as IReply} from './types'

/** Bot 问候图标 + 可配置名称（与 commenter.ts 对齐，但避免循环依赖） */
const GREETING = `${getInput('bot_icon') || '🤖'} ${getInput('bot_name') || 'AI Reviewer'}`

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
  /** 触发事件类型，用于判断是否需要在行级线程回帖锚点 */
  sourceEvent?: CommandEventName
  /** review_comment 事件下原始行级评论 id（用于 createReplyForReviewComment） */
  reviewCommentId?: number
  /** PR number（review_comment 发帖必填；issue_comment 可不传） */
  pullNumber?: number
}

/** 组装幂等 tag */
export function buildCmdReplyTag(
  originalCommentId: number,
  commandName: string
): string {
  return `${CMD_REPLY_TAG_PREFIX}:${originalCommentId}:${commandName} -->`
}

/** 错误码 → 用户可读文案 */
export function formatErrorMessage(
  code: ErrorCode,
  detail?: string
): string {
  const base = ERROR_MESSAGES[code] ?? '命令执行出错'
  return detail ? `${base}\n\n详情: ${detail}` : base
}

const ERROR_MESSAGES: Record<ErrorCode, string> = {
  UNKNOWN_COMMAND:
    '❓ **未知命令**。发送 `@ai-reviewer help` 查看支持的命令列表。',
  INVALID_ARGS:
    '⚠️ **参数不合法**。命令参数仅接受字母、数字以及 `._-/:=` 字符。',
  FORBIDDEN:
    '🚫 **权限不足**。执行该命令需要仓库 `write` 及以上权限。',
  BOT_FORBIDDEN:
    '🚫 **Bot 权限不足**。请检查 workflow `permissions` 配置（pull-requests: write / contents: read）。',
  NOT_IMPLEMENTED:
    '🚧 **命令暂未实现**。该命令已在路线图中，等待实现。',
  RATE_LIMITED:
    '⏱️ **请求过于频繁**。同一用户在 60 秒内最多执行 10 条命令，请稍后再试。',
  DUPLICATE:
    'ℹ️ **命令已处理**（重复事件已去重）。',
  INTERNAL:
    '💥 **命令执行失败**。错误已记录，请联系维护者。'
}

/**
 * Reply 实现
 */
export class Reply implements IReply {
  constructor(private readonly ctx: ReplyContext) {}

  async ack(message: string): Promise<number | null> {
    const body = this.wrap(`⏳ ${message}`)
    try {
      const res = await octokit.issues.createComment({
        owner: this.ctx.owner,
        repo: this.ctx.repo,
        issue_number: this.ctx.issueNumber,
        body
      })
      return res.data.id
    } catch (e) {
      warning(`reply.ack failed: ${String(e)}`)
      return null
    }
  }

  async success(
    message: string,
    ackId?: number | null
  ): Promise<void> {
    const body = this.wrap(message)
    const htmlUrl = await this.publish(body, ackId)
    await this.postInlineAnchor(htmlUrl, false)
  }

  async error(
    code: ErrorCode,
    detail?: string,
    ackId?: number | null
  ): Promise<void> {
    const body = this.wrap(
      `${formatErrorMessage(code, detail)}\n\n\`错误码: ${code}\``
    )
    const htmlUrl = await this.publish(body, ackId)
    await this.postInlineAnchor(htmlUrl, true)
    info(`command error [${code}] ${detail ?? ''}`)
  }

  async progress(message: string, ackId: number): Promise<void> {
    const body = this.wrap(`⏳ ${message}`)
    try {
      await octokit.issues.updateComment({
        owner: this.ctx.owner,
        repo: this.ctx.repo,
        comment_id: ackId,
        body
      })
    } catch (e) {
      warning(`reply.progress update failed: ${String(e)}`)
    }
  }

  /** 新建或更新评论，返回落地评论的 html_url（失败时返回 null） */
  private async publish(
    body: string,
    ackId?: number | null
  ): Promise<string | null> {
    if (ackId != null) {
      try {
        const res = await octokit.issues.updateComment({
          owner: this.ctx.owner,
          repo: this.ctx.repo,
          comment_id: ackId,
          body
        })
        return res?.data?.html_url ?? null
      } catch (e) {
        warning(`reply.publish update failed, falling back to create: ${String(e)}`)
      }
    }
    try {
      const res = await octokit.issues.createComment({
        owner: this.ctx.owner,
        repo: this.ctx.repo,
        issue_number: this.ctx.issueNumber,
        body
      })
      return res?.data?.html_url ?? null
    } catch (e) {
      warning(`reply.publish create failed: ${String(e)}`)
      return null
    }
  }

  /**
   * 若命令由 PR 行级评论触发，在原行级线程里追加一条短指针，
   * 指向会话区的完整回复。失败仅 warning，不影响主流程。
   */
  private async postInlineAnchor(
    htmlUrl: string | null,
    isError: boolean
  ): Promise<void> {
    if (this.ctx.sourceEvent !== 'pull_request_review_comment') {
      info(
        `postInlineAnchor: skip (sourceEvent=${String(this.ctx.sourceEvent)})`
      )
      return
    }
    if (!this.ctx.reviewCommentId || !this.ctx.pullNumber || !htmlUrl) {
      info(
        `postInlineAnchor: skip (reviewCommentId=${String(this.ctx.reviewCommentId)} pullNumber=${String(this.ctx.pullNumber)} htmlUrl=${htmlUrl ? 'ok' : 'null'})`
      )
      return
    }
    const label = isError ? '查看错误详情' : '查看完整回复'
    const body = `${GREETING} · \`${this.ctx.commandName}\`\n\n🔗 已在会话区回复 → [${label}](${htmlUrl})`
    try {
      const res = await octokit.pulls.createReplyForReviewComment({
        owner: this.ctx.owner,
        repo: this.ctx.repo,
        pull_number: this.ctx.pullNumber,
        comment_id: this.ctx.reviewCommentId,
        body
      })
      info(
        `postInlineAnchor: posted reply id=${res?.data?.id} url=${res?.data?.html_url ?? ''}`
      )
    } catch (e) {
      warning(
        `postInlineAnchor failed (pull_number=${this.ctx.pullNumber} comment_id=${this.ctx.reviewCommentId}): ${String(e)}`
      )
    }
  }

  private wrap(message: string): string {
    const tag = buildCmdReplyTag(
      this.ctx.originalCommentId,
      this.ctx.commandName
    )
    return `${tag}\n${GREETING} · \`${this.ctx.commandName}\`\n\n${message}`
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
    // 用 paginate 扫描（一期最多 100 条足够）
    const res = await octokit.issues.listComments({
      owner,
      repo,
      issue_number: issueNumber,
      per_page: 100
    })
    for (const c of res.data) {
      if (typeof c.body === 'string' && c.body.includes(tag)) {
        return true
      }
    }
    return false
  } catch (e) {
    warning(`hasBeenProcessed failed: ${String(e)} — treating as not processed`)
    return false
  }
}
