/**
 * lint/orchestrator.ts - 工具编排引擎
 *
 * 串联整个 Linter/SAST 扫描流程：
 *   1. 从 Action 输入读 toolEnableOverrides（取代早期的 .codesentinel.yaml 加载）
 *   2. 注册的工具适配器列表 → 过滤出"启用 + 可用"的工具
 *   3. 按文件扩展名为每个工具挑选目标文件
 *   4. 并行执行所有工具
 *   5. 合并结果 → 变更行过滤 → 去重
 *   6. 生成 LintReport（结果 + 各工具统计）
 *
 * 失败容忍：
 *   - 单个工具检测失败 → 跳过该工具，继续其他工具
 *   - 单个工具 scan 抛异常 → 记录警告，记入 ToolSummary，不阻塞总流程
 */

import {info, warning} from '@actions/core'
import {
  buildPatchScans,
  toAddedLineMap,
  type PatchScanMap
} from '../changed-lines'
import {EslintAdapter} from './adapters/eslint'
import {BiomeAdapter} from './adapters/biome'
import {PrettierAdapter} from './adapters/prettier'
import {SemgrepAdapter} from './adapters/semgrep'
import {TscAdapter} from './adapters/tsc'
import {
  collapseAdjacentFindings,
  deduplicateResults,
  filterByChangedLines
} from './lint-filter'
import {
  type LintReport,
  type LintResult,
  type ToolAdapter,
  type ToolSummary
} from './types'

export interface OrchestratorOptions {
  /** 仓库根目录（绝对路径） */
  repoRoot: string
  /** PR 中变更的文件元组列表 */
  filesAndChanges: Array<
    [string, string, string, Array<[number, number, string]>]
  >
  /** 单个工具超时（毫秒） */
  toolTimeoutMs?: number
  /** 是否禁用全部工具扫描（开关由调用方传入） */
  disabled?: boolean
  /**
   * 每适配器启用覆盖（取代早期 .codesentinel.yaml）
   *
   * key = adapter.name（'eslint' / 'biome' / 'tsc' / 'prettier'）；
   * value = true 强制启用、false 强制禁用、缺失则回退到 adapter.defaultEnabled。
   * 由 review.ts 从 Action input（enable_eslint 等）收集后传入。
   */
  toolEnableOverrides?: Record<string, boolean>
  /**
   * 每适配器的工具版本覆盖（semver 范围字符串）
   *
   * 用于避免"ai-reviewer pin 的版本与消费方本地装的版本不一致"。
   * key = adapter.name，value = `^8.57.0` 等 semver 范围。
   * 仅当用户在 workflow 显式填写（如 `with: eslint_version: '^8.57.0'`）时
   * 此 map 才包含对应 key；其他 key 走 adapter 自带 installSpec.version 默认值。
   */
  toolVersionOverrides?: Record<string, string>
  /**
   * 预先在 review.ts 一次性扫描得到的 PatchScanMap。
   *
   * 传入后本模块跳过对 fileDiff 的二次 walk；未传入时回退到内部构建（保持
   * 单元测试与独立调用方的兼容性）。
   */
  patchScans?: PatchScanMap
  /**
   * Semgrep 规则集（来自 Action 输入 `semgrep_config`）。
   *
   * 仅在用户开启 `enable_semgrep` 时生效；未传入时 SemgrepAdapter 用
   * 默认值 `p/default`（OWASP-Top-10）。
   * 典型取值：`p/default` / `auto` / `p/security-audit` / `p/owasp-top-ten`。
   */
  semgrepConfig?: string
}

/** 内置适配器注册表 */
function defaultAdapters(options: OrchestratorOptions): ToolAdapter[] {
  return [
    new EslintAdapter(),
    new BiomeAdapter(),
    new TscAdapter(),
    new PrettierAdapter(),
    new SemgrepAdapter({config: options.semgrepConfig})
  ]
}

/**
 * 主入口：对 PR 变更文件执行所有启用的工具扫描
 */
