/**
 * platform/github-platform.ts - GitHub adapter（ARCH-018 / ARCH-019）
 *
 * 将 IGitPlatform 接口映射到现有 Octokit REST + GraphQL 调用。
 * GraphQL 仅用于 review thread 操作（fetchThreadStatusMap、
 * fetchUnresolvedBotThreads、resolveThreads），其余全部走 REST。
 *
 * 本文件是唯一允许 import `octokit` 的平台 adapter 层代码。
 * 共享业务核心不得直接 import 本文件或 octokit。
 *
 * ARCH-022: 所有 Octokit 错误统一转换为 GitPlatformError。
 */
import {octokit} from '../octokit'
import {getLogger} from './logger'
import {
  buildWriteMarker,
  newWriteOperationId,
  appendWriteMarker,
  hasWriteMarker,
  stripWriteMarkers
} from './write-marker'
import {
  GitPlatformError,
  type ChangeRequestInfo,
  type DiffFile,
  type DiffResult,
  type IGitPlatform,
  type PlatformComment,
  type PlatformPermission,
  type ReactionContent,
  type ReviewComment,
  type ReviewCommentDraft,
  type SubmitReviewResult,
  type SubmitReviewHooks,
  type ReviewThreadInfo,
  type TreeResult
} from './git-platform'

// ─── GraphQL documents（ARCH-019：保留在 GitHub adapter 内）──────────────

const GET_REVIEW_THREADS = `
  query GetReviewThreads(
    $owner: String!
    $repo: String!
    $number: Int!
    $after: String
  ) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        reviewThreads(first: 100, after: $after) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            id
            isResolved
            path
            line
            comments(first: 1) {
              nodes {
                author {
                  login
                }
                body
              }
            }
          }
        }
      }
    }
  }
`

const RESOLVE_THREAD = `
  mutation ResolveThread($threadId: ID!) {
    resolveReviewThread(input: { threadId: $threadId }) {
      thread {
        isResolved
      }
    }
  }
`

interface GetReviewThreadsResponse {
  repository: {
    pullRequest: {
      reviewThreads: {
        pageInfo: {
          hasNextPage: boolean
          endCursor: string | null
        }
        nodes: Array<{
          id: string
          isResolved: boolean
          path: string
          line: number | null
          comments: {
            nodes: Array<{
              author: {login: string} | null
              body: string
            }>
          }
        }>
      }
    }
  }
}

// ─── 错误转换 ─────────────────────────────────────────────────────────────

function toGitPlatformError(e: unknown): GitPlatformError {
  const msg = String(e)
  const status = (e as any)?.status as number | undefined

  if (status === 404) {
    return new GitPlatformError(msg, 'not_found', status, e)
  }
  if (status === 409) {
    return new GitPlatformError(msg, 'conflict', status, e)
  }
  if (status === 403) {
    return new GitPlatformError(msg, 'forbidden', status, e)
  }
  if (status === 429) {
    return new GitPlatformError(msg, 'rate_limited', status, e)
  }
  if (status != null && status >= 500) {
    return new GitPlatformError(msg, 'server_error', status, e)
  }
  if (/ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|timed? ?out/i.test(msg)) {
    return new GitPlatformError(msg, 'timeout', undefined, e)
  }
  return new GitPlatformError(msg, 'unknown', status, e)
}

function normalizeLogin(login: string): string {
  return login.replace(/\[bot\]$/i, '').toLowerCase()
}

// ─── GitHub adapter 实现 ──────────────────────────────────────────────────

/** API 返回 → 平台无关评论；顺带剥掉写 marker，共享核心看不到平台实现细节 */
function toPlatformComment(data: any): PlatformComment {
  return {
    id: data.id,
    body: stripWriteMarkers(data.body ?? ''),
    author: data.user?.login ?? '',
    nodeId: data.node_id,
    createdAt: data.created_at
  }
}

export class GitHubPlatform implements IGitPlatform {
  // ─── 1. PR 信息 ───────────────────────────────────────────────────────────

