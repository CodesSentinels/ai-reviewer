/**
 * review-quality.test.ts — 审查质量（#140「审查质量」）
 *
 * - 严重级别以模型给出的标签为准，关键词推断只兜底
 * - 修复建议不得用默认值掩盖问题
 * - 提示词平台中性，且调查步骤只要求实际可用的工具
 */
import {describe, expect, test} from '@jest/globals'
import {extractSeverityTags} from '../src/noise-control'
import {Prompts, buildInvestigationSection, buildWebSearchPolicy} from '../src/prompts'
import {CONFIG_DEFAULTS} from '../src/platform/config-provider'

describe('extractSeverityTags', () => {
  test('取出首行标签并从正文删除', () => {
    expect(extractSeverityTags('[severity: major]\nThe loop overruns.')).toEqual({
      severity: 'major',
      comment: 'The loop overruns.'
    })
  })

  test('容忍大小写与 markdown 包裹', () => {
    expect(extractSeverityTags('**[Severity: CRITICAL]**\nx').severity).toBe('critical')
    expect(extractSeverityTags('`[severity: nit]`\nx').severity).toBe('nit')
  })

  test('合并后的多条意见带多个标签：取最高级别并全部删除', () => {
    const r = extractSeverityTags('[severity: minor]\na\n---\n[severity: critical]\nb')
    expect(r.severity).toBe('critical')
    expect(r.comment).not.toMatch(/\[severity:/)
  })

  test('无效标签值：忽略该值但仍删除标签行', () => {
    expect(extractSeverityTags('[severity: blocker]\nx')).toEqual({severity: null, comment: 'x'})
  })

  test('没有标签 → null，正文不变', () => {
    expect(extractSeverityTags('plain comment')).toEqual({
      severity: null,
      comment: 'plain comment'
    })
  })

  test('正文中间出现的同名文字不当作标签', () => {
    const text = 'Use the format [severity: major] in docs.'
    expect(extractSeverityTags(text)).toEqual({severity: null, comment: text})
  })
})

describe('审查提示词', () => {
  function render(tools?: {shell: boolean; webSearch: boolean}): string {
    const p = tools ? new Prompts('', '', tools) : new Prompts('', '')
    return p.reviewFileDiff
      .replace('$investigation_section', buildInvestigationSection(p.tools))
      .replace('$web_search_policy', buildWebSearchPolicy(p.tools))
  }

  test('要求严重级别标签，并按后果给出各级定义', () => {
    const prompt = render()
    expect(prompt).toContain('**Severity tag (MANDATORY)**')
    for (const level of ['critical', 'major', 'minor', 'nit']) {
      expect(prompt).toContain(`[severity: ${level}]`)
    }
    // 示例响应也带标签，模型照着示例输出
    expect(prompt).toContain('22-22:\n[severity: major]')
  })

  test('修复建议不得用默认值掩盖问题', () => {
    expect(render()).toContain('Do NOT make an error disappear by substituting a default value')
  })

  test('工具都可用（缺省）：保留原有的 shell 调查与 web search 策略', () => {
    const prompt = render()
    expect(prompt).toContain('**Use shell commands**')
    expect(prompt).toContain('at least one shell investigation per file')
    expect(prompt).toContain('**Use web search**')
    expect(prompt).toContain('You MUST use web search to verify when')
  })

  test('shell 不可用：不要求 shell 调查，并要求不得声称读过未提供的内容', () => {
    const prompt = render({shell: false, webSearch: true})
    expect(prompt).not.toContain('Use shell commands')
    expect(prompt).not.toContain('shell investigation')
    expect(prompt).toContain('Shell access is not available')
    expect(prompt).toContain('Do NOT claim to have read')
    expect(prompt).toContain('Use web search when the code uses external libraries')
  })

  test('web search 不可用：不要求搜索，改为明确说明不确定', () => {
    const prompt = render({shell: true, webSearch: false})
    expect(prompt).not.toContain('**Use web search**')
    expect(prompt).not.toContain('You MUST use web search')
    expect(prompt).toContain('Web search is not available')
  })

  test('占位符全部被替换', () => {
    for (const tools of [
      {shell: true, webSearch: true},
      {shell: true, webSearch: false},
      {shell: false, webSearch: true},
      {shell: false, webSearch: false}
    ]) {
      const prompt = render(tools)
      expect(prompt).not.toContain('$investigation_section')
      expect(prompt).not.toContain('$web_search_policy')
    }
  })
})

describe('提示词平台中性', () => {
  test('Prompts 的全部模板不含 GitHub 字样', () => {
    const p = new Prompts('', '') as unknown as Record<string, unknown>
    const templates = Object.values(p).filter((v): v is string => typeof v === 'string')
    expect(templates.length).toBeGreaterThan(5)
    for (const t of templates) expect(t).not.toMatch(/GitHub/)
  })

  test('默认 system prompt 与默认摘要提示词不含平台身份字样', () => {
    expect(CONFIG_DEFAULTS.systemMessage).not.toMatch(/github/i)
    expect(CONFIG_DEFAULTS.summarize).not.toMatch(/github/i)
  })
})
