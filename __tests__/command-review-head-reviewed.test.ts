/**
 * command-review-head-reviewed.test.ts — `review` 命令在 HEAD 已审查过时的行为
 *
 * 回归：自动审查暂停后，若暂停期间没有新 commit（HEAD 就是上次的审查点），
 * `@ai-reviewer review` 找不到增量起点，退回到从 base 全量重审，并重复发布评论。
 */
import {beforeEach, describe, expect, jest, test} from '@jest/globals'

const getReviewStateMock = jest.fn<(...a: unknown[]) => Promise<string>>()
const isHeadAlreadyReviewedMock = jest.fn<(...a: unknown[]) => Promise<boolean>>()

jest.mock('../src/review-state', () => ({
  getReviewState: (...a: unknown[]) => getReviewStateMock(...a)
}))
jest.mock('../src/review-commit-ids', () => ({
  isHeadAlreadyReviewed: (...a: unknown[]) => isHeadAlreadyReviewedMock(...a)
}))
jest.mock('../src/platform/logger', () => ({
  getLogger: () => ({info: jest.fn(), warning: jest.fn(), error: jest.fn(), debug: jest.fn()})
}))

import {reviewHandler} from '../src/commands/handlers/review'

const HEAD = 'abcdef1234567890abcdef1234567890abcdef12'
const triggerReview = jest.fn<(mode: string) => Promise<void>>()

function ctx(): any {
  return {owner: 'o', repo: 'r', prNumber: 7, headSha: HEAD, triggerReview}
}

beforeEach(() => {
  triggerReview.mockReset()
  getReviewStateMock.mockReset()
  isHeadAlreadyReviewedMock.mockReset()
})

describe('review（自动审查已暂停）', () => {
  test('HEAD 已审查过 → 说明没有新 commit，不触发审查', async () => {
    getReviewStateMock.mockResolvedValue('paused')
    isHeadAlreadyReviewedMock.mockResolvedValue(true)

    const r = await reviewHandler.execute(ctx())

    expect(triggerReview).not.toHaveBeenCalled()
    expect(r.message).toContain('already been reviewed')
    expect(r.message).toContain(HEAD.slice(0, 7))
  })

  test('HEAD 有新变更（未审查）→ 触发增量审查', async () => {
    getReviewStateMock.mockResolvedValue('paused')
    isHeadAlreadyReviewedMock.mockResolvedValue(false)

    const r = await reviewHandler.execute(ctx())

    expect(triggerReview).toHaveBeenCalledWith('incremental')
    expect(r.message).toBe('增量审查已完成')
  })

  test('未暂停 → 仍然只给出说明，不触发审查，也不用查 HEAD 是否审过', async () => {
    getReviewStateMock.mockResolvedValue('active')

    const r = await reviewHandler.execute(ctx())

    expect(triggerReview).not.toHaveBeenCalled()
    expect(isHeadAlreadyReviewedMock).not.toHaveBeenCalled()
    expect(r.message).toContain('applicable only when automatic reviews are paused')
  })
})
