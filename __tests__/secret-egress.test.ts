/**
 * secret-egress.test.ts — 密钥不得从任何出口漏出（§14.4 TEST-029）
 *
 * SEC-008 已经把**日志出口**焊死了：`redact.test.ts` 覆盖了 `redactForLog` 本身
 * （Error 的 message/stack、`cause` 递归、循环引用、幂等），`arch-guard.test.ts`
 * 立了门禁——不许直接 import `@actions/core` 的日志函数、不许动态 require 绕开、
 * 不许直接用 `console`。
 *
 * 但日志不是错误文本唯一的出口。命令执行失败时，异常的 message 会被原样渲染进
 * **贴给用户的评论**：
 *
 *   dispatcher.ts  const detail = e instanceof Error ? e.message : String(e)
 *                  await reply.error(code, detail, ackId)
 *   reply.ts       return detail ? `${base}\n\n详情: ${detail}` : base
 *                  await this.publish(body)  → getPlatform().createComment(...)
 *
 * 这条路一次 Logger 都没经过，SEC-008 的门禁自然也管不到它。而 PR/MR 评论是
 * **公开**的——密钥进日志还只有仓库协作者看得见，进评论则是对所有人可见，
 * 而且会一直留在那里。
 *
 * 与之配套的第二处不对称：两个 adapter 归一化 API 错误时，GitLab 侧过
 * `redact()`，GitHub 侧是裸的 `String(e)`。
 *
 * 所以本文件按**出口**组织，而不是按函数：每个出口都塞进真实形态的密钥，
 * 断言它出不去；每组都配一个对照组，确认脱敏没有把正常信息一并抹掉
 * （抹掉了就没人能排错，那是另一种故障）。
 */
import {describe, expect, test, jest, beforeEach, afterEach} from '@jest/globals'

// ─── 出口捕获 ────────────────────────────────────────────────────────────────

const platformCalls = {
  createComment: jest.fn<(...a: any[]) => Promise<any>>(),
  updateComment: jest.fn<(...a: any[]) => Promise<any>>(),
  replyToReviewComment: jest.fn<(...a: any[]) => Promise<any>>(),
  updateChangeRequestBody: jest.fn<(...a: any[]) => Promise<any>>()
}

/** 所有日志输出 */
const logLines: string[] = []

jest.mock('@actions/core', () => ({
  info: (m: string) => logLines.push(String(m)),
  warning: (m: string) => logLines.push(String(m)),
  error: (m: string) => logLines.push(String(m)),
  debug: (m: string) => logLines.push(String(m)),
  setFailed: (m: string) => logLines.push(String(m)),
  getInput: () => '',
  getBooleanInput: () => false,
  getMultilineInput: () => []
}))

const reviewState = {codeReview: jest.fn<(...a: any[]) => Promise<void>>()}
jest.mock('../src/review', () => ({codeReview: (...a: any[]) => reviewState.codeReview(...a)}))

jest.mock('../src/conversation', () => ({
  handleConversation: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  handleIssueConversation: jest.fn<() => Promise<void>>().mockResolvedValue(undefined)
}))

jest.mock('../src/commenter', () => {
  const actual = jest.requireActual('../src/commenter') as any
  return {...actual, isOwnAuthor: async () => false}
})

jest.mock('../src/platform/git-platform', () => {
  const actual = jest.requireActual('../src/platform/git-platform') as any
  return {
    ...actual,
    getPlatform: () => ({
      getChangeRequest: async () => ({
        number: 42,
        title: 't',
        body: 'b',
        state: 'open',
        baseSha: 'b'.repeat(40),
        headSha: 'a'.repeat(40),
        baseRef: 'main',
        headRef: 'feat',
        author: 'alice'
      }),
      getCollaboratorPermission: async () => 'admin',
      getAuthenticatedLogin: async () => 'ai-reviewer-bot',
      listComments: async () => [],
      listReviewComments: async () => [],
      listChangeRequestCommits: async () => [],
      getFileContent: async () => null,
      addReaction: async () => undefined,
      createComment: platformCalls.createComment,
      updateComment: platformCalls.updateComment,
      replyToReviewComment: platformCalls.replyToReviewComment,
      updateChangeRequestBody: platformCalls.updateChangeRequestBody
    })
  }
})

import {handleCommentEvent} from '../src/command-handler'

// ─── 密钥夹具 ────────────────────────────────────────────────────────────────

/**
 * 两类密钥都要覆盖：
 *
 *   来自本进程 env  —— 按**值**脱敏那一层负责（最强，不看形态）
 *   不来自 env      —— 按**形态**脱敏那一层负责（如 API 响应里回显的凭据）
 */
const ENV_SECRET = 'sk-proj-EnvOnlySecretValue1234567890abcdef'
const GITLAB_PAT = 'glpat-EnvOnlyGitLabToken123456'
const FOREIGN_TOKEN = 'ghp_ForeignTokenNotFromThisProcessEnv12345'

