/**
 * review-state.test.ts — PR body 中的 pause/resume marker（GH-012 + GH-014）
 *
 * pause/resume 状态写在 PR description 里，是唯一一处「用户也会编辑同一段正文」
 * 的状态载体：读错 = 暂停的 PR 被继续审查，写错 = 覆盖用户描述。此前没有直接单测。
 */
import {describe, expect, test, jest, afterEach} from '@jest/globals'

jest.mock('../src/platform/git-platform', () => ({getPlatform: jest.fn()}))

import {
  getReviewStateFromBody,
  reviewStateTags,
  writeReviewStateToBody,
  REVIEW_STATE_START_TAG,
  REVIEW_STATE_END_TAG
} from '../src/review-state'
import {resetStateNamespace, setStateNamespace} from '../src/platform/state-namespace'

afterEach(() => {
  resetStateNamespace()
})

/** 用当前命名空间标签构造一个状态区块 */
function namespacedBlock(state: string): string {
  const tags = reviewStateTags()
  return `${tags.start}\nstate: ${state}\n${tags.end}`
}

describe('GH-012: pause/resume 状态读取', () => {
  test('无状态区块 → active（默认不暂停）', () => {
    expect(getReviewStateFromBody('')).toBe('active')
    expect(getReviewStateFromBody('普通 PR 描述')).toBe('active')
    expect(getReviewStateFromBody(undefined)).toBe('active')
  })

  test('命名空间格式区块 → 正确读出 paused / active', () => {
    expect(getReviewStateFromBody(`描述\n\n${namespacedBlock('paused')}`)).toBe('paused')
    expect(getReviewStateFromBody(`描述\n\n${namespacedBlock('active')}`)).toBe('active')
  })

  test('历史格式区块（在途 PR）仍能读出 paused', () => {
    const legacy = `${REVIEW_STATE_START_TAG}\nstate: paused\n${REVIEW_STATE_END_TAG}`
    expect(getReviewStateFromBody(`描述\n\n${legacy}`)).toBe('paused')
  })

  test('只有起始标签、区块损坏 → 按 active 处理，不误判为暂停', () => {
    expect(getReviewStateFromBody(`描述\n${REVIEW_STATE_START_TAG}\nstate: paused`)).toBe('active')
  })

  test('用户描述里出现 "state: paused" 字样但无区块 → 不误判', () => {
    expect(getReviewStateFromBody('本 PR 会把 state: paused 写进配置')).toBe('active')
  })
})

describe('GH-012: pause/resume 状态写入不破坏用户描述', () => {
  test('无区块时追加到描述末尾，保留原描述', () => {
    const result = writeReviewStateToBody('用户写的描述', 'paused')

    expect(result).toContain('用户写的描述')
    expect(getReviewStateFromBody(result)).toBe('paused')
  })

  test('已有区块时就地替换，前后正文都保留', () => {
    const body = `前置描述\n\n${namespacedBlock('paused')}\n\n后置描述`

    const result = writeReviewStateToBody(body, 'active')

    expect(result).toContain('前置描述')
    expect(result).toContain('后置描述')
    expect(getReviewStateFromBody(result)).toBe('active')
    // 不产生第二个区块
    expect(result.split(reviewStateTags().start)).toHaveLength(2)
  })

  test('反复 pause / resume 不累积区块', () => {
    let body = '描述'
    for (const state of ['paused', 'active', 'paused'] as const) {
      body = writeReviewStateToBody(body, state)
    }

    expect(body.split(reviewStateTags().start)).toHaveLength(2)
    expect(getReviewStateFromBody(body)).toBe('paused')
    expect(body).toContain('描述')
  })

  test('空描述也能写入状态', () => {
    expect(getReviewStateFromBody(writeReviewStateToBody('', 'paused'))).toBe('paused')
  })
})

describe('GH-014: pause/resume marker 的平台命名空间', () => {
  test('新建区块使用带命名空间的标签', () => {
    const result = writeReviewStateToBody('描述', 'paused')

    expect(result).toContain('<!-- ai-reviewer:github:review-state-start -->')
    expect(result).not.toContain(REVIEW_STATE_START_TAG)
  })

  test('GitLab 运行时写入 gitlab: 命名空间', () => {
    setStateNamespace('gitlab')

    const result = writeReviewStateToBody('描述', 'paused')

    expect(result).toContain('<!-- ai-reviewer:gitlab:review-state-start -->')
    expect(getReviewStateFromBody(result)).toBe('paused')
  })

  test('GitHub 读不出 GitLab 写的区块（GH-015：不跨平台读状态）', () => {
    setStateNamespace('gitlab')
    const gitlabBody = writeReviewStateToBody('描述', 'paused')

    setStateNamespace('github')
    expect(getReviewStateFromBody(gitlabBody)).toBe('active')
  })

  test('历史区块就地保留旧标签，回滚到旧版本仍能读懂', () => {
    const legacy = `描述\n\n${REVIEW_STATE_START_TAG}\nstate: active\n${REVIEW_STATE_END_TAG}`

    const result = writeReviewStateToBody(legacy, 'paused')

    expect(result).toContain(REVIEW_STATE_START_TAG)
    expect(result).not.toContain(reviewStateTags().start)
    expect(getReviewStateFromBody(result)).toBe('paused')
  })
})
