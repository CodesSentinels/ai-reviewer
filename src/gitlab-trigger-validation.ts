/**
 * gitlab-trigger-validation.ts - TRIGGER_PAYLOAD 结构校验（EVENT-003）
 *
 * `createGitLabExecutionContext` 已经校验了它需要的字段（object_attributes.iid、
 * project、noteable_type 等），但不读取/校验 source_project_id/target_project_id
 * ——这两个字段只用于 fork 检测。本模块只负责"这些字段存不存在、类型对不对"的结构性
 * 校验，不做业务判断；实际的 fork 拒绝逻辑（EVENT-010）在
 * `gitlab-mr-hook-rules.ts` 的 `checkForkMergeRequest()` + `gitlab-trigger.ts` 里。
 *
 * 参考 docs/tasks/gitlab-trigger-cli-design.md 第 4 节。
 */
import {MERGE_REQUEST_NOTEABLE_TYPE} from './platform/gitlab-execution-context'

export interface TriggerPayloadValidation {
  ok: boolean
  reason?: string
  sourceTargetMismatch?: boolean
}

export function validateTriggerPayload(payload: unknown): TriggerPayloadValidation {
  if (payload == null || typeof payload !== 'object') {
    return {ok: false, reason: 'payload is not an object'}
  }
  const p = payload as Record<string, any>

  if (p.object_kind !== 'merge_request' && p.object_kind !== 'note') {
    // 未知 object_kind 的处理交给 createGitLabExecutionContext 的 unknown_event
    // 分支（EVENT-004 快速退出），这里只做"是不是我们认识的两种事件"的粗过滤
    return {ok: true}
  }

  const project = p.project
  if (project?.id == null) {
    return {ok: false, reason: 'missing project.id'}
  }

  if (p.object_kind === 'merge_request') {
    const attrs = p.object_attributes
    if (attrs?.iid == null) {
      return {ok: false, reason: 'missing object_attributes.iid'}
    }
    if (attrs?.source_project_id == null || attrs?.target_project_id == null) {
      return {ok: false, reason: 'missing source_project_id/target_project_id'}
    }
    return {
      ok: true,
      sourceTargetMismatch: attrs.source_project_id !== attrs.target_project_id
    }
  }

  // note
  const attrs = p.object_attributes
  const mr = p.merge_request
  if (attrs?.id == null) {
    return {ok: false, reason: 'missing object_attributes.id'}
  }
  // merge_request 只在 noteable_type === 'MergeRequest' 时才会出现在真实
  // GitLab payload 里——评论挂在 Issue/commit/snippet 上时根本没有这个字段，
  // 那是需要交给 createGitLabExecutionContext 判定 ignorable_event 的正常
  // 情况，不是结构校验失败。只有"明明是 MergeRequest 的评论却没带 merge_request"
  // 才是这里要拦的真正结构性缺失。
  if (attrs?.noteable_type === MERGE_REQUEST_NOTEABLE_TYPE && mr?.iid == null) {
    return {ok: false, reason: 'missing merge_request.iid'}
  }
  return {ok: true}
}
