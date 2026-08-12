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
 * - GLAPI-020~023: 权限 / 身份 / Award Emoji
 * - GLAPI-024: 所有 list API 走 listOptions() 的显式分页契约
 * - GLAPI-025/026: 所有 API 调用经 withGitLabRetry（429/5xx/超时重试，401/403 不重试）
 * - GLAPI-027: 写操作带隐藏 marker，重试前先探测上一次是否已写入成功
 * - GLAPI-029/030: 客户端统一由 createGitLabClient 构造
 * - DEP-001/004: listRepositoryTree（仓库文件树）
 */

import {
  createGitLabClient,
  listOptions,
  TREE_PAGINATION_DEFAULTS,
  type GitLabApi,
  type GitLabClientConfig
} from './gitlab-client'
import {normalizeGitLabError} from './gitlab-errors'
import {withGitLabRetry} from './gitlab-retry'
import {getLogger} from './logger'
import {
  appendWriteMarker,
  buildWriteMarker,
  hasWriteMarker,
  newWriteOperationId,
  stripWriteMarkers
} from './gitlab-write-marker'
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
  GitPlatformError
} from './git-platform'

export type {GitLabCredential} from './gitlab-client'

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

// ─── GitHub ReactionContent → GitLab Award Emoji name 映射 ──────────────────

const REACTION_TO_EMOJI: Record<ReactionContent, string> = {
  '+1': 'thumbsup',
  '-1': 'thumbsdown',
  laugh: 'laughing',
  confused: 'confused',
  heart: 'heart',
  hooray: 'tada',
  rocket: 'rocket',
  eyes: 'eyes'
}

// ─── GitLab AccessLevel → PlatformPermission 映射 ───────────────────────────

function accessLevelToPermission(level: number): PlatformPermission {
  if (level >= 50) return 'admin' // OWNER
  if (level >= 40) return 'maintain' // MAINTAINER
  if (level >= 30) return 'write' // DEVELOPER
  if (level >= 20) return 'triage' // REPORTER
  if (level >= 10) return 'read' // GUEST
  return 'none'
}

/** GitLab note → 平台无关 PlatformComment（GLAPI-032：snake_case → camelCase） */
function toPlatformComment(note: any): PlatformComment {
  return {
    id: note.id as number,
    body: stripWriteMarkers(note.body),
    author: note.author?.username ?? '',
    createdAt: note.created_at as string
  }
}

// ─── GitLabPlatform ────────────────────────────────────────────────────────

export class GitLabPlatform implements IGitPlatform {
  private api: GitLabApi
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

  /**
   * 只接受受信任配置构造（GLAPI-029）：host/凭据/timeout 全部来自
   * resolveGitLabClientConfig()，adapter 不再自己拼 host 或读环境变量。
   */
  constructor(config: GitLabClientConfig) {
    this.api = createGitLabClient(config)
  }

  // ─── 写幂等探测（GLAPI-027）──────────────────────────────────────────────

  /** 按 marker 查找已存在的 MR note；命中说明上一次写入其实已成功 */
  private async findNoteByMarker(
    projectPath: string,
    changeRequestId: number,
    marker: string
  ): Promise<PlatformComment | null> {
    const notes = (await this.api.MergeRequestNotes.all(
      projectPath,
      changeRequestId,
      listOptions({sort: 'desc', orderBy: 'created_at'} as const)
    )) as any[]
    const hit = notes.find(n => hasWriteMarker(n.body, marker))
    if (!hit) return null
    this.noteToMrIid.set(hit.id, changeRequestId)
    return toPlatformComment(hit)
  }

  /** 按 marker 查找已存在的 discussion；命中时补齐缓存 */
  private async findDiscussionByMarker(
    projectPath: string,
    changeRequestId: number,
    marker: string
  ): Promise<boolean> {
    const discussions = (await this.api.MergeRequestDiscussions.all(
      projectPath,
      changeRequestId,
      listOptions()
    )) as any[]
    for (const disc of discussions) {
      const hit = (disc.notes ?? []).find((n: any) => hasWriteMarker(n.body, marker))
      if (!hit) continue
      this.discussionIdToContext.set(disc.id, {projectPath, mrIid: changeRequestId})
      this.noteToDiscussion.set(hit.id, {
        discussionId: disc.id,
        mrIid: changeRequestId,
        projectPath
      })
      return true
    }
    return false
  }

