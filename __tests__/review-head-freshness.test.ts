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
/**
 * 可辨识的提示词存根。
 *
 * `new Prompts('', '')` 渲染出来的内容无法区分阶段，按调用序号切换 HEAD 又会
 * 命中错误的阶段——先前那条 release notes 用例就是这么假绿的：它在 heavyBot
 * 第 1 次调用（摘要合并）时就把 HEAD 换了，门禁放在模型调用前后都会拦。
 */
const taggedPrompts: any = {
  renderSummarizeFileDiff: () => 'PROMPT_FILE_SUMMARY',
  renderSummarizeChangesets: () => 'PROMPT_MERGE',
  renderSummarize: () => 'PROMPT_FINAL_SUMMARY',
  renderSummarizeReleaseNotes: () => 'PROMPT_RELEASE_NOTES',
  renderSummarizeShort: () => 'PROMPT_SHORT',
  renderReviewFileDiff: () => 'PROMPT_REVIEW ---new_hunk---'
}

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

  test('不再去清进度横幅——陈旧任务根本不会写下它（从源头避免）', () => {
    // 早先这里会读改写摘要评论来清掉横幅。那本身就是旧任务对共享摘要的一次
    // read-modify-write，可能覆盖新任务刚写好的结果——正是 REVIEW-003 要防的。
    // 现在改为在写横幅**之前**就检查，陈旧任务不留痕迹，也就无需清理。
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('path')
    const src: string = fs.readFileSync(path.resolve(__dirname, '../src/review.ts'), 'utf8')
    const notice = src.slice(src.indexOf('const publishInvalidationNotice'))
    const body = notice.slice(0, notice.indexOf('\n  }\n'))
    expect(body).not.toContain('removeInProgressStatus')
    expect(body).not.toContain('summarizeTag()')
  })
})

describe('REVIEW-003：读不到当前 HEAD 时 fail closed', () => {
  test('重新读取抛错 → 判为不新鲜，放弃全部写入', async () => {
    const ctx = ctxWith(OLD_HEAD)
    // 第 2 次调用（第一道门禁的重新读取）抛错
    let calls = 0
    platformState.getChangeRequest.mockImplementation(async () => {
      calls += 1
      if (calls === 2) throw new Error('503 service unavailable')
      return cr(OLD_HEAD)
    })

    await codeReview(ctx, makeBot(), makeBot(), makeOptions(), new Prompts('', ''))

    // 早先这里返回「放行」，理由是「一次 API 抖动不该让整轮白跑」——那是 fail
    // open：读不到当前 HEAD 就无法确认自己是不是旧任务，此时继续写入正是
    // REVIEW-003 要防的事
    expect(platformState.updateChangeRequestBody).not.toHaveBeenCalled()
    expect(platformState.submitReviewComments).not.toHaveBeenCalled()
    expect(logs.join('\n')).toContain('cannot confirm current HEAD')
  })
})

describe('REVIEW-003：进度横幅之前就要检查', () => {
  test('审查开始后 HEAD 已变 → 连进度横幅都不写（它也是对共享摘要的 replace）', async () => {
    const ctx = ctxWith(OLD_HEAD)
    headMovesAfter(1)

    await codeReview(ctx, makeBot(), makeBot(), makeOptions(), new Prompts('', ''))

    // 摘要评论只应出现作废提示，不应出现「Currently reviewing」横幅
    expect(postedText()).not.toContain('Currently reviewing')
    expect(postedText()).toContain(stateMarker('reviewInvalidated'))
  })

  test('作废提示不去读改写摘要评论（旧任务不得覆盖新任务结果）', async () => {
    const ctx = ctxWith(OLD_HEAD)
    headMovesAfter(1)
    platformState.listComments.mockResolvedValue([
      {id: 700, body: `新任务刚写好的摘要\n${stateMarker('summarize')}`, author: BOT}
    ])

    await codeReview(ctx, makeBot(), makeBot(), makeOptions(), new Prompts('', ''))

    // 携带 summarize marker 的那条评论一次都不能被更新
    const touchedSummary = platformState.updateComment.mock.calls.filter((c: any[]) => c[2] === 700)
    expect(touchedSummary).toEqual([])
  })
})

/**
 * 门禁必须**紧贴写入**，不能只是「在某个阶段之前」。
 *
 * 先前那条用例用 headMovesAfter(4) 按 getChangeRequest 调用次数切换 HEAD，
 * 而第 4 次调用正好就是当时设在阶段四之前的那道门禁——测的是那道门禁本身，
 * 根本没模拟「模型执行期间」变化。这里改为让 bot 的 Promise 真正挂起，
 * 在挂起期间切换平台返回的 HEAD，再释放。
 */
