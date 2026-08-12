/**
 * redact.ts — 通用日志脱敏（SEC-008）
 *
 * `gitlab-trigger-redact.ts` 只处理字符串形态的三种 GitLab token，覆盖面不够：
 * 密钥同样会从 HTTP Header、URL query、异常对象的嵌套字段、环境变量快照和
 * debug 输出里漏出去。这里做统一实现，两条主线：
 *
 * 1. **按值脱敏**：把 `process.env` 里敏感变量的**实际值**当作字面量屏蔽。
 *    这是最强的一层——不管密钥经过多少层包装、出现在什么字段，只要值本身
 *    出现在输出里就会被打掉。
 * 2. **按形态脱敏**：token 前缀（glpat- / ghp_ / sk- 等）、Authorization 头、
 *    URL 里的内嵌凭据与 token query、敏感字段名。用于覆盖不来自本进程 env
 *    的密钥（例如 API 响应里回显的凭据）。
 *
 * 设计约束：
 * - 只做遮蔽，不改结构——调用方拿到的仍是可读的同形对象，便于排错
 * - 不抛异常。脱敏函数自己失败会把原始内容直接漏出去，因此全程兜底
 * - 幂等：对已脱敏内容再跑一次结果不变
 */

export const REDACTED = '***'

/**
 * 值被认为是密钥的环境变量名片段。
 *
 * 按 `_` / `-` / `.` 切分后做**整段精确匹配**，不是子串匹配——
 * 子串匹配会把 `PATH` 当成 `pat`、把 `KEYWORD` 当成 `key`，
 * 于是整条 PATH 被打成 `***`，日志直接不可读。
 * 反过来，整段匹配才能认出 `GITLAB_PAT` 这种本仓库实际在用的命名。
 */
const SECRET_ENV_SEGMENTS = new Set([
  'token',
  'tokens',
  'pat',
  'key',
  'keys',
  'apikey',
  'secret',
  'secrets',
  'password',
  'passwd',
  'credential',
  'credentials'
])

/** 环境变量名是否指向一个密钥值 */
function isSecretEnvName(name: string): boolean {
  return name
    .toLowerCase()
    .split(/[_\-.]/)
    .some(segment => SECRET_ENV_SEGMENTS.has(segment))
}

/** 对象字段名一旦命中就直接遮蔽其值 */
const SENSITIVE_KEY_PATTERN =
  /(^|[_-])(authorization|cookie|token|api[_-]?key|secret|password|passwd|credential|private[_-]?token|session)([_-]|$)/i

/** URL query 中需要遮蔽的参数名 */
const SENSITIVE_QUERY_PARAMS = [
  'token',
  'private_token',
  'access_token',
  'api_key',
  'apikey',
  'key',
  'password',
  'sig',
  'signature'
]

/** 短于该长度的 env 值不做全局字面量替换，避免把常见短词打成 *** */
const MIN_LITERAL_LENGTH = 8

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 从环境变量里收集需要按字面量屏蔽的密钥值 */
export function collectSecretValues(env: NodeJS.ProcessEnv = process.env): string[] {
  const values: string[] = []
  for (const [name, value] of Object.entries(env)) {
    if (value == null || value.length < MIN_LITERAL_LENGTH) continue
    if (!isSecretEnvName(name)) continue
    values.push(value)
  }
  // 长值优先，避免短值先替换后把长值切碎
  return values.sort((a, b) => b.length - a.length)
}