  // ─── 10. 仓库文件树（DEP-001 / DEP-004）─────────────────────────────────

  /**
   * 获取 GitLab 仓库文件树。
   *
   * 使用 Repository Tree API (recursive) + 显式分页契约（GLAPI-024）。
   *
   * DEP-004 边界处理：
   * - 空仓库 → 返回空数组（正常状态，不抛错）
   * - subgroup 项目 → owner 含 `/`（如 "group/subgroup"），与 repo 拼接成完整 projectPath
   * - 超大仓库 → 用 TREE_PAGINATION_DEFAULTS（5 万条）而非通用的 5000 条上限；
   *   条目数正好卡在上限时再探一页确认，而不是猜「满了就是截断」
   * - Unicode 路径 → gitbeaker 内部做 URL 编码
   * - API 部分失败 → 抛 GitPlatformError（不静默返回空数组）
   * - 传入 path → 只列举该目录下一层（截断后按需回填），目录不存在返回空树
   */
  async listRepositoryTree(
    owner: string,
    repo: string,
    ref: string,
    path?: string
  ): Promise<TreeResult> {
    const projectPath = `${owner}/${repo}`
    const scoped = path != null && path !== ''
    try {
      const trees = await withGitLabRetry(
        scoped ? 'listRepositoryTree(dir)' : 'listRepositoryTree',
        async () =>
          this.api.Repositories.allRepositoryTrees(
            projectPath,
            listOptions(
              scoped ? {ref, recursive: false, path} : {ref, recursive: true},
              TREE_PAGINATION_DEFAULTS
            ) as any
          )
      )
      // GitLab 的 tree 条目 path 本身就是仓库根相对路径，无需拼接
      const entries = trees.map(t => ({type: t.type, path: t.path}))
      // 目录探查只有一层，不参与整树的截断判定
      if (scoped) {
        return {entries, truncated: false}
      }
      const limit = TREE_PAGINATION_DEFAULTS.perPage * TREE_PAGINATION_DEFAULTS.maxPages
      // 没到上限说明翻页自然结束，一定是完整的
      if (entries.length < limit) {
        return {entries, truncated: false}
      }
      // 正好卡在上限：可能刚好取完，也可能还有下一页。探一页拿事实，
      // 避免「恰好 5 万个文件的仓库」被误报成截断（GLAPI-024 / DEP-004）
      return {entries, truncated: await this.hasMoreTreePages(projectPath, ref)}
    } catch (e) {
      // 空仓库返回 404 "404 Tree Not Found"，视为合法的空树；
      // 目录探查打到不存在的路径同理（投机查询，不是失败）
      const err = normalizeGitLabError(e, 'listRepositoryTree')
      if (err.errorKind === 'not_found' && (scoped || /tree not found/i.test(err.message))) {
        return {entries: [], truncated: false}
      }
      throw err
    }
  }

  /**
   * 探测文件树在分页上限之后是否还有内容（DEP-004）。
   *
   * 显式传 `page` 让 gitbeaker 退化为单页请求，perPage 必须与主查询一致，
   * 否则页码换算不到同一个位置。探测失败时保守返回 true —— 宁可提示
   * 「可能不完整」，也不能因为一次探测出错就谎报完整。
   */
  private async hasMoreTreePages(projectPath: string, ref: string): Promise<boolean> {
    try {
      const next = await withGitLabRetry('listRepositoryTree(probe)', async () =>
        this.api.Repositories.allRepositoryTrees(projectPath, {
          ref,
          recursive: true,
          page: TREE_PAGINATION_DEFAULTS.maxPages + 1,
          perPage: TREE_PAGINATION_DEFAULTS.perPage,
          maxPages: 1
        } as any)
      )
      return Array.isArray(next) && next.length > 0
    } catch (e) {
      getLogger().warning(
        `listRepositoryTree: truncation probe failed for ${projectPath}@${ref}, ` +
          `assuming truncated: ${normalizeGitLabError(e, 'listRepositoryTree(probe)').message}`
      )
      return true
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
      // gitbeaker 对 path/ref 做 URL 编码，subgroup、Unicode、含空格路径均可直传
      const file = await withGitLabRetry('getFileContent', async () =>
        this.api.RepositoryFiles.show(projectPath, path, ref)
      )
      return Buffer.from(file.content, 'base64').toString('utf8')
    } catch (e) {
      const err = normalizeGitLabError(e, 'getFileContent')
      if (err.errorKind === 'not_found') return null
      throw err
    }
  }

