/**
 * review-summary.test.ts — §8.2 摘要（REVIEW-007/008/009/010）
 *
 * 重点在 REVIEW-008「更新既有摘要而不是重复发布」。定位既有摘要靠的是正文里的
 * marker，而 GitHub/GitLab 的「引用回复」会把整段正文连同 marker 一起复制到用户
 * 自己的评论里。不校验作者的话，那条用户评论会被当成我们的摘要：轻则被覆盖，
 * 重则被当作重复项删除，而且 findCommentWithTag 还会从中读出过期的 reviewed
 * SHA，把增量审查的起点带偏。
 */
import {describe, expect, test, jest, beforeEach} from '@jest/globals'

jest.mock('../src/tokenizer', () => ({getTokenCount: () => 10}))
jest.mock('../src/github/review-thread', () => ({
  fetchThreadStatusMap: jest.fn<any>().mockResolvedValue(new Map())
}))

const BOT = 'ai-reviewer'

const platformState: any = {
  getChangeRequest: jest.fn<any>(),
  compareDiff: jest.fn<any>(),
  getFileContent: jest.fn<any>(),
  listRepositoryTree: jest.fn<any>(),
  listComments: jest.fn<any>(),
  listReviewComments: jest.fn<any>(),
  createComment: jest.fn<any>(),
  updateComment: jest.fn<any>(),
  deleteComment: jest.fn<any>(),
  listChangeRequestCommits: jest.fn<any>(),
  submitReviewComments: jest.fn<any>(),
  updateChangeRequestBody: jest.fn<any>(),
  deletePendingReview: jest.fn<any>(),
  getAuthenticatedLogin: jest.fn<any>()
}
jest.mock('../src/platform/git-platform', () => ({getPlatform: () => platformState}))

const logs: string[] = []
jest.mock('../src/platform/logger', () => ({
  getLogger: () => ({
    info: (m: string) => logs.push(m),
    warning: (m: string) => logs.push(m),
    error: (m: string) => logs.push(m),
    debug: () => {}
  })
}))

import {codeReview} from '../src/review'
import {Commenter, _resetBotIdentity, initBotGreeting, summarizeTag} from '../src/commenter'
import {setExecCtx} from '../src/platform/run-context'
import {setStateNamespace} from '../src/platform/state-namespace'
import {stateMarker} from '../src/state-markers'
import {Prompts} from '../src/prompts'
import type {Platform} from '../src/platform/execution-context'

const BASE = 'b'.repeat(40)
const HEAD = 'h'.repeat(40)

function makeBot(): any {
  return {chat: jest.fn<any>(async () => ['[TRIAGE]: APPROVED\nLGTM', {}, []])}
}

function makeOptions(over: Record<string, any> = {}): any {
  const limits = {
    requestTokens: 100000,
    responseTokens: 1000,
    maxTokens: 101000,
    knowledgeCutOff: ''
  }
  return {
    debug: false,
    disableReview: false,
    disableReleaseNotes: true,
    maxFiles: 0,
    reviewSimpleChanges: true,
    reviewCommentLGTM: false,
    pathFilters: {check: () => true},
    checkPath: () => true,
    systemMessage: '',
    openaiLightModel: 'l',
    openaiHeavyModel: 'h',
    openaiConcurrencyLimit: 2,
    githubConcurrencyLimit: 2,
    enableWebSearch: false,
    enableShell: false,
    enableLintTools: false,
    enableDependencyAnalysis: false,
    lintReportPath: '',
    botIcon: '🤖',
    botName: 'bot',
    botLogin: BOT,
    maxReviewComments: 20,
    lightTokenLimits: limits,
    heavyTokenLimits: limits,
    language: 'zh-CN',
    ...over
  }
}

