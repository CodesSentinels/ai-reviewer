/**
 * lint/formatter.ts - LintReport 的格式化辅助函数
 *
 * 提供两类输出：
 * 1. formatLintContextForFile: 单文件的工具结果，用于注入 LLM 审查 Prompt
 * 2. formatLintSummary: 跨文件统计表，用于 PR 摘要评论
 *
 * 输出格式参考 CodeRabbit "🧰 Tools" 风格，便于人眼快速辨识工具产物。
 */

import {type LintReport, type LintResult} from './types'

/** 注入 Prompt 的最大字符数（按行截断），避免打爆 token 预算 */
const MAX_PROMPT_CHARS_PER_FILE = 4000

/** 单文件 Prompt 注入：只保留 file == filename 的 lint 结果 */
export function formatLintContextForFile(
  filename: string,
  report: LintReport
): string {
  const fileResults = report.results.filter(r => r.file === filename)
  if (fileResults.length === 0) return ''

  const byTool = new Map<string, LintResult[]>()
  for (const r of fileResults) {
    const list = byTool.get(r.tool) ?? []
    list.push(r)
    byTool.set(r.tool, list)
  }

  const lines: string[] = []
  lines.push('## Static analysis tool results')
  lines.push('')
  lines.push(
    'The following findings come from static analysis tools that scanned the changed files. Use them as cross-validation signals when writing your review:'
  )
  lines.push('')
  lines.push('🧰 Tools')

  for (const [tool, results] of byTool) {
    const version = results[0]?.toolVersion
    lines.push(`🪛 ${tool}${version ? ` (${version})` : ''}`)
    for (const r of results) {
      const range =
        r.endLine != null && r.endLine !== r.line
          ? `${r.line}-${r.endLine}`
          : `${r.line}`
      const sev = severityIcon(r.severity)
      lines.push(
        `${sev} [${r.severity}] ${r.file}:${range} — ${r.ruleId}: ${oneLine(r.message)}`
      )
    }
    lines.push('')
  }

  lines.push('Review guidance:')
  lines.push('1. For each tool finding, confirm whether it is a real issue and explain its business impact.')
  lines.push("2. Mention findings the tools missed (logic / architecture issues a Linter cannot detect).")
  lines.push('3. When you write a review comment that overlaps with a tool finding, mark it as cross-validated by listing the tool name(s).')

  return truncate(lines.join('\n'), MAX_PROMPT_CHARS_PER_FILE)
}

/**
 * 把"在变更行 / 总共"两个数字渲染成单元格文本。
 *
 * 相等时只显示一个数；否则用 `X / Y` 表达："进入 PR 评论的 X 个 / 工具原始扫到的 Y 个"。
 * 这种约定能直接区分 ESLint（针对变更文件扫，一般 X≈Y）与 tsc（项目级扫，X≪Y 是常态）。
 */
function fmtCount(onChanges: number, total: number): string {
  if (onChanges === total) return `${total}`
  return `${onChanges} / ${total}`
}

/** PR 摘要中的工具统计表（Markdown） */
export function formatLintSummary(report: LintReport): string {
  if (report.toolSummaries.length === 0) return ''

  // 表格列说明：
  //   - Errors / Warnings 列采用 "X / Y" 格式（X=变更行上 + 去重后的最终评论数, Y=工具原始扫描数）
  //   - 当两者相等时简化为单一数字
  //   - "Files Scanned" 列对项目级扫描器（如 tsc）来说不准；适配器自己上报值
  const rows = report.toolSummaries
    .map(s => {
      if (!s.available) {
        return `| ${s.tool} | _unavailable_ | _unavailable_ | 0 | ${s.unavailableReason ?? '—'} |`
      }
      const errCol = fmtCount(s.errorsOnChanges, s.errors)
      const warnCol = fmtCount(s.warningsOnChanges, s.warnings)
      return `| ${s.tool}${s.toolVersion ? ` ${s.toolVersion}` : ''} | ${errCol} | ${warnCol} | ${s.filesScanned} | ${s.durationMs}ms |`
    })
    .join('\n')

  const totalFindings = report.results.length
  const note =
    totalFindings === 0
      ? '_No findings reported on changed lines._'
      : `_${totalFindings} finding${totalFindings === 1 ? '' : 's'} on changed lines._`

  // 仅当至少有一个工具的 errorsOnChanges < errors（或 warnings 同理）时显示图例，
  // 避免每次都铺一段说明
  const hasSplit = report.toolSummaries.some(
    s =>
      s.available &&
      (s.errorsOnChanges !== s.errors || s.warningsOnChanges !== s.warnings)
  )
  const legend = hasSplit
    ? `
> _Errors / Warnings 列读法_：\`X / Y\` 表示"进入 PR 评论的 X 个 / 工具原始扫描到的 Y 个"。
> 项目级扫描器（如 TypeScript）会扫到与本次 PR 无关的存量错误，变更行过滤后只保留与改动相关的部分。
`
    : ''

  return `
<details>
<summary>🧰 Static Analysis Summary (${report.toolSummaries.length} tool${report.toolSummaries.length === 1 ? '' : 's'})</summary>

${note}
${legend}
| Tool | Errors | Warnings | Files Scanned | Duration |
|:-----|:------:|:--------:|:-------------:|:---------|
${rows}

</details>
`
}

/**
 * 单条评论的工具标注：CodeRabbit "🧰 Tools" 卡片
 *
 * 用于审查评论底部，显示与该评论行号范围重叠的工具发现。
 */
export function formatToolAttribution(
  filename: string,
  startLine: number,
  endLine: number,
  report: LintReport
): string {
  const overlapping = report.results.filter(r => {
    if (r.file !== filename) return false
    const rEnd = r.endLine ?? r.line
    return rEnd >= startLine && r.line <= endLine
  })
  if (overlapping.length === 0) return ''

  const byTool = new Map<string, LintResult[]>()
  for (const r of overlapping) {
    const list = byTool.get(r.tool) ?? []
    list.push(r)
    byTool.set(r.tool, list)
  }

  const lines: string[] = []
  lines.push('')
  lines.push('🧰 Tools')
  for (const [tool, results] of byTool) {
    const version = results[0]?.toolVersion
    lines.push(`🪛 ${tool}${version ? ` (${version})` : ''}`)
    for (const r of results) {
      const range =
        r.endLine != null && r.endLine !== r.line
          ? `${r.line}-${r.endLine}`
          : `${r.line}-${r.line}`
      lines.push(`[${r.severity}] ${range}: ${oneLine(r.message)}`)
      lines.push(`(${r.ruleId})`)
    }
  }
  return lines.join('\n')
}

function severityIcon(sev: LintResult['severity']): string {
  if (sev === 'error') return '🔴'
  if (sev === 'warning') return '🟡'
  return '🔵'
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  const cut = s.lastIndexOf('\n', max)
  return s.substring(0, cut > 0 ? cut : max) + '\n... (truncated)'
}
