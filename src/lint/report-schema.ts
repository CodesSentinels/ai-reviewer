/**
 * lint/report-schema.ts — 外部 lint 报告的严格校验（SEC-002 / SEC-005）
 *
 * P0 第二步把 lint 挪进**无密钥 job**：它 checkout PR head、跑工具、产出 JSON
 * 报告；有密钥的 reviewer job 只把这份报告当**数据**读回来。
 *
 * 这份数据完全由 PR 作者间接控制——他能决定被扫描的代码，因而能影响工具输出的
 * 文件名、规则 ID 和消息文本。所以跨过信任边界时必须假定它是敌意的：
 *
 * - **结构** 只按白名单取字段，未知字段一律丢弃，不做 `Object.assign` 式合并
 * - **类型** 逐字段校验；严重级别必须落在枚举内
 * - **规模** 条目数、字符串长度、工具汇总数都有上限，防止撑爆 prompt 预算
 * - **路径** 拒绝绝对路径与 `..`，报告里的 file 只应是仓库内相对路径
 * - **字符** 剥掉控制字符（包括用来伪造分节的换行滥用之外的不可见字符）
 *
 * 单条目不合法只丢该条目并计数，不因此废掉整份报告——否则一条脏数据就能让
 * 攻击者关掉整个静态分析。但结构性违规（顶层不是对象、results 不是数组）
 * 一律 fail closed。
 */

import type {LintReport, LintResult, ToolSummary} from './types'

/** 规模上限。超出部分截断，并在 warnings 里说明。 */
export const LINT_REPORT_LIMITS = {
  maxResults: 500,
  maxToolSummaries: 20,
  maxMessageLength: 2000,
  maxRuleIdLength: 200,
  maxPathLength: 512,
  maxToolNameLength: 64
} as const

const SEVERITIES = new Set(['error', 'warning', 'info'])

export interface ParsedLintReport {
  /** 结构性校验是否通过；false 时 report 为 null */
  ok: boolean
  report: LintReport | null
  /** 被丢弃的非法条目数 */
  dropped: number
  /** 人类可读的问题说明（截断、丢弃、结构错误） */
  warnings: string[]
}

