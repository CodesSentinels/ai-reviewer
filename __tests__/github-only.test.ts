/**
 * github-only.test.ts — GitHub-only 独立运行回归（GH-016 / GH-017）
 *
 * 双平台改造的第一条原则：GitHub 与 GitLab 必须能各自独立运行。
 * 这里从三个层面证明「没有任何 GitLab 配置」和「GitLab 完全不可达」时，
 * GitHub 侧不受影响：
 *
 * 1. **静态**：从 src/main.ts 出发的 import 图里不存在任何 GitLab 模块，
 *    打出来的 dist/index.js 里也没有 GitLab 运行时代码
 * 2. **配置**：清空全部 GITLAB_* / CI_* 变量后 Action 仍能正常分发事件
 * 3. **故障注入**：GitLab 配置存在但 SDK 一加载就抛错时，GitHub 流程照常跑完
 */
import {describe, expect, test, jest, beforeEach, afterEach} from '@jest/globals'
import * as fs from 'fs'
import * as path from 'path'
import prOpenedFixture from './characterization/fixtures/pr-opened.json'

const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'src')

// ─── 静态分析：main.ts 的传递 import 图（GH-016）──────────────────────────────

/**
 * 解析一个源文件引用的全部模块说明符。
 *
 * 覆盖四种形态，缺一就会出现假阴性：
 *   import x from 'm' / export {x} from 'm' / await import('m') / require('m')
 * 注释里的示例（dependency-analyzer.ts 文档里就有 require('./module')）先剥掉。
 */
