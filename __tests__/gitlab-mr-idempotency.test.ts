/**
 * gitlab-mr-idempotency.test.ts — MR 自动审查幂等判断（EVENT-013）
 */
import {describe, expect, test, jest, beforeEach, afterEach} from '@jest/globals'

const platform = {
  listComments: jest.fn<(...a: any[]) => Promise<any>>()
}
jest.mock('../src/platform/git-platform', () => ({getPlatform: () => platform}))

const logs = {info: jest.fn(), warning: jest.fn(), error: jest.fn(), debug: jest.fn()}
jest.mock('../src/platform/logger', () => ({getLogger: () => logs}))

import {resetStateNamespace, setStateNamespace} from '../src/platform/state-namespace'
import {stateMarker} from '../src/state-markers'
import {hasHeadBeenReviewed} from '../src/gitlab-mr-idempotency'

beforeEach(() => {
  jest.clearAllMocks()
  setStateNamespace('gitlab')
})

afterEach(() => {
  resetStateNamespace()
})

/** 拼一条带 summarize marker + reviewed-commit-ids 区块的摘要评论正文 */
function summaryCommentBody(reviewedShas: string[]): string {
  const ids = reviewedShas.map(sha => `<!-- ${sha} -->`).join('\n')
  return [
    stateMarker('summarize'),
    '## Summary',
    'some summary text',
    stateMarker('commitIdsStart'),
    ids,
    stateMarker('commitIdsEnd')
  ].join('\n')
}

describe('hasHeadBeenReviewed()', () => {
  test('没有摘要评论 → false（尚未审查过）', async () => {
    platform.listComments.mockResolvedValue([])
    const result = await hasHeadBeenReviewed('g', 'demo', 7, 'head-sha-0001')
    expect(result).toBe(false)
  })

  test('摘要评论存在但 headSha 不在已审查列表里 → false', async () => {
    platform.listComments.mockResolvedValue([
      {id: 1, body: summaryCommentBody(['head-sha-0000'])}
    ])
    const result = await hasHeadBeenReviewed('g', 'demo', 7, 'head-sha-0001')
    expect(result).toBe(false)
  })

  test('headSha 已在已审查列表里 → true', async () => {
    platform.listComments.mockResolvedValue([
      {id: 1, body: summaryCommentBody(['head-sha-0000', 'head-sha-0001'])}
    ])
    const result = await hasHeadBeenReviewed('g', 'demo', 7, 'head-sha-0001')
    expect(result).toBe(true)
  })

  test('多条评论里只有摘要评论带 marker，能正确挑出来', async () => {
    platform.listComments.mockResolvedValue([
      {id: 1, body: '普通用户评论，跟审查无关'},
      {id: 2, body: summaryCommentBody(['head-sha-0001'])}
    ])
    const result = await hasHeadBeenReviewed('g', 'demo', 7, 'head-sha-0001')
    expect(result).toBe(true)
  })

  test('listComments 抛错 → 退化为 false，不向上抛异常', async () => {
    platform.listComments.mockRejectedValue(new Error('network'))
    const result = await hasHeadBeenReviewed('g', 'demo', 7, 'head-sha-0001')
    expect(result).toBe(false)
    expect(logs.warning).toHaveBeenCalled()
  })
})
