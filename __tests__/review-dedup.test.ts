/**
 * review-dedup.test.ts — AI 评论级去重测试
 *
 * 复现用户反馈："tsc 报 1 个 TS2345，PR 评论却出现两条对同一行的评论"。
 * 验证 mergeReviewsByLineRange 能在 parseReview 之后、bufferReviewComment 之前
 * 把同一 (startLine, endLine) 上的多条 AI 评论合并为单条。
 */

import {describe, expect, jest, test} from '@jest/globals'

jest.mock('@actions/core', () => ({
  info: jest.fn(),
  warning: jest.fn()
}))

import {mergeReviewsByLineRange, type Review} from '../src/review-dedup'

describe('mergeReviewsByLineRange — 同行去重合并', () => {
  test('两条评论指向相同 (startLine, endLine) → 合并为一条，body 用 --- 分隔', () => {
    const reviews: Review[] = [
      {startLine: 98, endLine: 98, comment: 'angle A: 必然报错'},
      {startLine: 98, endLine: 98, comment: 'angle B: 测试隔离'}
    ]
    const out = mergeReviewsByLineRange(reviews, 'utils/cart.ts')
    expect(out).toHaveLength(1)
    expect(out[0].startLine).toBe(98)
    expect(out[0].endLine).toBe(98)
    expect(out[0].comment).toContain('angle A: 必然报错')
    expect(out[0].comment).toContain('angle B: 测试隔离')
    expect(out[0].comment).toContain('\n\n---\n\n')
  })

  test('不同行号的评论各自保留，不互相合并', () => {
    const reviews: Review[] = [
      {startLine: 10, endLine: 10, comment: 'on line 10'},
      {startLine: 20, endLine: 20, comment: 'on line 20'},
      {startLine: 30, endLine: 30, comment: 'on line 30'}
    ]
    const out = mergeReviewsByLineRange(reviews, 'src/foo.ts')
    expect(out).toHaveLength(3)
    expect(out.map(r => r.startLine).sort((a, b) => a - b)).toEqual([10, 20, 30])
  })

  test('相同 startLine 但 endLine 不同 → 不合并（是不同 range）', () => {
    const reviews: Review[] = [
      {startLine: 10, endLine: 10, comment: '单行'},
      {startLine: 10, endLine: 15, comment: '多行块'}
    ]
    const out = mergeReviewsByLineRange(reviews, 'src/foo.ts')
    expect(out).toHaveLength(2)
  })

  test('3 条评论指向同一行 → 全部合并为一条，包含所有内容', () => {
    const reviews: Review[] = [
      {startLine: 5, endLine: 5, comment: 'first'},
      {startLine: 5, endLine: 5, comment: 'second'},
      {startLine: 5, endLine: 5, comment: 'third'}
    ]
    const out = mergeReviewsByLineRange(reviews, 'src/foo.ts')
    expect(out).toHaveLength(1)
    expect(out[0].comment).toContain('first')
    expect(out[0].comment).toContain('second')
    expect(out[0].comment).toContain('third')
    // 两段分隔符
    const dividerCount = (out[0].comment.match(/\n\n---\n\n/g) ?? []).length
    expect(dividerCount).toBe(2)
  })

  test('空数组输入 → 空数组输出', () => {
    expect(mergeReviewsByLineRange([], 'src/foo.ts')).toEqual([])
  })

  test('单条评论 → 原样返回（无合并触发）', () => {
    const reviews: Review[] = [{startLine: 1, endLine: 1, comment: 'only'}]
    const out = mergeReviewsByLineRange(reviews, 'src/foo.ts')
    expect(out).toHaveLength(1)
    expect(out[0].comment).toBe('only')
  })

  test('合并时清掉前后多余空白，分隔符两侧整洁', () => {
    const reviews: Review[] = [
      {startLine: 1, endLine: 1, comment: 'first body\n\n'},
      {startLine: 1, endLine: 1, comment: '\n\nsecond body'}
    ]
    const out = mergeReviewsByLineRange(reviews, 'src/foo.ts')
    expect(out[0].comment).toBe('first body\n\n---\n\nsecond body')
  })

  test('复现用户实际场景：tsc 在 98 行报 TS2345，AI 生成两条不同角度的评论', () => {
    const reviews: Review[] = [
      {
        startLine: 98,
        endLine: 98,
        comment:
          'TS2345 是真实问题：priceLabel 明确要求 number，但这里传入了字符串。\n\n```diff\n-const _wrongLabel = priceLabel(\'19.99\')\n+const _wrongLabel = priceLabel(19.99)\n```'
      },
      {
        startLine: 98,
        endLine: 98,
        comment:
          'TS2345 指出 priceLabel 的调用参数类型不匹配。这个常量没有任何业务用途，建议把它隔离到专门的负例文件里。'
      }
    ]
    const out = mergeReviewsByLineRange(reviews, 'utils/lint-test-cart.ts')
    expect(out).toHaveLength(1)
    expect(out[0].comment).toMatch(/TS2345 是真实问题/)
    expect(out[0].comment).toMatch(/TS2345 指出 priceLabel/)
    expect(out[0].comment).toMatch(/\n\n---\n\n/)
  })
})
