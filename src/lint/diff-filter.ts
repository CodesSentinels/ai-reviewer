/**
 * lint/diff-filter.ts - lint 结果过滤与去重
 *
 * 变更行扫描逻辑已上提到 src/changed-lines.ts，本模块仅保留：
 *   - filterByChangedLines / isLineInChangedWindow：基于变更行 ± tolerance 的过滤
 *   - deduplicateResults：跨工具同位置同问题去重
 *
 * 同时为兼容旧调用方（包括 __tests__/lint-diff-filter.test.ts），从
 * `../changed-lines` 重新导出 `extractChangedLinesFromPatch` 与 `buildChangedLineMap`。
 */

import {info} from '@actions/core'
import {
  buildChangedLineMap,
  extractChangedLinesFromPatch,
  type ChangedLineMap
} from '../changed-lines'
import {type LintResult} from './types'

// 兼容性 re-export
export {buildChangedLineMap, extractChangedLinesFromPatch}
export type {ChangedLineMap}

/** 变更行附近的"上下文容忍范围"。单位：行 */
export const DEFAULT_CONTEXT_TOLERANCE = 3

/**
 * 判断行号是否在变更窗口内（变更行 ± tolerance）
 */
export function isLineInChangedWindow(
  line: number,
  changedLines: Set<number>,
  tolerance: number = DEFAULT_CONTEXT_TOLERANCE
): boolean {
  for (const changed of changedLines) {
    if (Math.abs(line - changed) <= tolerance) return true
  }
  return false
}

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
      `lint: diff filter kept ${filtered.length}/${results.length} findings (tolerance=${tolerance})`
    )
  }
  return filtered
}

/**
 * 对结果去重
 *
 * 当 ESLint 与 Biome 同时报告"同一行 + 相似 message"时，去掉重复。
 * 去重 key：file:line:column + 规则名前缀 + message 前 50 字符。
 *
 * 保留策略：保留 severity 更高的那条；同级时保留出现最早的工具。
 */
export function deduplicateResults(results: LintResult[]): LintResult[] {
  const SEV_RANK: Record<LintResult['severity'], number> = {
    error: 3,
    warning: 2,
    info: 1
  }

  // 规则名归一化：去掉路径前缀，并剥离大小写/连字符/下划线，使
  // ESLint("no-unused-vars") 与 Biome("lint/style/noUnusedVars") 视为同一规则
  const normalizeRule = (rule: string): string => {
    const tail = rule.split('/').pop() ?? rule
    return tail.toLowerCase().replace(/[-_]/g, '')
  }

  const map = new Map<string, LintResult>()
  for (const r of results) {
    const msgKey = r.message.substring(0, 50).toLowerCase().replace(/\s+/g, ' ')
    const ruleKey = normalizeRule(r.ruleId)
    const key = `${r.file}:${r.line}:${r.column}:${ruleKey}:${msgKey}`
    const existing = map.get(key)
    if (existing == null || SEV_RANK[r.severity] > SEV_RANK[existing.severity]) {
      map.set(key, r)
    }
  }
  return Array.from(map.values())
}
