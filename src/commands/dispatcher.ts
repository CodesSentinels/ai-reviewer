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
import {getPlatform} from '../platform/git-platform'
import {repoCoordsOf} from '../platform/run-context'
import {getLogger} from '../platform/logger'
import type {Options} from '../options'
import {getRegistry} from './registry'
import {parse, type ParserOptions, DEFAULT_BOT_MENTIONS} from './parser'
import {getPermissionResult, canExecute} from './permission'
import {checkRateLimit} from './rate-limit'
import {hasBeenProcessed, Reply} from './reply'
import {addAckReaction} from './reaction'
import {buildUnknownCommandMessage} from './handlers/help'
import type {ActorInfo, CommandContext, CommandEventName, ErrorCode, ParsedCommand} from './types'
import type {ExecutionContext} from '../platform/execution-context'

/** 调度结果（主要用于测试断言，以及 fallback 决策） */
export type DispatchOutcome =
  | {kind: 'ignored'; reason: string}
  | {kind: 'fallback_conversation'}
  | {kind: 'executed'; command: string; ok: boolean; error?: ErrorCode}

export interface DispatcherDeps {
  /**
   * 事件坐标的唯一来源（ARCH-005 迁移完成）。
   *
   * 迁移前本文件直接读 `@actions/github` 的 context.payload 自行解析 PR number、
   * 评论、head/base SHA 和作者。那些判断（action != created、issue_comment 是否
   * 挂在 PR 上、bot 识别）与 createGitHubExecutionContext 的构造期校验完全重复，
   * 且让 GitLab 无法复用本调度器。现在统一消费归一化字段。
   */
  execCtx: ExecutionContext
  options: Options
  /** 可选: 覆盖默认 bot mention 列表 */
  botMentions?: string[]
  triggerReview?: CommandContext['triggerReview']
}

/**
 * 主调度入口。
 * 调用方 (command-handler.ts) 负责:
 *   - 当返回 'fallback_conversation' 时，调用成员 D 的 handleConversation（对话式追问）
 */
