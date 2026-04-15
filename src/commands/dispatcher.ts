/**
 * commands/dispatcher.ts - 命令调度主流程
 *
 * 设计文档对应: 04-iteration-02-member-a-design.md §4.1
 *
 * 流程:
 *   1. 事件类型校验 (issue_comment / pull_request_review_comment, action=created)
 *   2. 提取 PR number / 评论信息
 *   3. bot 自评论过滤
 *   4. 命令解析 (parser.parse)
 *      - none → 忽略
 *      - conversation → 透传对话 fallback
 *      - command → 继续
 *   5. 幂等检查 (reply.hasBeenProcessed)
 *   6. 速率限制 (rate-limit)
 *   7. 权限查询 + 命令权限校验
 *   8. ACK 回复（如 needsAck）
 *   9. 执行 handler.execute
 *   10. 成功/失败反馈
 *
 * 对外导出:
 *   - dispatchCommentEvent(deps): 主入口，被 command-handler.ts 调用
 *   - DispatchOutcome: 用于测试的明确返回值
 */
import {info, warning} from '@actions/core'
// eslint-disable-next-line camelcase
import {context as github_context} from '@actions/github'
import type {Options} from '../options'
import {getRegistry} from './registry'
import {parse, type ParserOptions, DEFAULT_BOT_MENTIONS} from './parser'
import {getPermission} from './permission'
import {canExecute} from './permission'
import {checkRateLimit} from './rate-limit'
import {addAckReaction} from './reaction'
import {hasBeenProcessed, Reply} from './reply'
import type {
  ActorInfo,
  CommandContext,
  CommandEventName,
  ErrorCode,
  ParsedCommand
} from './types'

// eslint-disable-next-line camelcase
const context = github_context

/** 调度结果（主要用于测试断言，以及 fallback 决策） */
export type DispatchOutcome =
  | {kind: 'ignored'; reason: string}
  | {kind: 'fallback_conversation'}
  | {kind: 'executed'; command: string; ok: boolean; error?: ErrorCode}

export interface DispatcherDeps {
  options: Options
  /** 可选: 覆盖默认 bot mention 列表 */
  botMentions?: string[]
}

/**
 * 主调度入口。
 * 调用方 (command-handler.ts) 负责:
 *   - 当返回 'fallback_conversation' 时，调用旧的 handleReviewComment
 */
