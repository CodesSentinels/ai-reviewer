/**
 * gitlab-api-only-review.test.ts — GitLab API-only 审查编排（LOCAL-003）
 *
 * `local-tools-security.test.ts` 只证明了「lint 关掉后 orchestrator 返回空报告」，
 * 那不等于「审查还能跑完」。本文件真正跑一遍编排链：
 *
 *   codeReview() → getPlatform()(GitLabPlatform) → @gitbeaker/rest
 *
 * 条件是最严苛的 API-only：`enable_shell` / `enable_lint_tools` 均为 false，
 * 且工具安装与外部命令一旦被调用就让测试失败。断言审查确实**完成**了：
 * 读到 diff、读到文件内容、调了模型、把摘要发回 GitLab。
 *
 * 范围说明：GitLab trigger 入口尚未接入 codeReview（`gitlab-trigger.ts` 里仍是
 * `TODO: 待 GLAPI-* 补全后…`），那条边属于 §6 / REVIEW-001。因此本文件覆盖的是
 * 「编排层及以下」，`LINT-002` 要求的「GitLab trigger 测试环境」保持未完成。
 */
import {describe, expect, test, jest, beforeEach} from '@jest/globals'

// ─── gitbeaker：GitLab 侧唯一的出口 ─────────────────────────────────────────
const mockMergeRequests = {show: jest.fn<any>(), edit: jest.fn<any>(), allCommits: jest.fn<any>()}
const mockRepositories = {compare: jest.fn<any>(), allRepositoryTrees: jest.fn<any>()}
const mockRepositoryFiles = {show: jest.fn<any>()}
const mockMergeRequestNotes = {
  create: jest.fn<any>(),
  edit: jest.fn<any>(),
  remove: jest.fn<any>(),
  all: jest.fn<any>()
}
const mockMergeRequestDiscussions = {
  all: jest.fn<any>(),
  create: jest.fn<any>(),
  addNote: jest.fn<any>(),
  editNote: jest.fn<any>(),
  removeNote: jest.fn<any>(),
  resolve: jest.fn<any>()
}
jest.mock('@gitbeaker/rest', () => ({
  Gitlab: jest.fn().mockImplementation(() => ({
    MergeRequests: mockMergeRequests,
    Repositories: mockRepositories,
    RepositoryFiles: mockRepositoryFiles,
    MergeRequestNotes: mockMergeRequestNotes,
    MergeRequestDiscussions: mockMergeRequestDiscussions,
    MergeRequestNoteAwardEmojis: {award: jest.fn()},
    ProjectMembers: {show: jest.fn()},
    Users: {all: jest.fn(), showCurrentUser: jest.fn()}
  }))
}))

// ─── 本地工具：一旦被碰到就应当让用例失败 ───────────────────────────────────
const execState = {runCommand: jest.fn<any>()}
jest.mock('../src/lint/adapters/exec', () => ({
  runCommand: (...a: any[]) => execState.runCommand(...a)
}))
const installerState = {ensureToolInstalled: jest.fn<any>()}
jest.mock('../src/lint/tool-installer', () => ({
  ensureToolInstalled: (...a: any[]) => installerState.ensureToolInstalled(...a)
}))

// lint 子系统之外还有一条 fork 进程的路：analysis chain 的仓库 URL 兜底会
// `git config --get remote.origin.url`。上面两个 mock 都拦不到它，所以单独把
// child_process 也锁住——否则「零外部命令」只覆盖了 lint 那一半。
const childProcessState = {execFileSync: jest.fn<any>(() => '')}
jest.mock('child_process', () => ({
  execFileSync: (...a: any[]) => childProcessState.execFileSync(...a)
}))

jest.mock('@actions/core', () => ({
  info: jest.fn(),
  warning: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  setFailed: jest.fn(),
  getInput: jest.fn().mockReturnValue(''),
  getBooleanInput: jest.fn().mockReturnValue(false),
  getMultilineInput: jest.fn().mockReturnValue([])
}))

