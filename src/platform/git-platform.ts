/**
 * platform/git-platform.ts - 平台无关 Git 服务接口（ARCH-016 / ARCH-017）
 *
 * 定义 GitHub 和 GitLab 共用的 Git 平台操作抽象。业务层（review.ts、commenter.ts、
 * commands/**、conversation.ts 等）通过此接口访问平台 API，不得直接 import
 * octokit / @gitbeaker/rest。
 *
 * 方法签名以"需要什么数据"为导向，而非"哪个 REST endpoint"。GitHub adapter
 * 和 GitLab adapter 各自负责把调用翻译到对应平台 API。
 *
 * ARCH-021: PR number / MR IID 统一为 changeRequestId（number），
 *   comment/note ID 统一为 commentId（number），
 *   thread node ID / discussion ID 统一为 threadId（string）。
 *
 * ARCH-022: 所有方法在遇到平台 API 错误时抛出 GitPlatformError，
 *   业务层按 errorKind 分支处理。
 */

// ─── 统一错误语义（ARCH-022）─────────────────────────────────────────────────

export type GitPlatformErrorKind =
  | 'not_found' // 404
  | 'conflict' // 409
  | 'forbidden' // 403 / 权限不足
  | 'rate_limited' // 429
  | 'server_error' // 5xx
  | 'timeout' // 网络超时
  | 'unknown' // 其他

export class GitPlatformError extends Error {
  constructor(
    message: string,
    public readonly errorKind: GitPlatformErrorKind,
    public readonly statusCode?: number,
    public readonly cause?: unknown
  ) {
    super(message)
    this.name = 'GitPlatformError'
  }
}

// ─── 共享数据类型（ARCH-021）────────────────────────────────────────────────

/** PR/MR 基本信息 */
export interface ChangeRequestInfo {
  number: number
  title: string
  body: string
  state: 'open' | 'closed' | 'merged'
  baseSha: string
  headSha: string
  baseRef: string
  headRef: string
  author: string
}

/** diff 比较结果中的单文件 */
export interface DiffFile {
  filename: string
  status: 'added' | 'modified' | 'removed' | 'renamed' | 'unchanged'
  patch?: string
  previousFilename?: string
}

/** diff 比较结果 */
export interface DiffResult {
  files: DiffFile[]
  commits: Array<{sha: string}>
}

/** 顶层评论（issue comment / MR note） */
export interface PlatformComment {
  id: number
  body: string
  author: string
  nodeId?: string
  createdAt?: string
}

/** 行级评论（review comment / diff discussion note） */
export interface ReviewComment {
  id: number
  body: string
  path: string
  line: number | null
  startLine: number | null
  /** GitHub: original_line（outdated diff 场景的行号 fallback） */
  originalLine?: number | null
  author: string
  in_reply_to_id?: number
  nodeId?: string
  createdAt?: string
}

/** 批量创建行级评论的单条数据 */
export interface ReviewCommentDraft {
  path: string
  body: string
  line: number
  startLine?: number
  startSide?: string
}

/** review thread 状态 */
export interface ReviewThreadInfo {
  id: string
  isResolved: boolean
  path: string | null
  line: number | null
  firstCommentAuthorLogin: string | null
  firstCommentBody: string | null
}

/** 文件树项 */
export interface TreeEntry {
  type?: string
  path?: string
}

/** 权限等级 */
export type PlatformPermission =
  | 'admin'
  | 'maintain'
  | 'write'
  | 'triage'
  | 'read'
  | 'none'

/** Reaction 类型 */
export type ReactionContent =
  | '+1'
  | '-1'
  | 'laugh'
  | 'confused'
  | 'heart'
  | 'hooray'
  | 'rocket'
  | 'eyes'

// ─── 平台接口（ARCH-016）──────────────────────────────────────────────────

/**
 * 平台无关 Git 服务接口。
 *
 * 方法按功能分组：
 *   1. PR/MR 信息
 *   2. Diff
 *   3. 文件内容
 *   4. 顶层评论
 *   5. 行级评论（review comment / diff note）
 *   6. Review thread（resolve）
 *   7. Reaction
 *   8. 权限
 *   9. 用户身份
 *  10. 仓库文件树
 */
export interface IGitPlatform {
  // ─── 1. PR/MR 信息 ───────────────────────────────────────────────────────

  /** 获取 PR/MR 详情 */
  getChangeRequest(
    owner: string,
    repo: string,
    changeRequestId: number
  ): Promise<ChangeRequestInfo>

  /** 更新 PR/MR body（描述） */
  updateChangeRequestBody(
    owner: string,
    repo: string,
    changeRequestId: number,
    body: string
  ): Promise<void>

  /** 获取 PR/MR 的所有 commit SHA */
  listChangeRequestCommits(
    owner: string,
    repo: string,
    changeRequestId: number
  ): Promise<string[]>

  // ─── 2. Diff ──────────────────────────────────────────────────────────────

  /** 比较两个 commit 的 diff */
  compareDiff(
    owner: string,
    repo: string,
    base: string,
    head: string
  ): Promise<DiffResult>

