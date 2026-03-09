/**
 * repo-tree.ts - 仓库文件树获取与缓存
 *
 * 使用 GitHub Git Tree API 一次性获取整个仓库的文件列表，
 * 避免逐文件调用 getContent API。
 * 提供按扩展名/路径模式过滤的便捷方法，以及相对导入路径解析。
 */
import {info, warning} from '@actions/core'
// eslint-disable-next-line camelcase
import {context as github_context} from '@actions/github'
import {octokit} from './octokit'

// eslint-disable-next-line camelcase
const context = github_context
const repo = context.repo

/** 支持的源代码语言及其文件扩展名 */
export type Language = 'typescript' | 'python' | 'go' | 'java' | 'unknown'

/** 语言到扩展名的映射 */
const LANGUAGE_EXTENSIONS: Record<Language, string[]> = {
  typescript: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
  python: ['.py'],
  go: ['.go'],
  java: ['.java'],
  unknown: []
}

/** 文件树缓存（同一次运行中避免重复调用 API） */
let cachedTree: string[] | null = null
let cachedTreeRef: string | null = null

/**
 * 获取仓库文件树（使用 recursive=true 一次性获取）
 *
 * 调用 GitHub Git Tree API 获取指定 ref 下的所有文件路径。
 * 结果会缓存，同一 ref 的重复调用直接返回缓存。
 *
 * @param ref - Git 引用（commit SHA / branch / tag）
 * @returns 仓库中所有文件的路径列表
 */
export async function getRepoFileTree(ref: string): Promise<string[]> {
  // 如果缓存命中，直接返回
  if (cachedTree != null && cachedTreeRef === ref) {
    info(`repo tree cache hit for ref: ${ref}`)
    return cachedTree
  }

  try {
    info(`fetching repo tree for ref: ${ref}`)
    const {data} = await octokit.git.getTree({
      owner: repo.owner,
      repo: repo.repo,
      tree_sha: ref,
      recursive: 'true'
    })

    // 仅保留 blob 类型（文件），排除 tree 类型（目录）
    const files = data.tree
      .filter(item => item.type === 'blob' && item.path != null)
      .map(item => item.path as string)

    info(`repo tree fetched: ${files.length} files`)

    // 更新缓存
    cachedTree = files
    cachedTreeRef = ref

    return files
  } catch (e: any) {
    warning(`failed to fetch repo tree: ${e.message}`)
    return []
  }
}

/**
 * 根据文件扩展名检测语言
 *
 * @param filename - 文件路径
 * @returns 检测到的语言
 */
export function detectLanguage(filename: string): Language {
  const lower = filename.toLowerCase()
  for (const [lang, exts] of Object.entries(LANGUAGE_EXTENSIONS)) {
    for (const ext of exts) {
      if (lower.endsWith(ext)) {
        return lang as Language
      }
    }
  }
  return 'unknown'
}

/**
 * 按扩展名过滤文件列表
 *
 * @param files - 文件路径列表
 * @param extensions - 允许的扩展名列表（如 ['.ts', '.js']）
 * @returns 匹配的文件路径
 */
export function filterByExtension(
  files: string[],
  extensions: string[]
): string[] {
  const exts = new Set(extensions.map(e => e.toLowerCase()))
  return files.filter(f => {
    const idx = f.lastIndexOf('.')
    if (idx === -1) return false
    return exts.has(f.substring(idx).toLowerCase())
  })
}

/**
 * 获取指定语言对应的文件扩展名列表
 *
 * @param language - 语言类型
 * @returns 扩展名列表
 */
export function getExtensionsForLanguage(language: Language): string[] {
  return LANGUAGE_EXTENSIONS[language] ?? []
}

/**
 * 将相对导入路径解析为仓库内的绝对路径
 *
 * 支持以下场景：
 * - 相对路径：'./utils/helper' → 尝试 .ts, .tsx, .js, .jsx, /index.ts, /index.js
 * - 父级路径：'../shared/types' → 逐层向上解析
 *
 * @param importingFile - 发起导入的文件路径（如 'src/review.ts'）
 * @param importPath - 导入路径（如 './utils/helper'）
 * @param repoFilesSet - 仓库文件路径的 Set（用于 O(1) 查找）
 * @returns 解析后的仓库内绝对路径，或 null（无法解析时）
 */
export function resolveImportPath(
  importingFile: string,
  importPath: string,
  repoFilesSet: Set<string>
): string | null {
  // 非相对路径（如 npm 包）不尝试解析
  if (!importPath.startsWith('.')) {
    return null
  }

  // 获取导入方文件所在目录
  const dir = importingFile.substring(0, importingFile.lastIndexOf('/'))

  // 将相对路径拼接为绝对路径
  const parts = (dir ? dir + '/' + importPath : importPath).split('/')
  const resolved: string[] = []
  for (const part of parts) {
    if (part === '.') continue
    if (part === '..') {
      resolved.pop()
    } else {
      resolved.push(part)
    }
  }
  const basePath = resolved.join('/')

  // 如果路径本身已存在（如导入 JSON 等带扩展名的文件）
  if (repoFilesSet.has(basePath)) {
    return basePath
  }

  // 尝试补全扩展名
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']
  for (const ext of extensions) {
    if (repoFilesSet.has(basePath + ext)) {
      return basePath + ext
    }
  }

  // 尝试 index 文件
  const indexExtensions = ['/index.ts', '/index.tsx', '/index.js', '/index.jsx']
  for (const idx of indexExtensions) {
    if (repoFilesSet.has(basePath + idx)) {
      return basePath + idx
    }
  }

  return null
}

/**
 * 按优先级对候选文件排序（同目录文件优先）
 *
 * @param candidateFiles - 候选文件列表
 * @param modifiedFiles - PR 中被修改的文件列表
 * @returns 按优先级排序后的文件列表
 */
export function sortByProximity(
  candidateFiles: string[],
  modifiedFiles: string[]
): string[] {
  // 收集所有修改文件的目录
  const modifiedDirs = new Set(
    modifiedFiles.map(f => f.substring(0, f.lastIndexOf('/')))
  )

  // 计算优先级分数：同目录 = 0，同父目录 = 1，其他 = 2
  const getScore = (file: string): number => {
    const dir = file.substring(0, file.lastIndexOf('/'))
    if (modifiedDirs.has(dir)) return 0
    const parentDir = dir.substring(0, dir.lastIndexOf('/'))
    if (modifiedDirs.has(parentDir)) return 1
    return 2
  }

  return [...candidateFiles].sort((a, b) => getScore(a) - getScore(b))
}
