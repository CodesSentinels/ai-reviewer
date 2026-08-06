/**
 * platform/gitlab-platform.ts - GitLab REST adapter（ARCH-020 部分实现）
 *
 * 当前仅实现 listRepositoryTree（DEP-001/004），其余方法待后续 GLAPI-* 任务补全。
 * 使用 @gitbeaker/rest 作为标准客户端（ARCH-020）。
 * @gitbeaker/rest 类型不泄露到 IGitPlatform 或共享业务核心（ARCH-024）。
 */

import {Gitlab} from '@gitbeaker/rest'
import {
  type IGitPlatform,
  type ChangeRequestInfo,
  type DiffResult,
  type PlatformComment,
  type ReviewComment,
  type ReviewCommentDraft,
  type ReviewThreadInfo,
  type TreeResult,
  type PlatformPermission,
  type ReactionContent,
  GitPlatformError,
  type GitPlatformErrorKind
} from './git-platform'

// ─── gitbeaker 错误 → GitPlatformError 转换 ────────────────────────────────

function toGitPlatformError(e: unknown): GitPlatformError {
  const msg = e instanceof Error ? e.message : String(e)
  const status = (e as any)?.cause?.response?.status ?? (e as any)?.response?.status ?? undefined

  let kind: GitPlatformErrorKind = 'unknown'
  if (status === 404) kind = 'not_found'
  else if (status === 403) kind = 'forbidden'
  else if (status === 409) kind = 'conflict'
  else if (status === 429) kind = 'rate_limited'
  else if (status != null && status >= 500) kind = 'server_error'
  else if (/ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|timed?\s?out/i.test(msg)) {
    kind = 'timeout'
  }

  return new GitPlatformError(msg, kind, status, e)
}

// ─── 未实现方法的统一错误 ──────────────────────────────────────────────────

function notImplemented(method: string): never {
  throw new GitPlatformError(
    `GitLabPlatform.${method}() is not yet implemented (pending GLAPI-* tasks)`,
    'unknown'
  )
}

// ─── GitLabPlatform ────────────────────────────────────────────────────────

export interface GitLabCredential {
  type: 'pat' | 'job_token'
  value: string
}

export class GitLabPlatform implements IGitPlatform {
  private api: InstanceType<typeof Gitlab>

  constructor(credential: GitLabCredential, host?: string) {
    const h = host || 'https://gitlab.com'
    this.api =
      credential.type === 'job_token'
        ? new Gitlab({host: h, jobToken: credential.value})
        : new Gitlab({host: h, token: credential.value})
  }

  // ─── 10. 仓库文件树（DEP-001 / DEP-004）─────────────────────────────────

  /**
   * 获取 GitLab 仓库文件树。
   *
   * 使用 Repository Tree API (recursive) + keyset 分页（由 gitbeaker 自动处理）。
   *
   * DEP-004 边界处理：
   * - 空仓库 → 返回空数组（正常状态，不抛错）
   * - subgroup 项目 → owner 含 `/`（如 "group/subgroup"），与 repo 拼接成完整 projectPath
   * - 超大仓库 → gitbeaker allRepositoryTrees 自动分页合并
   * - Unicode 路径 → gitbeaker 内部做 URL 编码
   * - API 部分失败 → 抛 GitPlatformError（不静默返回空数组）
   */
  async listRepositoryTree(owner: string, repo: string, ref: string): Promise<TreeResult> {
    const projectPath = `${owner}/${repo}`
    try {
      const trees = await this.api.Repositories.allRepositoryTrees(projectPath, {
        ref,
        recursive: true
      })
      // gitbeaker allRepositoryTrees 自动处理 keyset 分页，不存在截断
      const entries = trees.map(t => ({type: t.type, path: t.path}))
      return {entries, truncated: false}
    } catch (e) {
      // 空仓库返回 404 "404 Tree Not Found"，视为合法的空树
      const status = (e as any)?.cause?.response?.status ?? (e as any)?.response?.status
      if (status === 404) {
        const msg = e instanceof Error ? e.message : String(e)
        if (/tree not found/i.test(msg)) return {entries: [], truncated: false}
      }
      throw toGitPlatformError(e)
    }
  }

  // ─── 3. 文件内容 ─────────────────────────────────────────────────────────

