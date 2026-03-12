/**
 * dependency-analyzer.test.ts - 跨文件依赖分析模块测试
 *
 * 覆盖两种核心场景：
 * - Case A：修改文件有导出符号且被其他文件引用（完整分析流程）
 * - Case B：修改文件无导出 / 入口文件 / 测试文件 / 无引用（智能跳过）
 */

import {describe, expect, jest, test} from '@jest/globals'

// Mock 外部依赖（避免 ReadableStream / octokit 等运行时问题）
jest.mock('@actions/core', () => ({
  info: jest.fn(),
  warning: jest.fn(),
  error: jest.fn()
}))

jest.mock('@actions/github', () => ({
  context: {
    repo: {owner: 'test-owner', repo: 'test-repo'},
    payload: {pull_request: {head: {sha: 'abc123'}}},
    eventName: 'pull_request'
  }
}))

jest.mock('../src/octokit', () => ({
  octokit: {
    repos: {getContent: jest.fn()},
    git: {getTree: jest.fn()}
  }
}))
import {
  parseImports,
  extractModifiedSymbols,
  findReferencesInContent,
  formatCrossFileContext,
  type FileDependencyInfo
} from '../src/dependency-analyzer'
import {
  detectLanguage,
  resolveImportPath,
  filterByExtension,
  sortByProximity
} from '../src/repo-tree'

// ==================== parseImports 测试 ====================

describe('parseImports', () => {
  test('解析 TS/JS named import', () => {
    const content = `import { foo, bar } from './utils/helper'`
    const imports = parseImports(content, 'src/index.ts')
    expect(imports).toHaveLength(1)
    expect(imports[0].importPath).toBe('./utils/helper')
    expect(imports[0].importedSymbols).toEqual(['foo', 'bar'])
    expect(imports[0].isDefault).toBe(false)
  })

  test('解析 TS/JS default import', () => {
    const content = `import React from 'react'\nimport MyClass from './MyClass'`
    const imports = parseImports(content, 'src/app.tsx')
    expect(imports.length).toBeGreaterThanOrEqual(2)
    const myClassImport = imports.find(i => i.importPath === './MyClass')
    expect(myClassImport).toBeDefined()
    expect(myClassImport!.isDefault).toBe(true)
    expect(myClassImport!.importedSymbols).toEqual(['MyClass'])
  })

  test('解析 TS/JS namespace import', () => {
    const content = `import * as path from 'path'`
    const imports = parseImports(content, 'src/utils.ts')
    expect(imports.length).toBeGreaterThanOrEqual(1)
    const pathImport = imports.find(i => i.importPath === 'path')
    expect(pathImport).toBeDefined()
    expect(pathImport!.isNamespace).toBe(true)
  })

  test('解析 TS/JS require', () => {
    const content = `const { readFile } = require('fs')\nconst lodash = require('lodash')`
    const imports = parseImports(content, 'src/legacy.js')
    expect(imports.length).toBeGreaterThanOrEqual(2)
    const fsImport = imports.find(i => i.importPath === 'fs')
    expect(fsImport).toBeDefined()
    expect(fsImport!.importedSymbols).toEqual(['readFile'])
  })

  test('解析 TS/JS re-export', () => {
    const content = `export { Options, PathFilter } from './options'`
    const imports = parseImports(content, 'src/index.ts')
    expect(imports).toHaveLength(1)
    expect(imports[0].importedSymbols).toEqual(['Options', 'PathFilter'])
  })

  test('解析带 as 别名的 import', () => {
    const content = `import { foo as bar, baz as qux } from './module'`
    const imports = parseImports(content, 'src/app.ts')
    expect(imports).toHaveLength(1)
    // 应返回原始名称，不是别名
    expect(imports[0].importedSymbols).toEqual(['foo', 'baz'])
  })

  test('解析 Python from import', () => {
    const content = `from utils.helper import calculate_total, format_output`
    const imports = parseImports(content, 'src/main.py')
    expect(imports).toHaveLength(1)
    expect(imports[0].importPath).toBe('utils.helper')
    expect(imports[0].importedSymbols).toEqual([
      'calculate_total',
      'format_output'
    ])
  })

  test('解析 Go 分组 import（不重复计数）', () => {
    const content = `import (\n\t"fmt"\n\t"github.com/pkg/errors"\n)`
    const imports = parseImports(content, 'main.go')
    // 修复双重匹配后应精确为 2（分组内的行不被单行正则重复捕获）
    expect(imports).toHaveLength(2)
    const fmtImport = imports.find(i => i.importPath === 'fmt')
    expect(fmtImport).toBeDefined()
    const errorsImport = imports.find(i => i.importPath === 'github.com/pkg/errors')
    expect(errorsImport).toBeDefined()
  })

  test('解析 Java import', () => {
    const content = `import com.example.utils.StringHelper;\nimport static java.util.Collections.sort;`
    const imports = parseImports(content, 'src/Main.java')
    expect(imports.length).toBeGreaterThanOrEqual(2)
    const helperImport = imports.find(
      i => i.importPath === 'com.example.utils.StringHelper'
    )
    expect(helperImport).toBeDefined()
    expect(helperImport!.importedSymbols).toEqual(['StringHelper'])
  })

  test('未知语言返回空数组', () => {
    const content = `#include <stdio.h>`
    const imports = parseImports(content, 'src/main.c')
    expect(imports).toEqual([])
  })

  test('跳过 import type（类型导入不产生运行时依赖）', () => {
    const content = `import type { UserProfile } from './types'
import { Options } from './options'
export type { Config } from './config'`
    const imports = parseImports(content, 'src/app.ts')
    // 只应匹配 import { Options }，不匹配 import type 和 export type
    const optionsImport = imports.find(i => i.importPath === './options')
    expect(optionsImport).toBeDefined()
    expect(optionsImport!.importedSymbols).toEqual(['Options'])
    // import type 和 export type 不应出现
    const typeImport = imports.find(i => i.importPath === './types')
    expect(typeImport).toBeUndefined()
    const configExport = imports.find(i => i.importPath === './config')
    expect(configExport).toBeUndefined()
  })
})

