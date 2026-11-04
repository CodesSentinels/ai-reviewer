/**
 * review-concurrency-limits.test.ts — FT-296 / FT-297 并发上限生效
 *
 * 仓库级 jest 把 p-limit（仅 ESM）映射成「直接透传」的 shim，所以并发上限在别处测不到。
 * 这里用一个真正排队的限流器替换它，再驱动完整的 codeReview，量两处的**最大同时在飞数**：
 *   - 模型调用（light + heavy 两个 bot 共用 openaiConcurrencyLimit）→ FT-296
 *   - 读取基准分支文件内容（getFileContent，走 githubConcurrencyLimit）→ FT-297
 * 文件数（8）大于上限，所以「峰值 == 上限」证明上限确实在约束，而不只是没超过。
 * 对照组（上限 8）峰值应更高，证明量法本身有分辨力。
 */
import {describe, expect, test, jest, beforeEach} from '@jest/globals'

jest.mock('../src/tokenizer', () => ({getTokenCount: () => 10}))
jest.mock('../src/github/review-thread', () => ({
  fetchThreadStatusMap: jest.fn<any>().mockResolvedValue(new Map())
}))
jest.mock('p-limit', () => ({
  __esModule: true,
  default: (n: number) => {
    let active = 0
    const queue: Array<() => void> = []
    const next = () => {
      if (active < n && queue.length > 0) queue.shift()!()
    }
    return <T>(fn: () => Promise<T>): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        queue.push(() => {
          active++
          fn()
            .then(resolve, reject)
            .finally(() => {
              active--
              next()
            })
        })
        next()
      })
  }
}))

const BOT = 'bot'
const HEAD = 'a'.repeat(40)
const BASE = 'b'.repeat(40)
const FILES = 8

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
jest.mock('../src/platform/logger', () => ({
  getLogger: () => ({info: () => {}, warning: () => {}, error: () => {}, debug: () => {}})
}))

import {codeReview} from '../src/review'
import {_resetBotIdentity, initBotGreeting} from '../src/commenter'
import {setExecCtx} from '../src/platform/run-context'
import {setStateNamespace} from '../src/platform/state-namespace'

const taggedPrompts: any = {
  renderSummarizeFileDiff: () => 'PROMPT_FILE_SUMMARY',
  renderSummarizeChangesets: () => 'PROMPT_MERGE',
  renderSummarize: () => 'PROMPT_FINAL_SUMMARY',
  renderSummarizeReleaseNotes: () => 'PROMPT_RELEASE_NOTES',
  renderSummarizeShort: () => 'PROMPT_SHORT',
  renderReviewFileDiff: () => 'PROMPT_REVIEW ---new_hunk---'
}

/** 记录某类调用的同时在飞数峰值 */
class Gauge {
  active = 0
  peak = 0
  async track<T>(work: () => T | Promise<T>): Promise<T> {
    this.active++
    this.peak = Math.max(this.peak, this.active)
    try {
      await new Promise(r => setTimeout(r, 15))
      return await work()
    } finally {
      this.active--
    }
  }
}

function makeBot(gauge: Gauge): any {
  return {
    chat: jest.fn<any>(async (prompt: string) =>
      gauge.track(() => {
        const isReviewPhase = String(prompt).includes('---new_hunk---')
        const response = isReviewPhase ? '2-2:\n这里有个问题需要修改\n' : '[TRIAGE]: APPROVED\nLGTM'
        return [response, {}, []]
      })
    )
  }
}

function makeOptions(openai: number, github: number): any {
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
    pathInstructions: {match: () => []},
    checkPath: () => true,
    systemMessage: '',
    openaiLightModel: 'l',
    openaiHeavyModel: 'h',
    openaiConcurrencyLimit: openai,
    githubConcurrencyLimit: github,
    enableWebSearch: false,
    enableShell: false,
    enableLintTools: false,
    enableDependencyAnalysis: false,
    lintReportPath: '',
    botIcon: '🤖',
    botName: 'bot',
    botLogin: BOT,
    maxReviewComments: 50,
    lightTokenLimits: limits,
    heavyTokenLimits: limits,
    language: 'zh-CN'
  }
}

async function run(openai: number, github: number) {
  setStateNamespace('github')
  const ctx: any = {
    platform: 'github',
    projectPath: 'octo/demo',
    projectId: 'octo/demo',
    changeRequestId: 1,
    eventKind: 'pr_opened',
    actor: {login: 'alice', isBot: false},
    baseSha: BASE,
    headSha: HEAD,
    raw: {}
  }
  setExecCtx(ctx)
  const modelGauge = new Gauge()
  const fileGauge = new Gauge()
  platformState.getFileContent.mockImplementation(() => fileGauge.track(() => 'a\nb'))
  await codeReview(
    ctx,
    makeBot(modelGauge),
    makeBot(modelGauge),
    makeOptions(openai, github),
    taggedPrompts
  )
  return {model: modelGauge.peak, file: fileGauge.peak}
}

beforeEach(() => {
  jest.clearAllMocks()
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
    files: Array.from({length: FILES}, (_, i) => ({
      filename: `f${i}.ts`,
      status: 'modified',
      patch: '@@ -1,2 +1,3 @@\n a\n+x\n b'
    })),
    commits: [{sha: HEAD}]
  })
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

describe('FT-296 / FT-297：并发上限约束真实的审查流程', () => {
  test('openai=1：模型调用峰值恰为 1（FT-296）', async () => {
    const peak = await run(1, 8)
    expect(peak.model).toBe(1)
    expect(platformState.getFileContent).toHaveBeenCalledTimes(FILES)
  })

  test('openai=3：模型调用峰值恰为 3，不多不少（FT-296）', async () => {
    expect((await run(3, 8)).model).toBe(3)
  })

  test('github=1：读取文件内容峰值恰为 1（FT-297）', async () => {
    const peak = await run(8, 1)
    expect(peak.file).toBe(1)
    expect(platformState.getFileContent).toHaveBeenCalledTimes(FILES)
  })

  test('github=2：读取文件内容峰值恰为 2（FT-297）', async () => {
    expect((await run(8, 2)).file).toBe(2)
  })

  test('两个上限互相独立：openai=2、github=3 各自生效', async () => {
    const peak = await run(2, 3)
    expect(peak.model).toBe(2)
    expect(peak.file).toBe(3)
  })

  test('对照组：上限放宽到 8，峰值明显更高（证明量法有分辨力）', async () => {
    const peak = await run(8, 8)
    expect(peak.model).toBeGreaterThan(3)
    expect(peak.file).toBe(FILES)
  })
})
