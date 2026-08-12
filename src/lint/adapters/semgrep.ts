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
 *   - 默认规则集 = `p/default`：覆盖 OWASP-Top-10 的 Registry 配置。
 *     **首次运行需联网拉取规则集**（从 semgrep.dev），后续命中本地缓存即离线可用。
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

import {info, warning} from '../../actions-log'
import {dirname} from 'path'
import {ensureToolInstalled} from '../tool-installer'
import {type InstallSpec, type LintResult, type ToolAdapter, type ToolDetection} from '../types'
import {extractVersion, parseJsonSafe, runCommand} from './exec'

/** semgrep `--json` 输出中单条 finding 的字段（仅保留我们消费的部分） */
interface SemgrepResult {
  check_id: string
  path: string
  start: {line: number; col: number}
  end: {line: number; col: number}
  extra: {
    /** 'ERROR' | 'WARNING' | 'INFO' | 'CRITICAL'（2.x+） */
    severity?: string
    message?: string
    /** 自动修复建议；存在即视为 fixable，文本被透传到 LintResult.suggestion */
    fix?: string
    /** 规则元数据；本适配器消费 cwe / owasp 提示 LLM 漏洞分类 */
    metadata?: {
      /** CWE 数组（如 ['CWE-95: ...']）或单字符串 —— 不同规则集格式不一 */
      cwe?: string | string[]
      /** OWASP 分类（如 ['A03:2021 - Injection']） */
      owasp?: string | string[]
      [key: string]: unknown
    }
  }
}

/** semgrep `--json` 顶层结构 */
interface SemgrepOutput {
  results: SemgrepResult[]
  errors?: unknown[]
  version?: string
  /**
   * semgrep 1.x+ 在 `--json` 里附带的目录/文件统计；不同版本字段不全
   * 一致，统一按 `unknown` 取出后在日志里手动 narrow，避免接口噪音。
   */
  paths?: {
    scanned?: string[]
    skipped?: Array<{path?: string; reason?: string}>
  }
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
  /**
   * 沙箱 python-tools/bin 路径，必须前置到 PATH —— 否则 `semgrep` 二进制内
   * `execvp("pysemgrep")` 会按 PATH 查找 Python 后端而找不到，报：
   *   `Unix_error: No such file or directory execvp pysemgrep`
   * 这是 semgrep 1.x 以来"OCaml 壳 + Python 后端"架构的固有约束。
   */
  private binDir = ''

  constructor(options?: {config?: string}) {
    this.config = options?.config ?? 'p/default'
  }

