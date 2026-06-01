/**
 * resolve.test.ts — resolve handler 与 review-thread 工具函数的单元测试
 *
 * 覆盖:
 * - 无待解决 thread → 返回 "没有找到" 消息
 * - 全部成功 → 返回 "✅ 已解决 N 条"
 * - 部分失败 → 返回 "⚠️ 共 N 条，成功 X，失败 Y"
 * - 全部失败 → 返回权限不足提示
 * - 分页场景（>100 threads）→ GraphQL 被调用 2+ 次，结果合并正确
 * - 非 Bot 发的 thread 被过滤 → 不被 resolve
 * - 已 resolved thread 被跳过 → isResolved=true 的不调用 mutation
 */
import {describe, expect, test, beforeEach, jest} from '@jest/globals'

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('@actions/core', () => ({
  getInput: jest.fn().mockReturnValue(''),
  info: jest.fn(),
  warning: jest.fn(),
  error: jest.fn()
}))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockGraphql = jest.fn<(query: string, vars?: any) => Promise<any>>()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockGetAuthenticated = jest.fn<() => Promise<any>>()

jest.mock('../src/octokit', () => ({
  octokit: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    graphql: (q: string, v?: any) => mockGraphql(q, v),
    users: {
      getAuthenticated: () => mockGetAuthenticated()
    }
  }
}))

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import {getInput} from '@actions/core'
import {
  getBotLogin,
  fetchUnresolvedBotThreads,
  batchResolve,
  _resetBotLoginCache
} from '../src/github/review-thread'
import {resolveHandler, resolveAllBotComments} from '../src/commands/handlers/resolve'
import type {CommandContext} from '../src/commands/types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const mockGetInput = getInput as jest.MockedFunction<typeof getInput>

function makePageResponse(
  nodes: Array<{
    id: string
    isResolved: boolean
    authorLogin: string | null
  }>,
  hasNextPage = false,
  endCursor: string | null = null
) {
  return {
    repository: {
      pullRequest: {
        reviewThreads: {
          pageInfo: {hasNextPage, endCursor},
          nodes: nodes.map(n => ({
            id: n.id,
            isResolved: n.isResolved,
            comments: {
              nodes: n.authorLogin ? [{author: {login: n.authorLogin}}] : []
            }
          }))
        }
      }
    }
  }
}

function makeCtx(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    command: {name: 'resolve', raw: 'resolve', args: [], kv: {}, rawAfter: ''},
    eventName: 'issue_comment',
    action: 'created',
    owner: 'org',
    repo: 'repo',
    prNumber: 1,
    headSha: 'abc',
    baseSha: 'def',
    actor: {login: 'dev', permission: 'write', isPrAuthor: false, isBot: false},
    commentId: 100,
    commentBody: '@codesentinel resolve',
    reply: {
      ack: jest.fn<() => Promise<number>>().mockResolvedValue(1),
      success: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      error: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      progress: jest.fn<() => Promise<void>>().mockResolvedValue(undefined)
    },
    options: {} as never,
    ...overrides
  } as CommandContext
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks()
  _resetBotLoginCache()
  mockGetInput.mockReturnValue('')
})

describe('getBotLogin', () => {
  test('始终调用 getAuthenticated 获取真实 GitHub 登录名', async () => {
    mockGetAuthenticated.mockResolvedValue({data: {login: 'github-actions[bot]'}})
    const login = await getBotLogin({} as never)
    expect(login).toBe('github-actions[bot]')
    expect(mockGetAuthenticated).toHaveBeenCalledTimes(1)
  })

  test('缓存：第二次调用不再请求 API', async () => {
    mockGetAuthenticated.mockResolvedValue({data: {login: 'github-actions[bot]'}})
    await getBotLogin({} as never)
    await getBotLogin({} as never)
    expect(mockGetAuthenticated).toHaveBeenCalledTimes(1)
  })

  test('getAuthenticated 抛异常时返回 __unknown_bot__ 哨兵值', async () => {
    mockGetAuthenticated.mockRejectedValue(new Error('network error'))
    const login = await getBotLogin({} as never)
    expect(login).toBe('__unknown_bot__')
  })
})

describe('fetchUnresolvedBotThreads', () => {
  test('非 Bot 发的 thread 被过滤', async () => {
    mockGraphql.mockResolvedValueOnce(
      makePageResponse([
        {id: 't1', isResolved: false, authorLogin: 'human-reviewer'},
        {id: 't2', isResolved: false, authorLogin: 'cs-bot'}
      ])
    )
    const threads = await fetchUnresolvedBotThreads(
      {owner: 'o', repo: 'r', prNumber: 1},
      'cs-bot'
    )
    expect(threads).toHaveLength(1)
    expect(threads[0].id).toBe('t2')
  })

  test('已 resolved 的 thread 被跳过', async () => {
    mockGraphql.mockResolvedValueOnce(
      makePageResponse([
        {id: 't1', isResolved: true, authorLogin: 'cs-bot'},
        {id: 't2', isResolved: false, authorLogin: 'cs-bot'}
      ])
    )
    const threads = await fetchUnresolvedBotThreads(
      {owner: 'o', repo: 'r', prNumber: 1},
      'cs-bot'
    )
    expect(threads).toHaveLength(1)
    expect(threads[0].id).toBe('t2')
  })

  test('[bot] 后缀归一化：REST 身份 github-actions[bot] 匹配 GraphQL 的 github-actions', async () => {
    // getBotLogin (REST getAuthenticated) 返回带 [bot] 后缀，
    // 而 GraphQL reviewThread author.login 不带后缀，需归一化后比对
    mockGraphql.mockResolvedValueOnce(
      makePageResponse([
        {id: 't1', isResolved: false, authorLogin: 'github-actions'}
      ])
    )
    const threads = await fetchUnresolvedBotThreads(
      {owner: 'o', repo: 'r', prNumber: 1},
      'github-actions[bot]'
    )
    expect(threads).toHaveLength(1)
    expect(threads[0].id).toBe('t1')
  })

  test('分页：GraphQL 被调用 2 次，结果合并正确', async () => {
    mockGraphql
      .mockResolvedValueOnce(
        makePageResponse(
          [{id: 't1', isResolved: false, authorLogin: 'cs-bot'}],
          true,
          'cursor-1'
        )
      )
      .mockResolvedValueOnce(
        makePageResponse([{id: 't2', isResolved: false, authorLogin: 'cs-bot'}])
      )

    const threads = await fetchUnresolvedBotThreads(
      {owner: 'o', repo: 'r', prNumber: 1},
      'cs-bot'
    )
    expect(mockGraphql).toHaveBeenCalledTimes(2)
    expect(threads).toHaveLength(2)
    expect(threads.map(t => t.id)).toEqual(['t1', 't2'])

    // 第二次调用应传入 cursor
    const secondCall = mockGraphql.mock.calls[1] as [string, {after: string}]
    expect(secondCall[1].after).toBe('cursor-1')
  })
})

