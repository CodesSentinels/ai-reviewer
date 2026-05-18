/**
 * lint/adapters/semgrep.ts — Semgrep SAST 适配器（Phase 4：通用安全扫描）
 *
 * Semgrep 是支持 30+ 语言的模式匹配 SAST，与 ESLint/Biome/tsc 互补：
 *   - ESLint/Biome：JS/TS 风格 + 通用质量规则
 *   - tsc：类型错误
 *   - **Semgrep：跨语言安全模式**（SQL 注入、命令注入、硬编码秘密、不安全反序列化…）
 *
 * 设计选择：
 *   - 安装策略 = pip：semgrep 是 Python 工具，没有真正的"单文件预编译二进制"。
 *     发布形态主要是 `pip install semgrep`（也支持 docker）。我们选 pip，
 *     落到沙箱 `/tmp/ai-reviewer-lint-tools/python-tools/bin/semgrep`。
 *   - 默认规则集 = `p/default`：内置 OWASP-Top-10，离线可用、跨版本稳定。
 *     用户可通过 `with: semgrep_config: '<other>'` 覆盖（如 `auto` / `p/security-audit`）。
 *   - 默认 enable = **false**：与 Prettier 同款保守。Semgrep 冷启动 +15-30s，
 *     SAST 适合 opt-in 而非默认开启（避免给所有用户加 review 等待时间）。
 *
 * 输出解析：`semgrep scan --json` 返回如下结构（截取关键字段）：
 *   {
 *     "results": [
 *       {
 *         "check_id": "python.lang.security.audit.dangerous-system-call.dangerous-system-call",
 *         "path": "src/utils.py",
 *         "start": {"line": 42, "col": 3},
 *         "end":   {"line": 42, "col": 60},
 *         "extra": {
 *           "severity": "ERROR",            // "ERROR" | "WARNING" | "INFO"
 *           "message": "Detected subprocess call ...",
 *           "metadata": {"cwe": [...], "owasp": [...]},
 *           "fix": "...optional..."         // 出现时表示可自动修复
 *         }
 *       }
 *     ],
 *     "errors": [...],   // 解析失败的文件等（与 results 同级，不进 LintResult）
 *     "version": "1.95.0"
 *   }
 *
 * Semgrep 的所有 finding 都是安全相关 → category 统一标 `security`，
 * 这样在 PR 摘要 / 评论里能与 lint findings 形成鲜明对照。
 */

import {info, warning} from '@actions/core'
import {ensureToolInstalled} from '../tool-installer'
import {
  type InstallSpec,
  type LintResult,
  type ToolAdapter,
  type ToolDetection
} from '../types'
import {extractVersion, parseJsonSafe, runCommand} from './exec'

/** semgrep `--json` 输出中单条 finding 的字段（仅保留我们消费的部分） */
interface SemgrepResult {
  check_id: string
  path: string
  start: {line: number; col: number}
  end: {line: number; col: number}
  extra: {
    severity?: string
    message?: string
    fix?: string
    metadata?: Record<string, unknown>
  }
}

/** semgrep `--json` 顶层结构 */
interface SemgrepOutput {
  results: SemgrepResult[]
  errors?: unknown[]
  version?: string
}

export class SemgrepAdapter implements ToolAdapter {
  readonly name = 'semgrep'
  readonly displayName = 'Semgrep'
  /**
   * Semgrep 支持 30+ 语言，这里列出本仓库最常见 + Phase 1/2/3 已覆盖的扩展名。
   * 即使列表里没有的扩展，semgrep 在 `--config=p/default` 下也会智能跳过。
   */
  readonly supportedLanguages = [
    'javascript',
    'typescript',
    'python',
    'go',
    'ruby',
    'java',
    'c',
    'cpp',
    'csharp',
    'php',
    'rust',
    'kotlin',
    'swift',
    'scala'
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
    '.py',
    '.pyi',
    '.go',
    '.rb',
    '.java',
    '.c',
    '.h',
    '.cc',
    '.cpp',
    '.cs',
    '.php',
    '.rs',
    '.kt',
    '.kts',
    '.swift',
    '.scala'
  ]
  /** 默认关闭：冷启动开销 + 误报噪音 → 让用户显式 opt-in */
  readonly defaultEnabled = false

  readonly installSpec: InstallSpec = {
    kind: 'pip',
    package: 'semgrep',
    binName: 'semgrep',
    version: '^1.95.0'
  }

  /** 规则集；构造时可覆盖（来自 Action 输入 `semgrep_config`） */
  readonly config: string