  async detect(repoRoot: string, versionOverride?: string): Promise<ToolDetection> {
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
        `lint/semgrep[detect]: install failed after ${Date.now() - detectStart}ms — ${
          install.reason ?? 'unknown'
        }`
      )
      return {
        available: false,
        reason: `bundled Semgrep install failed: ${install.reason ?? 'unknown'}`
      }
    }
    this.resolvedBinPath = install.binPath as string
    // pip --target 的 bin 脚本依赖 PYTHONPATH 找到包代码；
    // 同时 semgrep 二进制内部会 `execvp("pysemgrep")`，所以 bin 目录必须前置到 PATH。
    // `<sandbox>/python-tools/bin/semgrep` →
    //   binDir     = `<sandbox>/python-tools/bin`（注入 PATH，execvp pysemgrep 用）
    //   pythonPath = `<sandbox>/python-tools`  （注入 PYTHONPATH，import 找代码用）
    // 用 path.dirname 而不是正则剥离 —— 不依赖 binName 字面值是 'semgrep'，
    // 也兼容 Windows 路径分隔符
    this.binDir = dirname(this.resolvedBinPath)
    this.pythonPath = dirname(this.binDir)
    info(
      `lint/semgrep[detect]: install ok — binPath=${this.resolvedBinPath}, pythonPath=${this.pythonPath}, binDir=${this.binDir}`
    )

    // 2) `semgrep --version` 校验
    info(
      `lint/semgrep[detect]: invoking ${this.resolvedBinPath} --version (with PYTHONPATH + PATH-prepend injected)`
    )
    const versionResult = await runCommand({
      command: this.resolvedBinPath,
      args: ['--version'],
      cwd: repoRoot,
      timeoutMs: 15_000,
      env: this.buildEnv()
    })
    if (versionResult.spawnError || versionResult.exitCode !== 0) {
      const stderrSnippet =
        versionResult.stderr
          .split('\n')
          .find(l => l.trim().length > 0)
          ?.substring(0, 120) ?? ''
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

    // 3) 规则集探测：用 --dump-config 独立验证 `--config=<x>` 真的解析并加载了规则。
    //    这一步与后续 scan 解耦：即使代码 0 finding，也能从日志里看到"加载了 N 条规则"
    //    的证据，避免"参数传对了但规则没生效"型的隐性失败。失败仅 warn，不影响 detect 结果。
    await this.probeRulePack(repoRoot)

    info(
      `lint/semgrep[detect]: ready in ${Date.now() - detectStart}ms — bin=${
        this.resolvedBinPath
      }, version=${version}, config=${this.config}`
    )
    return {available: true, version}
  }

  /**
   * 跑一次 `semgrep scan --validate --config=<this.config>`，验证规则集真的
   * 能被加载（且 yaml/Registry 解析通过），不实际扫描任何文件。
   *
   * 用途：在 GitHub Action 日志里得到"规则真的被 semgrep 加载了"的物证。
   * 这是排查 `p/default 配置传对了但 0 finding` 类问题最直接的手段。
   *
   * 为什么不用 `--dump-config`：semgrep 1.x 把 dump-config 收编到 scan 子命令
   * 下，但 scan 同时要求 TARGETS 位置参数，没有 TARGETS 时返回 exit=2 + Usage。
   * 加上 TARGETS 又会触发真扫描（即便有 --dump-config）。`--validate` 没有
   * 这个矛盾：只加载并校验规则集然后退出。
   *
   * 失败容忍：任何错误（联网失败 / yaml 损坏 / --validate 不支持）只 `warning`，
   * 不阻断 detect。即使探测失败，scan 阶段仍按原计划执行。
   */
  private async probeRulePack(repoRoot: string): Promise<void> {
    const probeStart = Date.now()
    info(
      `lint/semgrep[probe]: validating rule pack "${this.config}" via semgrep scan --validate ` +
        `(no targets needed — just confirms rules can be loaded & parsed)`
    )
    const probe = await runCommand({
      command: this.resolvedBinPath,
      args: [
        'scan',
        '--validate',
        '--disable-version-check',
        '--metrics=off',
        `--config=${this.config}`
      ],
      cwd: repoRoot,
      timeoutMs: 30_000,
      env: this.buildEnv()
    })

    const elapsed = Date.now() - probeStart

    if (probe.spawnError || probe.timedOut || probe.exitCode !== 0) {
      const stderrSnippet =
        probe.stderr
          .split('\n')
          .find(l => l.trim().length > 0)
          ?.substring(0, 300) ?? ''
      const stdoutSnippet =
        probe.stdout
          .split('\n')
          .find(l => l.trim().length > 0)
          ?.substring(0, 200) ?? ''
      warning(
        `lint/semgrep[probe]: --validate failed (exit=${probe.exitCode}, timedOut=${probe.timedOut}, ` +
          `elapsed=${elapsed}ms). Rule pack "${this.config}" may NOT be loaded. ` +
          `Common causes: (1) config name typo (2) cannot reach semgrep.dev to fetch ` +
          `the ruleset (3) invalid yaml in a custom config file. ` +
          `stderr: "${stderrSnippet}"${
            stdoutSnippet.length > 0 ? ` stdout: "${stdoutSnippet}"` : ''
          }`
      )
      return
    }

    // semgrep --validate 在不同版本里有不同的输出：
    //   1.x 通常往 stderr 打 "Configuration is valid - found N valid rule(s)" 一类的句子
    //   有些版本完全静默（exit=0 即代表 valid）
    //   有些版本在 stdout 把 rule path 打出来
    // 这里两边都搜，能拿到 N 就给出 N，拿不到就只报"validated successfully"
    const combined = `${probe.stderr}\n${probe.stdout}`
    const ruleCountMatch = combined.match(/(\d+)\s+(?:valid\s+)?rule/i)
    const ruleCount = ruleCountMatch?.[1] ?? '?'

    info(
      `lint/semgrep[probe]: ✅ "${
        this.config
      }" validates — ${ruleCount} rule(s) loaded in ${elapsed}ms${
        ruleCount === '?'
          ? " (semgrep didn't print a rule count; exit=0 still proves config loaded)"
          : ''
      }`
    )

    // 把 stderr 头几行也打出来 —— semgrep 在 validate 时偶尔会附带规则来源 / 警告
    // （如 "loaded rules from https://semgrep.dev/c/p/default" 或弃用提示），
    // 对诊断"规则到底从哪来"很有价值
    const stderrLines = probe.stderr
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0)
      .slice(0, 5)
      .map(l => l.substring(0, 200))
    if (stderrLines.length > 0) {
      info(
        `lint/semgrep[probe]: validate stderr (first 5 non-empty lines): ${stderrLines.join(' | ')}`
      )
    }
  }

  async scan(files: string[], repoRoot: string): Promise<LintResult[]> {
    if (this.resolvedBinPath === '') {
      // 防御：orchestrator 保证 detect 成功才会调 scan；这里仅锁住"绕过 orchestrator
      // 直接 new SemgrepAdapter().scan(...)"的误用，避免给 runCommand 传空 command
      warning('lint/semgrep[scan]: called before successful detect() — bin path empty, skipping')
      return []
    }
    if (files.length === 0) {
      info(
        'lint/semgrep[scan]: targets is empty (no matching file extensions in changed set) — skip'
      )
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
      `lint/semgrep[scan]: invoking ${this.resolvedBinPath} ${args.slice(0, 6).join(' ')} ... [${
        files.length
      } file arg(s)]`
    )
    const result = await runCommand({
      command: this.resolvedBinPath,
      args,
      cwd: repoRoot,
      timeoutMs: 120_000, // 比其他工具略长：semgrep 在 ~100 文件上可能 30-60s
      env: this.buildEnv()
    })

    const elapsed = Date.now() - scanStart
    const stderrFirstLine =
      result.stderr
        .split('\n')
        .find(l => l.trim().length > 0)
        ?.substring(0, 200) ?? ''
    info(
      `lint/semgrep[scan]: returned in ${elapsed}ms — exit=${result.exitCode}, ` +
        `timedOut=${result.timedOut}, spawnError=${result.spawnError}, ` +
        `stdout_len=${result.stdout.length}, stderr_len=${result.stderr.length}${
          stderrFirstLine.length > 0 ? `, stderr_first="${stderrFirstLine}"` : ''
        }`
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
          `(c) semgrep CLI was killed by signal. Raw stdout first 500 chars: "${result.stdout.substring(
            0,
            500
          )}"`
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

    // 扫描覆盖面：semgrep 自己上报"实际扫了哪些文件 / 跳过了哪些"。0 finding 多半
    // 不是规则没生效，而是文件被 skipped（语言不匹配 / 大文件 / 二进制等）—— 把它显式打出来。
    const scannedPaths = parsed.paths?.scanned ?? []
    const skippedPaths = parsed.paths?.skipped ?? []
    info(
      `lint/semgrep[scan]: coverage — scanned=${scannedPaths.length}/${files.length} input file(s), ` +
        `skipped=${skippedPaths.length}`
    )
    if (scannedPaths.length > 0) {
      info(
        `lint/semgrep[scan]: scanned files: ${scannedPaths.slice(0, 5).join(', ')}${
          scannedPaths.length > 5 ? ', ...' : ''
        }`
      )
    }
    if (skippedPaths.length > 0) {
      // 只取前 3 条，附带 reason；常见 reason: "too_big" / "wrong_language" / "always_skipped"
      const skipSample = skippedPaths
        .slice(0, 3)
        .map(s => `${s.path ?? '?'}(${s.reason ?? '?'})`)
        .join(', ')
      info(`lint/semgrep[scan]: skipped sample: ${skipSample}`)
    }

    const findings: LintResult[] = []
    for (const r of parsed.results ?? []) {
      // semgrep 报告路径默认是相对 cwd 的；少数模式下可能给绝对路径
      let relFile = r.path
      if (relFile.startsWith(repoRoot)) {
        relFile = relFile.substring(repoRoot.length).replace(/^[/\\]/, '')
      }
      // 把 CWE / OWASP 分类拼到 message 末尾，帮 LLM 在评论里准确说出漏洞分类
      // （Semgrep 默认 message 通常只描述"做了什么"，不带"属于哪类漏洞"）
      const baseMessage = r.extra?.message?.trim() ?? ''
      const tags = formatVulnTags(r.extra?.metadata)
      const enrichedMessage = tags.length > 0 ? `${baseMessage}\n${tags}` : baseMessage

      const fixText =
        typeof r.extra?.fix === 'string' && r.extra.fix.length > 0 ? r.extra.fix.trim() : undefined

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
        message: enrichedMessage,
        // 把 semgrep 自带的自动修复文本透传给 LLM —— 评论里 AI 可以直接基于此
        // 生成 diff 修复建议而不是凭空构造
        suggestion: fixText,
        fixable: fixText != null,
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
          `(3) did semgrep silently skip the files (look at "scanned/skipped" log line above)`
      )
    } else {
      // finding 的 check_id 前缀分布 —— 用来验证规则来源（如 `javascript.lang.security.*`
      // 多半来自 p/default；陌生前缀提示 config 被指向了其他规则集）
      const findingPrefixes = new Map<string, number>()
      const findingSeverities = new Map<string, number>()
      for (const f of findings) {
        const prefix = f.ruleId.split('.').slice(0, 2).join('.')
        findingPrefixes.set(prefix, (findingPrefixes.get(prefix) ?? 0) + 1)
        findingSeverities.set(f.severity, (findingSeverities.get(f.severity) ?? 0) + 1)
      }
      const fmtMap = (m: Map<string, number>): string =>
        [...m.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => `${k}:${v}`)
          .join(', ')
      info(`lint/semgrep[scan]: finding rule_id prefix breakdown = { ${fmtMap(findingPrefixes)} }`)
      info(`lint/semgrep[scan]: finding severity breakdown = { ${fmtMap(findingSeverities)} }`)
      info(
        `lint/semgrep[scan]: first 3 finding rule_ids: ${findings
          .slice(0, 3)
          .map(f => f.ruleId)
          .join(' | ')}`
      )
    }
    info(
      `lint/semgrep[scan]: parsed ${findings.length} finding(s) from ${rawCount} raw result(s) ` +
        `across ${files.length} input file(s) in ${elapsed}ms`
    )
    return findings
  }

  /**
   * 构造调用 semgrep 时的环境变量。
   *
   * 必须同时注入：
   *   - PYTHONPATH（**前置**到用户原有 PYTHONPATH，不整体覆盖）：让 pip --target
   *     装的 semgrep 包能被 Python import；保留用户原值便于自托管 runner 的
   *     自定义 Python 配置
   *   - PATH（前置 binDir）：semgrep OCaml 二进制内部 `execvp("pysemgrep")` /
   *     `execvp("osemgrep")` 都会按 PATH 查找子进程；如果 binDir 不在 PATH，
   *     会直接报 `Unix_error: No such file or directory execvp pysemgrep`
   *
   * 也关掉 metrics + version-check 的子流程（这些子流程偶尔也走 execvp）。
   */
  private buildEnv(): Record<string, string> {
    const sep = process.platform === 'win32' ? ';' : ':'
    const existingPythonPath = process.env.PYTHONPATH ?? ''
    const existingPath = process.env.PATH ?? ''
    return {
      // 前置：沙箱优先，但保留用户的 PYTHONPATH（如有）
      PYTHONPATH:
        existingPythonPath.length > 0
          ? `${this.pythonPath}${sep}${existingPythonPath}`
          : this.pythonPath,
      PYTHONDONTWRITEBYTECODE: '1',
      // 前置：沙箱 bin 优先，保证 execvp pysemgrep 能找到子进程
      PATH: `${this.binDir}${sep}${existingPath}`,
      // 关掉 metrics 上报，避免子进程意外触发额外 execvp
      SEMGREP_SEND_METRICS: 'off'
    }
  }
}

