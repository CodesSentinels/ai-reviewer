/**
 * commands/types.ts - 命令框架类型定义
 *
 * 本模块是命令框架的类型中枢，定义:
 * - ParsedCommand: 解析器产物
 * - CommandContext: 传入 handler 的执行上下文
 * - CommandHandler: B/C/D 需实现的接口
 * - CommandResult: handler 返回结构
 * - ErrorCode: 统一错误码
 *
 * 设计原则:
 * - 尽量使用字面量联合类型，避免 runtime 值和类型不同步
 * - 所有跨模块边界的数据结构都在这里集中声明
 */
import type {Options} from '../options'

/** 支持的 GitHub 事件类型（命令框架范围内） */
export type CommandEventName =
  | 'issue_comment'
  | 'pull_request_review_comment'

/** 仓库协作者权限等级（与 GitHub API 返回对齐） */
export type PermissionLevel =
  | 'admin'
  | 'maintain'
  | 'write'
  | 'triage'
  | 'read'
  | 'none'

/** 解析结果种类 */
export type ParseOutcomeKind = 'command' | 'conversation' | 'none'

/** 解析器输出 */
export interface ParsedCommand {
  /** 命令名（已归一化为小写）；如果是复合命令（如 "full review"）保留空格 */
  name: string
  /** 原始命令行（去掉 bot mention 前缀后的整行） */
  raw: string
  /** 位置参数数组 */
  args: string[]
  /** key=value 解析结果 */
  kv: Record<string, string>
  /** 命令后续行内容（换行之后的文本） */
  rawAfter: string
}

export interface ParseOutcome {
  kind: ParseOutcomeKind
  /** 当 kind === 'command' 时一定存在 */
  command?: ParsedCommand
  /** 解析过程中的错误（例如非法字符/超长）——非 undefined 时视为 error */
  error?: {code: ErrorCode; detail?: string}
}

/** 评论者身份信息 */
export interface ActorInfo {
  login: string
  permission: PermissionLevel
  isPrAuthor: boolean
  isBot: boolean
}

/** 传给 handler 的执行上下文 */
export interface CommandContext {
  command: ParsedCommand
  eventName: CommandEventName
  action: 'created'

  owner: string
  repo: string
  prNumber: number
  headSha: string
  baseSha: string

  actor: ActorInfo

  commentId: number
  commentBody: string
  commentNodeId?: string
  threadNodeId?: string

  reply: Reply
  options: Options
}

/** handler 返回结构 */
export interface CommandResult {
  message?: string
  meta?: Record<string, unknown>
}

/** 命令处理器接口 */
export interface CommandHandler {
  name: string
  aliases?: string[]
  needsAck?: boolean
  minPermission?: PermissionLevel
  description: string
  usage?: string
  execute(ctx: CommandContext): Promise<CommandResult>
}

/** 统一错误码 */
export type ErrorCode =
  | 'UNKNOWN_COMMAND'
  | 'INVALID_ARGS'
  | 'FORBIDDEN'
  | 'BOT_FORBIDDEN'
  | 'NOT_IMPLEMENTED'
  | 'RATE_LIMITED'
  | 'DUPLICATE'
  | 'INTERNAL'

/** reply 工具的最小接口（用于 CommandContext 类型引用） */
export interface Reply {
  ack(message: string): Promise<number | null>
  success(message: string, ackId?: number | null): Promise<void>
  error(
    code: ErrorCode,
    detail?: string,
    ackId?: number | null
  ): Promise<void>
  progress(message: string, ackId: number): Promise<void>
}

/** 权限等级的比较用数值 */
export const PERMISSION_RANK: Record<PermissionLevel, number> = {
  none: 0,
  read: 1,
  triage: 2,
  write: 3,
  maintain: 4,
  admin: 5
}

/** 判断 actual >= required */
export function permissionAtLeast(
  actual: PermissionLevel,
  required: PermissionLevel
): boolean {
  return PERMISSION_RANK[actual] >= PERMISSION_RANK[required]
}
