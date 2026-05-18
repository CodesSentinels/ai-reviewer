/**
 * resolve.integration.test.ts — resolve 命令真实 GitHub API 集成测试
 *
 * 运行方式:
 *   INTEGRATION=true npx jest resolve.integration --no-coverage --runInBand
 *
 * 前提:
 *   gh auth login 已完成（或 GITHUB_TOKEN 环境变量已设置）
 *
 * 流程:
 *   1. 在 ai-reviewer-test 仓库创建测试分支 + 文件
 *   2. 创建 PR
 *   3. 以当前 Token 身份（模拟 Bot）添加 review comment（产生 review thread）
 *   4. fetchUnresolvedBotThreads → 验证能找到该 thread
 *   5. batchResolve → 验证全部 resolved
 *   6. fetchUnresolvedBotThreads → 验证返回空列表
 *   7. 清理: 关闭 PR + 删除分支
 *
 * 注意: 此文件不 mock 任何模块，直接使用真实 GitHub API。
 */

// ─── Jest globals (explicit import required by this project's tsconfig) ───────

import {describe, expect, test, beforeAll, afterAll} from '@jest/globals'

// ─── Skip unless INTEGRATION=true ────────────────────────────────────────────

const describeIntegration = process.env.INTEGRATION ? describe : describe.skip

// ─── Real imports (no mocks) ──────────────────────────────────────────────────

import {execSync} from 'child_process'
import {octokit} from '../src/octokit'
import {
  getBotLogin,
  fetchUnresolvedBotThreads,
  batchResolve,
  _resetBotLoginCache
} from '../src/github/review-thread'

// ─── Config ───────────────────────────────────────────────────────────────────

