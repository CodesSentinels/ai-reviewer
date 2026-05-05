/**
 * lint/diff-filter.ts - 变更行提取与结果过滤
 *
 * 工具会扫描整个文件，但 PR 审查只关心变更行附近的问题。
 * 本模块从 unified diff 中提取每个文件的变更行号集合，
 * 并据此过滤工具结果。
 */

import {info} from '@actions/core'
import {type ChangedLineMap, type LintResult} from './types'

/** 变更行附近的"上下文容忍范围"。单位：行 */
export const DEFAULT_CONTEXT_TOLERANCE = 3

/**
 * 从单个文件的 diff patch 中提取所有变更行号
 *
 * 仅采集"新增行（+）"对应的新文件行号。删除行不产生新文件行号。
 * 上下文行（空格前缀）也会推进新文件行号但不算变更行。
 *
 * @param patch unified diff 字符串
 * @returns 变更行号集合（基于新文件，1-based）
 */
export function extractChangedLinesFromPatch(patch: string): Set<number> {
  const changed = new Set<number>()
  if (!patch) return changed

  const hunkHeader = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/
  const lines = patch.split('\n')
  let currentNewLine = 0
  let inHunk = false

  for (const line of lines) {
    const m = line.match(hunkHeader)
    if (m != null) {
      currentNewLine = parseInt(m[1], 10)
      inHunk = true
      continue
    }
    if (!inHunk) continue
    if (line.startsWith('+')) {
      changed.add(currentNewLine)
      currentNewLine++
    } else if (line.startsWith('-')) {
      // 删除行不增加新文件行号
    } else if (line.startsWith(' ')) {
      currentNewLine++
    } else if (line.startsWith('\\')) {
      // "\ No newline at end of file" — 忽略
    } else {
      inHunk = false
    }
  }

  return changed
}

/**
 * 从 filesAndChanges 三元组列表构建变更行映射
 *
 * @param filesAndChanges [filename, fileContent, fileDiff, patches] 列表
 *   其中 fileDiff 为整个文件的 unified diff
 * @returns 文件 → 变更行号集合
 */
export function buildChangedLineMap(
  filesAndChanges: Array<
    [string, string, string, Array<[number, number, string]>]
  >
): ChangedLineMap {
  const map: ChangedLineMap = new Map()
  for (const [filename, , fileDiff] of filesAndChanges) {
    map.set(filename, extractChangedLinesFromPatch(fileDiff))
  }
  return map
}

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
 * @param changedLineMap 变更行映射
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