export async function dispatchCommentEvent(
  deps: DispatcherDeps
): Promise<DispatchOutcome> {
  const eventName = context.eventName as CommandEventName
  if (
    eventName !== 'issue_comment' &&
    eventName !== 'pull_request_review_comment'
  ) {
    return {kind: 'ignored', reason: `unsupported event: ${eventName}`}
  }

  const payload = context.payload
  if (!payload || payload.action !== 'created') {
    return {kind: 'ignored', reason: `action not created`}
  }

  // 提取 PR number & 评论 —— 两种事件的 payload 形态不同
  let prNumber: number | undefined
  let comment: any
  let headSha = ''
  let baseSha = ''
  let prAuthor = ''
  let commentNodeId: string | undefined
  let threadNodeId: string | undefined

  if (eventName === 'issue_comment') {
    if (!payload.issue?.pull_request) {
      return {kind: 'ignored', reason: 'issue_comment on non-PR issue'}
    }
    prNumber = payload.issue.number
    comment = payload.comment
    // issue_comment 的 payload 没有 head/base SHA，需由 handler 自行查
    prAuthor = payload.issue.user?.login ?? ''
  } else {
    if (!payload.pull_request) {
      return {kind: 'ignored', reason: 'review_comment missing pull_request'}
    }
    prNumber = payload.pull_request.number
    comment = payload.comment
    headSha = payload.pull_request.head?.sha ?? ''
    baseSha = payload.pull_request.base?.sha ?? ''
    prAuthor = payload.pull_request.user?.login ?? ''
    commentNodeId = comment?.node_id
    // review_thread 的 nodeId 需要另查 GraphQL；此处置空由 B 在 handler 中补齐
  }

  if (!comment || typeof comment.body !== 'string' || !prNumber) {
    return {kind: 'ignored', reason: 'missing comment body or pr number'}
  }

  // 过滤 bot 自身（避免自我触发）
  const actorLogin: string = comment.user?.login ?? ''
  const actorIsBot =
    comment.user?.type === 'Bot' || /\[bot\]$/i.test(actorLogin)
  if (actorIsBot) {
    return {kind: 'ignored', reason: 'comment from bot'}
  }

  // 命令解析
  const registry = getRegistry()
  const parseOpts: ParserOptions = {
    registeredCommands: registry.getRegisteredNames(),
    botMentions: deps.botMentions ?? DEFAULT_BOT_MENTIONS
  }
  const outcome = parse(comment.body, parseOpts)

  if (outcome.kind === 'none') {
    return {kind: 'ignored', reason: 'no bot mention'}
  }
  if (outcome.kind === 'conversation') {
    return {kind: 'fallback_conversation'}
  }

  // outcome.kind === 'command'
  // 即便解析出错，也尽量构造 reply 以反馈用户
  const owner = context.repo.owner
  const repoName = context.repo.repo
  const cmdNameForReply = outcome.command?.name ?? 'unknown'
  const reply = new Reply({
    owner,
    repo: repoName,
    issueNumber: prNumber,
    originalCommentId: comment.id,
    commandName: cmdNameForReply
  })

  // 命令被识别后第一时间给一个表情反应，作为"收到"的即时信号（可通过
  // command_ack_reaction 配置；失败不阻塞命令执行）
  void addAckReaction({
    owner,
    repo: repoName,
    commentId: comment.id,
    eventName,
    rawReaction: deps.options.commandAckReaction
  })

  if (outcome.error) {
    await reply.error(outcome.error.code, outcome.error.detail)
    return {
      kind: 'executed',
      command: cmdNameForReply,
      ok: false,
      error: outcome.error.code
    }
  }

  const parsed = outcome.command as ParsedCommand

  // 幂等检查: 同一 commentId × 同一 command 是否已有回复
  const processed = await hasBeenProcessed(
    owner,
    repoName,
    prNumber,
    comment.id,
    parsed.name
  )
  if (processed) {
    info(
      `command dispatcher: skip duplicate commentId=${comment.id} cmd=${parsed.name}`
    )
    return {kind: 'executed', command: parsed.name, ok: false, error: 'DUPLICATE'}
  }

  // 速率限制
  const rl = checkRateLimit(actorLogin)
  if (!rl.allowed) {
    await reply.error(
      'RATE_LIMITED',
      `请 ${Math.ceil((rl.retryAfterMs ?? 0) / 1000)} 秒后再试`
    )
    return {
      kind: 'executed',
      command: parsed.name,
      ok: false,
      error: 'RATE_LIMITED'
    }
  }

  // 查找 handler
  const handler = registry.get(parsed.name)
  if (!handler) {
    await reply.error('UNKNOWN_COMMAND', `\`${parsed.name}\``)
    return {
      kind: 'executed',
      command: parsed.name,
      ok: false,
      error: 'UNKNOWN_COMMAND'
    }
  }

  // 权限: 查询 + 校验
  const permission = await getPermission({
    owner,
    repo: repoName,
    username: actorLogin
  })
  const isPrAuthor = actorLogin === prAuthor
  if (!canExecute(handler, permission, isPrAuthor)) {
    await reply.error(
      'FORBIDDEN',
      `用户 \`${actorLogin}\` 当前权限: \`${permission}\``
    )
    return {
      kind: 'executed',
      command: parsed.name,
      ok: false,
      error: 'FORBIDDEN'
    }
  }

  const actor: ActorInfo = {
    login: actorLogin,
    permission,
    isPrAuthor,
    isBot: false
  }

  const ctx: CommandContext = {
    command: parsed,
    eventName,
    action: 'created',
    owner,
    repo: repoName,
    prNumber,
    headSha,
    baseSha,
    actor,
    commentId: comment.id,
    commentBody: comment.body,
    commentNodeId,
    threadNodeId,
    reply,
    options: deps.options
  }

  // ACK
  let ackId: number | null = null
  if (handler.needsAck) {
    ackId = await reply.ack(`正在执行 \`${parsed.name}\` …`)
  }

  // 执行
  try {
    const result = await handler.execute(ctx)
    const message =
      result?.message ?? `✅ 命令 \`${parsed.name}\` 执行完成`
    await reply.success(message, ackId)
    return {kind: 'executed', command: parsed.name, ok: true}
  } catch (e) {
    const code = extractErrorCode(e)
    const detail = e instanceof Error ? e.message : String(e)
    await reply.error(code, detail, ackId)
    warning(
      `command handler failed: name=${parsed.name} code=${code} ${detail}`
    )
    return {
      kind: 'executed',
      command: parsed.name,
      ok: false,
      error: code
    }
  }
}

function extractErrorCode(e: unknown): ErrorCode {
  if (e && typeof e === 'object' && 'code' in e) {
    const c = (e as {code?: unknown}).code
    if (typeof c === 'string') {
      if (
        [
          'UNKNOWN_COMMAND',
          'INVALID_ARGS',
          'FORBIDDEN',
          'BOT_FORBIDDEN',
          'NOT_IMPLEMENTED',
          'RATE_LIMITED',
          'DUPLICATE',
          'INTERNAL'
        ].includes(c)
      ) {
        return c as ErrorCode
      }
    }
  }
  return 'INTERNAL'
}
