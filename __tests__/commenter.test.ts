/**
 * commenter.test.ts — GitHub 评论功能行为基线（GH-006/007/008 + GH-011 分页缓存）
 *
 * `Commenter` 承载了 PR 顶层 summary 评论的查找/创建/更新、行级 review comment
 * 的缓冲与定位、以及 review comment 回复，但此前没有直接单元测试——只有
 * comment-chain-status / conversation 等用例顺带碰到它的查询方法。
 * 双平台改造要求这些行为在 GitHub 侧保持不变（TODO §1「不删功能」），
 * 这里把它们钉成基线。
 *
 * 分工：adapter 层（Octokit 调用、GraphQL resolve、分页）在 git-platform.test.ts
 * 与 resolve*.test.ts；本文件只覆盖 Commenter 自身的编排与去重逻辑。
 */
import {describe, expect, test, jest, beforeEach} from '@jest/globals'

// ─── Stub @actions/github（payload 需可变：comment() 按事件类型取 target）──────
const mockContext: any = {
  repo: {owner: 'o', repo: 'r'},
  payload: {}
}
jest.mock('@actions/github', () => ({context: mockContext}))

// ─── Stub logger ────────────────────────────────────────────────────────────
const logs = {
  info: jest.fn(),
  warning: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}
jest.mock('../src/platform/logger', () => ({getLogger: () => logs}))

// ─── Stub git platform ──────────────────────────────────────────────────────
const platform = {
  createComment: jest.fn<any>(),
  updateComment: jest.fn<any>(),
  deleteComment: jest.fn<any>(),
  listComments: jest.fn<any>(),
  listReviewComments: jest.fn<any>(),
  submitReviewComments: jest.fn<any>(),
  createReviewComment: jest.fn<any>(),
  deleteReviewComment: jest.fn<any>(),
  updateReviewComment: jest.fn<any>(),
  replyToReviewComment: jest.fn<any>(),
  deletePendingReview: jest.fn<any>()
}
jest.mock('../src/platform/git-platform', () => ({getPlatform: () => platform}))

import {Commenter, STATE_MARKERS, commentTag, commentReplyTag, summarizeTag} from '../src/commenter'

/** 平台返回的 issue comment 形状 */
function issueComment(id: number, body: string): any {
  return {id, body, author: 'ai-reviewer', createdAt: '2026-08-11T00:00:00Z'}
}

/** 平台返回的 review comment 形状 */
function reviewComment(id: number, path: string, line: number, body: string, startLine?: number) {
  return {
    id,
    body,
    path,
    line,
    startLine: startLine ?? null,
    originalLine: line,
    author: 'ai-reviewer',
    createdAt: '2026-08-11T00:00:00Z'
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockContext.payload = {pull_request: {number: 7}}
  platform.createComment.mockResolvedValue(issueComment(100, 'created'))
  platform.updateComment.mockResolvedValue(undefined)
  platform.deleteComment.mockResolvedValue(undefined)
  platform.listComments.mockResolvedValue([])
  platform.listReviewComments.mockResolvedValue([])
  platform.submitReviewComments.mockResolvedValue(1)
  platform.createReviewComment.mockResolvedValue(undefined)
  platform.deleteReviewComment.mockResolvedValue(undefined)
  platform.updateReviewComment.mockResolvedValue(undefined)
  platform.replyToReviewComment.mockResolvedValue(issueComment(200, 'reply'))
  platform.deletePendingReview.mockResolvedValue(undefined)
})