describe('REVIEW-003：耗时阶段执行期间 HEAD 变化', () => {
  /** 让指定阶段的模型调用挂起，期间把 HEAD 换掉 */
  function botThatMovesHeadWhileRunning(matchPrompt: (p: string) => boolean): any {
    let moved = false
    return {
      chat: jest.fn<any>(async (prompt: string) => {
        if (!moved && matchPrompt(String(prompt))) {
          moved = true
          // 真实的异步间隙：模型调用期间平台侧 HEAD 前进
          await new Promise(r => setTimeout(r, 0))
          platformState.getChangeRequest.mockResolvedValue(cr(NEW_HEAD))
        }
        return [String(prompt).includes('---new_hunk---') ? '2-2:\n有问题\n' : 'LGTM', {}, []]
      })
    }
  }

  test('逐文件审查（阶段四）执行期间推了新 commit → 行级评论与摘要都不写', async () => {
    const ctx = ctxWith(OLD_HEAD)
    platformState.getChangeRequest.mockResolvedValue(cr(OLD_HEAD))
    const heavy = botThatMovesHeadWhileRunning(p => p.includes('---new_hunk---'))

    await codeReview(ctx, makeBot(), heavy, makeOptions(), taggedPrompts)

    expect(platformState.submitReviewComments).not.toHaveBeenCalled()
    expect(postedText()).not.toContain(stateMarker('commitIdsStart'))
    expect(logs.join('\n')).toContain('[review-003] HEAD moved')
  })

  test('release notes 生成期间推了新 commit → 不写 PR 描述', async () => {
    const ctx = ctxWith(OLD_HEAD)
    platformState.getChangeRequest.mockResolvedValue(cr(OLD_HEAD))
    // 精确在**生成 release notes 那次调用**期间切换 HEAD：
    // 门禁若仍在模型调用之前，此刻它已经放行，旧 release notes 就会写进描述
    const heavy = botThatMovesHeadWhileRunning(p => p === 'PROMPT_RELEASE_NOTES')

    await codeReview(ctx, makeBot(), heavy, makeOptions(), taggedPrompts)

    expect(platformState.updateChangeRequestBody).not.toHaveBeenCalled()
  })

  test('对照组：全程 HEAD 不变 → 三处写入都发生', async () => {
    const ctx = ctxWith(OLD_HEAD)
    platformState.getChangeRequest.mockResolvedValue(cr(OLD_HEAD))

    await codeReview(ctx, makeBot(), makeBot(), makeOptions(), new Prompts('', ''))

    expect(platformState.updateChangeRequestBody).toHaveBeenCalled()
    expect(platformState.submitReviewComments).toHaveBeenCalled()
    expect(postedText()).toContain(stateMarker('commitIdsStart'))
  })
})

describe('REVIEW-003：查询失败不发作废提示', () => {
  test('读不到 HEAD → 放弃写入，但不贴「已作废」（没有证据说明结果过期）', async () => {
    const ctx = ctxWith(OLD_HEAD)
    let calls = 0
    platformState.getChangeRequest.mockImplementation(async () => {
      calls += 1
      if (calls === 2) throw new Error('503 service unavailable')
      return cr(OLD_HEAD)
    })

    await codeReview(ctx, makeBot(), makeBot(), makeOptions(), new Prompts('', ''))

    expect(platformState.updateChangeRequestBody).not.toHaveBeenCalled()
    expect(postedText()).not.toContain(stateMarker('reviewInvalidated'))
    // 但必须留下可查的记录
    expect(logs.join('\n')).toContain('No invalidation notice was posted')
  })

  test('确认 HEAD 变化 → 才发作废提示（对照组）', async () => {
    const ctx = ctxWith(OLD_HEAD)
    headMovesAfter(1)

    await codeReview(ctx, makeBot(), makeBot(), makeOptions(), new Prompts('', ''))

    expect(postedText()).toContain(stateMarker('reviewInvalidated'))
  })

  test('作废提示发布失败 → 记 warning（comment() 会吞异常，只能看返回值）', async () => {
    const ctx = ctxWith(OLD_HEAD)
    headMovesAfter(1)
    platformState.createComment.mockRejectedValue(new Error('403'))
    platformState.updateComment.mockRejectedValue(new Error('403'))

    await codeReview(ctx, makeBot(), makeBot(), makeOptions(), new Prompts('', ''))

    expect(logs.join('\n')).toContain('failed to publish invalidation notice')
  })
})
