/**
 * gitlab-mr-hook-rules.ts - GitLab MR Hook 业务规则（EVENT-010/012/013）
 *
 * 三个纯函数，不做任何文件/网络 IO：
 * - checkForkMergeRequest()：EVENT-010，判断 MR 是否来自 fork（source_project_id
 *   != target_project_id），供 gitlab-trigger.ts 决定是否 fail closed 拒绝。
 * - isHeadStale()：EVENT-012，已挪到 head-staleness.ts（与 REVIEW-003 共用），
 *   本文件仅 re-export。真正重新读取 GitLab MR 当前 HEAD 属于 GLAPI-006。
 * - buildMrIdempotencyKey()：EVENT-013，生成幂等键，格式为
 *   `gitlab:{project_id}:{mr_iid}:head:{head_sha}`；与 summary note marker 的比对
 *   属于 STATE-005，不在本文件范围。
 *
 * 参考 docs/tasks/gitlab-mr-hook-design.md 第 3.2/3.4/3.5 节。
 */

export interface ForkCheckResult {
  isFork: boolean
  reason?: string
}

export function checkForkMergeRequest(
  sourceProjectId: number,
  targetProjectId: number
): ForkCheckResult {
  if (sourceProjectId !== targetProjectId) {
    return {
      isFork: true,
      reason: `source_project_id(${sourceProjectId}) !== target_project_id(${targetProjectId})`
    }
  }
  return {isFork: false}
}

// isHeadStale 已挪到平台中立的 head-staleness.ts——共享审查核心（REVIEW-003）
// 也要用同一套判定，从 GitLab 专有模块 import 说不通，各写一份又会让语义漂移。
// 这里 re-export 保持既有 import 路径可用。
export {isHeadStale, type HeadStaleCheck} from './head-staleness'

export function buildMrIdempotencyKey(projectId: string, mrIid: number, headSha: string): string {
  return `gitlab:${projectId}:${mrIid}:head:${headSha}`
}
