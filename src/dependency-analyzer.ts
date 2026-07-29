/**
 * dependency-analyzer.ts - 跨文件依赖分析模块
 *
 * 提供三个核心功能：
 * 1. 导入关系解析：通过正则表达式解析 import/require 语句，构建文件依赖图
 * 2. 修改符号提取：从 diff 中提取被修改的导出函数/变量名
 * 3. 引用搜索：在依赖文件中搜索对修改符号的引用
 *
 * 设计原则：
 * - 不引入 AST 库，使用正则覆盖 80%+ 的常见导入/导出模式
 * - 最小化 GitHub API 调用，优先使用已获取的文件内容
 * - 生成简洁的影响摘要，控制在 token 预算内
 *
 * 支持语言：TypeScript/JavaScript、Python、Go、Java
 */
import {info, warning} from '@actions/core'
import pLimit from 'p-limit'
import {scanPatch, type PatchScanMap} from './changed-lines'
import {octokit} from './octokit'
import {type Options} from './options'
import {
  type Language,
  type RepoTreeProject,
  detectLanguage,
  filterByExtension,
  getExtensionsForLanguage,
  resolveImportPath,
  sortByProximity
} from './repo-tree'

// ==================== 数据结构定义 ====================

/** 从 diff 中提取的被修改符号 */
export interface ModifiedSymbol {
  name: string             // 符号名称
  type: 'function' | 'class' | 'variable' | 'interface' | 'type' | 'enum'
  isExported: boolean      // 是否为导出符号
  filename: string         // 所在文件
}

/** 引用搜索结果 */
export interface SymbolReference {
  filename: string         // 引用方文件
  symbolName: string       // 被引用的符号名
  lineNumber: number       // 引用所在行号
  lineContent: string      // 引用所在行的内容（截断到 120 字符）
}

/** 导入关系信息 */
export interface ImportInfo {
  importPath: string       // 导入路径（原始值）
  importedSymbols: string[] // 导入的符号列表（原始名，用于匹配导出符号）
  aliasMap: Record<string, string> // 别名映射：originalName → localAlias（无别名时为空对象）
  isDefault: boolean       // 是否为默认导入
  isNamespace: boolean     // 是否为命名空间导入（import * as X）
}

/** 单个文件的依赖分析结果 */
export interface FileDependencyInfo {
  filename: string                   // 被分析的文件
  modifiedSymbols: ModifiedSymbol[]  // 该文件中被修改的导出符号
  dependentFiles: string[]           // 依赖该文件的其他文件列表
  references: SymbolReference[]      // 其他文件中对修改符号的引用
}

/** 完整的依赖分析上下文 */
export interface DependencyContext {
  fileAnalyses: Map<string, FileDependencyInfo>
}

// ==================== Vue SFC 解析 ====================

/**
 * 从 Vue 单文件组件中提取 <script> 块内容
 *
 * 处理 <script>、<script setup>、<script lang="ts"> 等各种变体。
 * Vue 3 允许同时存在 <script> 和 <script setup>，本函数拼接所有 script 块。
 *
 * @param content - .vue 文件完整内容
 * @returns 所有 script 块的内容拼接
 */
export function extractVueScriptContent(content: string): string {
  const scriptBlocks: string[] = []
  const scriptRe = /<script\b[^>]*>([\s\S]*?)<\/script>/gi
  let match
  while ((match = scriptRe.exec(content)) !== null) {
    scriptBlocks.push(match[1])
  }
  return scriptBlocks.join('\n')
}

// ==================== 导入解析（正则） ====================

/**
 * 解析文件中的导入语句
 *
 * 支持 TS/JS、Python、Go、Java 的常见导入模式。
 * 对 .vue 文件，先提取 <script> 块内容再解析。
 * 返回每个导入语句的路径和导入符号。
 *
 * @param content - 文件内容
 * @param filename - 文件路径（用于检测语言）
 * @returns 导入信息列表
 */
export function parseImports(
  content: string,
  filename: string
): ImportInfo[] {
  const language = detectLanguage(filename)

  // 对 .vue 文件，先提取 script 块内容
  let effectiveContent = content
  if (filename.endsWith('.vue')) {
    effectiveContent = extractVueScriptContent(content)
    if (effectiveContent.trim().length === 0) return []
  }

  switch (language) {
    case 'typescript':
      return parseTsImports(effectiveContent)
    case 'python':
      return parsePyImports(effectiveContent)
    case 'go':
      return parseGoImports(effectiveContent)
    case 'java':
      return parseJavaImports(effectiveContent)
    default:
      return []
  }
}

/**
 * 解析 TypeScript/JavaScript 导入语句
 *
 * 覆盖模式：
 * - import { foo, bar } from './module'
 * - import foo from './module'
 * - import * as foo from './module'
 * - const { foo } = require('./module')
 * - const foo = require('./module')
 * - export { foo } from './module'（re-export）
 */
function parseTsImports(content: string): ImportInfo[] {
  const imports: ImportInfo[] = []

  // import { foo, bar } from './module'（排除 import type { ... }）
  // import { foo as bar } from './module' → importedSymbols: ['foo'], aliasMap: { foo: 'bar' }
  const namedImportRe = /import\s+(?!type\s)\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g
  let match
  while ((match = namedImportRe.exec(content)) !== null) {
    const aliasMap: Record<string, string> = {}
    const symbols = match[1]
      .split(',')
      .map(s => {
        const parts = s.trim().split(/\s+as\s+/)
        const original = parts[0].trim()
        if (parts.length > 1) {
          aliasMap[original] = parts[1].trim()
        }
        return original
      })
      .filter(s => s.length > 0)
    imports.push({
      importPath: match[2],
      importedSymbols: symbols,
      aliasMap,
      isDefault: false,
      isNamespace: false
    })
  }

  // import foo from './module'（排除 import type X from）
  const defaultImportRe =
    /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g
  while ((match = defaultImportRe.exec(content)) !== null) {
    // 跳过 import type X from '...'（type 被捕获为符号名）
    if (match[1] === 'type') continue
    imports.push({
      importPath: match[2],
      importedSymbols: [match[1]],
      aliasMap: {},
      isDefault: true,
      isNamespace: false
    })
  }

  // import * as foo from './module'
  const namespaceImportRe =
    /import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g
  while ((match = namespaceImportRe.exec(content)) !== null) {
    imports.push({
      importPath: match[2],
      importedSymbols: [match[1]],
      aliasMap: {},
      isDefault: false,
      isNamespace: true
    })
  }

  // const { foo, bar } = require('./module')
  // const { foo: bar } = require('./module') → importedSymbols: ['foo'], aliasMap: { foo: 'bar' }
  const destructuredRequireRe =
    /(?:const|let|var)\s+\{([^}]+)\}\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  while ((match = destructuredRequireRe.exec(content)) !== null) {
    const aliasMap: Record<string, string> = {}
    const symbols = match[1]
      .split(',')
      .map(s => {
        const parts = s.trim().split(/\s*:\s*/)
        const original = parts[0].trim()
        if (parts.length > 1) {
          aliasMap[original] = parts[1].trim()
        }
        return original
      })
      .filter(s => s.length > 0)
    imports.push({
      importPath: match[2],
      importedSymbols: symbols,
      aliasMap,
      isDefault: false,
      isNamespace: false
    })
  }

  // const foo = require('./module')
  const simpleRequireRe =
    /(?:const|let|var)\s+(\w+)\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  while ((match = simpleRequireRe.exec(content)) !== null) {
    imports.push({
      importPath: match[2],
      importedSymbols: [match[1]],
      aliasMap: {},
      isDefault: true,
      isNamespace: false
    })
  }

  // export { foo, bar } from './module'（re-export，排除 export type { ... }）
  // export { foo as bar } from './module' → importedSymbols: ['foo'], aliasMap: { foo: 'bar' }
  const reExportRe = /export\s+(?!type\s)\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g
  while ((match = reExportRe.exec(content)) !== null) {
    const aliasMap: Record<string, string> = {}
    const symbols = match[1]
      .split(',')
      .map(s => {
        const parts = s.trim().split(/\s+as\s+/)
        const original = parts[0].trim()
        if (parts.length > 1) {
          aliasMap[original] = parts[1].trim()
        }
        return original
      })
      .filter(s => s.length > 0)
    imports.push({
      importPath: match[2],
      importedSymbols: symbols,
      aliasMap,
      isDefault: false,
      isNamespace: false
    })
  }

  // export * from './module'（通配符 re-export）
  const exportStarRe = /export\s+\*\s+from\s+['"]([^'"]+)['"]/g
  while ((match = exportStarRe.exec(content)) !== null) {
    imports.push({
      importPath: match[1],
      importedSymbols: [],
      aliasMap: {},
      isDefault: false,
      isNamespace: true
    })
  }

  // 动态 import()：import('./module') / import("./module")
  // 覆盖场景：defineAsyncComponent(() => import('./Comp.vue'))、路由懒加载等
  const dynamicImportRe = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  while ((match = dynamicImportRe.exec(content)) !== null) {
    imports.push({
      importPath: match[1],
      importedSymbols: [],
      aliasMap: {},
      isDefault: true,
      isNamespace: false
    })
  }

  return imports
}

