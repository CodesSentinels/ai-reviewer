/**
 * noise-control.test.ts — 评论噪音控制单元测试（成员 D · 2.5）
 *
 * 覆盖:
 * - 同类评论合并去重（dedupeFindings）
 * - 去重 + 排序 + 截断（prepareFindings）
 * - 启发式严重级别分类（classifyFindingSeverity）
 * - 行级评论严重级别徽标（severityBadge）
 */
import {describe, expect, test} from '@jest/globals'

import {
  dedupeFindings,
  prepareFindings,
  classifyFindingSeverity,
  severityBadge,
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

describe('severityBadge — 行级评论严重级别徽标', () => {
  test('critical 渲染为 CAUTION 警示框 + 中文标签', () => {
    const badge = severityBadge('critical')
    expect(badge).toContain('> [!CAUTION]')
    expect(badge).toContain('🔴 **严重**')
  })

  test('各级别映射到不同的 GitHub 警示框类型', () => {
    expect(severityBadge('major')).toContain('[!WARNING]')
    expect(severityBadge('minor')).toContain('[!NOTE]')
    expect(severityBadge('nit')).toContain('[!TIP]')
  })
})
