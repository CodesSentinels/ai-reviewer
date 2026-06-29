/**
 * resolve.partial-failure.integration.test.ts
 *
 * 自包含的 batchResolve 部分失败集成测试，无需依赖其他测试文件或测试顺序。
 *
 * 运行方式:
 *   GITHUB_TOKEN=<token> INTEGRATION=true npx jest resolve.partial-failure --no-coverage --runInBand
 *
 * 三个场景:
 *   P1 — 全部失败: 1 假 thread ID → ok=0 failed=1
 *   P2 — 混合失败: 1 真实 thread + 1 假 ID → ok=1 failed=1
 *   P3 — 部分成功: 2 真实 thread + 2 假 ID → ok=2 failed=2
 *
 * 自包含保证:
 *   beforeAll 在创建初始 thread 后立即 resolve 掉，保证每个测试以 0 条未解决 thread 起始。
 */

import {describe, expect, test, beforeAll, afterAll, jest} from '@jest/globals'

const describeIntegration = process.env.INTEGRATION ? describe : describe.skip

jest.mock('@actions/github', () => ({
  context: {
    eventName: 'issue_comment',
    payload: {},
    repo: {owner: 'CodesSentinels', repo: 'ai-reviewer-test'}
  }
}))

jest.mock('../src/octokit', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const {Octokit} = require('@octokit/action')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let _instance: any = null
  return {
    get octokit() {
      if (!_instance) {
        if (!process.env.GITHUB_TOKEN) {
          throw new Error('GITHUB_TOKEN must be set before running integration tests.')
        }
        _instance = new Octokit()
      }
      return _instance
    }
  }
})

import {execSync} from 'child_process'
import * as actionsCore from '@actions/core'
import {octokit} from '../src/octokit'
import {
  getBotLogin,
  fetchUnresolvedBotThreads,
  batchResolve,
  _resetBotLoginCache
} from '../src/github/review-thread'

const OWNER = 'CodesSentinels'
const REPO = 'ai-reviewer-test'

function getGithubToken(): string {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN
  try {
    const t = execSync('gh auth token', {encoding: 'utf8'}).trim()
    if (t) return t
  } catch {}
  throw new Error('No GitHub token found. Set GITHUB_TOKEN env var.')
}

