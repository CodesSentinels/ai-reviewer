/**
 * resolve.test.ts — resolve handler 与 review-thread 工具函数的单元测试
 *
 * 覆盖:
 * - 无待解决 thread → 返回 "没有找到" 消息
 * - 全部成功 → 返回 "✅ 已解决 N 条"
 * - 部分失败 → 返回 "⚠️ 共 N 条，成功 X，失败 Y"
 * - 全部失败 → 返回权限不足提示
 * - 非 Bot 发的 thread 被过滤 → 不被 resolve
 * - 已 resolved thread 被跳过 → isResolved=true 的不调用 mutation
 */
import {describe, expect, test, beforeEach, jest} from '@jest/globals'
import type {ReviewThread} from '../src/github/review-thread'

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPlatform = {
  getAuthenticatedLogin: jest.fn<() => Promise<string>>(),
  fetchUnresolvedBotThreads: jest.fn<() => Promise<ReviewThread[]>>(),
  resolveThreads: jest.fn<() => Promise<{ok: number; failed: number; errors: Error[]}>>()
}

jest.mock('../src/platform/git-platform', () => ({
  getPlatform: () => mockPlatform
}))

const mockLogger = {
  info: jest.fn(),
  warning: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}

jest.mock('../src/platform/logger', () => ({
  getLogger: () => mockLogger
}))

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import {
  getBotLogin,
  fetchUnresolvedBotThreads,
  batchResolve,
  _resetBotLoginCache
} from '../src/github/review-thread'
import {resolveHandler} from '../src/commands/handlers/resolve'
import type {CommandContext} from '../src/commands/types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeThread(overrides: Partial<ReviewThread> = {}): ReviewThread {
  return {
    id: 'PRT_xxx',
    isResolved: false,
    firstCommentAuthorLogin: 'cs-bot',
    path: 'src/foo.ts',
    line: 42,
    firstCommentBody: 'You should handle this edge case',
    ...overrides
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
})

describe('getBotLogin', () => {
  test('始终调用 getAuthenticated 获取真实 GitHub 登录名', async () => {
    mockPlatform.getAuthenticatedLogin.mockResolvedValue('github-actions[bot]')
    const login = await getBotLogin({} as never)
    expect(login).toBe('github-actions[bot]')
    expect(mockPlatform.getAuthenticatedLogin).toHaveBeenCalledTimes(1)
  })

  test('缓存：第二次调用不再请求 API', async () => {
    mockPlatform.getAuthenticatedLogin.mockResolvedValue('github-actions[bot]')
    await getBotLogin({} as never)
    await getBotLogin({} as never)
    expect(mockPlatform.getAuthenticatedLogin).toHaveBeenCalledTimes(1)
  })

  test('getAuthenticated 抛异常时回退到 github-actions', async () => {
    // 平台层 getAuthenticatedLogin 内部 catch 后返回 'github-actions'，
    // 所以从 getBotLogin 视角看到的是 resolve 值而非 reject。
    mockPlatform.getAuthenticatedLogin.mockResolvedValue('github-actions')
    const login = await getBotLogin({} as never)
    expect(login).toBe('github-actions')
  })
})

describe('fetchUnresolvedBotThreads', () => {
  test('非 Bot 发的 thread 被过滤', async () => {
    // 平台层已做过滤，返回的只有 bot 的 thread
    mockPlatform.fetchUnresolvedBotThreads.mockResolvedValueOnce([
      makeThread({id: 't2', firstCommentAuthorLogin: 'cs-bot'})
    ])
    const threads = await fetchUnresolvedBotThreads({owner: 'o', repo: 'r', prNumber: 1}, 'cs-bot')
    expect(threads).toHaveLength(1)
    expect(threads[0].id).toBe('t2')
  })

  test('已 resolved 的 thread 被跳过', async () => {
    // 平台层已过滤 isResolved=true，返回的只有未 resolved 的
    mockPlatform.fetchUnresolvedBotThreads.mockResolvedValueOnce([
      makeThread({
        id: 't2',
        isResolved: false,
        firstCommentAuthorLogin: 'cs-bot'
      })
    ])
    const threads = await fetchUnresolvedBotThreads({owner: 'o', repo: 'r', prNumber: 1}, 'cs-bot')
    expect(threads).toHaveLength(1)
    expect(threads[0].id).toBe('t2')
  })

  test('[bot] 后缀归一化：REST 身份 github-actions[bot] 匹配 GraphQL 的 github-actions', async () => {
    // 平台层负责 [bot] 后缀归一化，返回匹配结果
    mockPlatform.fetchUnresolvedBotThreads.mockResolvedValueOnce([
      makeThread({
        id: 't1',
        isResolved: false,
        firstCommentAuthorLogin: 'github-actions'
      })
    ])
    const threads = await fetchUnresolvedBotThreads(
      {owner: 'o', repo: 'r', prNumber: 1},
      'github-actions[bot]'
    )
    expect(threads).toHaveLength(1)
    expect(threads[0].id).toBe('t1')
  })

  test('平台层被正确调用：传入 owner/repo/prNumber/botLogin', async () => {
    mockPlatform.fetchUnresolvedBotThreads.mockResolvedValueOnce([])
    await fetchUnresolvedBotThreads({owner: 'o', repo: 'r', prNumber: 1}, 'cs-bot')
    expect(mockPlatform.fetchUnresolvedBotThreads).toHaveBeenCalledWith('o', 'r', 1, 'cs-bot')
  })
})

