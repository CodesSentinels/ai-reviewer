/**
 * lint/adapters/biome.ts - Biome 适配器
 *
 * 使用 `--reporter=github` 模式输出 GitHub Actions 标注格式：
 *
 *   ::error title=lint/suspicious/noDoubleEquals,file=src/foo.ts,line=42,col=15,endLine=42,endColumn=22::Use === instead of ==.
 *   ::warning title=lint/suspicious/noConsole,file=src/bar.ts,line=10,col=1::Avoid console.log
 *
 * 选这个 reporter 的原因：
 *   - 跨 Biome 版本格式稳定（1.x / 2.x / 2.4 / 未来都不会变）
 *   - 一行一条诊断，正则即可解析，不依赖嵌套 JSON schema
 *   - Biome 1.x → 2.x 的 JSON 输出结构改动过两次（line_start / span / start.line），
 *     用 GitHub reporter 可以彻底回避适配器频繁修改的问题
 *
 * 历史教训：早期版本用 `--reporter=json`，发现 Biome 2.4.x 把 location 字段从
 * `line_start` 重命名为 `span`/`start.line`，所有 finding 都被 silently 丢弃，
 * 统计表显示 0 errors。
 */

import {info} from '@actions/core'
import {ensureToolInstalled} from '../tool-installer'
import {
  type InstallSpec,
  type LintResult,
  type ToolAdapter,
  type ToolDetection
} from '../types'
import {extractVersion, runCommand} from './exec'

/**
 * 把 Biome 的 GitHub annotation 行 `::level k=v,k=v::msg` 解析为字段对象。
 *
 * 输入示例：
 *   ::error title=lint/suspicious/noDoubleEquals,file=src/foo.ts,line=42,col=15::Use === instead of ==.
 */
const GITHUB_ANNOTATION_RE = /^::(error|warning|notice) (.+?)::(.*)$/

interface ParsedAnnotation {
  level: 'error' | 'warning' | 'notice'
  fields: Record<string, string>
  message: string
}

function parseGithubAnnotation(line: string): ParsedAnnotation | null {
  const m = line.match(GITHUB_ANNOTATION_RE)
  if (m == null) return null
  const [, level, fieldsStr, message] = m
  const fields: Record<string, string> = {}
  // metadata 是 `k=v,k=v` 形式；value 内不包含逗号（Biome 的 title/file 不会含），
  // 所以按逗号切就够。如果以后有边角情况再升级到考虑转义的解析器。
  for (const pair of fieldsStr.split(',')) {
    const eqIdx = pair.indexOf('=')
    if (eqIdx === -1) continue
    const k = pair.substring(0, eqIdx).trim()
    const v = pair.substring(eqIdx + 1).trim()
    if (k.length > 0) fields[k] = v
  }
  return {
    level: level as ParsedAnnotation['level'],
    fields,
    message
  }
}

function severityFromLevel(
  level: ParsedAnnotation['level']
): LintResult['severity'] {
  if (level === 'error') return 'error'
  if (level === 'warning') return 'warning'
  return 'info'
}

function categoryToType(
  category: string | undefined
): LintResult['category'] {
  if (category == null) return 'quality'
  if (category.includes('suspicious') || category.includes('correctness')) {
    return 'quality'
  }
  if (category.includes('security')) return 'security'
  if (category.includes('performance')) return 'performance'
  if (category.includes('style')) return 'style'
  return 'quality'
}

export class BiomeAdapter implements ToolAdapter {
  readonly name = 'biome'
  readonly displayName = 'Biome'
  readonly supportedLanguages = ['javascript', 'typescript']
  readonly fileExtensions = [
    '.js',
    '.jsx',
    '.mjs',
    '.cjs',
    '.ts',
    '.tsx',
    '.mts',
    '.cts'
  ]
  readonly defaultEnabled = true

  /** Biome 完全零配置可用（内置 recommended 规则集），无需项目侧任何文件 */
  readonly installSpec: InstallSpec = {
    kind: 'npm',
    package: '@biomejs/biome',
    binName: 'biome',
    version: '^2.3.0'
  }