function useCtx(platform: Platform = 'github'): any {
  setStateNamespace(platform)
  const ctx: any = {
    platform,
    projectPath: platform === 'github' ? 'octo/demo' : 'group/demo',
    projectId: platform === 'github' ? 'octo/demo' : 'group/demo',
    changeRequestId: 1,
    eventKind: 'pr_opened',
    actor: {login: 'alice', isBot: false},
    baseSha: BASE,
    headSha: HEAD,
    raw: {}
  }
  setExecCtx(ctx)
  return ctx
}

/** 平台返回的顶层评论形状 */
function comment(id: number, body: string, author = BOT): any {
  return {id, body, author, createdAt: '2026-08-17T00:00:00Z'}
}

beforeEach(() => {
  jest.clearAllMocks()
  logs.length = 0
  _resetBotIdentity()
  initBotGreeting('🤖', 'bot', BOT)
  platformState.getChangeRequest.mockResolvedValue({
    number: 1,
    title: 't',
    body: 'body',
    state: 'open',
    baseSha: BASE,
    headSha: HEAD,
    baseRef: 'main',
    headRef: 'feature',
    author: 'alice'
  })
  platformState.compareDiff.mockResolvedValue({
    files: [{filename: 'a.ts', status: 'modified', patch: '@@ -1,2 +1,3 @@\n a\n+x\n b'}],
    commits: [{sha: HEAD}]
  })
  platformState.getFileContent.mockResolvedValue('a\nb')
  platformState.listRepositoryTree.mockResolvedValue({files: [], truncated: false})
  platformState.listComments.mockResolvedValue([])
  platformState.listReviewComments.mockResolvedValue([])
  platformState.createComment.mockResolvedValue({id: 1, body: '', author: BOT})
  platformState.updateComment.mockResolvedValue(undefined)
  platformState.deleteComment.mockResolvedValue(undefined)
  platformState.listChangeRequestCommits.mockResolvedValue([])
  platformState.submitReviewComments.mockResolvedValue(undefined)
  platformState.updateChangeRequestBody.mockResolvedValue(undefined)
  platformState.deletePendingReview.mockResolvedValue(undefined)
  platformState.getAuthenticatedLogin.mockResolvedValue(BOT)
})

describe('REVIEW-007：自动生成顶层摘要', () => {
  test('审查跑完会发出带 summarize marker 的顶层摘要', async () => {
    const ctx = useCtx()
    await codeReview(ctx, makeBot(), makeBot(), makeOptions(), new Prompts('', ''))

    const bodies = platformState.createComment.mock.calls.map((c: any[]) => String(c[3]))
    expect(bodies.join('\n')).toContain(stateMarker('summarize'))
  })
})

