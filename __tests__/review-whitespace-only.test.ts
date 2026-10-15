/**
 * review-whitespace-only.test.ts — 只调整缩进或换行的文件不进审查
 *
 * 驱动完整的 codeReview：一个文件只是换行重排，一个文件有实质改动。
 * 前者应在读取基准内容、摘要、审查之前就被跳过；全是这类文件时不调用任何模型。
 */
import {describe, expect, test, jest, beforeEach} from '@jest/globals'

jest.mock('../src/tokenizer', () => ({getTokenCount: () => 10}))
jest.mock('../src/github/review-thread', () => ({
  fetchThreadStatusMap: jest.fn<any>().mockResolvedValue(new Map())
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

function makeBot(): any {
  return {
    chat: jest.fn<any>(async (prompt: string) => {
      const isReviewPhase = String(prompt).includes('---new_hunk---')
      const response = isReviewPhase
        ? '2-2:\n这里有个问题需要修改\n'
        : '[TRIAGE]: NEEDS_REVIEW\nsummary'
      return [response, {}, []]
    })
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

const REFLOW = '@@ -1,4 +1,3 @@\n a\n-const x = f(\n-  1\n-)\n+const x = f(1)\n b'
const REAL = '@@ -1,2 +1,3 @@\n a\n+x\n b'

async function run(files: Array<{filename: string; patch: string}>) {
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
  platformState.compareDiff.mockResolvedValue({
    files: files.map(f => ({filename: f.filename, status: 'modified', patch: f.patch})),
    commits: [{sha: HEAD}]
  })
  platformState.getFileContent.mockResolvedValue('a\nb')
  const light = makeBot()
  const heavy = makeBot()
  await codeReview(ctx, light, heavy, makeOptions(4, 4), taggedPrompts)
  return {light, heavy}
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

describe('只改空白的文件不进审查', () => {
  test('换行重排的文件被跳过：不读基准内容，也不出现在审查评论里；有实质改动的文件照常审查', async () => {
    const {heavy} = await run([
      {filename: 'reflow.ts', patch: REFLOW},
      {filename: 'real.ts', patch: REAL}
    ])
    const readFiles = platformState.getFileContent.mock.calls.map((c: any[]) => c[2])
    expect(readFiles).toEqual(['real.ts'])
    expect(heavy.chat).toHaveBeenCalled()
    const posted = platformState.submitReviewComments.mock.calls.flatMap((c: any[]) => c[4] ?? [])
    expect(posted.length).toBeGreaterThan(0)
    expect(posted.every((d: any) => d.path === 'real.ts')).toBe(true)
  })

  test('全是换行重排的文件：不调用任何模型，也不发行级评论', async () => {
    const {light, heavy} = await run([
      {filename: 'a.ts', patch: REFLOW},
      {filename: 'b.go', patch: REFLOW}
    ])
    expect(light.chat).not.toHaveBeenCalled()
    expect(heavy.chat).not.toHaveBeenCalled()
    expect(platformState.getFileContent).not.toHaveBeenCalled()
    expect(platformState.submitReviewComments).not.toHaveBeenCalled()
  })

  test('对空白敏感的语言（Python）即使只改缩进也照常审查', async () => {
    await run([{filename: 'a.py', patch: REFLOW}])
    expect(platformState.getFileContent).toHaveBeenCalledTimes(1)
  })
})
