import {getInput, warning} from '@actions/core'
// import {getOctokit} from '@actions/github'
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

  void options

  // Explicit override for custom GitHub App: installation tokens cannot call
  // GET /user, so auto-detection would wrongly fall back to 'github-actions'.
  const explicitLogin = getInput('bot_github_login')
  if (explicitLogin) {
    cachedBotLogin = explicitLogin
    return cachedBotLogin
  }

  try {
    const {data} = await octokit.users.getAuthenticated()
    cachedBotLogin = data.login
  } catch (e) {
    warning(`getBotLogin: failed to get authenticated user – ${String(e)}`)
    // Default GITHUB_TOKEN (integration token) lacks read:user scope.
    // GraphQL returns the login WITHOUT the "[bot]" suffix, so use 'github-actions'
    // (not 'github-actions[bot]') to match the author field in reviewThread queries.
    cachedBotLogin = 'github-actions'
  }

  return cachedBotLogin
}

/** Visible for testing only */
export function _resetBotLoginCache(): void {
  cachedBotLogin = null
}

/**
 * Normalize a GitHub login for bot identity comparison.
 *
 * GitHub is inconsistent about the `[bot]` suffix on bot accounts:
 *   - REST (`getAuthenticated`, comment.user.login) → `github-actions[bot]`
 *   - GraphQL (reviewThread author.login)           → `github-actions`
 * Stripping the suffix (and lowercasing) lets the two representations match.
 */
function normalizeLogin(login: string): string {
  return login.replace(/\[bot\]$/i, '').toLowerCase()
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

    const normalizedBot = normalizeLogin(botLogin)
    for (const node of page.nodes) {
      const authorLogin = node.comments.nodes[0]?.author?.login ?? null
      if (
        !node.isResolved &&
        authorLogin !== null &&
        normalizeLogin(authorLogin) === normalizedBot
      ) {
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
  errors: Error[]
}

// resolveReviewThread is rejected by both GITHUB_TOKEN and GitHub App
// installation tokens ("Resource not accessible by integration").
// A classic PAT with repo scope is required.
// function getResolveGraphql(): (query: string, variables: Record<string, unknown>) => Promise<unknown> {
//   const pat = getInput('resolve_token')
//   if (pat) {
//     return getOctokit(pat).graphql as (query: string, variables: Record<string, unknown>) => Promise<unknown>
//   }
//   return (query, variables) => octokit.graphql(query, variables)
// }

export async function batchResolve(
  threads: ReviewThread[]
): Promise<BatchResolveResult> {
  const limit = pLimit(6)
  // const gql = getResolveGraphql()
  let ok = 0
  const errors: Error[] = []

  await Promise.allSettled(
    threads.map(t =>
      limit(async () => {
        try {
          // await gql(RESOLVE_THREAD, {threadId: t.id})
           await octokit.graphql(RESOLVE_THREAD, {threadId: t.id})
          ok++
        } catch (e) {
          warning(`batchResolve: failed to resolve thread ${t.id} – ${String(e)}`)
          errors.push(e instanceof Error ? e : new Error(String(e)))
        }
      })
    )
  )

  return {ok, failed: errors.length, errors}
}
