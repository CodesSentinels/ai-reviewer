/**
 * lint/index.ts - Linter/SAST 集成对外公开 API
 *
 * 仅导出供 review.ts 使用的高层接口；内部细节（适配器、工具执行）保留私有。
 */

export {runLintTools, type OrchestratorOptions} from './orchestrator'
export {
  formatLintContextForFile,
  formatLintSummary,
  formatToolAttribution
} from './formatter'
export {
  type LintResult,
  type LintReport,
  type ToolAdapter,
  type ToolSummary,
  type ToolConfig,
  type ToolsConfig
} from './types'
export {loadConfig, isToolEnabled} from './config'
