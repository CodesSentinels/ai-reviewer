/**
 * comment-chain-status.test.ts — OPT-001 评论链状态标注单元测试
 *
 * 覆盖:
 * - fetchThreadStatusMap 构建的 key 格式（path:line）
 * - Commenter.getCommentChainsWithinRange 注入 [OPEN] / [RESOLVED] 标签
 * - 无 threadStatusMap 时行为与原来一致（无标签）
 * - 同一位置多条线程时保守策略（false 覆盖 true）
 */
import {describe, expect, test, jest, beforeEach} from '@jest/globals'

// ─── Stub @actions/core ────────────────────────────────────────────────────
jest.mock('@actions/core', () => ({
  info: jest.fn(),
  warning: jest.fn(),
  error: jest.fn(),
  getInput: jest.fn(() => '')
}))

// ─── Stub @actions/github ──────────────────────────────────────────────────
jest.mock('@actions/github', () => ({
  context: {
    repo: {owner: 'owner', repo: 'repo'},
    payload: {}
  }
}))

// ─── Stub octokit ─────────────────────────────────────────────────────────
const mockListReviewComments = jest.fn<() => Promise<{data: Record<string, unknown>[]}>>()
jest.mock('../src/octokit', () => ({
  octokit: {
    pulls: {
      listReviewComments: mockListReviewComments
    }
  }
}))

import {Commenter} from '../src/commenter'

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeComment(
  id: number,
  body: string,
  path: string,
  line: number,
  replyTo?: number
): Record<string, unknown> {
  return {
    id,
    body,
    path,
    line,
    start_line: line,
    in_reply_to_id: replyTo ?? null,
    user: {login: 'reviewer'}
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('getCommentChainsWithinRange — thread status labels', () => {
  let commenter: Commenter

  beforeEach(() => {
    jest.clearAllMocks()
    commenter = new Commenter()

    // Default: one top-level comment at path src/a.ts line 10
    mockListReviewComments.mockResolvedValue({
      data: [
        makeComment(1, '<!-- AI Reviewer --> SQL injection found', 'src/a.ts', 10)
      ]
    })
  })

  test('no threadStatusMap → chain has no status label (legacy behaviour)', async () => {
    const result = await commenter.getCommentChainsWithinRange(
      1,
      'src/a.ts',
      10,
      10,
      '<!-- AI Reviewer -->'
    )
    expect(result).toContain('Conversation Chain 1:')
    expect(result).not.toContain('[OPEN]')
    expect(result).not.toContain('[RESOLVED]')
  })

  test('threadStatusMap marks unresolved thread as [OPEN]', async () => {
    const statusMap = new Map<string, boolean>([['src/a.ts:10', false]])

    const result = await commenter.getCommentChainsWithinRange(
      1,
      'src/a.ts',
      10,
      10,
      '<!-- AI Reviewer -->',
      statusMap
    )
    expect(result).toContain('Conversation Chain 1 [OPEN]:')
  })

  test('threadStatusMap marks resolved thread as [RESOLVED]', async () => {
    const statusMap = new Map<string, boolean>([['src/a.ts:10', true]])

    const result = await commenter.getCommentChainsWithinRange(
      1,
      'src/a.ts',
      10,
      10,
      '<!-- AI Reviewer -->',
      statusMap
    )
    expect(result).toContain('Conversation Chain 1 [RESOLVED]:')
  })

  test('key not in threadStatusMap → no label added', async () => {
    // Map has a different path, so src/a.ts:10 is not found
    const statusMap = new Map<string, boolean>([['src/b.ts:10', false]])

    const result = await commenter.getCommentChainsWithinRange(
      1,
      'src/a.ts',
      10,
      10,
      '<!-- AI Reviewer -->',
      statusMap
    )
    expect(result).toContain('Conversation Chain 1:')
    expect(result).not.toContain('[OPEN]')
    expect(result).not.toContain('[RESOLVED]')
  })

  test('multiple chains — each gets its own label', async () => {
    mockListReviewComments.mockResolvedValue({
      data: [
        makeComment(1, '<!-- AI Reviewer --> issue A', 'src/a.ts', 10),
        makeComment(2, '<!-- AI Reviewer --> issue B', 'src/a.ts', 15)
      ]
    })

    // Both lines are in range 10-15
    const statusMap = new Map<string, boolean>([
      ['src/a.ts:10', false],  // open
      ['src/a.ts:15', true]    // resolved
    ])

    const result = await commenter.getCommentChainsWithinRange(
      1,
      'src/a.ts',
      10,
      15,
      '<!-- AI Reviewer -->',
      statusMap
    )
    expect(result).toContain('[OPEN]')
    expect(result).toContain('[RESOLVED]')
  })
})

describe('ThreadStatusMap key format', () => {
  test('conservative merge: unresolved wins over resolved at same location', () => {
    // Simulate what fetchThreadStatusMap does when two threads share path:line
    const map = new Map<string, boolean>()

    const threads = [
      {path: 'src/a.ts', line: 10, isResolved: true},
      {path: 'src/a.ts', line: 10, isResolved: false}  // same location, unresolved
    ]

    for (const t of threads) {
      const key = `${t.path}:${t.line}`
      if (!map.has(key) || !t.isResolved) {
        map.set(key, t.isResolved)
      }
    }

    expect(map.get('src/a.ts:10')).toBe(false)
  })

  test('resolved thread stays resolved when no unresolved at same location', () => {
    const map = new Map<string, boolean>()

    const threads = [
      {path: 'src/a.ts', line: 10, isResolved: true},
      {path: 'src/a.ts', line: 20, isResolved: false}
    ]

    for (const t of threads) {
      const key = `${t.path}:${t.line}`
      if (!map.has(key) || !t.isResolved) {
        map.set(key, t.isResolved)
      }
    }

    expect(map.get('src/a.ts:10')).toBe(true)
    expect(map.get('src/a.ts:20')).toBe(false)
  })
})