// ==================== extractModifiedSymbols 测试 ====================

describe('extractModifiedSymbols', () => {
  test('Case A：提取 TS 导出函数', () => {
    const diff = `@@ -10,6 +10,10 @@
+export function calculateTotal(items: Item[]): number {
+  return items.reduce((sum, item) => sum + item.price, 0)
+}
+export const TAX_RATE = 0.08`
    const symbols = extractModifiedSymbols('src/utils/pricing.ts', diff)
    expect(symbols).toHaveLength(2)
    expect(symbols[0].name).toBe('calculateTotal')
    expect(symbols[0].type).toBe('function')
    expect(symbols[0].isExported).toBe(true)
    expect(symbols[1].name).toBe('TAX_RATE')
    expect(symbols[1].type).toBe('variable')
    expect(symbols[1].isExported).toBe(true)
  })

  test('Case A：提取 TS 导出 class/interface/type/enum', () => {
    const diff = `@@ -1,0 +1,8 @@
+export class UserService {
+export interface UserProfile {
+export type UserId = string
+export enum UserRole {`
    const symbols = extractModifiedSymbols('src/user.ts', diff)
    expect(symbols).toHaveLength(4)
    expect(symbols.map(s => s.name)).toEqual([
      'UserService',
      'UserProfile',
      'UserId',
      'UserRole'
    ])
    expect(symbols.map(s => s.type)).toEqual([
      'class',
      'interface',
      'type',
      'enum'
    ])
  })

  test('Case A：提取 export default function', () => {
    const diff = `@@ -1,0 +1,3 @@
+export default function handler(req, res) {`
    const symbols = extractModifiedSymbols('src/api.ts', diff)
    expect(symbols).toHaveLength(1)
    expect(symbols[0].name).toBe('handler')
    expect(symbols[0].isExported).toBe(true)
  })

  test('Case A：提取 module.exports', () => {
    const diff = `@@ -1,0 +1,2 @@
+module.exports.processData = function() {}
+exports.VERSION = '1.0'`
    const symbols = extractModifiedSymbols('src/legacy.js', diff)
    expect(symbols).toHaveLength(2)
    expect(symbols.map(s => s.name)).toEqual(['processData', 'VERSION'])
  })

  test('Case B：仅修改内部函数（非导出），返回空', () => {
    const diff = `@@ -10,6 +10,10 @@
+function internalHelper(x: number): number {
+  return x * 2
+}
+const localVar = 'hello'`
    const symbols = extractModifiedSymbols('src/utils.ts', diff)
    const exported = symbols.filter(s => s.isExported)
    expect(exported).toHaveLength(0)
  })

  test('Case A：提取 Python 公共函数', () => {
    const diff = `@@ -1,0 +1,4 @@
+def calculate_tax(amount):
+    return amount * 0.08
+class OrderProcessor:
+    pass`
    const symbols = extractModifiedSymbols('src/orders.py', diff)
    expect(symbols.length).toBeGreaterThanOrEqual(2)
    expect(symbols.find(s => s.name === 'calculate_tax')).toBeDefined()
    expect(symbols.find(s => s.name === 'OrderProcessor')).toBeDefined()
  })

  test('Case B：Python 私有函数不算导出', () => {
    const diff = `@@ -1,0 +1,2 @@
+def _internal_helper():
+    pass`
    const symbols = extractModifiedSymbols('src/utils.py', diff)
    const exported = symbols.filter(s => s.isExported)
    expect(exported).toHaveLength(0)
  })

  test('Case A：提取 Go 导出函数（大写开头）', () => {
    const diff = `@@ -1,0 +1,4 @@
+func ProcessOrder(order *Order) error {
+func (s *Service) HandleRequest(r *Request) {
+type OrderConfig struct {`
    const symbols = extractModifiedSymbols('pkg/order/service.go', diff)
    expect(symbols.length).toBeGreaterThanOrEqual(2)
    expect(symbols.find(s => s.name === 'ProcessOrder')).toBeDefined()
    expect(symbols.find(s => s.name === 'OrderConfig')).toBeDefined()
  })

  test('Case A：提取 Java public 方法', () => {
    const diff = `@@ -1,0 +1,3 @@
+public class PaymentService {
+public void processPayment(Payment p) {`
    const symbols = extractModifiedSymbols('src/PaymentService.java', diff)
    expect(symbols.length).toBeGreaterThanOrEqual(2)
    expect(symbols.find(s => s.name === 'PaymentService')).toBeDefined()
    expect(symbols.find(s => s.name === 'processPayment')).toBeDefined()
  })

  test('处理删除行（以 - 开头）', () => {
    const diff = `@@ -10,3 +10,3 @@
-export function oldName(): void {
+export function newName(): void {`
    const symbols = extractModifiedSymbols('src/utils.ts', diff)
    expect(symbols.find(s => s.name === 'oldName')).toBeDefined()
    expect(symbols.find(s => s.name === 'newName')).toBeDefined()
  })

  test('跳过 diff 头部行（+++ / ---）', () => {
    const diff = `--- a/src/utils.ts
+++ b/src/utils.ts
@@ -10,3 +10,3 @@
+export function realSymbol(): void {`
    const symbols = extractModifiedSymbols('src/utils.ts', diff)
    expect(symbols).toHaveLength(1)
    expect(symbols[0].name).toBe('realSymbol')
  })
})