describe('GH-006: PR 顶层 summary 评论的查找、创建与更新', () => {
  test('mode=create → 直接创建，正文含问候语、消息与标签', async () => {
    await new Commenter().comment('summary body', summarizeTag(), 'create')

    expect(platform.createComment).toHaveBeenCalledTimes(1)
    const [owner, repo, target, body] = platform.createComment.mock.calls[0] as any[]
    expect([owner, repo, target]).toEqual(['o', 'r', 7])
    expect(body).toContain('summary body')
    expect(body).toContain(summarizeTag())
    expect(platform.updateComment).not.toHaveBeenCalled()
  })

  test('mode=replace 且已存在同标签评论 → 更新而非重复创建', async () => {
    platform.listComments.mockResolvedValue([
      issueComment(1, 'unrelated'),
      issueComment(2, `old summary\n\n${summarizeTag()}`)
    ])

    await new Commenter().comment('new summary', summarizeTag(), 'replace')

    expect(platform.updateComment).toHaveBeenCalledTimes(1)
    const [, , commentId, body] = platform.updateComment.mock.calls[0] as any[]
    expect(commentId).toBe(2)
    expect(body).toContain('new summary')
    expect(platform.createComment).not.toHaveBeenCalled()
  })

  test('mode=replace 但不存在同标签评论 → 退化为创建', async () => {
    platform.listComments.mockResolvedValue([issueComment(1, 'unrelated')])

    await new Commenter().comment('first summary', summarizeTag(), 'replace')

    expect(platform.createComment).toHaveBeenCalledTimes(1)
    expect(platform.updateComment).not.toHaveBeenCalled()
  })

  test('并发产生多条同标签评论 → 更新第一条并删除其余', async () => {
    platform.listComments.mockResolvedValue([
      issueComment(2, `dup A\n\n${summarizeTag()}`),
      issueComment(5, `dup B\n\n${summarizeTag()}`),
      issueComment(9, `dup C\n\n${summarizeTag()}`)
    ])

    await new Commenter().comment('merged summary', summarizeTag(), 'replace')

    expect((platform.updateComment.mock.calls[0] as any[])[2]).toBe(2)
    expect(platform.deleteComment.mock.calls.map((c: any[]) => c[2])).toEqual([5, 9])
  })

  test('删除重复评论失败 → 只 warning，不影响主流程', async () => {
    platform.listComments.mockResolvedValue([
      issueComment(2, summarizeTag()),
      issueComment(5, summarizeTag())
    ])
    platform.deleteComment.mockRejectedValue(new Error('403 Forbidden'))

    await expect(
      new Commenter().comment('merged', summarizeTag(), 'replace')
    ).resolves.toBeUndefined()
    expect(platform.updateComment).toHaveBeenCalledTimes(1)
    expect(logs.warning).toHaveBeenCalledWith(expect.stringContaining('Failed to delete duplicate'))
  })

  test('未知 mode → 按 replace 处理并 warning', async () => {
    platform.listComments.mockResolvedValue([issueComment(2, summarizeTag())])

    await new Commenter().comment('body', summarizeTag(), 'upsert')

    expect(logs.warning).toHaveBeenCalledWith(expect.stringContaining('Unknown mode: upsert'))
    expect(platform.updateComment).toHaveBeenCalledTimes(1)
  })

  test('空 tag → 回退到默认 commentTag()', async () => {
    await new Commenter().comment('body', '', 'create')

    const [, , , body] = platform.createComment.mock.calls[0] as any[]
    expect(body).toContain(commentTag())
  })

  test('issue 事件 → target 取 issue.number', async () => {
    mockContext.payload = {issue: {number: 33}}

    await new Commenter().comment('body', summarizeTag(), 'create')

    expect((platform.createComment.mock.calls[0] as any[])[2]).toBe(33)
  })

  test('payload 既无 pull_request 也无 issue → 跳过且不调用平台（fail closed）', async () => {
    mockContext.payload = {}

    await new Commenter().comment('body', summarizeTag(), 'create')

    expect(platform.createComment).not.toHaveBeenCalled()
    expect(platform.updateComment).not.toHaveBeenCalled()
    expect(logs.warning).toHaveBeenCalledWith(expect.stringContaining('Skipped'))
  })

  test('findCommentWithTag：命中返回评论，未命中返回 null', async () => {
    platform.listComments.mockResolvedValue([
      issueComment(1, 'noise'),
      issueComment(4, `x\n\n${summarizeTag()}`)
    ])
    const commenter = new Commenter()

    expect((await commenter.findCommentWithTag(summarizeTag(), 7))?.id).toBe(4)
    expect(await commenter.findCommentWithTag('<!-- absent -->', 7)).toBeNull()
  })

  test('平台 listComments 抛错 → 返回空列表并 warning，不向上抛', async () => {
    platform.listComments.mockRejectedValue(new Error('500'))

    await expect(new Commenter().listComments(7)).resolves.toEqual([])
    expect(logs.warning).toHaveBeenCalledWith(expect.stringContaining('Failed to list comments'))
  })
})

