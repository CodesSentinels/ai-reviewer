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
  type SubmitReviewResult,
  type SubmitReviewHooks,
  type ReviewThreadInfo,
  type TreeResult,
  type PlatformPermission,
  type ReactionContent,
  GitPlatformError
} from './git-platform'

export type {GitLabCredential} from './gitlab-client'

/**
 * 无法解析 bot 用户名时的兜底值（GLAPI-022）。
 * 它几乎不可能等于真实用户名，所以只是「让流程能继续」，
 * 不是「身份已确认」——用它的地方必须已经打过降级 warning。
 */
export const FALLBACK_BOT_LOGIN = 'gitlab-bot'

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

/**
 * GitLab access level → PlatformPermission 的**穷举表**（GLAPI-020 / CMD-016）。
 *
 * 用穷举而不是 `>=` 阶梯：阶梯会把任何未知高值（60、999、损坏的响应）
 * 一路提升到 'admin'——权限响应异常时反而给出最高权限，正好是 fail open。
 * 表里没有的值一律视为不可信，由调用方抛错交上层 fail closed。
 *
 * 两个容易漏掉的等级显式落到最保守的一档：
 * - 5  MINIMAL_ACCESS → none（够不到 Guest，连读都不该假设）
 * - 15 PLANNER（GitLab 17.7+，Guest 与 Reporter 之间）→ read
 *      它在 Reporter 之下，够不到命令矩阵里 triage 的门槛
 *
 * 60 ADMIN 故意不在表内：那是实例管理员，不是项目成员等级，
 * 项目成员接口不该返回它。真出现说明响应不对劲，宁可 fail closed 报出来，
 * 也不要靠 `>= 50` 顺手当 Owner 放行。
 */
const ACCESS_LEVEL_TO_PERMISSION: ReadonlyMap<number, PlatformPermission> = new Map<
  number,
  PlatformPermission
>([
  [0, 'none'], // NO_ACCESS
  [5, 'none'], // MINIMAL_ACCESS
  [10, 'read'], // GUEST
  [15, 'read'], // PLANNER
  [20, 'triage'], // REPORTER
  [30, 'write'], // DEVELOPER
  [40, 'maintain'], // MAINTAINER
  [50, 'admin'] // OWNER
])