/**
 * 解析 Python 导入语句
 *
 * 覆盖模式：
 * - from module import foo, bar
 * - from module import (foo, bar)
 * - import module
 */
function parsePyImports(content: string): ImportInfo[] {
  const imports: ImportInfo[] = []
  let match

  // from module import foo, bar（支持多行括号形式）
  // from module import foo as bar → importedSymbols: ['foo'], aliasMap: { foo: 'bar' }
  const fromImportRe = /from\s+([\w.]+)\s+import\s+\(([^)]+)\)|from\s+([\w.]+)\s+import\s+([^(\n]+)/g
  while ((match = fromImportRe.exec(content)) !== null) {
    // 分组1+2 = 括号形式, 分组3+4 = 单行形式
    const modulePath = match[1] ?? match[3]
    const symbolsStr = match[2] ?? match[4]

    // 将 Python 点式相对导入转换为路径表示法
    // .utils → ./utils, ..shared → ../shared, ..shared.helpers → ../shared/helpers
    let importPath = modulePath
    const dotMatch = modulePath.match(/^(\.+)(.*)$/)
    if (dotMatch) {
      const dots = dotMatch[1].length
      const rest = dotMatch[2]
      if (!rest) {
        // from . import foo → 当前目录, from .. import foo → 父目录
        importPath = dots === 1 ? '.' : Array(dots - 1).fill('..').join('/')
      } else {
        const prefix = dots === 1 ? './' : '../'.repeat(dots - 1)
        importPath = prefix + rest.replace(/\./g, '/')
      }
    }

    const aliasMap: Record<string, string> = {}
    const symbols = symbolsStr
      .split(',')
      .map(s => {
        const parts = s.trim().split(/\s+as\s+/)
        const original = parts[0].trim()
        if (parts.length > 1) {
          aliasMap[original] = parts[1].trim()
        }
        return original
      })
      .filter(s => s.length > 0 && s !== '*')
    imports.push({
      importPath,
      importedSymbols: symbols,
      aliasMap,
      isDefault: false,
      isNamespace: symbols.length === 0
    })
  }

  // import module / import module as alias
  const simpleImportRe = /^import\s+([\w.]+)(?:\s+as\s+(\w+))?$/gm
  while ((match = simpleImportRe.exec(content)) !== null) {
    const moduleName = match[1].split('.').pop() ?? match[1]
    const aliasMap: Record<string, string> = {}
    if (match[2]) {
      aliasMap[moduleName] = match[2]
    }
    imports.push({
      importPath: match[1],
      importedSymbols: [moduleName],
      aliasMap,
      isDefault: false,
      isNamespace: true
    })
  }

  return imports
}

/**
 * 解析 Go 导入语句
 *
 * 覆盖模式：
 * - import "package"
 * - import ( "pkg1" \n "pkg2" )
 * - import alias "package"
 */
function parseGoImports(content: string): ImportInfo[] {
  const imports: ImportInfo[] = []
  let match

  // 分组 import ( ... ) —— 先处理分组导入，记录其范围以避免单行重复匹配
  const groupRanges: Array<[number, number]> = []
  const groupImportRe = /import\s*\(([\s\S]*?)\)/g
  while ((match = groupImportRe.exec(content)) !== null) {
    groupRanges.push([match.index, match.index + match[0].length])
    const block = match[1]
    const lineRe = /(?:(\w+)\s+)?"([^"]+)"/g
    let lineMatch
    while ((lineMatch = lineRe.exec(block)) !== null) {
      const alias = lineMatch[1] ?? lineMatch[2].split('/').pop() ?? ''
      imports.push({
        importPath: lineMatch[2],
        importedSymbols: [alias],
        aliasMap: {},
        isDefault: false,
        isNamespace: true
      })
    }
  }

  // 单行 import "package" 或 import alias "package"（跳过已被分组匹配的范围）
  const singleImportRe = /import\s+(?:(\w+)\s+)?"([^"]+)"/g
  while ((match = singleImportRe.exec(content)) !== null) {
    const pos = match.index
    const inGroup = groupRanges.some(([s, e]) => pos >= s && pos < e)
    if (inGroup) continue
    const alias = match[1] ?? match[2].split('/').pop() ?? ''
    imports.push({
      importPath: match[2],
      importedSymbols: [alias],
      aliasMap: {},
      isDefault: false,
      isNamespace: true
    })
  }

  return imports
}

/**
 * 解析 Java 导入语句
 *
 * 覆盖模式：
 * - import com.pkg.Class;
 * - import static com.pkg.Class.method;
 */
function parseJavaImports(content: string): ImportInfo[] {
  const imports: ImportInfo[] = []
  let match

  const javaImportRe = /import\s+(?:static\s+)?([a-zA-Z0-9_.]+(?:\.\*)?)\s*;/g
  while ((match = javaImportRe.exec(content)) !== null) {
    const fullPath = match[1]
    const parts = fullPath.split('.')
    const symbol = parts[parts.length - 1]
    imports.push({
      importPath: fullPath,
      importedSymbols: [symbol],
      aliasMap: {},
      isDefault: false,
      isNamespace: symbol === '*'
    })
  }

  return imports
}

// ==================== 修改符号提取 ====================

/**
 * 从 diff 中提取被修改的导出符号
 *
 * 仅分析 diff 的新增行（以 + 开头），识别被修改或新增的导出声明。
 * 同时检查删除行（以 - 开头），识别被删除的导出符号。
 *
 * @param filename - 文件路径
 * @param fileDiff - 文件的 unified diff
 * @returns 被修改的符号列表
 */
