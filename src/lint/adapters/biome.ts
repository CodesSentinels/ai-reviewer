/**
 * lint/adapters/biome.ts - Biome 适配器
 *
 * Biome 2.x 的 JSON reporter 输出结构：
 * {
 *   "diagnostics": [
 *     {
 *       "category": "lint/suspicious/useIterableCallbackReturn",
 *       "severity": "error" | "warning" | "information",
 *       "description": "...",
 *       "location": {
 *         "path": { "file": "src/utils.js" },
 *         "span": [<offset>, <offset>]
 *       },
 *       "advices": { ... }
 *     }
 *   ]
 * }
 *
 * 注意：Biome 的 location.span 是字节偏移而非行号，需要从源码内容映射。
 * 为简化实现，本适配器使用 `--reporter=github` 模式（行号已解析）作为主路径，
 * 失败时回退到 JSON。
 *
 * 实际上 Biome 也支持 --reporter=json 输出含 line_start/column_start 字段
 * 的诊断信息，更稳定的解析路径直接使用 JSON。
 */

import {info} from '@actions/core'
import {
  type LintResult,
  type ToolAdapter,
  type ToolConfig,
  type ToolDetection
} from '../types'
import {
  buildVersionFailureReason,
  extractVersion,
  parseJsonSafe,
  runCommand
} from './exec'

interface BiomeLocation {
  path?: {file?: string}
  span?: [number, number]
  source_code?: string
  line_start?: number
  column_start?: number
  line_end?: number
  column_end?: number
}

interface BiomeDiagnostic {
  category?: string
  severity?: 'error' | 'warning' | 'information' | 'hint'
  description?: string
  message?: Array<{content?: string; elements?: unknown}> | string
  location?: BiomeLocation
}

interface BiomeJsonReport {
  diagnostics?: BiomeDiagnostic[]
  summary?: {
    changed?: number
    matches?: number
  }
}

function severityToUnified(
  severity: BiomeDiagnostic['severity']
): LintResult['severity'] {
  if (severity === 'error') return 'error'
  if (severity === 'warning') return 'warning'
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

function extractMessage(diag: BiomeDiagnostic): string {
  if (typeof diag.message === 'string') return diag.message
  if (Array.isArray(diag.message)) {
    return diag.message
      .map(m => (typeof m === 'string' ? m : m.content ?? ''))
      .filter(s => s.length > 0)
      .join(' ')
      .trim()
  }
  return diag.description ?? ''
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

  private resolvedVersion = ''

  async detect(repoRoot: string): Promise<ToolDetection> {
    // Biome 2.x 内置 recommended 规则集，无需项目配置即可工作
    // 必须在 repoRoot 下跑：npx --no-install 在 cwd 的 node_modules/.bin 里找
    const result = await runCommand({
      command: 'npx',
      args: ['--no-install', 'biome', '--version'],
      cwd: repoRoot,
      timeoutMs: 10_000
    })
    if (result.spawnError || result.exitCode !== 0) {
      const fallback = await runCommand({
        command: 'biome',
        args: ['--version'],
        cwd: repoRoot,
        timeoutMs: 5_000
      })
      if (fallback.spawnError || fallback.exitCode !== 0) {
        return {
          available: false,
          reason: buildVersionFailureReason('biome', repoRoot, result, fallback)
        }
      }
      this.resolvedVersion = extractVersion(fallback.stdout)
      return {available: true, version: this.resolvedVersion}
    }
    this.resolvedVersion = extractVersion(result.stdout)
    return {available: true, version: this.resolvedVersion}
  }

  async scan(
    files: string[],
    repoRoot: string,
    _config: ToolConfig
  ): Promise<LintResult[]> {
    if (files.length === 0) return []

    info(`lint/biome: scanning ${files.length} files`)
    const result = await runCommand({
      command: 'npx',
      args: [
        '--no-install',
        'biome',
        'check',
        '--reporter=json',
        ...files
      ],
      cwd: repoRoot
    })

    if (result.spawnError) {
      info(`lint/biome: spawn failed: ${result.spawnErrorMessage ?? ''}`)
      return []
    }

    const parsed = parseJsonSafe<BiomeJsonReport>(result.stdout, 'biome')
    if (parsed == null || parsed.diagnostics == null) {
      info(`lint/biome: no parseable diagnostics`)
      return []
    }

    const results: LintResult[] = []
    for (const diag of parsed.diagnostics) {
      const file = diag.location?.path?.file
      if (file == null) continue
      const startLine = diag.location?.line_start
      if (startLine == null) continue

      const message = extractMessage(diag)
      const ruleId = diag.category ?? 'biome/unknown'
      results.push({
        tool: this.displayName,
        toolVersion: this.resolvedVersion,
        file,
        line: startLine,
        column: diag.location?.column_start ?? 1,
        endLine: diag.location?.line_end,
        endColumn: diag.location?.column_end,
        severity: severityToUnified(diag.severity),
        ruleId,
        message,
        fixable: false,
        category: categoryToType(ruleId)
      })
    }
    return results
  }
}
