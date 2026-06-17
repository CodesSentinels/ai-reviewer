/**
 * resolve.integration.test.ts — resolve 命令真实 GitHub API 集成测试
 *
 * 运行方式:
 *   GITHUB_TOKEN=<token> INTEGRATION=true npx jest resolve.integration --no-coverage --runInBand
 *
 * 前提:
 *   GITHUB_TOKEN 必须在运行前设置（@octokit/auth-action 在模块加载时检查，beforeAll 已太晚）
 *
 * 流程:
 *   beforeAll: 创建分支 → 推文件 → 建 PR → 以当前 Token 身份添加 2 条 review comment
 *   Test 1: fetchUnresolvedBotThreads 能找到 2 条未解决 thread
 *   Test 2: batchResolve 解决所有 thread，再 fetch 验证返回空（原子断言，无跨 test 依赖）
 *   Test 3: 测试体内新增 2 条 comment，resolveAllBotComments 完整解决（外部 API 验证）
 *   Test 4: 用户在 PR 上 @mention "@ai-reviewer resolve" → dispatchCommentEvent 完整走通 → threads 被 resolve
 *   afterAll: 关闭 PR + 删除分支
 *
 * 注意: src/octokit 被替换为 @octokit/core 实例（绕过 @octokit/auth-action 的 Actions 环境检查），
 *       测试仍调用真实的 GitHub API，不 mock 任何网络请求。
 *       必须以 --runInBand 顺序运行，测试间共享同一个 PR。
 *       Test 4 需要 PAT（非 GitHub Actions GITHUB_TOKEN），因为调度器会过滤 Bot 自评论；
 *       若检测到 token 身份含 [bot] 则自动跳过并打印提示。
 */

// ─── Jest globals (explicit import required by this project's tsconfig) ───────

import {describe, expect, test, beforeAll, afterAll, jest} from '@jest/globals'

// ─── Skip unless INTEGRATION=true ────────────────────────────────────────────

const describeIntegration = process.env.INTEGRATION ? describe : describe.skip

// ─── Mock @actions/github context (mutated per-test in the E2E test) ──────────
// Must be declared before jest.mock so the factory closure captures the binding.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockGHContext: any = {
  eventName: 'issue_comment',
  payload: {},
  repo: {owner: 'CodesSentinels', repo: 'ai-reviewer-test'}
}

jest.mock('@actions/github', () => ({
  context: mockGHContext
}))

// ─── Replace src/octokit with a real @octokit/core instance ──────────────────
// @octokit/action uses @octokit/auth-action which requires the GITHUB_ACTIONS
// environment. Swapping it for @octokit/core lets integration tests run locally
// while still hitting the real GitHub API.

jest.mock('../src/octokit', () => {
  // Use @octokit/action's Octokit unchanged (all plugins: REST, paginate, graphql, retry…).
  // The lazy getter runs inside beforeAll, where both env vars are already present:
  //   GITHUB_ACTION — set by setup-node-globals.js (before any module loads)
  //   GITHUB_TOKEN  — set by beforeAll via getGithubToken() before first octokit access
  // So createActionAuth() inside new Octokit() passes its env checks without modification.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const {Octokit} = require('@octokit/action')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let _instance: any = null

  return {
    get octokit() {
      if (!_instance) {
        if (!process.env.GITHUB_TOKEN) {
          throw new Error(
            'GITHUB_TOKEN must be set before running integration tests.\n' +
              'Usage: GITHUB_TOKEN=<token> INTEGRATION=true npx jest resolve.integration --no-coverage --runInBand'
          )
        }
        _instance = new Octokit()
      }
      return _instance
    }
  }
})

// ─── Imports (after mock registration) ───────────────────────────────────────

import {execSync} from 'child_process'
import {octokit} from '../src/octokit'
import {
  getBotLogin,
  fetchUnresolvedBotThreads,
  batchResolve,
  _resetBotLoginCache
} from '../src/github/review-thread'
import {resolveAllBotComments} from '../src/commands/handlers/resolve'
import {dispatchCommentEvent} from '../src/commands/dispatcher'
import {bootstrapCommands, _resetBootstrap} from '../src/commands/bootstrap'
import {_resetPermissionCache} from '../src/commands/permission'
import {_resetRateLimit} from '../src/commands/rate-limit'

// ─── Config ───────────────────────────────────────────────────────────────────