export function extractModifiedSymbols(
  filename: string,
  fileDiff: string
): ModifiedSymbol[] {
  const language = detectLanguage(filename)
  const symbols: ModifiedSymbol[] = []
  const seen = new Set<string>()

  const lines = fileDiff.split('\n')

  // 对 .vue 文件，追踪是否在 <script> 块内
  const isVue = filename.endsWith('.vue')
  let inScriptBlock = !isVue // 非 vue 文件始终视为在 script 块内

  // 追踪当前 hunk 的上下文函数（从 @@ 行的尾部提取）
  // 当 diff 修改了导出函数内部代码时，函数声明行不在 +/- 行中，
  // 但 git diff 会在 @@ 行尾部显示所在的函数上下文
  let currentHunkContext: string | null = null
  let hunkHasChanges = false

  for (const line of lines) {
    // 解析 @@ hunk 头：@@ -start,count +start,count @@ context
    if (line.startsWith('@@')) {
      // 先处理上一个 hunk 的上下文函数
      if (hunkHasChanges && currentHunkContext != null) {
        addHunkContextSymbol(language, currentHunkContext, symbols, seen, filename)
      }
      const hunkMatch = line.match(/^@@[^@]*@@\s*(.*)$/)
      currentHunkContext = hunkMatch?.[1]?.trim() || null
      hunkHasChanges = false
      continue
    }

    // 上下文行（无 +/-）：更新 .vue 的 script 块追踪状态
    if (!line.startsWith('+') && !line.startsWith('-')) {
      if (isVue) {
        if (/<script\b/i.test(line)) inScriptBlock = true
        if (/<\/script>/i.test(line)) inScriptBlock = false
      }
      continue
    }
    // 跳过 diff 头部行
    if (line.startsWith('+++') || line.startsWith('---')) continue

    hunkHasChanges = true
    const content = line.substring(1) // 去掉 +/- 前缀

    // 对 .vue 文件，追踪 diff 行中的 script 块边界
    if (isVue) {
      if (/<script\b/i.test(content)) {
        inScriptBlock = true
        continue
      }
      if (/<\/script>/i.test(content)) {
        inScriptBlock = false
        continue
      }
      if (!inScriptBlock) continue
    }
    let extracted: Array<{name: string; type: ModifiedSymbol['type']; isExported: boolean}> = []

    switch (language) {
      case 'typescript':
        extracted = extractTsSymbols(content)
        break
      case 'python':
        extracted = extractPySymbols(content)
        break
      case 'go':
        extracted = extractGoSymbols(content)
        break
      case 'java':
        extracted = extractJavaSymbols(content)
        break
    }

    for (const sym of extracted) {
      const key = `${sym.name}:${sym.type}`
      if (!seen.has(key)) {
        seen.add(key)
        symbols.push({...sym, filename})
      }
    }
  }

  // 处理最后一个 hunk 的上下文函数
  if (hunkHasChanges && currentHunkContext != null) {
    addHunkContextSymbol(language, currentHunkContext, symbols, seen, filename)
  }

  // Vue SFC 后处理：将 __vue_component__ 标记转换为文件名派生的组件名
  // defineProps/defineEmits 修改 → 组件接口变更 → 消费方通过组件名引用
  if (filename.endsWith('.vue')) {
    const hasComponentMarker = symbols.some(s => s.name === '__vue_component__')
    if (hasComponentMarker) {
      // 从文件名派生 PascalCase 组件名：components/HeavyChart.vue → HeavyChart
      const baseName = filename.substring(filename.lastIndexOf('/') + 1).replace('.vue', '')
      const componentName = baseName.charAt(0).toUpperCase() + baseName.slice(1)

      // 移除标记，替换为组件名
      const idx = symbols.findIndex(s => s.name === '__vue_component__')
      if (idx >= 0) symbols.splice(idx, 1)
      seen.delete('__vue_component__:variable')

      const key = `${componentName}:variable`
      if (!seen.has(key)) {
        seen.add(key)
        symbols.push({name: componentName, type: 'variable', isExported: true, filename})
      }
    }
  }

  return symbols
}

/**
 * 从 @@ hunk 上下文中提取包围的导出符号
 *
 * git diff 的 @@ 行尾部会显示变更所在的函数/类上下文，例如：
 *   @@ -30,3 +30,5 @@ export function useCart() {
 * 当修改发生在导出函数内部（如修改内部子函数），函数声明行本身不在 +/- 行中，
 * 但通过 hunk 上下文可以识别出该导出函数被修改。
 */
function addHunkContextSymbol(
  language: Language,
  hunkContext: string,
  symbols: ModifiedSymbol[],
  seen: Set<string>,
  filename: string
): void {
  // 仅对 TS/JS 和 Python、Go、Java 提取上下文中的导出符号
  let extracted: Array<{name: string; type: ModifiedSymbol['type']; isExported: boolean}> = []

  switch (language) {
    case 'typescript':
      extracted = extractTsSymbols(hunkContext)
      break
    case 'python':
      extracted = extractPySymbols(hunkContext)
      break
    case 'go':
      extracted = extractGoSymbols(hunkContext)
      break
    case 'java':
      extracted = extractJavaSymbols(hunkContext)
      break
  }

  // 仅添加导出符号（非导出的上下文函数不需要跟踪）
  for (const sym of extracted) {
    if (!sym.isExported) continue
    const key = `${sym.name}:${sym.type}`
    if (!seen.has(key)) {
      seen.add(key)
      symbols.push({...sym, filename})
    }
  }
}

/**
 * 回退策略：从文件内容中查找包含修改行的导出函数/类作用域
 *
 * 当 diff 中仅修改了导出函数内部代码（如子函数），extractModifiedSymbols
 * 可能无法从 diff 行中提取到导出符号。此函数解析文件内容，找到所有导出
 * 声明的行号，然后检查 diff hunk 的行范围是否落在某个导出作用域内。
 *
 * 作用域判断采用简化启发式：导出声明从其定义行开始，到下一个同级
 * 导出声明之前（或文件末尾）结束。
 *
 * @param touchedLines `+` 与 `-` 行的新文件行号集合（典型来自 `scanPatch().touchedLines`）。
 *                     传入 `Set<number>` 而非 fileDiff，避免对同一份 diff 重复 walk。
 *                     兼容旧调用：可以传入 fileDiff 字符串，函数会自动判别并扫描。
 */
export function findEnclosingExports(
  filename: string,
  fileContent: string,
  touchedLinesOrDiff: Set<number> | string
): ModifiedSymbol[] {
  // 兼容旧签名：第三参数是 fileDiff 字符串时，就地扫描得到 touchedLines
  const touchedLines: Set<number> =
    typeof touchedLinesOrDiff === 'string'
      ? scanPatch(touchedLinesOrDiff).touchedLines
      : touchedLinesOrDiff

  const language = detectLanguage(filename)

  // 对 .vue 文件提取 script 块
  let content = fileContent
  let lineOffset = 0
  if (filename.endsWith('.vue')) {
    const scriptMatch = fileContent.match(/<script\b[^>]*>/)
    if (scriptMatch && scriptMatch.index != null) {
      const beforeScript = fileContent.substring(0, scriptMatch.index + scriptMatch[0].length)
      lineOffset = beforeScript.split('\n').length - 1
    }
    content = extractVueScriptContent(fileContent)
    if (content.trim().length === 0) return []
  }

  const lines = content.split('\n')

  // 1. 扫描文件内容，找到所有导出声明及其行号
  const exportDeclarations: Array<{
    name: string
    type: ModifiedSymbol['type']
    line: number // 基于原始文件的行号（1-based）
  }> = []

  for (let i = 0; i < lines.length; i++) {
    let extracted: Array<{name: string; type: ModifiedSymbol['type']; isExported: boolean}> = []
    switch (language) {
      case 'typescript':
        extracted = extractTsSymbols(lines[i])
        break
      case 'python':
        extracted = extractPySymbols(lines[i])
        break
      case 'go':
        extracted = extractGoSymbols(lines[i])
        break
      case 'java':
        extracted = extractJavaSymbols(lines[i])
        break
    }
    for (const sym of extracted) {
      if (sym.isExported) {
        exportDeclarations.push({
          name: sym.name,
          type: sym.type,
          line: i + 1 + lineOffset
        })
      }
    }
  }

  if (exportDeclarations.length === 0) return []

  // 2. 修改行集合 (touchedLines) 由调用方传入；避免对同一份 diff 重复 walk
  const modifiedLines = touchedLines

  // 3. 为每个导出声明估算作用域范围（到下一个导出声明之前）
  // 然后检查是否有实际修改行落在该范围内
  const results: ModifiedSymbol[] = []
  const seen = new Set<string>()

  for (let i = 0; i < exportDeclarations.length; i++) {
    const decl = exportDeclarations[i]
    const scopeStart = decl.line
    const scopeEnd = i + 1 < exportDeclarations.length
      ? exportDeclarations[i + 1].line - 1
      : Infinity

    // 检查是否有实际修改行在此导出的作用域内
    let hasModifiedLine = false
    for (const lineNo of modifiedLines) {
      if (lineNo >= scopeStart && lineNo <= scopeEnd) {
        hasModifiedLine = true
        break
      }
    }
    if (hasModifiedLine) {
      const key = `${decl.name}:${decl.type}`
      if (!seen.has(key)) {
        seen.add(key)
        results.push({
          name: decl.name,
          type: decl.type,
          isExported: true,
          filename
        })
      }
    }
  }

  return results
}