describeIntegration('batchResolve 部分失败场景', () => {
  let prNumber: number
  let branchName: string
  let filePath: string
  let headSha: string
  let botLogin: string

  // ── Setup: 创建 PR，立即清空初始 thread，保证测试起点干净 ────────────────────

  beforeAll(async () => {
    process.env.GITHUB_TOKEN = getGithubToken()
    _resetBotLoginCache()

    const {data: repo} = await octokit.repos.get({owner: OWNER, repo: REPO})
    const defaultBranch = repo.default_branch

    const {data: ref} = await octokit.git.getRef({
      owner: OWNER,
      repo: REPO,
      ref: `heads/${defaultBranch}`
    })

    branchName = `test/partial-failure-${Date.now()}`
    await octokit.git.createRef({
      owner: OWNER,
      repo: REPO,
      ref: `refs/heads/${branchName}`,
      sha: ref.object.sha
    })
    console.log(`✅ 创建分支: ${branchName}`)

    filePath = `integration-tests/partial-failure-${Date.now()}.ts`
    const content = [
      '// partial-failure integration test — safe to delete',
      `// Created: ${new Date().toISOString()}`,
      'export const a = (x: number) => x * 2   // line 3',
      'export const b = (x: number) => x + 1   // line 4',
      'export const c = (x: number) => x ** 2  // line 5'
    ].join('\n')

    const {data: fileData} = await octokit.repos.createOrUpdateFileContents({
      owner: OWNER,
      repo: REPO,
      path: filePath,
      message: 'test: add partial-failure integration test file',
      content: Buffer.from(content).toString('base64'),
      branch: branchName
    })
    headSha = fileData.commit.sha ?? ''
    console.log(`✅ 创建文件: ${filePath} (commit: ${headSha.slice(0, 7)})`)

    const {data: pr} = await octokit.pulls.create({
      owner: OWNER,
      repo: REPO,
      title: '[TEST] batchResolve partial-failure integration — safe to close',
      body: '> ⚠️ 由集成测试自动创建，测试完成后会自动关闭。',
      head: branchName,
      base: defaultBranch
    })
    prNumber = pr.number
    console.log(`✅ 创建 PR: #${prNumber} (${pr.html_url})`)

    // 添加 2 条初始 comment 以获取 botLogin，然后立即 resolve 掉，保证测试起点为 0 条
    await octokit.pulls.createReviewComment({
      owner: OWNER,
      repo: REPO,
      pull_number: prNumber,
      commit_id: headSha,
      path: filePath,
      line: 3,
      side: 'RIGHT',
      body: '🤖 [partial-failure-setup] 初始化 thread，将立即 resolve'
    })
    await octokit.pulls.createReviewComment({
      owner: OWNER,
      repo: REPO,
      pull_number: prNumber,
      commit_id: headSha,
      path: filePath,
      line: 4,
      side: 'RIGHT',
      body: '🤖 [partial-failure-setup] 初始化 thread，将立即 resolve'
    })

    botLogin = await getBotLogin({} as never)
    console.log(`✅ Bot 身份: ${botLogin}`)

    // 立即 resolve 初始 thread，保证后续各测试从 0 条未解决 thread 开始
    const initThreads = await fetchUnresolvedBotThreads(
      {owner: OWNER, repo: REPO, prNumber},
      botLogin
    )
    if (initThreads.length > 0) {
      await batchResolve(initThreads)
      console.log(`✅ 已 resolve ${initThreads.length} 条初始 thread，测试起点: 0 条未解决`)
    }
  }, 90_000)

  // ── Cleanup ──────────────────────────────────────────────────────────────────

  afterAll(async () => {
    try {
      await octokit.pulls.update({
        owner: OWNER, repo: REPO, pull_number: prNumber, state: 'closed'
      })
      console.log(`🧹 关闭 PR #${prNumber}`)
    } catch (e) {
      console.warn(`清理 PR 失败: ${e}`)
    }
    try {
      await octokit.git.deleteRef({owner: OWNER, repo: REPO, ref: `heads/${branchName}`})
      console.log(`🧹 删除分支 ${branchName}`)
    } catch (e) {
      console.warn(`清理分支失败: ${e}`)
    }
  }, 30_000)

  // ── P1: 全部失败 ─────────────────────────────────────────────────────────────

  test(
    'P1. 全部失败 — 单个假 thread ID → ok=0 failed=1，warning 含 path:line',
    async () => {
      const fakeThread = {
        id: 'PRRT_pf_fake_all_fail',
        isResolved: false,
        firstCommentAuthorLogin: botLogin,
        path: filePath,
        line: 3,
        firstCommentBody: '🤖 [P1] 模拟全部失败的假 thread'
      }

      const warnSpy = jest.spyOn(actionsCore, 'warning').mockImplementation(() => {})
      try {
        const {ok, failed, errors} = await batchResolve([fakeThread])
        console.log(`  结果: ok=${ok} failed=${failed}`)
        console.log(`  错误: ${errors[0]?.message}`)

        expect(ok).toBe(0)
        expect(failed).toBe(1)
        expect(errors).toHaveLength(1)

        expect(warnSpy).toHaveBeenCalledTimes(1)
        const msg = warnSpy.mock.calls[0][0] as string
        console.log(`  warning: ${msg}`)
        expect(msg).toMatch(/failed to resolve 1\/1/)
        expect(msg).toMatch(filePath)
        expect(msg).toMatch(/:3/)
        expect(msg).not.toMatch(/resolve_token/)
      } finally {
        warnSpy.mockRestore()
      }
    },
    30_000
  )

  // ── P2: 混合失败 ─────────────────────────────────────────────────────────────

  test(
    'P2. 混合失败 — 1 真实 thread + 1 假 ID → ok=1 failed=1，warning 只列失败项',
    async () => {
      // 添加 1 条真实 comment
      await octokit.pulls.createReviewComment({
        owner: OWNER,
        repo: REPO,
        pull_number: prNumber,
        commit_id: headSha,
        path: filePath,
        line: 4,
        side: 'RIGHT',
        body: '🤖 [P2] 混合失败测试 — 真实 thread'
      })

      const realThreads = await fetchUnresolvedBotThreads(
        {owner: OWNER, repo: REPO, prNumber},
        botLogin
      )
      expect(realThreads.length).toBe(1)
      console.log(`  真实 thread: ${realThreads[0].path}:${realThreads[0].line}`)

      const fakeThread = {
        id: 'PRRT_pf_fake_mixed',
        isResolved: false,
        firstCommentAuthorLogin: botLogin,
        path: filePath,
        line: 99,
        firstCommentBody: '🤖 [P2] 假 thread（必定失败）'
      }

      const warnSpy = jest.spyOn(actionsCore, 'warning').mockImplementation(() => {})
      try {
        const {ok, failed} = await batchResolve([...realThreads, fakeThread])
        console.log(`  结果: ok=${ok} failed=${failed}`)

        expect(ok).toBe(1)
        expect(failed).toBe(1)

        expect(warnSpy).toHaveBeenCalledTimes(1)
        const msg = warnSpy.mock.calls[0][0] as string
        console.log(`  warning: ${msg}`)
        expect(msg).toMatch(/failed to resolve 1\/2/)
        expect(msg).toMatch(/:99/)
        // 成功的 thread 不应出现在 warning 里
        expect(msg).not.toMatch(/:4/)
      } finally {
        warnSpy.mockRestore()
      }
    },
    30_000
  )

  // ── P3: 部分成功 ─────────────────────────────────────────────────────────────

  test(
    'P3. 部分成功 — 2 真实 thread + 2 假 ID → ok=2 failed=2，warning 汇总所有失败项',
    async () => {
      // 添加 2 条真实 comment（P2 的真实 thread 已被 resolve）
      await octokit.pulls.createReviewComment({
        owner: OWNER,
        repo: REPO,
        pull_number: prNumber,
        commit_id: headSha,
        path: filePath,
        line: 3,
        side: 'RIGHT',
        body: '🤖 [P3] 部分成功测试第一条'
      })
      await octokit.pulls.createReviewComment({
        owner: OWNER,
        repo: REPO,
        pull_number: prNumber,
        commit_id: headSha,
        path: filePath,
        line: 5,
        side: 'RIGHT',
        body: '🤖 [P3] 部分成功测试第二条'
      })

      const realThreads = await fetchUnresolvedBotThreads(
        {owner: OWNER, repo: REPO, prNumber},
        botLogin
      )
      expect(realThreads.length).toBe(2)
      console.log(`  真实 thread: ${realThreads.map(t => `${t.path}:${t.line}`).join(', ')}`)

      const fakeThreads = [
        {
          id: 'PRRT_pf_fake_partial_A',
          isResolved: false,
          firstCommentAuthorLogin: botLogin,
          path: filePath,
          line: 10,
          firstCommentBody: '🤖 [P3] 假 thread A'
        },
        {
          id: 'PRRT_pf_fake_partial_B',
          isResolved: false,
          firstCommentAuthorLogin: botLogin,
          path: filePath,
          line: 20,
          firstCommentBody: '🤖 [P3] 假 thread B'
        }
      ]

      const warnSpy = jest.spyOn(actionsCore, 'warning').mockImplementation(() => {})
      try {
        const {ok, failed, errors} = await batchResolve([...realThreads, ...fakeThreads])
        console.log(`  结果: ok=${ok} failed=${failed}`)

        expect(ok).toBe(2)
        expect(failed).toBe(2)
        expect(errors).toHaveLength(2)

        expect(warnSpy).toHaveBeenCalledTimes(1)
        const msg = warnSpy.mock.calls[0][0] as string
        console.log(`  warning:\n${msg}`)
        expect(msg).toMatch(/failed to resolve 2\/4/)
        expect(msg).toMatch(/:10/)
        expect(msg).toMatch(/:20/)
      } finally {
        warnSpy.mockRestore()
      }
    },
    30_000
  )
})