/** 按形态脱敏一段字符串 */
export function redactString(
  input: string,
  secretValues: string[] = collectSecretValues()
): string {
  let out = input

  // 1) 已知密钥的字面量
  for (const secret of secretValues) {
    out = out.split(secret).join(REDACTED)
  }

  // 2) URL 内嵌凭据：https://user:pass@host
  out = out.replace(/(\b[a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):([^/\s@]+)@/gi, `$1$2:${REDACTED}@`)

  // 3) URL query 参数
  for (const param of SENSITIVE_QUERY_PARAMS) {
    out = out.replace(new RegExp(`([?&]${escapeRegExp(param)}=)[^&\\s"']+`, 'gi'), `$1${REDACTED}`)
  }

  // 4) HTTP 头部写法。
  //    4a 先处理「头名: [方案] 凭据」，方案关键字保留、只打后面的凭据；
  //    4b 再兜底没有头名、只有方案的写法（如 curl -H "Bearer xxx"）。
  //
  //    注意不能把裸词 `token` 当认证方案：日志里 `token count: 12345`
  //    这类正常诊断信息会被打成 `token ***`，把可读性毁掉。
  //    真正的 `Authorization: token xxx` 由 4a 的可选方案分组覆盖。
  out = out.replace(
    /\b(authorization|private-token|x-api-key|cookie)\b(\s*[:=]\s*)((?:bearer|basic|token)\s+)?([^\s,;"']+)/gi,
    (match, name: string, sep: string, scheme: string | undefined, value: string) => {
      if (value === REDACTED) return match
      return `${name}${sep}${scheme ?? ''}${REDACTED}`
    }
  )
  //    4b 兜底没有头名、只有方案关键字的写法。只认首字母大写形式
  //    （真实 header 如此），小写形态由 4a 的头名规则覆盖。
  //
  //    Bearer 是无歧义的认证方案，后面跟什么都按凭据处理；
  //    Basic 同时是常用英文词（"Basic review completed"），因此要求凭据长度
  //    >= 16——base64 凭据本来就长，正常句子里的单词不会这么长。
  out = out.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{3,}/g, `Bearer ${REDACTED}`)
  out = out.replace(/\bBasic\s+[A-Za-z0-9._~+/=-]{16,}/g, `Basic ${REDACTED}`)

  // 5) 常见 token 前缀（不依赖本进程 env，覆盖回显场景）
  out = out.replace(/\bglpat-[A-Za-z0-9_-]{6,}/g, `glpat-${REDACTED}`)
  out = out.replace(/\bglrt-[A-Za-z0-9_-]{6,}/g, `glrt-${REDACTED}`)
  out = out.replace(/\bgh[pousr]_[A-Za-z0-9]{16,}/g, `gh*_${REDACTED}`)
  out = out.replace(/\bgithub_pat_[A-Za-z0-9_]{16,}/g, `github_pat_${REDACTED}`)
  out = out.replace(/\bsk-[A-Za-z0-9_-]{16,}/g, `sk-${REDACTED}`)

  return out
}

/**
 * 深度脱敏任意值：字符串、对象、数组、Error（含 message/stack/cause）。
 *
 * 循环引用会被替换为 '[Circular]'，不会栈溢出。
 */
export function redactValue(value: unknown, secretValues?: string[]): unknown {
  const secrets = secretValues ?? collectSecretValues()
  const seen = new WeakSet<object>()

  function walk(node: unknown): unknown {
    if (typeof node === 'string') return redactString(node, secrets)
    if (node == null || typeof node !== 'object') return node

    if (seen.has(node as object)) return '[Circular]'
    seen.add(node as object)

    if (node instanceof Error) {
      const out: Record<string, unknown> = {
        name: node.name,
        message: redactString(node.message, secrets)
      }
      if (node.stack != null) out.stack = redactString(node.stack, secrets)
      if ((node as {cause?: unknown}).cause != null) {
        out.cause = walk((node as {cause?: unknown}).cause)
      }
      return out
    }

    if (Array.isArray(node)) return node.map(walk)

    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(node as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : walk(val)
    }
    return out
  }

  return walk(value)
}

/**
 * 把任意值转成可直接写日志的脱敏字符串。
 *
 * 自身绝不抛错：脱敏失败就退回到一个不含内容的占位符——
 * 宁可丢日志，也不能因为格式化异常把原文漏出去。
 */
export function redactForLog(value: unknown): string {
  try {
    if (typeof value === 'string') return redactString(value)
    const redacted = redactValue(value)
    return typeof redacted === 'string' ? redacted : JSON.stringify(redacted)
  } catch {
    return '[unloggable value redacted]'
  }
}
