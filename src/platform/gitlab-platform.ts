/**
 * platform/gitlab-platform.ts - GitLab REST adapter（ARCH-020）
 *
 * 使用 @gitbeaker/rest 作为标准客户端。
 * @gitbeaker/rest 类型不泄露到 IGitPlatform 或共享业务核心（ARCH-024）。
 *
 * 已实现：
 * - GLAPI-001/002: getChangeRequest（MR 详情）
 * - GLAPI-003/004: compareDiff（diff 比较）
 * - GLAPI-005: getFileContent（文件内容）
 * - GLAPI-006: getChangeRequest 返回 headSha 供调用方做 HEAD 比较
 * - GLAPI-007~012: Notes CRUD（createComment/updateComment/deleteComment/listComments）
 * - GLAPI-013~019: Discussions（行级评论 + resolve）
 * - DEP-001/004: listRepositoryTree（仓库文件树）
 */

import {Gitlab} from '@gitbeaker/rest'
import {
  type IGitPlatform,
  type ChangeRequestInfo,
  type DiffFile,
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
  if (e instanceof GitPlatformError) return e
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

// ─── GitLab diff 状态映射 ──────────────────────────────────────────────────

function diffStatus(d: {
  new_file?: boolean
  deleted_file?: boolean
  renamed_file?: boolean
}): DiffFile['status'] {
  if (d.new_file) return 'added'
  if (d.deleted_file) return 'removed'
  if (d.renamed_file) return 'renamed'
  return 'modified'
}

// ─── GitLabPlatform ────────────────────────────────────────────────────────

export interface GitLabCredential {
  type: 'pat' | 'job_token'
  value: string
}

export class GitLabPlatform implements IGitPlatform {
  private api: InstanceType<typeof Gitlab>
  /**
   * noteId → mergerequestIId 映射缓存。
   * IGitPlatform.updateComment/deleteComment 签名中没有 changeRequestId，
   * 但 GitLab Notes API 需要 MR IID。通过 createComment/listComments 时
   * 缓存映射关系，供后续 update/delete 使用。
   */
  private noteToMrIid = new Map<number, number>()
  /**
   * discussion noteId → {discussionId, mrIid, projectPath} 映射缓存。
   * IGitPlatform 的 replyToReviewComment/updateReviewComment/deleteReviewComment
   * 只传 noteId，但 GitLab Discussions API 需要 discussionId + mrIid。
   * 通过 listReviewComments/createReviewComment/submitReviewComments 时缓存。
   */
  private noteToDiscussion = new Map<
    number,
    {discussionId: string; mrIid: number; projectPath: string}
  >()
  /**
   * discussionId → {projectPath, mrIid} 缓存。
   * resolveThreads 只传 threadIds（即 discussionId），需要精确查找每个 discussion 的
   * projectPath 和 mrIid，避免跨 MR 混用。
   */
  private discussionIdToContext = new Map<string, {projectPath: string; mrIid: number}>()

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

  // ─── 1. PR/MR 信息（GLAPI-001/002/006）────────────────────────────────────

  async getChangeRequest(
    owner: string,
    repo: string,
    changeRequestId: number
  ): Promise<ChangeRequestInfo> {
    const projectPath = `${owner}/${repo}`
    try {
      const mr = await this.api.MergeRequests.show(projectPath, changeRequestId)
      const state: 'open' | 'closed' | 'merged' =
        mr.state === 'merged' ? 'merged' : mr.state === 'opened' ? 'open' : 'closed'
      // gitbeaker 返回 Camelize<unknown> 联合类型，需要 as any 断言
      const diffRefs = mr.diff_refs as any
      // GitLab 新建 MR 时 diff_refs 可能暂时为空（异步计算），需显式校验
      if (!diffRefs?.base_sha || !diffRefs?.head_sha) {
        throw new GitPlatformError(
          `MR !${changeRequestId} diff_refs not yet available (GitLab is still computing diffs)`,
          'conflict',
          undefined
        )
      }
      return {
        number: mr.iid,
        title: mr.title,
        body: mr.description ?? '',
        state,
        baseSha: diffRefs.base_sha as string,
        headSha: diffRefs.head_sha as string,
        baseRef: mr.target_branch as string,
        headRef: mr.source_branch as string,
        author: mr.author.username
      }
    } catch (e) {
      throw toGitPlatformError(e)
    }
  }

  async updateChangeRequestBody(
    owner: string,
    repo: string,
    changeRequestId: number,
    body: string
  ): Promise<void> {
    const projectPath = `${owner}/${repo}`
    try {
      await this.api.MergeRequests.edit(projectPath, changeRequestId, {description: body})
    } catch (e) {
      throw toGitPlatformError(e)
    }
  }

  async listChangeRequestCommits(
    owner: string,
    repo: string,
    changeRequestId: number
  ): Promise<string[]> {
    const projectPath = `${owner}/${repo}`
    try {
      const commits = await this.api.MergeRequests.allCommits(projectPath, changeRequestId)
      return commits.map(c => c.id)
    } catch (e) {
      throw toGitPlatformError(e)
    }
  }

  // ─── 2. Diff（GLAPI-003/004）──────────────────────────────────────────────

  async compareDiff(
    owner: string,
    repo: string,
    _base: string,
    _head: string
  ): Promise<DiffResult> {
    // 使用 Repositories.compare API 比较两个 ref/SHA 的 diff
    const projectPath = `${owner}/${repo}`
    try {
      const diff = await this.api.Repositories.compare(projectPath, _base, _head)
      // GitLab compare_timeout=true 时 diffs 可能不完整，fail closed 不审查残缺内容
      if ((diff as any).compare_timeout) {
        throw new GitPlatformError(
          `GitLab compare timed out for ${_base}..${_head} — diff may be incomplete`,
          'timeout',
          undefined
        )
      }
      // gitbeaker 返回 Camelize<unknown> 联合类型，需要 as any 断言
      const diffs = (diff.diffs ?? []) as any[]
      const files: DiffFile[] = diffs.map(d => ({
        filename: d.new_path,
        status: diffStatus(d),
        patch: d.diff ?? undefined,
        previousFilename: d.old_path !== d.new_path ? d.old_path : undefined
      }))
      const commits = (diff.commits ?? []) as any[]
      return {
        files,
        commits: commits.map(c => ({sha: c.id as string}))
      }
    } catch (e) {
      throw toGitPlatformError(e)
    }
  }

  // ─── 4. 顶层评论 / MR Notes（GLAPI-007~012）────────────────────────────────

  async createComment(
    owner: string,
    repo: string,
    changeRequestId: number,
    body: string
  ): Promise<PlatformComment> {
    const projectPath = `${owner}/${repo}`
    try {
      const note = (await this.api.MergeRequestNotes.create(
        projectPath,
        changeRequestId,
        body
      )) as any
      this.noteToMrIid.set(note.id, changeRequestId)
      return {
        id: note.id as number,
        body: note.body as string,
        author: note.author?.username ?? '',
        createdAt: note.created_at as string
      }
    } catch (e) {
      throw toGitPlatformError(e)
    }
  }

  async updateComment(owner: string, repo: string, commentId: number, body: string): Promise<void> {
    const projectPath = `${owner}/${repo}`
    const mrIid = this.noteToMrIid.get(commentId)
    if (mrIid == null) {
      throw new GitPlatformError(
        `Cannot update note ${commentId}: MR IID unknown (note was not created/listed via this adapter instance)`,
        'not_found'
      )
    }
    try {
      await this.api.MergeRequestNotes.edit(projectPath, mrIid, commentId, {body})
    } catch (e) {
      throw toGitPlatformError(e)
    }
  }

  async deleteComment(owner: string, repo: string, commentId: number): Promise<void> {
    const projectPath = `${owner}/${repo}`
    const mrIid = this.noteToMrIid.get(commentId)
    if (mrIid == null) {
      throw new GitPlatformError(
        `Cannot delete note ${commentId}: MR IID unknown (note was not created/listed via this adapter instance)`,
        'not_found'
      )
    }
    try {
      await this.api.MergeRequestNotes.remove(projectPath, mrIid, commentId)
      this.noteToMrIid.delete(commentId)
    } catch (e) {
      throw toGitPlatformError(e)
    }
  }

  async listComments(
    owner: string,
    repo: string,
    changeRequestId: number
  ): Promise<PlatformComment[]> {
    const projectPath = `${owner}/${repo}`
    try {
      const notes = await this.api.MergeRequestNotes.all(projectPath, changeRequestId, {
        sort: 'asc',
        orderBy: 'created_at'
      })
      // 过滤 system note（合并事件、标签变更等自动生成的 note）
      const userNotes = (notes as any[]).filter(n => !n.system)
      // 缓存 noteId → mrIid 映射，供 update/delete 使用
      for (const n of userNotes) {
        this.noteToMrIid.set(n.id, changeRequestId)
      }
      return userNotes.map(n => ({
        id: n.id,
        body: n.body ?? '',
        author: n.author?.username ?? '',
        createdAt: n.created_at
      }))
    } catch (e) {
      throw toGitPlatformError(e)
    }
  }

  // ─── 5. 行级评论 / Discussions（GLAPI-013~019）─────────────────────────────

  /**
   * 获取所有 MR discussions，提取 DiffNote 作为 ReviewComment 返回。
   * 同时缓存 noteId → {discussionId, mrIid, projectPath} 和
   * discussionId → {projectPath, mrIid} 映射。
   */
  private async getAllDiffDiscussions(
    projectPath: string,
    changeRequestId: number
  ): Promise<{discussions: any[]; reviewComments: ReviewComment[]}> {
    const discussions = (await this.api.MergeRequestDiscussions.all(
      projectPath,
      changeRequestId
    )) as any[]
    const reviewComments: ReviewComment[] = []
    for (const disc of discussions) {
      if (!disc.notes?.length) continue
      this.discussionIdToContext.set(disc.id, {projectPath, mrIid: changeRequestId})
      for (const note of disc.notes) {
        // 只提取 DiffNote（行级评论），跳过普通 DiscussionNote 和 system note
        if (note.type !== 'DiffNote' || note.system) continue
        this.noteToDiscussion.set(note.id, {
          discussionId: disc.id,
          mrIid: changeRequestId,
          projectPath
        })
        const pos = note.position
        const replyToId = disc.notes[0].id !== note.id ? disc.notes[0].id : undefined
        reviewComments.push({
          id: note.id,
          body: note.body ?? '',
          path: pos?.new_path ?? pos?.old_path ?? '',
          line: pos?.new_line != null ? Number(pos.new_line) : null,
          startLine: null,
          originalLine: pos?.old_line != null ? Number(pos.old_line) : null,
          author: note.author?.username ?? '',
          // eslint-disable-next-line camelcase
          in_reply_to_id: replyToId,
          createdAt: note.created_at
        })
      }
    }
    return {discussions, reviewComments}
  }

  async listReviewComments(
    owner: string,
    repo: string,
    changeRequestId: number
  ): Promise<ReviewComment[]> {
    const projectPath = `${owner}/${repo}`
    try {
      const {reviewComments} = await this.getAllDiffDiscussions(projectPath, changeRequestId)
      return reviewComments
    } catch (e) {
      throw toGitPlatformError(e)
    }
  }

  async submitReviewComments(
    owner: string,
    repo: string,
    changeRequestId: number,
    commitSha: string,
    comments: ReviewCommentDraft[],
    _reviewBody?: string
  ): Promise<number> {
    // GitLab 无 batch review 概念，逐条创建 discussion
    let submitted = 0
    for (const comment of comments) {
      try {
        await this.createReviewComment(owner, repo, changeRequestId, commitSha, comment)
        submitted++
      } catch {
        // GLAPI-015: 行级位置无法映射时降级为顶层 note
        try {
          await this.api.MergeRequestNotes.create(
            `${owner}/${repo}`,
            changeRequestId,
            `**${comment.path}** (line ${comment.line})\n\n${comment.body}`
          )
          submitted++
        } catch {
          // 降级也失败，跳过该条
        }
      }
    }
    return submitted
  }

  async createReviewComment(
    owner: string,
    repo: string,
    changeRequestId: number,
    commitSha: string,
    comment: ReviewCommentDraft
  ): Promise<void> {
    const projectPath = `${owner}/${repo}`
    try {
      // 需要 base_sha / head_sha / start_sha 构造 position
      const mr = await this.api.MergeRequests.show(projectPath, changeRequestId)
      const diffRefs = mr.diff_refs as any
      const discussion = (await this.api.MergeRequestDiscussions.create(
        projectPath,
        changeRequestId,
        comment.body,
        {
          commitId: commitSha,
          position: {
            baseSha: diffRefs.base_sha,
            headSha: diffRefs.head_sha,
            startSha: diffRefs.start_sha,
            positionType: 'text' as const,
            newPath: comment.path,
            oldPath: comment.path,
            newLine: String(comment.line)
          }
        }
      )) as any
      // 缓存 discussion 及其第一个 note
      this.discussionIdToContext.set(discussion.id, {projectPath, mrIid: changeRequestId})
      if (discussion.notes?.[0]) {
        this.noteToDiscussion.set(discussion.notes[0].id, {
          discussionId: discussion.id,
          mrIid: changeRequestId,
          projectPath
        })
      }
    } catch (e) {
      throw toGitPlatformError(e)
    }
  }

  async replyToReviewComment(
    owner: string,
    repo: string,
    changeRequestId: number,
    commentId: number,
    body: string
  ): Promise<PlatformComment> {
    const projectPath = `${owner}/${repo}`
    try {
      let cached = this.noteToDiscussion.get(commentId)
      // cache miss fallback: webhook 路径下触发评论的 noteId 可能未缓存，
      // 此时 fetch 所有 discussions 补充缓存
      if (!cached) {
        await this.getAllDiffDiscussions(projectPath, changeRequestId)
        cached = this.noteToDiscussion.get(commentId)
      }
      if (!cached) {
        throw new GitPlatformError(
          `Cannot reply to note ${commentId}: discussion ID unknown`,
          'not_found'
        )
      }
      const note = (await this.api.MergeRequestDiscussions.addNote(
        projectPath,
        changeRequestId,
        cached.discussionId,
        body
      )) as any
      this.noteToDiscussion.set(note.id, {
        discussionId: cached.discussionId,
        mrIid: changeRequestId,
        projectPath
      })
      return {
        id: note.id as number,
        body: note.body as string,
        author: note.author?.username ?? '',
        createdAt: note.created_at as string
      }
    } catch (e) {
      throw toGitPlatformError(e)
    }
  }

  async updateReviewComment(
    owner: string,
    repo: string,
    commentId: number,
    body: string
  ): Promise<void> {
    const projectPath = `${owner}/${repo}`
    const cached = this.noteToDiscussion.get(commentId)
    if (!cached) {
      throw new GitPlatformError(
        `Cannot update note ${commentId}: discussion ID unknown`,
        'not_found'
      )
    }
    try {
      await this.api.MergeRequestDiscussions.editNote(
        projectPath,
        cached.mrIid,
        cached.discussionId,
        commentId,
        {body} as any
      )
    } catch (e) {
      throw toGitPlatformError(e)
    }
  }

  async deleteReviewComment(owner: string, repo: string, commentId: number): Promise<void> {
    const projectPath = `${owner}/${repo}`
    const cached = this.noteToDiscussion.get(commentId)
    if (!cached) {
      throw new GitPlatformError(
        `Cannot delete note ${commentId}: discussion ID unknown`,
        'not_found'
      )
    }
    try {
      await this.api.MergeRequestDiscussions.removeNote(
        projectPath,
        cached.mrIid,
        cached.discussionId,
        commentId
      )
      this.noteToDiscussion.delete(commentId)
    } catch (e) {
      throw toGitPlatformError(e)
    }
  }

  async deletePendingReview(
    _owner: string,
    _repo: string,
    _changeRequestId: number
  ): Promise<void> {
    // GitLab 无 pending review 概念，空实现
  }

  // ─── 6. Review thread（GLAPI-017/018/019）────────────────────────────────

  async fetchThreadStatusMap(
    owner: string,
    repo: string,
    changeRequestId: number
  ): Promise<Map<string, boolean>> {
    const projectPath = `${owner}/${repo}`
    // discussionIdToContext 在 getAllDiffDiscussions 中自动填充
    try {
      const {discussions} = await this.getAllDiffDiscussions(projectPath, changeRequestId)
      const map = new Map<string, boolean>()
      for (const disc of discussions) {
        const firstNote = disc.notes?.[0]
        if (!firstNote || firstNote.type !== 'DiffNote') continue
        const pos = firstNote.position
        const path = pos?.new_path ?? pos?.old_path
        const line = pos?.new_line != null ? Number(pos.new_line) : null
        if (path && line != null) {
          const key = `${path}:${line}`
          const resolved = disc.notes.every((n: any) => !n.resolvable || n.resolved)
          if (!map.has(key) || !resolved) {
            map.set(key, resolved)
          }
        }
      }
      return map
    } catch (e) {
      throw toGitPlatformError(e)
    }
  }

  async fetchUnresolvedBotThreads(
    owner: string,
    repo: string,
    changeRequestId: number,
    botLogin: string
  ): Promise<ReviewThreadInfo[]> {
    const projectPath = `${owner}/${repo}`
    // discussionIdToContext 在 getAllDiffDiscussions 中自动填充
    try {
      const {discussions} = await this.getAllDiffDiscussions(projectPath, changeRequestId)
      const results: ReviewThreadInfo[] = []
      const normalizedBot = botLogin.toLowerCase()
      for (const disc of discussions) {
        const firstNote = disc.notes?.[0]
        if (!firstNote) continue
        const authorLogin = firstNote.author?.username ?? ''
        const isResolved = disc.notes.every((n: any) => !n.resolvable || n.resolved)
        if (!isResolved && authorLogin.toLowerCase() === normalizedBot) {
          const pos = firstNote.position
          results.push({
            id: disc.id,
            isResolved: false,
            path: pos?.new_path ?? pos?.old_path ?? null,
            line: pos?.new_line != null ? Number(pos.new_line) : null,
            firstCommentAuthorLogin: authorLogin,
            firstCommentBody: firstNote.body ?? null
          })
        }
      }
      return results
    } catch (e) {
      throw toGitPlatformError(e)
    }
  }

  async resolveThreads(
    threadIds: string[]
  ): Promise<{ok: number; failed: number; errors: Error[]}> {
    let ok = 0
    const errors: Error[] = []

    await Promise.allSettled(
      threadIds.map(async threadId => {
        const ctx = this.discussionIdToContext.get(threadId)
        if (!ctx) {
          errors.push(new Error(`No cached context for discussion ${threadId}`))
          return
        }
        try {
          await this.api.MergeRequestDiscussions.resolve(ctx.projectPath, ctx.mrIid, threadId, true)
          ok++
        } catch (e) {
          errors.push(e instanceof Error ? e : new Error(String(e)))
        }
      })
    )
    return {ok, failed: errors.length, errors}
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