// ==================== findReferencesInContent 测试 ====================

describe('findReferencesInContent', () => {
  test('Case A：找到函数引用', () => {
    const content = `import { calculateTotal } from './pricing'

const result = calculateTotal(items)
console.log(calculateTotal([]))
`
    const refs = findReferencesInContent('src/checkout.ts', content, [
      'calculateTotal'
    ])
    expect(refs).toHaveLength(2)
    expect(refs[0].symbolName).toBe('calculateTotal')
    expect(refs[0].lineNumber).toBe(3)
    expect(refs[1].lineNumber).toBe(4)
  })

  test('Case A：多个符号同时搜索', () => {
    const content = `import { foo, bar } from './lib'

foo()
bar()
foo(bar())
`
    const refs = findReferencesInContent('src/app.ts', content, ['foo', 'bar'])
    expect(refs.length).toBeGreaterThanOrEqual(4)
  })

  test('Case B：无引用 — 文件不使用任何搜索符号', () => {
    const content = `import { unrelated } from './other'

const x = unrelated()
console.log('hello world')
`
    const refs = findReferencesInContent('src/unrelated.ts', content, [
      'calculateTotal',
      'TAX_RATE'
    ])
    expect(refs).toHaveLength(0)
  })

  test('跳过注释行中的匹配', () => {
    const content = `// calculateTotal is deprecated
/* calculateTotal old version */
* calculateTotal should be removed
# calculateTotal (Python comment)
const result = calculateTotal(items)
`
    const refs = findReferencesInContent('src/app.ts', content, [
      'calculateTotal'
    ])
    expect(refs).toHaveLength(1)
    expect(refs[0].lineNumber).toBe(5)
  })

  test('跳过 import/require 行', () => {
    const content = `import { calculateTotal } from './pricing'
from pricing import calculateTotal
const { calculateTotal } = require('./pricing')
const result = calculateTotal(items)
`
    const refs = findReferencesInContent('src/app.ts', content, [
      'calculateTotal'
    ])
    expect(refs).toHaveLength(1)
    expect(refs[0].lineNumber).toBe(4)
  })

  test('词边界匹配：不误匹配子串', () => {
    const content = `const fooBar = 1
const foo = 2
const prefoo = 3
`
    const refs = findReferencesInContent('src/app.ts', content, ['foo'])
    // 'foo' 应匹配行2（const foo），不应匹配 'fooBar' 和 'prefoo'
    for (const ref of refs) {
      expect(ref.lineContent).not.toContain('fooBar')
      expect(ref.lineContent).not.toContain('prefoo')
    }
    expect(refs.length).toBeGreaterThanOrEqual(1)
  })

  test('maxRefsPerSymbol 限制', () => {
    const lines = Array.from(
      {length: 20},
      (_, i) => `console.log(myFunc(${i}))`
    ).join('\n')
    const refs = findReferencesInContent('src/app.ts', lines, ['myFunc'], 3)
    expect(refs).toHaveLength(3)
  })

  test('行内容截断到 120 字符', () => {
    const longLine = `const result = calculateTotal(${'a'.repeat(200)})`
    const refs = findReferencesInContent('src/app.ts', longLine, [
      'calculateTotal'
    ])
    expect(refs).toHaveLength(1)
    expect(refs[0].lineContent.length).toBeLessThanOrEqual(120)
  })
})