/** 从 TS/JS 代码行提取导出符号 */
function extractTsSymbols(
  line: string
): Array<{name: string; type: ModifiedSymbol['type']; isExported: boolean}> {
  const results: Array<{name: string; type: ModifiedSymbol['type']; isExported: boolean}> = []
  const trimmed = line.trim()

  // export function foo( / export async function foo(
  let m = trimmed.match(/^export\s+(?:async\s+)?function\s+(\w+)/)
  if (m) {
    results.push({name: m[1], type: 'function', isExported: true})
    return results
  }

  // export const/let/var foo =
  m = trimmed.match(/^export\s+(?:const|let|var)\s+(\w+)/)
  if (m) {
    results.push({name: m[1], type: 'variable', isExported: true})
    return results
  }

  // export class Foo
  m = trimmed.match(/^export\s+(?:abstract\s+)?class\s+(\w+)/)
  if (m) {
    results.push({name: m[1], type: 'class', isExported: true})
    return results
  }

  // export interface Foo
  m = trimmed.match(/^export\s+interface\s+(\w+)/)
  if (m) {
    results.push({name: m[1], type: 'interface', isExported: true})
    return results
  }

  // export type Foo
  m = trimmed.match(/^export\s+type\s+(\w+)/)
  if (m) {
    results.push({name: m[1], type: 'type', isExported: true})
    return results
  }

  // export enum Foo
  m = trimmed.match(/^export\s+enum\s+(\w+)/)
  if (m) {
    results.push({name: m[1], type: 'enum', isExported: true})
    return results
  }

  // export default function/class
  m = trimmed.match(/^export\s+default\s+(?:function|class)\s+(\w+)/)
  if (m) {
    results.push({name: m[1], type: 'function', isExported: true})
    return results
  }

  // module.exports.foo = / exports.foo =
  m = trimmed.match(/^(?:module\.)?exports\.(\w+)\s*=/)
  if (m) {
    results.push({name: m[1], type: 'variable', isExported: true})
    return results
  }

  // Vue <script setup> 编译器宏
  // defineProps / defineEmits 修改意味着组件接口变更。
  // 提取为特殊标记 __vue_component__，由 extractModifiedSymbols 转换为组件名。
  if (trimmed.match(/^(?:const\s+\w+\s*=\s*)?define(?:Props|Emits)/)) {
    results.push({name: '__vue_component__', type: 'variable', isExported: true})
    return results
  }

  // defineExpose({ foo, bar }) — 显式暴露的绑定
  m = trimmed.match(/^defineExpose\s*\(\s*\{([^}]*)/)
  if (m) {
    const exposed = m[1]
      .split(',')
      .map(s => s.trim().split(/\s*:/)[0].trim())
      .filter(s => s.length > 0)
    for (const name of exposed) {
      results.push({name, type: 'variable', isExported: true})
    }
    return results
  }

  return results
}

/** 从 Python 代码行提取顶层符号（Python 顶层定义视为导出） */
function extractPySymbols(
  line: string
): Array<{name: string; type: ModifiedSymbol['type']; isExported: boolean}> {
  const results: Array<{name: string; type: ModifiedSymbol['type']; isExported: boolean}> = []

  // def foo( / async def foo(
  let m = line.match(/^(?:async\s+)?def\s+(\w+)/)
  if (m && !m[1].startsWith('_')) {
    results.push({name: m[1], type: 'function', isExported: true})
    return results
  }

  // class Foo
  m = line.match(/^class\s+(\w+)/)
  if (m && !m[1].startsWith('_')) {
    results.push({name: m[1], type: 'class', isExported: true})
    return results
  }

  return results
}

/** 从 Go 代码行提取导出符号（大写开头的函数/类型为导出） */
function extractGoSymbols(
  line: string
): Array<{name: string; type: ModifiedSymbol['type']; isExported: boolean}> {
  const results: Array<{name: string; type: ModifiedSymbol['type']; isExported: boolean}> = []
  const trimmed = line.trim()

  // func FunctionName( 或 func (r *Receiver) MethodName(
  let m = trimmed.match(/^func\s+(?:\([^)]*\)\s+)?([A-Z]\w*)/)
  if (m) {
    results.push({name: m[1], type: 'function', isExported: true})
    return results
  }

  // type TypeName struct/interface
  m = trimmed.match(/^type\s+([A-Z]\w+)\s+(?:struct|interface)/)
  if (m) {
    results.push({name: m[1], type: 'class', isExported: true})
    return results
  }

  return results
}