describe('GH-014: 迁移后的 marker 写新读旧', () => {
  test('replace 能命中历史格式的摘要评论（升级当天不重复发摘要）', async () => {
    platform.listComments.mockResolvedValue([
      issueComment(2, `旧摘要\n\n${STATE_MARKERS.summarize.legacy}`)
    ])

    await new Commenter().comment('新摘要', summarizeTag(), 'replace')

    expect(platform.updateComment).toHaveBeenCalledTimes(1)
    expect((platform.updateComment.mock.calls[0] as any[])[2]).toBe(2)
    expect(platform.createComment).not.toHaveBeenCalled()
    // 更新后的正文用新格式
    expect((platform.updateComment.mock.calls[0] as any[])[3]).toContain(summarizeTag())
  })

  test('findCommentWithTag 能命中历史格式', async () => {
    platform.listComments.mockResolvedValue([
      issueComment(4, `x\n\n${STATE_MARKERS.summarize.legacy}`)
    ])

    expect((await new Commenter().findCommentWithTag(summarizeTag(), 7))?.id).toBe(4)
  })

  test('行级评论去重能命中历史格式的 bot 评论（不重复发同位置评论）', async () => {
    platform.listReviewComments.mockResolvedValue([
      reviewComment(50, 'src/a.ts', 10, `旧发现\n\n${STATE_MARKERS.comment.legacy}`)
    ])
    const commenter = new Commenter()
    await commenter.bufferReviewComment('src/a.ts', 10, 10, 'same spot')

    await commenter.submitReview(7, 'sha1', 'status')

    expect(platform.submitReviewComments).not.toHaveBeenCalled()
  })

  test('回复历史格式的顶层评论 → 标签替换为历史回复格式，不混搭', async () => {
    const legacyTopLevel = {id: 900, body: `发现\n\n${STATE_MARKERS.comment.legacy}`}

    await new Commenter().reviewCommentReply(7, legacyTopLevel, 'answer')

    const [, , , newBody] = platform.updateReviewComment.mock.calls[0] as any[]
    expect(newBody).toContain(STATE_MARKERS.commentReply.legacy)
    expect(newBody).not.toContain(STATE_MARKERS.comment.legacy)
  })

  test('隐藏摘要区块：历史格式仍能被提取', () => {
    const commenter = new Commenter()
    const legacyBody = `${STATE_MARKERS.rawSummaryStart.legacy}raw content${STATE_MARKERS.rawSummaryEnd.legacy}`

    expect(commenter.getRawSummary(legacyBody)).toBe('raw content')
  })

  test('发布说明区块：历史格式仍能被移除，不残留在描述里', () => {
    const commenter = new Commenter()
    const legacyBody = `用户描述\n${STATE_MARKERS.descriptionStart.legacy}\nnotes\n${STATE_MARKERS.descriptionEnd.legacy}`

    const result = commenter.getDescription(legacyBody)
    expect(result).toContain('用户描述')
    expect(result).not.toContain('notes')
  })
})

describe('GH-011: Commenter 层的评论缓存', () => {
  test('listComments 结果按 target 缓存，第二次不再请求平台', async () => {
    platform.listComments.mockResolvedValue([issueComment(1, 'a')])
    const commenter = new Commenter()

    await commenter.listComments(7)
    await commenter.listComments(7)

    expect(platform.listComments).toHaveBeenCalledTimes(1)
  })

  test('新建评论写回缓存，后续查找无需再次请求平台', async () => {
    platform.listComments.mockResolvedValue([])
    platform.createComment.mockResolvedValue(issueComment(101, `fresh\n\n${summarizeTag()}`))
    const commenter = new Commenter()

    await commenter.comment('fresh', summarizeTag(), 'replace')
    const found = await commenter.findCommentWithTag(summarizeTag(), 7)

    expect(found?.id).toBe(101)
    expect(platform.listComments).toHaveBeenCalledTimes(1)
  })

  test('listReviewComments 同样按 target 缓存', async () => {
    platform.listReviewComments.mockResolvedValue([reviewComment(1, 'a.ts', 10, 'x')])
    const commenter = new Commenter()

    await commenter.listReviewComments(7)
    await commenter.listReviewComments(7)

    expect(platform.listReviewComments).toHaveBeenCalledTimes(1)
  })
})