/** 出现在任何出口里都算泄露 */
const ALL_SECRETS = [ENV_SECRET, GITLAB_PAT, FOREIGN_TOKEN]

function expectNoSecret(where: string, text: string): void {
  for (const s of ALL_SECRETS) {
    if (text.includes(s)) {
      throw new Error(`${where} 里出现了密钥原文：${text.slice(0, 400)}`)
    }
  }
}

/** 所有平台写 API 收到的正文 */
function publishedBodies(): string[] {
  const bodies: string[] = []
  for (const call of platformCalls.createComment.mock.calls) bodies.push(String(call[3]))
  for (const call of platformCalls.updateComment.mock.calls) bodies.push(String(call[3]))
  for (const call of platformCalls.replyToReviewComment.mock.calls) bodies.push(String(call[4]))
  for (const call of platformCalls.updateChangeRequestBody.mock.calls) bodies.push(String(call[3]))
  return bodies
}

function execCtx(platform: 'github' | 'gitlab', body: string): any {
  return {
    platform,
    projectPath: 'octo/demo',
    projectId: platform === 'gitlab' ? '77' : 'octo/demo',
    changeRequestId: 42,
    eventKind: 'comment_created',
    actor: {login: 'alice', isBot: false},
    baseSha: '',
    headSha: '',
    comment: {kind: 'top_level', id: 5001, body},
    raw: {}
  }
}

const OPTIONS: any = {botLogin: '', pathFilters: {check: () => true}}
const BOTS = () => ({lightBot: {chat: jest.fn()}, heavyBot: {chat: jest.fn()}})

