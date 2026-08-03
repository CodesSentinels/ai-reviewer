import pLimit from 'p-limit'
import {getPlatform} from '../platform/git-platform'
import {getLogger} from '../platform/logger'
import type {Options} from '../options'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ReviewThread {
  id: string
  isResolved: boolean
  firstCommentAuthorLogin: string | null
  path: string | null
  line: number | null
  firstCommentBody: string | null
}

// ─── Bot identity ─────────────────────────────────────────────────────────────

let cachedBotLogin: string | null = null

export async function getBotLogin(options: Options): Promise<string> {
  if (cachedBotLogin !== null) return cachedBotLogin

  void options

  // Explicit override for custom GitHub App: installation tokens cannot call
  // GET /user, so auto-detection would wrongly fall back to 'github-actions'.
  const explicitLogin = options.botLogin
  if (explicitLogin) {
    cachedBotLogin = explicitLogin
    return cachedBotLogin
  }

  cachedBotLogin = await getPlatform().getAuthenticatedLogin()
  return cachedBotLogin
}

/** Visible for testing only */
export function _resetBotLoginCache(): void {
  cachedBotLogin = null
}

// ─── Query ────────────────────────────────────────────────────────────────────

/**
 * `path:line` → `isResolved` の lookup table for a PR.
 *
 * Built from GraphQL reviewThreads which carry the resolved flag.
 * Used to annotate comment chains injected into the review prompt so the AI
 * knows whether a thread is still open or has already been resolved.
 *
 * Key format: `${path}:${line}` — matches REST comment's `path` + `line`.
 * When multiple threads share the same location the most conservative value
 * (false = unresolved) wins, matching the "still needs attention" intent.
 */
export type ThreadStatusMap = Map<string, boolean>

export async function fetchThreadStatusMap(params: {
  owner: string
  repo: string
  prNumber: number
}): Promise<ThreadStatusMap> {
  return getPlatform().fetchThreadStatusMap(
    params.owner,
    params.repo,
    params.prNumber
  )
}

export async function fetchUnresolvedBotThreads(
  params: {owner: string; repo: string; prNumber: number},
  botLogin: string
): Promise<ReviewThread[]> {
  const threads = await getPlatform().fetchUnresolvedBotThreads(
    params.owner,
    params.repo,
    params.prNumber,
    botLogin
  )
  return threads.map(t => ({
    id: t.id,
    isResolved: t.isResolved,
    firstCommentAuthorLogin: t.firstCommentAuthorLogin,
    path: t.path,
    line: t.line,
    firstCommentBody: t.firstCommentBody
  }))
}

// ─── Mutation ─────────────────────────────────────────────────────────────────

export interface FailedThread {
  thread: ReviewThread
  error: Error
}

export interface BatchResolveResult {
  ok: number
  failed: number
  errors: Error[]
  failedItems: FailedThread[]
}

export function isPermissionError(e: unknown): boolean {
  return String(e).includes('not accessible by integration')
}

/** 网络/超时类错误（与权限、node-not-found 区分，便于给出不同提示） */
export function isNetworkError(e: unknown): boolean {
  return /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|network|timed? ?out/i.test(
    String(e)
  )
}

/**
 * 测试用：识别注入的假 thread ID（`PRRT_debug_inject_<kind>_<n>`），
 * 返回对应类型的模拟错误，不实际发起 GraphQL 请求。
 *
 * 真实运行时 thread ID 不会带此前缀，函数返回 null，走正常 GraphQL 流程。
 */
function simulateDebugError(threadId: string): Error | null {
  if (!threadId.startsWith('PRRT_debug_inject_')) return null
  if (threadId.includes('_permission_')) {
    return new Error(
      "Resource not accessible by integration (mutation 'resolveReviewThread')"
    )
  }
  if (threadId.includes('_network_')) {
    // TODO: Maybe gitlab in the future, or other network errors, but for now just simulate a connection reset.
    return new Error(
      'request to https://api.github.com/graphql failed, reason: read ECONNRESET'
    )
  }
  // 默认：node not found（无效的 global id）
  return new Error(
    'Request failed due to following response errors:\n' +
      ` - Could not resolve to a node with the global id of '${threadId}'`
  )
}

export function threadLabel(t: ReviewThread): string {
  if (t.path) {
    const loc = t.line != null ? `${t.path}:${t.line}` : t.path
    if (t.firstCommentBody) {
      const snippet = t.firstCommentBody
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 60)
      const ellipsis = snippet.length === 60 ? '…' : ''
      return `${loc} – "${snippet}${ellipsis}"`
    }
    return loc
  }
  return t.id
}

export async function batchResolve(
  threads: ReviewThread[]
): Promise<BatchResolveResult> {
  const logger = getLogger()
  const limit = pLimit(6)
  let ok = 0
  const errors: Error[] = []
  const failedItems: Array<{thread: ReviewThread; error: Error}> = []

  // 先过滤掉 debug 注入的假 thread ID，模拟错误
  const debugThreads: ReviewThread[] = []
  const realThreads: ReviewThread[] = []
  for (const t of threads) {
    const simulated = simulateDebugError(t.id)
    if (simulated) {
      const err = simulated
      errors.push(err)
      failedItems.push({thread: t, error: err})
      debugThreads.push(t)
    } else {
      realThreads.push(t)
    }
  }

  // 批量 resolve 真实 thread
  if (realThreads.length > 0) {
    const platform = getPlatform()
    await Promise.allSettled(
      realThreads.map(t =>
        limit(async () => {
          try {
            const result = await platform.resolveThreads([t.id])
            if (result.failed > 0) {
              // adapter 吞掉 GraphQL 异常并放进 errors 返回，不 throw
              for (const err of result.errors) {
                errors.push(err)
                failedItems.push({thread: t, error: err})
              }
            } else {
              ok++
            }
          } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e))
            errors.push(err)
            failedItems.push({thread: t, error: err})
          }
        })
      )
    )
  }

  const permissionFailed = failedItems.filter(({error}) =>
    isPermissionError(error)
  )
  const otherFailed = failedItems.filter(({error}) => !isPermissionError(error))

  if (permissionFailed.length > 0) {
    logger.warning(
      'batchResolve: token lacks permission to resolve review threads ' +
        '("Resource not accessible by integration"). ' +
        'Set the `resolve_token` input to a classic PAT with repo scope.'
    )
  }

  if (otherFailed.length > 0) {
    const lines = otherFailed
      .map(({thread, error}) => `  • ${threadLabel(thread)}: ${error.message}`)
      .join('\n')
    logger.warning(
      `batchResolve: failed to resolve ${otherFailed.length}/${threads.length} thread(s):\n${lines}`
    )
  }

  return {ok, failed: errors.length, errors, failedItems}
}