  // ─── 1. PR/MR 信息（GLAPI-001/002/006）────────────────────────────────────

  async getChangeRequest(
    owner: string,
    repo: string,
    changeRequestId: number
  ): Promise<ChangeRequestInfo> {
    const projectPath = `${owner}/${repo}`
    const mr = await withGitLabRetry('getChangeRequest', async () =>
      this.api.MergeRequests.show(projectPath, changeRequestId)
    )
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
  }

  async updateChangeRequestBody(
    owner: string,
    repo: string,
    changeRequestId: number,
    body: string
  ): Promise<void> {
    const projectPath = `${owner}/${repo}`
    await withGitLabRetry('updateChangeRequestBody', async () =>
      this.api.MergeRequests.edit(projectPath, changeRequestId, {description: body})
    )
  }

  async listChangeRequestCommits(
    owner: string,
    repo: string,
    changeRequestId: number
  ): Promise<string[]> {
    const projectPath = `${owner}/${repo}`
    const commits = await withGitLabRetry('listChangeRequestCommits', async () =>
      this.api.MergeRequests.allCommits(projectPath, changeRequestId, listOptions() as any)
    )
    return commits.map(c => c.id)
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
    const diff = await withGitLabRetry('compareDiff', async () =>
      this.api.Repositories.compare(projectPath, _base, _head)
    )
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
  }

  // ─── 4. 顶层评论 / MR Notes（GLAPI-007~012）────────────────────────────────

