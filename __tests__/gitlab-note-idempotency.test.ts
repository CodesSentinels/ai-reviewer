/**
 * gitlab-note-idempotency.test.ts — Note Hook 幂等标记（STATE-005 / EVENT-020/021）
 *
 * 标记 = bot 在触发命令的 note 上加的完成表情；旧版记账评论只读兼容。
 */
import {describe, expect, test, jest, beforeEach, afterEach} from '@jest/globals'

const platform = {
  listReactions: jest.fn<(...a: any[]) => Promise<any>>(),
  addReaction: jest.fn<(...a: any[]) => Promise<any>>(),
  listComments: jest.fn<(...a: any[]) => Promise<any>>(),
  createComment: jest.fn<(...a: any[]) => Promise<any>>(),
  updateComment: jest.fn<(...a: any[]) => Promise<any>>()
}
jest.mock('../src/platform/git-platform', () => ({getPlatform: () => platform}))

const logs = {info: jest.fn(), warning: jest.fn(), error: jest.fn(), debug: jest.fn()}
jest.mock('../src/platform/logger', () => ({getLogger: () => logs}))

import {resetStateNamespace, setStateNamespace} from '../src/platform/state-namespace'
import {
  completionReactionFor,
  extractProcessedKeys,
  hasNoteBeenProcessed,
  markNoteAsProcessed
} from '../src/gitlab-note-idempotency'

const REF = {
  owner: 'octo',
  repo: 'demo',
  changeRequestId: 7,
  noteId: 5001,
  idempotencyKey: 'gitlab:42:7:note:5001:create'
}
const BOTS = ['project_42_bot_abc', 'ai-reviewer']

/** 旧版记账评论（只读兼容） */
function legacyLedger(keys: string[]): string {
  return (
    '_Internal bookkeeping by AI Reviewer — ..._\n\n' +
    '<!-- ai-reviewer:gitlab:note-hook-markers-start -->\n' +
    keys.map(k => `<!-- ${k} -->\n`).join('') +
    '<!-- ai-reviewer:gitlab:note-hook-markers-end -->'
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  setStateNamespace('gitlab')
  platform.listReactions.mockResolvedValue([])
  platform.listComments.mockResolvedValue([])
  platform.addReaction.mockResolvedValue(undefined)
})

afterEach(() => {
  resetStateNamespace()
})

describe('completionReactionFor', () => {
  test('默认完成表情为 👍', () => {
    expect(completionReactionFor('rocket')).toBe('+1')
  })

  test('ACK 恰好是 👍 时避让为 🎉，保证失败的处理不会被误认为已完成', () => {
    expect(completionReactionFor('+1')).toBe('hooray')
  })
})

describe('extractProcessedKeys（旧版记账评论解析）', () => {
  test('没有区块 → 空列表', () => {
    expect(extractProcessedKeys('hello')).toEqual([])
  })

  test('解析出全部键', () => {
    expect(extractProcessedKeys(legacyLedger(['k1', 'k2']))).toEqual(['k1', 'k2'])
  })
})

describe('hasNoteBeenProcessed()', () => {
  test('bot 在 note 上加过完成表情 → true，且按 note 精确查询', async () => {
    platform.listReactions.mockResolvedValue([{content: '+1', userLogin: 'Project_42_Bot_ABC'}])

    expect(await hasNoteBeenProcessed(REF, BOTS, '+1')).toBe(true)
    expect(platform.listReactions).toHaveBeenCalledWith('octo', 'demo', 7, 5001, 'issue_comment')
  })

  test('只有 ACK 表情（处理中或已失败）→ false', async () => {
    platform.listReactions.mockResolvedValue([{content: 'rocket', userLogin: 'ai-reviewer'}])
    expect(await hasNoteBeenProcessed(REF, BOTS, '+1')).toBe(false)
  })

  test('完成表情是别人加的 → false（只认 bot 自己的标记）', async () => {
    platform.listReactions.mockResolvedValue([{content: '+1', userLogin: 'alice'}])
    expect(await hasNoteBeenProcessed(REF, BOTS, '+1')).toBe(false)
  })

  test('bot 身份未知 → 不查表情、不认表情标记', async () => {
    platform.listReactions.mockResolvedValue([{content: '+1', userLogin: 'ai-reviewer'}])

    expect(await hasNoteBeenProcessed(REF, [], '+1')).toBe(false)
    expect(platform.listReactions).not.toHaveBeenCalled()
  })

  test('旧版记账评论里记录过该键 → true（兼容已部署过旧版本的 MR）', async () => {
    platform.listComments.mockResolvedValue([
      {id: 1, body: 'unrelated'},
      {id: 2, body: legacyLedger(['other', REF.idempotencyKey])}
    ])
    expect(await hasNoteBeenProcessed(REF, BOTS, '+1')).toBe(true)
  })

  test('旧版记账评论存在但没有该键 → false', async () => {
    platform.listComments.mockResolvedValue([{id: 2, body: legacyLedger(['other'])}])
    expect(await hasNoteBeenProcessed(REF, BOTS, '+1')).toBe(false)
  })

  test('表情查询失败 → 仍检查旧版记账，不向上抛', async () => {
    platform.listReactions.mockRejectedValue(new Error('boom'))
    platform.listComments.mockResolvedValue([{id: 2, body: legacyLedger([REF.idempotencyKey])}])

    expect(await hasNoteBeenProcessed(REF, BOTS, '+1')).toBe(true)
    expect(logs.warning).toHaveBeenCalled()
  })

  test('两项查询都失败 → 退化为 false，不向上抛', async () => {
    platform.listReactions.mockRejectedValue(new Error('boom'))
    platform.listComments.mockRejectedValue(new Error('boom'))

    expect(await hasNoteBeenProcessed(REF, BOTS, '+1')).toBe(false)
  })
})

describe('markNoteAsProcessed()', () => {
  test('在 note 上添加完成表情，不写任何评论', async () => {
    await markNoteAsProcessed(REF, '+1')

    expect(platform.addReaction).toHaveBeenCalledWith(
      'octo',
      'demo',
      7,
      5001,
      '+1',
      'issue_comment'
    )
    expect(platform.createComment).not.toHaveBeenCalled()
    expect(platform.updateComment).not.toHaveBeenCalled()
  })

  test('写入失败只记警告，不向上抛异常', async () => {
    platform.addReaction.mockRejectedValue(new Error('boom'))

    await expect(markNoteAsProcessed(REF, '+1')).resolves.toBeUndefined()
    expect(logs.warning).toHaveBeenCalled()
  })
})