const OWNER = 'CodesSentinels'
const REPO = 'ai-reviewer-test'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getGithubToken(): string {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN
  // gh >= 2.x: gh auth token
  try { const t = execSync('gh auth token', {encoding: 'utf8'}).trim(); if (t) return t } catch {}
  // gh < 2.4: reads config file directly
  try { const t = execSync('gh config get -h github.com oauth_token', {encoding: 'utf8'}).trim(); if (t) return t } catch {}
  throw new Error(
    'No GitHub token found. Provide one via:\n' +
      '  GITHUB_TOKEN=<pat> INTEGRATION=true npx jest resolve.integration --no-coverage --runInBand'
  )
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
    // Set GITHUB_TOKEN before first octokit access (lazy getter reads it on first use)
    process.env.GITHUB_TOKEN = getGithubToken()
    _resetBotLoginCache()

    // Bootstrap command registry (needed by dispatchCommentEvent in Test 4)
    _resetBootstrap()
    bootstrapCommands()

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

  test(
    '4. 用户 @mention "@ai-reviewer resolve" → dispatchCommentEvent 完整走通，threads 被批量 resolve',
    async () => {
      // Test 4 requires a PAT: the dispatcher filters out Bot self-comments
      // (comment.user.type === 'Bot' or login ends with [bot]).
      // With a human PAT, botLogin is a plain username and can act as both
      // the review-comment author and the @mention actor.
      if (/\[bot\]$/i.test(botLogin)) {
        console.log(
          `  ⚠️  跳过 E2E dispatch 测试: token 身份 "${botLogin}" 是 Bot，` +
            '调度器会过滤 Bot 自评论。请使用个人 PAT 运行此测试。'
        )
        return
      }

      _resetPermissionCache()
      _resetRateLimit()

      // 添加 2 条新的 review comments（前几个 test 已全部 resolve 完）
      await octokit.pulls.createReviewComment({
        owner: OWNER,
        repo: REPO,
        pull_number: prNumber,
        commit_id: headSha,
        path: filePath,
        line: 3,
        side: 'RIGHT',
        body: '🤖 [集成测试-T4] E2E dispatch 第一条审查意见'
      })
      await octokit.pulls.createReviewComment({
        owner: OWNER,
        repo: REPO,
        pull_number: prNumber,
        commit_id: headSha,
        path: filePath,
        line: 5,
        side: 'RIGHT',
        body: '🤖 [集成测试-T4] E2E dispatch 第二条审查意见'
      })
      console.log('  已添加 2 条新 review comments')

      // 用户在 PR 上发评论 "@ai-reviewer resolve"（触发评论）
      const {data: triggerComment} = await octokit.issues.createComment({
        owner: OWNER,
        repo: REPO,
        issue_number: prNumber,
        body: '@ai-reviewer resolve'
      })
      console.log(`  触发评论已创建: id=${triggerComment.id}`)

      // 构造 webhook context，模拟 GitHub 发送的 issue_comment 事件
      // actor = botLogin（PAT 持有者），type='User' 绕过 Bot 自评论过滤
      // isPrAuthor = true（issue.user.login === comment.user.login），提供额外的权限豁免路径
      mockGHContext.eventName = 'issue_comment'
      mockGHContext.repo = {owner: OWNER, repo: REPO}
      mockGHContext.payload = {
        action: 'created',
        issue: {
          number: prNumber,
          pull_request: {},
          user: {login: botLogin}
        },
        comment: {
          id: triggerComment.id,
          body: '@ai-reviewer resolve',
          user: {login: botLogin, type: 'User'}
        }
      }

      // 执行完整调度链：parser → 权限校验 → ACK → handler.execute → reply.success
      const result = await dispatchCommentEvent({options: {} as never})
      console.log(`  dispatch 结果: ${JSON.stringify(result)}`)

      expect(result.kind).toBe('executed')
      if (result.kind === 'executed') {
        expect(result.command).toBe('resolve')
        expect(result.ok).toBe(true)
      }

      // 验证 threads 已真实 resolve
      const remaining = await fetchUnresolvedBotThreads(
        {owner: OWNER, repo: REPO, prNumber},
        botLogin
      )
      console.log(`  resolve 后剩余未解决 thread: ${remaining.length}`)
      expect(remaining.length).toBe(0)
    },
    60_000
  )

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
    '2. batchResolve 将所有 thread 标记为已解决，resolve 后 fetch 返回空列表',
    async () => {
      // fetch → resolve → re-fetch，在同一个 test 内验证前后状态，无跨 test 依赖
      const threads = await fetchUnresolvedBotThreads(
        {owner: OWNER, repo: REPO, prNumber},
        botLogin
      )

      const {ok, failed} = await batchResolve(threads)
      console.log(`  resolve 结果: ok=${ok} failed=${failed}`)
      expect(ok).toBe(2)
      expect(failed).toBe(0)

      const remaining = await fetchUnresolvedBotThreads(
        {owner: OWNER, repo: REPO, prNumber},
        botLogin
      )
      console.log(`  resolve 后剩余未解决 thread: ${remaining.length}`)
      expect(remaining.length).toBe(0)
    },
    30_000
  )

  test(
    '3. resolveAllBotComments 对外接口：新增 thread 后能完整 resolve，返回 ok=2 failed=0',
    async () => {
      // 此时 PR 上已无未解决 thread（Test 2 已全部解决）。
      // 在测试体内新增 2 条 review comment，使 resolveAllBotComments 有内容可操作。
      await octokit.pulls.createReviewComment({
        owner: OWNER,
        repo: REPO,
        pull_number: prNumber,
        commit_id: headSha,
        path: filePath,
        line: 3,
        side: 'RIGHT',
        body: '🤖 [集成测试-T3] resolveAllBotComments 第一条'
      })
      await octokit.pulls.createReviewComment({
        owner: OWNER,
        repo: REPO,
        pull_number: prNumber,
        commit_id: headSha,
        path: filePath,
        line: 5,
        side: 'RIGHT',
        body: '🤖 [集成测试-T3] resolveAllBotComments 第二条'
      })
      console.log('  已新增 2 条 review comment')

      const {ok, failed} = await resolveAllBotComments({
        owner: OWNER,
        repo: REPO,
        prNumber,
        options: {} as never
      })
      console.log(`  resolveAllBotComments 结果: ok=${ok} failed=${failed}`)
      expect(ok).toBe(2)
      expect(failed).toBe(0)
    },
    30_000
  )
})