// review.ts 目前仍以 @actions/github 的 context 为主数据源（dual-track，ARCH-005
// 未完成）。这里提供 PR 形状的 payload，让编排层跑起来；真正的平台调用全部落到
// GitLabPlatform → gitbeaker
const mockContext: any = {
  eventName: 'pull_request',
  actor: 'someone',
  repo: {owner: 'group', repo: 'project'},
  payload: {
    action: 'opened',
    pull_request: {
      number: 7,
      title: 'API-only review',
      body: 'body',
      base: {sha: 'base-sha'},
      head: {sha: 'head-sha'}
    }
  }
}
jest.mock('@actions/github', () => ({context: mockContext}))
jest.mock('../src/tokenizer', () => ({getTokenCount: () => 1}))

import {Options} from '../src/options'
import {Prompts} from '../src/prompts'
import {codeReview} from '../src/review'
import {GitLabPlatform} from '../src/platform/gitlab-platform'
import {setPlatform, resetPlatform} from '../src/platform/git-platform'
import {setStateNamespace, resetStateNamespace} from '../src/platform/state-namespace'
import type {ExecutionContext} from '../src/platform/execution-context'

/** API-only：本地工具全关 */
function apiOnlyOptions(): Options {
  return new Options(
    false, // debug
    false, // disableReview
    true, // disableReleaseNotes
    '0', // maxFiles
    true, // reviewSimpleChanges
    false, // reviewCommentLGTM
    null, // pathFilters
    '', // systemMessage
    'gpt-5.4-nano',
    'gpt-5.4-mini',
    '0.0',
    '3',
    '120000',
    '6',
    '6',
    'https://api.openai.com/v1',
    'zh-CN',
    false, // enableDependencyAnalysis（走 API 但与本用例无关，关掉减少噪声）
    '50',
    false, // enableWebSearch
    false, // enableShell ← API-only
    false // enableLintTools ← API-only
  )
}

function makeBot(response: string): any {
  return {
    chat: jest
      .fn<() => Promise<[string, Record<string, unknown>, unknown[]]>>()
      .mockResolvedValue([response, {}, []])
  }
}

const execCtx: ExecutionContext = {
  platform: 'gitlab',
  eventKind: 'pr_opened',
  projectPath: 'group/project',
  changeRequestId: 7,
  headSha: 'head-sha',
  baseSha: 'base-sha',
  actor: {login: 'someone', isBot: false},
  raw: {}
} as unknown as ExecutionContext

beforeEach(() => {
  jest.clearAllMocks()
  resetPlatform()
  resetStateNamespace()

  setPlatform(
    new GitLabPlatform({
      host: 'https://gitlab.example.com',
      credential: {type: 'pat', value: 'glpat-test'},
      timeoutMS: 30_000
    })
  )
  setStateNamespace('gitlab')

  mockMergeRequests.show.mockResolvedValue({
    iid: 7,
    title: 'API-only review',
    description: 'body',
    state: 'opened',
    diff_refs: {base_sha: 'base-sha', head_sha: 'head-sha', start_sha: 'base-sha'},
    target_branch: 'main',
    source_branch: 'feat/x',
    author: {username: 'someone'}
  })
  mockMergeRequests.allCommits.mockResolvedValue([{id: 'head-sha'}])
  mockRepositories.compare.mockResolvedValue({
    diffs: [
      {
        old_path: 'src/foo.ts',
        new_path: 'src/foo.ts',
        diff: '@@ -1,3 +1,4 @@\n line1\n line2\n+added line\n line3'
      }
    ],
    commits: [{id: 'head-sha'}]
  })
  mockRepositoryFiles.show.mockResolvedValue({
    content: Buffer.from('line1\nline2\nline3').toString('base64')
  })
  mockMergeRequestNotes.all.mockResolvedValue([])
  mockMergeRequestNotes.create.mockResolvedValue({
    id: 900,
    body: 'summary',
    author: {username: 'gitlab-bot'},
    created_at: '2026-08-12T00:00:00Z'
  })
  mockMergeRequestDiscussions.all.mockResolvedValue([])
  mockRepositories.allRepositoryTrees.mockResolvedValue([])
})

