/**
 * review-head-freshness.test.ts — §8.1 REVIEW-003 只处理最新 HEAD
 *
 * 三个已定的结论：
 *   1. **全拦**——不是只拦行级评论。危害最大的是 reviewed SHA marker：它记的是
 *      现查的新 SHA，而分析内容来自旧 SHA，等于宣称「新 HEAD 已审过」，下次增量
 *      审查会跳过这段，发现被永久吞掉。
 *   2. 基线用**审查开始时读到的 HEAD**，不是事件里的——评论触发的运行
 *      execCtx.headSha 固定为空，拿它做基线会让 `@ai-reviewer review` 永远发不出
 *      结果；真正要防的是「分析跑了几分钟，期间又推了新 commit」。
 *   3. 明确变化时发布**幂等**作废提示，并清掉进度横幅。
 */
import {describe, expect, test, jest, beforeEach} from '@jest/globals'

jest.mock('../src/tokenizer', () => ({getTokenCount: () => 10}))
jest.mock('../src/github/review-thread', () => ({
  fetchThreadStatusMap: jest.fn<any>().mockResolvedValue(new Map())
}))

const BOT = 'bot'
const OLD_HEAD = 'a'.repeat(40)
const NEW_HEAD = 'f'.repeat(40)
const BASE = 'b'.repeat(40)

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
  deleteReviewComment: jest.fn<any>(),
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
import {_resetBotIdentity, initBotGreeting} from '../src/commenter'
import {isHeadStale} from '../src/head-staleness'
import {setExecCtx} from '../src/platform/run-context'
import {setStateNamespace} from '../src/platform/state-namespace'
import {stateMarker} from '../src/state-markers'
import {Prompts} from '../src/prompts'
import type {ExecutionContext} from '../src/platform/execution-context'

/**
 * 审查阶段必须真的产出一条行级发现，否则 submitReview 会因为「没有评论」提前
 * 返回，`expect(submitReviewComments).not.toHaveBeenCalled()` 就成了恒真断言。
 * 格式见 parseReview：`起始-结束:` 后跟正文。
 */
