/**
 * github-write-idempotency.test.ts — GitHub 写级别幂等（STATE-015）
 *
 * 「服务端已写入、响应在回程丢了」与「请求根本没到」在客户端看来完全一样。
 * `@octokit/plugin-retry` 是**传输层**重试：它会直接重发 POST，前一种情况就多出
 * 一条评论，事后也无从察觉。GitLab 侧早有 write marker 解决这个问题
 * （GLAPI-027），GitHub 侧一直空缺——这正是 STATE-015 里「API 超时重试使用同一
 * 幂等规则」原先不成立的地方。
 *
 * 现在两平台共用 `write-marker.ts`。本文件验证 GitHub 侧确实接上了：
 * 写前埋 marker、关掉 octokit 自动重试、失败后先探测再重试。
 */
import {describe, expect, test, beforeEach, jest} from '@jest/globals'

const issues = {
  createComment: jest.fn<any>(),
  listComments: jest.fn<any>(),
  updateComment: jest.fn<any>(),
  deleteComment: jest.fn<any>()
}
const pulls = {
  createReview: jest.fn<any>(),
  submitReview: jest.fn<any>(),
  listReviews: jest.fn<any>(),
  createReviewComment: jest.fn<any>(),
  createReplyForReviewComment: jest.fn<any>(),
  listReviewComments: jest.fn<any>()
}
jest.mock('../src/octokit', () => ({octokit: {issues, pulls, paginate: jest.fn()}}))
jest.mock('../src/platform/logger', () => ({
  getLogger: () => ({info: jest.fn(), warning: jest.fn(), error: jest.fn(), debug: jest.fn()})
}))

import {GitHubPlatform} from '../src/platform/github-platform'
import {stripWriteMarkers} from '../src/platform/write-marker'

const platform = new GitHubPlatform()

/** 抓取最近一次 createComment 请求里的正文 */
function lastSentBody(): string {
  const calls = issues.createComment.mock.calls as any[][]
  return String(calls[calls.length - 1][0].body)
}

/** 从正文里取出写 marker */
function markerIn(body: string): string {
  const m = body.match(/<!-- ai-reviewer:github:write:\d+:[a-z][a-z0-9-]*:[0-9a-f]{16} -->/)
  return m?.[0] ?? ''
}

beforeEach(() => {
  jest.clearAllMocks()
  issues.listComments.mockResolvedValue({data: []})
  pulls.listReviews.mockResolvedValue({data: []})
  pulls.listReviewComments.mockResolvedValue({data: []})
  pulls.createReview.mockResolvedValue({data: {id: 500}})
  pulls.submitReview.mockResolvedValue({data: {}})
  pulls.createReviewComment.mockResolvedValue({data: {id: 1}})
  pulls.createReplyForReviewComment.mockResolvedValue({
    data: {id: 2, body: 'x', user: {login: 'bot'}}
  })
})

/** 从任意 mock 的最后一次调用里取出正文 */
function bodyOf(fn: any): string {
  const calls = fn.mock.calls as any[][]
  return String(calls[calls.length - 1][0].body ?? '')
}

const DRAFT = {path: 'a.ts', line: 3, body: '行级发现'}

describe('写前埋 marker', () => {
  test('发出去的正文带 github 命名空间的写 marker', async () => {
    issues.createComment.mockResolvedValue({data: {id: 1, body: 'x', user: {login: 'bot'}}})

    await platform.createComment('octo', 'demo', 42, '这是评论')

    const sent = lastSentBody()
    expect(sent).toContain('这是评论')
    expect(markerIn(sent)).not.toBe('')
    expect(sent).not.toContain('ai-reviewer:gitlab:write') // 不与另一平台混用
  })

  test('返回给共享核心的正文已剥掉 marker', async () => {
    issues.createComment.mockImplementation(async (params: any) => ({
      data: {id: 1, body: params.body, user: {login: 'bot'}}
    }))

    const result = await platform.createComment('octo', 'demo', 42, '这是评论')

    expect(result.body).toBe('这是评论')
    expect(result.body).not.toContain('ai-reviewer')
  })

  test('关掉 octokit 自动重试（否则它会在我们看不见的地方重发 POST）', async () => {
    issues.createComment.mockResolvedValue({data: {id: 1, body: 'x', user: {login: 'bot'}}})

    await platform.createComment('octo', 'demo', 42, '这是评论')

    expect((issues.createComment.mock.calls as any[][])[0][0].request).toEqual({retries: 0})
  })
})

