/**
 * lint/adapters/eslint.ts - ESLint 适配器
 *
 * 调用方式：`eslint --format json --no-error-on-unmatched-pattern <files>`
 *
 * 输出解析：ESLint JSON 顶层是数组，每个元素对应一个文件
 * [
 *   { filePath, messages: [{ ruleId, severity, message, line, column, endLine, endColumn, fix }] }
 * ]
 *
 * severity: 1 = warning, 2 = error
 */

import {info} from '@actions/core'
import {existsSync, readFileSync} from 'fs'
import * as path from 'path'
import {
  type LintResult,
  type ToolAdapter,
  type ToolConfig,
  type ToolDetection
} from '../types'
import {extractVersion, parseJsonSafe, runCommand} from './exec'

/**
 * 项目根可能存在的 ESLint 配置文件名（按优先级）。
 *
 * - 前 6 个：ESLint 9 Flat Config 系列
 * - 中段：Legacy `.eslintrc.*`（ESLint 8 及更早）
 *
 * `package.json#eslintConfig` 字段会单独检查。
 */
const ESLINT_CONFIG_FILES = [
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
  'eslint.config.mts',
  'eslint.config.cts',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc.yaml',
  '.eslintrc.yml',
  '.eslintrc.json',
  '.eslintrc'
]

/**
 * 在仓库根查找 ESLint 配置；找到任一即视为存在
 *
 * @returns 命中的配置标识（文件名或 'package.json#eslintConfig'），未找到返回 null
 */
function findEslintConfig(repoRoot: string): string | null {
  for (const name of ESLINT_CONFIG_FILES) {
    if (existsSync(path.join(repoRoot, name))) return name
  }
  // package.json 内嵌 eslintConfig
  const pkgPath = path.join(repoRoot, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
        eslintConfig?: unknown
      }
      if (pkg.eslintConfig != null) return 'package.json#eslintConfig'
    } catch {
      // 解析失败不算命中
    }
  }
  return null
}

/** ESLint JSON 输出中单个 message 的结构 */
interface EslintMessage {
  ruleId: string | null
  severity: 1 | 2
  message: string
  line: number
  column: number
  endLine?: number
  endColumn?: number
  fix?: unknown
  suggestions?: Array<{desc?: string}>
}

/** ESLint JSON 输出中单个文件结果 */
interface EslintFileResult {
  filePath: string
  messages: EslintMessage[]
}

/** 安全相关的 rule 前缀（用于自动分类） */
const SECURITY_RULE_PREFIXES = ['security/', 'security-node/', 'no-eval']

/** 性能相关的 rule 关键词 */
const PERFORMANCE_RULE_KEYWORDS = ['perf', 'no-await-in-loop']

function classifyCategory(ruleId: string): LintResult['category'] {
  const r = ruleId.toLowerCase()
  if (SECURITY_RULE_PREFIXES.some(p => r.startsWith(p))) return 'security'
  if (PERFORMANCE_RULE_KEYWORDS.some(p => r.includes(p))) return 'performance'
  // ESLint 内置 stylistic rules
  if (r.startsWith('@stylistic/') || r.includes('indent') || r.includes('quotes')) {
    return 'style'
  }
  return 'quality'
}

export class EslintAdapter implements ToolAdapter {
  readonly name = 'eslint'
  readonly displayName = 'ESLint'
  readonly supportedLanguages = ['javascript', 'typescript', 'vue']
  readonly fileExtensions = [
    '.js',
    '.jsx',
    '.mjs',
    '.cjs',
    '.ts',
    '.tsx',
    '.mts',
    '.cts',
    '.vue'
  ]
  readonly defaultEnabled = true

  /** 解析出的 ESLint 版本，detect() 后填充 */
  private resolvedVersion = ''

  async detect(repoRoot: string): Promise<ToolDetection> {
    // 第一步：确认 ESLint 二进制可用
    const result = await runCommand({
      command: 'npx',
      args: ['--no-install', 'eslint', '--version'],
      timeoutMs: 10_000
    })
    let version: string
    if (result.spawnError || result.exitCode !== 0) {
      // 回退：尝试全局 eslint
      const fallback = await runCommand({
        command: 'eslint',
        args: ['--version'],
        timeoutMs: 5_000
      })
      if (fallback.spawnError || fallback.exitCode !== 0) {
        return {
          available: false,
          reason: result.spawnErrorMessage ?? 'eslint --version failed'
        }
      }
      version = extractVersion(fallback.stdout)
    } else {
      version = extractVersion(result.stdout)
    }

    // 第二步：ESLint 9 Flat Config 不再内置默认规则；项目无配置 → 标记为不可用
    // 这样用户在 PR 摘要的统计表中能直接看到原因，而不是面对一堆"扫描了 N 个文件，0 finding"
    // 的迷惑结果。
    const configFile = findEslintConfig(repoRoot)
    if (configFile == null) {
      return {
        available: false,
        version,
        reason:
          'no ESLint config found in repo (looked for eslint.config.{js,mjs,cjs,ts,mts,cts}, .eslintrc.*, package.json#eslintConfig)'
      }
    }
    info(`lint/eslint: detected project config: ${configFile}`)

    this.resolvedVersion = version
    return {available: true, version}
  }

  async scan(
    files: string[],
    repoRoot: string,
    config: ToolConfig
  ): Promise<LintResult[]> {
    if (files.length === 0) return []

    // 默认使用项目自带配置；用户可显式关闭
    const useProjectConfig = config.useProjectConfig !== false

    const args = ['--no-install', 'eslint', '--format', 'json', '--no-error-on-unmatched-pattern']
    if (!useProjectConfig) {
      // 完全跳过项目配置，使用 ESLint 内置规则集
      args.push('--no-config-lookup')
    }
    // 文件列表追加在末尾
    args.push(...files)

    info(`lint/eslint: scanning ${files.length} files`)
    const result = await runCommand({
      command: 'npx',
      args,
      cwd: repoRoot
    })

    if (result.spawnError) {
      info(`lint/eslint: spawn failed: ${result.spawnErrorMessage ?? ''}`)
      return []
    }

    // ESLint 在发现问题时返回 1，发现错误时返回 2，但 stdout 仍是合法 JSON
    const parsed = parseJsonSafe<EslintFileResult[]>(result.stdout, 'eslint')
    if (parsed == null) {
      info(`lint/eslint: no parseable output (stderr: ${result.stderr.substring(0, 200)})`)
      return []
    }

    const results: LintResult[] = []
    for (const fileResult of parsed) {
      // 将绝对路径转回相对仓库根的路径
      const relFile = toRelativePath(fileResult.filePath, repoRoot)
      for (const msg of fileResult.messages) {
        const ruleId = msg.ruleId ?? 'eslint/unknown'
        results.push({
          tool: this.displayName,
          toolVersion: this.resolvedVersion,
          file: relFile,
          line: msg.line,
          column: msg.column,
          endLine: msg.endLine,
          endColumn: msg.endColumn,
          severity: msg.severity === 2 ? 'error' : 'warning',
          ruleId,
          message: msg.message,
          suggestion: msg.suggestions?.[0]?.desc,
          fixable: msg.fix != null,
          category: classifyCategory(ruleId)
        })
      }
    }
    return results
  }
}

function toRelativePath(absOrRel: string, repoRoot: string): string {
  if (!absOrRel.startsWith(repoRoot)) return absOrRel
  let rel = absOrRel.substring(repoRoot.length)
  if (rel.startsWith('/') || rel.startsWith('\\')) rel = rel.substring(1)
  return rel
}