describe('REVIEW-008：更新既有摘要，而不是重复发布', () => {
  test('已有自己的摘要 → 走 update，不新建', async () => {
    const ctx = useCtx()
    platformState.listComments.mockResolvedValue([
      comment(100, `旧摘要\n${stateMarker('summarize')}`)
    ])

    await codeReview(ctx, makeBot(), makeBot(), makeOptions(), new Prompts('', ''))

    expect(platformState.updateComment).toHaveBeenCalled()
    expect(platformState.updateComment.mock.calls[0][2]).toBe(100)
    expect(platformState.createComment).not.toHaveBeenCalled()
  })

  test('没有既有摘要 → 新建（对照组，证明上一条不是恒不新建）', async () => {
    const ctx = useCtx()
    await codeReview(ctx, makeBot(), makeBot(), makeOptions(), new Prompts('', ''))

    expect(platformState.createComment).toHaveBeenCalled()
  })

  test('用户引用回复带上了 marker → 绝不覆盖、绝不删除他的评论', async () => {
    const ctx = useCtx()
    const quoted = `> 我看了下这段摘要\n> ${stateMarker('summarize')}\n我觉得第三条不对`
    platformState.listComments.mockResolvedValue([
      comment(200, quoted, 'alice'),
      comment(100, `旧摘要\n${stateMarker('summarize')}`)
    ])

    await codeReview(ctx, makeBot(), makeBot(), makeOptions(), new Prompts('', ''))

    // 更新的必须是自己那条（100），不能是用户那条（200）
    const updatedIds = platformState.updateComment.mock.calls.map((c: any[]) => c[2])
    expect(updatedIds).toContain(100)
    expect(updatedIds).not.toContain(200)
    // 用户评论更不能被当成重复项删掉
    const deletedIds = platformState.deleteComment.mock.calls.map((c: any[]) => c[2])
    expect(deletedIds).not.toContain(200)
  })

  test('用户引用在前、我们的摘要在后 → 依然只动自己那条', async () => {
    const ctx = useCtx()
    // 顺序反过来：旧实现取 matchedComments[0]，会直接写到用户评论上
    platformState.listComments.mockResolvedValue([
      comment(200, `> ${stateMarker('summarize')}\n用户的话`, 'alice'),
      comment(300, `> ${stateMarker('summarize')}\n另一个用户`, 'bob'),
      comment(100, `旧摘要\n${stateMarker('summarize')}`)
    ])

    await codeReview(ctx, makeBot(), makeBot(), makeOptions(), new Prompts('', ''))

    // codeReview 会发两次摘要（in-progress + 最终），各走一次 replace，
    // 所以按去重后的集合断言
    const touched = [...new Set(platformState.updateComment.mock.calls.map((c: any[]) => c[2]))]
    expect(touched).toEqual([100])
    expect(platformState.deleteComment).not.toHaveBeenCalled()
  })

  test('自己确实发重了 → 更新第一条、删除其余（去重仍要生效）', async () => {
    const ctx = useCtx()
    platformState.listComments.mockResolvedValue([
      comment(100, `旧摘要 A\n${stateMarker('summarize')}`),
      comment(101, `旧摘要 B\n${stateMarker('summarize')}`)
    ])

    await codeReview(ctx, makeBot(), makeBot(), makeOptions(), new Prompts('', ''))

    expect(platformState.updateComment.mock.calls[0][2]).toBe(100)
    const deleted = [...new Set(platformState.deleteComment.mock.calls.map((c: any[]) => c[2]))]
    expect(deleted).toEqual([101])
  })

  /**
   * 身份未知时必须 fail closed。
   *
   * 只挡删除是不够的——覆盖比删除破坏性更大：被删的评论用户还能从邮件通知里
   * 找回原文，被覆盖的内容彻底消失。所以这里断言的是「用户评论既没被更新、
   * 也没被删除」，而不只是「没调 deleteComment」。
   */
  describe('身份查询失败 → 不碰任何既有评论', () => {
    beforeEach(() => {
      _resetBotIdentity()
      initBotGreeting('🤖', 'bot', '') // 未配置
      platformState.getAuthenticatedLogin.mockRejectedValue(new Error('401'))
    })

    test('用户引用排在第一位 → 不更新、不删除，改为新发一条', async () => {
      const ctx = useCtx()
      platformState.listComments.mockResolvedValue([
        comment(200, `> ${stateMarker('summarize')}\n用户写的重要内容`, 'alice'),
        comment(100, `旧摘要\n${stateMarker('summarize')}`)
      ])

      await codeReview(ctx, makeBot(), makeBot(), makeOptions({botLogin: ''}), new Prompts('', ''))

      expect(platformState.updateComment).not.toHaveBeenCalled()
      expect(platformState.deleteComment).not.toHaveBeenCalled()
      // 宁可重复也不覆盖：新发一条
      expect(platformState.createComment).toHaveBeenCalled()
      expect(logs.join('\n')).toContain('Bot identity is unknown')
    })

    test('即使只有我们自己那条匹配，也不就地更新（拿不准归属就不赌）', async () => {
      const ctx = useCtx()
      platformState.listComments.mockResolvedValue([
        comment(100, `旧摘要\n${stateMarker('summarize')}`)
      ])

      await codeReview(ctx, makeBot(), makeBot(), makeOptions({botLogin: ''}), new Prompts('', ''))

      expect(platformState.updateComment).not.toHaveBeenCalled()
      expect(platformState.createComment).toHaveBeenCalled()
    })

    test('findCommentWithTag 返回 null，不从归属未知的评论恢复状态', async () => {
      useCtx()
      const staleSha = 's'.repeat(40)
      platformState.listComments.mockResolvedValue([
        comment(100, `旧摘要\n${stateMarker('summarize')}\n<!-- ${staleSha} -->`)
      ])

      const found = await new Commenter().findCommentWithTag(summarizeTag(), 1)
      expect(found).toBeNull()
      expect(logs.join('\n')).toContain('not restoring state')
    })

    test('对照组：身份可解析时，同样的输入会就地更新（证明上面不是恒不更新）', async () => {
      const ctx = useCtx()
      _resetBotIdentity()
      initBotGreeting('🤖', 'bot', BOT)
      platformState.listComments.mockResolvedValue([
        comment(100, `旧摘要\n${stateMarker('summarize')}`)
      ])

      await codeReview(ctx, makeBot(), makeBot(), makeOptions(), new Prompts('', ''))

      expect(platformState.updateComment.mock.calls[0][2]).toBe(100)
    })
  })

  test('findCommentWithTag 不把用户引用当成自己的状态', async () => {
    useCtx()
    const staleSha = 's'.repeat(40)
    platformState.listComments.mockResolvedValue([
      comment(200, `> ${stateMarker('summarize')}\n> <!-- ${staleSha} -->`, 'alice')
    ])

    const found = await new Commenter().findCommentWithTag(summarizeTag(), 1)
    expect(found).toBeNull()
  })
})

