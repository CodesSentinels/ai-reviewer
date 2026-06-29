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
import {ensureToolInstalled} from '../tool-installer'
import {
  type InstallSpec,
  type LintResult,
  type ToolAdapter,
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

  /**
   * Prettier 自带默认格式规则，无需项目配置即可工作。
   * 不含 version：默认版本由 action.yml 的 `prettier_version` default 提供（见 detect）。
   */
  readonly installSpec: InstallSpec = {
    kind: 'npm',
    package: 'prettier',
    binName: 'prettier'
  }

  private resolvedVersion = ''
  private resolvedBinPath = ''

  async detect(
    repoRoot: string,
    versionOverride?: string
  ): Promise<ToolDetection> {
    const spec: InstallSpec =
      versionOverride && versionOverride.length > 0
        ? {...this.installSpec, version: versionOverride}
        : this.installSpec
    const install = await ensureToolInstalled(spec)
    if (!install.ok) {
      return {
        available: false,
        reason: `bundled Prettier install failed: ${
          install.reason ?? 'unknown'
        }`
      }
    }
    this.resolvedBinPath = install.binPath as string

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
        reason: `bundled Prettier --version failed: exit=${versionResult.exitCode}; stderr="${stderrSnippet}"`
      }
    }

    this.resolvedVersion = extractVersion(versionResult.stdout)
    info(`lint/prettier: bundled bin=${this.resolvedBinPath}`)
    return {available: true, version: this.resolvedVersion}
  }

  async scan(files: string[], repoRoot: string): Promise<LintResult[]> {
    if (files.length === 0) return []

    info(
      `lint/prettier: checking ${files.length} files via ${this.resolvedBinPath}`
    )
    const result = await runCommand({
      command: this.resolvedBinPath,
      args: ['--check', '--no-error-on-unmatched-pattern', ...files],
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
