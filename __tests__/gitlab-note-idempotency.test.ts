/**
 * gitlab-note-idempotency.test.ts — Note Hook 幂等 marker 存储（STATE-005 / EVENT-020/021）
 */
import {describe, expect, test, jest, beforeEach, afterEach} from '@jest/globals'

const platform = {
  listComments: jest.fn<(...a: any[]) => Promise<any>>(),
  createComment: jest.fn<(...a: any[]) => Promise<any>>(),
  updateComment: jest.fn<(...a: any[]) => Promise<any>>()
}
jest.mock('../src/platform/git-platform', () => ({getPlatform: () => platform}))

const logs = {info: jest.fn(), warning: jest.fn(), error: jest.fn(), debug: jest.fn()}
jest.mock('../src/platform/logger', () => ({getLogger: () => logs}))

import {resetStateNamespace, setStateNamespace} from '../src/platform/state-namespace'
import {
  appendProcessedKey,
  extractProcessedKeys,
  hasNoteBeenProcessed,
  markNoteAsProcessed
} from '../src/gitlab-note-idempotency'

beforeEach(() => {
  jest.clearAllMocks()
  setStateNamespace('gitlab')
})

afterEach(() => {
  resetStateNamespace()
})

describe('extractProcessedKeys / appendProcessedKey：纯函数', () => {
  test('空正文 → 空列表', () => {
    expect(extractProcessedKeys('')).toEqual([])
  })

  test('新建区块：从空正文开始追加，带人类可读说明头', () => {
    const body = appendProcessedKey('', 'gitlab:42:7:note:5001:create')
    expect(body).toContain('Internal bookkeeping')
    expect(extractProcessedKeys(body)).toEqual(['gitlab:42:7:note:5001:create'])
  })

  test('已有区块：追加第二个键，保留第一个', () => {
    let body = appendProcessedKey('', 'gitlab:42:7:note:5001:create')
    body = appendProcessedKey(body, 'gitlab:42:7:note:5002:create')
    expect(extractProcessedKeys(body)).toEqual([
      'gitlab:42:7:note:5001:create',
      'gitlab:42:7:note:5002:create'
    ])
  })

  test('追加已存在的键 → 原样返回，不重复', () => {
    const once = appendProcessedKey('', 'gitlab:42:7:note:5001:create')
    const twice = appendProcessedKey(once, 'gitlab:42:7:note:5001:create')
    expect(twice).toBe(once)
    expect(extractProcessedKeys(twice)).toEqual(['gitlab:42:7:note:5001:create'])
  })
})

describe('hasNoteBeenProcessed()', () => {
  test('没有记账 comment → false', async () => {
    platform.listComments.mockResolvedValue([])
    const result = await hasNoteBeenProcessed('g', 'demo', 7, 'gitlab:42:7:note:5001:create')
    expect(result).toBe(false)
  })

  test('记账 comment 存在但键不在里面 → false', async () => {
    const body = appendProcessedKey('', 'gitlab:42:7:note:5001:create')
    platform.listComments.mockResolvedValue([{id: 1, body}])
    const result = await hasNoteBeenProcessed('g', 'demo', 7, 'gitlab:42:7:note:9999:create')
    expect(result).toBe(false)
  })

  test('键已记录 → true', async () => {
    const body = appendProcessedKey('', 'gitlab:42:7:note:5001:create')
    platform.listComments.mockResolvedValue([{id: 1, body}])
    const result = await hasNoteBeenProcessed('g', 'demo', 7, 'gitlab:42:7:note:5001:create')
    expect(result).toBe(true)
  })

  test('listComments 抛错 → 退化为 false，不向上抛异常', async () => {
    platform.listComments.mockRejectedValue(new Error('network'))
    const result = await hasNoteBeenProcessed('g', 'demo', 7, 'gitlab:42:7:note:5001:create')
    expect(result).toBe(false)
    expect(logs.warning).toHaveBeenCalled()
  })

  test('多条评论里只有其中一条带 marker，能正确挑出来', async () => {
    const body = appendProcessedKey('', 'gitlab:42:7:note:5001:create')
    platform.listComments.mockResolvedValue([
      {id: 1, body: '普通用户评论，跟幂等无关'},
      {id: 2, body}
    ])
    const result = await hasNoteBeenProcessed('g', 'demo', 7, 'gitlab:42:7:note:5001:create')
    expect(result).toBe(true)
  })
})

describe('markNoteAsProcessed()', () => {
  test('记账 comment 不存在 → 新建', async () => {
    platform.listComments.mockResolvedValue([])
    platform.createComment.mockResolvedValue({id: 99})

    await markNoteAsProcessed('g', 'demo', 7, 'gitlab:42:7:note:5001:create')

    expect(platform.createComment).toHaveBeenCalledTimes(1)
    const [, , , body] = platform.createComment.mock.calls[0] as any[]
    expect(extractProcessedKeys(body)).toEqual(['gitlab:42:7:note:5001:create'])
    expect(platform.updateComment).not.toHaveBeenCalled()
  })

  test('记账 comment 已存在 → 追加更新，不新建', async () => {
    const existingBody = appendProcessedKey('', 'gitlab:42:7:note:5001:create')
    platform.listComments.mockResolvedValue([{id: 42, body: existingBody}])

    await markNoteAsProcessed('g', 'demo', 7, 'gitlab:42:7:note:5002:create')

    expect(platform.createComment).not.toHaveBeenCalled()
    expect(platform.updateComment).toHaveBeenCalledTimes(1)
    const [, , commentId, newBody] = platform.updateComment.mock.calls[0] as any[]
    expect(commentId).toBe(42)
    expect(extractProcessedKeys(newBody)).toEqual([
      'gitlab:42:7:note:5001:create',
      'gitlab:42:7:note:5002:create'
    ])
  })

  test('键已经记过 → 不发起写请求（幂等）', async () => {
    const existingBody = appendProcessedKey('', 'gitlab:42:7:note:5001:create')
    platform.listComments.mockResolvedValue([{id: 42, body: existingBody}])

    await markNoteAsProcessed('g', 'demo', 7, 'gitlab:42:7:note:5001:create')

    expect(platform.createComment).not.toHaveBeenCalled()
    expect(platform.updateComment).not.toHaveBeenCalled()
  })

  test('写入失败只记警告，不向上抛异常', async () => {
    platform.listComments.mockResolvedValue([])
    platform.createComment.mockRejectedValue(new Error('network'))

    await expect(
      markNoteAsProcessed('g', 'demo', 7, 'gitlab:42:7:note:5001:create')
    ).resolves.toBeUndefined()
    expect(logs.warning).toHaveBeenCalled()
  })
})