export async function dispatchCommentEvent(deps: DispatcherDeps): Promise<DispatchOutcome> {
  const logger = getLogger()
  const execCtx = deps.execCtx

  // [事件白名单] 只放行两类带评论的事件。归一化 eventKind → 平台事件名，
  // 供 Reply / addAckReaction 等仍按 GitHub 事件名分支的下游使用。
  const eventName: CommandEventName | null =
    execCtx.eventKind === 'comment_created'
      ? 'issue_comment'
      : execCtx.eventKind === 'review_comment_created'
      ? 'pull_request_review_comment'
      : null
  if (eventName == null) {
    return {kind: 'ignored', reason: `unsupported event: ${execCtx.eventKind}`}
  }

  // action != 'created' 和「issue_comment 挂在非 PR issue 上」这两条，已经在
  // ExecutionContext 构造阶段判掉（ignorable_event，见 github-execution-context.ts），
  // 走到这里的一定是新建的 PR/MR 评论，不必重复判断。
  const prNumber = execCtx.changeRequestId
  const comment = execCtx.comment
  const commentNodeId = comment?.nodeId
  const threadNodeId = comment?.threadId

  // head/base SHA 与 PR 作者：评论事件的 payload 不保证带全（GitHub 侧构造阶段
  // 固定留空），统一查一次当前详情补齐。迁移前 issue_comment 分支本来就查这一次，
  // review_comment 分支从 payload 读——改成统一查询后行为更准，payload 里的 SHA
  // 可能已经过期。
  let headSha = ''
  let baseSha = ''
  let prAuthor = ''
  const {owner, repo: repoName} = repoCoordsOf(execCtx)
  try {
    const cr = await getPlatform().getChangeRequest(owner, repoName, prNumber)
    headSha = cr.headSha
    baseSha = cr.baseSha
    prAuthor = cr.author
  } catch (e) {
    logger.warning(
      `command dispatcher: failed to fetch head/base sha for #${prNumber}: ${String(e)}`
    )
  }

  // [字段完整性校验] 评论体非字符串或缺 PR number 则无法解析命令，忽略。
  if (!comment || typeof comment.body !== 'string' || !prNumber) {
    return {kind: 'ignored', reason: 'missing comment body or pr number'}
  }

  // [bot 自评论过滤] 通过 user.type 或登录名 `xxx[bot]` 后缀识别机器人，
  // 防止 bot 自己回帖再次触发命令造成死循环。
  // bot 识别（user.type === 'Bot' 或 `xxx[bot]` 后缀）已在构造阶段归一化为
  // actor.isBot，两个平台共用同一判定
  const actorLogin: string = execCtx.actor.login
  if (execCtx.actor.isBot) {
    logger.info(`command dispatcher: ignored comment from bot (login=${actorLogin})`)
    return {kind: 'ignored', reason: 'comment from bot'}
  }

  // 命令解析
  const registry = getRegistry()
  const parseOpts: ParserOptions = {
    registeredCommands: registry.getRegisteredNames(),
    botMentions: deps.botMentions ?? DEFAULT_BOT_MENTIONS
  }
  const outcome = parse(comment.body, parseOpts)

  // [解析结果分支] parser 返回三种形态：
  if (outcome.kind === 'none') {
    // none：未 @bot 或非命令。对话必须显式 @bot 才触发（包括续轮），
    // 避免与真人之间的普通讨论冲突。
    return {kind: 'ignored', reason: 'no bot mention'}
  }
  if (outcome.kind === 'conversation') {
    // conversation：@bot 但非已注册命令 → 交回 command-handler 走对话式追问 fallback。
    return {kind: 'fallback_conversation'}
  }

  // outcome.kind === 'command'：解析出一条已知命令，进入执行流程。
  // 即便解析出错，也尽量构造 reply 以反馈用户
  const cmdNameForReply = outcome.command?.name ?? 'unknown'
  const reply = new Reply({
    owner,
    repo: repoName,
    issueNumber: prNumber,
    originalCommentId: comment.id,
    commandName: cmdNameForReply,
    eventName
  })

  // [解析错误] 处理命令解析阶段的错误。
  if (outcome.error) {
    if (outcome.error.code === 'UNKNOWN_COMMAND') {
      // 未识别的命令：先打 ACK reaction，再回复支持的命令列表
      await addAckReaction({
        owner,
        repo: repoName,
        changeRequestId: prNumber,
        commentId: comment.id,
        eventName,
        rawReaction: deps.options.commandAckReaction
      })
      const cmds = registry.listCommands()
      const invalidCmd = outcome.error.detail ?? 'unknown'
      const msg = buildUnknownCommandMessage(invalidCmd, actorLogin, cmds)
      await reply.success(msg)
    } else {
      await reply.error(outcome.error.code, outcome.error.detail)
    }
    return {
      kind: 'executed',
      command: cmdNameForReply,
      ok: false,
      error: outcome.error.code
    }
  }

  const parsed = outcome.command as ParsedCommand

  // [幂等检查] 同一 commentId × 同一 command 是否已有回复；
  // Actions 可能因重试/重复投递触发多次，命中则跳过避免重复执行。
  const processed = await hasBeenProcessed(owner, repoName, prNumber, comment.id, parsed.name)
  if (processed) {
    logger.info(`command dispatcher: skip duplicate commentId=${comment.id} cmd=${parsed.name}`)
    return {
      kind: 'executed',
      command: parsed.name,
      ok: false,
      error: 'DUPLICATE'
    }
  }

  // [速率限制] 按操作者维度限流；超限则回帖提示重试时间并结束。
  const rl = checkRateLimit(actorLogin)
  if (!rl.allowed) {
    await reply.error('RATE_LIMITED', `请 ${Math.ceil((rl.retryAfterMs ?? 0) / 1000)} 秒后再试`)
    return {
      kind: 'executed',
      command: parsed.name,
      ok: false,
      error: 'RATE_LIMITED'
    }
  }

  // [查找 handler] 从注册表取命令处理器；命令名虽通过解析但未注册（如已下线）则报 UNKNOWN_COMMAND。
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

  // [权限校验] 查询操作者在仓库的权限等级，结合"是否为 PR 作者"判断能否执行该命令；
  // 不满足则回帖 FORBIDDEN 并结束。
  const {level: permission, queryFailed} = await getPermissionResult({
    owner,
    repo: repoName,
    username: actorLogin
  })
  // CMD-016：权限查询失败时 fail closed——此时不认作者豁免，
  // 否则 API 故障期间任何 PR 作者都能触发 review/full review/summary（fail open）
  const isPrAuthor = actorLogin === prAuthor && !queryFailed
  if (!canExecute(handler, permission, isPrAuthor)) {
    const detail = queryFailed
      ? `无法确认用户 \`${actorLogin}\` 的权限（查询失败），已按最严格策略拒绝`
      : `用户 \`${actorLogin}\` 当前权限: \`${permission}\``
    await reply.error('FORBIDDEN', detail)
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
    execCtx: deps.execCtx,
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
    options: deps.options,
    triggerReview: deps.triggerReview
  }

  // [ACK 回复] 仅对声明 needsAck 的耗时命令先回一条"正在执行"，
  // 后续 success/error 会复用该 ackId 原地更新，避免刷屏。
  let ackId: number | null = null
  if (handler.needsAck) {
    ackId = await reply.ack(`正在执行 \`${parsed.name}\` …`)
  }

  // [执行] 调用 handler，成功回 success；
  try {
    const result = await handler.execute(ctx)
    const message = result?.message ?? `✅ 命令 \`${parsed.name}\` 执行完成`
    await reply.success(message, ackId)
    return {kind: 'executed', command: parsed.name, ok: true}
  } catch (e) {
    // 抛错则归一化错误码后回 error，并打 warning 便于排查。
    const code = extractErrorCode(e)
    const detail = e instanceof Error ? e.message : String(e)
    await reply.error(code, detail, ackId)
    logger.warning(`command handler failed: name=${parsed.name} code=${code} ${detail}`)
    return {
      kind: 'executed',
      command: parsed.name,
      ok: false,
      error: code
    }
  }
}

/**
 * 把任意抛出的异常归一化为已知 ErrorCode。
 * 仅当 e 是对象、带 string 类型的 code、且 code 属于白名单时才采用，
 * 否则一律兜底为 'INTERNAL'。
 */
function extractErrorCode(e: unknown): ErrorCode {
  // 非对象或无 code 字段 → 走末尾 INTERNAL 兜底
  if (e && typeof e === 'object' && 'code' in e) {
    const c = (e as {code?: unknown}).code
    if (typeof c === 'string') {
      // code 必须命中已知错误码白名单，防止把任意字符串当成合法 ErrorCode
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