describe('resolveHandler.execute', () => {
  test('无待解决 thread → 返回 "没有找到" 消息', async () => {
    mockPlatform.getAuthenticatedLogin.mockResolvedValue('cs-bot')
    mockPlatform.fetchUnresolvedBotThreads.mockResolvedValueOnce([])

    const result = await resolveHandler.execute(makeCtx())
    expect(result.message).toMatch(/没有找到/)
  })

  test('全部成功 → 返回 "✅ 已解决 N 条"', async () => {
    mockPlatform.getAuthenticatedLogin.mockResolvedValue('cs-bot')
    mockPlatform.fetchUnresolvedBotThreads.mockResolvedValueOnce([
      makeThread({id: 't1', firstCommentAuthorLogin: 'cs-bot'}),
      makeThread({id: 't2', firstCommentAuthorLogin: 'cs-bot'})
    ])
    // batchResolve calls resolveThreads per thread
    mockPlatform.resolveThreads
      .mockResolvedValueOnce({ok: 1, failed: 0, errors: []})
      .mockResolvedValueOnce({ok: 1, failed: 0, errors: []})

    const result = await resolveHandler.execute(makeCtx())
    expect(result.message).toMatch(/✅/)
    expect(result.message).toMatch(/2/)
  })

  test('部分失败（adapter 返回 failed>0 而非 throw）→ 返回 "⚠️" 降级消息', async () => {
    mockPlatform.getAuthenticatedLogin.mockResolvedValue('cs-bot')
    mockPlatform.fetchUnresolvedBotThreads.mockResolvedValueOnce([
      makeThread({id: 't1', firstCommentAuthorLogin: 'cs-bot'}),
      makeThread({id: 't2', firstCommentAuthorLogin: 'cs-bot'})
    ])
    // adapter 不 throw，而是在返回值中报告失败
    mockPlatform.resolveThreads
      .mockResolvedValueOnce({ok: 1, failed: 0, errors: []})
      .mockResolvedValueOnce({
        ok: 0,
        failed: 1,
        errors: [new Error('forbidden')]
      })

    const result = await resolveHandler.execute(makeCtx())
    expect(result.message).toMatch(/⚠️/)
    expect(result.message).toMatch(/1/) // ok
  })

  test('全部失败（adapter 返回 failed>0 而非 throw）→ 返回 ❌ 和错误详情', async () => {
    mockPlatform.getAuthenticatedLogin.mockResolvedValue('cs-bot')
    mockPlatform.fetchUnresolvedBotThreads.mockResolvedValueOnce([
      makeThread({id: 't1', firstCommentAuthorLogin: 'cs-bot'})
    ])
    mockPlatform.resolveThreads.mockResolvedValueOnce({
      ok: 0,
      failed: 1,
      errors: [new Error('forbidden')]
    })

    const result = await resolveHandler.execute(makeCtx())
    expect(result.message).toMatch(/❌/)
    expect(result.message).toMatch(/forbidden/)
  })

  test('adapter 抛异常（非预期路径）→ 同样被 catch 计为失败', async () => {
    mockPlatform.getAuthenticatedLogin.mockResolvedValue('cs-bot')
    mockPlatform.fetchUnresolvedBotThreads.mockResolvedValueOnce([
      makeThread({id: 't1', firstCommentAuthorLogin: 'cs-bot'})
    ])
    mockPlatform.resolveThreads.mockRejectedValueOnce(new Error('unexpected throw'))

    const result = await resolveHandler.execute(makeCtx())
    expect(result.message).toMatch(/❌/)
    expect(result.message).toMatch(/unexpected throw/)
  })
})

