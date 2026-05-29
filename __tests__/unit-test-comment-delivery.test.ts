/**
 * unit-test-comment-delivery.test.ts — comment-delivery 单元测试
 */
import {describe, expect, test, jest} from '@jest/globals'

jest.mock('@actions/core', () => ({
  getInput: jest.fn().mockReturnValue(''),
  info: jest.fn(),
  warning: jest.fn()
}))

import {
  commentDelivery,
  renderCommentBody
} from '../src/unit-test/delivery/comment-delivery'
import type {DeliveryInput, GeneratedTest} from '../src/unit-test/types'

function fakeTest(name: string, ok = true): GeneratedTest {
  return {
    target: {
      name,
      kind: 'function',
      filePath: `src/${name}.ts`,
      language: 'typescript',
      isNew: true,
      priority: 'P0'
    },
    framework: 'jest',
    code: `describe('${name}', () => { it('works', () => {}) })`,
    caseCount: 1,
    passedStaticCheck: ok,
    staticCheckError: ok ? undefined : '括号配对失败',
    suggestedTestPath: `src/__tests__/${name}.test.ts`
  }
}

function inputOf(overrides: Partial<DeliveryInput['run']> = {}): DeliveryInput {
  return {
    owner: 'o',
    repo: 'r',
    prNumber: 1,
    headSha: 'h',
    baseSha: 'b',
    branch: 'feature',
    triggerCommentId: 99,
    run: {
      tests: [],
      skipped: [],
      warnings: [],
      ...overrides
    }
  }
}

describe('renderCommentBody', () => {
  test('无测试 + 无跳过 → 简短回复', () => {
    const body = renderCommentBody(inputOf())
    expect(body).toContain('未生成任何测试')
  })

  test('多个测试 → 含覆盖表', () => {
    const body = renderCommentBody(
      inputOf({tests: [fakeTest('foo'), fakeTest('bar')]})
    )
    expect(body).toContain('## 🧪 Generated Unit Tests')
    expect(body).toContain('| 目标 | 测试文件 | 用例数 | 校验 |')
    expect(body).toContain('foo')
    expect(body).toContain('bar')
  })

  test('校验失败标记为 ⚠️', () => {
    const body = renderCommentBody(
      inputOf({tests: [fakeTest('foo', false)]})
    )
    expect(body).toContain('⚠️')
  })

  test('跳过项进入 details 块', () => {
    const body = renderCommentBody(
      inputOf({
        tests: [fakeTest('foo')],
        skipped: [
          {
            target: {
              name: 'baz',
              kind: 'function',
              filePath: 'src/baz.ts',
              language: 'typescript',
              isNew: true,
              priority: 'P0'
            },
            reason: '生成代码为空'
          }
        ]
      })
    )
    expect(body).toContain('跳过的目标')
    expect(body).toContain('baz')
  })

  test('warnings 渲染为引用块', () => {
    const body = renderCommentBody(
      inputOf({
        tests: [fakeTest('foo')],
        warnings: ['某条警告']
      })
    )
    expect(body).toContain('> ⚠️ 某条警告')
  })
})

describe('commentDelivery', () => {
  test('返回 outcome.succeeded = tests.length', () => {
    const out = commentDelivery(inputOf({tests: [fakeTest('foo'), fakeTest('bar')]}))
    expect(out.outcome.mode).toBe('comment')
    expect(out.outcome.succeeded).toBe(2)
    expect(out.body).toContain('foo')
  })
})