describe('密钥不得从任何出口漏出（TEST-029）', () => {
  const savedEnv: Record<string, string | undefined> = {}

  beforeEach(() => {
    jest.clearAllMocks()
    logLines.length = 0
    for (const k of ['OPENAI_API_KEY', 'GITLAB_PAT']) savedEnv[k] = process.env[k]
    // 按值脱敏那一层读的是真实 env，必须在这里落地
    process.env.OPENAI_API_KEY = ENV_SECRET
    process.env.GITLAB_PAT = GITLAB_PAT
    platformCalls.createComment.mockResolvedValue({id: 1})
    platformCalls.updateComment.mockResolvedValue({id: 1})
    platformCalls.replyToReviewComment.mockResolvedValue({id: 1})
  })

  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })

  // ─── 出口 1：贴给用户的评论 ───────────────────────────────────────────────

  describe('出口 1：命令失败时贴给用户的评论', () => {
    /** 让真实的 review 命令抛出一个带密钥的异常，走完整的 dispatcher 失败分支 */
    async function runFailingCommand(
      errorMessage: string,
      platform: 'github' | 'gitlab' = 'github'
    ) {
      reviewState.codeReview.mockRejectedValue(new Error(errorMessage))
      await handleCommentEvent({
        execCtx: execCtx(platform, '@ai-reviewer full review'),
        options: OPTIONS,
        prompts: {} as any,
        getReviewBots: BOTS as any
      })
    }

    for (const platform of ['github', 'gitlab'] as const) {
      test(`${platform}：异常 message 里的 env 密钥不得进评论`, async () => {
        await runFailingCommand(`Request failed: api key ${ENV_SECRET} rejected`, platform)

        const bodies = publishedBodies()
        expect(bodies.length).toBeGreaterThan(0) // 确实走到了回帖，不是空跑
        for (const b of bodies) expectNoSecret('评论正文', b)
      })
    }

    test('URL 里内嵌的 token 不得进评论（不来自本进程 env 的形态）', async () => {
      await runFailingCommand(
        `GET https://gitlab.example.com/api/v4/projects?private_token=${GITLAB_PAT} failed`
      )

      for (const b of publishedBodies()) expectNoSecret('评论正文', b)
    })

    test('Authorization 头回显不得进评论', async () => {
      await runFailingCommand(`upstream rejected: Authorization: Bearer ${FOREIGN_TOKEN}`)

      for (const b of publishedBodies()) expectNoSecret('评论正文', b)
    })

    test('对照组：不含密钥的错误详情仍然贴出去（脱敏不能把排错信息一起抹掉）', async () => {
      await runFailingCommand('base commit 不在当前历史里，无法生成 diff')

      const joined = publishedBodies().join('\n')
      expect(joined).toContain('base commit 不在当前历史里')
    })

    test('异常 stack 里的密钥同样不得进评论', async () => {
      const e = new Error('handler exploded')
      e.stack = `Error: handler exploded\n    at foo (/app/src/x.ts:1:1) token=${ENV_SECRET}`
      reviewState.codeReview.mockRejectedValue(e)
      await handleCommentEvent({
        execCtx: execCtx('github', '@ai-reviewer full review'),
        options: OPTIONS,
        prompts: {} as any,
        getReviewBots: BOTS as any
      })

      for (const b of publishedBodies()) expectNoSecret('评论正文', b)
    })
  })

  // ─── 出口 2：日志 ─────────────────────────────────────────────────────────

  describe('出口 2：同一条失败路径的日志', () => {
    test('命令失败的日志里同样没有密钥', async () => {
      reviewState.codeReview.mockRejectedValue(new Error(`boom ${ENV_SECRET} / ${FOREIGN_TOKEN}`))
      await handleCommentEvent({
        execCtx: execCtx('github', '@ai-reviewer full review'),
        options: OPTIONS,
        prompts: {} as any,
        getReviewBots: BOTS as any
      })

      expect(logLines.length).toBeGreaterThan(0)
      expectNoSecret('日志', logLines.join('\n'))
    })
  })

  // ─── 出口 3：adapter 的 API 错误归一化 ────────────────────────────────────

  describe('出口 3：两个 adapter 归一化 API 错误时都要脱敏', () => {
    /**
     * 归一化出来的 `GitPlatformError.message` 会被四处传递——贴进评论、进日志、
     * 出现在 `setFailed` 里。在**源头**就脱敏，比指望每个下游都记得脱敏可靠。
     *
     * GitLab 侧本来就这么做（`normalizeGitLabError` 走 `redact`），GitHub 侧
     * 原先是裸的 `String(e)`。两边必须对称，否则同一类故障在 GitHub 上泄露、
     * 在 GitLab 上不泄露。
     */
    test('GitHub：octokit 错误里的 token 不出现在 GitPlatformError.message', async () => {
      jest.resetModules()
      const err: any = new Error(
        `HttpError: request to https://api.github.com/repos?access_token=${FOREIGN_TOKEN} failed`
      )
      err.status = 500
      jest.doMock('../src/octokit', () => ({
        octokit: {git: {getTree: async () => Promise.reject(err)}}
      }))

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const {GitHubPlatform} = require('../src/platform/github-platform')
      let thrown: any
      try {
        await new GitHubPlatform().listRepositoryTree('o', 'r', 'sha')
      } catch (e) {
        thrown = e
      }

      expect(thrown).toBeDefined()
      expectNoSecret('GitHubPlatform 抛出的错误', String(thrown.message))
    })

    test('GitHub：对照组——非密钥的错误信息仍然保留（否则无法排错）', async () => {
      jest.resetModules()
      const err: any = new Error('HttpError: 500 Internal Server Error on /git/trees')
      err.status = 500
      jest.doMock('../src/octokit', () => ({
        octokit: {git: {getTree: async () => Promise.reject(err)}}
      }))

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const {GitHubPlatform} = require('../src/platform/github-platform')
      let thrown: any
      try {
        await new GitHubPlatform().listRepositoryTree('o', 'r', 'sha')
      } catch (e) {
        thrown = e
      }

      expect(String(thrown.message)).toContain('500 Internal Server Error')
      expect(String(thrown.message)).toContain('/git/trees')
    })

    test('GitLab：同类错误同样不泄露（对称回归）', async () => {
      jest.resetModules()
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const {normalizeGitLabError} = require('../src/platform/gitlab-errors')
      const err: any = new Error(`request failed with private_token=${GITLAB_PAT}`)
      err.status = 500

      expectNoSecret(
        'normalizeGitLabError',
        String(normalizeGitLabError(err, 'listRepositoryTree').message)
      )
    })

    /**
     * 两个 adapter 必须挡住**同一批**形态，不能一边强一边弱。
     *
     * GitLab 侧原先用的是 `gitlab-trigger-redact.ts` 的 `redact()`——那是
     * EVENT-005 时期的实现，只认 glpat- / Bearer / `?token=` / `?private_token=`
     * 四种。它自己的文件头就写明「不是通用脱敏框架，覆盖 env/嵌套字段是 SEC-008
     * 的范围」。于是 OpenAI key、GitHub token、URL 内嵌凭据这些形态在 GitLab
     * 这一侧是漏的，而 GitHub 侧改用 redactForLog 之后反倒挡得住。
     */
    test.each([
      ['本进程 env 里的 OpenAI key', () => ENV_SECRET],
      ['GitHub token 形态', () => FOREIGN_TOKEN],
      ['URL 内嵌凭据', () => `https://oauth2:${GITLAB_PAT}@gitlab.example.com/g/p.git`]
    ])('两平台对同一形态的处置一致：%s', async (_label, secretOf) => {
      jest.resetModules()
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const {normalizeGitLabError} = require('../src/platform/gitlab-errors')
      const raw = `upstream call failed: ${secretOf()}`
      const err: any = new Error(raw)
      err.status = 500

      expectNoSecret(
        'normalizeGitLabError',
        String(normalizeGitLabError(err, 'listRepositoryTree').message)
      )
    })
  })
})
