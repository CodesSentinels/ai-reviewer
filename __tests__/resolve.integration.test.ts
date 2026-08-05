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
import * as actionsCore from '@actions/core'
import {octokit} from '../src/octokit'
import {setPlatform} from '../src/platform/git-platform'
import {GitHubPlatform} from '../src/platform/github-platform'
import {setLogger} from '../src/platform/logger'
import {GitHubLogger} from '../src/platform/github-logger'
import {
  getBotLogin,
  fetchUnresolvedBotThreads,
  batchResolve,
  _resetBotLoginCache
} from '../src/github/review-thread'
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
  try {
    const t = execSync('gh auth token', {encoding: 'utf8'}).trim()
    if (t) return t
  } catch {}
  // gh < 2.4: reads config file directly
  try {
    const t = execSync('gh config get -h github.com oauth_token', {
      encoding: 'utf8'
    }).trim()
    if (t) return t
  } catch {}
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

    // ARCH-018: review-thread.ts now uses getPlatform(), need to set it up
    setLogger(new GitHubLogger())
    setPlatform(new GitHubPlatform())

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

  test('1. fetchUnresolvedBotThreads 能找到 Bot 发出的 2 条未解决 review thread，且 path/line/firstCommentBody 已填充', async () => {
    const threads = await fetchUnresolvedBotThreads({owner: OWNER, repo: REPO, prNumber}, botLogin)

    console.log(`  找到 ${threads.length} 条未解决 thread`)
    threads.forEach((t, i) =>
      console.log(
        `  Thread[${i}]: id=${t.id} isResolved=${t.isResolved} author=${t.firstCommentAuthorLogin}` +
          ` path=${t.path} line=${t.line} body="${t.firstCommentBody?.slice(0, 40)}"`
      )
    )

    expect(threads.length).toBe(2)
    expect(threads.every(t => !t.isResolved)).toBe(true)
    expect(threads.every(t => t.firstCommentAuthorLogin === botLogin)).toBe(true)

    // 新字段断言
    expect(threads.every(t => t.path === filePath)).toBe(true)
    expect(threads.map(t => t.line).sort()).toEqual([3, 5])
    expect(
      threads.every(t => typeof t.firstCommentBody === 'string' && t.firstCommentBody.length > 0)
    ).toBe(true)
    expect(threads.some(t => t.firstCommentBody?.includes('第一条审查意见'))).toBe(true)
    expect(threads.some(t => t.firstCommentBody?.includes('第二条审查意见'))).toBe(true)
  }, 30_000)

  test('2. batchResolve 将所有 thread 标记为已解决，resolve 后 fetch 返回空列表', async () => {
    const threads = await fetchUnresolvedBotThreads({owner: OWNER, repo: REPO, prNumber}, botLogin)

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
  }, 30_000)

  test('5. batchResolve 全部失败（无效 thread ID）→ failed=1 ok=0，warning 输出 path:line 标签', async () => {
    const fakeThread = {
      id: 'PRRT_nonexistent_fake_id_for_test',
      isResolved: false,
      firstCommentAuthorLogin: botLogin,
      path: filePath,
      line: 3,
      firstCommentBody: '🤖 [集成测试-T5] 模拟解决失败用的假 thread'
    }

    const warnSpy = jest.spyOn(actionsCore, 'warning').mockImplementation(() => {})
    try {
      const {ok, failed, errors} = await batchResolve([fakeThread])
      console.log(`  batchResolve 结果: ok=${ok} failed=${failed} errorMsg="${errors[0]?.message}"`)

      expect(ok).toBe(0)
      expect(failed).toBe(1)
      expect(errors).toHaveLength(1)

      // 非权限错误 → warning 含 path:line，不含 resolve_token 指引
      expect(warnSpy).toHaveBeenCalledTimes(1)
      const msg = warnSpy.mock.calls[0][0] as string
      console.log(`  warning: ${msg}`)
      expect(msg).toMatch(filePath)
      expect(msg).toMatch(/:3/)
      expect(msg).not.toMatch(/resolve_token/)
    } finally {
      warnSpy.mockRestore()
    }
  }, 30_000)

  test('6. batchResolve 混合失败 — 真实 thread + 无效 ID → ok=1 failed=1，warning 只列出失败项', async () => {
    // 新增 1 条真实 review comment
    await octokit.pulls.createReviewComment({
      owner: OWNER,
      repo: REPO,
      pull_number: prNumber,
      commit_id: headSha,
      path: filePath,
      line: 4,
      side: 'RIGHT',
      body: '🤖 [集成测试-T6] 混合测试用真实 thread'
    })
    const realThreads = await fetchUnresolvedBotThreads(
      {owner: OWNER, repo: REPO, prNumber},
      botLogin
    )
    expect(realThreads.length).toBe(1)
    console.log(`  获取到真实 thread: path=${realThreads[0].path} line=${realThreads[0].line}`)

    const fakeThread = {
      id: 'PRRT_nonexistent_fake_id_for_mixed_test',
      isResolved: false,
      firstCommentAuthorLogin: botLogin,
      path: filePath,
      line: 99,
      firstCommentBody: '🤖 [集成测试-T6] 模拟失败项'
    }

    const warnSpy = jest.spyOn(actionsCore, 'warning').mockImplementation(() => {})
    try {
      const {ok, failed} = await batchResolve([...realThreads, fakeThread])
      console.log(`  batchResolve 结果: ok=${ok} failed=${failed}`)

      expect(ok).toBe(1)
      expect(failed).toBe(1)

      expect(warnSpy).toHaveBeenCalledTimes(1)
      const msg = warnSpy.mock.calls[0][0] as string
      console.log(`  warning: ${msg}`)
      expect(msg).toMatch(/:99/)
      expect(msg).toMatch(/failed to resolve 1\/2/)
    } finally {
      warnSpy.mockRestore()
    }
  }, 30_000)

  test('7. batchResolve 部分成功 — 2 真实 thread + 2 无效 ID → ok=2 failed=2，warning 汇总列出全部失败项', async () => {
    // 新增 2 条真实 review comment
    await octokit.pulls.createReviewComment({
      owner: OWNER,
      repo: REPO,
      pull_number: prNumber,
      commit_id: headSha,
      path: filePath,
      line: 3,
      side: 'RIGHT',
      body: '🤖 [集成测试-T7] 部分成功测试第一条'
    })
    await octokit.pulls.createReviewComment({
      owner: OWNER,
      repo: REPO,
      pull_number: prNumber,
      commit_id: headSha,
      path: filePath,
      line: 5,
      side: 'RIGHT',
      body: '🤖 [集成测试-T7] 部分成功测试第二条'
    })

    const realThreads = await fetchUnresolvedBotThreads(
      {owner: OWNER, repo: REPO, prNumber},
      botLogin
    )
    expect(realThreads.length).toBe(2)

    const fakeThreads = [
      {
        id: 'PRRT_fake_partial_success_1',
        isResolved: false,
        firstCommentAuthorLogin: botLogin,
        path: filePath,
        line: 10,
        firstCommentBody: '🤖 [集成测试-T7] 假 thread A'
      },
      {
        id: 'PRRT_fake_partial_success_2',
        isResolved: false,
        firstCommentAuthorLogin: botLogin,
        path: filePath,
        line: 20,
        firstCommentBody: '🤖 [集成测试-T7] 假 thread B'
      }
    ]

    const warnSpy = jest.spyOn(actionsCore, 'warning').mockImplementation(() => {})
    try {
      const {ok, failed, errors} = await batchResolve([...realThreads, ...fakeThreads])
      console.log(`  batchResolve 结果: ok=${ok} failed=${failed}`)

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
  }, 30_000)

  test('4. 用户 @mention "@ai-reviewer resolve" → dispatchCommentEvent 完整走通，threads 被批量 resolve', async () => {
    if (/\[bot\]$/i.test(botLogin)) {
      console.log(
        `  ⚠️  跳过 E2E dispatch 测试: token 身份 "${botLogin}" 是 Bot，` +
          '调度器会过滤 Bot 自评论。请使用个人 PAT 运行此测试。'
      )
      return
    }

    _resetPermissionCache()
    _resetRateLimit()

    // 添加 2 条新的 review comments
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

    const {data: triggerComment} = await octokit.issues.createComment({
      owner: OWNER,
      repo: REPO,
      issue_number: prNumber,
      body: '@ai-reviewer resolve'
    })
    console.log(`  触发评论已创建: id=${triggerComment.id}`)

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

    const result = await dispatchCommentEvent({options: {} as never})
    console.log(`  dispatch 结果: ${JSON.stringify(result)}`)

    expect(result.kind).toBe('executed')
    if (result.kind === 'executed') {
      expect(result.command).toBe('resolve')
      expect(result.ok).toBe(true)
    }

    const remaining = await fetchUnresolvedBotThreads(
      {owner: OWNER, repo: REPO, prNumber},
      botLogin
    )
    console.log(`  resolve 后剩余未解决 thread: ${remaining.length}`)
    expect(remaining.length).toBe(0)
  }, 60_000)
})
