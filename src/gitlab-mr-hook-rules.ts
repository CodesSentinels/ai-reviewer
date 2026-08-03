/**
 * gitlab-mr-hook-rules.ts - GitLab MR Hook 业务规则（EVENT-010/012/013）
 *
 * 三个纯函数，不做任何文件/网络 IO：
 * - checkForkMergeRequest()：EVENT-010，判断 MR 是否来自 fork（source_project_id
 *   != target_project_id），供 gitlab-trigger.ts 决定是否 fail closed 拒绝。
 * - isHeadStale()：EVENT-012，比较"事件里的 headSha"与"重新读取到的当前 headSha"
 *   是否一致；真正重新读取 GitLab MR 当前 HEAD 属于 GLAPI-006，本函数只做比较。
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

export interface HeadStaleCheck {
  stale: boolean
  eventHeadSha: string
  currentHeadSha: string
}

export function isHeadStale(
  eventHeadSha: string,
  currentHeadSha: string
): HeadStaleCheck {
  return {
    stale: eventHeadSha !== currentHeadSha,
    eventHeadSha,
    currentHeadSha
  }
}

export function buildMrIdempotencyKey(
  projectId: string,
  mrIid: number,
  headSha: string
): string {
  return `gitlab:${projectId}:${mrIid}:head:${headSha}`
}