describe('GH-014: 审查进度块（in-progress）写新读旧', () => {
  test('无进度块时插入新格式', () => {
    const result = new Commenter().addInProgressStatus('摘要正文', 'status')

    expect(result).toContain(STATE_MARKERS.inProgressStart.current())
    expect(result).toContain('摘要正文')
  })

  test('已有历史格式进度块 → 不重复插入', () => {
    const legacy = `${STATE_MARKERS.inProgressStart.legacy}\n进行中\n${STATE_MARKERS.inProgressEnd.legacy}\n\n摘要正文`

    expect(new Commenter().addInProgressStatus(legacy, 'status')).toBe(legacy)
  })

  test('已有新格式进度块 → 不重复插入', () => {
    const commenter = new Commenter()
    const once = commenter.addInProgressStatus('摘要正文', 'status')

    expect(commenter.addInProgressStatus(once, 'status')).toBe(once)
  })

  test('历史格式进度块可以被移除（否则旧进度块永远留在摘要里）', () => {
    const legacy = `${STATE_MARKERS.inProgressStart.legacy}\n进行中\n${STATE_MARKERS.inProgressEnd.legacy}\n\n摘要正文`

    const result = new Commenter().removeInProgressStatus(legacy)
    expect(result).not.toContain(STATE_MARKERS.inProgressStart.legacy)
    expect(result).toContain('摘要正文')
  })

  test('新格式进度块同样可以被移除', () => {
    const commenter = new Commenter()
    const withBlock = commenter.addInProgressStatus('摘要正文', 'status')

    const result = commenter.removeInProgressStatus(withBlock)
    expect(result).not.toContain(STATE_MARKERS.inProgressStart.current())
    expect(result).toContain('摘要正文')
  })
})

describe('GH-007: 行级 review comment 的缓冲、定位与提交', () => {
  test('缓冲区为空 → 不提交任何评论', async () => {
    await new Commenter().submitReview(7, 'sha1', 'status')

    expect(platform.submitReviewComments).not.toHaveBeenCalled()
    expect(platform.createReviewComment).not.toHaveBeenCalled()
  })

  test('单行评论 → draft 只带 line，不带 startLine/startSide', async () => {
    const commenter = new Commenter()
    await commenter.bufferReviewComment('src/a.ts', 10, 10, 'issue here')

    await commenter.submitReview(7, 'sha1', 'status')

    const [, , pullNumber, commitId, drafts] = platform.submitReviewComments.mock.calls[0] as any[]
    expect([pullNumber, commitId]).toEqual([7, 'sha1'])
    expect(drafts).toHaveLength(1)
    expect(drafts[0]).toMatchObject({path: 'src/a.ts', line: 10})
    expect(drafts[0].startLine).toBeUndefined()
    expect(drafts[0].startSide).toBeUndefined()
    expect(drafts[0].body).toContain('issue here')
  })

  test('多行评论 → draft 带 startLine 与 startSide=RIGHT', async () => {
    const commenter = new Commenter()
    await commenter.bufferReviewComment('src/a.ts', 10, 14, 'range issue')

    await commenter.submitReview(7, 'sha1', 'status')

    const drafts = (platform.submitReviewComments.mock.calls[0] as any[])[4]
    expect(drafts[0]).toMatchObject({line: 14, startLine: 10, startSide: 'RIGHT'})
  })

  test('提交前清理 PENDING 审查', async () => {
    const commenter = new Commenter()
    await commenter.bufferReviewComment('src/a.ts', 3, 3, 'msg')

    await commenter.submitReview(7, 'sha1', 'status')

    expect(platform.deletePendingReview).toHaveBeenCalledWith('o', 'r', 7)
  })

  test('同位置已有未 resolved 的 bot 评论 → 跳过，不重复发布', async () => {
    platform.listReviewComments.mockResolvedValue([
      reviewComment(50, 'src/a.ts', 10, `old finding\n\n${commentTag()}`)
    ])
    const commenter = new Commenter()
    await commenter.bufferReviewComment('src/a.ts', 10, 10, 'same spot')

    await commenter.submitReview(7, 'sha1', 'status')

    expect(platform.submitReviewComments).not.toHaveBeenCalled()
    expect(platform.deleteReviewComment).not.toHaveBeenCalled()
  })

  test('同位置旧评论已 resolved → 删除后重新发布', async () => {
    platform.listReviewComments.mockResolvedValue([
      reviewComment(50, 'src/a.ts', 10, `old finding\n\n${commentTag()}`)
    ])
    const commenter = new Commenter()
    await commenter.bufferReviewComment('src/a.ts', 10, 10, 'fresh finding')

    await commenter.submitReview(7, 'sha1', 'status', new Map([['src/a.ts:10', true]]))

    expect(platform.deleteReviewComment).toHaveBeenCalledWith('o', 'r', 50)
    expect(platform.submitReviewComments).toHaveBeenCalledTimes(1)
  })

  test('同位置存在的是用户评论（无 bot 标签）→ 照常发布', async () => {
    platform.listReviewComments.mockResolvedValue([
      reviewComment(50, 'src/a.ts', 10, 'human comment without tag')
    ])
    const commenter = new Commenter()
    await commenter.bufferReviewComment('src/a.ts', 10, 10, 'bot finding')

    await commenter.submitReview(7, 'sha1', 'status')

    expect(platform.submitReviewComments).toHaveBeenCalledTimes(1)
  })

  test('批量提交失败 → 降级为逐条创建', async () => {
    platform.submitReviewComments.mockRejectedValue(new Error('422 Unprocessable'))
    const commenter = new Commenter()
    await commenter.bufferReviewComment('src/a.ts', 1, 1, 'one')
    await commenter.bufferReviewComment('src/b.ts', 2, 2, 'two')

    await commenter.submitReview(7, 'sha1', 'status')

    expect(platform.createReviewComment).toHaveBeenCalledTimes(2)
    expect(logs.warning).toHaveBeenCalledWith(expect.stringContaining('Falling back'))
  })

  test('降级路径中单条失败 → 只 warning，其余继续', async () => {
    platform.submitReviewComments.mockRejectedValue(new Error('batch failed'))
    platform.createReviewComment
      .mockRejectedValueOnce(new Error('line not in diff'))
      .mockResolvedValue(undefined)
    const commenter = new Commenter()
    await commenter.bufferReviewComment('src/a.ts', 1, 1, 'one')
    await commenter.bufferReviewComment('src/b.ts', 2, 2, 'two')

    await expect(commenter.submitReview(7, 'sha1', 'status')).resolves.toBeUndefined()
    expect(platform.createReviewComment).toHaveBeenCalledTimes(2)
    expect(logs.warning).toHaveBeenCalledWith(
      expect.stringContaining('Failed to create review comment')
    )
  })
})

