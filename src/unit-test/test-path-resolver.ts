/**
 * unit-test/test-path-resolver.ts - 测试文件路径推断
 *
 * 对应迭代四 §5.2「测试文件路径推断」。
 *
 * 规则:
 * - JS/TS:
 *     源文件 src/utils.js       → src/__tests__/utils.test.js（若存在 __tests__/）
 *                                 否则 src/utils.test.js（同目录）
 *     若框架=vitest，扩展名保留为 .test.ts
 * - Python:
 *     源文件 pkg/foo.py          → tests/test_foo.py 或同目录 test_foo.py
 * - Go:
 *     源文件 pkg/foo.go          → pkg/foo_test.go
 *
 * 纯函数，便于单测。
 */
import type {SourceLanguage, TestFramework} from './types'

export interface ResolveOptions {
  /** 是否存在 __tests__ 目录（用于 JS/TS） */
  hasUnderscoreTests?: boolean
  /** 是否存在 tests/ 目录（用于 Python） */
  hasTestsDir?: boolean
}

export function resolveTestPath(
  sourcePath: string,
  language: SourceLanguage,
  framework: TestFramework,
  opts: ResolveOptions = {}
): string {
  const {dir, base, ext} = splitPath(sourcePath)

  if (language === 'javascript' || language === 'typescript') {
    const testExt = framework === 'mocha' ? `.spec${ext}` : `.test${ext}`
    if (opts.hasUnderscoreTests) {
      return joinPath(joinPath(dir, '__tests__'), `${base}${testExt}`)
    }
    return joinPath(dir, `${base}${testExt}`)
  }

  if (language === 'python') {
    if (opts.hasTestsDir) {
      return joinPath('tests', `test_${base}.py`)
    }
    return joinPath(dir, `test_${base}.py`)
  }

  if (language === 'go') {
    return joinPath(dir, `${base}_test.go`)
  }

  // 未知语言：在同目录加 .test 后缀
  return `${sourcePath}.test`
}

function splitPath(p: string): {dir: string; base: string; ext: string} {
  const lastSlash = p.lastIndexOf('/')
  const dir = lastSlash >= 0 ? p.slice(0, lastSlash) : ''
  const file = lastSlash >= 0 ? p.slice(lastSlash + 1) : p
  const lastDot = file.lastIndexOf('.')
  if (lastDot <= 0) {
    return {dir, base: file, ext: ''}
  }
  return {dir, base: file.slice(0, lastDot), ext: file.slice(lastDot)}
}

function joinPath(a: string, b: string): string {
  if (!a) return b
  if (a.endsWith('/')) return `${a}${b}`
  return `${a}/${b}`
}
