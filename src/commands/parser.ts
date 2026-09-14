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
import {BOT_MENTIONS} from '../constants'
import type {ParseOutcome, ParsedCommand} from './types'

/** 默认支持的 bot mention 别名（小写，已带 @）。共享自 constants.BOT_MENTIONS。 */
export const DEFAULT_BOT_MENTIONS: string[] = [...BOT_MENTIONS]

/**
 * 本次运行认可的全部 mention（CMD-001 / CMD-002）。
 *
 * 两类来源：
 *
 * 1. **文本别名** `@ai-reviewer` / `@codesentinel`——平台无关，两边都保留
 *    （CMD-001）。GitLab 上 bot 常以个人 PAT 身份发言，`@` 一个不存在的用户
 *    不会产生通知，但作为纯文本前缀依然可用，这正是 CMD-002 里「或纯文本前缀」
 *    的含义。
 * 2. **真实账号 mention** `@{botLogin}`——GitLab 是 PAT 用户名
 *    （`AI_REVIEWER_BOT_GITLAB_LOGIN`），GitHub 是 `bot_github_login`。
 *    用户凭直觉 @ 真实账号时也应该能触发。
 *
 * 未配置 botLogin 时退化为纯别名，与迁移前行为一致。
 *
 * 入参容忍 undefined：这条链路一崩，**所有**命令都会失效，不值得为了类型上的
 * 洁癖去赌每个调用方都传了值。
 */
export function resolveBotMentions(botLogin: string | undefined | null): string[] {
  const login = (botLogin ?? '').trim().replace(/^@/, '')
  if (login === '') return [...DEFAULT_BOT_MENTIONS]
  const real = `@${login.toLowerCase()}`
  return DEFAULT_BOT_MENTIONS.includes(real)
    ? [...DEFAULT_BOT_MENTIONS]
    : [...DEFAULT_BOT_MENTIONS, real]
}

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

/**
 * mention 两侧必须都是边界（CMD-004）。
 *
 * 只看前一个字符是不够的：`@ai-reviewerX help` 会命中 `@ai-reviewer` 并把
 * `X help` 当成命令体，等于替另一个用户执行命令。两侧都要卡：
 *
 *   前：行首、空白或标点          —— 挡住 `foo@ai-reviewer`
 *   后：非标识符字符              —— 挡住 `@ai-reviewerX` / `@ai-reviewer-bot`
 *
 * 尾部的 `.` 单独处理：`@ai-reviewer.` 句末是合法的，但 GitLab 用户名允许含
 * `.`，所以 `.` 后面若紧跟标识符字符（`@ai-reviewer.bot`）仍判为另一个用户。
 */
function hasMentionBoundary(body: string, idx: number, len: number): boolean {
  if (idx > 0) {
    const prev = body[idx - 1]
    if (!/\s|[,.;:，。；：]/.test(prev)) return false
  }

  const next = body[idx + len]
  if (next === undefined) return true
  if (/[A-Za-z0-9_-]/.test(next)) return false
  if (next === '.') {
    const after = body[idx + len + 1]
    if (after !== undefined && /[A-Za-z0-9_-]/.test(after)) return false
  }
  return true
}

export interface ParserOptions {
  /** 已注册的命令名集合（用于命中检测），应包含复合命令 */
  registeredCommands: Set<string>
  /** bot mention 别名列表，默认 DEFAULT_BOT_MENTIONS */
  botMentions?: string[]
}

/**
 * 主解析入口
 */
export function parse(body: string, opts: ParserOptions): ParseOutcome {
  if (typeof body !== 'string' || body.length === 0) {
    return {kind: 'none'}
  }

  const mentions = (opts.botMentions ?? DEFAULT_BOT_MENTIONS).map(m => m.toLowerCase())

  // 1. 找到第一个**边界合法**的 bot mention（忽略大小写）
  const lower = body.toLowerCase()
  let mentionIdx = -1
  let mentionLen = 0
  for (const m of mentions) {
    // 必须遍历该 mention 的**每一次**出现：早先只取 indexOf 的第一处，
    // 首次出现边界不合法就整个放弃，于是
    //   "邮箱 a@ai-reviewer.com\n@ai-reviewer help"
    // 里第二行真正的命令被完全吞掉（返回 none）。
    let from = 0
    for (;;) {
      const idx = lower.indexOf(m, from)
      if (idx === -1) break
      from = idx + 1
      if (!hasMentionBoundary(body, idx, m.length)) continue
      if (mentionIdx === -1 || idx < mentionIdx) {
        mentionIdx = idx
        mentionLen = m.length
      }
      break // 该别名的首个合法位置即可，更靠前的由其他别名比较得出
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
    // 未命中已注册命令。判断是"无效命令"还是"自然语言对话"：
    // - 首 token 纯 ASCII 字母（看起来像命令名）→ UNKNOWN_COMMAND
    // - 否则（含 CJK、标点开头等自然语言）→ conversation fallback
    if (looksLikeCommandAttempt(tokens[0])) {
      return {
        kind: 'command',
        error: {code: 'UNKNOWN_COMMAND', detail: firstLine}
      }
    }
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

/**
 * 判断 token 是否"看起来像一条命令"。
 * 纯 ASCII 字母（允许连字符）→ 极可能是用户尝试输入命令名；
 * 含中文、日文、韩文等非 ASCII 字符 → 自然语言对话。
 */
function looksLikeCommandAttempt(token: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_-]*$/.test(token)
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}...` : s
}