  // ─── 3. 文件内容 ──────────────────────────────────────────────────────────

  /** 获取指定 ref 下的文件内容（base64 解码后的字符串） */
  getFileContent(
    owner: string,
    repo: string,
    path: string,
    ref: string
  ): Promise<string | null>

  // ─── 4. 顶层评论（issue comment / MR note）──────────────────────────────

  /** 创建顶层评论 */
  createComment(
    owner: string,
    repo: string,
    changeRequestId: number,
    body: string
  ): Promise<PlatformComment>

  /** 更新顶层评论 */
  updateComment(
    owner: string,
    repo: string,
    commentId: number,
    body: string
  ): Promise<void>

  /** 删除顶层评论 */
  deleteComment(owner: string, repo: string, commentId: number): Promise<void>

  /** 列出顶层评论 */
  listComments(
    owner: string,
    repo: string,
    changeRequestId: number
  ): Promise<PlatformComment[]>

  // ─── 5. 行级评论（review comment / diff note）────────────────────────────

  /** 列出行级评论 */
  listReviewComments(
    owner: string,
    repo: string,
    changeRequestId: number
  ): Promise<ReviewComment[]>

  /**
   * 批量提交行级评论（GitHub: createReview + submitReview; GitLab: batch notes）
   * @returns 成功提交的评论数
   */
  submitReviewComments(
    owner: string,
    repo: string,
    changeRequestId: number,
    commitSha: string,
    comments: ReviewCommentDraft[],
    reviewBody?: string
  ): Promise<number>

  /** 创建单条行级评论 */
  createReviewComment(
    owner: string,
    repo: string,
    changeRequestId: number,
    commitSha: string,
    comment: ReviewCommentDraft
  ): Promise<void>

  /** 回复行级评论 */
  replyToReviewComment(
    owner: string,
    repo: string,
    changeRequestId: number,
    commentId: number,
    body: string
  ): Promise<PlatformComment>

  /** 更新行级评论 */
  updateReviewComment(
    owner: string,
    repo: string,
    commentId: number,
    body: string
  ): Promise<void>

  /** 删除行级评论 */
  deleteReviewComment(
    owner: string,
    repo: string,
    commentId: number
  ): Promise<void>

  /** 删除 PENDING 状态的 review（GitHub 专有，GitLab 空实现） */
  deletePendingReview(
    owner: string,
    repo: string,
    changeRequestId: number
  ): Promise<void>

  // ─── 6. Review thread ─────────────────────────────────────────────────────

  /**
   * 获取 review thread 状态 map（path:line → isResolved）。
   * GitHub: GraphQL reviewThreads 查询；GitLab: diff discussions resolved 字段。
   */
  fetchThreadStatusMap(
    owner: string,
    repo: string,
    changeRequestId: number
  ): Promise<Map<string, boolean>>

  /**
   * 获取 bot 发起的未 resolved thread 列表。
   * 用于 resolve 命令批量 resolve。
   */
  fetchUnresolvedBotThreads(
    owner: string,
    repo: string,
    changeRequestId: number,
    botLogin: string
  ): Promise<ReviewThreadInfo[]>

  /** 批量 resolve thread */
  resolveThreads(
    threadIds: string[]
  ): Promise<{ok: number; failed: number; errors: Error[]}>

  // ─── 7. Reaction ──────────────────────────────────────────────────────────

  /** 在评论上添加表情反应 */
  addReaction(
    owner: string,
    repo: string,
    commentId: number,
    content: ReactionContent,
    commentKind: 'issue_comment' | 'review_comment'
  ): Promise<void>

  // ─── 8. 权限 ──────────────────────────────────────────────────────────────

  /** 查询用户对项目的权限等级 */
  getCollaboratorPermission(
    owner: string,
    repo: string,
    username: string
  ): Promise<PlatformPermission>

  // ─── 9. 用户身份 ──────────────────────────────────────────────────────────

  /** 获取当前认证用户的 login（用于 bot 自评论过滤） */
  getAuthenticatedLogin(): Promise<string>

  // ─── 10. 仓库文件树（DEP-001 / DEP-003）──────────────────────────────────

  /**
   * 获取仓库文件树（所有文件路径）。
   * GitHub: Git Tree API (recursive)；GitLab: Repository Tree API (recursive + paginated)。
   */
  listRepositoryTree(
    owner: string,
    repo: string,
    ref: string
  ): Promise<TreeEntry[]>
}

// ─── 平台单例（ARCH-018）────────────────────────────────────────────────

let _platform: IGitPlatform | null = null

/** 获取当前平台实例。未设置时抛错（入口文件必须先调用 setPlatform） */
export function getPlatform(): IGitPlatform {
  if (_platform == null) {
    throw new Error(
      'getPlatform() called before setPlatform(). ' +
        'Entry point (main.ts / gitlab-trigger.ts) must call setPlatform() first.'
    )
  }
  return _platform
}

/** 设置全局平台实例（入口文件调用） */

export function setPlatform(platform: IGitPlatform): void {
  _platform = platform
}

/** 重置为未初始化状态（仅供测试使用） */
export function resetPlatform(): void {
  _platform = null
}
