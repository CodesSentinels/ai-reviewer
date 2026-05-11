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
      `lint: post-filter kept ${filtered.length}/${results.length} findings (tolerance=${tolerance})`
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
