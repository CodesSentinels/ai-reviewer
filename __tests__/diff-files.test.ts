/**
 * diff-files.test.ts — 增量审查的文件选择
 *
 * 回归：PR 总共改了 300 个以上文件时，compare(base...head) 的文件列表被截断；
 * 此前增量文件会和这份被截断的列表求交集，一次 push 改 62 个文件只审了 30 个，
 * 其余被静默丢掉。
 */
import {describe, expect, test} from '@jest/globals'
import {COMPARE_FILES_CAP, selectFilesToReview} from '../src/diff-files'

const f = (name: string) => ({filename: name, status: 'added' as const, patch: '@@'})
const many = (prefix: string, n: number) => Array.from({length: n}, (_, i) => f(`${prefix}${i}.ts`))

describe('selectFilesToReview', () => {
  test('增量审查：取增量文件与目标分支文件的交集（排除改了又改回去的文件）', () => {
    const r = selectFilesToReview({
      isFirstOrFullReview: false,
      incrementalFiles: [f('a.ts'), f('reverted.ts')],
      targetBranchFiles: [f('a.ts'), f('b.ts')]
    })
    expect(r.files.map(x => x.filename)).toEqual(['a.ts'])
    expect(r.targetTruncated).toBe(false)
  })

  test('首次 / 全量：取目标分支列表中同时出现在增量里的文件', () => {
    const same = [f('a.ts'), f('b.ts')]
    const r = selectFilesToReview({
      isFirstOrFullReview: true,
      incrementalFiles: same,
      targetBranchFiles: same
    })
    expect(r.files.map(x => x.filename)).toEqual(['a.ts', 'b.ts'])
  })

  test('目标分支文件列表达到 300 上限（被截断）→ 增量文件不再求交集，一个都不丢', () => {
    const target = many('old/', COMPARE_FILES_CAP) // 被截断的 base...head 列表，不含新增的 62 个
    const incremental = many('new/', 62)
    const r = selectFilesToReview({
      isFirstOrFullReview: false,
      incrementalFiles: incremental,
      targetBranchFiles: target
    })
    expect(r.targetTruncated).toBe(true)
    expect(r.files).toHaveLength(62)
  })

  test('目标分支文件列表低于上限 → 仍按交集处理', () => {
    const target = many('old/', COMPARE_FILES_CAP - 1)
    const incremental = [...many('old/', 5), ...many('new/', 10)]
    const r = selectFilesToReview({
      isFirstOrFullReview: false,
      incrementalFiles: incremental,
      targetBranchFiles: target
    })
    expect(r.targetTruncated).toBe(false)
    expect(r.files).toHaveLength(5)
  })
})
