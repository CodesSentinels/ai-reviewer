/**
 * gitlab-note-hook-rules.test.ts — isSelfNote()/buildNoteIdempotencyKey() 单元
 * 测试（EVENT-018/020）+ EVENT-021 重复投递去重测试（mock marker）
 *
 * 参考 docs/tasks/gitlab-note-hook-design.md 第 3.3/3.5/3.6 节。
 */
import {describe, expect, test} from '@jest/globals'
import {
  isSelfNote,
  buildNoteIdempotencyKey
} from '../src/gitlab-note-hook-rules'

describe('EVENT-018: isSelfNote()', () => {
  test('actorLogin 与 configuredPatUsername 相同（大小写一致）→ true', () => {
    expect(isSelfNote('ai-reviewer-bot', 'ai-reviewer-bot')).toBe(true)
  })

  test('actorLogin 与 configuredPatUsername 大小写不同 → true（不区分大小写）', () => {
    expect(isSelfNote('AI-Reviewer-Bot', 'ai-reviewer-bot')).toBe(true)
  })

  test('actorLogin 与 configuredPatUsername 不同 → false', () => {
    expect(isSelfNote('alice', 'ai-reviewer-bot')).toBe(false)
  })

  test('空字符串 configuredPatUsername（未配置）不会误判真实用户为自己', () => {
    expect(isSelfNote('alice', '')).toBe(false)
  })
})

describe('EVENT-020: buildNoteIdempotencyKey()', () => {
  test('格式为 gitlab:{project_id}:{mr_iid}:note:{note_id}:create', () => {
    expect(buildNoteIdempotencyKey('42', 7, 5001)).toBe(
      'gitlab:42:7:note:5001:create'
    )
  })

  test('不同 project_id/mr_iid/note_id 组合产生不同的键（无碰撞）', () => {
    const a = buildNoteIdempotencyKey('42', 7, 5001)
    const b = buildNoteIdempotencyKey('42', 8, 5001)
    const c = buildNoteIdempotencyKey('43', 7, 5001)
    const d = buildNoteIdempotencyKey('42', 7, 5002)
    expect(new Set([a, b, c, d]).size).toBe(4)
  })
})

describe('EVENT-021: 重复投递不重复处理（mock marker store，非生产实现）', () => {
  // 生产环境的持久化 marker 属于 STATE-005，这里只用内存 Set 验证幂等键设计
  // 本身能正确支撑"去重"这个用途。
  function createMockMarkerStore(): {
    hasProcessed: (key: string) => boolean
    markProcessed: (key: string) => void
  } {
    const seen = new Set<string>()
    return {
      hasProcessed: (key: string) => seen.has(key),
      markProcessed: (key: string) => {
        seen.add(key)
      }
    }
  }

  test('同一条 note 的 webhook 重复投递两次 → 第二次被识别为重复，不应再处理', () => {
    const store = createMockMarkerStore()
    const key = buildNoteIdempotencyKey('42', 7, 5001)

    expect(store.hasProcessed(key)).toBe(false)
    store.markProcessed(key)

    // 模拟 webhook 重复投递：同一个 key 再次到达
    expect(store.hasProcessed(key)).toBe(true)
  })

  test('不同 note（不同 note_id）触发不同的键 → 不会被误判为重复', () => {
    const store = createMockMarkerStore()
    const keyA = buildNoteIdempotencyKey('42', 7, 5001)
    const keyB = buildNoteIdempotencyKey('42', 7, 5002)

    store.markProcessed(keyA)

    expect(store.hasProcessed(keyA)).toBe(true)
    expect(store.hasProcessed(keyB)).toBe(false)
  })
})
