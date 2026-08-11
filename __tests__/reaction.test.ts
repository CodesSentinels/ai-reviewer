/**
 * reaction.test.ts — 命令 ACK 表情反应行为基线（GH-010）
 *
 * `normalizeReaction` / `addAckReaction` 此前没有直接单测——early-reaction.test.ts
 * 只覆盖了 subgroup 路径拆分。ACK 表情是用户可见的「已收到」信号，且约定为
 * 「失败绝不阻塞命令主流程」，这里把取值归一化、endpoint 选择和容错钉成基线。
 */
import {describe, expect, test, jest, beforeEach} from '@jest/globals'

const logs = {
  info: jest.fn(),
  warning: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}
jest.mock('../src/platform/logger', () => ({getLogger: () => logs}))

const addReaction = jest.fn<any>()
jest.mock('../src/platform/git-platform', () => ({getPlatform: () => ({addReaction})}))

import {addAckReaction, normalizeReaction} from '../src/commands/reaction'

beforeEach(() => {
  jest.clearAllMocks()
  addReaction.mockResolvedValue(undefined)
})

const baseParams = {
  owner: 'o',
  repo: 'r',
  changeRequestId: 7,
  commentId: 555,
  eventName: 'issue_comment' as const
}

describe('GH-010: normalizeReaction 取值归一化', () => {
  test.each(['+1', '-1', 'laugh', 'confused', 'heart', 'hooray', 'rocket', 'eyes'])(
    '合法取值 %s 原样返回',
    value => {
      expect(normalizeReaction(value)).toBe(value)
    }
  )

  test('大小写与空白不敏感', () => {
    expect(normalizeReaction('  ROCKET  ')).toBe('rocket')
    expect(normalizeReaction('Eyes')).toBe('eyes')
  })

  test.each(['', '   ', 'off', 'none', 'false', 'OFF'])('禁用值 %s → null 且不 warning', value => {
    expect(normalizeReaction(value)).toBeNull()
    expect(logs.warning).not.toHaveBeenCalled()
  })

  test('undefined → null', () => {
    expect(normalizeReaction(undefined)).toBeNull()
  })

  test('非法取值 → null 并 warning（列出合法值，便于纠正配置）', () => {
    expect(normalizeReaction('thumbsup')).toBeNull()
    expect(logs.warning).toHaveBeenCalledWith(expect.stringContaining('thumbsup'))
    expect(logs.warning).toHaveBeenCalledWith(expect.stringContaining('rocket'))
  })
})

describe('GH-010: addAckReaction 行为', () => {
  test('issue_comment → commentKind=issue_comment', async () => {
    await addAckReaction({...baseParams, rawReaction: 'eyes'})

    expect(addReaction).toHaveBeenCalledWith('o', 'r', 7, 555, 'eyes', 'issue_comment')
  })

  test('pull_request_review_comment → commentKind=review_comment', async () => {
    await addAckReaction({
      ...baseParams,
      eventName: 'pull_request_review_comment',
      rawReaction: 'rocket'
    })

    expect(addReaction).toHaveBeenCalledWith('o', 'r', 7, 555, 'rocket', 'review_comment')
  })

  test('配置为禁用值 → 不调用平台 API', async () => {
    await addAckReaction({...baseParams, rawReaction: 'off'})
    await addAckReaction({...baseParams, rawReaction: ''})
    await addAckReaction({...baseParams, rawReaction: undefined})

    expect(addReaction).not.toHaveBeenCalled()
  })

  test('非法取值 → 跳过打表情，不调用平台 API', async () => {
    await addAckReaction({...baseParams, rawReaction: 'party'})

    expect(addReaction).not.toHaveBeenCalled()
  })

  test('平台 API 失败 → 只 warning，不抛出（不阻塞命令主流程）', async () => {
    addReaction.mockRejectedValue(new Error('403 Forbidden'))

    await expect(addAckReaction({...baseParams, rawReaction: 'eyes'})).resolves.toBeUndefined()
    expect(logs.warning).toHaveBeenCalledWith(expect.stringContaining('addAckReaction failed'))
  })

  test('成功时记录 info，含表情与评论 ID 便于排查', async () => {
    await addAckReaction({...baseParams, rawReaction: 'eyes'})

    expect(logs.info).toHaveBeenCalledWith(expect.stringContaining('eyes'))
    expect(logs.info).toHaveBeenCalledWith(expect.stringContaining('555'))
  })
})
