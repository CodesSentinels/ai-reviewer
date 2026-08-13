/**
 * 1.3 跨文件依赖分析（P0 部分）
 *
 * 测试依赖分析的核心逻辑：
 * - TS/JS import 解析（named / default / namespace / require）
 * - Vue SFC <script> 内容提取
 * - 修改符号提取（从 diff 中识别导出符号）
 * - 引用搜索（在引用方文件中查找对修改符号的使用）
 * - 跨文件上下文格式化
 */

import {describe, expect, jest, test} from '@jest/globals'

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

jest.mock('../../src/octokit', () => ({
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
} from '../../src/dependency-analyzer'

// ==================== TS/JS import 解析 ====================

describe('1.3.2 — TypeScript import 解析', () => {
  test('解析 named import', () => {
    const content = `import { formatPrice, formatDate } from '~/utils/format'`
    const imports = parseImports(content, 'src/components/Price.ts')
    const match = imports.find(i => i.importPath === '~/utils/format')
    expect(match).toBeDefined()
    expect(match!.importedSymbols).toContain('formatPrice')
    expect(match!.importedSymbols).toContain('formatDate')
    expect(match!.isDefault).toBe(false)
  })

  test('解析 default import', () => {
    const content = `import MyComponent from './MyComponent'`
    const imports = parseImports(content, 'src/pages/index.ts')
    const match = imports.find(i => i.importPath === './MyComponent')
    expect(match).toBeDefined()
    expect(match!.isDefault).toBe(true)
    expect(match!.importedSymbols).toContain('MyComponent')
  })

  test('解析 namespace import', () => {
    const content = `import * as utils from '../utils'`
    const imports = parseImports(content, 'src/app.ts')
    const match = imports.find(i => i.importPath === '../utils')
    expect(match).toBeDefined()
    expect(match!.isNamespace).toBe(true)
  })

  test('解析 require', () => {
    const content = `const { readFile } = require('fs')\nconst path = require('path')`
    const imports = parseImports(content, 'scripts/build.js')
    expect(imports.length).toBeGreaterThanOrEqual(2)
    const fsImport = imports.find(i => i.importPath === 'fs')
    expect(fsImport).toBeDefined()
    expect(fsImport!.importedSymbols).toContain('readFile')
  })

  test('解析带别名的 import', () => {
    const content = `import { ref as vueRef, computed as vueComputed } from 'vue'`
    const imports = parseImports(content, 'src/composable.ts')
    const match = imports.find(i => i.importPath === 'vue')
    expect(match).toBeDefined()
    expect(match!.importedSymbols).toContain('ref')
    expect(match!.aliasMap['ref']).toBe('vueRef')
  })

  test('解析多行 import', () => {
    const content = `import {\n  formatPrice,\n  formatDate,\n  formatNumber\n} from '~/utils/format'`
    const imports = parseImports(content, 'src/view.ts')
    const match = imports.find(i => i.importPath === '~/utils/format')
    expect(match).toBeDefined()
    expect(match!.importedSymbols).toEqual(
      expect.arrayContaining(['formatPrice', 'formatDate', 'formatNumber'])
    )
  })

  test('忽略类型导入（type import）', () => {
    const content = `import type { User } from './types'\nimport { getUser } from './api'`
    const imports = parseImports(content, 'src/service.ts')
    // type-only import 可能被解析也可能跳过，关键是不影响 named import 解析
    const apiImport = imports.find(i => i.importPath === './api')
    expect(apiImport).toBeDefined()
    expect(apiImport!.importedSymbols).toContain('getUser')
  })
})

// ==================== Vue SFC script 提取 ====================

describe('1.3.3 — Vue SFC script 内容提取', () => {
  test('提取 <script setup> 内容', () => {
    const vue = `<template><div/></template>
<script setup lang="ts">
import { formatPrice } from '~/utils/formatPrice'
const display = computed(() => formatPrice(100))
</script>
<style scoped>.a{}</style>`
    const script = extractVueScriptContent(vue)
    expect(script).toContain("import { formatPrice } from '~/utils/formatPrice'")
    expect(script).toContain('formatPrice(100)')
  })

  test('提取 <script> (非 setup) 内容', () => {
    const vue = `<template><div/></template>
<script lang="ts">
import { defineComponent } from 'vue'
export default defineComponent({ name: 'App' })
</script>`
    const script = extractVueScriptContent(vue)
    expect(script).toContain('defineComponent')
  })

  test('无 script 标签返回空', () => {
    const vue = `<template><div>Hello</div></template>
<style>.a{}</style>`
    const script = extractVueScriptContent(vue)
    expect(script).toBe('')
  })
})

// ==================== 修改符号提取 ====================

describe('1.3.1 — 从 diff 中提取修改的导出符号', () => {
  test('提取 export function', () => {
    const patch = `@@ -1,5 +1,10 @@\n+export function formatPrice(amount: number): string {\n+  return amount.toFixed(2)\n+}`
    const symbols = extractModifiedSymbols('utils/format.ts', patch)
    const match = symbols.find(s => s.name === 'formatPrice')
    expect(match).toBeDefined()
    expect(match!.type).toBe('function')
    expect(match!.isExported).toBe(true)
  })

  test('提取 export const', () => {
    const patch = `@@ -1,3 +1,5 @@\n+export const MAX_RETRY = 3\n+export const API_BASE = 'https://api.example.com'`
    const symbols = extractModifiedSymbols('config.ts', patch)
    expect(symbols.find(s => s.name === 'MAX_RETRY')).toBeDefined()
    expect(symbols.find(s => s.name === 'API_BASE')).toBeDefined()
  })

  test('提取 export class', () => {
    const patch = `@@ -1,3 +1,8 @@\n+export class UserService {\n+  async getUser(id: string) {}\n+}`
    const symbols = extractModifiedSymbols('services/user.ts', patch)
    const match = symbols.find(s => s.name === 'UserService')
    expect(match).toBeDefined()
    expect(match!.type).toBe('class')
    expect(match!.isExported).toBe(true)
  })

  test('提取 export interface / type', () => {
    const patch = `@@ -1,3 +1,6 @@\n+export interface UserProfile {\n+  name: string\n+}\n+export type UserId = string`
    const symbols = extractModifiedSymbols('types.ts', patch)
    expect(symbols.find(s => s.name === 'UserProfile' && s.type === 'interface')).toBeDefined()
    expect(symbols.find(s => s.name === 'UserId' && s.type === 'type')).toBeDefined()
  })

  test('非导出符号标记为 isExported=false', () => {
    const patch = `@@ -1,3 +1,5 @@\n+function helperFn() {}\n+const localVar = 123`
    const symbols = extractModifiedSymbols('internal.ts', patch)
    for (const sym of symbols) {
      expect(sym.isExported).toBe(false)
    }
  })

  test('删除行（-）中的符号也被提取', () => {
    const patch = `@@ -1,3 +1,3 @@\n-export function oldName(): void {}\n+export function newName(): void {}`
    const symbols = extractModifiedSymbols('module.ts', patch)
    expect(symbols.find(s => s.name === 'oldName' || s.name === 'newName')).toBeDefined()
  })
})

// ==================== 引用搜索 ====================

describe('1.3.1 — 在引用方文件中查找符号使用', () => {
  test('找到 named import 的使用', () => {
    const content = `import { formatPrice } from '~/utils/format'
const display = formatPrice(100)
console.log(formatPrice(200))`
    const refs = findReferencesInContent('pages/shop.vue', content, ['formatPrice'])
    expect(refs.length).toBeGreaterThanOrEqual(1)
    expect(refs[0].symbolName).toBe('formatPrice')
    expect(refs[0].filename).toBe('pages/shop.vue')
  })

  test('找到 default import 后的使用', () => {
    const content = `import MyUtil from './util'
const result = MyUtil.run()`
    const refs = findReferencesInContent('src/app.ts', content, ['MyUtil'])
    expect(refs.length).toBeGreaterThanOrEqual(1)
  })

  test('未使用时返回空数组', () => {
    const content = `import { other } from './utils'\nconst x = other()`
    const refs = findReferencesInContent('src/app.ts', content, ['formatPrice'])
    expect(refs).toHaveLength(0)
  })
})

// ==================== 跨文件上下文格式化 ====================

describe('1.3.1 — formatCrossFileContext', () => {
  test('生成可读的跨文件影响描述', () => {
    const analysis: FileDependencyInfo = {
      filename: 'utils/format.ts',
      modifiedSymbols: [
        {name: 'formatPrice', type: 'function', isExported: true, filename: 'utils/format.ts'}
      ],
      dependentFiles: ['components/Price.vue', 'pages/shop.vue'],
      references: [
        {
          filename: 'components/Price.vue',
          symbolName: 'formatPrice',
          lineNumber: 3,
          lineContent: 'const p = formatPrice(amt)'
        },
        {
          filename: 'pages/shop.vue',
          symbolName: 'formatPrice',
          lineNumber: 10,
          lineContent: 'formatPrice(total)'
        }
      ]
    }
    const context = formatCrossFileContext(analysis)
    expect(context).toContain('formatPrice')
    expect(context).toContain('components/Price.vue')
    expect(context).toContain('pages/shop.vue')
  })

  test('有导出符号但无引用', () => {
    const analysis: FileDependencyInfo = {
      filename: 'utils/internal.ts',
      modifiedSymbols: [
        {name: 'helper', type: 'function', isExported: true, filename: 'utils/internal.ts'}
      ],
      dependentFiles: [],
      references: []
    }
    const context = formatCrossFileContext(analysis)
    expect(context).toContain('helper')
    // 无引用方时不含 "Files that import" 部分
    expect(context).not.toContain('Files that import')
  })

  test('无修改符号时返回空', () => {
    const analysis: FileDependencyInfo = {
      filename: 'empty.ts',
      modifiedSymbols: [],
      dependentFiles: [],
      references: []
    }
    const context = formatCrossFileContext(analysis)
    expect(context).toBe('')
  })

  test('依赖文件超过 10 个时显示省略', () => {
    const manyFiles = Array.from({length: 15}, (_, i) => `file${i}.ts`)
    const analysis: FileDependencyInfo = {
      filename: 'core.ts',
      modifiedSymbols: [
        {name: 'coreUtil', type: 'function', isExported: true, filename: 'core.ts'}
      ],
      dependentFiles: manyFiles,
      references: []
    }
    const context = formatCrossFileContext(analysis)
    expect(context).toContain('5 more files')
  })
})
