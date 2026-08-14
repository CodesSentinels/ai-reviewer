/**
 * platform/gitlab-execution-context.ts - GitLab ExecutionContext 工厂（ARCH-004）
 *
 * ⚠️ 边界说明：GitLab trigger CLI 目前完全不存在（EVENT-001~005 尚未开始），
 * 本文件交付的是类型定义 + 从"已解析 payload 对象"构造 ExecutionContext 的纯函数，
 * 不包含读取 TRIGGER_PAYLOAD 文件、校验 project ID/HEAD SHA、CLI 入口本身——
 * 那些属于 EVENT-002/EVENT-003 任务，届时只需要"解析出 payload JSON 后调用
 * 本文件的函数"，不需要重新设计字段映射。
 *
 * `isBot` 恒为 false：GitLab MVP 使用个人 PAT 身份评论，没有天然的 bot 账号标记；
 * 真正的自反馈过滤需要将 actor.login 与配置好的 PAT 用户名比较（EVENT-018，
 * 见 `gitlab-note-hook-rules.ts` 的 `isSelfNote()`），故意不放进 ExecutionContext
 * 构造阶段判断——构造阶段不应依赖外部配置输入（呼应 ARCH-002 的字段设计边界）。
 *
 * GitLab Webhook 字段映射依据 GitLab 官方 Webhook events 文档整理，尚未经真实
 * Webhook 验证（ai-reviewer-test 项目尚未接入），EVENT-002 对接真实环境时需要
 * 用真实 payload 复核字段名，如有出入回填 docs/tasks/execution-context-design.md
 * 第 5.1 节。参考该文档第 5 节。
 */
import {type EventKind, type ExecutionContext, ExecutionContextError} from './execution-context'

/**
 * GitLab Note Hook `object_attributes.noteable_type` 的已知取值——评论挂在
 * 哪一类对象上。依据 GitLab 官方 Webhook events 文档「Comment events」一节
 * 整理，跟本文件其余字段映射一样，尚未经真实 Webhook 验证。
 *
 * `Epic` 属于 Premium/Ultimate 功能，当前项目只针对 GitLab.com Free 套餐
 * （见 github-to-gitlab-migration-plan.md §0.4/§0.5），故意不列入。
 */
export type GitLabNoteableType = 'Commit' | 'MergeRequest' | 'Issue' | 'Snippet'

/** 唯一需要业务处理的 noteable_type；其余一律 ignorable_event（EVENT-017）。 */
export const MERGE_REQUEST_NOTEABLE_TYPE: GitLabNoteableType = 'MergeRequest'

/**
 * 输入为已由 EVENT-002 任务解析出的 GitLab webhook payload 对象
 * （对应 TRIGGER_PAYLOAD 文件反序列化后的 JSON）。本函数不做文件 IO。
 *
 * @throws {ExecutionContextError} payload 缺失/非对象、object_kind 不支持，或缺少必需字段时
 */
export function createGitLabExecutionContext(payload: unknown): ExecutionContext {
  if (payload == null || typeof payload !== 'object') {
    throw new ExecutionContextError(
      'TRIGGER_PAYLOAD is empty or not an object',
      'gitlab',
      'missing_payload'
    )
  }
  const p = payload as Record<string, any>
  const kind = p.object_kind

  if (kind === 'merge_request') {
    return buildFromMergeRequestHook(p)
  }
  if (kind === 'note') {
    return buildFromNoteHook(p)
  }
  throw new ExecutionContextError(
    `Unsupported GitLab object_kind: ${String(kind)}`,
    'gitlab',
    'unknown_event'
  )
}

function buildFromMergeRequestHook(p: Record<string, any>): ExecutionContext {
  const attrs = p.object_attributes
  const project = p.project
  if (attrs == null || project == null || attrs.iid == null) {
    throw new ExecutionContextError(
      'merge_request payload missing object_attributes/project/iid',
      'gitlab',
      'missing_required_field'
    )
  }
  const eventKind = mapMergeRequestAction(attrs, p.changes)
  return {
    platform: 'gitlab',
    projectPath: project.path_with_namespace,
    projectId: String(project.id),
    changeRequestId: attrs.iid,
    eventKind,
    actor: {login: p.user?.username ?? '', isBot: false},
    baseSha: attrs.oldrev ?? '',
    headSha: attrs.last_commit?.id ?? '',
    raw: p
  }
}