  private resolvedVersion = ''
  private resolvedBinPath = ''

  async detect(
    repoRoot: string,
    versionOverride?: string
  ): Promise<ToolDetection> {
    // 1) 让 installer 装到沙箱（待审查项目不需要 @biomejs/biome）
    const spec: InstallSpec =
      versionOverride && versionOverride.length > 0
        ? {...this.installSpec, version: versionOverride}
        : this.installSpec
    const install = await ensureToolInstalled(spec)
    if (!install.ok) {
      return {
        available: false,
        reason: `bundled Biome install failed: ${install.reason ?? 'unknown'}`
      }
    }
    this.resolvedBinPath = install.binPath as string

    // 2) 跑 --version 校验
    const versionResult = await runCommand({
      command: this.resolvedBinPath,
      args: ['--version'],
      cwd: repoRoot,
      timeoutMs: 10_000
    })
    if (versionResult.spawnError || versionResult.exitCode !== 0) {
      const stderrSnippet =
        versionResult.stderr.split('\n').find(l => l.trim().length > 0)?.substring(0, 120) ?? ''
      return {
        available: false,
        reason: `bundled Biome --version failed: exit=${versionResult.exitCode}; stderr="${stderrSnippet}"`
      }
    }

    this.resolvedVersion = extractVersion(versionResult.stdout)
    info(`lint/biome: bundled bin=${this.resolvedBinPath}, zero-config OK`)
    return {available: true, version: this.resolvedVersion}
  }

  async scan(files: string[], repoRoot: string): Promise<LintResult[]> {
    if (files.length === 0) return []

    info(
      `lint/biome: scanning ${files.length} files via ${this.resolvedBinPath}`
    )
    // --reporter=github 输出 GitHub Actions 标注格式（一行一条诊断），
    // --max-diagnostics=999 防止默认 20 条上限把发现截断
    const result = await runCommand({
      command: this.resolvedBinPath,
      args: [
        'check',
        '--reporter=github',
        '--max-diagnostics=999',
        ...files
      ],
      cwd: repoRoot
    })

    if (result.spawnError) {
      info(`lint/biome: spawn failed: ${result.spawnErrorMessage ?? ''}`)
      return []
    }

    // Biome 把诊断写到 stdout（不是 stderr）；exit 非零仅代表"有发现"，不算异常
    const output = result.stdout || result.stderr
    if (output.trim().length === 0) {
      info(`lint/biome: no output (exit=${result.exitCode}); 0 findings`)
      return []
    }

    const results: LintResult[] = []
    for (const rawLine of output.split('\n')) {
      const ann = parseGithubAnnotation(rawLine)
      if (ann == null) continue
      const file = ann.fields.file
      if (file == null || file.length === 0) continue

      // 路径归一化：Biome 可能输出绝对路径，转为相对仓库根
      let relFile = file
      if (relFile.startsWith(repoRoot)) {
        relFile = relFile.substring(repoRoot.length).replace(/^[/\\]/, '')
      }

      const lineNo = parseInt(ann.fields.line ?? '1', 10)
      const colNo = parseInt(
        ann.fields.col ?? ann.fields.column ?? '1',
        10
      )
      const endLineNo = ann.fields.endLine
        ? parseInt(ann.fields.endLine, 10)
        : undefined
      const endColNo = ann.fields.endColumn
        ? parseInt(ann.fields.endColumn, 10)
        : undefined

      const ruleId = ann.fields.title ?? 'biome/unknown'

      results.push({
        tool: this.displayName,
        toolVersion: this.resolvedVersion,
        file: relFile,
        line: lineNo,
        column: colNo,
        endLine: endLineNo,
        endColumn: endColNo,
        severity: severityFromLevel(ann.level),
        ruleId,
        message: ann.message.trim(),
        fixable: false,
        category: categoryToType(ruleId)
      })
    }
    info(
      `lint/biome: parsed ${results.length} finding(s) from --reporter=github output`
    )
    return results
  }
}