describe('REVIEW-009：摘要里的 reviewed SHA marker 带平台命名空间', () => {
  test.each<[Platform]>([['github'], ['gitlab']])('%s：marker 带本平台前缀', async platform => {
    const ctx = useCtx(platform)
    await codeReview(ctx, makeBot(), makeBot(), makeOptions(), new Prompts('', ''))

    const posted = platformState.createComment.mock.calls
      .concat(platformState.updateComment.mock.calls)
      .map((c: any[]) => String(c[3]))
      .join('\n')

    expect(posted).toContain(`ai-reviewer:${platform}:commit-ids-reviewed-start`)
    expect(posted).toContain(HEAD)
    const other = platform === 'github' ? 'gitlab' : 'github'
    expect(posted).not.toContain(`ai-reviewer:${other}:`)
  })
})

describe('REVIEW-010：summary 命令可重新生成摘要', () => {
  test('summaryOnly=true → 重发摘要但不提交行级评论', async () => {
    const ctx = useCtx()
    await codeReview(ctx, makeBot(), makeBot(), makeOptions(), new Prompts('', ''), {
      mode: 'full',
      summaryOnly: true
    })

    const posted = platformState.createComment.mock.calls
      .concat(platformState.updateComment.mock.calls)
      .map((c: any[]) => String(c[3]))
      .join('\n')
    expect(posted).toContain(stateMarker('summarize'))
    expect(platformState.submitReviewComments).not.toHaveBeenCalled()
  })

  test('summaryOnly 重发时保留既有 reviewed commit 记录（否则下次会从 base 重审）', async () => {
    const ctx = useCtx()
    const reviewed = `${stateMarker('commitIdsStart')}\n<!-- ${HEAD} -->\n${stateMarker(
      'commitIdsEnd'
    )}`
    platformState.listComments.mockResolvedValue([
      comment(100, `旧摘要\n${stateMarker('summarize')}\n${reviewed}`)
    ])

    await codeReview(ctx, makeBot(), makeBot(), makeOptions(), new Prompts('', ''), {
      mode: 'full',
      summaryOnly: true
    })

    const updated = String(platformState.updateComment.mock.calls.at(-1)?.[3] ?? '')
    expect(updated).toContain(HEAD)
    expect(updated).toContain(stateMarker('commitIdsStart'))
  })
})