describe('LOCAL-003: 本地工具全关时，GitLab 侧仍能完成 API-only 审查', () => {
  test('审查跑完整条链：读 diff → 读文件 → 调模型 → 发布摘要', async () => {
    const light = makeBot('[TRIAGE]: APPROVED\nLGTM')
    const heavy = makeBot('LGTM')

    await codeReview(execCtx, light, heavy, apiOnlyOptions(), new Prompts('', ''))

    // 1) diff 与文件内容都来自 GitLab API，不来自工作区
    expect(mockRepositories.compare).toHaveBeenCalled()
    // 2) 模型确实被调用（审查真的发生了，不是提前 return）
    expect(light.chat).toHaveBeenCalled()
    // 3) 摘要通过 GitLab Notes API 发布
    expect(mockMergeRequestNotes.create).toHaveBeenCalled()
    const publishedBodies = mockMergeRequestNotes.create.mock.calls.map((c: any[]) => c[2])
    expect(publishedBodies.join('\n')).toContain('ai-reviewer:gitlab:')
  })

  test('全程零工具安装、零外部命令（无外网也不受影响）', async () => {
    await codeReview(
      execCtx,
      makeBot('[TRIAGE]: APPROVED\nLGTM'),
      makeBot('LGTM'),
      apiOnlyOptions(),
      new Prompts('', '')
    )

    expect(installerState.ensureToolInstalled).not.toHaveBeenCalled()
    expect(execState.runCommand).not.toHaveBeenCalled()
  })

  test('写入的 marker 带 gitlab 命名空间，不与 GitHub 混用', async () => {
    await codeReview(
      execCtx,
      makeBot('[TRIAGE]: APPROVED\nLGTM'),
      makeBot('LGTM'),
      apiOnlyOptions(),
      new Prompts('', '')
    )

    const bodies = mockMergeRequestNotes.create.mock.calls.map((c: any[]) => c[2]).join('\n')
    expect(bodies).toContain('ai-reviewer:gitlab:')
    expect(bodies).not.toContain('ai-reviewer:github:')
  })

  /**
   * 这条是裸环境验收（scripts/bare-env-review-check.mjs）里诱饵工具抓出来的：
   * analysis chain 的仓库 URL 有一档兜底会 fork 一个 git 进程去读 origin。
   *
   * secret-bearing trigger 强制 `enable_shell=false`（LOCAL-001），这条路径却
   * 不看那个开关，等于给「强制关闭本地命令」留了个绕过口，而且执行的是 PATH
   * 上第一个 git。纯展示用途，不值得这个代价。
   */
  test('enableShell=false 时不 fork git 进程读 origin remote', async () => {
    await codeReview(
      execCtx,
      makeBot('[TRIAGE]: APPROVED\nLGTM'),
      makeBot('LGTM'),
      apiOnlyOptions(),
      new Prompts('', '')
    )

    expect(childProcessState.execFileSync).not.toHaveBeenCalled()
  })

  test('对照组：enableShell=true 时才会去读（证明上面不是因为路径没跑到）', async () => {
    const options = apiOnlyOptions()
    ;(options as any).enableShell = true

    await codeReview(
      execCtx,
      makeBot('[TRIAGE]: APPROVED\nLGTM'),
      makeBot('LGTM'),
      options,
      new Prompts('', '')
    )

    expect(childProcessState.execFileSync).toHaveBeenCalledWith(
      'git',
      ['config', '--get', 'remote.origin.url'],
      expect.anything()
    )
  })

  test('对照组：把 lint 打开就会触发工具链（证明上面的零调用不是空跑）', async () => {
    const options = apiOnlyOptions()
    // 直接改私有字段以复用同一条编排路径
    ;(options as any).enableLintTools = true
    installerState.ensureToolInstalled.mockResolvedValue({ok: true, binPath: '/tmp/x'})
    execState.runCommand.mockResolvedValue({exitCode: 0, stdout: '', stderr: ''})

    await codeReview(
      execCtx,
      makeBot('[TRIAGE]: APPROVED\nLGTM'),
      makeBot('LGTM'),
      options,
      new Prompts('', '')
    )

    expect(installerState.ensureToolInstalled).toHaveBeenCalled()
  })
})