/** 从 Java 代码行提取公共符号 */
function extractJavaSymbols(
  line: string
): Array<{name: string; type: ModifiedSymbol['type']; isExported: boolean}> {
  const results: Array<{name: string; type: ModifiedSymbol['type']; isExported: boolean}> = []
  const trimmed = line.trim()

  // public class/interface/enum ClassName
  let m = trimmed.match(
    /^(?:public|protected)\s+(?:static\s+)?(?:abstract\s+)?(?:final\s+)?(?:class|interface|enum)\s+(\w+)/
  )
  if (m) {
    results.push({name: m[1], type: 'class', isExported: true})
    return results
  }

  // public ReturnType methodName(
  m = trimmed.match(
    /^(?:public|protected)\s+(?:static\s+)?(?:final\s+)?(?:synchronized\s+)?(?:\w+(?:<[^>]*>)?)\s+(\w+)\s*\(/
  )
  if (m && m[1] !== 'if' && m[1] !== 'for' && m[1] !== 'while') {
    results.push({name: m[1], type: 'function', isExported: true})
    return results
  }

  return results
}

// ==================== 引用搜索 ====================

/**
 * 在文件内容中搜索对指定符号的引用
 *
 * 使用词边界匹配（\b），排除注释行中的匹配。
 * 每个引用保留行号和行内容（截断到 120 字符），用于上下文展示。
 *
 * @param filename - 搜索目标文件路径
 * @param content - 文件内容
 * @param symbolNames - 要搜索的符号名列表
 * @param maxRefsPerSymbol - 每个符号最多返回的引用数（默认 5）
 * @returns 引用列表
 */
// 正则缓存：避免对同一符号重复编译正则
const regexCache = new Map<string, RegExp>()
function getSymbolRegex(symbolName: string): RegExp {
  let regex = regexCache.get(symbolName)
  if (regex == null) {
    regex = new RegExp(`\\b${escapeRegex(symbolName)}\\b`)
    regexCache.set(symbolName, regex)
  }
  return regex
}

export function findReferencesInContent(
  filename: string,
  content: string,
  symbolNames: string[],
  maxRefsPerSymbol = 5
): SymbolReference[] {
  const references: SymbolReference[] = []
  const lines = content.split('\n')

  // 预处理：标记 export { ... } from 和 import { ... } from 多行块中的行号
  // 这些行只是 re-export/import 声明，不是真正的引用
  const skipLines = new Set<number>()
  let inExportImportBlock = false
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    // 检测多行 export { / import { 块的开始
    if (
      (trimmed.startsWith('export {') || trimmed.startsWith('export type {') ||
       trimmed.startsWith('import {') || trimmed.startsWith('import type {')) &&
      !trimmed.includes('}')
    ) {
      inExportImportBlock = true
      skipLines.add(i)
      continue
    }
    if (inExportImportBlock) {
      skipLines.add(i)
      if (trimmed.includes('}')) {
        inExportImportBlock = false
      }
      continue
    }
    // 单行 export { ... } from / export * from（re-export）
    if (
      trimmed.startsWith('export {') ||
      trimmed.startsWith('export *') ||
      trimmed.startsWith('export type {')
    ) {
      skipLines.add(i)
    }
  }

  for (const symbolName of symbolNames) {
    const regex = getSymbolRegex(symbolName)
    let refCount = 0

    for (let i = 0; i < lines.length; i++) {
      if (refCount >= maxRefsPerSymbol) break

      // 跳过 export/import 块中的行（re-export 不算引用）
      if (skipLines.has(i)) continue

      const line = lines[i]
      // 跳过注释行（启发式：行首为 //, #, /*, * 的行）
      const trimmedLine = line.trim()
      if (
        trimmedLine.startsWith('//') ||
        trimmedLine.startsWith('#') ||
        trimmedLine.startsWith('/*') ||
        trimmedLine.startsWith('*') ||
        trimmedLine.startsWith('"""') ||
        trimmedLine.startsWith("'''")
      ) {
        continue
      }

      // 跳过 import/from 行（导入行不算"引用"）
      if (
        trimmedLine.startsWith('import ') ||
        trimmedLine.startsWith('from ') ||
        trimmedLine.match(/^(?:const|let|var)\s+.*=\s*require\s*\(/)
      ) {
        continue
      }

      if (regex.test(line)) {
        references.push({
          filename,
          symbolName,
          lineNumber: i + 1,
          lineContent: line.trim().substring(0, 120)
        })
        refCount++
      }
    }
  }

  return references
}

/** 转义正则特殊字符 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ==================== 依赖图辅助 ====================

/** 依赖图条目类型 */
type DepEntry = {file: string; symbols: string[]; aliasMap: Record<string, string>; defaultImportName: string | null; namespaceName: string | null}

/** 合并或新增依赖条目（去重 + 合并符号、别名、default/namespace 信息） */
function mergeDep(deps: DepEntry[], file: string, imp: ImportInfo): void {
  const existing = deps.find(d => d.file === file)
  if (existing != null) {
    for (const s of imp.importedSymbols) {
      if (!existing.symbols.includes(s)) existing.symbols.push(s)
    }
    Object.assign(existing.aliasMap, imp.aliasMap)
    if (imp.isDefault && existing.defaultImportName == null) {
      existing.defaultImportName = imp.importedSymbols[0] ?? null
    }
    if (imp.isNamespace && existing.namespaceName == null) {
      existing.namespaceName = imp.importedSymbols[0] ?? null
    }
  } else {
    deps.push({
      file,
      symbols: [...imp.importedSymbols],
      aliasMap: {...imp.aliasMap},
      defaultImportName: imp.isDefault ? imp.importedSymbols[0] ?? null : null,
      namespaceName: imp.isNamespace ? imp.importedSymbols[0] ?? null : null
    })
  }
}

/**
 * 检测文件是否包含指向目标文件的 re-export 语句
 * （用于 barrel file 识别）
 */
function hasReExportFrom(
  content: string,
  sourceFile: string,
  targetFile: string,
  repoFilesSet: Set<string>
): boolean {
  const reExportRe = /export\s+(?:\{[^}]*\}|\*)\s+from\s+['"]([^'"]+)['"]/g
  let match
  while ((match = reExportRe.exec(content)) !== null) {
    const resolved = resolveImportPath(sourceFile, match[1], repoFilesSet)
    if (resolved === targetFile) return true
  }
  return false
}

// ==================== 依赖分析编排 ====================

/**
 * 执行完整的跨文件依赖分析
 *
 * 流程：
 * 1. 从 diff 中提取每个修改文件的导出符号
 * 2. 获取仓库文件树，按语言过滤候选依赖文件
 * 3. 并行获取候选文件内容
 * 4. 解析每个候选文件的导入语句，构建依赖图
 * 5. 在依赖文件中搜索修改符号的引用
 *
 * @param filesAndChanges - PR 中的文件变更列表 [filename, fileContent, fileDiff, patches]
 * @param repoFiles - 仓库文件树
 * @param options - 全局配置
 * @param githubConcurrencyLimit - GitHub API 并发限制器
 * @param patchScans - （可选）由 review.ts 预先扫描的 PatchScanMap。
 *   传入后避免对每个 fileDiff 重新 walk 提取 modifiedLines。
 *   未传入时会按需就地扫描（兼容直接调用此函数的单元测试与早期调用方）。
 * @returns 完整的依赖分析上下文
 */
