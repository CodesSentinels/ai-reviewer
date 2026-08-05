/**
 * lint/index.ts - Linter/SAST 集成对外公开 API
 *
 * 仅导出供 review.ts 使用的高层接口；内部细节（适配器、工具执行）保留私有。
 *
 * 历史：早期还导出过 loadConfig / isToolEnabled / ToolConfig / ToolsConfig
 * 用于解析 `.codesentinel.yaml`。当前版本已彻底移除该机制，所有工具开关都
 * 通过 GitHub Action 输入（enable_eslint / enable_biome / enable_tsc /
 * enable_prettier）控制，消费方无需在自己仓库维护任何配置文件。
 */

export {runLintTools, type OrchestratorOptions} from './orchestrator'
export {formatLintContextForFile, formatLintSummary, formatToolAttribution} from './formatter'
export {type LintResult, type LintReport, type ToolAdapter, type ToolSummary} from './types'
