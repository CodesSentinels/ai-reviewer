/**
 * unit-test-change-analyzer.test.ts — change-analyzer 单元测试
 */
import {describe, expect, test} from '@jest/globals'
import {
  detectLanguageByPath,
  extractTestTargets,
  filterTargetsByArgs,
  shouldSkipPath
} from '../src/unit-test/change-analyzer'

describe('detectLanguageByPath', () => {
  test('识别常见 JS/TS', () => {
    expect(detectLanguageByPath('src/foo.ts')).toBe('typescript')
    expect(detectLanguageByPath('src/foo.tsx')).toBe('typescript')
    expect(detectLanguageByPath('src/foo.js')).toBe('javascript')
    expect(detectLanguageByPath('src/foo.mjs')).toBe('javascript')
  })

  test('识别 Python / Go', () => {
    expect(detectLanguageByPath('app/utils.py')).toBe('python')
    expect(detectLanguageByPath('cmd/main.go')).toBe('go')
  })

  test('未知后缀 → unknown', () => {
    expect(detectLanguageByPath('README.md')).toBe('unknown')
    expect(detectLanguageByPath('Makefile')).toBe('unknown')
  })
})

describe('shouldSkipPath', () => {
  test('已有测试文件被跳过', () => {
    expect(shouldSkipPath('src/__tests__/foo.test.ts')).toBe(true)
    expect(shouldSkipPath('src/foo.spec.ts')).toBe(true)
    expect(shouldSkipPath('pkg/foo_test.go')).toBe(true)
    expect(shouldSkipPath('app/tests/test_foo.py')).toBe(true)
  })

  test('普通源代码不被跳过', () => {
    expect(shouldSkipPath('src/foo.ts')).toBe(false)
    expect(shouldSkipPath('pkg/foo.go')).toBe(false)
  })

  test('构建产物 / node_modules 被跳过', () => {
    expect(shouldSkipPath('dist/bundle.js')).toBe(true)
    expect(shouldSkipPath('node_modules/foo/index.js')).toBe(true)
  })
})

describe('extractTestTargets — JS/TS', () => {
  test('新增 named function', () => {
    const patch = `@@ -0,0 +1,5 @@
+function debounce(fn, delay) {
+  return fn
+}
`
    const targets = extractTestTargets([
      {filename: 'src/utils.js', status: 'modified', patch}
    ])
    expect(targets).toHaveLength(1)
    expect(targets[0].name).toBe('debounce')
    expect(targets[0].kind).toBe('function')
    expect(targets[0].language).toBe('javascript')
    expect(targets[0].priority).toBe('P0')
  })

  test('新增 export const = arrow function', () => {
    const patch = `@@ -0,0 +1,3 @@
+export const throttle = (fn) => fn
`
    const targets = extractTestTargets([
      {filename: 'src/utils.ts', status: 'modified', patch}
    ])
    expect(targets.map(t => t.name)).toContain('throttle')
  })

  test('新增 class', () => {
    const patch = `@@ -0,0 +1,5 @@
+export class FooService {
+  bar() { return 1 }
+}
`
    const targets = extractTestTargets([
      {filename: 'src/foo.ts', status: 'added', patch}
    ])
    const klass = targets.find(t => t.kind === 'class')
    expect(klass?.name).toBe('FooService')
    expect(klass?.isNew).toBe(true)
  })

  test('跳过已有测试文件路径', () => {
    const patch = `@@ -0,0 +1,3 @@
+function notATest() {}
`
    const targets = extractTestTargets([
      {filename: 'src/__tests__/foo.test.ts', status: 'added', patch}
    ])
    expect(targets).toHaveLength(0)
  })

  test('removed 文件被跳过', () => {
    const targets = extractTestTargets([
      {filename: 'src/foo.ts', status: 'removed', patch: '...'}
    ])
    expect(targets).toHaveLength(0)
  })
})

describe('extractTestTargets — Python', () => {
  test('新增 def 函数', () => {
    const patch = `@@ -0,0 +1,3 @@
+def parse_query(s):
+    return s
`
    const targets = extractTestTargets([
      {filename: 'app/utils.py', status: 'modified', patch}
    ])
    expect(targets.map(t => t.name)).toContain('parse_query')
  })
})

describe('extractTestTargets — Go', () => {
  test('新增导出函数', () => {
    const patch = `@@ -0,0 +1,3 @@
+func ParseQuery(s string) string {
+    return s
+}
`
    const targets = extractTestTargets([
      {filename: 'pkg/util.go', status: 'modified', patch}
    ])
    expect(targets.map(t => t.name)).toContain('ParseQuery')
  })
})

describe('filterTargetsByArgs', () => {
  const targets = [
    {
      name: 'foo',
      kind: 'function' as const,
      filePath: 'src/foo.ts',
      language: 'typescript' as const,
      isNew: true,
      priority: 'P0' as const
    },
    {
      name: 'bar',
      kind: 'function' as const,
      filePath: 'src/bar.ts',
      language: 'typescript' as const,
      isNew: true,
      priority: 'P0' as const
    }
  ]

  test('按 --function 过滤', () => {
    const out = filterTargetsByArgs(targets, [], {'--function': 'foo'})
    expect(out.map(t => t.name)).toEqual(['foo'])
  })

  test('按文件路径过滤', () => {
    const out = filterTargetsByArgs(targets, ['src/bar.ts'], {})
    expect(out.map(t => t.name)).toEqual(['bar'])
  })

  test('无参数 → 全量', () => {
    const out = filterTargetsByArgs(targets, [], {})
    expect(out).toHaveLength(2)
  })
})
