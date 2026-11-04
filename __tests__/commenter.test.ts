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

// ─── 执行上下文（ARCH-005：Commenter 不再读 @actions/github）────────────────
// 迁移前这里 stub 的是 `@actions/github` 的 context——那正是让 GitLab 入口
// 在模块加载期就崩掉的依赖，也正因为被 mock 掉，旧用例完全看不到这个问题。
import {setExecCtx, resetExecCtx} from '../src/platform/run-context'
import type {ExecutionContext} from '../src/platform/execution-context'

function execCtx(over: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    platform: 'github',
    projectPath: 'o/r',
    projectId: 'o/r',
    changeRequestId: 7,
    eventKind: 'pr_opened',
    actor: {login: 'someone', isBot: false},
    baseSha: 'base',
    headSha: 'head',
    raw: {},
    ...over
  } as ExecutionContext
}

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
  deletePendingReview: jest.fn<any>(),
  // REVIEW-008：定位既有评论要校验作者，桩必须能回答「我是谁」
  getAuthenticatedLogin: jest.fn<any>(async () => 'ai-reviewer')
}
jest.mock('../src/platform/git-platform', () => ({getPlatform: () => platform}))

import {
  Commenter,
  STATE_MARKERS,
  _resetBotIdentity,
  isCurrentAuthor,
  isOwnAuthor,
  sameLogin,
  setPreviousBotLogins,
  commentTag,
  commentReplyTag,
  summarizeTag
} from '../src/commenter'

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
  resetExecCtx()
  _resetBotIdentity()
  setExecCtx(execCtx({changeRequestId: 7}))
  platform.createComment.mockResolvedValue(issueComment(100, 'created'))
  platform.updateComment.mockResolvedValue(undefined)
  platform.deleteComment.mockResolvedValue(undefined)
  platform.listComments.mockResolvedValue([])
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

    // comment() 现在返回投递结果（REVIEW-014 需要它来判断降级是否真的落地）；
    // 删重复失败不影响主评论已成功更新
    await expect(new Commenter().comment('merged', summarizeTag(), 'replace')).resolves.toBe(true)
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

  test('顶层评论事件 → target 取归一化后的 changeRequestId', async () => {
    setExecCtx(execCtx({changeRequestId: 33, eventKind: 'comment_created'}))

    await new Commenter().comment('body', summarizeTag(), 'create')

    expect((platform.createComment.mock.calls[0] as any[])[2]).toBe(33)
  })

  test('上下文没有 change request id → 跳过且不调用平台（fail closed）', async () => {
    setExecCtx(execCtx({changeRequestId: 0}))

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

  // 回归（FT-055 / FT-092）：位置不同（旧 5-10、新 1-17）但讲的是同一个问题，不能重复发布。
  test('行范围不同但内容是同一问题（已有未解决评论）→ 整条跳过', async () => {
    platform.listReviewComments.mockResolvedValue([
      reviewComment(
        50,
        'src/a.ts',
        10,
        `\`loadAll\` 返回 \`Promise<unknown>[]\`，应使用 \`Promise.all\`。\n\n${commentTag()}`,
        5
      )
    ])
    const commenter = new Commenter()
    await commenter.bufferReviewComment(
      'src/a.ts',
      1,
      17,
      '🦉 CodeSentinel\n\n`loadAll` 没有等待请求，应当用 `Promise.all` 汇总。'
    )

    await commenter.submitReview(7, 'sha1', 'status')

    expect(platform.submitReviewComments).not.toHaveBeenCalled()
  })

  test('合并评论里只有一部分是已报告过的 → 去掉那一部分，其余照常发布', async () => {
    platform.listReviewComments.mockResolvedValue([
      reviewComment(
        50,
        'src/a.ts',
        10,
        `\`loadAll\` 返回 \`Promise<unknown>[]\`，应使用 \`Promise.all\`。\n\n${commentTag()}`,
        5
      )
    ])
    const commenter = new Commenter()
    await commenter.bufferReviewComment(
      'src/a.ts',
      1,
      17,
      '🦉 CodeSentinel\n\n`loadAll` 应当用 `Promise.all`。\n\n---\n\n`findUser` 直接拼接 SQL，存在注入风险。'
    )

    await commenter.submitReview(7, 'sha1', 'status')

    const drafts = (platform.submitReviewComments.mock.calls[0] as any[])[4]
    expect(drafts).toHaveLength(1)
    expect(drafts[0].body).toContain('findUser')
    expect(drafts[0].body).not.toContain('loadAll')
  })

  test('同文件但内容是另一个问题 → 照常发布', async () => {
    platform.listReviewComments.mockResolvedValue([
      reviewComment(
        50,
        'src/a.ts',
        10,
        `\`loadAll\` 应使用 \`Promise.all\`。\n\n${commentTag()}`,
        5
      )
    ])
    const commenter = new Commenter()
    await commenter.bufferReviewComment(
      'src/a.ts',
      1,
      17,
      '`findUser` 直接拼接 SQL，存在注入风险。'
    )

    await commenter.submitReview(7, 'sha1', 'status')

    expect(platform.submitReviewComments).toHaveBeenCalledTimes(1)
  })

  test('已有的是 resolved 的评论 → 不据此去重', async () => {
    platform.listReviewComments.mockResolvedValue([
      reviewComment(
        50,
        'src/a.ts',
        10,
        `\`loadAll\` 应使用 \`Promise.all\`。\n\n${commentTag()}`,
        5
      )
    ])
    const commenter = new Commenter()
    await commenter.bufferReviewComment(
      'src/a.ts',
      1,
      17,
      '`loadAll` 又出现了，仍应用 `Promise.all`。'
    )

    await commenter.submitReview(7, 'sha1', 'status', new Map([['src/a.ts:10', true]]))

    expect(platform.submitReviewComments).toHaveBeenCalledTimes(1)
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

describe('旧 bot 账号只读认领（换 token 后 bot 账号变了）', () => {
  // 当前身份是 ai-reviewer（见 platform.getAuthenticatedLogin 桩），old-bot 是换号前的账号
  const by = (author: string, c: any): any => ({...c, author})

  beforeEach(() => {
    setPreviousBotLogins(['Old-Bot'])
  })

  test('isOwnAuthor 认领旧账号（不区分大小写），isCurrentAuthor 不认', async () => {
    expect(await isOwnAuthor('old-bot')).toBe(true)
    expect(await isCurrentAuthor('old-bot')).toBe(false)
    expect(await isOwnAuthor('ai-reviewer')).toBe(true)
    expect(await isCurrentAuthor('ai-reviewer')).toBe(true)
    expect(await isOwnAuthor('alice')).toBe(false)
  })

  test('没配置时旧账号不算自己（行为不变）', async () => {
    setPreviousBotLogins([])
    expect(await isOwnAuthor('old-bot')).toBe(false)
  })

  test('findCommentWithTag：只有旧账号的摘要 → 读它恢复状态（增量审查起点不丢）', async () => {
    platform.listComments.mockResolvedValue([
      by('old-bot', issueComment(4, `old\n\n${summarizeTag()}`))
    ])
    expect((await new Commenter().findCommentWithTag(summarizeTag(), 7))?.id).toBe(4)
  })

  test('findCommentWithTag：新旧摘要并存 → 当前身份的优先，即使旧的排在前面', async () => {
    platform.listComments.mockResolvedValue([
      by('old-bot', issueComment(4, `old\n\n${summarizeTag()}`)),
      issueComment(9, `new\n\n${summarizeTag()}`)
    ])
    expect((await new Commenter().findCommentWithTag(summarizeTag(), 7))?.id).toBe(9)
  })

  test('findCommentWithTag：用户引用回复里的 marker 仍不认领', async () => {
    platform.listComments.mockResolvedValue([
      by('alice', issueComment(3, `> quoted\n\n${summarizeTag()}`))
    ])
    expect(await new Commenter().findCommentWithTag(summarizeTag(), 7)).toBeNull()
  })

  test('replace：只有旧账号的摘要 → 新发一条，不更新也不删除旧的', async () => {
    platform.listComments.mockResolvedValue([
      by('old-bot', issueComment(4, `old\n\n${summarizeTag()}`))
    ])

    await new Commenter().comment('new summary', summarizeTag(), 'replace')

    expect(platform.createComment).toHaveBeenCalledTimes(1)
    expect(platform.updateComment).not.toHaveBeenCalled()
    expect(platform.deleteComment).not.toHaveBeenCalled()
    expect(logs.info).toHaveBeenCalledWith(
      expect.stringContaining('from a previous bot account untouched')
    )
  })

  test('replace：新旧摘要并存 → 只更新当前身份的那条，旧的保留', async () => {
    platform.listComments.mockResolvedValue([
      by('old-bot', issueComment(4, `old\n\n${summarizeTag()}`)),
      issueComment(9, `new\n\n${summarizeTag()}`)
    ])

    await new Commenter().comment('newer summary', summarizeTag(), 'replace')

    expect(platform.updateComment).toHaveBeenCalledTimes(1)
    expect((platform.updateComment.mock.calls[0] as any[])[2]).toBe(9)
    expect(platform.deleteComment).not.toHaveBeenCalled()
  })

  test('submitReview：同位置有旧账号的未 resolved 评论 → 视为已覆盖，不重复发布', async () => {
    platform.listReviewComments.mockResolvedValue([
      by('old-bot', reviewComment(50, 'src/a.ts', 10, `old finding\n\n${commentTag()}`))
    ])
    const commenter = new Commenter()
    await commenter.bufferReviewComment('src/a.ts', 10, 10, 'same spot')

    await commenter.submitReview(7, 'sha1', 'status')

    expect(platform.submitReviewComments).not.toHaveBeenCalled()
  })

  test('submitReview：旧账号的评论已 resolved → 发布新发现，但不删除旧评论', async () => {
    platform.listReviewComments.mockResolvedValue([
      by('old-bot', reviewComment(50, 'src/a.ts', 10, `old finding\n\n${commentTag()}`))
    ])
    const commenter = new Commenter()
    await commenter.bufferReviewComment('src/a.ts', 10, 10, 'fresh finding')

    await commenter.submitReview(7, 'sha1', 'status', new Map([['src/a.ts:10', true]]))

    expect(platform.submitReviewComments).toHaveBeenCalledTimes(1)
    expect(platform.deleteReviewComment).not.toHaveBeenCalled()
  })

  test('initBotGreeting 不会清掉已设置的旧账号', async () => {
    const {initBotGreeting} = await import('../src/commenter')
    initBotGreeting('🦉', 'CodeSentinel', '')
    expect(await isOwnAuthor('old-bot')).toBe(true)
  })
})

describe('bot 登录名的 [bot] 后缀：摘要必须原地更新（摘要排在审查之后的根因回归）', () => {
  // 复现线上现象：GITHUB_TOKEN 调不了 GET /user，平台层回退成不带后缀的登录名，
  // 而 REST 里评论作者的真实登录名是 `github-actions[bot]`。此前两者精确比较，
  // 机器人把自己的摘要当成「别人的引用回复」，永远新发一条，旧的「审查中」留在原处。
  const actions = (id: number, body: string): any => ({
    ...issueComment(id, body),
    author: 'github-actions[bot]'
  })

  describe('sameLogin', () => {
    test.each([
      ['github-actions[bot]', 'github-actions', true],
      ['github-actions[bot]', 'github-actions[bot]', true],
      ['GitHub-Actions[bot]', 'github-actions', true],
      ['my-app[bot]', 'my-app', true],
      ['ai-reviewer', 'ai-reviewer', true]
    ])('作者 %s / 身份 %s → %s', (author, bot, expected) => {
      expect(sameLogin(author, bot)).toBe(expected)
    })

    test.each([
      // 同名真人：用户名不可能带方括号，作者不带后缀就不是机器人
      ['github-actions', 'github-actions[bot]'],
      ['alice', 'github-actions'],
      ['other-app[bot]', 'github-actions'],
      ['github-actions-evil[bot]', 'github-actions'],
      ['', 'github-actions'],
      ['github-actions[bot]', '']
    ])('作者 %j / 身份 %j → 不相等', (author, bot) => {
      expect(sameLogin(author, bot)).toBe(false)
    })
  })

  test('回退值不带后缀（旧行为）+ 作者带 [bot] → 原地更新，不再新发', async () => {
    platform.getAuthenticatedLogin.mockResolvedValueOnce('github-actions')
    platform.listComments.mockResolvedValue([actions(2, `in progress\n\n${summarizeTag()}`)])

    await new Commenter().comment('final summary', summarizeTag(), 'replace')

    expect(platform.updateComment).toHaveBeenCalledTimes(1)
    expect((platform.updateComment.mock.calls[0] as any[])[2]).toBe(2)
    expect(platform.createComment).not.toHaveBeenCalled()
  })

  test('回退值带后缀（修复后的平台层）+ 作者带 [bot] → 原地更新', async () => {
    platform.getAuthenticatedLogin.mockResolvedValueOnce('github-actions[bot]')
    platform.listComments.mockResolvedValue([actions(2, `in progress\n\n${summarizeTag()}`)])

    await new Commenter().comment('final summary', summarizeTag(), 'replace')

    expect(platform.updateComment).toHaveBeenCalledTimes(1)
    expect(platform.createComment).not.toHaveBeenCalled()
  })

  test('真人引用回复仍然不会被覆盖（防护没有被放宽）', async () => {
    platform.getAuthenticatedLogin.mockResolvedValueOnce('github-actions[bot]')
    platform.listComments.mockResolvedValue([
      {...issueComment(3, `quoted\n\n${summarizeTag()}`), author: 'alice'},
      {...issueComment(4, `quoted\n\n${summarizeTag()}`), author: 'github-actions'}
    ])

    await new Commenter().comment('final summary', summarizeTag(), 'replace')

    expect(platform.updateComment).not.toHaveBeenCalled()
    expect(platform.deleteComment).not.toHaveBeenCalled()
    expect(platform.createComment).toHaveBeenCalledTimes(1)
  })

  test('isOwnAuthor / isCurrentAuthor 同样认带后缀的机器人作者', async () => {
    platform.getAuthenticatedLogin.mockResolvedValueOnce('github-actions')
    expect(await isOwnAuthor('github-actions[bot]')).toBe(true)
    expect(await isCurrentAuthor('github-actions[bot]')).toBe(true)
    expect(await isOwnAuthor('alice')).toBe(false)
  })

  test('旧账号认领同样不受后缀影响', async () => {
    setPreviousBotLogins(['old-app'])
    expect(await isOwnAuthor('old-app[bot]')).toBe(true)
    expect(await isCurrentAuthor('old-app[bot]')).toBe(false)
  })

  test('身份来自写响应：回退值猜错（App 令牌）时，同一次运行里摘要仍原地更新', async () => {
    // 平台层给了个完全对不上的回退值；真实作者要等第一次写成功才知道
    platform.getAuthenticatedLogin.mockResolvedValueOnce('github-actions[bot]')
    platform.createComment.mockImplementation(async (_o: any, _r: any, _t: any, body: string) => ({
      ...issueComment(100, body),
      author: 'my-app[bot]'
    }))
    const c = new Commenter()

    await c.comment('审查中', summarizeTag(), 'replace') // 第一次：没有既有评论 → 创建
    await c.comment('final summary', summarizeTag(), 'replace') // 第二次：必须找到刚创建的

    expect(platform.createComment).toHaveBeenCalledTimes(1)
    expect(platform.updateComment).toHaveBeenCalledTimes(1)
    expect((platform.updateComment.mock.calls[0] as any[])[2]).toBe(100)
    expect(
      (logs.info.mock.calls as any[][]).some(c => String(c[0]).includes('corrected from own write'))
    ).toBe(true)
  })

  test('显式配置的身份不会被写响应覆盖', async () => {
    const {initBotGreeting} = await import('../src/commenter')
    initBotGreeting('🤖', 'Bot', 'configured-bot')
    platform.createComment.mockImplementation(async (_o: any, _r: any, _t: any, body: string) => ({
      ...issueComment(100, body),
      author: 'someone-else[bot]'
    }))

    await new Commenter().comment('x', summarizeTag(), 'create')

    expect(await isCurrentAuthor('configured-bot')).toBe(true)
    expect(await isCurrentAuthor('someone-else[bot]')).toBe(false)
  })

  test('机器人账号带着我们的 marker 却对不上身份 → warning，而不是悄悄当成「引用回复」', async () => {
    platform.getAuthenticatedLogin.mockResolvedValueOnce('configured-elsewhere')
    platform.listComments.mockResolvedValue([
      {...issueComment(7, `x\n\n${summarizeTag()}`), author: 'other-app[bot]'}
    ])

    await new Commenter().comment('final summary', summarizeTag(), 'replace')

    const warned = (logs.warning.mock.calls as any[][]).map(c => String(c[0])).join('\n')
    expect(warned).toContain('other-app[bot]')
    expect(warned).toContain('do not match the resolved bot identity')
  })

  test('真人引用回复只有 info，不产生这条 warning', async () => {
    platform.getAuthenticatedLogin.mockResolvedValueOnce('github-actions[bot]')
    platform.listComments.mockResolvedValue([
      {...issueComment(7, `quoted\n\n${summarizeTag()}`), author: 'alice'}
    ])

    await new Commenter().comment('final summary', summarizeTag(), 'replace')

    const warned = (logs.warning.mock.calls as any[][]).map(c => String(c[0])).join('\n')
    expect(warned).not.toContain('do not match the resolved bot identity')
  })
})