export async function analyzeDependencies(
  filesAndChanges: Array<[string, string, string, Array<[number, number, string]>]>,
  repoFiles: string[],
  options: Options,
  githubConcurrencyLimit: ReturnType<typeof pLimit>,
  project: RepoTreeProject,
  headSha: string,
  patchScans?: PatchScanMap
): Promise<DependencyContext> {
  const fileAnalyses = new Map<string, FileDependencyInfo>()

  // 空文件树时跳过分析（getRepoFileTree 失败返回空数组）
  if (repoFiles.length === 0) {
    warning('dependency analysis: repo file tree is empty, skipping analysis')
    return {fileAnalyses}
  }

  // ===== 步骤 1: 提取所有修改文件的导出符号 =====
  info(`dependency analysis [step 1]: analyzing ${filesAndChanges.length} modified files for exported symbols`)
  const modifiedFileNames = filesAndChanges.map(([f]) => f)
  const allModifiedSymbols = new Map<string, ModifiedSymbol[]>()

  for (const [filename, fileContent, fileDiff] of filesAndChanges) {
    const symbols = extractModifiedSymbols(filename, fileDiff)
    const allSymbols = symbols.length
    let exportedSymbols = symbols.filter(s => s.isExported)

    // 补充策略：始终解析文件内容，查找包含修改行的导出函数/类作用域
    // 当修改发生在导出函数内部时，diff 行中不包含 export 声明，
    // 需要通过文件内容 + hunk 行号范围来识别受影响的导出
    if (fileContent.length > 0) {
      // 优先复用预扫描的 touchedLines；缺失时就地 walk
      const touchedLines =
        patchScans?.get(filename)?.touchedLines ??
        scanPatch(fileDiff).touchedLines
      const enclosingExports = findEnclosingExports(
        filename,
        fileContent,
        touchedLines
      )
      for (const sym of enclosingExports) {
        if (!exportedSymbols.some(s => s.name === sym.name && s.type === sym.type)) {
          exportedSymbols.push(sym)
          info(
            `dependency analysis [step 1]: ${filename} → enclosing export detected: ${sym.name}(${sym.type})`
          )
        }
      }
    }

    if (exportedSymbols.length > 0) {
      allModifiedSymbols.set(filename, exportedSymbols)
      info(
        `dependency analysis [step 1]: ${filename} → ${exportedSymbols.length} exported / ${allSymbols} total symbols: [${exportedSymbols.map(s => `${s.name}(${s.type})`).join(', ')}]`
      )
    } else {
      info(
        `dependency analysis [step 1]: ${filename} → no modified exports (${allSymbols} internal symbols), skipping`
      )
    }
  }

  // 如果没有修改任何导出符号，跳过后续分析
  if (allModifiedSymbols.size === 0) {
    info(`dependency analysis [step 1]: ✓ no modified exports found across all files, skipping dependency scan (saved ~${options.maxDependencyFiles} API calls)`)
    return {fileAnalyses}
  }

  // ===== 步骤 1.5: 智能过滤 — 排除不太可能被导入的文件 =====
  // 入口文件和测试文件通常不会被其他模块导入，跳过分析可节省大量 API 调用
  const preFilterCount = allModifiedSymbols.size
  const filesToRemove: string[] = []
  for (const [filename] of allModifiedSymbols) {
    if (isEntryPointFile(filename)) {
      info(
        `dependency analysis [step 1.5]: ✗ skipping ${filename} (entry point file — imports others but is not imported)`
      )
      filesToRemove.push(filename)
    } else if (isTestFile(filename)) {
      info(
        `dependency analysis [step 1.5]: ✗ skipping ${filename} (test file — not imported by production code)`
      )
      filesToRemove.push(filename)
    }
  }
  for (const f of filesToRemove) {
    allModifiedSymbols.delete(f)
  }

  if (allModifiedSymbols.size === 0) {
    info(
      `dependency analysis [step 1.5]: ✓ all ${preFilterCount} files with modified exports are entry/test files, skipping dependency scan`
    )
    return {fileAnalyses}
  }
  if (preFilterCount !== allModifiedSymbols.size) {
    info(
      `dependency analysis [step 1.5]: filtered ${preFilterCount} → ${allModifiedSymbols.size} files (removed ${preFilterCount - allModifiedSymbols.size} entry/test files)`
    )
  }

  // ===== 步骤 2: 获取 PR 内文件的 head 版本内容并分析导入关系 =====
  // 注意：filesAndChanges 中的 fileContent 是 base 分支版本，不能用于解析当前导入
  // 需要获取 head 版本以准确检测 PR 内文件是否导入了被修改的文件
  const dependencyGraph = new Map<string, Array<{file: string; symbols: string[]; aliasMap: Record<string, string>; defaultImportName: string | null; namespaceName: string | null}>>()
  const fileContents = new Map<string, string>()
  const repoFilesSet = new Set(repoFiles)

  for (const [modifiedFile] of allModifiedSymbols) {
    dependencyGraph.set(modifiedFile, [])
  }

  // 并行获取 PR 内非自身文件的 head 版本内容
  const prCandidates = filesAndChanges
    .map(([f]) => f)
    .filter(f => !allModifiedSymbols.has(f))

  const prFetchPromises = prCandidates.map(f =>
    githubConcurrencyLimit(async () => {
      try {
        const response = await octokit.repos.getContent({
          owner: project.owner,
          repo: project.repo,
          path: f,
          ref: headSha
        })
        const data = response.data as {content?: string; encoding?: string}
        if (data.content && data.encoding === 'base64') {
          fileContents.set(f, Buffer.from(data.content, 'base64').toString())
        }
      } catch {
        // 获取失败静默跳过（新文件可能不在 head 上）
      }
    })
  )
  await Promise.all(prFetchPromises)

  let prInternalHits = 0
  for (const candidateFile of prCandidates) {
    const content = fileContents.get(candidateFile)
    if (content == null || content.length === 0) continue

    const imports = parseImports(content, candidateFile)
    for (const imp of imports) {
      const resolvedPath = resolveImportPath(
        candidateFile,
        imp.importPath,
        repoFilesSet
      )
      if (resolvedPath != null && allModifiedSymbols.has(resolvedPath)) {
        const deps = dependencyGraph.get(resolvedPath) ?? []
        // 去重：同一文件多次 import 同一模块时合并符号和别名
        mergeDep(deps, candidateFile, imp)
        dependencyGraph.set(resolvedPath, deps)
        prInternalHits++
        info(
          `dependency analysis [step 2]: ✓ PR-internal hit: ${candidateFile} imports {${imp.importedSymbols.join(', ')}} from ${resolvedPath}`
        )
      }
    }
  }
  info(
    `dependency analysis [step 2]: PR-internal scan complete — ${prInternalHits} import relationships found (${prCandidates.length} API calls for head content)`
  )

  // ===== 步骤 3: 确定需要扫描的外部候选文件 =====
  // 收集所有修改文件的语言，获取对应扩展名
  const languages = new Set<Language>()
  for (const [filename] of allModifiedSymbols) {
    languages.add(detectLanguage(filename))
  }

  let extensions: string[] = []
  for (const lang of languages) {
    extensions = extensions.concat(getExtensionsForLanguage(lang))
  }

  // 按扩展名过滤仓库文件，排除 PR 中已处理的文件和测试文件
  const modifiedFileSet = new Set(modifiedFileNames)
  const prCandidatesSet = new Set(prCandidates)
  let candidateFiles = filterByExtension(repoFiles, extensions).filter(
    f => !modifiedFileSet.has(f) && !prCandidatesSet.has(f) && !isTestFile(f)
  )

  // 使用 pathFilters 排除不需要的文件（直接调用 pathFilters.check 避免逐文件日志）
  candidateFiles = candidateFiles.filter(f => options.pathFilters.check(f))

  // 按与修改文件的距离排序，优先分析同目录文件
  candidateFiles = sortByProximity(candidateFiles, modifiedFileNames)

  // 限制最大扫描文件数
  const maxFiles = options.maxDependencyFiles
  if (candidateFiles.length > maxFiles) {
    info(
      `dependency analysis: limiting candidate files from ${candidateFiles.length} to ${maxFiles}`
    )
    candidateFiles = candidateFiles.slice(0, maxFiles)
  }

  info(
    `dependency analysis [step 3]: scanning ${candidateFiles.length} external candidate files (API calls needed: ${candidateFiles.length})`
  )

  // ===== 步骤 4: 并行获取外部候选文件内容 =====
  const fetchPromises = candidateFiles.map(f =>
    githubConcurrencyLimit(async () => {
      try {
        const response = await octokit.repos.getContent({
          owner: project.owner,
          repo: project.repo,
          path: f,
          ref: headSha
        })
        const data = response.data as {content?: string; encoding?: string}
        if (data.content && data.encoding === 'base64') {
          const content = Buffer.from(data.content, 'base64').toString()
          fileContents.set(f, content)
        }
      } catch {
        // 获取失败的文件静默跳过
      }
    })
  )

  await Promise.all(fetchPromises)
  info(
    `dependency analysis [step 4]: fetched ${candidateFiles.length} external file contents (${fileContents.size} total in cache including ${prCandidates.length} PR files from step 2)`
  )

  // ===== 步骤 5: 解析外部文件的导入语句，扩充依赖图 =====
  const prFileSet = new Set(filesAndChanges.map(([f]) => f))
  let externalHits = 0
  for (const [candidateFile, content] of fileContents) {
    // PR 内文件已在步骤 2 处理，跳过
    if (prFileSet.has(candidateFile)) continue

    const imports = parseImports(content, candidateFile)

    for (const imp of imports) {
      const resolvedPath = resolveImportPath(
        candidateFile,
        imp.importPath,
        repoFilesSet
      )

      if (resolvedPath != null && allModifiedSymbols.has(resolvedPath)) {
        const deps = dependencyGraph.get(resolvedPath) ?? []
        mergeDep(deps, candidateFile, imp)
        dependencyGraph.set(resolvedPath, deps)
        externalHits++
        info(
          `dependency analysis [step 5]: ✓ external hit: ${candidateFile} imports {${imp.importedSymbols.join(', ')}} from ${resolvedPath}`
        )
      }
    }
  }
  info(
    `dependency analysis [step 5]: external scan complete — ${externalHits} import relationships found`
  )

  // ===== 步骤 5.1: Nuxt auto-import 约定检测 =====
  // Nuxt 会自动导入 composables/、utils/、components/、stores/ 目录下的导出，
  // 消费者无需显式 import。扫描已获取的文件内容，检查是否使用了被修改的符号。
  let autoImportHits = 0
  for (const [modifiedFile, symbols] of allModifiedSymbols) {
    if (!isNuxtAutoImportSource(modifiedFile)) continue

    const deps = dependencyGraph.get(modifiedFile) ?? []
    const existingDepFiles = new Set(deps.map(d => d.file))
    const symbolNames = symbols.map(s => s.name)

    for (const [candidateFile, content] of fileContents) {
      if (candidateFile === modifiedFile) continue
      if (existingDepFiles.has(candidateFile)) continue
      if (
        !candidateFile.endsWith('.vue') &&
        !candidateFile.endsWith('.ts') &&
        !candidateFile.endsWith('.js')
      )
        continue

      // 对 .vue 文件提取 script 内容再搜索，避免 template 误匹配
      const searchContent = candidateFile.endsWith('.vue')
        ? extractVueScriptContent(content)
        : content
      if (searchContent.trim().length === 0) continue

      const refs = findReferencesInContent(
        candidateFile,
        searchContent,
        symbolNames,
        1
      )
      if (refs.length > 0) {
        deps.push({
          file: candidateFile,
          symbols: symbolNames,
          aliasMap: {},
          defaultImportName: null,
          namespaceName: null
        })
        existingDepFiles.add(candidateFile)
        autoImportHits++
        info(
          `dependency analysis [step 5.1]: ✓ auto-import hit: ${candidateFile} uses {${refs.map(r => r.symbolName).join(', ')}} from ${modifiedFile}`
        )
      }
    }
    dependencyGraph.set(modifiedFile, deps)
  }
  if (autoImportHits > 0) {
    info(
      `dependency analysis [step 5.1]: auto-import scan complete — ${autoImportHits} implicit dependencies found`
    )
  }

  // ===== 步骤 5.5: Barrel file 传递追踪 =====
  // 识别依赖图中的 barrel file（re-export 中转文件），
  // 将其消费者也加入被修改文件的依赖图（零额外 API 调用）
  let barrelHits = 0
  for (const [modifiedFile] of allModifiedSymbols) {
    const deps = dependencyGraph.get(modifiedFile) ?? []
    const barrelFiles: string[] = []

    // 在已有依赖中识别 barrel file
    for (const dep of deps) {
      const content = fileContents.get(dep.file)
      if (content == null) continue
      if (hasReExportFrom(content, dep.file, modifiedFile, repoFilesSet)) {
        barrelFiles.push(dep.file)
      }
    }

    if (barrelFiles.length === 0) continue
    info(
      `dependency analysis [step 5.5]: ${modifiedFile} has ${barrelFiles.length} barrel file(s): [${barrelFiles.join(', ')}]`
    )

    // 在所有已获取文件中查找 barrel file 的消费者
    const existingDepFiles = new Set(deps.map(d => d.file))
    for (const [candidateFile, content] of fileContents) {
      // 跳过被修改文件自身、已有依赖
      if (candidateFile === modifiedFile) continue
      if (existingDepFiles.has(candidateFile)) continue

      const imports = parseImports(content, candidateFile)
      for (const imp of imports) {
        const resolved = resolveImportPath(candidateFile, imp.importPath, repoFilesSet)
        if (resolved != null && barrelFiles.includes(resolved)) {
          mergeDep(deps, candidateFile, imp)
          existingDepFiles.add(candidateFile)
          barrelHits++
          info(
            `dependency analysis [step 5.5]: ✓ barrel passthrough: ${candidateFile} imports {${imp.importedSymbols.join(', ')}} from barrel ${resolved} ← ${modifiedFile}`
          )
        }
      }
    }
    dependencyGraph.set(modifiedFile, deps)
  }
  if (barrelHits > 0) {
    info(
      `dependency analysis [step 5.5]: barrel passthrough complete — ${barrelHits} indirect dependencies found`
    )
  }

  // ===== 步骤 6: 在依赖文件中搜索修改符号的引用 =====
  for (const [modifiedFile, symbols] of allModifiedSymbols) {
    const deps = dependencyGraph.get(modifiedFile) ?? []
    const dependentFiles = deps.map(d => d.file)
    const symbolNames = symbols.map(s => s.name)
    const allReferences: SymbolReference[] = []

    if (deps.length === 0) {
      // 关键日志：该文件没有被任何文件导入，跳过引用搜索
      info(
        `dependency analysis [step 6]: ✗ ${modifiedFile} has 0 dependents — no files import it, skipping reference search`
      )
    } else {
      info(
        `dependency analysis [step 6]: ${modifiedFile} has ${deps.length} dependents, searching for references to [${symbolNames.join(', ')}]`
      )
    }

    for (const dep of deps) {
      // 循环引用保护：跳过被修改文件自身
      if (dep.file === modifiedFile) continue

      const content = fileContents.get(dep.file)
      if (content == null) continue

      // 仅搜索该依赖文件实际导入的符号（取交集），减少假阳性
      const relevantSymbols = dep.symbols.length > 0
        ? symbolNames.filter(s => dep.symbols.includes(s))
        : symbolNames
      // 如果该文件导入的符号与修改符号无交集，仍用全量搜索（可能是 namespace import）
      const baseSymbols = relevantSymbols.length > 0 ? relevantSymbols : symbolNames

      // 扩展搜索列表：除原始符号名外，还搜索其在该文件中的别名
      const searchSymbols = [...baseSymbols]
      for (const sym of baseSymbols) {
        const alias = dep.aliasMap[sym]
        if (alias && !searchSymbols.includes(alias)) {
          searchSymbols.push(alias)
        }
      }

      // default import：消费者用本地名引用默认导出（如 import calc from './utils' → 搜索 calc）
      if (dep.defaultImportName && !searchSymbols.includes(dep.defaultImportName)) {
        searchSymbols.push(dep.defaultImportName)
      }

      // namespace import：搜索 namespaceName.symbolName 模式（如 utils.calculateTotal）
      if (dep.namespaceName) {
        for (const sym of symbolNames) {
          const nsPattern = `${dep.namespaceName}.${sym}`
          if (!searchSymbols.includes(nsPattern)) {
            searchSymbols.push(nsPattern)
          }
        }
      }

      // 对 .vue 文件，提取 script 块内容再搜索引用，避免 template 误匹配
      const searchContent = dep.file.endsWith('.vue')
        ? extractVueScriptContent(content)
        : content

      const refs = findReferencesInContent(
        dep.file,
        searchContent.length > 0 ? searchContent : content,
        searchSymbols
      )

      // 动态 import() 或 default import 的依赖文件可能不直接引用具名符号，
      // 但导入关系已确认存在（步骤 2/5 已验证），应作为依赖方报告
      if (refs.length === 0 && dep.symbols.length === 0) {
        const implicitRef: SymbolReference = {
          filename: dep.file,
          symbolName: '(module)',
          lineNumber: 0,
          lineContent: `imports ${modifiedFile} via dynamic import or default import`
        }
        refs.push(implicitRef)
        info(
          `dependency analysis [step 6]: ✓ ${dep.file} → implicit dependency (dynamic/default import, no named symbol references)`
        )
      }

      if (refs.length > 0) {
        info(
          `dependency analysis [step 6]: ✓ ${dep.file} → ${refs.length} references found: [${refs.map(r => `${r.symbolName}:L${r.lineNumber}`).join(', ')}]`
        )
      }
      allReferences.push(...refs)
    }

    fileAnalyses.set(modifiedFile, {
      filename: modifiedFile,
      modifiedSymbols: symbols,
      dependentFiles,
      references: allReferences
    })
  }

  // ===== 最终统计 =====
  let totalRefs = 0
  let filesWithRefs = 0
  let filesWithoutRefs = 0
  for (const [, analysis] of fileAnalyses) {
    totalRefs += analysis.references.length
    if (analysis.references.length > 0) {
      filesWithRefs++
    } else {
      filesWithoutRefs++
    }
  }
  info(
    `dependency analysis [summary]: ${fileAnalyses.size} files analyzed, ${totalRefs} cross-file references found`
  )
  info(
    `dependency analysis [summary]: ${filesWithRefs} files have external references, ${filesWithoutRefs} files have no references (API calls used: ${candidateFiles.length})`
  )

  return {fileAnalyses}
}