  async getChangeRequest(
    owner: string,
    repo: string,
    changeRequestId: number
  ): Promise<ChangeRequestInfo> {
    try {
      const {data} = await octokit.pulls.get({
        owner,
        repo,
        // eslint-disable-next-line camelcase
        pull_number: changeRequestId
      })
      return {
        number: data.number,
        title: data.title,
        body: data.body ?? '',
        state: data.merged ? 'merged' : (data.state as 'open' | 'closed'),
        baseSha: data.base.sha,
        headSha: data.head.sha,
        baseRef: data.base.ref,
        headRef: data.head.ref,
        author: data.user?.login ?? ''
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
    try {
      await octokit.pulls.update({
        owner,
        repo,
        // eslint-disable-next-line camelcase
        pull_number: changeRequestId,
        body
      })
    } catch (e) {
      throw toGitPlatformError(e)
    }
  }

  async listChangeRequestCommits(
    owner: string,
    repo: string,
    changeRequestId: number
  ): Promise<string[]> {
    try {
      const allCommits: string[] = []
      let page = 1
      let data
      do {
        ;({data} = await octokit.pulls.listCommits({
          owner,
          repo,
          // eslint-disable-next-line camelcase
          pull_number: changeRequestId,
          // eslint-disable-next-line camelcase
          per_page: 100,
          page
        }))
        allCommits.push(...data.map(c => c.sha))
        page++
      } while (data.length > 0)
      return allCommits
    } catch (e) {
      throw toGitPlatformError(e)
    }
  }

  // ─── 2. Diff ──────────────────────────────────────────────────────────────

  async compareDiff(owner: string, repo: string, base: string, head: string): Promise<DiffResult> {
    try {
      const {data} = await octokit.repos.compareCommits({
        owner,
        repo,
        base,
        head
      })
      const files: DiffFile[] = (data.files ?? []).map(f => ({
        filename: f.filename,
        status: normalizeDiffStatus(f.status),
        patch: f.patch,
        previousFilename: f.previous_filename
      }))
      return {
        files,
        commits: data.commits.map(c => ({sha: c.sha}))
      }
    } catch (e) {
      throw toGitPlatformError(e)
    }
  }

  // ─── 3. 文件内容 ──────────────────────────────────────────────────────────

  async getFileContent(
    owner: string,
    repo: string,
    path: string,
    ref: string
  ): Promise<string | null> {
    try {
      const {data} = await octokit.repos.getContent({owner, repo, path, ref})
      const file = data as {content?: string; encoding?: string}
      if (file.content && file.encoding === 'base64') {
        return Buffer.from(file.content, 'base64').toString()
      }
      return null
    } catch {
      return null
    }
  }

  // ─── 4. 顶层评论 ─────────────────────────────────────────────────────────

  /**
   * 创建顶层评论（STATE-015：写级别幂等）。
   *
   * 原实现直接 `octokit.issues.createComment`，依赖 `@octokit/plugin-retry` 兜底。
   * 那是**传输层**重试：网络错误时它会重发 POST，而「服务端已经写成功、响应在
   * 回程丢了」与「请求根本没到」在客户端看来完全一样——重发就多一条评论，
   * 事后也无从察觉。GitLab 侧早有 write marker 解决这个问题（GLAPI-027），
   * GitHub 侧一直空缺。
   *
   * 现在两平台共用 `write-marker.ts`：
   *
   *   1. 写前在正文尾部埋一个隐藏 marker（本次逻辑写入唯一）
   *   2. 关掉 octokit 的自动重试，改由这里控制——否则它会在我们看不见的地方
   *      重发，marker 探测也就无从谈起
   *   3. 失败后先按 marker 查一遍已有评论：命中说明上一次其实成功了，直接复用；
   *      没命中才真正重试
   */
  async createComment(
    owner: string,
    repo: string,
    changeRequestId: number,
    body: string
  ): Promise<PlatformComment> {
    const marker = buildWriteMarker({
      platform: 'github',
      projectPath: `${owner}/${repo}`,
      changeRequestId,
      op: 'issue-comment',
      operationId: newWriteOperationId(),
      body
    })
    const markedBody = appendWriteMarker(body, marker)

    const attempt = async (): Promise<PlatformComment> => {
      const {data} = await octokit.issues.createComment({
        owner,
        repo,
        // eslint-disable-next-line camelcase
        issue_number: changeRequestId,
        body: markedBody,
        // 自动重试必须关掉：它会在我们察觉不到的情况下重发 POST
        request: {retries: 0}
      })
      return toPlatformComment(data)
    }

    return await this.writeOnce(attempt, async () => {
      // 探测必须看**未剥离**的原始正文——marker 正是要找的东西，
      // 而 listComments() 返回给共享核心的正文已经把它去掉了。
      const hit = await this.findAcrossPages<any>(
        async page => {
          const {data} = await octokit.issues.listComments({
            owner,
            repo,
            // eslint-disable-next-line camelcase
            issue_number: changeRequestId,
            // eslint-disable-next-line camelcase
            per_page: 100,
            page,
            sort: 'created',
            direction: 'desc'
          })
          return data as any[]
        },
        c => hasWriteMarker(c.body, marker)
      )
      return hit == null ? null : toPlatformComment(hit)
    })
  }

  /**
   * 逐页查找，直到命中或翻完（STATE-015）。
   *
   * 探测**必须**分页。原实现只取 `per_page: 100` 的第一页——评论超过 100 条的 PR
   * 上，刚写进去的那条根本不在第一页，探测就会误判「还没写」并重发，幂等形同虚设。
   * 而「评论很多的 PR」恰恰是长期迭代、最可能触发重试的那种。
   *
   * 能指定顺序的端点一律按创建时间倒序取，自己刚写的那条通常就在第一页；
   * `maxPages` 只是兜底，防止异常情况下无限翻页。
   */
  private async findAcrossPages<T>(
    fetchPage: (page: number) => Promise<T[]>,
    match: (item: T) => boolean,
    maxPages = 20
  ): Promise<T | null> {
    for (let page = 1; page <= maxPages; page++) {
      const items = await fetchPage(page)
      const hit = items.find(match)
      if (hit != null) return hit
      // 不满一页说明已经是最后一页，再翻也没有
      if (items.length < 100) return null
    }
    getLogger().warning(
      `write-marker: probe stopped after ${maxPages} pages without finding the marker`
    )
    return null
  }

  /** 为一次逻辑写入生成 marker（STATE-015） */
  private writeMarkerFor(
    owner: string,
    repo: string,
    changeRequestId: number,
    op: string,
    body: string,
    opDetail?: string
  ): string {
    return buildWriteMarker({
      platform: 'github',
      projectPath: `${owner}/${repo}`,
      changeRequestId,
      op,
      opDetail,
      operationId: newWriteOperationId(),
      body
    })
  }

  /** 在行级评论里按 marker 查找（原始正文，未剥离），供写入探测使用 */
  private async findReviewCommentByMarker(
    owner: string,
    repo: string,
    changeRequestId: number,
    marker: string
  ): Promise<any | null> {
    return await this.findAcrossPages<any>(
      async page => {
        const {data} = await octokit.pulls.listReviewComments({
          owner,
          repo,
          // eslint-disable-next-line camelcase
          pull_number: changeRequestId,
          // eslint-disable-next-line camelcase
          per_page: 100,
          page,
          sort: 'created',
          direction: 'desc'
        })
        return data as any[]
      },
      c => hasWriteMarker(c.body, marker)
    )
  }

  /**
   * 「至多一次」写入：失败后先探测上一次是否其实成功了，没成功才重试。
   *
   * 探测本身失败不作数——那只是说明这一刻查不了，继续按重试处理。
   */
  private async writeOnce<T>(
    attempt: () => Promise<T>,
    probe: () => Promise<T | null>,
    maxAttempts = 3
  ): Promise<T> {
    let lastError: unknown
    for (let i = 0; i < maxAttempts; i++) {
      try {
        return await attempt()
      } catch (e) {
        lastError = e
        try {
          const already = await probe()
          if (already != null) {
            getLogger().info(
              'write-marker: previous attempt actually succeeded (response was lost) — reusing it'
            )
            return already
          }
        } catch (probeError) {
          getLogger().warning(`write-marker: probe failed: ${String(probeError)}`)
        }
      }
    }
    throw toGitPlatformError(lastError)
  }

  async updateComment(owner: string, repo: string, commentId: number, body: string): Promise<void> {
    try {
      await octokit.issues.updateComment({
        owner,
        repo,
        // eslint-disable-next-line camelcase
        comment_id: commentId,
        body
      })
    } catch (e) {
      throw toGitPlatformError(e)
    }
  }

  async deleteComment(owner: string, repo: string, commentId: number): Promise<void> {
    try {
      await octokit.issues.deleteComment({
        owner,
        repo,
        // eslint-disable-next-line camelcase
        comment_id: commentId
      })
    } catch (e) {
      throw toGitPlatformError(e)
    }
  }

  async listComments(
    owner: string,
    repo: string,
    changeRequestId: number
  ): Promise<PlatformComment[]> {
    try {
      const allComments: PlatformComment[] = []
      let page = 1
      for (;;) {
        const {data} = await octokit.issues.listComments({
          owner,
          repo,
          // eslint-disable-next-line camelcase
          issue_number: changeRequestId,
          page,
          // eslint-disable-next-line camelcase
          per_page: 100
        })
        allComments.push(
          ...data.map(c => ({
            id: c.id,
            body: stripWriteMarkers(c.body ?? ''),
            author: c.user?.login ?? '',
            nodeId: c.node_id,
            createdAt: c.created_at
          }))
        )
        page++
        if (!data || data.length < 100) break
      }
      return allComments
    } catch (e) {
      throw toGitPlatformError(e)
    }
  }

  // ─── 5. 行级评论 ──────────────────────────────────────────────────────────

  async listReviewComments(
    owner: string,
    repo: string,
    changeRequestId: number
  ): Promise<ReviewComment[]> {
    try {
      const allComments: ReviewComment[] = []
      let page = 1
      for (;;) {
        const {data} = await octokit.pulls.listReviewComments({
          owner,
          repo,
          // eslint-disable-next-line camelcase
          pull_number: changeRequestId,
          page,
          // eslint-disable-next-line camelcase
          per_page: 100
        })
        allComments.push(
          ...data.map(c => ({
            id: c.id,
            body: stripWriteMarkers(c.body ?? ''),
            path: c.path,
            line: c.line ?? null,
            startLine: c.start_line ?? null,
            originalLine: c.original_line ?? null,
            author: c.user?.login ?? '',
            // eslint-disable-next-line camelcase
            in_reply_to_id: c.in_reply_to_id,
            nodeId: c.node_id,
            createdAt: c.created_at
          }))
        )
        page++
        if (!data || data.length < 100) break
      }
      return allComments
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
    reviewBody?: string,
    hooks?: SubmitReviewHooks
  ): Promise<SubmitReviewResult> {
    // GitHub 的 createReview 是原子的：要么整批进去，要么抛错。
    // 因此结果只有「全部投递」或「异常上抛由调用方降级」两种。
    if (comments.length === 0) return {delivered: [], failed: []}

    // STATE-011/012：这里「每次逻辑写入前」等同于「整批之前」——整批评论由一次
    // createReview 调用写入，中途没有第二个写入点可插。GitLab 那边逐条创建
    // discussion，所以门禁在循环内部。
    if (hooks?.ensureFresh != null && !(await hooks.ensureFresh())) {
      return {delivered: [], failed: [], staleSkipped: [...comments]}
    }
    // STATE-015：整批 review 也要写级别幂等。marker 埋在 review body 里，
    // 探测时按它在已有 review 列表中查找——超时重发会多出一整份 review，
    // 比多一条评论更醒目，也更该防。
    const body = reviewBody ?? ''
    const marker = this.writeMarkerFor(owner, repo, changeRequestId, 'review', body)
    const markedBody = appendWriteMarker(body, marker)

    const findExistingReview = async (): Promise<{id: number; submitted: boolean} | null> => {
      // listReviews 不支持排序方向，只能顺序翻页
      const hit = await this.findAcrossPages<any>(
        async page => {
          const {data} = await octokit.pulls.listReviews({
            owner,
            repo,
            // eslint-disable-next-line camelcase
            pull_number: changeRequestId,
            // eslint-disable-next-line camelcase
            per_page: 100,
            page
          })
          return data as any[]
        },
        r => hasWriteMarker(r.body, marker)
      )
      return hit == null ? null : {id: hit.id, submitted: hit.state !== 'PENDING'}
    }

    try {
      const review = await this.writeOnce(async () => {
        const {data} = await octokit.pulls.createReview({
          owner,
          repo,
          // eslint-disable-next-line camelcase
          pull_number: changeRequestId,
          // eslint-disable-next-line camelcase
          commit_id: commitSha,
          body: markedBody,
          comments: comments.map(c => {
            const d: any = {path: c.path, body: c.body, line: c.line}
            if (c.startLine != null && c.startLine !== c.line) {
              // eslint-disable-next-line camelcase
              d.start_line = c.startLine
              // eslint-disable-next-line camelcase
              d.start_side = c.startSide ?? 'RIGHT'
            }
            return d
          }),
          request: {retries: 0}
        })
        return {id: data.id, submitted: false}
      }, findExistingReview)

      // submitReview 是第二个 POST。它自己的「已提交」状态就是天然的幂等依据：
      // 探测发现 review 不再是 PENDING，说明上一次其实提交成功了。
      if (!review.submitted) {
        await this.writeOnce(
          async () => {
            await octokit.pulls.submitReview({
              owner,
              repo,
              // eslint-disable-next-line camelcase
              pull_number: changeRequestId,
              // eslint-disable-next-line camelcase
              review_id: review.id,
              event: 'COMMENT',
              request: {retries: 0}
            })
            return true
          },
          async () => {
            const existing = await findExistingReview()
            return existing?.submitted === true ? true : null
          }
        )
      }

      return {delivered: [...comments], failed: []}
    } catch (e) {
      throw toGitPlatformError(e)
    }
  }

  async createReviewComment(
    owner: string,
    repo: string,
    changeRequestId: number,
    commitSha: string,
    comment: ReviewCommentDraft
  ): Promise<void> {
    const marker = this.writeMarkerFor(
      owner,
      repo,
      changeRequestId,
      'review-comment',
      comment.body,
      `${comment.path}:${comment.line}`
    )
    try {
      const d: any = {
        owner,
        repo,
        // eslint-disable-next-line camelcase
        pull_number: changeRequestId,
        // eslint-disable-next-line camelcase
        commit_id: commitSha,
        path: comment.path,
        body: appendWriteMarker(comment.body, marker),
        line: comment.line,
        request: {retries: 0}
      }
      if (comment.startLine != null && comment.startLine !== comment.line) {
        // eslint-disable-next-line camelcase
        d.start_line = comment.startLine
        // eslint-disable-next-line camelcase
        d.start_side = comment.startSide ?? 'RIGHT'
      }
      await this.writeOnce<boolean>(
        async () => {
          await octokit.pulls.createReviewComment(d)
          return true
        },
        async () =>
          (await this.findReviewCommentByMarker(owner, repo, changeRequestId, marker)) == null
            ? null
            : true
      )
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
    const marker = this.writeMarkerFor(
      owner,
      repo,
      changeRequestId,
      'review-reply',
      body,
      String(commentId)
    )
    try {
      const {data} = await this.writeOnce(
        async () =>
          await octokit.pulls.createReplyForReviewComment({
            owner,
            repo,
            // eslint-disable-next-line camelcase
            pull_number: changeRequestId,
            // eslint-disable-next-line camelcase
            comment_id: commentId,
            body: appendWriteMarker(body, marker),
            request: {retries: 0}
          }),
        async () => {
          const hit = await this.findReviewCommentByMarker(owner, repo, changeRequestId, marker)
          return hit == null ? null : ({data: hit} as any)
        }
      )
      return {
        id: data.id,
        body: data.body ?? '',
        author: data.user?.login ?? '',
        nodeId: data.node_id,
        createdAt: data.created_at
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
    try {
      await octokit.pulls.updateReviewComment({
        owner,
        repo,
        // eslint-disable-next-line camelcase
        comment_id: commentId,
        body
      })
    } catch (e) {
      throw toGitPlatformError(e)
    }
  }

  async deleteReviewComment(owner: string, repo: string, commentId: number): Promise<void> {
    try {
      await octokit.pulls.deleteReviewComment({
        owner,
        repo,
        // eslint-disable-next-line camelcase
        comment_id: commentId
      })
    } catch (e) {
      throw toGitPlatformError(e)
    }
  }

  async deletePendingReview(owner: string, repo: string, changeRequestId: number): Promise<void> {
    const logger = getLogger()
    try {
      const {data: reviews} = await octokit.pulls.listReviews({
        owner,
        repo,
        // eslint-disable-next-line camelcase
        pull_number: changeRequestId
      })
      const pending = reviews.find(r => r.state === 'PENDING')
      if (pending) {
        logger.info(`Deleting pending review for PR #${changeRequestId} id: ${pending.id}`)
        await octokit.pulls.deletePendingReview({
          owner,
          repo,
          // eslint-disable-next-line camelcase
          pull_number: changeRequestId,
          // eslint-disable-next-line camelcase
          review_id: pending.id
        })
      }
    } catch (e) {
      logger.warning(`Failed to delete pending review: ${String(e)}`)
    }
  }

  // ─── 6. Review thread（ARCH-019）──────────────────────────────────────────

  async fetchThreadStatusMap(
    owner: string,
    repo: string,
    changeRequestId: number
  ): Promise<Map<string, boolean>> {
    const map = new Map<string, boolean>()
    let cursor: string | null = null

    do {
      const data: GetReviewThreadsResponse = await octokit.graphql(GET_REVIEW_THREADS, {
        owner,
        repo,
        number: changeRequestId,
        after: cursor ?? undefined
      })
      const page = data.repository.pullRequest.reviewThreads
      for (const node of page.nodes) {
        if (node.path != null && node.line != null) {
          const key = `${node.path}:${node.line}`
          if (!map.has(key) || !node.isResolved) {
            map.set(key, node.isResolved)
          }
        }
      }
      cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null
    } while (cursor !== null)

    return map
  }

  async fetchUnresolvedBotThreads(
    owner: string,
    repo: string,
    changeRequestId: number,
    botLogin: string
  ): Promise<ReviewThreadInfo[]> {
    const results: ReviewThreadInfo[] = []
    let cursor: string | null = null
    const normalizedBot = normalizeLogin(botLogin)

    do {
      const data: GetReviewThreadsResponse = await octokit.graphql(GET_REVIEW_THREADS, {
        owner,
        repo,
        number: changeRequestId,
        after: cursor ?? undefined
      })
      const page = data.repository.pullRequest.reviewThreads
      for (const node of page.nodes) {
        const firstComment = node.comments.nodes[0]
        const authorLogin = firstComment?.author?.login ?? null
        if (
          !node.isResolved &&
          authorLogin !== null &&
          normalizeLogin(authorLogin) === normalizedBot
        ) {
          results.push({
            id: node.id,
            isResolved: node.isResolved,
            firstCommentAuthorLogin: authorLogin,
            path: node.path,
            line: node.line ?? null,
            firstCommentBody: firstComment?.body ?? null
          })
        }
      }
      cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null
    } while (cursor !== null)

    return results
  }

  async resolveThreads(
    threadIds: string[]
  ): Promise<{ok: number; failed: number; errors: Error[]}> {
    const logger = getLogger()
    let ok = 0
    const errors: Error[] = []

    await Promise.allSettled(
      threadIds.map(async threadId => {
        try {
          await octokit.graphql(RESOLVE_THREAD, {threadId})
          ok++
        } catch (e) {
          const err = e instanceof Error ? e : new Error(String(e))
          errors.push(err)
          logger.warning(`resolveThread failed for ${threadId}: ${err.message}`)
        }
      })
    )

    return {ok, failed: errors.length, errors}
  }

  // ─── 7. Reaction ──────────────────────────────────────────────────────────

  async addReaction(
    owner: string,
    repo: string,
    _changeRequestId: number,
    commentId: number,
    content: ReactionContent,
    commentKind: 'issue_comment' | 'review_comment'
  ): Promise<void> {
    try {
      if (commentKind === 'review_comment') {
        await octokit.reactions.createForPullRequestReviewComment({
          owner,
          repo,
          // eslint-disable-next-line camelcase
          comment_id: commentId,
          content
        })
      } else {
        await octokit.reactions.createForIssueComment({
          owner,
          repo,
          // eslint-disable-next-line camelcase
          comment_id: commentId,
          content
        })
      }
    } catch (e) {
      throw toGitPlatformError(e)
    }
  }

  // ─── 8. 权限 ──────────────────────────────────────────────────────────────

  async getCollaboratorPermission(
    owner: string,
    repo: string,
    username: string
  ): Promise<PlatformPermission> {
    try {
      const {data} = await octokit.repos.getCollaboratorPermissionLevel({
        owner,
        repo,
        username
      })
      return (data?.permission ?? 'none') as PlatformPermission
    } catch (e) {
      throw toGitPlatformError(e)
    }
  }

  // ─── 9. 用户身份 ──────────────────────────────────────────────────────────

  async getAuthenticatedLogin(): Promise<string> {
    try {
      const {data} = await octokit.users.getAuthenticated()
      return data.login
    } catch {
      return 'github-actions'
    }
  }

  // ─── 10. 仓库文件树（DEP-001 / DEP-003）──────────────────────────────────

  async listRepositoryTree(
    owner: string,
    repo: string,
    ref: string,
    path?: string
  ): Promise<TreeResult> {
    try {
      const {data} = await octokit.git.getTree({
        owner,
        repo,
        // `<ref>:<path>` 是 Git Tree API 指定子树的写法
        // eslint-disable-next-line camelcase
        tree_sha: path != null && path !== '' ? `${ref}:${path}` : ref,
        // 目录探查只要一层，全量树才需要 recursive
        ...(path != null && path !== '' ? {} : {recursive: 'true'})
      })
      // 子树返回的 path 是相对该目录的，补回根相对路径以统一接口契约
      const entries =
        path != null && path !== ''
          ? data.tree.map(item => ({
              ...item,
              path: item.path != null ? `${path}/${item.path}` : item.path
            }))
          : data.tree
      return {entries, truncated: data.truncated === true}
    } catch (e) {
      const err = toGitPlatformError(e)
      // 目录探查命中不存在的路径是正常结果，不是错误
      if (path != null && path !== '' && err.errorKind === 'not_found') {
        return {entries: [], truncated: false}
      }
      throw err
    }
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────

function normalizeDiffStatus(status: string | undefined): DiffFile['status'] {
  switch (status) {
    case 'added':
      return 'added'
    case 'removed':
      return 'removed'
    case 'renamed':
      return 'renamed'
    case 'modified':
    case 'changed':
      return 'modified'
    default:
      return 'unchanged'
  }
}
