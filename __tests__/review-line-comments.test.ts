/**
 * review-line-comments.test.ts — §8.3 行级问题（REVIEW-011~014）
 *
 * 两条主线：
 *
 * 1. **同位置去重不能误伤用户评论**。判定「这个位置已经有我们的评论了」原本只看
 *    marker，而用户引用回复会把 marker 一起复制过去。未 resolved 时会把本次发现
 *    当成重复丢掉；已 resolved 时更会把用户那条评论**删掉**。
 * 2. **发不出去的发现不能静默消失**。行号不在本次 diff 的可评论范围内时平台直接
 *    拒收（GitHub 422），原先只打一条 warning，发现就没了。
 */
import {describe, expect, test, jest, beforeEach} from '@jest/globals'

const BOT = 'ai-reviewer'

const platform: any = {
  listReviewComments: jest.fn<any>(),
  submitReviewComments: jest.fn<any>(),
  createReviewComment: jest.fn<any>(),
  deleteReviewComment: jest.fn<any>(),
  deletePendingReview: jest.fn<any>(),
  listComments: jest.fn<any>(),
  createComment: jest.fn<any>(),
  updateComment: jest.fn<any>(),
  deleteComment: jest.fn<any>(),
  getAuthenticatedLogin: jest.fn<any>()
}
jest.mock('../src/platform/git-platform', () => ({getPlatform: () => platform}))

const logs: string[] = []
jest.mock('../src/platform/logger', () => ({
  getLogger: () => ({
    info: (m: string) => logs.push(m),
    warning: (m: string) => logs.push(m),
    error: (m: string) => logs.push(m),
    debug: () => {}
  })
}))

import {Commenter, _resetBotIdentity, commentTag, initBotGreeting} from '../src/commenter'
import {setExecCtx} from '../src/platform/run-context'
import {setStateNamespace} from '../src/platform/state-namespace'
import {stateMarker} from '../src/state-markers'
import type {ExecutionContext, Platform} from '../src/platform/execution-context'

function useCtx(p: Platform = 'github'): void {
  setStateNamespace(p)
  setExecCtx({
    platform: p,
    projectPath: p === 'github' ? 'octo/demo' : 'group/demo',
    projectId: p === 'github' ? 'octo/demo' : 'group/demo',
    changeRequestId: 7,
    eventKind: 'pr_opened',
    actor: {login: 'alice', isBot: false},
    baseSha: 'b'.repeat(40),
    headSha: 'h'.repeat(40),
    raw: {}
  } as ExecutionContext)
}

/** 平台返回的行级评论形状（注意 Commenter 会把 author 映射到 user.login） */
function reviewComment(id: number, path: string, line: number, body: string, author = BOT): any {
  return {
    id,
    body,
    path,
    line,
    startLine: null,
    originalLine: line,
    author,
    createdAt: '2026-08-17T00:00:00Z'
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  logs.length = 0
  _resetBotIdentity()
  initBotGreeting('🤖', 'bot', BOT)
  useCtx()
  platform.listReviewComments.mockResolvedValue([])
  // 批量提交返回 {delivered, failed}（REVIEW-013/014）。
  // 返回旧形状（数字/undefined）会让 result.delivered.length 抛 TypeError，
  // 被生产代码的外层 catch 吞掉转去走逐条 fallback——测试照样绿，
  // 但验的是 fallback 路径，批量成功路径从没被覆盖。
  platform.submitReviewComments.mockImplementation(async (..._a: any[]) => ({
    delivered: [...((_a[4] ?? []) as any[])],
    failed: []
  }))
  platform.createReviewComment.mockResolvedValue(undefined)
  platform.deleteReviewComment.mockResolvedValue(undefined)
  platform.deletePendingReview.mockResolvedValue(undefined)
  platform.listComments.mockResolvedValue([])
  platform.createComment.mockResolvedValue({id: 1, body: '', author: BOT})
  platform.updateComment.mockResolvedValue(undefined)
  platform.deleteComment.mockResolvedValue(undefined)
  platform.getAuthenticatedLogin.mockResolvedValue(BOT)
})