  private resolvedBinPath = ''
  private resolvedVersion = ''
  /** 沙箱 python-tools 路径，注入到 PYTHONPATH 让 semgrep CLI 能 import 自己 */
  private pythonPath = ''

  constructor(options?: {config?: string}) {
    this.config = options?.config ?? 'p/default'
  }

  async detect(
    repoRoot: string,
    versionOverride?: string
  ): Promise<ToolDetection> {
    const detectStart = Date.now()
    info(
      `lint/semgrep[detect]: start repoRoot=${repoRoot}, versionOverride=${
        versionOverride ?? '(default)'
      }, config=${this.config}`
    )

    // 1) pip 装包
    const spec: InstallSpec =
      versionOverride != null && versionOverride.length > 0
        ? {...this.installSpec, version: versionOverride}
        : this.installSpec
    info(
      `lint/semgrep[detect]: ensureToolInstalled(kind=pip, package=semgrep, version=${spec.version})`
    )
    const install = await ensureToolInstalled(spec)
    if (!install.ok) {
      warning(
        `lint/semgrep[detect]: install failed after ${Date.now() - detectStart}ms — ${install.reason ?? 'unknown'}`
      )
      return {
        available: false,
        reason: `bundled Semgrep install failed: ${install.reason ?? 'unknown'}`
      }
    }
    this.resolvedBinPath = install.binPath as string
    // pip --target 的 bin 脚本依赖 PYTHONPATH 找到包代码
    // 沙箱路径 = installBin 上两级（`<sandbox>/python-tools/bin/semgrep` → `<sandbox>/python-tools`）
    this.pythonPath = this.resolvedBinPath
      .replace(/[/\\]bin[/\\]semgrep$/, '')
    info(
      `lint/semgrep[detect]: install ok — binPath=${this.resolvedBinPath}, pythonPath=${this.pythonPath}`
    )

    // 2) `semgrep --version` 校验
    info(`lint/semgrep[detect]: invoking ${this.resolvedBinPath} --version (with PYTHONPATH injected)`)
    const versionResult = await runCommand({
      command: this.resolvedBinPath,
      args: ['--version'],
      cwd: repoRoot,
      timeoutMs: 15_000,
      env: {PYTHONPATH: this.pythonPath}
    })
    if (versionResult.spawnError || versionResult.exitCode !== 0) {
      const stderrSnippet =
        versionResult.stderr.split('\n').find(l => l.trim().length > 0)?.substring(0, 120) ?? ''
      warning(
        `lint/semgrep[detect]: --version failed exit=${versionResult.exitCode}, ` +
          `spawnError=${versionResult.spawnError}, stderr="${stderrSnippet}"`
      )
      return {
        available: false,
        reason: `bundled semgrep --version failed: exit=${versionResult.exitCode}; stderr="${stderrSnippet}"`
      }
    }
    const version = extractVersion(versionResult.stdout)
    this.resolvedVersion = version
    info(
      `lint/semgrep[detect]: ready in ${Date.now() - detectStart}ms — bin=${this.resolvedBinPath}, version=${version}, config=${this.config}`
    )
    return {available: true, version}
  }