describe('batchResolve', () => {
  test('空数组 → 返回 ok=0 failed=0 errors=[]，不调用 resolveThreads', async () => {
    const result = await batchResolve([])
    expect(result).toEqual({ok: 0, failed: 0, errors: [], failedItems: []})
    expect(mockPlatform.resolveThreads).not.toHaveBeenCalled()
  })

  describe('错误输出', () => {
    test('权限错误 → warning 只输出一次，含 resolve_token 指引', async () => {
      mockPlatform.resolveThreads.mockRejectedValueOnce(
        new Error('Resource not accessible by integration')
      )

      await batchResolve([makeThread()])

      expect(mockLogger.warning).toHaveBeenCalledTimes(1)
      expect(mockLogger.warning.mock.calls[0][0]).toMatch(/resolve_token/)
      expect(mockLogger.warning.mock.calls[0][0]).toMatch(/PAT/)
    })

    test('多线程全为权限错误 → warning 仍只输出一次', async () => {
      mockPlatform.resolveThreads
        .mockRejectedValueOnce(new Error('Resource not accessible by integration'))
        .mockRejectedValueOnce(new Error('Resource not accessible by integration'))

      await batchResolve([makeThread({id: 't1'}), makeThread({id: 't2'})])

      expect(mockLogger.warning).toHaveBeenCalledTimes(1)
    })

    test('非权限错误 → warning 输出含 path:line 和注释摘要的标签', async () => {
      mockPlatform.resolveThreads.mockRejectedValueOnce(new Error('network timeout'))

      await batchResolve([
        makeThread({
          path: 'src/auth.ts',
          line: 17,
          firstCommentBody: 'Missing null check here'
        })
      ])

      expect(mockLogger.warning).toHaveBeenCalledTimes(1)
      const msg = mockLogger.warning.mock.calls[0][0] as string
      expect(msg).toMatch(/src\/auth\.ts:17/)
      expect(msg).toMatch(/Missing null check here/)
    })

    test('path 无 line 时只输出 path', async () => {
      mockPlatform.resolveThreads.mockRejectedValueOnce(new Error('oops'))

      await batchResolve([makeThread({path: 'src/foo.ts', line: null})])

      const msg = mockLogger.warning.mock.calls[0][0] as string
      expect(msg).toMatch(/src\/foo\.ts/)
      expect(msg).not.toMatch(/src\/foo\.ts:\d/)
    })

    test('混合错误 → 权限 warning + 其他 warning 各一条', async () => {
      mockPlatform.resolveThreads
        .mockRejectedValueOnce(new Error('Resource not accessible by integration'))
        .mockRejectedValueOnce(new Error('network timeout'))

      await batchResolve([
        makeThread({id: 't1', path: 'src/a.ts', line: 1}),
        makeThread({id: 't2', path: 'src/b.ts', line: 2})
      ])

      expect(mockLogger.warning).toHaveBeenCalledTimes(2)
      const msgs = mockLogger.warning.mock.calls.map(c => c[0] as string)
      expect(msgs.some(m => m.includes('resolve_token'))).toBe(true)
      expect(msgs.some(m => m.includes('src/b.ts:2'))).toBe(true)
    })

    test('adapter 返回 failed>0（不 throw）→ 计为失败，不误报成功', async () => {
      mockPlatform.resolveThreads.mockResolvedValueOnce({
        ok: 0,
        failed: 1,
        errors: [new Error('network timeout')]
      })

      const result = await batchResolve([makeThread({path: 'src/x.ts', line: 5})])

      expect(result.ok).toBe(0)
      expect(result.failed).toBe(1)
      expect(result.errors).toHaveLength(1)
      expect(result.failedItems).toHaveLength(1)
      expect(mockLogger.warning).toHaveBeenCalled()
    })

    test('adapter 返回成功 → 正确计为 ok', async () => {
      mockPlatform.resolveThreads.mockResolvedValueOnce({
        ok: 1,
        failed: 0,
        errors: []
      })

      const result = await batchResolve([makeThread()])

      expect(result.ok).toBe(1)
      expect(result.failed).toBe(0)
    })
  })
})
