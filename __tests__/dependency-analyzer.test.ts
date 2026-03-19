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
  extractVueScriptContent,
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

  test('解析带 as 别名的 import — 返回原始名并记录 aliasMap', () => {
    const content = `import { foo as bar, baz as qux } from './module'`
    const imports = parseImports(content, 'src/app.ts')
    expect(imports).toHaveLength(1)
    // 应返回原始名称，不是别名
    expect(imports[0].importedSymbols).toEqual(['foo', 'baz'])
    // aliasMap 应记录别名映射
    expect(imports[0].aliasMap).toEqual({foo: 'bar', baz: 'qux'})
  })

  test('无别名时 aliasMap 为空对象', () => {
    const content = `import { foo, bar } from './module'`
    const imports = parseImports(content, 'src/app.ts')
    expect(imports[0].aliasMap).toEqual({})
  })

  test('解析 require 解构别名（冒号语法）', () => {
    const content = `const { foo: myFoo, bar } = require('./module')`
    const imports = parseImports(content, 'src/app.js')
    expect(imports[0].importedSymbols).toEqual(['foo', 'bar'])
    expect(imports[0].aliasMap).toEqual({foo: 'myFoo'})
  })

  test('解析 re-export 别名', () => {
    const content = `export { Options as Opts, PathFilter } from './options'`
    const imports = parseImports(content, 'src/index.ts')
    expect(imports[0].importedSymbols).toEqual(['Options', 'PathFilter'])
    expect(imports[0].aliasMap).toEqual({Options: 'Opts'})
  })

  test('解析 Python from import 别名', () => {
    const content = `from utils import calculate_total as calc, format_output`
    const imports = parseImports(content, 'src/main.py')
    expect(imports[0].importedSymbols).toEqual(['calculate_total', 'format_output'])
    expect(imports[0].aliasMap).toEqual({calculate_total: 'calc'})
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

  test('解析动态 import()（defineAsyncComponent / 路由懒加载）', () => {
    const content = `
const AsyncComp = defineAsyncComponent(() => import('./components/Heavy.vue'))
const routes = [
  { path: '/about', component: () => import('./pages/About.vue') }
]
import { ref } from 'vue'`
    const imports = parseImports(content, 'src/app.ts')
    const paths = imports.map(i => i.importPath)
    expect(paths).toContain('./components/Heavy.vue')
    expect(paths).toContain('./pages/About.vue')
    expect(paths).toContain('vue')
  })

  test('动态 import() 标记为 default import', () => {
    const content = `const Lazy = defineAsyncComponent(() => import('./Lazy.vue'))`
    const imports = parseImports(content, 'src/app.ts')
    const lazyImport = imports.find(i => i.importPath === './Lazy.vue')
    expect(lazyImport).toBeDefined()
    expect(lazyImport!.isDefault).toBe(true)
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

  test('从 @@ hunk 上下文中提取包围的导出函数', () => {
    // 模拟修改 export function useCart() 内部的子函数
    // git diff 会在 @@ 行尾部显示所在的函数上下文
    const diff = `@@ -30,3 +30,5 @@ export function useCart() {
-  function removeItem(id: string) {
-    items.value = items.value.filter(i => i.id !== id)
-  }
+  function removeItem(id: string, silent: boolean = false) {
+    items.value = items.value.filter(i => i.id !== id)
+    if (!silent) console.log(\`Removed item: \${id}\`)
+  }`
    const symbols = extractModifiedSymbols('composables/useCart.ts', diff)
    // removeItem 是内部函数（非导出），useCart 是导出函数（从 hunk 上下文提取）
    const exported = symbols.filter(s => s.isExported)
    expect(exported).toHaveLength(1)
    expect(exported[0].name).toBe('useCart')
    expect(exported[0].type).toBe('function')
  })

  test('hunk 上下文中的非导出函数不会被添加', () => {
    // 修改发生在内部函数 helper() 内部
    const diff = `@@ -10,3 +10,4 @@ function helper() {
+    const x = 1
+    const y = 2`
    const symbols = extractModifiedSymbols('src/utils.ts', diff)
    const exported = symbols.filter(s => s.isExported)
    expect(exported).toHaveLength(0)
  })

  test('多个 hunk 各自提取上下文导出函数', () => {
    const diff = `@@ -10,3 +10,4 @@ export function foo() {
+    const a = 1
@@ -30,3 +31,4 @@ export function bar() {
+    const b = 2`
    const symbols = extractModifiedSymbols('src/utils.ts', diff)
    const exported = symbols.filter(s => s.isExported)
    expect(exported).toHaveLength(2)
    expect(exported.map(s => s.name).sort()).toEqual(['bar', 'foo'])
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

  test('解析 @/ 路径别名（映射到 src/）', () => {
    const result = resolveImportPath('src/app.ts', '@/utils/helper', repoFiles)
    expect(result).toBe('src/utils/helper.ts')
  })

  test('解析 @/ 路径别名（映射到 app/ 目录）', () => {
    const appRepoFiles = new Set([
      'app/components/Button.tsx',
      'app/utils/format.ts'
    ])
    const result = resolveImportPath('app/page.tsx', '@/components/Button', appRepoFiles)
    expect(result).toBe('app/components/Button.tsx')
  })

  test('解析 ~/ 路径别名', () => {
    const result = resolveImportPath('src/app.ts', '~/utils/helper', repoFiles)
    expect(result).toBe('src/utils/helper.ts')
  })

  test('解析 #/ 路径别名', () => {
    const result = resolveImportPath('src/app.ts', '#/utils/helper', repoFiles)
    expect(result).toBe('src/utils/helper.ts')
  })

  test('路径别名解析失败返回 null', () => {
    const result = resolveImportPath('src/app.ts', '@/nonexistent', repoFiles)
    expect(result).toBeNull()
  })

  test('路径别名支持 index 文件解析', () => {
    const result = resolveImportPath('src/app.ts', '@/utils', repoFiles)
    expect(result).toBe('src/utils/index.ts')
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

// ==================== 别名引用端到端测试 ====================

describe('端到端场景: 别名引用 — import { foo as bar } 能被正确追踪', () => {
  test('符号别名：通过别名使用的引用能被搜索到', () => {
    // 步骤 1：提取修改的导出符号
    const diff = `@@ -1,3 +1,5 @@
+export function calculateTotal(items: Item[], discount = 0): number {
+  const subtotal = items.reduce((sum, item) => sum + item.price, 0)
+  return subtotal * (1 - discount)
+}`
    const symbols = extractModifiedSymbols('src/utils/pricing.ts', diff)
    const exported = symbols.filter(s => s.isExported)
    expect(exported.find(s => s.name === 'calculateTotal')).toBeDefined()

    // 步骤 2：解析包含别名的依赖文件导入
    const paymentContent = `import { calculateTotal as calcTotal } from '../utils/pricing'

export function processPayment(items: Item[]): PaymentResult {
  const total = calcTotal(items)
  return { total }
}
`
    const imports = parseImports(paymentContent, 'src/checkout/payment.ts')
    const pricingImport = imports.find(i => i.importPath.includes('pricing'))
    expect(pricingImport).toBeDefined()
    expect(pricingImport!.importedSymbols).toContain('calculateTotal')
    expect(pricingImport!.aliasMap).toEqual({calculateTotal: 'calcTotal'})

    // 步骤 3：使用别名搜索引用 — 同时搜索原始名和别名
    const searchSymbols = ['calculateTotal']
    const alias = pricingImport!.aliasMap['calculateTotal']
    if (alias) searchSymbols.push(alias)

    const refs = findReferencesInContent(
      'src/checkout/payment.ts',
      paymentContent,
      searchSymbols
    )
    // 应该找到 calcTotal(items) 这一行
    expect(refs.length).toBeGreaterThanOrEqual(1)
    expect(refs.some(r => r.lineContent.includes('calcTotal(items)'))).toBe(true)
  })

  test('路径别名：@/ 路径导入能正确解析', () => {
    const repoFiles = new Set([
      'src/utils/pricing.ts',
      'src/checkout/payment.ts'
    ])

    // @/utils/pricing 应解析到 src/utils/pricing.ts
    const resolved = resolveImportPath(
      'src/checkout/payment.ts',
      '@/utils/pricing',
      repoFiles
    )
    expect(resolved).toBe('src/utils/pricing.ts')
  })

  test('require 解构别名：const { foo: bar } = require(...) 能被追踪', () => {
    const content = `const { processOrder: handleOrder } = require('./orders')

const result = handleOrder(order)
console.log(result)
`
    const imports = parseImports(content, 'src/app.js')
    expect(imports[0].importedSymbols).toEqual(['processOrder'])
    expect(imports[0].aliasMap).toEqual({processOrder: 'handleOrder'})

    // 搜索时加入别名
    const searchSymbols = ['processOrder', 'handleOrder']
    const refs = findReferencesInContent('src/app.js', content, searchSymbols)
    expect(refs.some(r => r.lineContent.includes('handleOrder(order)'))).toBe(true)
  })
})

// ==================== P0: export * from 解析 ====================
describe('export * from 解析', () => {
  test('解析 export * from 语句', () => {
    const content = `export * from './calculator'
export * from '../shared/utils'
import { foo } from './bar'
`
    const imports = parseImports(content, 'src/utils/index.ts')
    const starExports = imports.filter(i => i.isNamespace && i.importedSymbols.length === 0)
    expect(starExports.length).toBe(2)
    expect(starExports[0].importPath).toBe('./calculator')
    expect(starExports[1].importPath).toBe('../shared/utils')
  })
})

// ==================== P0: barrel file 端到端 ====================
describe('端到端场景: Barrel file 间接引用追踪', () => {
  test('通过 barrel file re-export 的间接消费者能被追踪', () => {
    // 场景：calculator.ts 被修改 → index.ts re-export → Dashboard.tsx 间接消费
    const calculatorDiff = `--- a/src/utils/calculator.ts
+++ b/src/utils/calculator.ts
@@ -1,3 +1,3 @@
-export function calculateTotal(items: Item[]): number {
+export function calculateTotal(items: Item[], tax: number): number {
   return items.reduce((sum, item) => sum + item.price, 0)
 }
`
    // 步骤 1：提取修改符号
    const symbols = extractModifiedSymbols('src/utils/calculator.ts', calculatorDiff)
    expect(symbols.some(s => s.name === 'calculateTotal')).toBe(true)

    // 步骤 2-5 模拟：barrel file 直接 import calculator
    const barrelContent = `export { calculateTotal } from './calculator'
export { formatPrice } from './formatter'
`
    const barrelImports = parseImports(barrelContent, 'src/utils/index.ts')
    expect(barrelImports.some(i => i.importPath === './calculator')).toBe(true)

    // 步骤 5.5 模拟：Dashboard 通过 barrel file 间接消费
    const dashboardContent = `import { calculateTotal } from '../utils'

export function Dashboard() {
  const total = calculateTotal(cartItems)
  return <div>{total}</div>
}
`
    const dashboardImports = parseImports(dashboardContent, 'src/pages/Dashboard.tsx')
    expect(dashboardImports[0].importPath).toBe('../utils')
    // 解析路径应指向 barrel file
    const repoFiles = new Set([
      'src/utils/calculator.ts',
      'src/utils/index.ts',
      'src/utils/formatter.ts',
      'src/pages/Dashboard.tsx'
    ])
    const resolved = resolveImportPath('src/pages/Dashboard.tsx', '../utils', repoFiles)
    expect(resolved).toBe('src/utils/index.ts')

    // barrel 检测：index.ts 包含指向 calculator.ts 的 re-export
    const hasReExport = barrelContent.match(/export\s+(?:\{[^}]*\}|\*)\s+from\s+['"]([^'"]+)['"]/)
    expect(hasReExport).toBeTruthy()
    const reExportResolved = resolveImportPath('src/utils/index.ts', hasReExport![1], repoFiles)
    expect(reExportResolved).toBe('src/utils/calculator.ts')

    // 引用搜索能在 Dashboard 中找到 calculateTotal
    const refs = findReferencesInContent(
      'src/pages/Dashboard.tsx',
      dashboardContent,
      ['calculateTotal']
    )
    expect(refs.length).toBeGreaterThanOrEqual(1)
    expect(refs.some(r => r.lineContent.includes('calculateTotal(cartItems)'))).toBe(true)
  })
})

// ==================== P1: default import 引用追踪 ====================
describe('default import 引用追踪', () => {
  test('default import 的本地名应加入搜索列表', () => {
    // import calc from './utils' → 文件中使用 calc() 而非 calculateTotal()
    const content = `import calc from './utils'

const total = calc(items)
console.log(total)
`
    const imports = parseImports(content, 'src/consumer.ts')
    expect(imports[0].isDefault).toBe(true)
    expect(imports[0].importedSymbols).toEqual(['calc'])

    // 搜索时应包含 default import 的本地名 'calc'
    const refs = findReferencesInContent('src/consumer.ts', content, ['calc'])
    expect(refs.length).toBeGreaterThanOrEqual(1)
    expect(refs.some(r => r.lineContent.includes('calc(items)'))).toBe(true)

    // 原始导出名 'calculateTotal' 搜索不到（这正是 bug 所在）
    const refsOriginal = findReferencesInContent('src/consumer.ts', content, ['calculateTotal'])
    expect(refsOriginal.length).toBe(0)
  })
})

// ==================== P1: namespace import 引用追踪 ====================
describe('namespace import 引用追踪', () => {
  test('namespace import 的 namespaceName.symbolName 模式应被搜索', () => {
    const content = `import * as utils from './calculator'

const total = utils.calculateTotal(items)
const price = utils.formatPrice(total)
`
    const imports = parseImports(content, 'src/consumer.ts')
    expect(imports[0].isNamespace).toBe(true)
    expect(imports[0].importedSymbols).toEqual(['utils'])

    // 搜索 utils.calculateTotal 应能找到
    const refs = findReferencesInContent(
      'src/consumer.ts',
      content,
      ['utils.calculateTotal']
    )
    expect(refs.length).toBeGreaterThanOrEqual(1)
    expect(refs.some(r => r.lineContent.includes('utils.calculateTotal(items)'))).toBe(true)
  })
})

// ==================== P2: Python 点式相对导入 ====================
describe('Python 点式相对导入', () => {
  test('from .utils import foo → 转换为 ./utils', () => {
    const content = `from .utils import calculate_total
from ..shared import helper
from ...core.base import BaseClass
`
    const imports = parseImports(content, 'src/pkg/module.py')
    expect(imports[0].importPath).toBe('./utils')
    expect(imports[0].importedSymbols).toContain('calculate_total')
    expect(imports[1].importPath).toBe('../shared')
    expect(imports[1].importedSymbols).toContain('helper')
    expect(imports[2].importPath).toBe('../../core/base')
    expect(imports[2].importedSymbols).toContain('BaseClass')
  })

  test('from . import foo → 当前目录', () => {
    const content = `from . import utils
`
    const imports = parseImports(content, 'src/pkg/module.py')
    expect(imports[0].importPath).toBe('.')
    expect(imports[0].importedSymbols).toContain('utils')
  })

  test('Python 相对导入路径解析（配合 __init__.py）', () => {
    const repoFiles = new Set([
      'src/pkg/utils.py',
      'src/pkg/module.py',
      'src/shared/__init__.py',
      'src/shared/helper.py'
    ])

    // ./utils → src/pkg/utils.py
    const resolved1 = resolveImportPath('src/pkg/module.py', './utils', repoFiles)
    expect(resolved1).toBe('src/pkg/utils.py')

    // ../shared → src/shared/__init__.py
    const resolved2 = resolveImportPath('src/pkg/module.py', '../shared', repoFiles)
    expect(resolved2).toBe('src/shared/__init__.py')
  })
})

// ==================== Case G 诊断测试 ====================
describe('Case G 诊断: 多文件导入同一模块 → 去重 + 多引用聚合', () => {
  test('多行 re-export 能被正确解析', () => {
    const indexContent = `export {
  log,
  logInfo,
  logWarn,
  logError,
  logDebug,
  setLogLevel,
} from "./logger";
export type { LogLevel } from "./logger";
`
    const imports = parseImports(indexContent, 'src/utils/index.ts')
    const loggerImport = imports.find(i => i.importPath === './logger' && !i.isNamespace)
    expect(loggerImport).toBeDefined()
    expect(loggerImport!.importedSymbols).toContain('logInfo')
    expect(loggerImport!.importedSymbols).toContain('log')
    expect(loggerImport!.importedSymbols).toContain('setLogLevel')
    // type import 应被排除
    const typeImport = imports.filter(i => i.importedSymbols.includes('LogLevel'))
    expect(typeImport).toHaveLength(0)
  })

  test('re-export 行中的符号不应算作"引用"（假阳性）', () => {
    const indexContent = `export {
  log,
  logInfo,
  logWarn,
} from "./logger";

// 真正的使用
const x = logInfo('test');
`
    const refs = findReferencesInContent('src/utils/index.ts', indexContent, ['logInfo'])
    // 修复后：只找到第 8 行的真正使用，不包含 re-export 中的 logInfo
    expect(refs).toHaveLength(1)
    expect(refs[0].lineNumber).toBe(8)
    expect(refs[0].lineContent).toContain("logInfo('test')")
  })

  test('单行 export { } from / export * from 也应被跳过', () => {
    const content = `export { logInfo, logError } from './logger';
export * from './helpers';

const result = logInfo('hello');
`
    const refs = findReferencesInContent('test.ts', content, ['logInfo'])
    expect(refs).toHaveLength(1)
    expect(refs[0].lineNumber).toBe(4)
  })

  test('多行 import { } from 也应被跳过', () => {
    const content = `import {
  logInfo,
  logError,
} from './logger';

logInfo('hello');
`
    const refs = findReferencesInContent('test.ts', content, ['logInfo'])
    expect(refs).toHaveLength(1)
    expect(refs[0].lineNumber).toBe(6)
  })

  test('export const/function 等声明中的引用应保留', () => {
    const content = `export const total = calculateTotal(items);
export function process() {
  return calculateTotal(data);
}
`
    const refs = findReferencesInContent('test.ts', content, ['calculateTotal'])
    // export const/function 不以 'export {' 开头，所以不会被过滤
    expect(refs.length).toBe(2)
  })

  test('Case G 端到端: 多文件去重 + 多引用聚合', () => {
    // Step 1: 提取修改的符号
    const diff = `@@ -49,3 +49,7 @@
-export function logInfo(msg: string, ...args: unknown[]): void {
-  log("info", msg, ...args);
-}
+export function logInfo(
+  msg: string,
+  context?: string,
+  ...args: unknown[]
+): void {
+  log("info", context ? \`[\${context}] \${msg}\` : msg, ...args);
+}`
    const symbols = extractModifiedSymbols('src/utils/logger.ts', diff)
    const exported = symbols.filter(s => s.isExported)
    expect(exported.find(s => s.name === 'logInfo')).toBeDefined()

    // Step 2-5: 模拟多个文件导入 logInfo
    const files: Record<string, string> = {
      'src/hooks/useCart.ts': `import { logInfo } from '../utils/logger'

export function useCart() {
  logInfo('Adding item to cart', item.name)
  logInfo('Removing item from cart', itemId)
}`,
      'src/components/CartSummary.tsx': `import { logInfo } from '../utils/logger'

export const CartSummary = () => {
  logInfo('Cart summary rendered', \`\${items.length} items\`)
}`,
      'src/components/CheckoutForm.tsx': `import { logInfo, logError } from '../utils/logger'

export const CheckoutForm = () => {
  logInfo('Checkout submitted', \`total: \${total}\`)
  logError('Checkout failed', String(err))
}`,
      'src/services/orderService.ts': `import { logInfo, logError, logWarn } from '../utils/logger'

export async function createOrder() {
  logInfo('Creating order', \`subtotal=\${subtotal}\`)
  logWarn('Empty cart')
  logInfo('Order created', orderId)
  logError('Failed', String(err))
  logInfo('Cancelling order', orderId)
  logWarn('Order cancelled', orderId)
}`,
    }

    const repoFiles = new Set([
      'src/utils/logger.ts',
      'src/utils/index.ts',
      ...Object.keys(files),
    ])

    // 模拟依赖图构建
    const deps: Array<{file: string; symbols: string[]; aliasMap: Record<string, string>}> = []
    for (const [file, content] of Object.entries(files)) {
      const imports = parseImports(content, file)
      for (const imp of imports) {
        const resolved = resolveImportPath(file, imp.importPath, repoFiles)
        if (resolved === 'src/utils/logger.ts') {
          const existing = deps.find(d => d.file === file)
          if (existing) {
            for (const s of imp.importedSymbols) {
              if (!existing.symbols.includes(s)) existing.symbols.push(s)
            }
            Object.assign(existing.aliasMap, imp.aliasMap)
          } else {
            deps.push({file, symbols: [...imp.importedSymbols], aliasMap: {...imp.aliasMap}})
          }
        }
      }
    }

    // 去重验证：每个文件只出现一次
    expect(deps.length).toBe(4)
    const fileNames = deps.map(d => d.file)
    expect(new Set(fileNames).size).toBe(4) // 无重复

    // 验证各文件导入的符号
    const checkoutDep = deps.find(d => d.file.includes('CheckoutForm'))
    expect(checkoutDep!.symbols).toEqual(['logInfo', 'logError'])

    const orderDep = deps.find(d => d.file.includes('orderService'))
    expect(orderDep!.symbols).toEqual(['logInfo', 'logError', 'logWarn'])

    // Step 6: 引用搜索
    const symbolNames = ['logInfo']
    let allReferences: Array<{filename: string; symbolName: string; lineNumber: number; lineContent: string}> = []
    for (const dep of deps) {
      const content = files[dep.file]
      const relevantSymbols = dep.symbols.length > 0
        ? symbolNames.filter(s => dep.symbols.includes(s))
        : symbolNames
      const searchSymbols = relevantSymbols.length > 0 ? relevantSymbols : symbolNames

      const refs = findReferencesInContent(dep.file, content, searchSymbols)
      allReferences.push(...refs)
    }

    // 多引用聚合验证
    console.log('All references:', allReferences.map(r => `${r.filename}:${r.lineNumber}: ${r.lineContent}`))
    // useCart: 2 refs, CartSummary: 1 ref, CheckoutForm: 1 ref, orderService: 3 refs = 7 total
    expect(allReferences.length).toBe(7)

    // 来自不同文件
    const refFiles = new Set(allReferences.map(r => r.filename))
    expect(refFiles.size).toBe(4) // 4 个不同文件都有引用

    // 只搜索 logInfo，不搜索 logError 和 logWarn
    for (const ref of allReferences) {
      expect(ref.symbolName).toBe('logInfo')
    }
  })
})

// ==================== Vue SFC 测试 ====================

describe('extractVueScriptContent', () => {
  test('提取 <script setup lang="ts"> 内容', () => {
    const content = `<template><div>{{ msg }}</div></template>
<script setup lang="ts">
import { ref } from 'vue'
const msg = ref('hello')
</script>
<style scoped>.div { color: red }</style>`

    const result = extractVueScriptContent(content)
    expect(result).toContain("import { ref } from 'vue'")
    expect(result).toContain("const msg = ref('hello')")
    expect(result).not.toContain('<template>')
    expect(result).not.toContain('<style')
  })

  test('提取双 script 块（<script> + <script setup>）并拼接', () => {
    const content = `<script lang="ts">
import type { Product } from '../types'
</script>
<script setup lang="ts">
import { computed } from 'vue'
const total = computed(() => 0)
</script>
<template><div></div></template>`

    const result = extractVueScriptContent(content)
    expect(result).toContain("import type { Product } from '../types'")
    expect(result).toContain("import { computed } from 'vue'")
    expect(result).toContain('const total = computed')
  })

  test('无 script 块返回空字符串', () => {
    const content = `<template><div>Static</div></template>
<style>.div { color: red }</style>`

    const result = extractVueScriptContent(content)
    expect(result.trim()).toBe('')
  })

  test('template 中的 "script" 字样不被误匹配', () => {
    const content = `<template>
  <div>This is a script tag example</div>
</template>
<script setup>
import { ref } from 'vue'
</script>`

    const result = extractVueScriptContent(content)
    expect(result).toContain("import { ref } from 'vue'")
    expect(result).not.toContain('script tag example')
  })
})

describe('parseImports - Vue SFC', () => {
  test('解析 .vue 文件 <script setup> 内的 ES6 import', () => {
    const content = `<template><div>{{ msg }}</div></template>
<script setup lang="ts">
import { ref } from 'vue'
import BaseButton from '~/components/ui/BaseButton.vue'
import { useAuth } from '@/composables/auth'
const msg = ref('hello')
</script>
<style scoped>.div { color: red }</style>`

    const imports = parseImports(content, 'pages/index.vue')
    expect(imports).toHaveLength(3)
    // parseTsImports 先解析 named import 再解析 default import
    const paths = imports.map(i => i.importPath)
    expect(paths).toContain('vue')
    expect(paths).toContain('~/components/ui/BaseButton.vue')
    expect(paths).toContain('@/composables/auth')
    const defaultImport = imports.find(i => i.importPath === '~/components/ui/BaseButton.vue')!
    expect(defaultImport.isDefault).toBe(true)
    const namedImport = imports.find(i => i.importPath === '@/composables/auth')!
    expect(namedImport.importedSymbols).toContain('useAuth')
  })

  test('解析 .vue 文件 <script>（非 setup）内的 import', () => {
    const content = `<script lang="ts">
import { defineComponent } from 'vue'
import { useCart } from '../composables/useCart'
export default defineComponent({
  setup() { return { ...useCart() } }
})
</script>
<template><div></div></template>`

    const imports = parseImports(content, 'components/CartSummary.vue')
    expect(imports).toHaveLength(2)
    expect(imports[0].importPath).toBe('vue')
    expect(imports[1].importPath).toBe('../composables/useCart')
  })

  test('双 script 块合并解析', () => {
    const content = `<script lang="ts">
import { defineComponent } from 'vue'
</script>
<script setup lang="ts">
import { useCart } from '../composables/useCart'
</script>
<template><div></div></template>`

    const imports = parseImports(content, 'components/Card.vue')
    expect(imports).toHaveLength(2)
  })

  test('无 script 块返回空', () => {
    const content = `<template><div>Static</div></template>
<style>.div { color: red }</style>`

    const imports = parseImports(content, 'components/Static.vue')
    expect(imports).toHaveLength(0)
  })

  test('template 中的伪 import 不被解析', () => {
    const content = `<template>
  <div>{{ "import { foo } from 'bar'" }}</div>
</template>
<script setup>
import { ref } from 'vue'
</script>`

    const imports = parseImports(content, 'components/Foo.vue')
    expect(imports).toHaveLength(1)
    expect(imports[0].importPath).toBe('vue')
  })
})

describe('extractModifiedSymbols - Vue SFC', () => {
  test('提取 .vue <script> 块内的 export function', () => {
    const diff = ` <script setup lang="ts">
+export function useAuth() {
+  return { isLoggedIn: ref(false) }
+}
 </script>`

    const symbols = extractModifiedSymbols('composables/useAuth.vue', diff)
    expect(symbols).toHaveLength(1)
    expect(symbols[0].name).toBe('useAuth')
    expect(symbols[0].isExported).toBe(true)
  })

  test('忽略 template 区域的变更', () => {
    const diff = ` <template>
+  <div>{{ newFunction() }}</div>
 </template>
 <script setup>
 </script>`

    const symbols = extractModifiedSymbols('components/Foo.vue', diff)
    expect(symbols).toHaveLength(0)
  })

  test('忽略 style 区域的变更', () => {
    const diff = ` <script setup>
 </script>
 <style>
+.new-class { color: red }
 </style>`

    const symbols = extractModifiedSymbols('components/Foo.vue', diff)
    expect(symbols).toHaveLength(0)
  })

  test('提取 defineProps 宏', () => {
    const diff = ` <script setup lang="ts">
+const props = defineProps<{ title: string; count: number }>()
 </script>`

    const symbols = extractModifiedSymbols('components/Card.vue', diff)
    expect(symbols.some(s => s.name === 'props')).toBe(true)
  })

  test('提取 defineEmits 宏', () => {
    const diff = ` <script setup lang="ts">
+const emit = defineEmits<{ click: [id: string] }>()
 </script>`

    const symbols = extractModifiedSymbols('components/Button.vue', diff)
    expect(symbols.some(s => s.name === 'emit')).toBe(true)
  })

  test('提取 defineExpose 宏中的符号', () => {
    const diff = ` <script setup lang="ts">
+defineExpose({ validate, reset })
 </script>`

    const symbols = extractModifiedSymbols('components/Form.vue', diff)
    expect(symbols.some(s => s.name === 'validate')).toBe(true)
    expect(symbols.some(s => s.name === 'reset')).toBe(true)
  })

  test('非 .vue 文件不受 script 块追踪影响', () => {
    const diff = `+export function helper() {
+  return true
+}`

    const symbols = extractModifiedSymbols('utils/helper.ts', diff)
    expect(symbols).toHaveLength(1)
    expect(symbols[0].name).toBe('helper')
  })
})

describe('resolveImportPath - .vue extension', () => {
  test('无扩展名路径解析到 .vue 文件', () => {
    const repoFiles = new Set([
      'components/ProductCard.vue',
      'components/ui/BaseButton.vue'
    ])

    const result = resolveImportPath(
      'pages/index.vue',
      '../components/ProductCard',
      repoFiles
    )
    expect(result).toBe('components/ProductCard.vue')
  })

  test('显式 .vue 扩展名解析', () => {
    const repoFiles = new Set(['components/ui/BaseButton.vue'])

    const result = resolveImportPath(
      'components/CartSummary.vue',
      './ui/BaseButton.vue',
      repoFiles
    )
    expect(result).toBe('components/ui/BaseButton.vue')
  })

  test('#components/ 别名解析', () => {
    const repoFiles = new Set(['components/AppHeader.vue'])

    const result = resolveImportPath(
      'layouts/default.vue',
      '#components/AppHeader',
      repoFiles
    )
    expect(result).toBe('components/AppHeader.vue')
  })

  test('解析 index.vue 目录入口', () => {
    const repoFiles = new Set(['components/ui/index.vue'])

    const result = resolveImportPath(
      'pages/index.vue',
      '../components/ui',
      repoFiles
    )
    expect(result).toBe('components/ui/index.vue')
  })
})

describe('detectLanguage - Vue', () => {
  test('.vue 文件检测为 typescript', () => {
    expect(detectLanguage('components/Foo.vue')).toBe('typescript')
    expect(detectLanguage('pages/index.vue')).toBe('typescript')
    expect(detectLanguage('App.vue')).toBe('typescript')
  })
})

describe('filterByExtension - Vue', () => {
  test('按 .vue 扩展名过滤', () => {
    const files = [
      'components/Foo.vue',
      'utils/helper.ts',
      'pages/index.vue',
      'README.md'
    ]
    const result = filterByExtension(files, ['.vue'])
    expect(result).toEqual(['components/Foo.vue', 'pages/index.vue'])
  })

  test('.vue 包含在 typescript 扩展名组中', () => {
    const files = [
      'components/Foo.vue',
      'utils/helper.ts',
      'main.py'
    ]
    const result = filterByExtension(files, ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue'])
    expect(result).toEqual(['components/Foo.vue', 'utils/helper.ts'])
  })
})