const OWNER = 'CodesSentinels'
const REPO = 'ai-reviewer-test'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getGithubToken(): string {
  // 1. Explicit env var
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN
  // 2. gh CLI
  try {
    return execSync('gh auth token', {encoding: 'utf8'}).trim()
  } catch {
    throw new Error('No GitHub token found. Run `gh auth login` or set GITHUB_TOKEN.')
  }
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describeIntegration('resolve command — integration with GitHub API', () => {
  let prNumber: number
  let branchName: string
  let filePath: string
  let headSha: string
  let botLogin: string

  // ── Setup ────────────────────────────────────────────────────────────────────

  beforeAll(async () => {
    // Inject token so octokit (loaded at module level) can authenticate
    const token = getGithubToken()
    process.env.GITHUB_TOKEN = token

    _resetBotLoginCache()

    // Step 1: get default branch SHA ─────────────────────────────────────────
    const {data: repo} = await octokit.repos.get({owner: OWNER, repo: REPO})
    const defaultBranch = repo.default_branch

    const {data: ref} = await octokit.git.getRef({
      owner: OWNER,
      repo: REPO,
      ref: `heads/${defaultBranch}`
    })
    const baseSha = ref.object.sha

    // Step 2: create test branch ──────────────────────────────────────────────
    branchName = `test/resolve-integration-${Date.now()}`
    await octokit.git.createRef({
      owner: OWNER,
      repo: REPO,
      ref: `refs/heads/${branchName}`,
      sha: baseSha
    })
    console.log(`✅ 创建分支: ${branchName}`)

    // Step 3: push a test file ────────────────────────────────────────────────
    filePath = `integration-tests/resolve-${Date.now()}.ts`
    const fileContent = [
      '// Integration test file — safe to delete',
      `// Created: ${new Date().toISOString()}`,
      'export const testValue = 42',
      'export function greet(name: string): string {',
      '  return `Hello, ${name}!`',
      '}'
    ].join('\n')

    const {data: fileData} = await octokit.repos.createOrUpdateFileContents({
      owner: OWNER,
      repo: REPO,
      path: filePath,
      message: 'test: add integration test file for resolve command',
      content: Buffer.from(fileContent).toString('base64'),
      branch: branchName
    })
    headSha = fileData.commit.sha ?? ''
    console.log(`✅ 创建文件: ${filePath} (commit: ${headSha.slice(0, 7)})`)

    // Step 4: create PR ───────────────────────────────────────────────────────
    const {data: pr} = await octokit.pulls.create({
      owner: OWNER,
      repo: REPO,
      title: '[TEST] resolve command integration test — safe to close',
      body: [
        '> ⚠️ 此 PR 由集成测试自动创建，测试完成后会自动关闭。',
        '',
        '## 测试目的',
        '验证 `@codesentinel resolve` 命令能正确批量解决 Bot 发出的 review threads。'
      ].join('\n'),
      head: branchName,
      base: defaultBranch
    })
    prNumber = pr.number
    console.log(`✅ 创建 PR: #${prNumber} (${pr.html_url})`)

    // Step 5: add review comment as the current token identity ────────────────
    // The token holder IS the "bot" in this integration test.
    // fetchUnresolvedBotThreads filters by getAuthenticated().login,
    // which matches the author of these comments.
    await octokit.pulls.createReviewComment({
      owner: OWNER,
      repo: REPO,
      pull_number: prNumber,
      commit_id: headSha,
      path: filePath,
      line: 3,
      side: 'RIGHT',
      body: '🤖 [集成测试] 第一条审查意见 — 测试 resolve 命令'
    })

    await octokit.pulls.createReviewComment({
      owner: OWNER,
      repo: REPO,
      pull_number: prNumber,
      commit_id: headSha,
      path: filePath,
      line: 5,
      side: 'RIGHT',
      body: '🤖 [集成测试] 第二条审查意见 — 测试 resolve 命令'
    })

    botLogin = await getBotLogin({} as never)
    console.log(`✅ 已添加 2 条 review comments（身份: ${botLogin}）`)
  }, 90_000)

  // ── Cleanup ──────────────────────────────────────────────────────────────────

  afterAll(async () => {
    try {
      await octokit.pulls.update({
        owner: OWNER,
        repo: REPO,
        pull_number: prNumber,
        state: 'closed'
      })
      console.log(`🧹 关闭 PR #${prNumber}`)
    } catch (e) {
      console.warn(`清理 PR 失败: ${e}`)
    }
    try {
      await octokit.git.deleteRef({
        owner: OWNER,
        repo: REPO,
        ref: `heads/${branchName}`
      })
      console.log(`🧹 删除分支 ${branchName}`)
    } catch (e) {
      console.warn(`清理分支失败: ${e}`)
    }
  }, 30_000)

  // ── Tests ─────────────────────────────────────────────────────────────────────

  test(
    '1. fetchUnresolvedBotThreads 能找到 Bot 发出的 2 条未解决 review thread',
    async () => {
      const threads = await fetchUnresolvedBotThreads(
        {owner: OWNER, repo: REPO, prNumber},
        botLogin
      )

      console.log(`  找到 ${threads.length} 条未解决 thread`)
      threads.forEach((t, i) =>
        console.log(`  Thread[${i}]: id=${t.id} isResolved=${t.isResolved} author=${t.firstCommentAuthorLogin}`)
      )

      expect(threads.length).toBe(2)
      expect(threads.every(t => !t.isResolved)).toBe(true)
      expect(threads.every(t => t.firstCommentAuthorLogin === botLogin)).toBe(true)
    },
    30_000
  )

  test(
    '2. batchResolve 能将所有 thread 标记为已解决，返回 ok=2 failed=0',
    async () => {
      const threads = await fetchUnresolvedBotThreads(
        {owner: OWNER, repo: REPO, prNumber},
        botLogin
      )

      const {ok, failed} = await batchResolve(threads)
      console.log(`  resolve 结果: ok=${ok} failed=${failed}`)

      expect(failed).toBe(0)
      expect(ok).toBe(2)
    },
    30_000
  )

  test(
    '3. resolve 完成后 fetchUnresolvedBotThreads 返回空列表',
    async () => {
      const threads = await fetchUnresolvedBotThreads(
        {owner: OWNER, repo: REPO, prNumber},
        botLogin
      )

      console.log(`  resolve 后剩余未解决 thread: ${threads.length}`)
      expect(threads.length).toBe(0)
    },
    30_000
  )
})