export async function runLintTools(
  options: OrchestratorOptions,
  adaptersOverride?: ToolAdapter[]
): Promise<LintReport> {
  const startedAt = Date.now()

  if (options.disabled === true) {
    info('lint: orchestrator disabled, skipping')
    return emptyReport(startedAt)
  }

  const adapters = adaptersOverride ?? defaultAdapters(options)
  const overrides = options.toolEnableOverrides ?? {}

  // 1) 选出"用户启用"的适配器：Action input override 优先，缺失时回退到 adapter.defaultEnabled
  //    同时给出每个适配器的启用判定细节，便于排查"semgrep 没跑起来到底是 default-false 还是 override-false"
  const enabledAdapters: ToolAdapter[] = []
  const decisions: string[] = []
  for (const a of adapters) {
    const override = overrides[a.name]
    const enabled = override === undefined ? a.defaultEnabled : override
    const src =
      override === undefined
        ? `default=${a.defaultEnabled}`
        : `override=${override}`
    decisions.push(`${a.name}:${enabled ? 'on' : 'off'}(${src})`)
    if (enabled) enabledAdapters.push(a)
  }
  info(
    `lint: ${enabledAdapters.length}/${adapters.length} adapters enabled — [${decisions.join(
      ', '
    )}]`
  )
  if (enabledAdapters.length === 0) {
    return emptyReport(startedAt)
  }

  // 2) 检测每个工具是否在执行环境中可用（并行）
  //    传入 repoRoot 让适配器能检查项目侧前置条件（如 ESLint 9 的 eslint.config.js）
  //    传入 versionOverrides 让适配器装到与消费方本地一致的版本
  const versionOverrides = options.toolVersionOverrides ?? {}
  const detections = await Promise.all(
    enabledAdapters.map(async a => ({
      adapter: a,
      detection: await safeDetect(a, options.repoRoot, versionOverrides[a.name])
    }))
  )

  const toolSummaries: ToolSummary[] = []
  const allResults: LintResult[] = []
  const changedFiles = options.filesAndChanges.map(([f]) => f)
  // 优先复用 review.ts 预先扫描好的结果；未传入则在此 fallback 自行构建
  const scans = options.patchScans ?? buildPatchScans(options.filesAndChanges)
  const changedLineMap = toAddedLineMap(scans)

  // 3) 对每个可用工具：挑选目标文件 → 执行扫描
  await Promise.all(
    detections.map(async ({adapter, detection}) => {
      const toolStart = Date.now()
      if (!detection.available) {
        warning(
          `lint/${adapter.name}: not available — ${detection.reason ?? 'unknown'}, skipping`
        )
        toolSummaries.push({
          tool: adapter.displayName,
          toolVersion: '',
          available: false,
          unavailableReason: detection.reason,
          errors: 0,
          warnings: 0,
          infos: 0,
          errorsOnChanges: 0,
          warningsOnChanges: 0,
          infosOnChanges: 0,
          filesScanned: 0,
          durationMs: Date.now() - toolStart
        })
        return
      }

      // 文件过滤：扩展名必须在适配器支持列表内
      const targets = changedFiles.filter(f =>
        adapter.fileExtensions.some(ext => f.toLowerCase().endsWith(ext))
      )
      if (targets.length === 0) {
        info(`lint/${adapter.name}: no matching files, skipping`)
        toolSummaries.push({
          tool: adapter.displayName,
          toolVersion: detection.version ?? '',
          available: true,
          errors: 0,
          warnings: 0,
          infos: 0,
          errorsOnChanges: 0,
          warningsOnChanges: 0,
          infosOnChanges: 0,
          filesScanned: 0,
          durationMs: Date.now() - toolStart
        })
        return
      }

      let results: LintResult[] = []
      try {
        results = await adapter.scan(targets, options.repoRoot)
      } catch (e) {
        warning(
          `lint/${adapter.name}: scan threw: ${
            e instanceof Error ? e.message : String(e)
          }, treating as no findings`
        )
      }

      const counts = countSeverities(results)
      toolSummaries.push({
        tool: adapter.displayName,
        toolVersion: detection.version ?? '',
        available: true,
        errors: counts.error,
        warnings: counts.warning,
        infos: counts.info,
        // 占位：稍后做完全局 filter+dedup 后回填实际写到 PR 评论的数量
        errorsOnChanges: 0,
        warningsOnChanges: 0,
        infosOnChanges: 0,
        filesScanned: targets.length,
        durationMs: Date.now() - toolStart
      })
      info(
        `lint/${adapter.name}: ${results.length} raw findings (${counts.error}E/${counts.warning}W/${counts.info}I) on ${targets.length} files in ${Date.now() - toolStart}ms`
      )
      allResults.push(...results)
    })
  )

  // 4) 变更行过滤 → 同行同款去重 → 跨行相邻同款合并
  //
  //    三步分工：
  //    - filterByChangedLines：仅留 PR 变更行 ± tolerance 的 finding
  //    - deduplicateResults：同行同规则同 message → 折叠为 1（去掉跨工具 / 多列重复）
  //    - collapseAdjacentFindings：连续多行同款 → 合并为单个 range
  //      （如 tsc 在 line 88/89 都报 'Cannot find name Buffer' → '88-89'）
  const changedFiltered = filterByChangedLines(allResults, changedLineMap)
  const deduped = deduplicateResults(changedFiltered)
  const collapsed = collapseAdjacentFindings(deduped)

  // 按 (file, line) 排序便于阅读
  collapsed.sort((a, b) => {
    if (a.file !== b.file) return a.file.localeCompare(b.file)
    return a.line - b.line
  })

  // 5) 回填每个工具"实际写到 PR 评论的数量"（post-filter + post-dedup + post-collapse）
  //    这样统计表能同时显示 "X / Y" — X=进了评论的, Y=工具原始扫描的，
  //    避免 tsc 这类项目级扫描器给出"43 errors 但只看到 3 条评论"的迷惑。
  //    用 `collapsed` 计数：相邻合并后 88-89 算 1 条评论而非 2 条 —— 与
  //    实际写到 PR 评论的数量保持一致。
  const onChangesByTool = new Map<
    string,
    {error: number; warning: number; info: number}
  >()
  for (const r of collapsed) {
    const c = onChangesByTool.get(r.tool) ?? {error: 0, warning: 0, info: 0}
    if (r.severity === 'error') c.error++
    else if (r.severity === 'warning') c.warning++
    else c.info++
    onChangesByTool.set(r.tool, c)
  }
  for (const summary of toolSummaries) {
    const c = onChangesByTool.get(summary.tool) ?? {
      error: 0,
      warning: 0,
      info: 0
    }
    summary.errorsOnChanges = c.error
    summary.warningsOnChanges = c.warning
    summary.infosOnChanges = c.info
  }

  return {
    results: collapsed,
    toolSummaries,
    durationMs: Date.now() - startedAt,
    filesScanned: changedFiles.length
  }
}

async function safeDetect(
  adapter: ToolAdapter,
  repoRoot: string,
  versionOverride: string | undefined
): ReturnType<ToolAdapter['detect']> {
  try {
    return await adapter.detect(repoRoot, versionOverride)
  } catch (e) {
    return {
      available: false,
      reason: e instanceof Error ? e.message : String(e)
    }
  }
}

function countSeverities(results: LintResult[]): {
  error: number
  warning: number
  info: number
} {
  let error = 0
  let warn = 0
  let infoN = 0
  for (const r of results) {
    if (r.severity === 'error') error++
    else if (r.severity === 'warning') warn++
    else infoN++
  }
  return {error, warning: warn, info: infoN}
}

function emptyReport(startedAt: number): LintReport {
  return {
    results: [],
    toolSummaries: [],
    durationMs: Date.now() - startedAt,
    filesScanned: 0
  }
}
