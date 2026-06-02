/**
 * commands/parser.ts - 命令解析器
 *
 * 输入: 评论原文 + 已注册命令列表
 * 输出: ParseOutcome，三种情形:
 *   1. command      — 命中白名单的命令（可能带参数）
 *   2. conversation — 包含 @bot 但未命中命令（走对话 fallback）
 *   3. none         — 不包含 @bot 或没有任何有效触发
 *
 * 关键规则（见 §5.4 设计文档）:
 *   - 默认支持 @ai-reviewer 与 @codesentinel 两个 mention 别名
 *   - bot mention 不区分大小写
 *   - 命令名不区分大小写（解析后归一化为小写）
 *   - 复合命令按最长前缀匹配（例: "full review" 先于 "full"）
 *   - 仅处理第一行的命令体，换行后的内容进入 rawAfter
 *   - 单条评论只识别第一个命令，其余忽略
 *   - 参数字符集白名单: [A-Za-z0-9_\-./:=]；出现 shell 元字符 → INVALID_ARGS
 *   - 长度上限: 命令行 ≤ 512 字符, 单个 arg ≤ 128 字符, arg 数量 ≤ 16
 */
import type {ParseOutcome, ParsedCommand} from './types'

/** 默认支持的 bot mention 别名（小写，已带 @） */
export const DEFAULT_BOT_MENTIONS = ['@ai-reviewer', '@codesentinel']

/** 命令行长度上限 */
export const MAX_COMMAND_LINE_LENGTH = 512
/** 单个 arg 长度上限 */
export const MAX_ARG_LENGTH = 128
/** 参数个数上限 */
export const MAX_ARGS_COUNT = 16

/** 允许的参数字符集 */
const SAFE_TOKEN_RE = /^[A-Za-z0-9_\-./:=]+$/
/** shell 元字符黑名单（补充检查，用于生成更明确的错误信息） */
const SHELL_METACHARS_RE = /[`$(){}|&;<>\\'"]/

export interface ParserOptions {
  /** 已注册的命令名集合（用于命中检测），应包含复合命令 */
  registeredCommands: Set<string>
  /** bot mention 别名列表，默认 DEFAULT_BOT_MENTIONS */
  botMentions?: string[]
}

/**
 * 主解析入口
 */
export function parse(
  body: string,
  opts: ParserOptions
): ParseOutcome {
  if (typeof body !== 'string' || body.length === 0) {
    return {kind: 'none'}
  }

  const mentions = (opts.botMentions ?? DEFAULT_BOT_MENTIONS).map(m =>
    m.toLowerCase()
  )

  // 1. 找到第一个 bot mention 出现的位置（忽略大小写）
  const lower = body.toLowerCase()
  let mentionIdx = -1
  let mentionLen = 0
  for (const m of mentions) {
    const idx = lower.indexOf(m)
    if (idx !== -1 && (mentionIdx === -1 || idx < mentionIdx)) {
      // 要求 mention 前是行首/空白/标点，避免匹配到 foo@ai-reviewer
      const prev = idx === 0 ? ' ' : body[idx - 1]
      if (/\s|[,.;:，。；：]/.test(prev) || idx === 0) {
        mentionIdx = idx
        mentionLen = m.length
      }
    }
  }
  if (mentionIdx === -1) {
    return {kind: 'none'}
  }

  // 2. 提取 mention 之后的剩余内容
  let rest = body.slice(mentionIdx + mentionLen)
  // 允许 mention 后紧跟标点分隔符
  rest = rest.replace(/^[,:;，：；]+/, '')
  // 按第一个换行切分：第一行是命令体，其余是 rawAfter
  const firstNewline = rest.indexOf('\n')
  const firstLineRaw = firstNewline === -1 ? rest : rest.slice(0, firstNewline)
  const rawAfter = firstNewline === -1 ? '' : rest.slice(firstNewline + 1).trim()

  // 3. 命令行长度校验
  if (firstLineRaw.length > MAX_COMMAND_LINE_LENGTH) {
    return {
      kind: 'command',
      error: {
        code: 'INVALID_ARGS',
        detail: `命令长度超过上限 (${MAX_COMMAND_LINE_LENGTH})`
      }
    }
  }

  const firstLine = firstLineRaw.trim()
  if (firstLine.length === 0) {
    // 仅 @bot 单独出现 → 视为对话触发
    return {kind: 'conversation'}
  }

  // 4. 分词（空白分隔）
  const tokens = firstLine.split(/\s+/)

  // 5. 尝试匹配命令名（最长前缀匹配，最多看前 3 个 token）
  const matched = matchCommandName(tokens, opts.registeredCommands)
  if (!matched) {
    // 未命中命令但有 @bot → 交给对话 fallback
    return {kind: 'conversation'}
  }

  const {name, consumed} = matched
  const argTokens = tokens.slice(consumed)

  // 6. 参数数量校验
  if (argTokens.length > MAX_ARGS_COUNT) {
    return {
      kind: 'command',
      error: {
        code: 'INVALID_ARGS',
        detail: `参数个数超过上限 (${MAX_ARGS_COUNT})`
      },
      command: {name, raw: firstLine, args: [], kv: {}, rawAfter}
    }
  }

  // 7. 参数字符集校验
  for (const t of argTokens) {
    if (t.length > MAX_ARG_LENGTH) {
      return {
        kind: 'command',
        error: {
          code: 'INVALID_ARGS',
          detail: `参数过长: \`${truncate(t, 32)}\``
        },
        command: {name, raw: firstLine, args: [], kv: {}, rawAfter}
      }
    }
    if (SHELL_METACHARS_RE.test(t)) {
      return {
        kind: 'command',
        error: {
          code: 'INVALID_ARGS',
          detail: `参数包含非法字符: \`${truncate(t, 32)}\``
        },
        command: {name, raw: firstLine, args: [], kv: {}, rawAfter}
      }
    }
    if (!SAFE_TOKEN_RE.test(t)) {
      return {
        kind: 'command',
        error: {
          code: 'INVALID_ARGS',
          detail: `参数包含不允许的字符: \`${truncate(t, 32)}\``
        },
        command: {name, raw: firstLine, args: [], kv: {}, rawAfter}
      }
    }
  }

  // 8. 拆分 kv
  const args: string[] = []
  const kv: Record<string, string> = {}
  for (const t of argTokens) {
    const eq = t.indexOf('=')
    if (eq > 0 && eq < t.length - 1) {
      const k = t.slice(0, eq)
      const v = t.slice(eq + 1)
      kv[k] = v
    }
    args.push(t)
  }

  const command: ParsedCommand = {
    name,
    raw: firstLine,
    args,
    kv,
    rawAfter
  }
  return {kind: 'command', command}
}

/**
 * 在已注册命令集合中对 token 序列做最长前缀匹配
 *
 * 例如: registered = {"review", "full review"}
 * tokens = ["full", "review"] → 匹配到 "full review"
 * tokens = ["review"]         → 匹配到 "review"
 * tokens = ["full"]           → 不匹配（full 未注册）→ 返回 null
 */
function matchCommandName(
  tokens: string[],
  registered: Set<string>
): {name: string; consumed: number} | null {
  const maxDepth = Math.min(tokens.length, 3)
  // 从最长开始尝试
  for (let depth = maxDepth; depth >= 1; depth--) {
    const candidate = tokens
      .slice(0, depth)
      .map(t => t.toLowerCase())
      .join(' ')
    if (registered.has(candidate)) {
      return {name: candidate, consumed: depth}
    }
  }
  return null
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}...` : s
}
