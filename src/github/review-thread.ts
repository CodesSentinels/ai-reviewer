import {getInput, warning} from '@actions/core'
import pLimit from 'p-limit'
import {octokit} from '../octokit'
import type {Options} from '../options'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ReviewThread {
  id: string
  isResolved: boolean
  firstCommentAuthorLogin: string | null
}

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
          comments: {
            nodes: Array<{
              author: {login: string} | null
            }>
          }
        }>
      }
    }
  }
}

interface ResolveThreadResponse {
  resolveReviewThread: {
    thread: {isResolved: boolean}
  }
}

// ─── GraphQL documents ───────────────────────────────────────────────────────

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
            comments(first: 1) {
              nodes {
                author {
                  login
                }
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

// ─── Bot identity ─────────────────────────────────────────────────────────────

let cachedBotLogin: string | null = null

export async function getBotLogin(options: Options): Promise<string> {
  if (cachedBotLogin !== null) return cachedBotLogin

  // bot_name is a display name, not a GitHub login — always use getAuthenticated()
  // to get the real API identity that actually authored the review comments.
  void options
  try {
    const {data} = await octokit.users.getAuthenticated()
    cachedBotLogin = data.login
  } catch (e) {
    warning(`getBotLogin: failed to get authenticated user – ${String(e)}`)
    // Use a clearly-invalid sentinel so callers get an empty result rather
    // than silently resolving threads they shouldn't touch.
    cachedBotLogin = '__unknown_bot__'
  }

  return cachedBotLogin
}

/** Visible for testing only */
export function _resetBotLoginCache(): void {
  cachedBotLogin = null
}

// ─── Query ────────────────────────────────────────────────────────────────────

export async function fetchUnresolvedBotThreads(
  params: {owner: string; repo: string; prNumber: number},
  botLogin: string
): Promise<ReviewThread[]> {
  const results: ReviewThread[] = []
  let cursor: string | null = null

  do {
    const data: GetReviewThreadsResponse = await octokit.graphql(
      GET_REVIEW_THREADS,
      {
        owner: params.owner,
        repo: params.repo,
        number: params.prNumber,
        after: cursor ?? undefined
      }
    )

    const page: GetReviewThreadsResponse['repository']['pullRequest']['reviewThreads'] =
      data.repository.pullRequest.reviewThreads

    for (const node of page.nodes) {
      const authorLogin = node.comments.nodes[0]?.author?.login ?? null
      if (!node.isResolved && authorLogin === botLogin) {
        results.push({
          id: node.id,
          isResolved: node.isResolved,
          firstCommentAuthorLogin: authorLogin
        })
      }
    }

    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null
  } while (cursor !== null)

  return results
}

// ─── Mutation ─────────────────────────────────────────────────────────────────

export interface BatchResolveResult {
  ok: number
  failed: number
}

export async function batchResolve(
  threads: ReviewThread[]
): Promise<BatchResolveResult> {
  const limit = pLimit(6)
  let ok = 0
  let failed = 0

  await Promise.allSettled(
    threads.map(t =>
      limit(async () => {
        try {
          await octokit.graphql(RESOLVE_THREAD, {threadId: t.id})
          ok++
        } catch (e) {
          warning(`batchResolve: failed to resolve thread ${t.id} – ${String(e)}`)
          failed++
        }
      })
    )
  )

  return {ok, failed}
}
