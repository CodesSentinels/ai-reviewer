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
  type ReviewThreadInfo,
  type TreeEntry
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
  if (
    /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|timed? ?out/i.test(
      msg
    )
  ) {
    return new GitPlatformError(msg, 'timeout', undefined, e)
  }
  return new GitPlatformError(msg, 'unknown', status, e)
}

function normalizeLogin(login: string): string {
  return login.replace(/\[bot\]$/i, '').toLowerCase()
}

// ─── GitHub adapter 实现 ──────────────────────────────────────────────────

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

  async compareDiff(
    owner: string,
    repo: string,
    base: string,
    head: string
  ): Promise<DiffResult> {
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

  async createComment(
    owner: string,
    repo: string,
    changeRequestId: number,
    body: string
  ): Promise<PlatformComment> {
    try {
      const {data} = await octokit.issues.createComment({
        owner,
        repo,
        // eslint-disable-next-line camelcase
        issue_number: changeRequestId,
        body
      })
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

  async updateComment(
    owner: string,
    repo: string,
    commentId: number,
    body: string
  ): Promise<void> {
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

  async deleteComment(
    owner: string,
    repo: string,
    commentId: number
  ): Promise<void> {
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
            body: c.body ?? '',
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
            body: c.body ?? '',
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
    reviewBody?: string
  ): Promise<number> {
    if (comments.length === 0) return 0
    try {
      const review = await octokit.pulls.createReview({
        owner,
        repo,
        // eslint-disable-next-line camelcase
        pull_number: changeRequestId,
        // eslint-disable-next-line camelcase
        commit_id: commitSha,
        comments: comments.map(c => {
          const d: any = {path: c.path, body: c.body, line: c.line}
          if (c.startLine != null && c.startLine !== c.line) {
            // eslint-disable-next-line camelcase
            d.start_line = c.startLine
            // eslint-disable-next-line camelcase
            d.start_side = c.startSide ?? 'RIGHT'
          }
          return d
        })
      })
      await octokit.pulls.submitReview({
        owner,
        repo,
        // eslint-disable-next-line camelcase
        pull_number: changeRequestId,
        // eslint-disable-next-line camelcase
        review_id: review.data.id,
        event: 'COMMENT',
        body: reviewBody ?? ''
      })
      return comments.length
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
    try {
      const d: any = {
        owner,
        repo,
        // eslint-disable-next-line camelcase
        pull_number: changeRequestId,
        // eslint-disable-next-line camelcase
        commit_id: commitSha,
        path: comment.path,
        body: comment.body,
        line: comment.line
      }
      if (comment.startLine != null && comment.startLine !== comment.line) {
        // eslint-disable-next-line camelcase
        d.start_line = comment.startLine
        // eslint-disable-next-line camelcase
        d.start_side = comment.startSide ?? 'RIGHT'
      }
      await octokit.pulls.createReviewComment(d)
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
    try {
      const {data} = await octokit.pulls.createReplyForReviewComment({
        owner,
        repo,
        // eslint-disable-next-line camelcase
        pull_number: changeRequestId,
        // eslint-disable-next-line camelcase
        comment_id: commentId,
        body
      })
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

  async deleteReviewComment(
    owner: string,
    repo: string,
    commentId: number
  ): Promise<void> {
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

  async deletePendingReview(
    owner: string,
    repo: string,
    changeRequestId: number
  ): Promise<void> {
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
        logger.info(
          `Deleting pending review for PR #${changeRequestId} id: ${pending.id}`
        )
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
      const data: GetReviewThreadsResponse = await octokit.graphql(
        GET_REVIEW_THREADS,
        {owner, repo, number: changeRequestId, after: cursor ?? undefined}
      )
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
      const data: GetReviewThreadsResponse = await octokit.graphql(
        GET_REVIEW_THREADS,
        {owner, repo, number: changeRequestId, after: cursor ?? undefined}
      )
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
    ref: string
  ): Promise<TreeEntry[]> {
    try {
      const {data} = await octokit.git.getTree({
        owner,
        repo,
        // eslint-disable-next-line camelcase
        tree_sha: ref,
        recursive: 'true'
      })
      return data.tree
    } catch (e) {
      throw toGitPlatformError(e)
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
