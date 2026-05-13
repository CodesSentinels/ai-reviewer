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

import {
  mergeReviewsByLineRange,
  mergeReviewsByTopic,
  type Review,
  type ToolFindingForDedup
} from '../src/review-dedup'

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

// ============================================================================
// v2 topic-based dedup：按重叠的 tool finding ruleId 合并
// ============================================================================

describe('mergeReviewsByTopic — 议题级（按 tool finding ruleId）合并', () => {
  const tsFinding: ToolFindingForDedup = {line: 98, endLine: 98, ruleId: 'TS2345'}

  test('两条评论挂在不同行号、但都覆盖同一个 TS2345 finding → 合并', () => {
    const reviews: Review[] = [
      {startLine: 95, endLine: 100, comment: 'broader analysis: design issue'},
      {startLine: 98, endLine: 98, comment: 'specific call site'}
    ]
    const out = mergeReviewsByTopic(reviews, 'utils/cart.ts', [tsFinding])
    expect(out).toHaveLength(1)
    expect(out[0].comment).toContain('broader analysis')
    expect(out[0].comment).toContain('specific call site')
    // 合并后行号范围应扩大到覆盖两者
    expect(out[0].startLine).toBe(95)
    expect(out[0].endLine).toBe(100)
  })

  test('两条评论指向不同的 finding（TS2345 + TS2339）→ 不合并', () => {
    const findings: ToolFindingForDedup[] = [
      {line: 80, endLine: 80, ruleId: 'TS2339'},
      {line: 98, endLine: 98, ruleId: 'TS2345'}
    ]
    const reviews: Review[] = [
      {startLine: 80, endLine: 80, comment: '关于 TS2339'},
      {startLine: 98, endLine: 98, comment: '关于 TS2345'}
    ]
    const out = mergeReviewsByTopic(reviews, 'utils/cart.ts', findings)
    expect(out).toHaveLength(2)
  })

  test('一条评论覆盖两个 finding，另一条只覆盖其中一个 → 议题键不同，不合并', () => {
    // review1 范围 95-100 覆盖 TS2339(80) ❌ 不覆盖；覆盖 TS2345(98) ✓
    // review2 范围 80 只覆盖 TS2339
    const findings: ToolFindingForDedup[] = [
      {line: 80, endLine: 80, ruleId: 'TS2339'},
      {line: 98, endLine: 98, ruleId: 'TS2345'}
    ]
    const reviews: Review[] = [
      {startLine: 95, endLine: 100, comment: '关于 TS2345'},
      {startLine: 80, endLine: 80, comment: '关于 TS2339'}
    ]
    const out = mergeReviewsByTopic(reviews, 'utils/cart.ts', findings)
    expect(out).toHaveLength(2)
  })

  test('无 finding 覆盖的评论 → 退回到行号精确匹配（保留 v1 行为）', () => {
    const reviews: Review[] = [
      {startLine: 10, endLine: 10, comment: '纯 AI 洞察 A'},
      {startLine: 10, endLine: 10, comment: '纯 AI 洞察 B'},
      {startLine: 20, endLine: 20, comment: '另一处的纯 AI 洞察'}
    ]
    // 没有任何 tool finding
    const out = mergeReviewsByTopic(reviews, 'utils/cart.ts', [])
    expect(out).toHaveLength(2)
    // 10-10 上的两条被合并
    const merged = out.find(r => r.startLine === 10)
    expect(merged?.comment).toContain('纯 AI 洞察 A')
    expect(merged?.comment).toContain('纯 AI 洞察 B')
  })

  test('多个评论覆盖同一组 finding（含多 ruleId）→ 议题键稳定（顺序无关）', () => {
    // 两个评论的行号范围都同时覆盖 TS2339(80) 和 TS2345(98)
    // 即便 finding 数组顺序不一样，应该计算出相同的 topic key
    const findings: ToolFindingForDedup[] = [
      {line: 80, endLine: 80, ruleId: 'TS2339'},
      {line: 98, endLine: 98, ruleId: 'TS2345'}
    ]
    const reviews: Review[] = [
      {startLine: 78, endLine: 100, comment: '覆盖两个 finding'},
      {startLine: 80, endLine: 98, comment: '也覆盖两个 finding'}
    ]
    const out = mergeReviewsByTopic(reviews, 'utils/cart.ts', findings)
    expect(out).toHaveLength(1)
    expect(out[0].comment).toContain('覆盖两个 finding')
    expect(out[0].comment).toContain('也覆盖两个 finding')
  })

  test('复现用户实际场景：tsc TS2345 在 98 行，LLM 把两条评论挂在 95-100 和 98-98', () => {
    // 这正是用户截图里的情况：两条评论谈 TS2345 但行号不同
    // 旧 mergeReviewsByLineRange (v1) 漏掉；新 mergeReviewsByTopic (v2) 必须合并
    const reviews: Review[] = [
      {
        startLine: 95,
        endLine: 100,
        comment:
          'TS2345 也是实打实的问题：priceLabel 声明接收 number，但这里传入了字符串...'
      },
      {
        startLine: 98,
        endLine: 98,
        comment:
          "priceLabel('19.99') 与函数签名 price: number 不匹配，TypeScript 已报 TS2345..."
      }
    ]
    const findings: ToolFindingForDedup[] = [
      {line: 98, endLine: 98, ruleId: 'TS2345'}
    ]
    const out = mergeReviewsByTopic(
      reviews,
      'utils/lint-test-cart.ts',
      findings
    )
    expect(out).toHaveLength(1)
    expect(out[0].comment).toContain('TS2345 也是实打实的问题')
    expect(out[0].comment).toContain("priceLabel('19.99') 与函数签名")
    expect(out[0].comment).toContain('---')
  })

  test('mergeReviewsByLineRange 旧别名仍可用（向后兼容）', () => {
    const reviews: Review[] = [
      {startLine: 10, endLine: 10, comment: 'A'},
      {startLine: 10, endLine: 10, comment: 'B'}
    ]
    const out = mergeReviewsByLineRange(reviews, 'src/foo.ts')
    expect(out).toHaveLength(1)
    expect(out[0].comment).toContain('A')
    expect(out[0].comment).toContain('B')
  })
})