function buildFromNoteHook(p: Record<string, any>): ExecutionContext {
  const attrs = p.object_attributes
  const mr = p.merge_request

  // 结构缺失：真正的校验失败，fail closed（区别于下面的 ignorable_event）。
  // 只要求 object_attributes 存在——merge_request 是否必须存在取决于
  // noteable_type，不能在这里无条件要求（见下方 bug 说明）。
  if (attrs == null) {
    throw new ExecutionContextError(
      'note payload missing required fields', // object_attributes
      'gitlab',
      'missing_required_field'
    )
  }

  // 结构合法但业务上不需要处理：优雅跳过（EVENT-016/017，修复 Issue #66——
  // 此前这三种情形跟"字段真正缺失"共用 missing_required_field，导致
  // gitlab-trigger.ts 对编辑/删除评论等 fail closed 而非优雅跳过）。
  //
  // noteable_type 检查必须排在 merge_request 非空检查之前：GitLab 真实 Note
  // Hook payload 里 merge_request 字段只在 noteable_type === 'MergeRequest'
  // 时才会出现——评论挂在 Issue/commit/snippet 上时，payload 里根本没有
  // merge_request（而是 issue/commit/snippet 字段）。如果先无条件要求
  // merge_request 非空，Issue 等对象上的评论这一最常见的"非 MR note"场景会
  // 在走到这条 ignorable_event 判断之前就先被上面的结构校验 fail closed，
  // 这条判断反而变成只有人为构造的 fixture 才能触发的死代码。
  if (attrs.action !== 'create') {
    throw new ExecutionContextError(
      `note action is '${attrs.action}', not 'create' — ignorable`,
      'gitlab',
      'ignorable_event'
    )
  }
  if (attrs.system === true) {
    throw new ExecutionContextError('system note — ignorable', 'gitlab', 'ignorable_event')
  }
  if (attrs.noteable_type !== MERGE_REQUEST_NOTEABLE_TYPE) {
    throw new ExecutionContextError(
      `noteable_type '${attrs.noteable_type}' is not MergeRequest — ignorable`,
      'gitlab',
      'ignorable_event'
    )
  }

  // 到这里已经确认 noteable_type === 'MergeRequest'，merge_request 理应存在；
  // 缺失说明 payload 结构真的坏了（不是"评论在别的对象上"这种正常情况）。
  if (mr == null) {
    throw new ExecutionContextError(
      'MergeRequest note payload missing required fields', // merge_request
      'gitlab',
      'missing_required_field'
    )
  }
  return {
    platform: 'gitlab',
    projectPath: p.project?.path_with_namespace ?? '',
    projectId: String(p.project_id ?? p.project?.id ?? ''),
    changeRequestId: mr.iid,
    eventKind: attrs.discussion_id ? 'review_comment_created' : 'comment_created',
    actor: {login: p.user?.username ?? '', isBot: false},
    baseSha: '',
    headSha: mr.diff_head_sha ?? '',
    comment: {
      kind: attrs.discussion_id ? 'review_thread' : 'top_level',
      id: attrs.id,
      // 正文必须填：共享 dispatcher 以 `typeof comment.body === 'string'` 作为
      // 「这是一条可解析的评论」的判据，缺了它所有 GitLab 命令都会在解析前
      // 就被当成「missing comment body」静默丢弃。
      body: typeof attrs.note === 'string' ? attrs.note : undefined,
      threadId: attrs.discussion_id
    },
    raw: p
  }
}

function mapMergeRequestAction(attrs: Record<string, any>, changes: any): EventKind {
  if (attrs.action === 'open') return 'pr_opened'
  if (attrs.action === 'reopen') return 'pr_reopened'
  if (attrs.action === 'update') {
    const headChanged = changes?.last_commit != null || changes?.source_branch != null
    return headChanged ? 'pr_synchronize' : 'metadata_updated'
  }
  return 'unknown'
}
