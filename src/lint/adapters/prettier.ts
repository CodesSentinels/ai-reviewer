/**
 * lint/adapters/prettier.ts - Prettier 适配器
 *
 * Prettier 没有结构化 JSON 输出（只有 --check 列出不符合格式的文件）。
 * 因此本适配器仅产生"文件级"的 LintResult（line=1, column=1）。
 *
 * 调用方式：`prettier --check --no-error-on-unmatched-pattern <files>`
 * 退出码语义：
 *   0  → 所有文件格式正确
 *   1  → 部分文件格式不正确（stderr 中列出文件名）
 *   2+ → 配置错误或其他失败
 */

import {info} from '@actions/core'
import {
  type LintResult,
  type ToolAdapter,
  type ToolConfig,
  type ToolDetection
} from '../types'
import {extractVersion, runCommand} from './exec'

export class PrettierAdapter implements ToolAdapter {
  readonly name = 'prettier'
  readonly displayName = 'Prettier'
  readonly supportedLanguages = [
    'javascript',
    'typescript',
    'css',
    'html',
    'vue'
  ]
  readonly fileExtensions = [
    '.js',
    '.jsx',
    '.mjs',
    '.cjs',
    '.ts',
    '.tsx',
    '.mts',
    '.cts',
    '.css',
    '.scss',
    '.less',
    '.html',
    '.htm',
    '.vue',
    '.json',
    '.md'
  ]
  readonly defaultEnabled = false // 默认关闭：风格类问题信噪比较低

  private resolvedVersion = ''

  async detect(): Promise<ToolDetection> {
    const result = await runCommand({
      command: 'npx',
      args: ['--no-install', 'prettier', '--version'],
      timeoutMs: 10_000
    })
    if (result.spawnError || result.exitCode !== 0) {
      const fallback = await runCommand({
        command: 'prettier',
        args: ['--version'],
        timeoutMs: 5_000
      })
      if (fallback.spawnError || fallback.exitCode !== 0) {
        return {
          available: false,
          reason: result.spawnErrorMessage ?? 'prettier --version failed'
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

    info(`lint/prettier: checking ${files.length} files`)
    const result = await runCommand({
      command: 'npx',
      args: [
        '--no-install',
        'prettier',
        '--check',
        '--no-error-on-unmatched-pattern',
        ...files
      ],
      cwd: repoRoot
    })

    if (result.spawnError) {
      info(`lint/prettier: spawn failed: ${result.spawnErrorMessage ?? ''}`)
      return []
    }

    // Prettier 把不符合格式的文件名输出到 stderr，每行一个：
    // "[warn] src/foo.ts"
    const unformatted: string[] = []
    const combined = `${result.stderr}\n${result.stdout}`
    for (const rawLine of combined.split('\n')) {
      const m = rawLine.match(/^\[warn\]\s+(.+\S)\s*$/)
      if (m != null && !m[1].startsWith('Code style issues')) {
        unformatted.push(m[1])
      }
    }

    return unformatted.map<LintResult>(file => ({
      tool: this.displayName,
      toolVersion: this.resolvedVersion,
      file,
      line: 1,
      column: 1,
      severity: 'warning',
      ruleId: 'prettier/format',
      message: 'File is not formatted according to Prettier rules.',
      fixable: true,
      category: 'style'
    }))
  }
}