/**
 * 批量成功路径必须真的被走到。
 *
 * 桩返回旧形状（数字/undefined）时，`result.delivered.length` 会抛 TypeError，
 * 被生产代码的外层 catch 吞掉并转去逐条 fallback——所有断言照样通过，验的却是
 * 另一条路径。这组用例把「批量成功时不该发生什么」钉死。
 */
describe('批量提交成功路径不得退化为逐条 fallback', () => {
  test('批量成功 → 不调用逐条创建，也不出现 fallback 日志', async () => {
    const commenter = new Commenter()
    await commenter.bufferReviewComment('src/a.ts', 10, 10, 'x')
    await commenter.submitReview(7, 'sha1', 'status')

    expect(platform.submitReviewComments).toHaveBeenCalled()
    expect(platform.createReviewComment).not.toHaveBeenCalled()
    expect(logs.join('\n')).not.toContain('Falling back to individual comments')
  })

  test('桩返回旧形状 → 确实会退化（说明上一条不是恒真）', async () => {
    platform.submitReviewComments.mockResolvedValue(1 as any)

    const commenter = new Commenter()
    await commenter.bufferReviewComment('src/a.ts', 10, 10, 'x')
    await commenter.submitReview(7, 'sha1', 'status')

    expect(platform.createReviewComment).toHaveBeenCalled()
    expect(logs.join('\n')).toContain('Falling back to individual comments')
  })
})

describe('REVIEW-011：行级评论发布到两个平台', () => {
  test.each<[Platform]>([['github'], ['gitlab']])('%s：缓冲的评论经统一接口提交', async p => {
    useCtx(p)
    const commenter = new Commenter()
    await commenter.bufferReviewComment('src/a.ts', 10, 12, '这里有问题')
    await commenter.submitReview(7, 'sha1', 'status')

    expect(platform.submitReviewComments).toHaveBeenCalled()
    const drafts = platform.submitReviewComments.mock.calls[0][4]
    expect(drafts[0].path).toBe('src/a.ts')
    expect(String(drafts[0].body)).toContain('这里有问题')
    // 带本平台命名空间的 marker，供下次去重识别
    expect(String(drafts[0].body)).toContain(`ai-reviewer:${p}:comment`)
  })

  test('没有缓冲评论 → 不发起空审查（平台不接受）', async () => {
    await new Commenter().submitReview(7, 'sha1', 'status')
    expect(platform.submitReviewComments).not.toHaveBeenCalled()
  })
})

describe('REVIEW-012：同位置未解决问题不重复发布', () => {
  test('同位置已有我们自己的未 resolved 评论 → 跳过', async () => {
    platform.listReviewComments.mockResolvedValue([
      reviewComment(50, 'src/a.ts', 10, `旧发现\n${commentTag()}`)
    ])
    const commenter = new Commenter()
    await commenter.bufferReviewComment('src/a.ts', 10, 10, '同一个位置')
    await commenter.submitReview(7, 'sha1', 'status')

    expect(platform.submitReviewComments).not.toHaveBeenCalled()
  })

  test('同位置只有用户评论（带 marker 的引用回复）→ 照常发布，不算重复', async () => {
    platform.listReviewComments.mockResolvedValue([
      reviewComment(60, 'src/a.ts', 10, `> 引用了机器人的话\n> ${commentTag()}`, 'alice')
    ])
    const commenter = new Commenter()
    await commenter.bufferReviewComment('src/a.ts', 10, 10, '新的发现')
    await commenter.submitReview(7, 'sha1', 'status')

    // 只按 marker 判定时，这条发现会被当成重复丢掉
    expect(platform.submitReviewComments).toHaveBeenCalled()
    expect(logs.join('\n')).toContain('authored by someone else')
  })

  test('同位置无任何评论 → 照常发布（对照组）', async () => {
    const commenter = new Commenter()
    await commenter.bufferReviewComment('src/a.ts', 10, 10, '新的发现')
    await commenter.submitReview(7, 'sha1', 'status')

    expect(platform.submitReviewComments).toHaveBeenCalled()
  })
})

