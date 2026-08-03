/**
 * platform/execution-context.ts - 平台无关执行上下文（ARCH-001 / ARCH-002）
 *
 * 业务层（review.ts / commenter.ts / commands/** 等）只允许通过 ExecutionContext
 * 获取"这次运行是谁在哪个平台对哪个 PR/MR 做了什么"，不得直接 import
 * `@actions/github` 或读取 `process.env.GITHUB_EVENT_NAME` / `process.env.TRIGGER_PAYLOAD`。
 * 平台专有细节一律封装进 `raw`，仅供对应 adapter（GitHub adapter / GitLab adapter，
 * ARCH-016+ 任务）内部使用。
 *
 * 参考 docs/tasks/execution-context-design.md 第 3 节。
 */

export type Platform = 'github' | 'gitlab'

/**
 * 归一化事件类型，与具体平台事件名解耦。
 * - pr_opened/pr_synchronize/pr_reopened  → 触发自动增量/全量审查
 * - comment_created                        → 顶层评论（issue_comment / MR note）
 * - review_comment_created                 → 行级评论回复（review comment / diff discussion note）
 * - metadata_updated                       → 标题/label/assignee 等，不触发模型调用
 * - unknown                                → fail closed（见第 7 节）
 */
export type EventKind =
  | 'pr_opened'
  | 'pr_synchronize'
  | 'pr_reopened'
  | 'comment_created'
  | 'review_comment_created'
  | 'metadata_updated'
  | 'unknown'

export interface ActorInfo {
  /** GitHub login 或 GitLab username */
  login: string
  /** 是否为 bot/system 账号自身触发（用于反馈循环过滤，ARCH-005 消费方之一） */
  isBot: boolean
}

export type CommentKind = 'top_level' | 'review_thread'

export interface CommentRef {
  kind: CommentKind
  /** GitHub: comment.id（number）；GitLab: note.id（number，两平台均为 number，类型统一） */
  id: number
  /** GitHub: review thread node ID（GraphQL）；GitLab: discussion_id（string） */
  threadId?: string
}

/**
 * 平台无关执行上下文。
 *
 * 业务层只允许通过这个对象获取事件坐标，不做数据抓取——PR/MR 的 title、body、
 * diff 等内容型数据属于 IGitPlatform（ARCH-016+）的读取能力，避免 GitHub/GitLab
 * 两个工厂函数在构造阶段各自发起不对等的 API 调用。
 */
export interface ExecutionContext {
  platform: Platform

  /** GitHub: "owner/repo"；GitLab: 项目路径（不是 project_id 数字） */
  projectPath: string
  /** GitHub: "owner/repo"（与 projectPath 相同，保留字段用于兼容 octokit 调用签名）；GitLab: project_id（数字，转成字符串） */
  projectId: string

  /** PR number（GitHub）/ MR iid（GitLab）——注意 GitLab 还有一个跨项目唯一的 MR id，两者不可混用，本字段固定用 iid */
  changeRequestId: number

  eventKind: EventKind
  actor: ActorInfo

  baseSha: string
  headSha: string

  /** 仅评论类事件（comment_created / review_comment_created）存在 */
  comment?: CommentRef

  /**
   * 平台原始 payload 的快照，仅供本平台的 adapter 层读取，共享业务层禁止访问
   * （架构测试见 ARCH-023，本任务不实现该测试，由后续 ARCH-023 任务负责用
   * lint 规则强制）。
   */
  raw: unknown
}

/**
 * payload 缺失、格式错误或事件未知时抛出（ARCH-006 fail-closed）。
 *
 * `ignorable_event` 与 `unknown_event` 都应被调用方（gitlab-trigger.ts）当作
 * 优雅跳过（exit 0）处理，区别在于语义：`unknown_event` 是"完全不认识的
 * object_kind"，`ignorable_event` 是"认识这个事件类型，但结构合法且业务上
 * 明确不需要处理"（如 note 编辑/删除、system note、非 MR note，见 EVENT-016/017、
 * Issue #66）。拆分出独立 reason 是为了和真正的校验失败（`missing_required_field`，
 * 仍应 fail closed）区分开。
 */
export class ExecutionContextError extends Error {
  constructor(
    message: string,

    public readonly platform: Platform,

    public readonly reason:
      | 'missing_payload'
      | 'malformed_payload'
      | 'unknown_event'
      | 'missing_required_field'
      | 'ignorable_event'
  ) {
    super(message)
    this.name = 'ExecutionContextError'
  }
}