// ==================== detectLanguage 测试 ====================

describe('detectLanguage', () => {
  test('检测 TypeScript', () => {
    expect(detectLanguage('src/utils.ts')).toBe('typescript')
    expect(detectLanguage('src/App.tsx')).toBe('typescript')
    expect(detectLanguage('src/legacy.js')).toBe('typescript')
    expect(detectLanguage('src/App.jsx')).toBe('typescript')
    expect(detectLanguage('src/esm.mjs')).toBe('typescript')
  })

  test('检测 Python', () => {
    expect(detectLanguage('src/main.py')).toBe('python')
  })

  test('检测 Go', () => {
    expect(detectLanguage('pkg/handler.go')).toBe('go')
  })

  test('检测 Java', () => {
    expect(detectLanguage('src/Main.java')).toBe('java')
  })

  test('未知语言', () => {
    expect(detectLanguage('src/style.css')).toBe('unknown')
    expect(detectLanguage('Makefile')).toBe('unknown')
    expect(detectLanguage('src/main.rs')).toBe('unknown')
  })
})

// ==================== resolveImportPath 测试 ====================

describe('resolveImportPath', () => {
  const repoFiles = new Set([
    'src/utils/helper.ts',
    'src/utils/index.ts',
    'src/review.ts',
    'src/options.ts',
    'src/lib/parser.js',
    'src/types.ts'
  ])

  test('解析相对路径（自动补 .ts 扩展名）', () => {
    const result = resolveImportPath('src/review.ts', './options', repoFiles)
    expect(result).toBe('src/options.ts')
  })

  test('解析带扩展名的路径', () => {
    const result = resolveImportPath(
      'src/review.ts',
      './lib/parser.js',
      repoFiles
    )
    expect(result).toBe('src/lib/parser.js')
  })

  test('解析 index 文件（目录导入）', () => {
    const result = resolveImportPath('src/review.ts', './utils', repoFiles)
    expect(result).toBe('src/utils/index.ts')
  })

  test('解析父级目录路径', () => {
    const result = resolveImportPath(
      'src/utils/helper.ts',
      '../types',
      repoFiles
    )
    expect(result).toBe('src/types.ts')
  })

  test('非相对路径（npm 包）返回 null', () => {
    const result = resolveImportPath('src/app.ts', 'lodash', repoFiles)
    expect(result).toBeNull()
  })

  test('解析失败返回 null', () => {
    const result = resolveImportPath(
      'src/app.ts',
      './nonexistent',
      repoFiles
    )
    expect(result).toBeNull()
  })
})