/**
 * 从 semgrep finding 的 metadata 中提取 CWE / OWASP 标签，格式化为
 * 单行 `[CWE-95, OWASP A03:2021]` 形式，拼到 message 后供 LLM 消费。
 *
 * 单字符串 / 字符串数组两种格式都支持。空时返回空串。
 */
function formatVulnTags(metadata?: SemgrepResult['extra']['metadata']): string {
  if (metadata == null) return ''
  const parts: string[] = []

  const cwe = toStringArray(metadata.cwe)
  for (const c of cwe) {
    // CWE 完整字符串通常是 "CWE-95: Improper Neutralization..." —— 只取冒号前的 ID
    const id = c.split(':')[0].trim()
    if (id.length > 0) parts.push(id)
  }
  const owasp = toStringArray(metadata.owasp)
  for (const o of owasp) {
    // OWASP 字符串通常是 "A03:2021 - Injection"；不去 colon，整段保留更可读
    const trimmed = o.trim()
    if (trimmed.length > 0) parts.push(`OWASP ${trimmed}`)
  }

  if (parts.length === 0) return ''
  return `[${parts.join(', ')}]`
}

/** 把 string | string[] | undefined 统一成 string[] */
function toStringArray(v: unknown): string[] {
  if (typeof v === 'string') return [v]
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string')
  return []
}

/**
 * 把 semgrep 大写 severity 标准化到 LintResult 的小写枚举
 *
 *   'CRITICAL'/'HIGH' → 'error'   （semgrep 2.x+ 引入；旧版本不发，加上向后兼容也无害）
 *   'ERROR'           → 'error'
 *   'WARNING'/'MEDIUM'→ 'warning'
 *   'INFO'/'LOW'      → 'info'
 *   缺失 / 未知       → 'warning'（保守兜底）
 */
function mapSemgrepSeverity(raw?: string): 'error' | 'warning' | 'info' {
  switch ((raw ?? '').toUpperCase()) {
    case 'CRITICAL':
    case 'HIGH':
    case 'ERROR':
      return 'error'
    case 'INFO':
    case 'LOW':
      return 'info'
    case 'WARNING':
    case 'MEDIUM':
      return 'warning'
    default:
      return 'warning'
  }
}
