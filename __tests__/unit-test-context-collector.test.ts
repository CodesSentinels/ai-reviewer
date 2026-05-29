/**
 * unit-test-context-collector.test.ts — context-collector 单元测试
 *
 * 覆盖:
 * - extractBlock: 找到锚点、终止于下一个顶层声明、缺锚点返回 null
 * - extractTypeContext: 收集 import / interface / type 声明
 * - collectProjectTestContext: 注入式 FsReader 验证收集逻辑
 * - fillSourceSnippet: FsReader 返回 null 时不破坏 target
 */
import {describe, expect, test, jest} from '@jest/globals'

jest.mock('@actions/core', () => ({
  getInput: jest.fn().mockReturnValue(''),
  info: jest.fn(),
  warning: jest.fn()
}))

import {
  collectProjectTestContext,
  extractBlock,
  extractTypeContext,
  fillSourceSnippet,
  type FsReader
} from '../src/unit-test/context-collector'
import type {TestTarget} from '../src/unit-test/types'

function fakeTarget(overrides: Partial<TestTarget> = {}): TestTarget {
  return {
    name: 'debounce',
    kind: 'function',
    filePath: 'src/utils.ts',
    language: 'typescript',
    isNew: true,
    priority: 'P0',
    ...overrides
  }
}

/** in-memory FsReader for tests */
function memFs(
  files: Record<string, string>,
  listResults: Record<string, string[]> = {}
): FsReader {
  return {
    async readFile(p: string): Promise<string | null> {
      return Object.prototype.hasOwnProperty.call(files, p) ? files[p] : null
    },
    async list(prefix: string, suffix: string): Promise<string[]> {
      const key = `${prefix}|${suffix}`
      if (listResults[key]) return listResults[key]
      // 兜底：在 files keys 中按前缀 + 后缀过滤
      return Object.keys(files).filter(
        f => f.startsWith(prefix) && f.includes(suffix)
      )
    }
  }
}

describe('extractBlock', () => {
  test('提取 JS 函数块直到下一个顶层声明', () => {
    const content = `
import {a} from './a'

function debounce(fn, delay) {
  let timer
  return function (...args) {
    clearTimeout(timer)
    timer = setTimeout(() => fn.apply(this, args), delay)
  }
}

function throttle(fn) {
  return fn
}
`
    const block = extractBlock(content, 'debounce', 50)
    expect(block).toContain('function debounce')
    expect(block).toContain('setTimeout')
    expect(block).not.toContain('function throttle')
  })

  test('提取 export class 块', () => {
    const content = `
export class FooService {
  bar() { return 1 }
}

export class BarService {
  baz() { return 2 }
}
`
    const block = extractBlock(content, 'FooService', 30)
    expect(block).toContain('FooService')
    expect(block).toContain('bar()')
    expect(block).not.toContain('BarService')
  })

  test('提取 Python def 块', () => {
    const content = `
def helper():
    pass

def parse_query(s):
    return s.upper()

def another():
    pass
`
    const block = extractBlock(content, 'parse_query', 20)
    expect(block).toContain('def parse_query')
    expect(block).toContain('s.upper()')
    expect(block).not.toContain('def another')
  })

  test('提取 Go func 块', () => {
    const content = `
func helper() {}

func ParseQuery(s string) string {
    return s
}

func Other() {}
`
    const block = extractBlock(content, 'ParseQuery', 20)
    expect(block).toContain('ParseQuery')
    expect(block).not.toContain('Other')
  })

  test('提取 const = arrow function', () => {
    const content = `
export const throttle = (fn) => {
  return fn
}

export const debounce = (fn) => fn
`
    const block = extractBlock(content, 'throttle', 10)
    expect(block).toContain('throttle')
    expect(block).not.toContain('debounce')
  })

  test('找不到锚点返回 null', () => {
    const content = 'function other() {}'
    expect(extractBlock(content, 'debounce', 10)).toBeNull()
  })

  test('maxLines 截断生效', () => {
    const content = `function f() {\n${'  a\n'.repeat(100)}}`
    const block = extractBlock(content, 'f', 5)
    expect(block?.split('\n').length).toBeLessThanOrEqual(5)
  })

  test('特殊字符 name 不会让正则崩', () => {
    // name 含正则元字符（虽然实际场景不会出现，但应保护）
    expect(() => extractBlock('xxx', 'a.b', 10)).not.toThrow()
  })
})

