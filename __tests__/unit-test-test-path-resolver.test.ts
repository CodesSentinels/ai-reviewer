/**
 * unit-test-test-path-resolver.test.ts — test-path-resolver 单元测试
 */
import {describe, expect, test} from '@jest/globals'
import {resolveTestPath} from '../src/unit-test/test-path-resolver'

describe('resolveTestPath — JS/TS', () => {
  test('TS + jest，已有 __tests__/', () => {
    const p = resolveTestPath('src/utils.ts', 'typescript', 'jest', {
      hasUnderscoreTests: true
    })
    expect(p).toBe('src/__tests__/utils.test.ts')
  })

  test('TS + jest，无 __tests__/', () => {
    const p = resolveTestPath('src/utils.ts', 'typescript', 'jest')
    expect(p).toBe('src/utils.test.ts')
  })

  test('TS + mocha → .spec.ts', () => {
    const p = resolveTestPath('src/utils.ts', 'typescript', 'mocha')
    expect(p).toBe('src/utils.spec.ts')
  })

  test('JS + vitest', () => {
    const p = resolveTestPath('lib/foo.js', 'javascript', 'vitest')
    expect(p).toBe('lib/foo.test.js')
  })
})

describe('resolveTestPath — Python', () => {
  test('Python，已有 tests/', () => {
    const p = resolveTestPath('app/utils.py', 'python', 'pytest', {
      hasTestsDir: true
    })
    expect(p).toBe('tests/test_utils.py')
  })

  test('Python，同目录', () => {
    const p = resolveTestPath('app/utils.py', 'python', 'pytest')
    expect(p).toBe('app/test_utils.py')
  })
})

describe('resolveTestPath — Go', () => {
  test('Go 同目录 _test.go', () => {
    const p = resolveTestPath('pkg/foo.go', 'go', 'go-testing')
    expect(p).toBe('pkg/foo_test.go')
  })
})

describe('resolveTestPath — 边界', () => {
  test('未知语言 → 兜底加 .test', () => {
    const p = resolveTestPath('foo.bar', 'unknown', 'unknown')
    expect(p).toBe('foo.bar.test')
  })

  test('根目录文件无父目录', () => {
    const p = resolveTestPath('utils.ts', 'typescript', 'jest')
    expect(p).toBe('utils.test.ts')
  })
})