describe('REVIEW-013：已解决的问题重新出现时按统一策略重发', () => {
  const resolvedMap = new Map<string, boolean>([['src/a.ts:10', true]])

  test('自己的旧评论已 resolved → 删除后重新发布', async () => {
    platform.listReviewComments.mockResolvedValue([
      reviewComment(50, 'src/a.ts', 10, `旧发现\n${commentTag()}`)
    ])
    const commenter = new Commenter()
    await commenter.bufferReviewComment('src/a.ts', 10, 10, '又出现了')
    await commenter.submitReview(7, 'sha1', 'status', resolvedMap)

    expect(platform.deleteReviewComment).toHaveBeenCalledWith('octo', 'demo', 50)
    expect(platform.submitReviewComments).toHaveBeenCalled()
  })

  test('已 resolved 的是用户评论 → 绝不删除', async () => {
    platform.listReviewComments.mockResolvedValue([
      reviewComment(60, 'src/a.ts', 10, `> ${commentTag()}`, 'alice')
    ])
    const commenter = new Commenter()
    await commenter.bufferReviewComment('src/a.ts', 10, 10, '又出现了')
    await commenter.submitReview(7, 'sha1', 'status', resolvedMap)

    expect(platform.deleteReviewComment).not.toHaveBeenCalled()
    expect(platform.submitReviewComments).toHaveBeenCalled()
  })

  test('身份未知 → 照常发布但绝不删除（重复可人工清理，删错找不回）', async () => {
    _resetBotIdentity()
    initBotGreeting('🤖', 'bot', '')
    platform.getAuthenticatedLogin.mockRejectedValue(new Error('401'))
    platform.listReviewComments.mockResolvedValue([
      reviewComment(50, 'src/a.ts', 10, `旧发现\n${commentTag()}`)
    ])

    const commenter = new Commenter()
    await commenter.bufferReviewComment('src/a.ts', 10, 10, '又出现了')
    await commenter.submitReview(7, 'sha1', 'status', resolvedMap)

    expect(platform.deleteReviewComment).not.toHaveBeenCalled()
    expect(platform.submitReviewComments).toHaveBeenCalled()
    expect(logs.join('\n')).toContain('without deduplication')
  })
})

describe('REVIEW-013：旧评论只能在新评论发布成功之后清理', () => {
  const resolvedMap = new Map<string, boolean>([['src/a.ts:10', true]])

  beforeEach(() => {
    platform.listReviewComments.mockResolvedValue([
      reviewComment(50, 'src/a.ts', 10, `旧发现\n${commentTag()}`)
    ])
  })

  test('批量发布成功 → 才删除被取代的旧评论', async () => {
    const commenter = new Commenter()
    await commenter.bufferReviewComment('src/a.ts', 10, 10, '又出现了')
    await commenter.submitReview(7, 'sha1', 'status', resolvedMap)

    expect(platform.submitReviewComments).toHaveBeenCalled()
    expect(platform.deleteReviewComment).toHaveBeenCalledWith('octo', 'demo', 50)
  })

  test('批量与逐条都失败 → 旧评论必须保留，历史和新发现不能一起丢', async () => {
    platform.submitReviewComments.mockRejectedValue(new Error('422 unprocessable'))
    platform.createReviewComment.mockRejectedValue(new Error('422 line not in diff'))

    const commenter = new Commenter()
    await commenter.bufferReviewComment('src/a.ts', 10, 10, '又出现了')
    await commenter.submitReview(7, 'sha1', 'status', resolvedMap)

    // 先删后发的写法会在这里把旧讨论弄丢，而新发现也没发出去
    expect(platform.deleteReviewComment).not.toHaveBeenCalled()
    // 新发现改走顶层降级，仍然可见
    const posted = platform.createComment.mock.calls.map((c: any[]) => String(c[3])).join('\n')
    expect(posted).toContain('又出现了')
  })

  test('批量失败但逐条成功 → 旧评论照常清理', async () => {
    platform.submitReviewComments.mockRejectedValue(new Error('boom'))
    platform.createReviewComment.mockResolvedValue(undefined)

    const commenter = new Commenter()
    await commenter.bufferReviewComment('src/a.ts', 10, 10, '又出现了')
    await commenter.submitReview(7, 'sha1', 'status', resolvedMap)

    expect(platform.deleteReviewComment).toHaveBeenCalledWith('octo', 'demo', 50)
  })
})