describe('resolveHandler.execute', () => {
  test('无待解决 thread → 返回 "没有找到" 消息', async () => {
    mockGetAuthenticated.mockResolvedValue({data: {login: 'cs-bot'}})
    mockGraphql.mockResolvedValueOnce(makePageResponse([]))

    const result = await resolveHandler.execute(makeCtx())
    expect(result.message).toMatch(/没有找到/)
  })

  test('全部成功 → 返回 "✅ 已解决 N 条"', async () => {
    mockGetAuthenticated.mockResolvedValue({data: {login: 'cs-bot'}})
    mockGraphql
      // query
      .mockResolvedValueOnce(
        makePageResponse([
          {id: 't1', isResolved: false, authorLogin: 'cs-bot'},
          {id: 't2', isResolved: false, authorLogin: 'cs-bot'}
        ])
      )
      // mutations
      .mockResolvedValueOnce({resolveReviewThread: {thread: {isResolved: true}}})
      .mockResolvedValueOnce({resolveReviewThread: {thread: {isResolved: true}}})

    const result = await resolveHandler.execute(makeCtx())
    expect(result.message).toMatch(/✅/)
    expect(result.message).toMatch(/2/)
  })

  test('部分失败 → 返回 "⚠️" 降级消息', async () => {
    mockGetAuthenticated.mockResolvedValue({data: {login: 'cs-bot'}})
    mockGraphql
      .mockResolvedValueOnce(
        makePageResponse([
          {id: 't1', isResolved: false, authorLogin: 'cs-bot'},
          {id: 't2', isResolved: false, authorLogin: 'cs-bot'}
        ])
      )
      .mockResolvedValueOnce({resolveReviewThread: {thread: {isResolved: true}}})
      .mockRejectedValueOnce(new Error('forbidden'))

    const result = await resolveHandler.execute(makeCtx())
    expect(result.message).toMatch(/⚠️/)
    expect(result.message).toMatch(/1/)  // ok
  })

  test('全部失败 → 返回权限不足提示', async () => {
    mockGetAuthenticated.mockResolvedValue({data: {login: 'cs-bot'}})
    mockGraphql
      .mockResolvedValueOnce(
        makePageResponse([{id: 't1', isResolved: false, authorLogin: 'cs-bot'}])
      )
      .mockRejectedValueOnce(new Error('forbidden'))

    const result = await resolveHandler.execute(makeCtx())
    expect(result.message).toMatch(/❌/)
    expect(result.message).toMatch(/pull-requests/)
  })
})

describe('batchResolve', () => {
  test('空数组 → 返回 ok=0 failed=0，不调用 GraphQL', async () => {
    const result = await batchResolve([])
    expect(result).toEqual({ok: 0, failed: 0})
    expect(mockGraphql).not.toHaveBeenCalled()
  })
})

describe('resolveAllBotComments', () => {
  test('无待解决 thread → 返回 {ok: 0, failed: 0}，不调用 mutation', async () => {
    mockGetAuthenticated.mockResolvedValue({data: {login: 'cs-bot'}})
    mockGraphql.mockResolvedValueOnce(makePageResponse([]))

    const result = await resolveAllBotComments({
      owner: 'org',
      repo: 'repo',
      prNumber: 1,
      options: {} as never
    })
    expect(result).toEqual({ok: 0, failed: 0})
    expect(mockGraphql).toHaveBeenCalledTimes(1) // 只有 query，无 mutation
  })

  test('有待解决 thread → 调用 mutation 并返回正确计数', async () => {
    mockGetAuthenticated.mockResolvedValue({data: {login: 'cs-bot'}})
    mockGraphql
      .mockResolvedValueOnce(
        makePageResponse([
          {id: 't1', isResolved: false, authorLogin: 'cs-bot'},
          {id: 't2', isResolved: false, authorLogin: 'cs-bot'}
        ])
      )
      .mockResolvedValueOnce({resolveReviewThread: {thread: {isResolved: true}}})
      .mockResolvedValueOnce({resolveReviewThread: {thread: {isResolved: true}}})

    const result = await resolveAllBotComments({
      owner: 'org',
      repo: 'repo',
      prNumber: 1,
      options: {} as never
    })
    expect(result).toEqual({ok: 2, failed: 0})
  })
})
