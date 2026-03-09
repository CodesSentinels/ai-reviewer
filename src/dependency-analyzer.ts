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
// eslint-disable-next-line camelcase
import {context as github_context} from '@actions/github'
import pLimit from 'p-limit'
import {octokit} from './octokit'
import {type Options} from './options'
import {
  type Language,
  detectLanguage,
  filterByExtension,
  getExtensionsForLanguage,
  resolveImportPath,
  sortByProximity
} from './repo-tree'

// eslint-disable-next-line camelcase
const context = github_context
const repo = context.repo

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
  importedSymbols: string[] // 导入的符号列表
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

// ==================== 导入解析（正则） ====================

/**
 * 解析文件中的导入语句
 *
 * 支持 TS/JS、Python、Go、Java 的常见导入模式。
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
  switch (language) {
    case 'typescript':
      return parseTsImports(content)
    case 'python':
      return parsePyImports(content)
    case 'go':
      return parseGoImports(content)
    case 'java':
      return parseJavaImports(content)
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

  // import { foo, bar } from './module'
  const namedImportRe = /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g
  let match
  while ((match = namedImportRe.exec(content)) !== null) {
    const symbols = match[1]
      .split(',')
      .map(s => s.trim().split(/\s+as\s+/)[0].trim())
      .filter(s => s.length > 0)
    imports.push({
      importPath: match[2],
      importedSymbols: symbols,
      isDefault: false,
      isNamespace: false
    })
  }

  // import foo from './module'
  const defaultImportRe =
    /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g
  while ((match = defaultImportRe.exec(content)) !== null) {
    // 排除已被 namedImportRe 匹配的 import { ... } from 情况
    // defaultImportRe 不会匹配以 { 开头的，所以这里安全
    imports.push({
      importPath: match[2],
      importedSymbols: [match[1]],
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
      isDefault: false,
      isNamespace: true
    })
  }

  // const { foo, bar } = require('./module')
  const destructuredRequireRe =
    /(?:const|let|var)\s+\{([^}]+)\}\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  while ((match = destructuredRequireRe.exec(content)) !== null) {
    const symbols = match[1]
      .split(',')
      .map(s => s.trim().split(/\s*:\s*/)[0].trim())
      .filter(s => s.length > 0)
    imports.push({
      importPath: match[2],
      importedSymbols: symbols,
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
      isDefault: true,
      isNamespace: false
    })
  }

  // export { foo, bar } from './module'（re-export）
  const reExportRe = /export\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g
  while ((match = reExportRe.exec(content)) !== null) {
    const symbols = match[1]
      .split(',')
      .map(s => s.trim().split(/\s+as\s+/)[0].trim())
      .filter(s => s.length > 0)
    imports.push({
      importPath: match[2],
      importedSymbols: symbols,
      isDefault: false,
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

  // from module import foo, bar
  const fromImportRe = /from\s+([\w.]+)\s+import\s+\(?([^)\n]+)\)?/g
  while ((match = fromImportRe.exec(content)) !== null) {
    const symbols = match[2]
      .split(',')
      .map(s => s.trim().split(/\s+as\s+/)[0].trim())
      .filter(s => s.length > 0 && s !== '*')
    imports.push({
      importPath: match[1],
      importedSymbols: symbols,
      isDefault: false,
      isNamespace: symbols.length === 0
    })
  }

  // import module
  const simpleImportRe = /^import\s+([\w.]+)(?:\s+as\s+\w+)?$/gm
  while ((match = simpleImportRe.exec(content)) !== null) {
    imports.push({
      importPath: match[1],
      importedSymbols: [match[1].split('.').pop() ?? match[1]],
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

  // 单行 import "package" 或 import alias "package"
  const singleImportRe = /import\s+(?:(\w+)\s+)?"([^"]+)"/g
  while ((match = singleImportRe.exec(content)) !== null) {
    const alias = match[1] ?? match[2].split('/').pop() ?? ''
    imports.push({
      importPath: match[2],
      importedSymbols: [alias],
      isDefault: false,
      isNamespace: true
    })
  }

  // 分组 import ( ... )
  const groupImportRe = /import\s*\(([\s\S]*?)\)/g
  while ((match = groupImportRe.exec(content)) !== null) {
    const block = match[1]
    const lineRe = /(?:(\w+)\s+)?"([^"]+)"/g
    let lineMatch
    while ((lineMatch = lineRe.exec(block)) !== null) {
      const alias = lineMatch[1] ?? lineMatch[2].split('/').pop() ?? ''
      imports.push({
        importPath: lineMatch[2],
        importedSymbols: [alias],
        isDefault: false,
        isNamespace: true
      })
    }
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

  for (const line of lines) {
    // 只处理新增行和删除行
    if (!line.startsWith('+') && !line.startsWith('-')) continue
    // 跳过 diff 头部行
    if (line.startsWith('+++') || line.startsWith('---')) continue

    const content = line.substring(1) // 去掉 +/- 前缀
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

  return symbols
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
export function findReferencesInContent(
  filename: string,
  content: string,
  symbolNames: string[],
  maxRefsPerSymbol = 5
): SymbolReference[] {
  const references: SymbolReference[] = []
  const lines = content.split('\n')

  for (const symbolName of symbolNames) {
    // 构建词边界匹配正则
    const regex = new RegExp(`\\b${escapeRegex(symbolName)}\\b`)
    let refCount = 0

    for (let i = 0; i < lines.length; i++) {
      if (refCount >= maxRefsPerSymbol) break

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
 * @returns 完整的依赖分析上下文
 */
export async function analyzeDependencies(
  filesAndChanges: Array<[string, string, string, Array<[number, number, string]>]>,
  repoFiles: string[],
  options: Options,
  githubConcurrencyLimit: ReturnType<typeof pLimit>
): Promise<DependencyContext> {
  const fileAnalyses = new Map<string, FileDependencyInfo>()
  const repoFilesSet = new Set(repoFiles)

  // ===== 步骤 1: 提取所有修改文件的导出符号 =====
  const modifiedFileNames = filesAndChanges.map(([f]) => f)
  const allModifiedSymbols = new Map<string, ModifiedSymbol[]>()

  for (const [filename, , fileDiff] of filesAndChanges) {
    const symbols = extractModifiedSymbols(filename, fileDiff)
    const exportedSymbols = symbols.filter(s => s.isExported)
    if (exportedSymbols.length > 0) {
      allModifiedSymbols.set(filename, exportedSymbols)
      info(
        `dependency analysis: ${filename} has ${exportedSymbols.length} modified exports: ${exportedSymbols.map(s => s.name).join(', ')}`
      )
    }
  }

  // 如果没有修改任何导出符号，跳过后续分析
  if (allModifiedSymbols.size === 0) {
    info('dependency analysis: no modified exports found, skipping')
    return {fileAnalyses}
  }

  // ===== 步骤 2: 确定需要扫描的候选文件 =====
  // 收集所有修改文件的语言，获取对应扩展名
  const languages = new Set<Language>()
  for (const [filename] of filesAndChanges) {
    languages.add(detectLanguage(filename))
  }

  let extensions: string[] = []
  for (const lang of languages) {
    extensions = extensions.concat(getExtensionsForLanguage(lang))
  }

  // 按扩展名过滤仓库文件，排除 PR 中已修改的文件
  let candidateFiles = filterByExtension(repoFiles, extensions).filter(
    f => !modifiedFileNames.includes(f)
  )

  // 使用 options.pathFilters 排除不需要的文件
  candidateFiles = candidateFiles.filter(f => options.checkPath(f))

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
    `dependency analysis: scanning ${candidateFiles.length} candidate files`
  )

  // ===== 步骤 3: 并行获取候选文件内容 =====
  const fileContents = new Map<string, string>()

  const fetchPromises = candidateFiles.map(f =>
    githubConcurrencyLimit(async () => {
      try {
        const response = await octokit.repos.getContent({
          owner: repo.owner,
          repo: repo.repo,
          path: f,
          ref: context.payload.pull_request?.head?.sha ?? ''
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
    `dependency analysis: fetched ${fileContents.size} / ${candidateFiles.length} file contents`
  )

  // ===== 步骤 4: 解析导入语句，构建依赖图 =====
  // 对于每个修改文件，找出谁导入了它
  const dependencyGraph = new Map<string, Array<{file: string; symbols: string[]}>>()

  for (const [modifiedFile] of allModifiedSymbols) {
    dependencyGraph.set(modifiedFile, [])
  }

  for (const [candidateFile, content] of fileContents) {
    const imports = parseImports(content, candidateFile)

    for (const imp of imports) {
      // 尝试将导入路径解析为仓库内的绝对路径
      const resolvedPath = resolveImportPath(
        candidateFile,
        imp.importPath,
        repoFilesSet
      )

      // 如果解析到的路径是某个修改文件
      if (resolvedPath != null && allModifiedSymbols.has(resolvedPath)) {
        const deps = dependencyGraph.get(resolvedPath) ?? []
        deps.push({file: candidateFile, symbols: imp.importedSymbols})
        dependencyGraph.set(resolvedPath, deps)
      }
    }
  }

  // ===== 步骤 5: 在依赖文件中搜索修改符号的引用 =====
  for (const [modifiedFile, symbols] of allModifiedSymbols) {
    const deps = dependencyGraph.get(modifiedFile) ?? []
    const dependentFiles = deps.map(d => d.file)
    const symbolNames = symbols.map(s => s.name)
    const allReferences: SymbolReference[] = []

    for (const dep of deps) {
      const content = fileContents.get(dep.file)
      if (content == null) continue

      // 搜索修改符号在依赖文件中的引用
      const refs = findReferencesInContent(
        dep.file,
        content,
        symbolNames
      )
      allReferences.push(...refs)
    }

    fileAnalyses.set(modifiedFile, {
      filename: modifiedFile,
      modifiedSymbols: symbols,
      dependentFiles,
      references: allReferences
    })
  }

  // 统计日志
  let totalRefs = 0
  for (const [, analysis] of fileAnalyses) {
    totalRefs += analysis.references.length
  }
  info(
    `dependency analysis complete: ${fileAnalyses.size} files analyzed, ${totalRefs} cross-file references found`
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

  // 截断到字符上限
  if (result.length > MAX_CROSS_FILE_CONTEXT_CHARS) {
    result =
      result.substring(0, MAX_CROSS_FILE_CONTEXT_CHARS) +
      '\n... (truncated for token budget)'
  }

  return result
}

/** 判断文件是否为测试文件 */
function isTestFile(filename: string): boolean {
  const lower = filename.toLowerCase()
  return (
    lower.includes('test') ||
    lower.includes('spec') ||
    lower.includes('__tests__') ||
    lower.endsWith('.test.ts') ||
    lower.endsWith('.spec.ts') ||
    lower.endsWith('_test.go') ||
    lower.endsWith('_test.py')
  )
}