describe('超时重试不产生重复评论', () => {
  /**
   * 这是整条防线要防的那个场景：POST 已经在服务端落地，客户端收到超时。
   * 没有 marker 探测的话，重试会写出第二条一模一样的评论。
   */
  test('服务端已成功但客户端超时 → 探测到既有评论并复用，不再写第二条', async () => {
    let sentBody = ''
    issues.createComment.mockImplementation(async (params: any) => {
      sentBody = String(params.body)
      throw Object.assign(new Error('socket hang up'), {code: 'ECONNRESET'})
    })
    // 探测时，服务端其实已经有那条评论了
    issues.listComments.mockImplementation(async () => ({
      data: [{id: 999, body: sentBody, user: {login: 'bot'}, node_id: 'N', created_at: 't'}]
    }))

    const result = await platform.createComment('octo', 'demo', 42, '这是评论')

    expect(result.id).toBe(999)
    expect(result.body).toBe('这是评论') // marker 已剥离
    expect(issues.createComment).toHaveBeenCalledTimes(1) // 没有重发
  })

  test('对照组：服务端确实没写成功 → 探测落空，正常重试', async () => {
    let attempts = 0
    issues.createComment.mockImplementation(async (params: any) => {
      attempts++
      if (attempts === 1) throw new Error('ECONNRESET')
      return {data: {id: 7, body: params.body, user: {login: 'bot'}}}
    })
    issues.listComments.mockResolvedValue({data: []}) // 服务端什么都没有

    const result = await platform.createComment('octo', 'demo', 42, '这是评论')

    expect(result.id).toBe(7)
    expect(attempts).toBe(2)
  })

  test('探测本身失败不算作「已写入」，继续重试', async () => {
    let attempts = 0
    issues.createComment.mockImplementation(async (params: any) => {
      attempts++
      if (attempts === 1) throw new Error('ECONNRESET')
      return {data: {id: 8, body: params.body, user: {login: 'bot'}}}
    })
    issues.listComments.mockRejectedValue(new Error('503'))

    const result = await platform.createComment('octo', 'demo', 42, '这是评论')

    expect(result.id).toBe(8)
    expect(attempts).toBe(2)
  })

  test('始终失败 → 有限次后抛出，不无限重试', async () => {
    issues.createComment.mockRejectedValue(new Error('ECONNRESET'))
    issues.listComments.mockResolvedValue({data: []})

    await expect(platform.createComment('octo', 'demo', 42, '这是评论')).rejects.toThrow()
    expect(issues.createComment.mock.calls.length).toBeLessThanOrEqual(3)
  })
})

describe('marker 唯一标识一次逻辑写入，不是一段正文', () => {
  /**
   * 若 marker 只按正文摘要生成，同一 PR 里第二次合法发布相同内容时
   * （例如连续两次 pause 回复），探测会命中第一次的历史评论并误判为
   * 「本次已成功」，新评论就此丢失。
   */
  test('两次发布相同正文 → marker 不同', async () => {
    issues.createComment.mockImplementation(async (params: any) => ({
      data: {id: 1, body: params.body, user: {login: 'bot'}}
    }))

    await platform.createComment('octo', 'demo', 42, '一模一样的正文')
    const first = markerIn(lastSentBody())

    await platform.createComment('octo', 'demo', 42, '一模一样的正文')
    const second = markerIn(lastSentBody())

    expect(first).not.toBe('')
    expect(first).not.toBe(second)
  })

  test('剥离函数认得两个平台的 marker', () => {
    const gh = '<!-- ai-reviewer:github:write:5:note:0123456789abcdef -->'
    const gl = '<!-- ai-reviewer:gitlab:write:5:note:0123456789abcdef -->'

    expect(stripWriteMarkers(`正文\n\n${gh}`)).toBe('正文')
    expect(stripWriteMarkers(`正文\n\n${gl}`)).toBe('正文')
  })
})

/**
 * 其余 POST 写入路径（STATE-015 的完整范围）。
 *
 * 第一版只给顶层评论 `createComment` 上了幂等，其余四个 POST——createReview、
 * submitReview、createReviewComment、createReplyForReviewComment——仍是裸调用。
 * 服务端已写成功而响应丢失时，重试会多出**一整份 review**、一条重复行级评论或
 * 一条重复回复，比多一条顶层评论更醒目。
 */
