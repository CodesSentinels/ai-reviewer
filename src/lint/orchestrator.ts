/**
 * lint/orchestrator.ts - 工具编排引擎
 *
 * 串联整个 Linter/SAST 扫描流程：
 *   1. 加载用户配置（.codesentinel.yaml）
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
import {EslintAdapter} from './adapters/eslint'
import {BiomeAdapter} from './adapters/biome'
import {PrettierAdapter} from './adapters/prettier'
import {
  type CodeSentinelConfig,
  getToolConfig,
  isToolEnabled,
  loadConfig
} from './config'
import {
  buildChangedLineMap,
  deduplicateResults,
  filterByChangedLines
} from './diff-filter'
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
  /** 用户配置覆盖（如果传入则跳过 .codesentinel.yaml 加载） */
  configOverride?: CodeSentinelConfig
}

/** 内置适配器注册表 */
function defaultAdapters(): ToolAdapter[] {
  return [new EslintAdapter(), new BiomeAdapter(), new PrettierAdapter()]
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

  const adapters = adaptersOverride ?? defaultAdapters()
  const config =
    options.configOverride ?? loadConfig(options.repoRoot)

  // 1) 选出"用户启用"的适配器
  const enabledAdapters = adapters.filter(a =>
    isToolEnabled(a.name, config.tools, a.defaultEnabled)
  )
  info(
    `lint: ${enabledAdapters.length}/${adapters.length} adapters enabled by config: [${enabledAdapters
      .map(a => a.name)
      .join(', ')}]`
  )
  if (enabledAdapters.length === 0) {
    return emptyReport(startedAt)
  }

  // 2) 检测每个工具是否在执行环境中可用（并行）
  const detections = await Promise.all(
    enabledAdapters.map(async a => ({
      adapter: a,
      detection: await safeDetect(a)
    }))
  )

  const toolSummaries: ToolSummary[] = []
  const allResults: LintResult[] = []
  const changedFiles = options.filesAndChanges.map(([f]) => f)
  const changedLineMap = buildChangedLineMap(options.filesAndChanges)

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
          filesScanned: 0,
          durationMs: Date.now() - toolStart
        })
        return
      }

      let results: LintResult[] = []
      try {
        results = await adapter.scan(
          targets,
          options.repoRoot,
          getToolConfig(adapter.name, config.tools)
        )
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
        filesScanned: targets.length,
        durationMs: Date.now() - toolStart
      })
      info(
        `lint/${adapter.name}: ${results.length} raw findings (${counts.error}E/${counts.warning}W/${counts.info}I) on ${targets.length} files in ${Date.now() - toolStart}ms`
      )
      allResults.push(...results)
    })
  )

  // 4) 变更行过滤 + 去重
  const changedFiltered = filterByChangedLines(allResults, changedLineMap)
  const deduped = deduplicateResults(changedFiltered)

  // 按 (file, line) 排序便于阅读
  deduped.sort((a, b) => {
    if (a.file !== b.file) return a.file.localeCompare(b.file)
    return a.line - b.line
  })

  return {
    results: deduped,
    toolSummaries,
    durationMs: Date.now() - startedAt,
    filesScanned: changedFiles.length
  }
}

async function safeDetect(adapter: ToolAdapter): ReturnType<ToolAdapter['detect']> {
  try {
    return await adapter.detect()
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