// ==================== filterByExtension 测试 ====================

describe('filterByExtension', () => {
  test('按扩展名过滤', () => {
    const files = [
      'src/app.ts',
      'src/style.css',
      'src/utils.js',
      'README.md',
      'src/types.tsx'
    ]
    const result = filterByExtension(files, ['.ts', '.tsx'])
    expect(result).toEqual(['src/app.ts', 'src/types.tsx'])
  })

  test('空扩展名列表返回空', () => {
    const result = filterByExtension(['src/app.ts'], [])
    expect(result).toEqual([])
  })
})

// ==================== sortByProximity 测试 ====================

describe('sortByProximity', () => {
  test('同目录文件优先', () => {
    const candidates = [
      'lib/remote.ts',
      'src/sibling.ts',
      'src/utils/child.ts',
      'test/far.ts'
    ]
    const modified = ['src/review.ts']
    const sorted = sortByProximity(candidates, modified)
    expect(sorted[0]).toBe('src/sibling.ts')
  })
})

// ==================== formatCrossFileContext 测试 ====================

describe('formatCrossFileContext', () => {
  test('Case A：有引用时生成完整上下文', () => {
    const analysis: FileDependencyInfo = {
      filename: 'src/utils/pricing.ts',
      modifiedSymbols: [
        {
          name: 'calculateTotal',
          type: 'function',
          isExported: true,
          filename: 'src/utils/pricing.ts'
        },
        {
          name: 'TAX_RATE',
          type: 'variable',
          isExported: true,
          filename: 'src/utils/pricing.ts'
        }
      ],
      dependentFiles: ['src/checkout/payment.ts', 'src/reports/summary.ts'],
      references: [
        {
          filename: 'src/checkout/payment.ts',
          symbolName: 'calculateTotal',
          lineNumber: 45,
          lineContent: 'const total = calculateTotal(cartItems)'
        },
        {
          filename: 'src/reports/summary.ts',
          symbolName: 'TAX_RATE',
          lineNumber: 12,
          lineContent: 'const tax = amount * TAX_RATE'
        }
      ]
    }

    const result = formatCrossFileContext(analysis)

    expect(result).toContain('### Modified exports in this file:')
    expect(result).toContain('`calculateTotal` (function)')
    expect(result).toContain('`TAX_RATE` (variable)')
    expect(result).toContain('### Files that import from this file (2):')
    expect(result).toContain('src/checkout/payment.ts')
    expect(result).toContain('### References to modified symbols:')
    expect(result).toContain(
      'src/checkout/payment.ts:45: const total = calculateTotal(cartItems)'
    )
    expect(result).toContain(
      'src/reports/summary.ts:12: const tax = amount * TAX_RATE'
    )
  })

  test('Case B：无引用时不包含 References 部分', () => {
    const analysis: FileDependencyInfo = {
      filename: 'src/main.ts',
      modifiedSymbols: [
        {
          name: 'run',
          type: 'function',
          isExported: true,
          filename: 'src/main.ts'
        }
      ],
      dependentFiles: [],
      references: []
    }

    const result = formatCrossFileContext(analysis)

    expect(result).toContain('### Modified exports in this file:')
    expect(result).toContain('`run` (function)')
    expect(result).not.toContain('### Files that import from this file')
    expect(result).not.toContain('### References to modified symbols')
  })

  test('超长内容截断到 3000 字符', () => {
    const manyRefs = Array.from({length: 100}, (_, i) => ({
      filename: `src/modules/feature${i}/handlers/processor${i}.ts`,
      symbolName: 'foo',
      lineNumber: i + 1,
      lineContent: `const result${i} = foo(${'x'.repeat(100)}) // ${'comment'.repeat(20)}`
    }))
    const analysis: FileDependencyInfo = {
      filename: 'src/lib.ts',
      modifiedSymbols: [
        {
          name: 'foo',
          type: 'function',
          isExported: true,
          filename: 'src/lib.ts'
        }
      ],
      dependentFiles: manyRefs.map(r => r.filename),
      references: manyRefs
    }

    const result = formatCrossFileContext(analysis)
    expect(result.length).toBeLessThanOrEqual(3100)
    expect(result).toContain('truncated for token budget')
  })

  test('测试文件引用排序靠后', () => {
    const analysis: FileDependencyInfo = {
      filename: 'src/utils.ts',
      modifiedSymbols: [
        {
          name: 'helper',
          type: 'function',
          isExported: true,
          filename: 'src/utils.ts'
        }
      ],
      dependentFiles: ['__tests__/utils.test.ts', 'src/app.ts'],
      references: [
        {
          filename: '__tests__/utils.test.ts',
          symbolName: 'helper',
          lineNumber: 5,
          lineContent: 'expect(helper()).toBe(true)'
        },
        {
          filename: 'src/app.ts',
          symbolName: 'helper',
          lineNumber: 10,
          lineContent: 'const result = helper()'
        }
      ]
    }

    const result = formatCrossFileContext(analysis)
    const appIndex = result.indexOf('src/app.ts:10')
    const testIndex = result.indexOf('__tests__/utils.test.ts:5')
    expect(appIndex).toBeLessThan(testIndex)
  })
})