  async createComment(
    owner: string,
    repo: string,
    changeRequestId: number,
    body: string
  ): Promise<PlatformComment> {
    const projectPath = `${owner}/${repo}`
    // GLAPI-027：正文带幂等 marker，重试前先探测是否已写入。
    // operationId 每次调用新生成 → marker 只在本次调用的重试之间复用，
    // 不会命中同 MR 里正文相同的历史评论。
    const marker = buildWriteMarker({
      projectPath,
      changeRequestId,
      op: 'note',
      operationId: newWriteOperationId(),
      body
    })
    const markedBody = appendWriteMarker(body, marker)

    return withGitLabRetry('createComment', async attempt => {
      if (attempt > 1) {
        const existing = await this.findNoteByMarker(projectPath, changeRequestId, marker)
        if (existing != null) return existing
      }
      const note = (await this.api.MergeRequestNotes.create(
        projectPath,
        changeRequestId,
        markedBody
      )) as any
      this.noteToMrIid.set(note.id, changeRequestId)
      return toPlatformComment(note)
    })
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
    // 更新是覆盖写，天然幂等，不需要 marker 探测
    await withGitLabRetry('updateComment', async () =>
      this.api.MergeRequestNotes.edit(projectPath, mrIid, commentId, {body})
    )
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
      await withGitLabRetry('deleteComment', async () =>
        this.api.MergeRequestNotes.remove(projectPath, mrIid, commentId)
      )
    } catch (e) {
      const err = normalizeGitLabError(e, 'deleteComment')
      // 重试期间上一次删除其实已成功 → 404 视为达成目标（GLAPI-027）
      if (err.errorKind !== 'not_found') throw err
    }
    this.noteToMrIid.delete(commentId)
  }

  async listComments(
    owner: string,
    repo: string,
    changeRequestId: number
  ): Promise<PlatformComment[]> {
    const projectPath = `${owner}/${repo}`
    // GLAPI-024：显式分页，不依赖 SDK 默认 perPage
    const notes = await withGitLabRetry('listComments', async () =>
      this.api.MergeRequestNotes.all(
        projectPath,
        changeRequestId,
        listOptions({sort: 'asc', orderBy: 'created_at'} as const)
      )
    )
    // 过滤 system note（合并事件、标签变更等自动生成的 note）
    const userNotes = (notes as any[]).filter(n => !n.system)
    // 缓存 noteId → mrIid 映射，供 update/delete 使用
    for (const n of userNotes) {
      this.noteToMrIid.set(n.id, changeRequestId)
    }
    return userNotes.map(toPlatformComment)
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
    const discussions = (await withGitLabRetry('listDiscussions', async () =>
      this.api.MergeRequestDiscussions.all(projectPath, changeRequestId, listOptions())
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
          body: stripWriteMarkers(note.body),
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
    const {reviewComments} = await this.getAllDiffDiscussions(projectPath, changeRequestId)
    return reviewComments
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
        // GLAPI-015: 行级位置无法映射时降级为顶层 note（同样带幂等 marker）
        try {
          await this.createComment(
            owner,
            repo,
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
    // 文件路径只参与摘要（opDetail），不进 marker 文本：
    // Git 文件名允许 `>` 甚至 `-->`，原样拼接会提前闭合 HTML 注释
    const marker = buildWriteMarker({
      projectPath,
      changeRequestId,
      op: 'discussion',
      opDetail: `${comment.path}:${comment.line}`,
      operationId: newWriteOperationId(),
      body: comment.body
    })
    const markedBody = appendWriteMarker(comment.body, marker)

    await withGitLabRetry('createReviewComment', async attempt => {
      // GLAPI-027：重试前先确认上一次是否已经建出 discussion
      if (attempt > 1) {
        const exists = await this.findDiscussionByMarker(projectPath, changeRequestId, marker)
        if (exists) return
      }
      // 需要 base_sha / head_sha / start_sha 构造 position
      const mr = await this.api.MergeRequests.show(projectPath, changeRequestId)
      const diffRefs = mr.diff_refs as any
      const discussion = (await this.api.MergeRequestDiscussions.create(
        projectPath,
        changeRequestId,
        markedBody,
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
    })
  }

  async replyToReviewComment(
    owner: string,
    repo: string,
    changeRequestId: number,
    commentId: number,
    body: string
  ): Promise<PlatformComment> {
    const projectPath = `${owner}/${repo}`
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
    const discussionId = cached.discussionId
    const marker = buildWriteMarker({
      projectPath,
      changeRequestId,
      op: 'reply',
      opDetail: discussionId,
      operationId: newWriteOperationId(),
      body
    })
    const markedBody = appendWriteMarker(body, marker)

    return withGitLabRetry('replyToReviewComment', async attempt => {
      if (attempt > 1) {
        const {discussions} = await this.getAllDiffDiscussions(projectPath, changeRequestId)
        const disc = discussions.find(d => d.id === discussionId)
        const hit = (disc?.notes ?? []).find((n: any) => hasWriteMarker(n.body, marker))
        if (hit != null) return toPlatformComment(hit)
      }
      const note = (await this.api.MergeRequestDiscussions.addNote(
        projectPath,
        changeRequestId,
        discussionId,
        markedBody
      )) as any
      this.noteToDiscussion.set(note.id, {
        discussionId,
        mrIid: changeRequestId,
        projectPath
      })
      return toPlatformComment(note)
    })
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
    await withGitLabRetry('updateReviewComment', async () =>
      this.api.MergeRequestDiscussions.editNote(
        projectPath,
        cached.mrIid,
        cached.discussionId,
        commentId,
        {body} as any
      )
    )
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
      await withGitLabRetry('deleteReviewComment', async () =>
        this.api.MergeRequestDiscussions.removeNote(
          projectPath,
          cached.mrIid,
          cached.discussionId,
          commentId
        )
      )
    } catch (e) {
      const err = normalizeGitLabError(e, 'deleteReviewComment')
      // 重试期间上一次删除其实已成功 → 404 视为达成目标（GLAPI-027）
      if (err.errorKind !== 'not_found') throw err
    }
    this.noteToDiscussion.delete(commentId)
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
  }

  async fetchUnresolvedBotThreads(
    owner: string,
    repo: string,
    changeRequestId: number,
    botLogin: string
  ): Promise<ReviewThreadInfo[]> {
    const projectPath = `${owner}/${repo}`
    // discussionIdToContext 在 getAllDiffDiscussions 中自动填充
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
          firstCommentBody: firstNote.body == null ? null : stripWriteMarkers(firstNote.body)
        })
      }
    }
    return results
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
          await withGitLabRetry('resolveThread', async () =>
            this.api.MergeRequestDiscussions.resolve(ctx.projectPath, ctx.mrIid, threadId, true)
          )
          ok++
        } catch (e) {
          errors.push(e instanceof Error ? e : new Error(String(e)))
        }
      })
    )
    return {ok, failed: errors.length, errors}
  }

  // ─── 7. Reaction（GLAPI-023）─────────────────────────────────────────────

  /**
   * GitLab Award Emoji ACK。
   *
   * GitHub ReactionContent → GitLab emoji name 映射后，
   * 通过 MergeRequestNoteAwardEmojis.award 添加。
   * GitLab 不区分 issue_comment / review_comment，都是 MR note。
   * 失败不阻塞核心审查（由调用方 reaction.ts 捕获）。
   */
  async addReaction(
    owner: string,
    repo: string,
    changeRequestId: number,
    commentId: number,
    content: ReactionContent,
    _commentKind: 'issue_comment' | 'review_comment'
  ): Promise<void> {
    const projectPath = `${owner}/${repo}`
    const emojiName = REACTION_TO_EMOJI[content]
    try {
      await withGitLabRetry('addReaction', async () =>
        (this.api.MergeRequestNoteAwardEmojis as any).award(
          projectPath,
          changeRequestId,
          commentId,
          emojiName
        )
      )
    } catch (e) {
      const err = normalizeGitLabError(e, 'addReaction')
      // 重复 award 同一 emoji 是这个 endpoint 唯一的冲突场景（GitLab 各版本返回的
      // 409 文案不一致，故按状态码而非文案判定）。ACK 已经在了，视为达成目标。
      if (err.errorKind !== 'conflict') throw err
      getLogger().debug(`addReaction: ${emojiName} already awarded on note ${commentId}`)
    }
  }

  // ─── 8. 权限（GLAPI-020 / GLAPI-021 / GLAPI-026）──────────────────────────

  /**
   * 按用户名查询项目 access level。
   *
   * 流程：Users.all({username}) 获取 userId → ProjectMembers.show(projectId, userId, {includeInherited})
   * 获取 access_level → 映射为 PlatformPermission。
   *
   * GLAPI-021: 任何环节失败都 fail closed，返回 'none'。
   * GLAPI-026: 401/403 时把权限诊断写进日志，避免 fail closed 变成无法排查的静默拒绝。
   */
  async getCollaboratorPermission(
    owner: string,
    repo: string,
    username: string
  ): Promise<PlatformPermission> {
    const projectPath = `${owner}/${repo}`
    try {
      // 1. 用户名 → userId
      const users = (await withGitLabRetry('getCollaboratorPermission.users', async () =>
        this.api.Users.all(listOptions({username}))
      )) as any[]
      const user = users.find(
        (u: any) => (u.username as string).toLowerCase() === username.toLowerCase()
      )
      if (!user) return 'none'

      // 2. userId → access_level（includeInherited 包含继承的组权限）
      const member = (await withGitLabRetry('getCollaboratorPermission.member', async () =>
        (this.api.ProjectMembers as any).show(projectPath, user.id, {
          includeInherited: true
        })
      )) as any
      const level: number = member.access_level ?? 0

      return accessLevelToPermission(level)
    } catch (e) {
      const err = normalizeGitLabError(e, 'getCollaboratorPermission')
      if (err.errorKind !== 'not_found') {
        getLogger().warning(`Permission lookup failed, denying access: ${err.message}`)
      }
      // GLAPI-021: fail closed
      return 'none'
    }
  }

  // ─── 9. 用户身份（GLAPI-022）───────────────────────────────────────────────

  /**
   * 获取当前 PAT / Job Token 对应的用户名。
   * 用于 bot 自评论过滤（fetchUnresolvedBotThreads 的 botLogin 参数）。
   */
  async getAuthenticatedLogin(): Promise<string> {
    try {
      const user = (await withGitLabRetry('getAuthenticatedLogin', async () =>
        this.api.Users.showCurrentUser()
      )) as any
      return user.username as string
    } catch (e) {
      const err = normalizeGitLabError(e, 'getAuthenticatedLogin')
      getLogger().warning(`Failed to resolve PAT username: ${err.message}`)
      return 'gitlab-bot'
    }
  }
}
