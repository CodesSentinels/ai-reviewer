/**
 * unit-test-post-processor.test.ts — post-processor 单元测试
 */
import {describe, expect, test} from '@jest/globals'
import {
  countTestCases,
  extractCodeBlock,
  postProcess,
  staticCheck
} from '../src/unit-test/post-processor'

describe('extractCodeBlock', () => {
  test('围栏带 typescript 标签', () => {
    const raw = "Here is the test:\n```typescript\nit('a', () => {})\n```"
    expect(extractCodeBlock(raw, 'typescript')).toBe("it('a', () => {})")
  })

  test('围栏带 ts 简写', () => {
    const raw = "```ts\nit('a', () => {})\n```"
    expect(extractCodeBlock(raw, 'typescript')).toBe("it('a', () => {})")
  })

  test('无围栏但内容像代码 → 直接返回', () => {
    const raw = "describe('foo', () => { it('a', () => {}) })"
    expect(extractCodeBlock(raw, 'typescript')).toContain('describe')
  })

  test('围栏空 → 兼容', () => {
    const raw = "```\nit('a', () => {})\n```"
    expect(extractCodeBlock(raw, 'typescript')).toBe("it('a', () => {})")
  })
})

describe('countTestCases', () => {
  test('JS/TS it/test', () => {
    const code = `
      describe('x', () => {
        it('a', () => {})
        it('b', () => {})
        test('c', () => {})
      })
    `
    expect(countTestCases(code, 'typescript', 'jest')).toBe(3)
  })

  test('Python def test_', () => {
    const code = `
def test_foo():
    pass

def test_bar():
    pass
`
    expect(countTestCases(code, 'python', 'pytest')).toBe(2)
  })

  test('Go func TestX', () => {
    const code = `
func TestFoo(t *testing.T) {}
func TestBar(t *testing.T) {}
`
    expect(countTestCases(code, 'go', 'go-testing')).toBe(2)
  })
})

describe('staticCheck', () => {
  test('空代码 → 失败', () => {
    expect(staticCheck('', 'typescript').ok).toBe(false)
  })

  test('括号不配对 → 失败', () => {
    const code = "describe('x', () => { it('a', () => {})"
    const r = staticCheck(code, 'typescript')
    expect(r.ok).toBe(false)
  })

  test('正常 jest 代码 → 通过', () => {
    const code = "describe('x', () => { it('a', () => {}) })"
    const r = staticCheck(code, 'typescript')
    expect(r.ok).toBe(true)
  })

  test('无测试声明 → 失败', () => {
    const code = 'const a = 1; const b = 2;'
    const r = staticCheck(code, 'typescript')
    expect(r.ok).toBe(false)
  })

  test('Python test_ 声明通过', () => {
    const code = 'def test_foo():\n    assert True'
    expect(staticCheck(code, 'python').ok).toBe(true)
  })

  test('字符串内的括号不影响配对', () => {
    const code = "it('a (in name)', () => { expect(1).toBe(1) })"
    expect(staticCheck(code, 'typescript').ok).toBe(true)
  })

  test('行注释不影响配对', () => {
    const code = `
      // unbalanced ( { in comment
      it('a', () => { expect(1).toBe(1) })
    `
    expect(staticCheck(code, 'typescript').ok).toBe(true)
  })
})

describe('postProcess (E2E)', () => {
  test('完整流程', () => {
    const raw =
      "Here's the test file:\n\n```typescript\nimport {debounce} from './utils'\ndescribe('debounce', () => { it('delays', () => { expect(1).toBe(1) }) })\n```"
    const r = postProcess(raw, 'typescript', 'jest')
    expect(r.code).toContain('describe')
    expect(r.caseCount).toBe(1)
    expect(r.passedStaticCheck).toBe(true)
  })

  test('生成截断 → 校验失败', () => {
    const raw = "```typescript\ndescribe('x', () => { it('a', () => {\n```"
    const r = postProcess(raw, 'typescript', 'jest')
    expect(r.passedStaticCheck).toBe(false)
  })
})
