/**
 * prompt-profile.ts - `.ai-reviewer.yml` 的 profile 白名单与提示词片段（issue #231）
 *
 * 编程语言、技术领域只能从白名单里选，每个值对应一段**我们自己维护**的提示词片段。
 * 用户只选名字，文字不经过他们的手，所以这部分没有注入面，不需要走 scrubber。
 * 未知值：warning 后丢弃，绝不当文本透传。
 *
 * 框架、业务背景这类不好枚举的内容，走 system_message_append 的自然语言描述。
 * 新增一个值 = 在下面加一条片段（和别名）。
 */

export const PROFILE_LANGUAGE_FRAGMENTS: Readonly<Record<string, string>> = {
  nodejs:
    'Node.js / TypeScript: missing await and unhandled promise rejections, blocking the event loop with sync I/O, unsafe handling of user-controlled input (prototype pollution, path traversal, command / SQL injection), leaked streams, timers or listeners, errors lost in async code paths.',
  java: 'Java: null-safety and Optional misuse, resource leaks (try-with-resources), thread-safety of shared mutable state, equals / hashCode contracts, transaction boundaries, swallowed exceptions, SQL and deserialization injection, N+1 queries.',
  swift:
    'Swift: retain cycles in closures (missing [weak self]), force unwraps / try! / as!, UI work off the main thread, data races across actors or queues, async/await cancellation, object lifecycle and memory issues.'
}

export const PROFILE_DOMAIN_FRAGMENTS: Readonly<Record<string, string>> = {
  frontend:
    'Frontend: XSS and unsafe HTML injection, state and reactivity bugs, render or watcher loops, listeners and timers not cleaned up, SSR / hydration mismatches, accessibility regressions, hard-coded user-facing strings.',
  backend:
    'Backend: input validation and authentication / authorization checks, idempotency and retry safety, transaction and consistency boundaries, race conditions, error handling and timeouts, API backward compatibility, sensitive data in logs.'
}

/** 常见写法 → 白名单键（目前只支持英文别名） */
const ALIASES: Readonly<Record<string, string>> = {
  node: 'nodejs',
  'node.js': 'nodejs'
}

export type ProfileKind = 'languages' | 'domains'

function tableOf(kind: ProfileKind): Readonly<Record<string, string>> {
  return kind === 'languages' ? PROFILE_LANGUAGE_FRAGMENTS : PROFILE_DOMAIN_FRAGMENTS
}

export function allowedProfileValues(kind: ProfileKind): string[] {
  return Object.keys(tableOf(kind))
}

/**
 * 把 YAML 里的值规范成白名单键的列表（去重、保持出现顺序）。
 * 非白名单的值写进 rejected，由调用方记 warning 并留提示。
 */
export function normalizeProfileValues(
  value: unknown,
  kind: ProfileKind
): {accepted: string[]; rejected: string[]; malformed: boolean} {
  const items =
    typeof value === 'string' ? [value] : Array.isArray(value) ? (value as unknown[]) : null
  if (items == null) return {accepted: [], rejected: [], malformed: true}

  const table = tableOf(kind)
  const accepted: string[] = []
  const rejected: string[] = []
  for (const item of items) {
    if (typeof item !== 'string') {
      rejected.push(String(item))
      continue
    }
    const key = item.trim().toLowerCase()
    const canonical = ALIASES[key] ?? key
    if (Object.prototype.hasOwnProperty.call(table, canonical)) {
      if (!accepted.includes(canonical)) accepted.push(canonical)
    } else {
      // 只记很短的片段，避免把任意长文本带进日志和评论
      rejected.push(item.slice(0, 40))
    }
  }
  return {accepted, rejected, malformed: false}
}

/** 渲染 profile 段；两者都为空返回 ''，保证没配置时提示词逐字不变 */
export function renderProfileSection(languages: string[], domains: string[]): string {
  const lines: string[] = []
  for (const l of languages) {
    if (PROFILE_LANGUAGE_FRAGMENTS[l]) lines.push(`- ${PROFILE_LANGUAGE_FRAGMENTS[l]}`)
  }
  for (const d of domains) {
    if (PROFILE_DOMAIN_FRAGMENTS[d]) lines.push(`- ${PROFILE_DOMAIN_FRAGMENTS[d]}`)
  }
  if (lines.length === 0) return ''
  return `Additional focus areas for this repository (in addition to the general rules above):\n${lines.join(
    '\n'
  )}`
}
