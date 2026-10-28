/**
 * repo-config-merge.ts - 基线与仓库配置的合并规则（issue #231）
 *
 * 一个没有任何运行时依赖的纯函数模块：两个平台、所有入口都经由同一份合并逻辑，
 * 合并规则可以脱离 Options 单独测试。
 *
 * 规则：
 * - 列表（path_filters / path_instructions）：基线在前，仓库在后，追加
 * - 文本（system_message）：基线 + 仓库的 system_message_append，空行分隔，不替换
 * - 标量：仓库值覆盖基线值
 */

/** 仓库层可设置的字段（已规范化为 Options 使用的形态） */
export interface RepoConfig {
  pathFilters?: string[]
  /** 每项是一条 `<glob>: <指令>`，直接交给 PathInstructions */
  pathInstructions?: string[]
  systemMessageAppend?: string
  language?: string
  reviewSimpleChanges?: boolean
  reviewCommentLGTM?: boolean
  maxFiles?: number
  maxReviewComments?: number
  enableDependencyAnalysis?: boolean
  maxDependencyFiles?: number
}

/** 参与合并的字段的当前值（基线，或合并结果） */
export interface MergeableConfig {
  pathFilterRules: string[]
  pathInstructionLines: string[]
  systemMessage: string
  language: string
  reviewSimpleChanges: boolean
  reviewCommentLGTM: boolean
  maxFiles: number
  maxReviewComments: number
  enableDependencyAnalysis: boolean
  maxDependencyFiles: number
}

/**
 * 把仓库配置叠加到基线上，返回新对象，不修改入参。
 * 仓库配置为 null / 空时返回基线的拷贝。
 */
export function mergeConfig(
  baseline: MergeableConfig,
  repo: RepoConfig | null | undefined
): MergeableConfig {
  const merged: MergeableConfig = {
    ...baseline,
    pathFilterRules: [...baseline.pathFilterRules],
    pathInstructionLines: [...baseline.pathInstructionLines]
  }
  if (!repo) return merged

  if (repo.pathFilters?.length) merged.pathFilterRules.push(...repo.pathFilters)
  if (repo.pathInstructions?.length) merged.pathInstructionLines.push(...repo.pathInstructions)
  if (repo.systemMessageAppend) {
    merged.systemMessage = `${baseline.systemMessage}\n\n${repo.systemMessageAppend}`
  }
  if (repo.language !== undefined) merged.language = repo.language
  if (repo.reviewSimpleChanges !== undefined) merged.reviewSimpleChanges = repo.reviewSimpleChanges
  if (repo.reviewCommentLGTM !== undefined) merged.reviewCommentLGTM = repo.reviewCommentLGTM
  if (repo.maxFiles !== undefined) merged.maxFiles = repo.maxFiles
  if (repo.maxReviewComments !== undefined) merged.maxReviewComments = repo.maxReviewComments
  if (repo.enableDependencyAnalysis !== undefined) {
    merged.enableDependencyAnalysis = repo.enableDependencyAnalysis
  }
  if (repo.maxDependencyFiles !== undefined) merged.maxDependencyFiles = repo.maxDependencyFiles
  return merged
}