/** 已知等级 → 权限；未知等级返回 null（调用方必须当成查询失败处理） */
function accessLevelToPermission(level: number): PlatformPermission | null {
  return ACCESS_LEVEL_TO_PERMISSION.get(level) ?? null
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
  /** 凭据自检 / 首次查询得到的真实 bot 用户名，避免重复请求 */
  private verifiedLogin: string | null = null

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
      platform: 'gitlab',
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
    _reviewBody?: string,
    hooks?: SubmitReviewHooks
  ): Promise<SubmitReviewResult> {
    // GitLab 无 batch review 概念，逐条创建 discussion。
    //
    // 必须逐条汇报成败：只回一个总数的话，调用方无从知道**哪几条**没发出去，
    // 于是会把那些位置上被取代的 resolved 旧讨论一并删掉——新发现没发成，
    // 历史也没了（REVIEW-013）。失败项交回调用方统一做顶层降级（REVIEW-014）。
    const delivered: ReviewCommentDraft[] = []
    const failed: ReviewCommentDraft[] = []
    const staleSkipped: ReviewCommentDraft[] = []
    for (const [i, comment] of comments.entries()) {
      // STATE-011/012：**每条** discussion 创建前重读 HEAD。
      // 只在整批之前检查一次是不够的——一批可能有十几条，第一条写完 HEAD 就变了
      // 的话，剩下的仍然是基于旧 diff 的结论。
      if (hooks?.ensureFresh != null && !(await hooks.ensureFresh())) {
        staleSkipped.push(...comments.slice(i))
        getLogger().warning(
          `submitReviewComments: HEAD moved mid-batch — skipping ${staleSkipped.length} ` +
            'remaining comment(s) rather than publishing stale findings (STATE-011/012)'
        )
        break
      }
      try {
        await this.createReviewComment(owner, repo, changeRequestId, commitSha, comment)
        delivered.push(comment)
      } catch (lineError) {
        // GLAPI-015: 行级位置无法映射时降级为顶层 note（同样带幂等 marker）
        try {
          await this.createComment(
            owner,
            repo,
            changeRequestId,
            `**${comment.path}** (line ${comment.line})\n\n${comment.body}`
          )
          delivered.push(comment)
        } catch (topLevelError) {
          getLogger().warning(
            `submitReviewComments: both line-level and top-level delivery failed for ` +
              `${comment.path}:${comment.line} — line: ${String(lineError)}; ` +
              `top-level: ${String(topLevelError)}`
          )
          failed.push(comment)
        }
      }
    }
    return {delivered, failed, staleSkipped}
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
      platform: 'gitlab',
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
      platform: 'gitlab',
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
   * 流程：Users.all({username}) 取 userId → ProjectMembers.all(projectId,
   * {includeInherited, userIds}) 取 access_level → 映射为 PlatformPermission。
   *
   * GLAPI-021 / CMD-016 —— 返回 'none' 与抛错的边界必须分清：
   * - 'none' 只用于**查询成功且答案明确**的两种情况：查无此用户、
   *   成员列表里没有该用户（不是项目成员，外部贡献者的正常路径）。
   * - 其余一切都抛 GitPlatformError：401/403/超时/5xx/网络错误、成员接口
   *   任何错误（含语义含混的 404）、响应结构或 access_level 不合法。这些是
   *   「不知道」，不是「确认没权限」。把它们折叠成 'none' 会让 permission.ts
   *   记成 queryFailed=false，dispatcher 随后仍承认 PR 作者豁免——权限 API
   *   故障期间任何作者都能触发 review/summary，正好是 fail open。
   *   语义与 GitHub adapter 一致（那边同样是 throw）。
   *
   * GLAPI-026: 抛错前把诊断写进日志，避免 fail closed 变成无法排查的静默拒绝。
   */
  async getCollaboratorPermission(
    owner: string,
    repo: string,
    username: string
  ): Promise<PlatformPermission> {
    const projectPath = `${owner}/${repo}`

    // 1. 用户名 → userId
    let users: any[]
    try {
      users = (await withGitLabRetry('getCollaboratorPermission.users', async () =>
        this.api.Users.all(listOptions({username}))
      )) as any[]
    } catch (e) {
      throw this.permissionLookupFailure(e, 'getCollaboratorPermission.users')
    }
    const user = users.find(
      (u: any) =>
        typeof u?.username === 'string' && u.username.toLowerCase() === username.toLowerCase()
    )
    // 查询成功但查无此人 —— 这是明确答案，不是失败
    if (!user) return 'none'
    if (typeof user.id !== 'number' || !Number.isInteger(user.id)) {
      throw this.permissionLookupFailure(
        new Error(`user lookup returned a non-numeric id for "${username}"`),
        'getCollaboratorPermission.users'
      )
    }

    // 2. userId → access_level。
    // 用成员**列表**查询而不是 show(userId)：show 对「不是成员」和「项目不存在 /
    // 项目不可见 / 隐藏的授权失败」返回的都是 404，无法区分，把它一律当成
    // 「确定不是成员」就会在凭据失效或项目可见性变化时给出 queryFailed=false，
    // 让 PR 作者豁免继续放行（fail open）。列表查询的语义是明确的：
    // 200 + 空集合 = 确定不是成员，任何错误（含 404）= 不确定 → 抛错。
    let members: any[]
    try {
      members = (await withGitLabRetry('getCollaboratorPermission.members', async () =>
        (this.api.ProjectMembers as any).all(
          projectPath,
          listOptions({includeInherited: true, userIds: [user.id]})
        )
      )) as any[]
    } catch (e) {
      throw this.permissionLookupFailure(e, 'getCollaboratorPermission.members')
    }
    if (!Array.isArray(members)) {
      throw this.permissionLookupFailure(
        new Error('project member list response is not an array'),
        'getCollaboratorPermission.members'
      )
    }
    // 服务端若忽略 userIds 过滤，这里仍按 id 精确匹配，不会误取他人的等级
    const member = members.find((m: any) => m?.id === user.id)
    // 查询成功但不在成员列表里 —— 明确的「不是项目成员」，外部贡献者的正常路径
    if (!member) return 'none'

    return this.memberAccessToPermission(member.access_level, username)
  }

  /**
   * 把成员响应里的 access_level 转成权限等级（CMD-016）。
   *
   * 两道关卡，都往 fail closed 的方向倒：
   * 1. 格式：缺字段、null、字符串、NaN、小数都不是「等级 0」，而是「响应不可信」。
   *    原来的 `?? 0` 会把它们静默折叠成 'none' + queryFailed=false，放开作者豁免。
   * 2. 取值：必须是 ACCESS_LEVEL_TO_PERMISSION 里的已知等级。未知值（60、999、
   *    负数）过去会被 `>= 50` 的阶梯提升成 'admin'——响应越异常权限越高。
   *
   * 注意 0 本身是合法值（GitLab NO_ACCESS），不能一并拒掉。
   */
  private memberAccessToPermission(raw: unknown, username: string): PlatformPermission {
    if (typeof raw !== 'number' || !Number.isInteger(raw)) {
      throw this.permissionLookupFailure(
        new Error(
          `project member response for "${username}" has an invalid access_level: ${JSON.stringify(
            raw
          )}`
        ),
        'getCollaboratorPermission.members'
      )
    }
    const permission = accessLevelToPermission(raw)
    if (permission == null) {
      throw this.permissionLookupFailure(
        new Error(
          `project member response for "${username}" has an unknown access_level: ${raw} ` +
            `(known levels: ${[...ACCESS_LEVEL_TO_PERMISSION.keys()].join(', ')})`
        ),
        'getCollaboratorPermission.members'
      )
    }
    return permission
  }

  /** 权限查询的不确定性失败：记录诊断并归一化为 GitPlatformError（调用方 fail closed） */
  private permissionLookupFailure(e: unknown, operation: string): GitPlatformError {
    const err = normalizeGitLabError(e, operation)
    getLogger().warning(
      `Permission lookup failed (${err.errorKind}): ${err.message} — ` +
        'result is indeterminate, the caller must fail closed'
    )
    return err
  }

  // ─── 9. 用户身份（GLAPI-022）───────────────────────────────────────────────

  /**
   * 获取当前 PAT / Job Token 对应的用户名。
   * 用于 bot 自评论过滤（fetchUnresolvedBotThreads 的 botLogin 参数）。
   */
  async getAuthenticatedLogin(): Promise<string> {
    if (this.verifiedLogin != null) return this.verifiedLogin
    try {
      const login = await this.resolveCurrentUsername()
      this.verifiedLogin = login
      return login
    } catch (e) {
      const err = normalizeGitLabError(e, 'getAuthenticatedLogin')
      // 说清后果和补救手段：这里返回的名字会被用来匹配 note 作者，
      // 名字不对 ≠ 报错，而是「一条 bot 评论都识别不出来」的静默失效
      getLogger().warning(
        `Failed to resolve the bot username (${err.message}) — falling back to ` +
          `'${FALLBACK_BOT_LOGIN}'. Bot-authored threads will not be recognized unless ` +
          'AI_REVIEWER_BOT_GITLAB_LOGIN is set to the real bot username.'
      )
      return FALLBACK_BOT_LOGIN
    }
  }

  /**
   * 身份自检（GLAPI-022 / GLAPI-029）：确认当前凭据能解析出自己的用户名。
   *
   * **只证明身份，不证明权限能力**：它探的是 `GET /user`，而命令权限判定走的是
   * `GET /users` + `GET /projects/:id/members`，是另外两个端点、另外的授权范围。
   * 调用方不得用这里的成功推断「权限查询可用」。凭据类型层面的能力差异见
   * JOB_TOKEN_LIMITATION_WARNING。
   *
   * 与 getAuthenticatedLogin 的区别是**不吞错**——启动期要能区分「凭据有效」
   * 和「凭据无效」，而不是一律回落到编造的用户名继续往下跑。
   *
   * 不进 IGitPlatform：GitHub 的 installation token 本来就调不了 GET /user，
   * 强行统一只会让 GitHub 侧多一次注定失败的探测。
   */
  async verifyCredential(): Promise<string> {
    const login = await this.resolveCurrentUsername()
    this.verifiedLogin = login
    return login
  }

  /** 查询当前凭据对应的用户名；失败抛 GitPlatformError */
  private async resolveCurrentUsername(): Promise<string> {
    try {
      const user = (await withGitLabRetry('getAuthenticatedLogin', async () =>
        this.api.Users.showCurrentUser()
      )) as any
      return user.username as string
    } catch (e) {
      throw normalizeGitLabError(e, 'getAuthenticatedLogin')
    }
  }
}