/** 剥掉控制字符并截断；返回 null 表示该值不可用 */
function cleanString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  // eslint-disable-next-line no-control-regex
  const stripped = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
  const trimmed = stripped.trim()
  if (trimmed === '') return null
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}…[truncated]` : trimmed
}

/** 仓库内相对路径才可接受 */
function cleanPath(value: unknown): string | null {
  const cleaned = cleanString(value, LINT_REPORT_LIMITS.maxPathLength)
  if (cleaned == null) return null
  if (cleaned.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(cleaned)) return null
  if (cleaned.split(/[\\/]/).includes('..')) return null
  return cleaned
}

/** 1-based 正整数行列号 */
function cleanPosition(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) return null
  return value
}

function parseResult(raw: unknown): LintResult | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>

  const tool = cleanString(r.tool, LINT_REPORT_LIMITS.maxToolNameLength)
  const file = cleanPath(r.file)
  const line = cleanPosition(r.line)
  const column = cleanPosition(r.column)
  const ruleId = cleanString(r.ruleId, LINT_REPORT_LIMITS.maxRuleIdLength)
  const message = cleanString(r.message, LINT_REPORT_LIMITS.maxMessageLength)
  const severity = typeof r.severity === 'string' ? r.severity : null

  if (
    tool == null ||
    file == null ||
    line == null ||
    column == null ||
    ruleId == null ||
    message == null ||
    severity == null ||
    !SEVERITIES.has(severity)
  ) {
    return null
  }

  // 白名单构造：未知字段不会被带进来
  const result: LintResult = {
    tool,
    toolVersion: cleanString(r.toolVersion, LINT_REPORT_LIMITS.maxToolNameLength) ?? 'unknown',
    file,
    line,
    column,
    severity: severity as LintResult['severity'],
    ruleId,
    message,
    fixable: r.fixable === true
  }

  const endLine = cleanPosition(r.endLine)
  if (endLine != null && endLine >= line) result.endLine = endLine
  const endColumn = cleanPosition(r.endColumn)
  if (endColumn != null) result.endColumn = endColumn
  const suggestion = cleanString(r.suggestion, LINT_REPORT_LIMITS.maxMessageLength)
  if (suggestion != null) result.suggestion = suggestion

  return result
}

function parseToolSummary(raw: unknown): ToolSummary | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const s = raw as Record<string, unknown>

  const tool = cleanString(s.tool, LINT_REPORT_LIMITS.maxToolNameLength)
  if (tool == null) return null

  const summary: ToolSummary = {
    tool,
    toolVersion: cleanString(s.toolVersion, LINT_REPORT_LIMITS.maxToolNameLength) ?? 'unknown',
    available: s.available === true,
    errors: typeof s.errors === 'number' && s.errors >= 0 ? Math.floor(s.errors) : 0,
    warnings: typeof s.warnings === 'number' && s.warnings >= 0 ? Math.floor(s.warnings) : 0
  } as ToolSummary

  const reason = cleanString(s.unavailableReason, LINT_REPORT_LIMITS.maxMessageLength)
  if (reason != null) summary.unavailableReason = reason

  return summary
}

/**
 * 严格解析外部 lint 报告。
 *
 * 结构性违规 → `ok: false`；单条目违规 → 丢弃并计数。
 */
export function parseLintReport(raw: unknown): ParsedLintReport {
  const warnings: string[] = []

  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {ok: false, report: null, dropped: 0, warnings: ['lint report is not a JSON object']}
  }
  const obj = raw as Record<string, unknown>

  if (obj.results != null && !Array.isArray(obj.results)) {
    return {
      ok: false,
      report: null,
      dropped: 0,
      warnings: ['lint report `results` is not an array']
    }
  }
  if (obj.toolSummaries != null && !Array.isArray(obj.toolSummaries)) {
    return {
      ok: false,
      report: null,
      dropped: 0,
      warnings: ['lint report `toolSummaries` is not an array']
    }
  }

  const rawResults = (obj.results ?? []) as unknown[]
  const rawSummaries = (obj.toolSummaries ?? []) as unknown[]

  if (rawResults.length > LINT_REPORT_LIMITS.maxResults) {
    warnings.push(
      `lint report truncated: ${rawResults.length} results exceed limit ${LINT_REPORT_LIMITS.maxResults}`
    )
  }
  if (rawSummaries.length > LINT_REPORT_LIMITS.maxToolSummaries) {
    warnings.push(
      `lint report truncated: ${rawSummaries.length} tool summaries exceed limit ${LINT_REPORT_LIMITS.maxToolSummaries}`
    )
  }

  let dropped = 0
  const results: LintResult[] = []
  for (const item of rawResults.slice(0, LINT_REPORT_LIMITS.maxResults)) {
    const parsed = parseResult(item)
    if (parsed == null) dropped++
    else results.push(parsed)
  }

  const toolSummaries: ToolSummary[] = []
  for (const item of rawSummaries.slice(0, LINT_REPORT_LIMITS.maxToolSummaries)) {
    const parsed = parseToolSummary(item)
    if (parsed == null) dropped++
    else toolSummaries.push(parsed)
  }

  if (dropped > 0) warnings.push(`dropped ${dropped} malformed entr${dropped === 1 ? 'y' : 'ies'}`)

  const durationMs = typeof obj.durationMs === 'number' && obj.durationMs >= 0 ? obj.durationMs : 0
  const filesScanned =
    typeof obj.filesScanned === 'number' && obj.filesScanned >= 0 ? Math.floor(obj.filesScanned) : 0

  return {
    ok: true,
    report: {results, toolSummaries, durationMs, filesScanned},
    dropped,
    warnings
  }
}