  async scan(files: string[], repoRoot: string): Promise<LintResult[]> {
    if (files.length === 0) {
      info('lint/semgrep[scan]: targets is empty (no matching file extensions in changed set) — skip')
      return []
    }
    const scanStart = Date.now()
    info(
      `lint/semgrep[scan]: start config=${this.config}, files=${files.length} — sample: ${files
        .slice(0, 5)
        .join(', ')}${files.length > 5 ? ', ...' : ''}`
    )

    const args = [
      'scan',
      '--json',
      '--quiet',
      '--disable-version-check',
      '--metrics=off',
      `--config=${this.config}`,
      ...files
    ]
    info(
      `lint/semgrep[scan]: invoking ${this.resolvedBinPath} ${args
        .slice(0, 6)
        .join(' ')} ... [${files.length} file arg(s)]`
    )
    const result = await runCommand({
      command: this.resolvedBinPath,
      args,
      cwd: repoRoot,
      timeoutMs: 120_000, // 比其他工具略长：semgrep 在 ~100 文件上可能 30-60s
      env: {PYTHONPATH: this.pythonPath}
    })

    const elapsed = Date.now() - scanStart
    const stderrFirstLine =
      result.stderr.split('\n').find(l => l.trim().length > 0)?.substring(0, 200) ?? ''
    info(
      `lint/semgrep[scan]: returned in ${elapsed}ms — exit=${result.exitCode}, ` +
        `timedOut=${result.timedOut}, spawnError=${result.spawnError}, ` +
        `stdout_len=${result.stdout.length}, stderr_len=${result.stderr.length}` +
        (stderrFirstLine.length > 0 ? `, stderr_first="${stderrFirstLine}"` : '')
    )

    if (result.spawnError) {
      warning(
        `lint/semgrep[scan]: spawn failed — ${result.spawnErrorMessage ?? ''}. ` +
          `This usually means the semgrep console script lost its PYTHONPATH or python3 disappeared.`
      )
      return []
    }
    if (result.timedOut) {
      warning(
        `lint/semgrep[scan]: timed out after ${elapsed}ms (limit 120000ms). ` +
          `Reduce file count or switch to a smaller --config (e.g. p/security-audit).`
      )
      return []
    }

    // semgrep exit:
    //   0 = no findings
    //   1 = findings present（不是失败，按 lint 行业惯例）
    //   2 = misconfig / 真正的错误（含 registry 拉规则失败）
    // 仅当 stdout 无可解析 JSON 时才视为失败
    const parsed = parseJsonSafe<SemgrepOutput>(result.stdout, 'semgrep')
    if (parsed == null) {
      warning(
        `lint/semgrep[scan]: no parseable JSON in stdout (exit=${result.exitCode}). ` +
          `stderr first line: "${stderrFirstLine}". ` +
          `Common causes: (a) semgrep can't reach semgrep.dev to fetch "${this.config}" rules — ` +
          `try a self-contained config like p/ci or pre-cache rules; ` +
          `(b) semgrep printed Python traceback to stderr; ` +
          `(c) semgrep CLI was killed by signal. Raw stdout first 500 chars: "${result.stdout.substring(0, 500)}"`
      )
      return []
    }

    const rawCount = parsed.results?.length ?? 0
    const errCount = parsed.errors?.length ?? 0
    if (errCount > 0) {
      // semgrep 把"无法解析的文件 / 规则加载错误"放在 errors 数组里 —— 重要诊断信号
      const firstErr = JSON.stringify(parsed.errors?.[0] ?? {}).substring(0, 300)
      warning(
        `lint/semgrep[scan]: ${errCount} semgrep-level error(s) reported (this is separate from "findings"); ` +
          `first: ${firstErr}`
      )
    }

    const findings: LintResult[] = []
    for (const r of parsed.results ?? []) {
      // semgrep 报告路径默认是相对 cwd 的；少数模式下可能给绝对路径
      let relFile = r.path
      if (relFile.startsWith(repoRoot)) {
        relFile = relFile.substring(repoRoot.length).replace(/^[/\\]/, '')
      }
      findings.push({
        tool: this.displayName,
        toolVersion: this.resolvedVersion,
        file: relFile,
        line: r.start.line,
        column: r.start.col,
        endLine: r.end.line,
        endColumn: r.end.col,
        severity: mapSemgrepSeverity(r.extra?.severity),
        ruleId: r.check_id,
        message: r.extra?.message?.trim() ?? '',
        fixable: typeof r.extra?.fix === 'string' && r.extra.fix.length > 0,
        category: 'security'
      })
    }

    if (rawCount === 0) {
      // 0 findings 本身不是错误（代码可能真的没问题），但在测试场景里多半是"规则没匹配上"
      info(
        `lint/semgrep[scan]: 0 findings. ` +
          `If you expected findings on these files, check: ` +
          `(1) does "${this.config}" cover the languages of the scanned files? ` +
          `(2) is the project behind a corporate firewall blocking semgrep.dev? ` +
          `(3) did semgrep silently skip the files (look at stderr_len above and rerun with --debug)`
      )
    }
    info(
      `lint/semgrep[scan]: parsed ${findings.length} finding(s) from ${rawCount} raw result(s) ` +
        `across ${files.length} input file(s) in ${elapsed}ms`
    )
    return findings
  }
}

/**
 * 把 semgrep 大写 severity 标准化到 LintResult 的小写枚举
 *
 *   'ERROR'   → 'error'
 *   'WARNING' → 'warning'
 *   'INFO'    → 'info'
 *   缺失 / 未知 → 'warning'（保守兜底）
 */
function mapSemgrepSeverity(raw?: string): 'error' | 'warning' | 'info' {
  switch ((raw ?? '').toUpperCase()) {
    case 'ERROR':
      return 'error'
    case 'INFO':
      return 'info'
    case 'WARNING':
      return 'warning'
    default:
      return 'warning'
  }
}
