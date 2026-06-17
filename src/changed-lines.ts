/**
 * changed-lines.ts - 统一的 unified diff 行号扫描器
 *
 * 历史上 review.ts / dependency-analyzer.ts / lint/lint-filter.ts 各自实现了
 * 几乎一样的"逐行 walk diff、推进 newLine"逻辑。这里集中一份，
 * 让上层调用方一次扫描产出两份语义不同的集合：
 *
 *   - addedLines     ：仅 `+` 行的新文件行号
 *                       适用：lint 结果窗口过滤（删除行不存在于新文件，无 finding 可言）
 *
 *   - touchedLines   ：`+` 与 `-` 两类行的新文件行号（删除行标记其发生位置）
 *                       适用：依赖分析判断"导出函数作用域内是否有变更"
 *                            （只有删除也算函数被修改）
 *
 * 设计原则：
 *   - 单次 walk，生成两份集合，避免对同一份 diff 字符串的重复扫描
 *   - 各消费者按字段挑取所需，不再各自实现 walker
 */

/**
 * 单文件 diff 扫描结果
 */
export interface PatchScan {
  /** + 行的新文件行号（1-based） */
  addedLines: Set<number>
  /** + 与 - 行的新文件行号（删除行标记其发生位置） */
  touchedLines: Set<number>
}

/**
 * 按文件归集的扫描结果。
 *
 * 兼容 `Map<filename, Set<number>>` 形式由 caller 通过提取 `addedLines` 字段拿到。
 */
export type PatchScanMap = Map<string, PatchScan>

/** 兼容旧调用方：仅 + 行的 Set 映射 */
export type ChangedLineMap = Map<string, Set<number>>

const HUNK_HEADER_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/

/**
 * 对单个文件的 unified diff 做一次 walk，返回 `addedLines` 与 `touchedLines`
 *
 * 规则：
 *   - 遇到 `@@ -a,b +c,d @@` 头：currentNewLine = c
 *   - `+` 行：addedLines.add(currentNewLine); touchedLines.add(currentNewLine); currentNewLine++
 *   - `-` 行：仅 touchedLines.add(currentNewLine)；不推进 currentNewLine
 *   - ` ` 行（上下文）：仅推进 currentNewLine
 *   - `\` 行（"\ No newline at end of file"）：忽略
 *   - 其他：视为 hunk 结束
 */
export function scanPatch(patch: string | null | undefined): PatchScan {
  const addedLines = new Set<number>()
  const touchedLines = new Set<number>()
  if (!patch) return {addedLines, touchedLines}

  let currentNewLine = 0
  let inHunk = false

  for (const line of patch.split('\n')) {
    const m = line.match(HUNK_HEADER_RE)
    if (m != null) {
      currentNewLine = parseInt(m[1], 10)
      inHunk = true
      continue
    }
    if (!inHunk) continue
    if (line.startsWith('+')) {
      addedLines.add(currentNewLine)
      touchedLines.add(currentNewLine)
      currentNewLine++
    } else if (line.startsWith('-')) {
      touchedLines.add(currentNewLine)
      // 删除行不推进 newLine
    } else if (line.startsWith(' ')) {
      currentNewLine++
    } else if (line.startsWith('\\')) {
      // 忽略 "\ No newline at end of file"
    } else {
      inHunk = false
    }
  }

  return {addedLines, touchedLines}
}

/**
 * 兼容方法：仅返回 added 行 Set（与早期 `extractChangedLinesFromPatch` 等价）
 */
export function extractChangedLinesFromPatch(
  patch: string | null | undefined
): Set<number> {
  return scanPatch(patch).addedLines
}

/**
 * 对 PR 中所有变更文件做一次 walk，得到 PatchScanMap
 *
 * @param filesAndChanges [filename, fileContent, fileDiff, patches] 列表
 */
export function buildPatchScans(
  filesAndChanges: Array<
    [string, string, string, Array<[number, number, string]>]
  >
): PatchScanMap {
  const map: PatchScanMap = new Map()
  for (const [filename, , fileDiff] of filesAndChanges) {
    map.set(filename, scanPatch(fileDiff))
  }
  return map
}

/**
 * 兼容方法：返回 file → addedLines Set 的映射
 *
 * 内部仍走 `buildPatchScans`，仅丢弃 touchedLines 字段。
 */
export function buildChangedLineMap(
  filesAndChanges: Array<
    [string, string, string, Array<[number, number, string]>]
  >
): ChangedLineMap {
  const map: ChangedLineMap = new Map()
  for (const [filename, scan] of buildPatchScans(filesAndChanges)) {
    map.set(filename, scan.addedLines)
  }
  return map
}

/**
 * 从 PatchScanMap 派生出 added-only 的 ChangedLineMap（lint 用）
 */
export function toAddedLineMap(scans: PatchScanMap): ChangedLineMap {
  const map: ChangedLineMap = new Map()
  for (const [filename, scan] of scans) {
    map.set(filename, scan.addedLines)
  }
  return map
}
