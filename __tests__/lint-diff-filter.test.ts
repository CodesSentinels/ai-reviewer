/**
 * lint-diff-filter.test.ts - Linter/SAST 集成的变更行过滤模块测试
 *
 * 覆盖：
 * - extractChangedLinesFromPatch 解析 unified diff 的 +/-/' ' 行号推进逻辑
 * - filterByChangedLines 仅保留命中变更窗口的工具结果
 * - deduplicateResults 跨工具同位置去重，保留更高严重级别
 */

import {describe, expect, jest, test} from '@jest/globals'

jest.mock('@actions/core', () => ({
  info: jest.fn(),
  warning: jest.fn()
}))

import {
  buildChangedLineMap,
  deduplicateResults,
  extractChangedLinesFromPatch,
  filterByChangedLines
} from '../src/lint/diff-filter'
import {type LintResult} from '../src/lint/types'

describe('extractChangedLinesFromPatch', () => {
  test('extracts new file line numbers for + lines only', () => {
    const patch = `@@ -10,3 +10,4 @@
 context
-old
+new1
+new2
 trail`
    const lines = extractChangedLinesFromPatch(patch)
    expect(Array.from(lines).sort((a, b) => a - b)).toEqual([11, 12])
  })

  test('handles multiple hunks', () => {
    const patch = `@@ -1,1 +1,2 @@
 a
+b
@@ -10,1 +11,2 @@
 c
+d`
    const lines = extractChangedLinesFromPatch(patch)
    expect(Array.from(lines).sort((a, b) => a - b)).toEqual([2, 12])
  })

  test('returns empty set for empty patch', () => {
    expect(extractChangedLinesFromPatch('').size).toBe(0)
  })
})

describe('filterByChangedLines', () => {
  const mkResult = (
    file: string,
    line: number,
    severity: LintResult['severity'] = 'error'
  ): LintResult => ({
    tool: 'ESLint',
    toolVersion: '9.0.0',
    file,
    line,
    column: 1,
    severity,
    ruleId: 'no-unused-vars',
    message: 'unused',
    fixable: false
  })

  test('keeps results within tolerance window', () => {
    const map = new Map([['src/a.ts', new Set([10])]])
    const results = [
      mkResult('src/a.ts', 10), // exact match
      mkResult('src/a.ts', 12), // within tolerance (+2)
      mkResult('src/a.ts', 20), // outside tolerance
      mkResult('src/b.ts', 10) // file not in map
    ]
    const out = filterByChangedLines(results, map, 3)
    expect(out.map(r => `${r.file}:${r.line}`)).toEqual([
      'src/a.ts:10',
      'src/a.ts:12'
    ])
  })

  test('drops results when changedLineMap entry is empty', () => {
    const map = new Map([['src/a.ts', new Set<number>()]])
    expect(filterByChangedLines([mkResult('src/a.ts', 10)], map).length).toBe(0)
  })
})

describe('deduplicateResults', () => {
  const mk = (
    tool: string,
    severity: LintResult['severity'],
    rule: string,
    msg: string
  ): LintResult => ({
    tool,
    toolVersion: '1.0.0',
    file: 'a.ts',
    line: 5,
    column: 1,
    severity,
    ruleId: rule,
    message: msg,
    fixable: false
  })

  test('keeps higher-severity duplicate', () => {
    const a = mk('ESLint', 'warning', 'no-unused-vars', 'foo is unused')
    const b = mk('Biome', 'error', 'lint/style/noUnusedVars', 'foo is unused')
    const out = deduplicateResults([a, b])
    expect(out.length).toBe(1)
    expect(out[0].severity).toBe('error')
  })

  test('keeps distinct findings on same line', () => {
    const a = mk('ESLint', 'warning', 'no-unused-vars', 'foo is unused')
    const b = mk('ESLint', 'error', 'no-undef', 'bar is undefined')
    const out = deduplicateResults([a, b])
    expect(out.length).toBe(2)
  })
})

describe('buildChangedLineMap', () => {
  test('maps each filename to its changed line set', () => {
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
      ['src/b.ts', '', '', []]
    ]
    const map = buildChangedLineMap(filesAndChanges)
    expect(Array.from(map.get('src/a.ts')!).sort()).toEqual([2])
    expect(map.get('src/b.ts')!.size).toBe(0)
  })
})
