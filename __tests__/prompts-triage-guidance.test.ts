/**
 * prompts-triage-guidance.test.ts — 分类与严重度提示词的关键约束
 *
 * 回归（FT-036）：仅格式化的改动（引号、分号、空格、缩进）被判为 NEEDS_REVIEW，
 * 并收到“严重”级别、且内容与 diff 不符的评论。提示词无法用单测验证模型行为，
 * 这里只钉住关键约束的存在，防止后续改写时被误删。
 */
import {describe, expect, test} from '@jest/globals'
import {Prompts} from '../src/prompts'

const p = new Prompts()

describe('triage / severity prompt guidance', () => {
  test('分类提示词：仅格式化的改动必须判为 APPROVED，并列出具体的格式化类型', () => {
    const t = p.triageFileDiff
    expect(t).toContain('Formatting-only changes are')
    expect(t).toContain('APPROVED')
    expect(t).toContain('quote style')
    expect(t).toContain('semicolons')
    expect(t).toContain('indentation')
    // 仍保留“拿不准就 NEEDS_REVIEW”的保守兜底
    expect(t).toContain('err on the side of caution')
  })

  test('审查提示词：样式 / 命名 / any 类问题最高 minor，不得标 critical 或 major', () => {
    const prompt = (p as any).reviewFileDiff as string
    expect(prompt).toContain('Never mark them')
    expect(prompt).toContain('`nit`')
  })

  test('审查提示词：评论必须基于 hunk 里真实存在的变化，仅格式化的 hunk 回复 LGTM', () => {
    const prompt = (p as any).reviewFileDiff as string
    expect(prompt).toContain('Describe the actual change')
    expect(prompt).toContain('differ only in formatting')
  })
})