export function importSpecsOf(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const specs: string[] = []
  for (const pattern of [
    /(?:^|[^\w$])(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g,
    /(?:^|[^\w$])require\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  ]) {
    for (const m of code.matchAll(pattern)) specs.push(m[1])
  }
  return specs
}

function localImportsOf(file: string): string[] {
  return importSpecsOf(fs.readFileSync(file, 'utf8')).filter(s => s.startsWith('.'))
}

function packageImportsOf(file: string): string[] {
  return importSpecsOf(fs.readFileSync(file, 'utf8')).filter(s => !s.startsWith('.'))
}

function resolveLocal(fromFile: string, spec: string): string | null {
  const base = path.resolve(path.dirname(fromFile), spec)
  for (const candidate of [`${base}.ts`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

/** 从入口出发收集全部可达的本地模块 + 外部包 */
function moduleGraph(entry: string): {files: Set<string>; packages: Set<string>} {
  const files = new Set<string>()
  const packages = new Set<string>()
  const stack = [entry]
  while (stack.length > 0) {
    const file = stack.pop() as string
    if (files.has(file)) continue
    files.add(file)
    for (const pkg of packageImportsOf(file)) packages.add(pkg)
    for (const spec of localImportsOf(file)) {
      const resolved = resolveLocal(file, spec)
      if (resolved != null) stack.push(resolved)
    }
  }
  return {files, packages}
}

describe('GH-016: GitHub 入口不依赖任何 GitLab 实现', () => {
  const graph = moduleGraph(path.join(SRC, 'main.ts'))

  test('解析器覆盖 import / export-from / 动态 import / require 四种形态', () => {
    const sample = [
      "import a from '@pkg/one'",
      "export {b} from './local-b'",
      "const c = await import('@pkg/two')",
      "const d = require('@pkg/three')",
      "// require('@pkg/in-comment') 不应被算进来",
      "/* import '@pkg/in-block-comment' */"
    ].join('\n')

    expect(importSpecsOf(sample).sort()).toEqual([
      './local-b',
      '@pkg/one',
      '@pkg/three',
      '@pkg/two'
    ])
  })

  test('import 图非空（防止解析失败导致假通过）', () => {
    expect(graph.files.size).toBeGreaterThan(20)
    expect(graph.packages.size).toBeGreaterThan(3)
  })

  test('可达模块中不存在任何 GitLab 实现文件', () => {
    const gitlabFiles = [...graph.files]
      .map(f => path.relative(SRC, f).replace(/\\/g, '/'))
      .filter(rel => /(^|\/)gitlab-/.test(rel))
    expect(gitlabFiles).toEqual([])
  })

  test('可达依赖中不存在 @gitbeaker', () => {
    expect([...graph.packages].filter(p => p.startsWith('@gitbeaker'))).toEqual([])
  })

  test('对照：GitLab 入口反过来也不依赖 GitHub 实现', () => {
    const gitlabGraph = moduleGraph(path.join(SRC, 'gitlab-trigger.ts'))
    const githubFiles = [...gitlabGraph.files]
      .map(f => path.relative(SRC, f).replace(/\\/g, '/'))
      .filter(rel => /(^|\/)github-/.test(rel) || rel === 'octokit.ts')
    expect(githubFiles).toEqual([])
    expect([...gitlabGraph.packages].filter(p => p.startsWith('@octokit'))).toEqual([])
  })
})

describe('GH-016: 打包产物不含 GitLab 运行时代码', () => {
  const bundlePath = path.join(ROOT, 'dist/index.js')

  test('dist/index.js 存在', () => {
    expect(fs.existsSync(bundlePath)).toBe(true)
  })

  test('GitHub bundle 里没有 gitbeaker 运行时标识（注释提及不算）', () => {
    const code = fs
      .readFileSync(bundlePath, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')

    for (const marker of ['GitbeakerRequestError', 'GitbeakerTimeoutError', 'new Gitlab(']) {
      expect(code).not.toContain(marker)
    }
  })

  test('GitHub bundle 里没有 GitLabPlatform 实现', () => {
    const code = fs.readFileSync(bundlePath, 'utf8')
    expect(code).not.toContain('class GitLabPlatform')
  })
})

// ─── 运行时：无 GitLab 配置 / GitLab 不可达（GH-016 / GH-017）─────────────────

const GITLAB_ENV_KEYS = [
  'GITLAB_PAT',
  'GITLAB_HOST',
  'GITLAB_BOT_USERNAME',
  'CI_SERVER_URL',
  'CI_JOB_TOKEN',
  'CI_PIPELINE_SOURCE',
  'CI_COMMIT_SHA',
  'TRIGGER_PAYLOAD',
  'AI_REVIEWER_GITLAB_TIMEOUT_MS'
]

const coreState = {
  getInput: jest.fn<(name: string) => string>(),
  getBooleanInput: jest.fn<any>(),
  getMultilineInput: jest.fn<any>(),
  info: jest.fn(),
  warning: jest.fn(),
  error: jest.fn(),
  setFailed: jest.fn()
}
jest.mock('@actions/core', () => ({
  getInput: (...a: any[]) => coreState.getInput(...(a as [string])),
  getBooleanInput: (...a: any[]) => coreState.getBooleanInput(...a),
  getMultilineInput: (...a: any[]) => coreState.getMultilineInput(...a),
  info: (...a: any[]) => coreState.info(...a),
  warning: (...a: any[]) => coreState.warning(...a),
  error: (...a: any[]) => coreState.error(...a),
  setFailed: (...a: any[]) => coreState.setFailed(...a)
}))

const mockContext: any = {
  eventName: 'pull_request',
  actor: 'human',
  payload: {...prOpenedFixture, action: 'opened'},
  repo: {owner: 'octo', repo: 'demo'}
}
jest.mock('@actions/github', () => ({context: mockContext}))

// GH-017：GitLab SDK 一旦被加载就抛错，等价于「GitLab 完全不可达」的最坏情况
const gitbeakerLoads = {count: 0}
jest.mock('@gitbeaker/rest', () => {
  gitbeakerLoads.count++
  throw new Error('GitLab API unreachable — @gitbeaker must not be loaded on the GitHub path')
})

const botInstance = {chat: jest.fn(), reviewFilesInBatch: jest.fn()}
jest.mock('../src/bot', () => ({Bot: jest.fn().mockImplementation(() => botInstance)}))

const reviewState = {codeReview: jest.fn<(...a: any[]) => Promise<void>>()}
jest.mock('../src/review', () => ({codeReview: (...a: any[]) => reviewState.codeReview(...a)}))

const commandHandlerState = {handleCommentEvent: jest.fn<(...a: any[]) => Promise<void>>()}
jest.mock('../src/command-handler', () => ({
  handleCommentEvent: (...a: any[]) => commandHandlerState.handleCommentEvent(...a)
}))

// STATE-013 在共享分发层加了一道「这个 HEAD 审过没有」的门禁，它会真的调
// octokit.issues.listComments。本文件刻意不搭 GitHub API 替身（它测的是「GitLab
// 缺席/故障时 GitHub 路径照常」），那次调用会真发 HTTP 然后挂住，表现成
// codeReview never called。幂等本身有专门的用例覆盖，这里直接短路掉。
jest.mock('../src/review-idempotency', () => ({
  hasHeadBeenReviewed: async () => false,
  buildReviewIdempotencyKey: () => 'stub-key'
}))

const earlyReactionState = {tryEarlyReaction: jest.fn<(...a: any[]) => Promise<void>>()}
jest.mock('../src/commands/early-reaction', () => ({
  tryEarlyReaction: (...a: any[]) => earlyReactionState.tryEarlyReaction(...a)
}))

const NUMERIC_INPUTS: Record<string, string> = {
  max_files: '150',
  max_review_comments: '20',
  openai_retries: '5',
  openai_timeout_ms: '360000',
  openai_concurrency_limit: '4',
  github_concurrency_limit: '4',
  openai_model_temperature: '0.0',
  max_dependency_files: '50',
  debug_resolve_inject_failures: '0'
}

describe('GH-016 / GH-017: GitHub Action 在 GitLab 缺席或故障时正常运行', () => {
  const savedEnv: Record<string, string | undefined> = {}

  beforeEach(() => {
    jest.clearAllMocks()
    gitbeakerLoads.count = 0
    process.removeAllListeners('unhandledRejection')
    process.removeAllListeners('uncaughtException')

    for (const key of GITLAB_ENV_KEYS) {
      savedEnv[key] = process.env[key]
      delete process.env[key]
    }
    // GitHub 侧 env 照常提供——GH-016 的场景是「GitHub 齐全、GitLab 全无」。
    // 这里刻意不 mock src/octokit，让真实的 GitHub 平台层参与加载。
    // 每个用例都从 PR 事件的干净状态起步，避免用例间通过共享 context 互相污染
    mockContext.eventName = 'pull_request'
    mockContext.payload = {...prOpenedFixture, action: 'opened'}
    process.env.GITHUB_EVENT_NAME = 'pull_request'
    process.env.GITHUB_ACTION = 'ai-reviewer'
    process.env.GITHUB_REPOSITORY = 'octo/demo'
    process.env.GITHUB_TOKEN = 'ghs-test-token'

    coreState.getInput.mockImplementation((name: string) => NUMERIC_INPUTS[name] ?? '')
    coreState.getBooleanInput.mockReturnValue(false)
    coreState.getMultilineInput.mockReturnValue([])
    reviewState.codeReview.mockResolvedValue(undefined)
    commandHandlerState.handleCommentEvent.mockResolvedValue(undefined)
    earlyReactionState.tryEarlyReaction.mockResolvedValue(undefined)
  })

  afterEach(() => {
    for (const key of GITLAB_ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key]
      else process.env[key] = savedEnv[key]
    }
  })

  async function runMain(): Promise<void> {
    jest.resetModules()
    await import('../src/main')
    // main 的顶层 run() 不返回 Promise 给调用方，只能靠让出事件循环等它跑完。
    // 单个 setImmediate 太脆：编排链路上每多一个 await（例如 STATE-013 的幂等
    // 查询）就会把 codeReview 推到下一个 tick 之后，测试随即变成「没调用」。
    // 让出若干轮，与具体的 await 层数解耦。
    for (let i = 0; i < 10; i++) {
      await new Promise(resolve => setImmediate(resolve))
    }
  }

  test('GH-016：无任何 GitLab 变量时，PR 事件照常触发审查', async () => {
    for (const key of GITLAB_ENV_KEYS) {
      expect(process.env[key]).toBeUndefined()
    }

    await runMain()

    expect(reviewState.codeReview).toHaveBeenCalledTimes(1)
    expect(coreState.setFailed).not.toHaveBeenCalled()
  })

  test('GH-017：GitLab SDK 全程未被加载（不可达也就无从影响）', async () => {
    await runMain()

    expect(gitbeakerLoads.count).toBe(0)
    expect(reviewState.codeReview).toHaveBeenCalledTimes(1)
  })

  test('GH-017：GitLab 变量存在但指向不可达实例时，GitHub 流程不受影响', async () => {
    process.env.GITLAB_PAT = 'glpat-unreachable'
    process.env.CI_SERVER_URL = 'https://gitlab.invalid'

    await runMain()

    expect(reviewState.codeReview).toHaveBeenCalledTimes(1)
    expect(coreState.setFailed).not.toHaveBeenCalled()
    expect(gitbeakerLoads.count).toBe(0)
  })

  test('评论事件同样不触碰 GitLab', async () => {
    mockContext.eventName = 'issue_comment'
    mockContext.payload = {
      // eslint-disable-next-line camelcase
      issue: {number: 42, pull_request: {url: 'https://api.github.com/pulls/42'}},
      comment: {id: 1, body: '@ai-reviewer help', user: {login: 'human', type: 'User'}},
      action: 'created',
      repository: {full_name: 'octo/demo'}
    }
    process.env.GITHUB_EVENT_NAME = 'issue_comment'

    await runMain()

    expect(commandHandlerState.handleCommentEvent).toHaveBeenCalledTimes(1)
    expect(gitbeakerLoads.count).toBe(0)
  })

  test('状态命名空间默认为 github，无需 GitLab 配置参与', async () => {
    await runMain()

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const {getStateNamespace} = require('../src/platform/state-namespace')
    expect(getStateNamespace()).toBe('github')
  })
})
