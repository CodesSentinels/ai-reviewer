/**
 * review-parse-out-of-patch.test.ts — 行号不在当前文件 patch 内的意见如何处理
 *
 * 模型能看到 diff 之外的代码（跨文件上下文、本文件未改动的部分），会对那些代码
 * 提意见并给出对应位置的行号。以前与任何 patch 都不重叠时，兜底挂到第一个 patch，
 * 结果评论落在错误的文件和行上，按位置去重也随之失效。
 */
import {describe, expect, test, jest, beforeEach} from '@jest/globals'

const logs: string[] = []
jest.mock('../src/platform/logger', () => ({
  getLogger: () => ({
    info: (m: string) => logs.push(m),
    warning: (m: string) => logs.push(m),
    error: (m: string) => logs.push(m),
    debug: () => {}
  })
}))

import {parseReview} from '../src/review'

// 两个 hunk：新文件的 3-9 行、20-25 行
const patches: Array<[number, number, string]> = [
  [3, 9, 'hunk-1'],
  [20, 25, 'hunk-2']
]

function respond(...blocks: Array<[number, number, string]>): string {
  return blocks.map(([s, e, body]) => `${s}-${e}:\n${body}\n---`).join('\n')
}

beforeEach(() => {
  logs.length = 0
})

describe('parseReview：patch 外的意见', () => {
  test('完全落在 patch 内 → 原样保留', () => {
    const reviews = parseReview(respond([5, 6, '本文件的问题']), patches)
    expect(reviews).toHaveLength(1)
    expect(reviews[0]).toMatchObject({startLine: 5, endLine: 6})
    expect(reviews[0].comment).toContain('本文件的问题')
    expect(reviews[0].comment).not.toContain('outside of the patch')
  })

  test('与任何 patch 都不重叠 → 丢弃，不再挂到第一个 hunk', () => {
    // 13-19 夹在两个 hunk 之间，例如另一个文件 index.ts 的行号
    const reviews = parseReview(respond([13, 19, '讲的是 index.ts 的 syncOrders']), patches)
    expect(reviews).toEqual([])
    expect(logs.join('\n')).toContain('Dropped comment for line range 13-19')
  })

  test('行号超出当前文件所有 hunk → 丢弃', () => {
    const reviews = parseReview(respond([120, 130, '别处的代码']), patches)
    expect(reviews).toEqual([])
  })

  test('部分重叠 → 仍映射到重叠最大的 patch 并附说明', () => {
    const reviews = parseReview(respond([8, 12, '跨出 hunk 一点']), patches)
    expect(reviews).toHaveLength(1)
    expect(reviews[0]).toMatchObject({startLine: 3, endLine: 9})
    expect(reviews[0].comment).toContain('mapped to the patch with the greatest overlap')
  })

  test('混合：只丢掉不重叠的那条，其余照常', () => {
    const reviews = parseReview(
      respond([4, 4, '正常意见'], [14, 15, 'diff 外的意见'], [21, 22, '第二个 hunk 的意见']),
      patches
    )
    expect(reviews.map(r => [r.startLine, r.endLine])).toEqual([
      [4, 4],
      [21, 22]
    ])
    expect(reviews.map(r => r.comment).join('\n')).not.toContain('diff 外的意见')
  })
})
