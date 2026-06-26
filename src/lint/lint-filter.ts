/**
 * lint/lint-filter.ts - Lint 结果后处理（过滤 + 去重）
 *
 * 此模块**不接触 diff 文本**，也不调用任何 lint 工具。
 * 它接收"所有适配器已经跑出来的发现列表"，做两步后处理：
 *
 *   1. filterByChangedLines —— 仅保留落在 PR 变更行 ± tolerance 范围内的发现
 *      （tsc 这种项目级扫描器经常报出与本次 PR 无关的存量错误，需在此剔除）
 *
 *   2. deduplicateResults —— 跨工具同位置同问题去重
 *      （ESLint 和 Biome 对同一个"未使用变量"会各报一条，需合并为一条）
 *
 * 在 orchestrator 流水线中位于"全部适配器 scan 完成"之后、"生成 LintReport"之前。
 *
 * 历史：本文件曾叫 `diff-filter.ts`，因为最初它直接读 unified diff。后来变更行
 * 扫描逻辑上提到 `src/changed-lines.ts`，本模块就只剩"后处理"了，故 2026-05 改名
 * 为 lint-filter.ts。
 */

import {info} from '@actions/core'
import {type ChangedLineMap} from '../changed-lines'
import {type LintResult} from './types'

/** 变更行附近的"上下文容忍范围"。单位：行 */
export const DEFAULT_CONTEXT_TOLERANCE = 3

/**
 * 过滤 lint 结果：仅保留变更行 ± tolerance 范围内的问题
 *
 * 同时会丢弃文件不在 changedLineMap 中的结果（通常意味着工具扫描了
 * 非 PR 变更文件）。
 *
 * @param results 原始 lint 结果
 * @param changedLineMap 变更行映射（由调用方传入；典型来自 `buildPatchScans` 的 addedLines）
 * @param tolerance 上下文容忍范围（默认 3 行）
 */
export function filterByChangedLines(
  results: LintResult[],
  changedLineMap: ChangedLineMap,
  tolerance: number = DEFAULT_CONTEXT_TOLERANCE
): LintResult[] {
  const filtered: LintResult[] = []
  for (const r of results) {
    const changedLines = changedLineMap.get(r.file)
    if (changedLines == null || changedLines.size === 0) continue

    const startLine = r.line
    const endLine = r.endLine ?? r.line

    // 命中规则：问题的任何一行落在 [changed - tol, changed + tol] 内
    let hit = false
    for (const cl of changedLines) {
      if (endLine >= cl - tolerance && startLine <= cl + tolerance) {
        hit = true
        break
      }
    }
    if (hit) filtered.push(r)
  }

  if (results.length !== filtered.length) {
    info(
      `lint: post-filter kept ${filtered.length}/${results.length} findings (tolerance=${tolerance})`
    )
  }
  return filtered
}

/**
 * 对结果去重
 *
 * 当 ESLint 与 Biome 同时报告"同一行 + 相似 message"时，去掉重复；
 * 同样地，单个工具在一行多处触发同款规则（如 `(req: any, res: any) => any`
 * 里的 3 个 `any`）也只保留 1 条 —— PR 评审视角下这是 1 件事，3 条评论
 * 是噪声。
 *
 * 去重 key：`file:line:ruleKey:msgKey`（**故意不含 column**）。
 * 保留策略：保留 severity 更高的那条；同级时保留出现最早的工具。
 *
 * ## 为什么 key 不含 column
 *
 * Biome 对一行多个 `any` 会报多条（col 25 / 40 / 55），ESLint 也类似。
 * 但 🧰 Tools 卡片只显示 `[level] line-endLine: msg (rule)`，列号不可见。
 * 含 column 时 N 条同款 finding 都会进 PR 评论区，渲染出来一模一样，
 * 用户视感是"重复评论 bug"。
 *
 * 去掉 column 不会丢精确度 —— 我们仍在 LintResult.column 字段保留首次出
 * 现的列号给行号定位用；只是把"为同款问题重复评论 N 次"折叠成 1 次。
 *
 * **不会误合并真正不同的 finding**：
 *   - 不同行 → 不同 key（line 不同）→ 保留
 *   - 同行不同规则 → 不同 ruleKey → 保留
 *   - 同行同规则不同消息（如 'foo unused' vs 'bar unused'） → 不同 msgKey → 保留
 */