function makeBot(): any {
  return {
    chat: jest.fn<any>(async (prompt: string) => {
      const isReviewPhase = String(prompt).includes('---new_hunk---')
      const response = isReviewPhase ? '2-2:\n这里有个问题需要修改\n' : '[TRIAGE]: APPROVED\nLGTM'
      return [response, {}, []]
    })
  }
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
    disableReleaseNotes: false,
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

/** execCtx.headSha 可控：PR 事件带值，评论事件为空 */
function ctxWith(headSha: string): ExecutionContext {
  setStateNamespace('github')
  const ctx: any = {
    platform: 'github',
    projectPath: 'octo/demo',
    projectId: 'octo/demo',
    changeRequestId: 1,
    eventKind: headSha === '' ? 'comment_created' : 'pr_opened',
    actor: {login: 'alice', isBot: false},
    baseSha: BASE,
    headSha,
    raw: {}
  }
  setExecCtx(ctx)
  return ctx
}

function cr(headSha: string, body = 'body'): any {
  return {
    number: 1,
    title: 't',
    body,
    state: 'open',
    baseSha: BASE,
    headSha,
    baseRef: 'main',
    headRef: 'feature',
    author: 'alice'
  }
}

/** 让 getChangeRequest 的第 N 次之后返回新 HEAD，模拟审查途中被推了新 commit */
function headMovesAfter(nCalls: number): void {
  let calls = 0
  platformState.getChangeRequest.mockImplementation(async () => {
    calls += 1
    return cr(calls <= nCalls ? OLD_HEAD : NEW_HEAD)
  })
}

function postedText(): string {
  return [...platformState.createComment.mock.calls, ...platformState.updateComment.mock.calls]
    .map((c: any[]) => String(c[3]))
    .join('\n---\n')
}

beforeEach(() => {
  jest.clearAllMocks()
  logs.length = 0
  _resetBotIdentity()
  initBotGreeting('🤖', 'bot', BOT)
  platformState.getChangeRequest.mockResolvedValue(cr(OLD_HEAD))
  platformState.compareDiff.mockResolvedValue({
    files: [{filename: 'a.ts', status: 'modified', patch: '@@ -1,2 +1,3 @@\n a\n+x\n b'}],
    commits: [{sha: OLD_HEAD}]
  })
  platformState.getFileContent.mockResolvedValue('a\nb')
  platformState.listRepositoryTree.mockResolvedValue({files: [], truncated: false})
  platformState.listComments.mockResolvedValue([])
  platformState.listReviewComments.mockResolvedValue([])
  platformState.createComment.mockResolvedValue({id: 1, body: '', author: BOT})
  platformState.updateComment.mockResolvedValue(undefined)
  platformState.deleteComment.mockResolvedValue(undefined)
  platformState.deleteReviewComment.mockResolvedValue(undefined)
  platformState.listChangeRequestCommits.mockResolvedValue([])
  platformState.submitReviewComments.mockImplementation(async (..._a: any[]) => ({
    delivered: [...((_a[4] ?? []) as any[])],
    failed: []
  }))
  platformState.updateChangeRequestBody.mockResolvedValue(undefined)
  platformState.deletePendingReview.mockResolvedValue(undefined)
  platformState.getAuthenticatedLogin.mockResolvedValue(BOT)
})

describe('isHeadStale：任一侧未知时不判为陈旧', () => {
  test.each([
    ['两侧一致', OLD_HEAD, OLD_HEAD, false],
    ['两侧不同', OLD_HEAD, NEW_HEAD, true],
    ['基线为空', '', NEW_HEAD, false],
    ['当前为空', OLD_HEAD, '', false],
    ['都为空', '', '', false]
  ])('%s', (_label, a, b, expected) => {
    expect(isHeadStale(a as string, b as string).stale).toBe(expected)
  })
})

describe('REVIEW-003：HEAD 变化后全拦，不只是拦行级评论', () => {
  test('分析后 HEAD 变化 → 不写 release notes / 摘要 / 行级评论', async () => {
    const ctx = ctxWith(OLD_HEAD)
    headMovesAfter(1) // 第一次读（审查开始）拿到旧 HEAD，之后都是新的

    await codeReview(ctx, makeBot(), makeBot(), makeOptions(), new Prompts('', ''))

    expect(platformState.updateChangeRequestBody).not.toHaveBeenCalled() // release notes
    expect(platformState.submitReviewComments).not.toHaveBeenCalled() // 行级评论
    expect(logs.join('\n')).toContain('[review-003] HEAD moved')
  })

  test('最危险的一条：不写 reviewed SHA marker（否则新 HEAD 会被当成已审过）', async () => {
    const ctx = ctxWith(OLD_HEAD)
    headMovesAfter(1)

    await codeReview(ctx, makeBot(), makeBot(), makeOptions(), new Prompts('', ''))

    expect(postedText()).not.toContain(stateMarker('commitIdsStart'))
  })

  test('HEAD 未变 → 一切照常发布（对照组）', async () => {
    const ctx = ctxWith(OLD_HEAD)
    platformState.getChangeRequest.mockResolvedValue(cr(OLD_HEAD))

    await codeReview(ctx, makeBot(), makeBot(), makeOptions(), new Prompts('', ''))

    expect(platformState.updateChangeRequestBody).toHaveBeenCalled()
    expect(postedText()).toContain(stateMarker('commitIdsStart'))
    // 关键的防空跑：确认这套夹具**确实**会走到行级评论提交，
    // 否则上面几条 `not.toHaveBeenCalled()` 都是恒真的
    expect(platformState.submitReviewComments).toHaveBeenCalled()
    expect(logs.join('\n')).not.toContain('[review-003] HEAD moved')
  })

  test('阶段三之后才变化 → 第二道门禁拦住行级评论与最终摘要', async () => {
    const ctx = ctxWith(OLD_HEAD)
    // 放过第一道（release notes 之前），在第二道之前才变
    headMovesAfter(3)

    await codeReview(ctx, makeBot(), makeBot(), makeOptions(), new Prompts('', ''))

    expect(platformState.submitReviewComments).not.toHaveBeenCalled()
    expect(logs.join('\n')).toContain('line-level review and final summary')
  })
})

describe('REVIEW-003：基线取自审查开始时读到的 HEAD', () => {
  test('评论触发（execCtx.headSha 为空）→ HEAD 未变时照常发布，不被误拦', async () => {
    const ctx = ctxWith('')
    platformState.getChangeRequest.mockResolvedValue(cr(OLD_HEAD))

    await codeReview(ctx, makeBot(), makeBot(), makeOptions(), new Prompts('', ''), {
      source: 'command'
    })

    expect(postedText()).not.toBe('')
    expect(logs.join('\n')).not.toContain('[review-003] HEAD moved')
  })

  test('评论触发 + 审查途中 HEAD 变化 → 同样被拦（基线来自现查，不是事件）', async () => {
    const ctx = ctxWith('')
    headMovesAfter(1)

    await codeReview(ctx, makeBot(), makeBot(), makeOptions(), new Prompts('', ''), {
      source: 'command'
    })

    expect(platformState.submitReviewComments).not.toHaveBeenCalled()
    expect(logs.join('\n')).toContain('[review-003] HEAD moved')
  })
})

describe('REVIEW-003：作废提示是幂等的，且清掉进度横幅', () => {
  test('发布带固定 marker 的作废提示，说明新旧 HEAD', async () => {
    const ctx = ctxWith(OLD_HEAD)
    headMovesAfter(1)

    await codeReview(ctx, makeBot(), makeBot(), makeOptions(), new Prompts('', ''))

    const posted = postedText()
    expect(posted).toContain(stateMarker('reviewInvalidated'))
    expect(posted).toContain('已作废')
    expect(posted).toContain(OLD_HEAD.slice(0, 8))
    expect(posted).toContain(NEW_HEAD.slice(0, 8))
  })

  test('已有旧的作废提示 → 走 replace 更新，不堆积', async () => {
    const ctx = ctxWith(OLD_HEAD)
    headMovesAfter(1)
    platformState.listComments.mockResolvedValue([
      {id: 900, body: `旧的作废提示\n${stateMarker('reviewInvalidated')}`, author: BOT}
    ])

    await codeReview(ctx, makeBot(), makeBot(), makeOptions(), new Prompts('', ''))

    const updatedIds = platformState.updateComment.mock.calls.map((c: any[]) => c[2])
    expect(updatedIds).toContain(900)
  })

  test('清掉「审查进行中」横幅，不让 PR 一直挂着进行中', async () => {
    const ctx = ctxWith(OLD_HEAD)
    headMovesAfter(1)
    platformState.listComments.mockResolvedValue([
      {
        id: 800,
        body: `${stateMarker('inProgressStart')}\nCurrently reviewing...\n${stateMarker(
          'inProgressEnd'
        )}\n\n---\n\n旧摘要\n${stateMarker('summarize')}`,
        author: BOT
      }
    ])

    await codeReview(ctx, makeBot(), makeBot(), makeOptions(), new Prompts('', ''))

    const summaryUpdates = platformState.updateComment.mock.calls
      .filter((c: any[]) => c[2] === 800)
      .map((c: any[]) => String(c[3]))
    expect(summaryUpdates.length).toBeGreaterThan(0)
    expect(summaryUpdates.at(-1)).not.toContain('Currently reviewing')
    expect(summaryUpdates.at(-1)).toContain('旧摘要') // 既有摘要必须保住
  })
})

describe('REVIEW-003：读不到当前 HEAD 时不阻断', () => {
  test('重新读取抛错 → 照常发布，只记 warning（一次 API 抖动不该让整轮白跑）', async () => {
    const ctx = ctxWith(OLD_HEAD)
    // 只让第 2 次调用（第一道门禁的重新读取）抛错，模拟一次瞬时抖动。
    // 全程抛错会连带打断审查流程里其它对 getChangeRequest 的依赖，
    // 那验的就不是「门禁不阻断」了。
    let calls = 0
    platformState.getChangeRequest.mockImplementation(async () => {
      calls += 1
      if (calls === 2) throw new Error('503 service unavailable')
      return cr(OLD_HEAD)
    })

    await codeReview(ctx, makeBot(), makeBot(), makeOptions(), new Prompts('', ''))

    expect(logs.join('\n')).toContain('failed to re-read HEAD')
    expect(platformState.submitReviewComments).toHaveBeenCalled()
  })
})