  async getFileContent(
    owner: string,
    repo: string,
    path: string,
    ref: string
  ): Promise<string | null> {
    const projectPath = `${owner}/${repo}`
    try {
      const file = await this.api.RepositoryFiles.show(projectPath, path, ref)
      return Buffer.from(file.content, 'base64').toString('utf8')
    } catch (e) {
      const status = (e as any)?.cause?.response?.status ?? (e as any)?.response?.status
      if (status === 404) return null
      throw toGitPlatformError(e)
    }
  }

  // ─── 以下方法待 GLAPI-* 任务实现 ──────────────────────────────────────────

  async getChangeRequest(
    _owner: string,
    _repo: string,
    _changeRequestId: number
  ): Promise<ChangeRequestInfo> {
    notImplemented('getChangeRequest')
  }

  async updateChangeRequestBody(
    _owner: string,
    _repo: string,
    _changeRequestId: number,
    _body: string
  ): Promise<void> {
    notImplemented('updateChangeRequestBody')
  }

  async listChangeRequestCommits(
    _owner: string,
    _repo: string,
    _changeRequestId: number
  ): Promise<string[]> {
    notImplemented('listChangeRequestCommits')
  }

  async compareDiff(
    _owner: string,
    _repo: string,
    _base: string,
    _head: string
  ): Promise<DiffResult> {
    notImplemented('compareDiff')
  }

  async createComment(
    _owner: string,
    _repo: string,
    _changeRequestId: number,
    _body: string
  ): Promise<PlatformComment> {
    notImplemented('createComment')
  }

  async updateComment(
    _owner: string,
    _repo: string,
    _commentId: number,
    _body: string
  ): Promise<void> {
    notImplemented('updateComment')
  }

  async deleteComment(_owner: string, _repo: string, _commentId: number): Promise<void> {
    notImplemented('deleteComment')
  }

  async listComments(
    _owner: string,
    _repo: string,
    _changeRequestId: number
  ): Promise<PlatformComment[]> {
    notImplemented('listComments')
  }

  async listReviewComments(
    _owner: string,
    _repo: string,
    _changeRequestId: number
  ): Promise<ReviewComment[]> {
    notImplemented('listReviewComments')
  }

  async submitReviewComments(
    _owner: string,
    _repo: string,
    _changeRequestId: number,
    _commitSha: string,
    _comments: ReviewCommentDraft[],
    _reviewBody?: string
  ): Promise<number> {
    notImplemented('submitReviewComments')
  }

  async createReviewComment(
    _owner: string,
    _repo: string,
    _changeRequestId: number,
    _commitSha: string,
    _comment: ReviewCommentDraft
  ): Promise<void> {
    notImplemented('createReviewComment')
  }

  async replyToReviewComment(
    _owner: string,
    _repo: string,
    _changeRequestId: number,
    _commentId: number,
    _body: string
  ): Promise<PlatformComment> {
    notImplemented('replyToReviewComment')
  }

  async updateReviewComment(
    _owner: string,
    _repo: string,
    _commentId: number,
    _body: string
  ): Promise<void> {
    notImplemented('updateReviewComment')
  }

  async deleteReviewComment(_owner: string, _repo: string, _commentId: number): Promise<void> {
    notImplemented('deleteReviewComment')
  }

  async deletePendingReview(
    _owner: string,
    _repo: string,
    _changeRequestId: number
  ): Promise<void> {
    // GitLab 无 pending review 概念，空实现
  }

  async fetchThreadStatusMap(
    _owner: string,
    _repo: string,
    _changeRequestId: number
  ): Promise<Map<string, boolean>> {
    notImplemented('fetchThreadStatusMap')
  }

  async fetchUnresolvedBotThreads(
    _owner: string,
    _repo: string,
    _changeRequestId: number,
    _botLogin: string
  ): Promise<ReviewThreadInfo[]> {
    notImplemented('fetchUnresolvedBotThreads')
  }

  async resolveThreads(
    _threadIds: string[]
  ): Promise<{ok: number; failed: number; errors: Error[]}> {
    notImplemented('resolveThreads')
  }

  async addReaction(
    _owner: string,
    _repo: string,
    _commentId: number,
    _content: ReactionContent,
    _commentKind: 'issue_comment' | 'review_comment'
  ): Promise<void> {
    notImplemented('addReaction')
  }

  async getCollaboratorPermission(
    _owner: string,
    _repo: string,
    _username: string
  ): Promise<PlatformPermission> {
    notImplemented('getCollaboratorPermission')
  }

  async getAuthenticatedLogin(): Promise<string> {
    notImplemented('getAuthenticatedLogin')
  }
}