export function deduplicateResults(results: LintResult[]): LintResult[] {
  const SEV_RANK: Record<LintResult['severity'], number> = {
    error: 3,
    warning: 2,
    info: 1
  }

  const map = new Map<string, LintResult>()
  for (const r of results) {
    const msgKey = r.message.substring(0, 50).toLowerCase().replace(/\s+/g, ' ')
    const ruleKey = normalizeRule(r.ruleId)
    // 故意不含 column —— 详见函数顶 doc comment
    const key = `${r.file}:${r.line}:${ruleKey}:${msgKey}`
    const existing = map.get(key)
    if (
      existing == null ||
      SEV_RANK[r.severity] > SEV_RANK[existing.severity]
    ) {
      map.set(key, r)
    }
  }
  return Array.from(map.values())
}

/**
 * 规则名归一化：去掉路径前缀，剥离大小写/连字符/下划线。
 * ESLint("no-unused-vars") 与 Biome("lint/style/noUnusedVars") 视为同一规则。
 */
function normalizeRule(rule: string): string {
  const tail = rule.split('/').pop() ?? rule
  return tail.toLowerCase().replace(/[-_]/g, '')
}

/**
 * 把"相邻行的同款 finding"合并为单个范围。
 *
 * 应在 `deduplicateResults` 之后调用 —— 同行同款已经被合并，本函数只处理
 * **跨行**的相邻同款。
 *
 * ## 合并条件（必须全部满足）
 *   - 同 file
 *   - 同 normalized ruleId
 *   - 同 message 前 50 字符（前缀匹配，避免微小格式差异破坏合并）
 *   - 同 severity
 *   - 同 tool（不跨工具合并，避免"Biome 报 line 88 + ESLint 报 line 89"被误合）
 *   - line[i+1] ≤ endLine[i] + 1（相邻或重叠；隔 ≥ 2 行不合并）
 *
 * ## 合并后结果
 *   - `line` = min(原始 line)
 *   - `endLine` = max(原始 endLine ?? line)
 *   - 其他字段沿用第一条 finding（column / message / suggestion / ...）
 *
 * ## 典型场景
 *   - tsc 报 line 88、89 都 `Cannot find name 'Buffer'` → 合并 `88-89`
 *   - 同 unused-vars 但不同变量名（'foo' / 'bar'） → message 不同，**不**合并
 *   - 88、90 同款（中间隔一行非问题代码） → **不**合并，是两段独立代码
 */
export function collapseAdjacentFindings(results: LintResult[]): LintResult[] {
  // 1) 按"可合并组"分桶
  const groups = new Map<string, LintResult[]>()
  for (const r of results) {
    const msgKey = r.message.substring(0, 50).toLowerCase().replace(/\s+/g, ' ')
    const ruleKey = normalizeRule(r.ruleId)
    const groupKey = `${r.file}:${ruleKey}:${msgKey}:${r.severity}:${r.tool}`
    const list = groups.get(groupKey) ?? []
    list.push(r)
    groups.set(groupKey, list)
  }

  // 2) 每组内按起始行排序，相邻则合并
  const out: LintResult[] = []
  for (const list of groups.values()) {
    if (list.length === 1) {
      out.push(list[0])
      continue
    }
    list.sort(
      (a, b) => a.line - b.line || (a.endLine ?? a.line) - (b.endLine ?? b.line)
    )
    let current: LintResult = {...list[0]}
    for (let i = 1; i < list.length; i++) {
      const next = list[i]
      const currentEnd = current.endLine ?? current.line
      const nextEnd = next.endLine ?? next.line
      if (next.line <= currentEnd + 1) {
        // 相邻或重叠 → 扩展 current 的尾部
        current.endLine = Math.max(currentEnd, nextEnd)
      } else {
        // 隔 ≥ 2 行 → flush current，开新 segment
        out.push(current)
        current = {...next}
      }
    }
    out.push(current)
  }

  return out
}
