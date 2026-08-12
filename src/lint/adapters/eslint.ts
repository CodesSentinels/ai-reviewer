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

import {info} from '../../actions-log'
import {existsSync, readFileSync} from 'fs'
import {join} from 'path'
import {ensureToolInstalled} from '../tool-installer'
import {type InstallSpec, type LintResult, type ToolAdapter, type ToolDetection} from '../types'
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
    if (existsSync(join(repoRoot, name))) return name
  }
  // package.json 内嵌 eslintConfig
  const pkgPath = join(repoRoot, 'package.json')
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
  readonly fileExtensions = ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts', '.vue']
  readonly defaultEnabled = true

  /**
   * 多策略：声明 ESLint 用 npm 装到沙箱目录
   * （待审查项目无需把 eslint 写入 devDependencies）。
   * 不含 version：默认版本由 action.yml 的 `eslint_version` default 提供（见 detect）。
   */
  readonly installSpec: InstallSpec = {
    kind: 'npm',
    package: 'eslint',
    binName: 'eslint'
  }

  /** detect() 成功后填充：ESLint 版本 */
  private resolvedVersion = ''
  /** detect() 成功后填充：bundled 二进制的绝对路径，scan 时直接调用 */
  private resolvedBinPath = ''

  async detect(repoRoot: string, versionOverride?: string): Promise<ToolDetection> {
    // 1) 让 installer 确保 bundled ESLint 在沙箱内可用
    //    versionOverride 非空时覆盖默认版本，保证与消费方本地一致
    const spec: InstallSpec =
      versionOverride && versionOverride.length > 0
        ? {...this.installSpec, version: versionOverride}
        : this.installSpec
    const install = await ensureToolInstalled(spec)
    if (!install.ok) {
      return {
        available: false,
        reason: `bundled ESLint install failed: ${install.reason ?? 'unknown'}`
      }
    }
    this.resolvedBinPath = install.binPath as string

    // 2) 跑一遍 --version 确认能正常启动
    const versionResult = await runCommand({
      command: this.resolvedBinPath,
      args: ['--version'],
      cwd: repoRoot,
      timeoutMs: 10_000
    })
    if (versionResult.spawnError || versionResult.exitCode !== 0) {
      const stderrSnippet =
        versionResult.stderr
          .split('\n')
          .find(l => l.trim().length > 0)
          ?.substring(0, 120) ?? ''
      return {
        available: false,
        reason: `bundled ESLint --version failed: exit=${versionResult.exitCode}; stderr="${stderrSnippet}"`
      }
    }
    const version = extractVersion(versionResult.stdout)

    // 3) ESLint 9 Flat Config 不内置规则；项目无配置 → 标记为不可用
    //    （改进 A 保留：理由清晰可见，不让用户面对 0 finding 困惑）
    const configFile = findEslintConfig(repoRoot)
    if (configFile == null) {
      return {
        available: false,
        version,
        reason:
          'no ESLint config found in repo (looked for eslint.config.{js,mjs,cjs,ts,mts,cts}, .eslintrc.*, package.json#eslintConfig)'
      }
    }
    info(`lint/eslint: bundled bin=${this.resolvedBinPath}, project config=${configFile}`)

    this.resolvedVersion = version
    return {available: true, version}
  }

  async scan(files: string[], repoRoot: string): Promise<LintResult[]> {
    if (files.length === 0) return []

    // 始终使用项目自带的 eslint config（早期支持的 useProjectConfig=false 已移除，
    // 因 ESLint 9 不内置规则集，关掉项目配置会让扫描必败）
    const args = ['--format', 'json', '--no-error-on-unmatched-pattern', ...files]

    info(`lint/eslint: scanning ${files.length} files via ${this.resolvedBinPath}`)
    const result = await runCommand({
      command: this.resolvedBinPath,
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