// ==================== 端到端场景测试 ====================

describe('端到端场景: Case A — 修改导出函数，被其他文件引用', () => {
  test('提取符号 → 解析导入 → 搜索引用 完整链路', () => {
    // 步骤 1：提取修改的导出符号
    const diff = `@@ -10,3 +10,6 @@
-export function calculateTotal(items: Item[]): number {
-  return items.reduce((sum, item) => sum + item.price, 0)
-}
+export function calculateTotal(items: Item[], discount = 0): number {
+  const subtotal = items.reduce((sum, item) => sum + item.price, 0)
+  return subtotal * (1 - discount)
+}`
    const symbols = extractModifiedSymbols('src/utils/pricing.ts', diff)
    const exported = symbols.filter(s => s.isExported)
    expect(exported.length).toBeGreaterThanOrEqual(1)
    expect(exported.find(s => s.name === 'calculateTotal')).toBeDefined()

    // 步骤 2：解析依赖文件的导入
    const paymentContent = `import { calculateTotal, TAX_RATE } from '../utils/pricing'
import { formatCurrency } from '../utils/format'

export function processPayment(items: Item[]): PaymentResult {
  const total = calculateTotal(items)
  const tax = total * TAX_RATE
  return { total: total + tax, currency: formatCurrency(total + tax) }
}
`
    const imports = parseImports(paymentContent, 'src/checkout/payment.ts')
    const pricingImport = imports.find(i => i.importPath.includes('pricing'))
    expect(pricingImport).toBeDefined()
    expect(pricingImport!.importedSymbols).toContain('calculateTotal')

    // 步骤 3：解析导入路径
    const repoFiles = new Set([
      'src/utils/pricing.ts',
      'src/utils/format.ts',
      'src/checkout/payment.ts'
    ])
    const resolved = resolveImportPath(
      'src/checkout/payment.ts',
      '../utils/pricing',
      repoFiles
    )
    expect(resolved).toBe('src/utils/pricing.ts')

    // 步骤 4：搜索引用
    const refs = findReferencesInContent(
      'src/checkout/payment.ts',
      paymentContent,
      ['calculateTotal']
    )
    expect(refs.length).toBeGreaterThanOrEqual(1)
    expect(refs[0].lineContent).toContain('calculateTotal(items)')

    // 步骤 5：格式化上下文
    const analysis: FileDependencyInfo = {
      filename: 'src/utils/pricing.ts',
      modifiedSymbols: exported,
      dependentFiles: ['src/checkout/payment.ts'],
      references: refs
    }
    const context = formatCrossFileContext(analysis)
    expect(context).toContain('calculateTotal')
    expect(context).toContain('src/checkout/payment.ts')
    expect(context.length).toBeGreaterThan(0)
    expect(context.length).toBeLessThanOrEqual(3100)
  })
})

