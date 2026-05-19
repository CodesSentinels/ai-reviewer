/**
 * lint-filter.test.ts - Linter/SAST 后处理（过滤 + 去重）测试
 *
 * 覆盖：
 * - extractChangedLinesFromPatch 解析 unified diff 的 +/-/' ' 行号推进逻辑
 *   （位于 src/changed-lines.ts —— 仍在此处一并测试，省得拆两个文件）
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
  extractChangedLinesFromPatch
} from '../src/changed-lines'
import {
  collapseAdjacentFindings,
  deduplicateResults,
  filterByChangedLines
} from '../src/lint/lint-filter'
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

  test('回归：同行同规则同 message 多列 → 仅保留 1 条（Biome `any` ×3 场景）', () => {
    // 模拟 `(req: any, res: any) => any` 在第 30 行被 Biome 报 3 次，
    // 区别仅在 column（col 25 / 40 / 55）。修复前 3 条都进评论区，
    // 修复后只保留 1 条。
    const a: LintResult = {
      tool: 'Biome',
      toolVersion: '2.4.15',
      file: 'utils/sec-test-semgrep-2.ts',
      line: 30,
      column: 25,
      severity: 'warning',
      ruleId: 'lint/suspicious/noExplicitAny',
      message: 'Unexpected any. Specify a different type.',
      fixable: false
    }
    const b: LintResult = {...a, column: 40}
    const c: LintResult = {...a, column: 55}

    const out = deduplicateResults([a, b, c])
    expect(out.length).toBe(1)
    expect(out[0].ruleId).toBe('lint/suspicious/noExplicitAny')
    expect(out[0].line).toBe(30)
  })

  test('回归：不同行同规则同 message → 全部保留（tsc Buffer 在 line 68/70 场景）', () => {
    // 这条与上一条配对，确认修复不会"过度合并"真正不同位置的发现
    const a: LintResult = {
      tool: 'TypeScript',
      toolVersion: '5.9.3',
      file: 'utils/sec-test-semgrep-2.ts',
      line: 68,
      column: 10,
      severity: 'error',
      ruleId: 'TS2580',
      message: "Cannot find name 'Buffer'.",
      fixable: false
    }
    const b: LintResult = {...a, line: 70}
    const c: LintResult = {...a, line: 89}

    const out = deduplicateResults([a, b, c])
    expect(out.length).toBe(3)
    expect(out.map(r => r.line).sort((x, y) => x - y)).toEqual([68, 70, 89])
  })

  test('回归：同行同规则不同 message → 全部保留（不同变量未使用）', () => {
    // 同行 `let foo, bar;` 触发 2 次 no-unused-vars 但 message 不同
    const a = mk('ESLint', 'error', 'no-unused-vars', "'foo' is unused")
    const b = mk('ESLint', 'error', 'no-unused-vars', "'bar' is unused")
    const out = deduplicateResults([a, b])
    expect(out.length).toBe(2)
  })
})

describe('collapseAdjacentFindings', () => {
  /** 通用构造器：相邻合并测试只关心 file/line/tool/rule/message/severity */
  const mk = (
    line: number,
    opts: {
      tool?: string
      rule?: string
      msg?: string
      severity?: LintResult['severity']
      endLine?: number
      file?: string
    } = {}
  ): LintResult => ({
    tool: opts.tool ?? 'TypeScript',
    toolVersion: '5.9.3',
    file: opts.file ?? 'utils/test.ts',
    line,
    column: 1,
    endLine: opts.endLine,
    severity: opts.severity ?? 'error',
    ruleId: opts.rule ?? 'TS2580',
    message: opts.msg ?? "Cannot find name 'Buffer'.",
    fixable: false
  })

  test('两行紧邻的同款 finding 合并为单个 range（line 88, 89 → 88-89）', () => {
    const out = collapseAdjacentFindings([mk(88), mk(89)])
    expect(out.length).toBe(1)
    expect(out[0].line).toBe(88)
    expect(out[0].endLine).toBe(89)
  })

  test('三行连续同款 → 合并为 88-90', () => {
    const out = collapseAdjacentFindings([mk(88), mk(89), mk(90)])
    expect(out.length).toBe(1)
    expect(out[0].line).toBe(88)
    expect(out[0].endLine).toBe(90)
  })

  test('88, 89, 91 → 合并 88-89，保留 91 独立（91 与 89 有 gap）', () => {
    const out = collapseAdjacentFindings([mk(88), mk(89), mk(91)])
    expect(out.length).toBe(2)
    expect(out[0]).toMatchObject({line: 88, endLine: 89})
    expect(out[1]).toMatchObject({line: 91, endLine: undefined})
  })

  test('隔 ≥ 2 行的同款 → 不合并（88 与 90 中间隔了一行非问题代码）', () => {
    const out = collapseAdjacentFindings([mk(88), mk(90)])
    expect(out.length).toBe(2)
    expect(out.map(r => r.line)).toEqual([88, 90])
  })

  test('message 不同 → 不合并（不同变量未使用）', () => {
    const a = mk(5, {rule: 'no-unused-vars', msg: "'foo' is unused"})
    const b = mk(6, {rule: 'no-unused-vars', msg: "'bar' is unused"})
    const out = collapseAdjacentFindings([a, b])
    expect(out.length).toBe(2)
  })

  test('不同 ruleId → 不合并（即便是相邻行）', () => {
    const a = mk(5, {rule: 'TS2580'})
    const b = mk(6, {rule: 'TS2304'})
    const out = collapseAdjacentFindings([a, b])
    expect(out.length).toBe(2)
  })

  test('不同 severity → 不合并', () => {
    const a = mk(5, {severity: 'error'})
    const b = mk(6, {severity: 'warning'})
    const out = collapseAdjacentFindings([a, b])
    expect(out.length).toBe(2)
  })

  test('不同 tool → 不合并（避免 Biome line 88 + ESLint line 89 被误合）', () => {
    const a = mk(88, {tool: 'Biome'})
    const b = mk(89, {tool: 'ESLint'})
    const out = collapseAdjacentFindings([a, b])
    expect(out.length).toBe(2)
  })

  test('不同 file → 不合并（即便行号相邻）', () => {
    const a = mk(88, {file: 'a.ts'})
    const b = mk(89, {file: 'b.ts'})
    const out = collapseAdjacentFindings([a, b])
    expect(out.length).toBe(2)
  })

  test('已有 endLine 的 range 与相邻 line 合并（88-90 + 91 → 88-91）', () => {
    const a = mk(88, {endLine: 90})
    const b = mk(91)
    const out = collapseAdjacentFindings([a, b])
    expect(out.length).toBe(1)
    expect(out[0]).toMatchObject({line: 88, endLine: 91})
  })

  test('两个 range 重叠也能合并（88-90 + 89-92 → 88-92）', () => {
    const a = mk(88, {endLine: 90})
    const b = mk(89, {endLine: 92})
    const out = collapseAdjacentFindings([a, b])
    expect(out.length).toBe(1)
    expect(out[0]).toMatchObject({line: 88, endLine: 92})
  })

  test('单条 finding 直接透传（不进合并逻辑）', () => {
    const out = collapseAdjacentFindings([mk(42)])
    expect(out.length).toBe(1)
    expect(out[0].line).toBe(42)
  })

  test('空输入 → 空输出', () => {
    expect(collapseAdjacentFindings([])).toEqual([])
  })

  test('乱序输入（90, 88, 89）也能正确合并为 88-90', () => {
    const out = collapseAdjacentFindings([mk(90), mk(88), mk(89)])
    expect(out.length).toBe(1)
    expect(out[0]).toMatchObject({line: 88, endLine: 90})
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
