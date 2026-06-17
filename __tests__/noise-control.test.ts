/**
 * noise-control.test.ts — 评论噪音控制单元测试（成员 D · 2.5）
 *
 * 覆盖:
 * - 同类评论合并去重（dedupeFindings）
 * - 去重 + 排序 + 截断（prepareFindings）
 * - 渲染：高优先级展开 / 低优先级折叠 / 截断提示（formatComments）
 * - 汇总评论正文：统计表 + 空结果（buildSummaryBody）
 * - 发布汇总评论的幂等 tag（postSummaryComment）
 */
import {describe, expect, test, jest, beforeEach} from '@jest/globals'

// 工厂 mock，避免加载真实 commenter（及其 octokit / @actions 副作用）
const commentMock = jest.fn()
jest.mock('../src/commenter', () => ({
  Commenter: class {
    comment = commentMock
  },
  COMMENT_TAG: '',
  COMMENT_REPLY_TAG: '',
  SUMMARIZE_TAG: ''
}))

import {
  dedupeFindings,
  prepareFindings,
  formatComments,
  buildSummaryBody,
  postSummaryComment,
  classifyFindingSeverity,
  FINDINGS_SUMMARY_TAG,
  type Finding
} from '../src/noise-control'

const f = (over: Partial<Finding>): Finding => ({
  path: 'src/a.ts',
  startLine: 1,
  endLine: 1,
  severity: 'major',
  body: 'some issue',
  ...over
})

describe('dedupeFindings — 同类合并', () => {
  test('相同文件+类别+标题合并为一条并标注数量', () => {
    const out = dedupeFindings([
      f({title: 'SQL 注入', category: 'security'}),
      f({title: 'SQL 注入', category: 'security', startLine: 9, endLine: 9})
    ])
    expect(out).toHaveLength(1)
    expect(out[0].title).toContain('合并 2 处')
  })

  test('合并时保留最高严重级别', () => {
    const out = dedupeFindings([
      f({title: 'X', category: 'c', severity: 'minor'}),
      f({title: 'X', category: 'c', severity: 'critical'})
    ])
    expect(out[0].severity).toBe('critical')
  })

  test('不同文件不合并', () => {
    const out = dedupeFindings([
      f({title: 'X', path: 'a.ts'}),
      f({title: 'X', path: 'b.ts'})
    ])
    expect(out).toHaveLength(2)
  })
})

describe('prepareFindings — 排序 + 截断', () => {
  test('按严重级别降序排序', () => {
    const {kept} = prepareFindings([
      f({title: 'a', severity: 'nit'}),
      f({title: 'b', severity: 'critical'}),
      f({title: 'c', severity: 'minor'})
    ])
    expect(kept.map(k => k.severity)).toEqual(['critical', 'minor', 'nit'])
  })

  test('超出 maxComments 时截断并返回截断数量', () => {
    const findings = Array.from({length: 25}, (_, i) =>
      f({title: `t${i}`, severity: 'major'})
    )
    const {kept, truncated} = prepareFindings(findings, {maxComments: 20})
    expect(kept).toHaveLength(20)
    expect(truncated).toBe(5)
  })

  test('maxComments <= 0 表示不限制（不截断）', () => {
    const findings = Array.from({length: 25}, (_, i) =>
      f({title: `t${i}`, severity: 'major'})
    )
    const {kept, truncated} = prepareFindings(findings, {maxComments: 0})
    expect(kept).toHaveLength(25)
    expect(truncated).toBe(0)
  })
})

describe('formatComments — 折叠 + 截断提示', () => {
  test('低优先级折叠进 <details>', () => {
    const md = formatComments([
      f({title: 'big', severity: 'critical'}),
      f({title: 'tiny', severity: 'nit'})
    ])
    expect(md).toContain('<details>')
    expect(md).toContain('低优先级建议')
    // critical 不应在折叠块外被截断
    expect(md).toContain('big')
  })

  test('空输入返回空字符串', () => {
    expect(formatComments([])).toBe('')
  })

  test('超过上限时追加截断提示', () => {
    const findings = Array.from({length: 22}, (_, i) =>
      f({title: `t${i}`, severity: 'minor'})
    )
    const md = formatComments(findings, {maxComments: 20})
    expect(md).toContain('未展示')
  })
})

describe('buildSummaryBody — 汇总正文', () => {
  test('包含统计表与总数', () => {
    const body = buildSummaryBody([
      f({title: 'a', severity: 'critical'}),
      f({title: 'b', severity: 'minor'})
    ])
    expect(body).toContain('审查摘要')
    expect(body).toContain('| 级别 | 数量 |')
    expect(body).toContain('**2**')
  })

  test('无发现时给出通过提示', () => {
    expect(buildSummaryBody([])).toContain('未发现')
  })
})

describe('classifyFindingSeverity — 启发式分级', () => {
  test('安全类关键词 → critical', () => {
    expect(
      classifyFindingSeverity('This is a SQL injection vulnerability')
    ).toBe('critical')
    expect(classifyFindingSeverity('硬编码密钥不应出现在源码中')).toBe(
      'critical'
    )
  })

  test('正确性/缺陷关键词 → major', () => {
    expect(classifyFindingSeverity('this promise is never awaited')).toBe(
      'major'
    )
    expect(classifyFindingSeverity('存在 off-by-one 错误')).toBe('major')
  })

  test('吹毛求疵关键词 → nit', () => {
    expect(classifyFindingSeverity('nit: fix this typo')).toBe('nit')
  })

  test('建议类关键词 → minor', () => {
    expect(
      classifyFindingSeverity('consider extracting this for readability')
    ).toBe('minor')
  })

  test('无明显信号 → 默认 minor', () => {
    expect(classifyFindingSeverity('this changes the default currency')).toBe(
      'minor'
    )
  })
})

describe('postSummaryComment — 发布汇总评论', () => {
  beforeEach(() => {
    commentMock.mockReset()
  })

  test('以 FINDINGS_SUMMARY_TAG 幂等替换发布', async () => {
    await postSummaryComment(42, [f({title: 'x', severity: 'major'})])
    expect(commentMock).toHaveBeenCalledTimes(1)
    const [, tag, mode] = commentMock.mock.calls[0] as [string, string, string]
    expect(tag).toBe(FINDINGS_SUMMARY_TAG)
    expect(mode).toBe('replace')
  })
})