describe('批量 review 写入幂等（createReview + submitReview）', () => {
  test('review body 带 marker，且关掉自动重试', async () => {
    await platform.submitReviewComments('octo', 'demo', 42, 'sha', [DRAFT], '审查汇总')

    const sent = bodyOf(pulls.createReview)
    expect(sent).toContain('审查汇总')
    expect(markerIn(sent)).not.toBe('')
    expect((pulls.createReview.mock.calls as any[][])[0][0].request).toEqual({retries: 0})
  })

  test('createReview 超时但服务端已建好 → 复用，不再建第二份 review', async () => {
    let sent = ''
    pulls.createReview.mockImplementation(async (p: any) => {
      sent = String(p.body)
      throw new Error('ECONNRESET')
    })
    pulls.listReviews.mockImplementation(async () => ({
      data: [{id: 900, body: sent, state: 'PENDING'}]
    }))

    await platform.submitReviewComments('octo', 'demo', 42, 'sha', [DRAFT], '审查汇总')

    expect(pulls.createReview).toHaveBeenCalledTimes(1)
    expect((pulls.submitReview.mock.calls as any[][])[0][0].review_id).toBe(900)
  })

  /**
   * submitReview 是第二个 POST。它自己的状态就是天然幂等依据：探测发现 review
   * 不再是 PENDING，说明上一次其实提交成功了，不该再提交一次。
   */
  test('createReview 已提交过 → 不重复 submit', async () => {
    let sent = ''
    pulls.createReview.mockImplementation(async (p: any) => {
      sent = String(p.body)
      throw new Error('ECONNRESET')
    })
    pulls.listReviews.mockImplementation(async () => ({
      data: [{id: 901, body: sent, state: 'COMMENTED'}]
    }))

    await platform.submitReviewComments('octo', 'demo', 42, 'sha', [DRAFT], '审查汇总')

    expect(pulls.submitReview).not.toHaveBeenCalled()
  })

  test('submitReview 超时但服务端已提交 → 不重发', async () => {
    pulls.submitReview.mockRejectedValue(new Error('ECONNRESET'))
    pulls.listReviews.mockImplementation(async () => ({
      data: [{id: 500, body: bodyOf(pulls.createReview), state: 'COMMENTED'}]
    }))

    await platform.submitReviewComments('octo', 'demo', 42, 'sha', [DRAFT], '审查汇总')

    expect(pulls.submitReview).toHaveBeenCalledTimes(1)
  })
})

describe('单条行级评论与回复的写入幂等', () => {
  test('createReviewComment：正文带 marker + 关自动重试', async () => {
    await platform.createReviewComment('octo', 'demo', 42, 'sha', DRAFT)

    const sent = bodyOf(pulls.createReviewComment)
    expect(sent).toContain('行级发现')
    expect(markerIn(sent)).not.toBe('')
    expect((pulls.createReviewComment.mock.calls as any[][])[0][0].request).toEqual({retries: 0})
  })

  test('createReviewComment：服务端已写但超时 → 不重发', async () => {
    let sent = ''
    pulls.createReviewComment.mockImplementation(async (p: any) => {
      sent = String(p.body)
      throw new Error('ECONNRESET')
    })
    pulls.listReviewComments.mockImplementation(async () => ({data: [{id: 1, body: sent}]}))

    await platform.createReviewComment('octo', 'demo', 42, 'sha', DRAFT)

    expect(pulls.createReviewComment).toHaveBeenCalledTimes(1)
  })

  test('replyToReviewComment：正文带 marker，超时后复用既有回复', async () => {
    let sent = ''
    pulls.createReplyForReviewComment.mockImplementation(async (p: any) => {
      sent = String(p.body)
      throw new Error('ECONNRESET')
    })
    pulls.listReviewComments.mockImplementation(async () => ({
      data: [{id: 321, body: sent, user: {login: 'bot'}}]
    }))

    const result = await platform.replyToReviewComment('octo', 'demo', 42, 99, '回复正文')

    expect(result.id).toBe(321)
    expect(pulls.createReplyForReviewComment).toHaveBeenCalledTimes(1)
    expect(markerIn(sent)).not.toBe('')
  })

  test('对照组：探测落空时正常重试', async () => {
    let attempts = 0
    pulls.createReviewComment.mockImplementation(async () => {
      attempts++
      if (attempts === 1) throw new Error('ECONNRESET')
      return {data: {id: 1}}
    })

    await platform.createReviewComment('octo', 'demo', 42, 'sha', DRAFT)

    expect(attempts).toBe(2)
  })

  test('行级评论读回时 marker 已剥离', async () => {
    pulls.listReviewComments.mockResolvedValue({
      data: [
        {
          id: 1,
          path: 'a.ts',
          line: 3,
          body: '行级发现\n\n<!-- ai-reviewer:github:write:42:review-comment:0123456789abcdef -->',
          user: {login: 'bot'}
        }
      ]
    })

    const list = await platform.listReviewComments('octo', 'demo', 42)

    expect(list[0].body).toBe('行级发现')
  })
})

