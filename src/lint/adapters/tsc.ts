/**
 * lint/adapters/tsc.ts - TypeScript Compiler (tsc --noEmit) 适配器
 *
 * 提供"类型错误"层面的发现，与 ESLint/Biome 互补：
 *   - ESLint/Biome：lint 规则、风格、未使用变量、可疑模式
 *   - tsc：**类型错误**（参数类型不匹配、属性不存在、可空性误用、async/await 误用）
 *
 * 类型错误是最低误报率的一类发现，几乎都是真问题，与 AI 交叉验证后质量极高。
 *
 * 与 ESLint/Biome 的差异：
 *   - tsc 必须扫**整个项目**（types are inferred transitively across imports），
 *     无法只检查指定文件。orchestrator 后续会按 addedLines 过滤，仅保留落在
 *     PR 变更行上的错误，避免全项目刷屏。
 *   - 性能更慢：小项目 1-3s，中型 5-15s，大型 30s+
 *   - 需要项目自带 `tsconfig.json` 才能跑（与 ESLint 无 Flat Config 同款约束）
 *
 * 输出格式（用 `--pretty false` 让格式稳定可解析）：
 *   src/utils.ts(15,7): error TS2322: Type 'string' is not assignable to type 'number'.
 *   src/utils.ts(20,5): error TS2339: Property 'foo' does not exist on type 'Bar'.
 *
 * 多行错误（type chain）会输出缩进续行，本适配器仅捕获每条错误的第一行
 * （含位置 + ruleId + 主消息），续行的 type chain 详情忽略。
 */

import {info} from '@actions/core'
import {existsSync} from 'fs'
import {join} from 'path'
import {ensureToolInstalled} from '../tool-installer'
import {type InstallSpec, type LintResult, type ToolAdapter, type ToolDetection} from '../types'
import {extractVersion, runCommand} from './exec'

/**
 * 项目根可能存在的 tsconfig 文件名
 *
 * 顺序：标准 tsconfig.json 优先；其他变体（base / app / ci）作为后备
 */
const TSCONFIG_FILES = ['tsconfig.json', 'tsconfig.base.json', 'tsconfig.app.json']

/**
 * 在 repoRoot 寻找 tsconfig；命中即返回文件名
 */
function findTsconfig(repoRoot: string): string | null {
  for (const name of TSCONFIG_FILES) {
    if (existsSync(join(repoRoot, name))) return name
  }
  return null
}

/**
 * 解析 `tsc --pretty false` 的单行错误格式：
 *   `<path>(<line>,<col>): error TS<num>: <message>`
 */
const TSC_LINE_RE = /^(.+?)\((\d+),(\d+)\): (error|warning) (TS\d+): (.+)$/

export class TscAdapter implements ToolAdapter {
  readonly name = 'tsc'
  readonly displayName = 'TypeScript'
  readonly supportedLanguages = ['typescript']
  readonly fileExtensions = ['.ts', '.tsx', '.mts', '.cts']
  /**
   * TS 项目几乎总希望 tsc 介入，所以默认开启。
   * 没装 typescript / 没 tsconfig.json 时会优雅降级（detect 返回 unavailable）。
   */
  readonly defaultEnabled = true

  /**
   * 不含 version：默认版本由 action.yml 的 `tsc_version` default 提供（见 detect）。
   */
  readonly installSpec: InstallSpec = {
    kind: 'npm',
    package: 'typescript',
    binName: 'tsc'
  }

  private resolvedVersion = ''
  private resolvedBinPath = ''

  async detect(repoRoot: string, versionOverride?: string): Promise<ToolDetection> {
    // 1) 沙箱安装 typescript
    const spec: InstallSpec =
      versionOverride && versionOverride.length > 0
        ? {...this.installSpec, version: versionOverride}
        : this.installSpec
    const install = await ensureToolInstalled(spec)
    if (!install.ok) {
      return {
        available: false,
        reason: `bundled TypeScript install failed: ${install.reason ?? 'unknown'}`
      }
    }
    this.resolvedBinPath = install.binPath as string

    // 2) 校验 tsc --version 能正常启动
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
        reason: `bundled tsc --version failed: exit=${versionResult.exitCode}; stderr="${stderrSnippet}"`
      }
    }
    const version = extractVersion(versionResult.stdout)

    // 3) 项目必须有 tsconfig（与 ESLint 改进 A 同款约束）
    const tsconfig = findTsconfig(repoRoot)
    if (tsconfig == null) {
      return {
        available: false,
        version,
        reason:
          'no tsconfig.json found in repo (looked for tsconfig.json, tsconfig.base.json, tsconfig.app.json)'
      }
    }
    info(`lint/tsc: bundled bin=${this.resolvedBinPath}, project tsconfig=${tsconfig}`)

    this.resolvedVersion = version
    return {available: true, version}
  }

  async scan(files: string[], repoRoot: string): Promise<LintResult[]> {
    // 注意：files 参数被忽略 —— tsc 必须扫整个项目（types 跨文件传递），
    // 无法只 type-check 指定文件。orchestrator 会按 addedLines 后过滤到变更行。
    info(`lint/tsc: type-checking project at ${repoRoot} (${files.length} changed TS file(s))`)
    const result = await runCommand({
      command: this.resolvedBinPath,
      args: ['--noEmit', '--pretty', 'false'],
      cwd: repoRoot,
      timeoutMs: 90_000 // 比其他工具略长 — tsc 在大项目上耗时
    })

    if (result.spawnError) {
      info(`lint/tsc: spawn failed: ${result.spawnErrorMessage ?? ''}`)
      return []
    }

    // tsc 把诊断信息输出到 stdout（不是 stderr）；exitCode 非零仅表示"有错误"，不算异常
    const output = result.stdout || result.stderr
    const findings: LintResult[] = []
    for (const rawLine of output.split('\n')) {
      const m = rawLine.match(TSC_LINE_RE)
      if (m == null) continue // 忽略续行 / 空行 / 概要行
      const [, file, lineStr, colStr, severity, ruleId, message] = m

      // 路径归一化为相对仓库根（tsc 默认输出相对 cwd 的路径，但部分配置可能是绝对路径）
      let relFile = file
      if (relFile.startsWith(repoRoot)) {
        relFile = relFile.substring(repoRoot.length).replace(/^[/\\]/, '')
      }

      findings.push({
        tool: this.displayName,
        toolVersion: this.resolvedVersion,
        file: relFile,
        line: parseInt(lineStr, 10),
        column: parseInt(colStr, 10),
        severity: severity === 'error' ? 'error' : 'warning',
        ruleId,
        message: message.trim(),
        fixable: false,
        category: 'quality'
      })
    }
    info(`lint/tsc: ${findings.length} type-check finding(s) before changed-line filter`)
    return findings
  }
}