// ==================== 格式化输出 ====================

/** 跨文件上下文的 token 上限 */
const MAX_CROSS_FILE_CONTEXT_CHARS = 3000

/**
 * 将文件依赖分析结果格式化为紧凑的审查上下文字符串
 *
 * 输出格式示例：
 * ```
 * ### Modified exports in this file:
 * - `calculateTotal` (function)
 * - `TAX_RATE` (variable)
 *
 * ### Files that import from this file (3):
 * - src/checkout/payment.ts: { calculateTotal }
 * - src/reports/summary.ts: { calculateTotal, TAX_RATE }
 *
 * ### References to modified symbols:
 * - src/checkout/payment.ts:45: const total = calculateTotal(cartItems)
 * - src/reports/summary.ts:23: report.total = calculateTotal(allOrders)
 * ```
 *
 * @param analysis - 文件依赖分析结果
 * @returns 格式化的上下文字符串
 */
export function formatCrossFileContext(
  analysis: FileDependencyInfo
): string {
  const parts: string[] = []

  // 第 1 部分：修改的导出符号
  if (analysis.modifiedSymbols.length > 0) {
    parts.push('### Modified exports in this file:')
    for (const sym of analysis.modifiedSymbols) {
      parts.push(`- \`${sym.name}\` (${sym.type})`)
    }
    parts.push('')
  }

  // 第 2 部分：依赖文件列表
  if (analysis.dependentFiles.length > 0) {
    parts.push(
      `### Files that import from this file (${analysis.dependentFiles.length}):`
    )
    // 最多展示 10 个依赖文件
    const displayFiles = analysis.dependentFiles.slice(0, 10)
    for (const f of displayFiles) {
      parts.push(`- ${f}`)
    }
    if (analysis.dependentFiles.length > 10) {
      parts.push(
        `- ... and ${analysis.dependentFiles.length - 10} more files`
      )
    }
    parts.push('')
  }

  // 第 3 部分：引用位置
  if (analysis.references.length > 0) {
    parts.push('### References to modified symbols:')
    // 优先展示非测试文件的引用
    const sortedRefs = [...analysis.references].sort((a, b) => {
      const aIsTest = isTestFile(a.filename) ? 1 : 0
      const bIsTest = isTestFile(b.filename) ? 1 : 0
      return aIsTest - bIsTest
    })

    // 最多展示 15 个引用
    const displayRefs = sortedRefs.slice(0, 15)
    for (const ref of displayRefs) {
      parts.push(
        `- ${ref.filename}:${ref.lineNumber}: ${ref.lineContent}`
      )
    }
    if (analysis.references.length > 15) {
      parts.push(
        `- ... and ${analysis.references.length - 15} more references`
      )
    }
  }

  let result = parts.join('\n')

  // 截断到字符上限（按行边界截断，避免切断 markdown 语法）
  if (result.length > MAX_CROSS_FILE_CONTEXT_CHARS) {
    const cutoff = result.lastIndexOf('\n', MAX_CROSS_FILE_CONTEXT_CHARS)
    result =
      result.substring(0, cutoff > 0 ? cutoff : MAX_CROSS_FILE_CONTEXT_CHARS) +
      '\n... (truncated for token budget)'
  }

  return result
}