/**
 * 探测必须翻页（STATE-015）。
 *
 * 第一版只取 `per_page: 100` 的第一页。评论超过 100 条的 PR 上，刚写进去的那条
 * 根本不在第一页，探测就误判「还没写」并重发——而「评论很多的 PR」恰恰是长期
 * 迭代、最容易触发重试的那种，幂等在最需要它的场景下失效。
 */
describe('探测跨页查找', () => {
  /** 造一页 100 条填充数据，第 n 页放入目标 */
  function pagedResponder(targetPage: number, makeHit: () => any) {
    return async (params: any) => {
      const page = Number(params.page ?? 1)
      if (page < targetPage) {
        return {
          data: Array.from({length: 100}, (_, i) => ({id: page * 1000 + i, body: '无关评论'}))
        }
      }
      if (page === targetPage) return {data: [makeHit()]}
      return {data: []}
    }
  }

  test('顶层评论：marker 在第二页也能命中，不重发', async () => {
    let sent = ''
    issues.createComment.mockImplementation(async (p: any) => {
      sent = String(p.body)
      throw new Error('ECONNRESET')
    })
    issues.listComments.mockImplementation(
      pagedResponder(2, () => ({id: 999, body: sent, user: {login: 'bot'}}))
    )

    const result = await platform.createComment('octo', 'demo', 42, '这是评论')

    expect(result.id).toBe(999)
    expect(issues.createComment).toHaveBeenCalledTimes(1)
    // 确实翻到了第二页
    expect((issues.listComments.mock.calls as any[][]).some(c => c[0].page === 2)).toBe(true)
  })

  test('行级评论：marker 在第二页也能命中', async () => {
    let sent = ''
    pulls.createReviewComment.mockImplementation(async (p: any) => {
      sent = String(p.body)
      throw new Error('ECONNRESET')
    })
    pulls.listReviewComments.mockImplementation(pagedResponder(2, () => ({id: 1, body: sent})))

    await platform.createReviewComment('octo', 'demo', 42, 'sha', DRAFT)

    expect(pulls.createReviewComment).toHaveBeenCalledTimes(1)
  })

  test('review：marker 在第二页也能命中', async () => {
    let sent = ''
    pulls.createReview.mockImplementation(async (p: any) => {
      sent = String(p.body)
      throw new Error('ECONNRESET')
    })
    pulls.listReviews.mockImplementation(
      pagedResponder(2, () => ({id: 902, body: sent, state: 'PENDING'}))
    )

    await platform.submitReviewComments('octo', 'demo', 42, 'sha', [DRAFT], '审查汇总')

    expect(pulls.createReview).toHaveBeenCalledTimes(1)
    expect((pulls.submitReview.mock.calls as any[][])[0][0].review_id).toBe(902)
  })

  test('不满一页就停下，不做无谓翻页', async () => {
    issues.createComment.mockRejectedValue(new Error('ECONNRESET'))
    issues.listComments.mockResolvedValue({data: [{id: 1, body: '无关'}]})

    await expect(platform.createComment('octo', 'demo', 42, '这是评论')).rejects.toThrow()

    // 每次重试各探测一次，每次只翻了第一页
    const pages = (issues.listComments.mock.calls as any[][]).map(c => c[0].page)
    expect(pages.every(p => p === 1)).toBe(true)
  })

  test('能指定顺序的端点按创建时间倒序取（自己刚写的通常就在第一页）', async () => {
    issues.createComment.mockResolvedValue({data: {id: 1, body: 'x', user: {login: 'bot'}}})
    await platform.createComment('octo', 'demo', 42, '这是评论')
    issues.createComment.mockRejectedValue(new Error('ECONNRESET'))
    issues.listComments.mockResolvedValue({data: []})

    await expect(platform.createComment('octo', 'demo', 42, '再来一条')).rejects.toThrow()

    const probe = (issues.listComments.mock.calls as any[][])[0][0]
    expect(probe.direction).toBe('desc')
  })
})