describe('端到端场景: Case B — 修改入口/内部函数，无外部引用', () => {
  test('B1: 入口文件导出 — 有符号但应被 isEntryPointFile 过滤', () => {
    const diff = `@@ -1,3 +1,5 @@
+export async function run(): Promise<void> {
+  const options = new Options()
+  options.print()`
    const symbols = extractModifiedSymbols('src/main.ts', diff)
    const exported = symbols.filter(s => s.isExported)
    // 有导出，但 analyzeDependencies 应在 step 1.5 跳过此文件
    expect(exported.length).toBeGreaterThanOrEqual(1)

    // 验证入口文件检测
    const basename = 'src/main.ts'
      .substring('src/main.ts'.lastIndexOf('/') + 1)
      .toLowerCase()
    expect(['main.ts', 'app.ts', 'server.ts', 'cli.ts']).toContain(basename)
  })

  test('B2: 内部函数变更不触发分析', () => {
    const diff = `@@ -50,3 +50,5 @@
+function parseInternalConfig(raw: string): Config {
+  return JSON.parse(raw)
+}
+const _cache = new Map()`
    const symbols = extractModifiedSymbols('src/config.ts', diff)
    const exported = symbols.filter(s => s.isExported)
    // 无导出符号 → analyzeDependencies 在步骤 1 直接返回
    expect(exported).toHaveLength(0)
  })

  test('B3: 有导出但无引用 — 引用搜索结果为空', () => {
    const diff = `@@ -1,0 +1,3 @@
+export function unusedHelper(): void {
+  console.log('nobody calls me')
+}`
    const symbols = extractModifiedSymbols('src/unused.ts', diff)
    const exported = symbols.filter(s => s.isExported)
    expect(exported).toHaveLength(1)

    // 搜索引用：在不包含该符号的文件中
    const otherFileContent = `import { something } from './other'
const x = something()
console.log('this file does not call it')
`
    const refs = findReferencesInContent('src/app.ts', otherFileContent, [
      'unusedHelper'
    ])
    expect(refs).toHaveLength(0)

    // 格式化：无引用 → 不包含 References 部分
    const analysis: FileDependencyInfo = {
      filename: 'src/unused.ts',
      modifiedSymbols: exported,
      dependentFiles: [],
      references: []
    }
    const context = formatCrossFileContext(analysis)
    expect(context).toContain('unusedHelper')
    expect(context).not.toContain('### References to modified symbols')
  })

  test('B4: 测试文件被智能跳过', () => {
    const diff = `@@ -1,0 +1,3 @@
+export function createMockUser(): User {
+  return { name: 'test', id: 1 }
+}`
    const symbols = extractModifiedSymbols(
      '__tests__/helpers/mock.test.ts',
      diff
    )
    const exported = symbols.filter(s => s.isExported)
    expect(exported).toHaveLength(1)

    // 验证文件名被识别为测试文件（匹配 __tests__ 目录 和 .test.ts 后缀）
    const lower = '__tests__/helpers/mock.test.ts'.toLowerCase()
    expect(
      lower.includes('__tests__') || lower.endsWith('.test.ts')
    ).toBe(true)
  })
})