/**
 * 判断文件是否为 Nuxt auto-import 源（composables/、utils/、components/、stores/）
 *
 * Nuxt 会自动导入这些目录下的导出，消费者无需显式 import。
 * 用于步骤 5.1 的隐式依赖检测。
 */
function isNuxtAutoImportSource(filename: string): boolean {
  return /(^|\/)(?:composables|utils|components|stores)\//.test(filename)
}

/**
 * 判断文件是否为入口文件（通常不会被其他模块导入）
 *
 * 入口文件是程序的启动点，它们导入其他模块，但自身很少被导入。
 * 跳过这些文件的依赖分析可避免无效的 API 调用。
 */
function isEntryPointFile(filename: string): boolean {
  const basename = filename.substring(filename.lastIndexOf('/') + 1)
  const lower = basename.toLowerCase()

  // Nuxt 约定：pages/、layouts/、server/api/、server/routes/ 是框架消费的入口
  if (
    filename.includes('/pages/') ||
    filename.includes('/layouts/') ||
    filename.includes('/server/api/') ||
    filename.includes('/server/routes/')
  ) {
    return true
  }

  return (
    lower === 'main.ts' ||
    lower === 'main.js' ||
    lower === 'main.py' ||
    lower === 'main.go' ||
    lower === 'app.ts' ||
    lower === 'app.js' ||
    lower === 'app.vue' ||
    lower === 'server.ts' ||
    lower === 'server.js' ||
    lower === 'cli.ts' ||
    lower === 'cli.js' ||
    lower === 'nuxt.config.ts' ||
    lower === 'nuxt.config.js' ||
    // 根目录的 index 文件通常是入口
    (lower.startsWith('index.') && !filename.includes('/src/'))
  )
}

/** 判断文件是否为测试文件 */
function isTestFile(filename: string): boolean {
  const lower = filename.toLowerCase()
  // 使用精确匹配避免误匹配（如 attestation.ts、contest.ts）
  return (
    lower.includes('__tests__') ||
    lower.includes('__test__') ||
    lower.endsWith('.test.ts') ||
    lower.endsWith('.test.tsx') ||
    lower.endsWith('.test.js') ||
    lower.endsWith('.test.jsx') ||
    lower.endsWith('.spec.ts') ||
    lower.endsWith('.spec.tsx') ||
    lower.endsWith('.spec.js') ||
    lower.endsWith('.spec.jsx') ||
    lower.endsWith('_test.go') ||
    lower.endsWith('_test.py') ||
    /(?:^|[/\\])test_\w+\.py$/.test(lower) ||
    /[/\\]tests?[/\\]/.test(lower)
  )
}

/**
 * 将依赖分析结果格式化为 PR 评论中的摘要区块（Markdown）
 *
 * 即使没有发现跨文件影响，也会显示分析结果，让用户了解分析覆盖范围。
 */
export function formatDependencySummary(ctx: DependencyContext): string {
  const entries = Array.from(ctx.fileAnalyses.entries())
  if (entries.length === 0) {
    return ''
  }

  // 如果所有文件都没有外部引用，则不输出依赖分析区块
  const hasAnyReference = entries.some(([, info]) => info.references.length > 0)
  if (!hasAnyReference) {
    return ''
  }

  const lines: string[] = []
  lines.push('')
  lines.push('<details>')
  lines.push(
    `<summary>Cross-file dependency analysis (${entries.length} file${entries.length > 1 ? 's' : ''})</summary>`
  )
  lines.push('')

  for (const [filename, info] of entries) {
    const symbols = info.modifiedSymbols.filter(s => s.isExported)
    const refs = info.references

    lines.push(`**${filename}**`)

    if (symbols.length === 0) {
      lines.push('- No exported symbols modified')
    } else {
      lines.push(
        `- Modified exports: ${symbols.map(s => `\`${s.name}\` (${s.type})`).join(', ')}`
      )
    }

    if (refs.length === 0) {
      lines.push('- No cross-file references affected')
    } else {
      // 按文件分组引用
      const byFile = new Map<string, string[]>()
      for (const ref of refs) {
        const list = byFile.get(ref.filename) ?? []
        list.push(ref.symbolName)
        byFile.set(ref.filename, list)
      }
      lines.push(`- Referenced by ${byFile.size} file${byFile.size > 1 ? 's' : ''}:`)
      for (const [refFile, syms] of byFile) {
        const unique = [...new Set(syms)]
        lines.push(`  - ${refFile} → ${unique.map(s => `\`${s}\``).join(', ')}`)
      }
    }

    lines.push('')
  }

  lines.push('</details>')
  lines.push('')
  return lines.join('\n')
}