describe('extractTypeContext', () => {
  test('采集 ES import / TS interface / type 声明', () => {
    const src = `
import {Foo} from './foo'
import * as fs from 'fs'

interface User {
  id: number
}

export type Result = string | null

export function go() {}
`
    const out = extractTypeContext(src, 40)
    expect(out).toContain("import {Foo}")
    expect(out).toContain('import * as fs')
    expect(out).toContain('interface User')
    expect(out).toContain('export type Result')
    expect(out).not.toContain('function go')
  })

  test('Python from ... import 也被采集', () => {
    const src = `
from typing import List
import os

def go(): pass
`
    const out = extractTypeContext(src, 40)
    expect(out).toContain('from typing import List')
    expect(out).toContain('import os')
  })

  test('maxLines 截断', () => {
    const src = Array.from({length: 100}, (_, i) => `import x${i} from './x${i}'`).join('\n')
    const out = extractTypeContext(src, 5)
    expect(out.split('\n').length).toBe(5)
  })
})

describe('fillSourceSnippet', () => {
  test('FsReader 返回 null → 原样返回（不抛）', async () => {
    const fs = memFs({})
    const target = fakeTarget()
    const out = await fillSourceSnippet(target, fs)
    expect(out.sourceSnippet).toBeUndefined()
  })

  test('成功读取 → 写入 sourceSnippet', async () => {
    const fs = memFs({
      'src/utils.ts':
        'function debounce(fn, delay) {\n  return fn\n}\n'
    })
    const out = await fillSourceSnippet(fakeTarget(), fs)
    expect(out.sourceSnippet).toContain('function debounce')
  })

  test('已带 sourceSnippet 时不重新读', async () => {
    const fs = memFs({'src/utils.ts': 'IGNORED'})
    const out = await fillSourceSnippet(
      fakeTarget({sourceSnippet: 'PRE_EXISTING'}),
      fs
    )
    expect(out.sourceSnippet).toBe('PRE_EXISTING')
  })

  test('找不到符号锚点 → 兜底为整文件（截断）', async () => {
    const fs = memFs({'src/utils.ts': 'const x = 1\nconst y = 2\n'})
    const out = await fillSourceSnippet(fakeTarget({name: 'nope'}), fs)
    expect(out.sourceSnippet).toBeDefined()
    expect(out.sourceSnippet).toContain('const x = 1')
  })
})

describe('collectProjectTestContext', () => {
  test('收集 *.test.* 样例 + 推断 __tests__/', async () => {
    const fs = memFs(
      {
        'src/__tests__/other.test.ts':
          "describe('other', () => { it('x', () => {}) })"
      },
      {
        'src|.test.': ['src/__tests__/other.test.ts'],
        'src|.spec.': [],
        'src|.py': []
      }
    )
    const ctx = await collectProjectTestContext(fakeTarget(), fs)
    expect(ctx.sampleTestFiles).toContain('src/__tests__/other.test.ts')
    expect(ctx.sampleTestSnippets).toHaveLength(1)
    expect(ctx.testDirectoryHint).toBe('__tests__')
    expect(ctx.patternHint).toBe('BDD describe/it')
  })

  test('无样例 → 空集合', async () => {
    const fs = memFs(
      {},
      {'src|.test.': [], 'src|.spec.': [], 'src|.py': []}
    )
    const ctx = await collectProjectTestContext(fakeTarget(), fs)
    expect(ctx.sampleTestFiles).toEqual([])
    expect(ctx.sampleTestSnippets).toEqual([])
    expect(ctx.testDirectoryHint).toBeUndefined()
  })

  test('pytest test_ 模式被识别', async () => {
    const fs = memFs(
      {'app/test_foo.py': 'def test_foo():\n    pass\n'},
      {
        'app|.test.': [],
        'app|.spec.': [],
        'app|.py': ['app/test_foo.py']
      }
    )
    const ctx = await collectProjectTestContext(
      fakeTarget({filePath: 'app/foo.py', language: 'python'}),
      fs
    )
    expect(ctx.sampleTestFiles).toContain('app/test_foo.py')
    expect(ctx.patternHint).toBe('pytest test_')
  })

  test('sample 文件数被截断到 3', async () => {
    const ts = (i: number) => `src/__tests__/x${i}.test.ts`
    const files: Record<string, string> = {}
    for (let i = 0; i < 5; i++) files[ts(i)] = 'x'
    const fs = memFs(files, {
      'src|.test.': [ts(0), ts(1), ts(2), ts(3), ts(4)],
      'src|.spec.': [],
      'src|.py': []
    })
    const ctx = await collectProjectTestContext(fakeTarget(), fs)
    expect(ctx.sampleTestFiles.length).toBeLessThanOrEqual(3)
  })
})