describe('REVIEW-014：行号映射失败时降级到顶层评论', () => {
  beforeEach(() => {
    // 批量提交失败 → 走逐条降级路径
    platform.submitReviewComments.mockRejectedValue(new Error('422 unprocessable'))
  })

  test('逐条也发不出去 → 内容进顶层评论，不静默丢弃', async () => {
    platform.createReviewComment.mockRejectedValue(new Error('422 line must be part of the diff'))
    const commenter = new Commenter()
    await commenter.bufferReviewComment('src/a.ts', 10, 12, '这条挂不上去')
    await commenter.submitReview(7, 'sha1', 'status')

    const posted = platform.createComment.mock.calls
      .concat(platform.updateComment.mock.calls)
      .map((c: any[]) => String(c[3]))
      .join('\n')

    expect(posted).toContain('src/a.ts:10-12')
    expect(posted).toContain('这条挂不上去')
    expect(posted).toContain('无法作为行级评论发布')
  })

  test('单行位置的展示不带多余的范围写法', async () => {
    platform.createReviewComment.mockRejectedValue(new Error('422'))
    const commenter = new Commenter()
    await commenter.bufferReviewComment('src/a.ts', 10, 10, '单行')
    await commenter.submitReview(7, 'sha1', 'status')

    const posted = platform.createComment.mock.calls.map((c: any[]) => String(c[3])).join('\n')
    expect(posted).toContain('src/a.ts:10')
    expect(posted).not.toContain('src/a.ts:10-10')
  })

  test('降级评论用 replace 模式，多次审查不会堆积', async () => {
    platform.createReviewComment.mockRejectedValue(new Error('422'))
    const commenter = new Commenter()
    await commenter.bufferReviewComment('src/a.ts', 10, 10, 'x')
    await commenter.submitReview(7, 'sha1', 'status')

    const posted = platform.createComment.mock.calls.map((c: any[]) => String(c[3])).join('\n')
    expect(posted).toContain(stateMarker('undeliverableFindings'))
  })

  test('顶层降级也失败 → 如实报告彻底丢失，并把内容写进日志', async () => {
    platform.createReviewComment.mockRejectedValue(new Error('422'))
    // 顶层评论同样发不出去：comment() 内部会吞异常，所以必须靠返回值判断
    platform.listComments.mockResolvedValue([])
    platform.createComment.mockRejectedValue(new Error('403 forbidden'))

    const commenter = new Commenter()
    await commenter.bufferReviewComment('src/a.ts', 10, 10, '两层都发不出去')
    await commenter.submitReview(7, 'sha1', 'status')

    const text = logs.join('\n')
    expect(text).toContain('NOT visible on the pull request')
    expect(text).toContain('两层都发不出去') // 内容至少能从日志捞回来
    expect(text).not.toContain('posted 1 undeliverable') // 不能谎报成功
  })

  test('逐条能发出去 → 不产生降级评论（对照组）', async () => {
    platform.createReviewComment.mockResolvedValue(undefined)
    const commenter = new Commenter()
    await commenter.bufferReviewComment('src/a.ts', 10, 10, 'x')
    await commenter.submitReview(7, 'sha1', 'status')

    const posted = platform.createComment.mock.calls.map((c: any[]) => String(c[3])).join('\n')
    expect(posted).not.toContain('无法作为行级评论发布')
  })

  test('部分成功部分失败 → 只把失败的那条降级', async () => {
    platform.createReviewComment.mockImplementation(
      async (_o: any, _r: any, _n: any, _c: any, draft: any) => {
        if (String(draft.body).includes('挂不上')) throw new Error('422')
      }
    )
    const commenter = new Commenter()
    await commenter.bufferReviewComment('src/a.ts', 10, 10, '能挂上')
    await commenter.bufferReviewComment('src/b.ts', 20, 20, '挂不上')
    await commenter.submitReview(7, 'sha1', 'status')

    const posted = platform.createComment.mock.calls.map((c: any[]) => String(c[3])).join('\n')
    expect(posted).toContain('src/b.ts:20')
    expect(posted).not.toContain('src/a.ts:10')
  })
})

/**
 * GitLab 没有批量 review 的概念，adapter 内部逐条创建 discussion。
 *
 * 早先它只回一个「成功几条」的数字，调用方无从知道**哪几条**没发出去：于是会把
 * 那些位置上被取代的 resolved 旧讨论一并删掉——新发现没发成、历史也没了，而且
 * 失败项也不会进顶层降级。接口改为返回 delivered/failed 两个清单后，这里钉住
 * 调用方对「部分成功」的处理。
 */