describe('GH-008: review comment 回复', () => {
  const topLevel = {id: 900, body: `bot finding\n\n${commentTag()}`}

  test('在顶层评论下创建回复，正文带回复标签', async () => {
    await new Commenter().reviewCommentReply(7, topLevel, 'answer text')

    expect(platform.replyToReviewComment).toHaveBeenCalledTimes(1)
    const [owner, repo, pullNumber, commentId, body] = platform.replyToReviewComment.mock
      .calls[0] as any[]
    expect([owner, repo, pullNumber, commentId]).toEqual(['o', 'r', 7, 900])
    expect(body).toContain('answer text')
    expect(body).toContain(commentReplyTag())
  })

  test('顶层评论含 commentTag() → 标签就地换成 commentReplyTag()', async () => {
    await new Commenter().reviewCommentReply(7, {...topLevel}, 'answer')

    const [, , commentId, newBody] = platform.updateReviewComment.mock.calls[0] as any[]
    expect(commentId).toBe(900)
    expect(newBody).toContain(commentReplyTag())
    expect(newBody).not.toContain(commentTag())
  })

  test('顶层评论不含 commentTag()（用户评论）→ 不改写其正文', async () => {
    await new Commenter().reviewCommentReply(7, {id: 901, body: 'user question'}, 'answer')

    expect(platform.updateReviewComment).not.toHaveBeenCalled()
  })

  test('回复失败 → 尝试发送错误说明；再次失败只 warning，不抛出', async () => {
    platform.replyToReviewComment
      .mockRejectedValueOnce(new Error('first failure'))
      .mockRejectedValueOnce(new Error('second failure'))

    await expect(
      new Commenter().reviewCommentReply(7, {...topLevel}, 'answer')
    ).resolves.toBeUndefined()
    expect(platform.replyToReviewComment).toHaveBeenCalledTimes(2)
    const [, , , , fallbackBody] = platform.replyToReviewComment.mock.calls[1] as any[]
    expect(fallbackBody).toContain('Could not post the reply')
  })

  test('改写顶层评论失败 → 只 warning，回复本身仍然成立', async () => {
    platform.updateReviewComment.mockRejectedValue(new Error('404'))

    await expect(
      new Commenter().reviewCommentReply(7, {...topLevel}, 'answer')
    ).resolves.toBeUndefined()
    expect(platform.replyToReviewComment).toHaveBeenCalledTimes(1)
    expect(logs.warning).toHaveBeenCalledWith(
      expect.stringContaining('Failed to update the top-level comment')
    )
  })
})
