/**
 * unit-test-prompt-builder.test.ts — prompt-builder 单元测试
 */
import {describe, expect, test} from '@jest/globals'
import {buildPrompt} from '../src/unit-test/prompt-builder'
import type {GenerationInput} from '../src/unit-test/types'

function makeInput(overrides: Partial<GenerationInput> = {}): GenerationInput {
  return {
    target: {
      name: 'debounce',
      kind: 'function',
      filePath: 'src/utils.ts',
      language: 'typescript',
      isNew: true,
      priority: 'P0',
      sourceSnippet: 'export function debounce(fn, delay) { return fn }'
    },
    framework: {
      framework: 'jest',
      confidence: 'high',
      signals: ['config:jest.config.js'],
      testFilePattern: '*.test.ts'
    },
    projectContext: {
      sampleTestFiles: ['src/__tests__/other.test.ts'],
      sampleTestSnippets: [
        {path: 'src/__tests__/other.test.ts', content: "describe('other', () => {})"}
      ],
      testDirectoryHint: '__tests__',
      patternHint: 'BDD describe/it'
    },
    typeContext: "import {Fn} from './types'",
    prMeta: {
      title: 'add debounce util',
      headSha: 'abcdef1234567',
      baseSha: '7654321fedcba'
    },
    ...overrides
  }
}

describe('buildPrompt', () => {
  test('包含 task 描述与目标名', () => {
    const prompt = buildPrompt(makeInput())
    expect(prompt).toContain('Generate high-quality unit tests')
    expect(prompt).toContain('`debounce`')
    expect(prompt).toContain('`src/utils.ts`')
  })

  test('包含框架信息与置信度', () => {
    const prompt = buildPrompt(makeInput())
    expect(prompt).toMatch(/jest \(confidence: high/)
  })

  test('包含源代码片段', () => {
    const prompt = buildPrompt(makeInput())
    expect(prompt).toContain('export function debounce')
  })

  test('包含已有测试样例段（若提供）', () => {
    const prompt = buildPrompt(makeInput())
    expect(prompt).toContain('Existing Test Style Sample')
    expect(prompt).toContain('other.test.ts')
  })

  test('包含输出格式要求', () => {
    const prompt = buildPrompt(makeInput())
    expect(prompt).toContain('fenced code block')
    expect(prompt).toContain('typescript')
  })

  test('无 sample 测试时不输出该段', () => {
    const prompt = buildPrompt(
      makeInput({
        projectContext: {
          sampleTestFiles: [],
          sampleTestSnippets: []
        }
      })
    )
    expect(prompt).not.toContain('Existing Test Style Sample')
  })

  test('vitest 框架提示与 jest 不同', () => {
    const prompt = buildPrompt(
      makeInput({
        framework: {
          framework: 'vitest',
          confidence: 'high',
          signals: ['config:vitest.config.ts'],
          testFilePattern: '*.test.ts'
        }
      })
    )
    expect(prompt).toContain('vi.fn()')
  })

  test('PR 元数据 (短 SHA) 出现', () => {
    const prompt = buildPrompt(makeInput())
    expect(prompt).toContain('abcdef1')
    expect(prompt).toContain('7654321')
  })
})
