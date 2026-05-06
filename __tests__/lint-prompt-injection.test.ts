/**
 * lint-prompt-injection.test.ts — 杠杆 A 单元测试
 *
 * 验证 prompts.renderReviewFileDiff 的条件注入行为：
 * - 当 inputs.lintContext 为空：不出现 "Static analysis tool results" 段头、
 *   不出现 "Static analysis cross-validation (MANDATORY ...)" 指令
 * - 当 inputs.lintContext 非空：两者都出现，且工具结果内容被正确填入
 *
 * 这个开关直接决定每次 doReview 的 token 增量（节省 ~300 token / 无 finding 文件）。
 */

import {describe, expect, jest, test} from '@jest/globals'

jest.mock('@actions/core', () => ({
  info: jest.fn(),
  warning: jest.fn()
}))

import {Inputs} from '../src/inputs'
import {Prompts} from '../src/prompts'

const LINT_SECTION_HEADER = '## Static analysis tool results (pre-review)'
const LINT_MANDATORY_MARKER =
  'Static analysis cross-validation (MANDATORY when tool findings exist)'

function buildInputs(lintContext = ''): Inputs {
  return new Inputs(
    'system message',
    'PR title',
    'PR description',
    '',
    'short summary text',
    'src/foo.ts',
    'file content',
    'file diff',
    '',
    'no diff',
    'no other comments on this patch',
    'no comment provided',
    '', // crossFileContext
    '', // analysisChain
    lintContext
  )
}

describe('Prompts.renderReviewFileDiff — conditional lint injection (杠杆 A)', () => {
  const prompts = new Prompts()

  test('omits lint section + MANDATORY when lintContext is empty', () => {
    const out = prompts.renderReviewFileDiff(buildInputs(''))

    expect(out).not.toContain(LINT_SECTION_HEADER)
    expect(out).not.toContain(LINT_MANDATORY_MARKER)
    // 占位符必须已被消费，不应在最终 prompt 中残留
    expect(out).not.toContain('$lint_section')
    expect(out).not.toContain('$lint_mandatory_instruction')
    expect(out).not.toContain('$lint_context')
    // 其他必需段落仍然存在
    expect(out).toContain('## Cross-file references (auto-detected)')
    expect(out).toContain('## Analysis chain (pre-review reasoning)')
    expect(out).toContain('## IMPORTANT Instructions')
    // 兄弟 MANDATORY 不应被误删
    expect(out).toContain('Cross-file impact analysis (MANDATORY)')
  })

  test('omits lint section when lintContext is whitespace-only', () => {
    const out = prompts.renderReviewFileDiff(buildInputs('   \n  \t '))
    expect(out).not.toContain(LINT_SECTION_HEADER)
    expect(out).not.toContain(LINT_MANDATORY_MARKER)
  })

  test('includes lint section + MANDATORY + raw findings when lintContext set', () => {
    const findings = `🧰 Tools
🪛 ESLint (9.15.0)
🔴 [error] src/foo.ts:29 — array-callback-return: missing return value`

    const out = prompts.renderReviewFileDiff(buildInputs(findings))

    expect(out).toContain(LINT_SECTION_HEADER)
    expect(out).toContain(LINT_MANDATORY_MARKER)
    expect(out).toContain('🪛 ESLint (9.15.0)')
    expect(out).toContain('array-callback-return')
    expect(out).not.toContain('$lint_section')
    expect(out).not.toContain('$lint_mandatory_instruction')
    expect(out).not.toContain('$lint_context')
  })

  test('token saving is meaningful when lintContext empty', () => {
    const empty = prompts.renderReviewFileDiff(buildInputs(''))
    const populated = prompts.renderReviewFileDiff(
      buildInputs('🧰 Tools\n🪛 ESLint (9.x): some finding')
    )
    // 不期望精确字符差，但有 finding 的版本必然更长（含 MANDATORY ~700 chars + 段头）
    expect(populated.length).toBeGreaterThan(empty.length + 600)
  })
})
