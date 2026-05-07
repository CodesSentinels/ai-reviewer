/**
 * changed-lines.test.ts — 集中后的 unified diff 扫描器测试
 *
 * 重点验证 scanPatch 一次性产出两份语义不同的集合：
 *   - addedLines：仅 + 行（lint 用）
 *   - touchedLines：+ 与 - 行（依赖分析用，删除位置也算"作用域被改"）
 */

import {describe, expect, jest, test} from '@jest/globals'

jest.mock('@actions/core', () => ({
  info: jest.fn(),
  warning: jest.fn()
}))

import {
  buildPatchScans,
  extractChangedLinesFromPatch,
  scanPatch,
  toAddedLineMap
} from '../src/changed-lines'

describe('scanPatch — 单次 walk 同时产出 added/touched', () => {
  test('混合 + / - / 上下文：addedLines 仅 +，touchedLines 含 - 位置', () => {
    const patch = `@@ -10,5 +10,5 @@
 ctx-a
-removed
+added1
+added2
 ctx-b`
    const {addedLines, touchedLines} = scanPatch(patch)

    // 仅 +：行 11、12（基于新文件）
    expect(Array.from(addedLines).sort((a, b) => a - b)).toEqual([11, 12])
    // + 与 - 都标：删除行的位置 currentNewLine=11，加上 +11 +12 → {11, 12}
    expect(Array.from(touchedLines).sort((a, b) => a - b)).toEqual([11, 12])
  })

  test('纯删除 hunk：addedLines 为空，touchedLines 标删除位置', () => {
    const patch = `@@ -5,3 +5,1 @@
 keep
-gone1
-gone2`
    const {addedLines, touchedLines} = scanPatch(patch)
    expect(addedLines.size).toBe(0)
    expect(Array.from(touchedLines)).toEqual([6])
  })

  test('多 hunk：每个 hunk 内独立推进 newLine', () => {
    const patch = `@@ -1,1 +1,2 @@
 a
+b
@@ -10,1 +11,2 @@
 c
+d`
    const {addedLines, touchedLines} = scanPatch(patch)
    expect(Array.from(addedLines).sort((a, b) => a - b)).toEqual([2, 12])
    expect(Array.from(touchedLines).sort((a, b) => a - b)).toEqual([2, 12])
  })

  test('空字符串 / null / undefined 不抛异常', () => {
    expect(scanPatch('').addedLines.size).toBe(0)
    expect(scanPatch(null).touchedLines.size).toBe(0)
    expect(scanPatch(undefined).addedLines.size).toBe(0)
  })

  test('"\\\\ No newline at end of file" 标记不影响行号推进', () => {
    const patch = `@@ -1,2 +1,2 @@
 keep
-old
+new
\\ No newline at end of file`
    const {addedLines, touchedLines} = scanPatch(patch)
    expect(Array.from(addedLines)).toEqual([2])
    expect(Array.from(touchedLines).sort((a, b) => a - b)).toEqual([2])
  })
})

describe('extractChangedLinesFromPatch — 兼容旧调用方', () => {
  test('与 scanPatch().addedLines 等价', () => {
    const patch = `@@ -1,1 +1,2 @@
 a
+b`
    const set = extractChangedLinesFromPatch(patch)
    expect(Array.from(set)).toEqual([2])
  })
})

describe('buildPatchScans / toAddedLineMap', () => {
  const filesAndChanges: Array<
    [string, string, string, Array<[number, number, string]>]
  > = [
    [
      'src/a.ts',
      '',
      `@@ -1,1 +1,2 @@
 a
+b`,
      []
    ],
    [
      'src/b.ts',
      '',
      `@@ -5,2 +5,1 @@
 keep
-removed`,
      []
    ]
  ]

  test('buildPatchScans 每文件一条 PatchScan', () => {
    const scans = buildPatchScans(filesAndChanges)
    expect(scans.size).toBe(2)
    expect(Array.from(scans.get('src/a.ts')!.addedLines)).toEqual([2])
    expect(scans.get('src/b.ts')!.addedLines.size).toBe(0)
    expect(Array.from(scans.get('src/b.ts')!.touchedLines)).toEqual([6])
  })

  test('toAddedLineMap 仅保留 addedLines 字段', () => {
    const scans = buildPatchScans(filesAndChanges)
    const addedMap = toAddedLineMap(scans)
    expect(Array.from(addedMap.get('src/a.ts')!)).toEqual([2])
    expect(addedMap.get('src/b.ts')!.size).toBe(0)
  })
})
