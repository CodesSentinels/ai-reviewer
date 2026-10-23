/**
 * review-parse-robustness.test.ts — 模型输出格式偶发抖动时的解析容错
 *
 * 回归两处评论里露出内部格式的问题（GitLab 回归测试发现）：
 * 1. 模型把分隔符和下一条的行号写在同一行（`---1-4:`），整条第二个发现被拼进上一条评论正文，
 *    评论里出现原始的 `---1-4:` 和 `[severity: major]`；
 * 2. 评论不在任何 patch 内、被映射到最近的 patch 时，说明文字拼在严重级别标签前面，
 *    extractSeverityTags 只认首个非空行，标签行原样留在正文里。
 */
import {describe, expect, test, jest} from '@jest/globals'

jest.mock('../src/platform/logger', () => ({
  getLogger: () => ({info: () => {}, warning: () => {}, error: () => {}, debug: () => {}})
}))

import {parseReview} from '../src/review'
import {extractSeverityTags, splitLeadingSeverityTag} from '../src/noise-control'

describe('parseReview：分隔符与行号写在同一行', () => {
  const patches: Array<[number, number, string]> = [[1, 10, 'hunk']]

  test('`---1-4:` 被识别为分隔符 + 新一条的行号，不再拼进上一条正文', () => {
    const response = [
      '1-4:',
      '[severity: major]',
      '第一条意见',
      '---1-4:',
      '[severity: major]',
      '第二条意见',
      '---'
    ].join('\n')
    const reviews = parseReview(response, patches)
    expect(reviews).toHaveLength(2)
    expect(reviews[0].comment).toContain('第一条意见')
    expect(reviews[0].comment).not.toContain('---1-4:')
    expect(reviews[0].comment).not.toContain('第二条意见')
    expect(reviews[1]).toMatchObject({startLine: 1, endLine: 4})
    expect(reviews[1].comment).toContain('第二条意见')
  })

  test('连写分隔符前面的代码块不受影响', () => {
    const response = ['2-3:', '问题', '```diff', '-a', '+b', '```', '---5-6:', '另一个问题'].join(
      '\n'
    )
    const reviews = parseReview(response, patches)
    expect(reviews.map(r => [r.startLine, r.endLine])).toEqual([
      [2, 3],
      [5, 6]
    ])
    expect(reviews[0].comment).toContain('```diff')
    expect(reviews[0].comment).not.toContain('---5-6:')
  })

  test('规范写法（分隔符与行号分行）行为不变', () => {
    const response = '1-2:\nA\n---\n3-4:\nB\n---'
    const reviews = parseReview(response, patches)
    expect(reviews).toHaveLength(2)
    expect(reviews[1].comment.trim()).toBe('B')
  })
})

describe('parseReview：patch 外的意见保留严重级别标签', () => {
  const patches: Array<[number, number, string]> = [
    [3, 9, 'hunk-1'],
    [20, 25, 'hunk-2']
  ]

  test('说明拼在标签行后面，extractSeverityTags 能取到级别且正文不再露出标签', () => {
    const reviews = parseReview('4-12:\n[severity: major]\n本文件的问题\n---', patches)
    expect(reviews).toHaveLength(1)
    expect(reviews[0].comment).toContain('Note: This review was outside of the patch')
    const {severity, comment} = extractSeverityTags(reviews[0].comment)
    expect(severity).toBe('major')
    expect(comment).not.toContain('[severity')
    expect(comment).toContain('本文件的问题')
  })

  test('没有严重级别标签时说明照常拼在最前面', () => {
    const reviews = parseReview('4-12:\n本文件的问题\n---', patches)
    expect(reviews[0].comment.trimStart().startsWith('> Note: This review was outside')).toBe(true)
  })
})

describe('splitLeadingSeverityTag', () => {
  test('拆出首个非空行的标签，其余正文原样返回', () => {
    expect(splitLeadingSeverityTag('\n[severity: minor]\n正文\n第二行')).toEqual({
      tagLine: '[severity: minor]',
      rest: '正文\n第二行'
    })
  })

  test('首个非空行不是标签、正文里出现同名文字时不动', () => {
    const c = '没有标签\n[severity: major]'
    expect(splitLeadingSeverityTag(c)).toEqual({tagLine: null, rest: c})
  })

  test('空字符串', () => {
    expect(splitLeadingSeverityTag('')).toEqual({tagLine: null, rest: ''})
  })
})