describe('部分提交失败时的清理与降级（GitLab 逐条提交的形态）', () => {
  const resolvedMap = new Map<string, boolean>([
    ['src/a.ts:10', true],
    ['src/b.ts:20', true]
  ])

  beforeEach(() => {
    platform.listReviewComments.mockResolvedValue([
      reviewComment(50, 'src/a.ts', 10, `旧发现 A\n${commentTag()}`),
      reviewComment(51, 'src/b.ts', 20, `旧发现 B\n${commentTag()}`)
    ])
  })

  test('部分成功 → 只清理投递成功那条的旧评论', async () => {
    platform.submitReviewComments.mockImplementation(async (..._a: any[]) => ({
      delivered: [{path: 'src/a.ts', line: 10, body: 'x'}],
      failed: [{path: 'src/b.ts', line: 20, body: 'y'}]
    }))

    const commenter = new Commenter()
    await commenter.bufferReviewComment('src/a.ts', 10, 10, '新发现 A')
    await commenter.bufferReviewComment('src/b.ts', 20, 20, '新发现 B')
    await commenter.submitReview(7, 'sha1', 'status', resolvedMap)

    const deleted = platform.deleteReviewComment.mock.calls.map((c: any[]) => c[2])
    expect(deleted).toContain(50) // A 发出去了，旧的可以清
    expect(deleted).not.toContain(51) // B 没发出去，旧讨论必须留着
  })

  test('部分失败 → 失败项走统一顶层降级，不静默丢弃', async () => {
    platform.submitReviewComments.mockImplementation(async (..._a: any[]) => ({
      delivered: [{path: 'src/a.ts', line: 10, body: 'x'}],
      failed: [{path: 'src/b.ts', line: 20, body: 'y'}]
    }))

    const commenter = new Commenter()
    await commenter.bufferReviewComment('src/a.ts', 10, 10, '新发现 A')
    await commenter.bufferReviewComment('src/b.ts', 20, 20, '新发现 B')
    await commenter.submitReview(7, 'sha1', 'status', resolvedMap)

    const posted = platform.createComment.mock.calls
      .concat(platform.updateComment.mock.calls)
      .map((c: any[]) => String(c[3]))
      .join('\n')
    expect(posted).toContain('src/b.ts:20')
    expect(posted).toContain('新发现 B')
    expect(posted).not.toContain('新发现 A') // 成功的那条不该出现在降级里
  })

  test('全部成功 → 两条旧评论都清理，不产生降级评论（对照组）', async () => {
    platform.submitReviewComments.mockImplementation(async (..._a: any[]) => ({
      delivered: [
        {path: 'src/a.ts', line: 10, body: 'x'},
        {path: 'src/b.ts', line: 20, body: 'y'}
      ],
      failed: []
    }))

    const commenter = new Commenter()
    await commenter.bufferReviewComment('src/a.ts', 10, 10, '新发现 A')
    await commenter.bufferReviewComment('src/b.ts', 20, 20, '新发现 B')
    await commenter.submitReview(7, 'sha1', 'status', resolvedMap)

    const deleted = platform.deleteReviewComment.mock.calls.map((c: any[]) => c[2])
    expect(deleted).toEqual(expect.arrayContaining([50, 51]))
    const posted = platform.createComment.mock.calls.map((c: any[]) => String(c[3])).join('\n')
    expect(posted).not.toContain('无法作为行级评论发布')
  })

  test('多行范围的失败项也能对回本地缓冲（draftKey 与 commentKey 必须一致）', async () => {
    platform.listReviewComments.mockResolvedValue([])
    platform.submitReviewComments.mockImplementation(async (..._a: any[]) => ({
      delivered: [],
      failed: [{path: 'src/c.ts', line: 30, startLine: 28, body: 'z'}]
    }))

    const commenter = new Commenter()
    await commenter.bufferReviewComment('src/c.ts', 28, 30, '跨行发现')
    await commenter.submitReview(7, 'sha1', 'status')

    const posted = platform.createComment.mock.calls.map((c: any[]) => String(c[3])).join('\n')
    expect(posted).toContain('src/c.ts:28-30')
    expect(posted).toContain('跨行发现')
  })
})
