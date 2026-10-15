/**
 * whitespace-only-change.test.ts — 只调整缩进或换行的 diff 不进审查
 *
 * 判断必须保守：宁可多审，不能把有语义的改动漏掉。
 */
import {describe, expect, test} from '@jest/globals'
import {isWhitespaceOnlyChange} from '../src/whitespace-only-change'

/** 把行拼成一个 hunk（行首带 -/+/空格） */
const hunk = (...lines: string[]): string => ['@@ -1,9 +1,9 @@', ...lines].join('\n')

describe('isWhitespaceOnlyChange：只动空白', () => {
  test('回归案例：链式调用的换行重排（多行合并成单行，另一段拆成多行）', () => {
    const patch = hunk(
      ' export function splitByWeights(total: string, weights: number[], decimals: number): string[] {',
      '   const sum = weights.reduce((acc, w) => acc.plus(w), new Decimal(0));',
      '-  const parts = weights.map((w) =>',
      '-    new Decimal(total).mul(w).div(sum).toDecimalPlaces(decimals, Decimal.ROUND_DOWN)',
      '-  );',
      '-  const allocated = parts.slice(0, -1).reduce((acc, p) => acc.plus(p), new Decimal(0));',
      '+  const parts = weights.map((w) => new Decimal(total).mul(w).div(sum).toDecimalPlaces(decimals, Decimal.ROUND_DOWN));',
      '+  const allocated = parts',
      '+    .slice(0, -1)',
      '+    .reduce((acc, p) => acc.plus(p), new Decimal(0));',
      '   parts[parts.length - 1] = new Decimal(total).minus(allocated);'
    )
    expect(isWhitespaceOnlyChange('src/order.ts', patch)).toBe(true)
  })

  test('缩进调整', () => {
    const patch = hunk('-if (a) {', '-return 1', '-}', '+  if (a) {', '+    return 1', '+  }')
    expect(isWhitespaceOnlyChange('a.go', patch)).toBe(true)
  })

  test('只新增或删除空行', () => {
    expect(isWhitespaceOnlyChange('a.ts', hunk(' const a = 1', '+', '+', ' const b = 2'))).toBe(
      true
    )
    expect(isWhitespaceOnlyChange('a.ts', hunk(' const a = 1', '-', ' const b = 2'))).toBe(true)
  })

  test('字符串里的空白完全一致、只是外面重排', () => {
    const patch = hunk('-const s = "a  b"; run(s,', '-  1)', '+const s = "a  b"', '+run(s, 1)')
    // `;` 的位置变了：内容不同，不应被跳过
    expect(isWhitespaceOnlyChange('a.ts', patch)).toBe(false)
    const same = hunk('-const s = "a  b"', '-  ;', '+const s = "a  b";')
    expect(isWhitespaceOnlyChange('a.ts', same)).toBe(true)
  })

  test('扩展名大小写不敏感，.d.ts 也算 ts', () => {
    const patch = hunk('-let a=1', '+let a = 1')
    expect(isWhitespaceOnlyChange('src/A.TS', patch)).toBe(true)
    expect(isWhitespaceOnlyChange('types/a.d.ts', patch)).toBe(true)
  })

  test('hunk 头和 “No newline” 提示行不参与比较', () => {
    const patch = [
      '@@ -1 +1 @@',
      '-const a=1',
      '\\ No newline at end of file',
      '+const a = 1',
      '\\ No newline at end of file'
    ].join('\n')
    expect(isWhitespaceOnlyChange('a.ts', patch)).toBe(true)
  })
})

describe('isWhitespaceOnlyChange：有实质改动一律不跳过', () => {
  test.each([
    ['改了一个标识符', hunk('-const a = 1', '+const b = 1')],
    ['改了一个数字', hunk('-const a = 1', '+const a = 2')],
    ['只新增一行代码', hunk(' const a = 1', '+const b = 2')],
    ['只删除一行代码', hunk(' const a = 1', '-const b = 2')],
    ['行序调换', hunk('-const a = 1', '-const b = 2', '+const b = 2', '+const a = 1')],
    ['字符串里的空白变了', hunk('-const s = "a b"', '+const s = "a  b"')],
    ['模板字符串里的空白变了', hunk('-const s = `a b`', '+const s = `a   b`')],
    ['单引号字符串里的空白变了', hunk("-const s = 'a b'", "+const s = 'ab'")],
    ['转义的引号不会提前结束字符串', hunk('-const s = "a\\" b"', '+const s = "a\\"b"')]
  ])('%s', (_label, patch) => {
    expect(isWhitespaceOnlyChange('a.ts', patch)).toBe(false)
  })

  test('引号没有闭合（跨行字符串、注释里的撇号）→ 保守不跳过', () => {
    expect(isWhitespaceOnlyChange('a.ts', hunk("-// don't  do this", "+// don't do this"))).toBe(
      false
    )
    expect(
      isWhitespaceOnlyChange('a.ts', hunk('-const s = `a', '-b`', '+const s = `a', '+  b`'))
    ).toBe(false)
  })

  test.each([
    'a.py',
    'a.pyi',
    'config.yml',
    'config.yaml',
    'Makefile',
    'a.vue',
    'a.html',
    'a.md',
    'a.sh',
    'a.rb',
    'noext'
  ])('空白可能有语义或不在白名单的文件 %s → 不跳过', name => {
    expect(
      isWhitespaceOnlyChange(name, hunk('-if x:', '-return 1', '+if x:', '+    return 1'))
    ).toBe(false)
  })

  test.each([
    ['patch 缺失', undefined],
    ['patch 为 null', null],
    ['patch 为空串', ''],
    ['只有 hunk 头，没有增删行', '@@ -1,3 +1,3 @@\n a\n b']
  ])('%s → 不跳过', (_label, patch) => {
    expect(isWhitespaceOnlyChange('a.ts', patch as string | null | undefined)).toBe(false)
  })
})
