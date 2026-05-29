/**
 * unit-test/orchestrator.ts - 单元测试生成主流程编排
 *
 * 对应迭代四 §2.1 全流程图。
 *
 * 输入: 来自命令 handler 的精简上下文（owner / repo / prNumber / args / 触发评论 id）
 * 输出: 一份完整的 GenerationRunResult + DeliveryOutcome
 *
 * 责任:
 *   1. 拉取 PR 元信息与 diff 文件
 *   2. 调 change-analyzer 抽取测试目标
 *   3. 准备仓库快照、调 framework-detector
 *   4. 用 context-collector 填充每个 target 的源码上下文
 *   5. 组装 GenerationInput[] → 调 generator
 *   6. 按 mode 调 delivery
 */
import {info} from '@actions/core'
import type {Bot} from '../bot'
import {octokit} from '../octokit'
import {extractTestTargets, filterTargetsByArgs, type DiffFile} from './change-analyzer'
import {
  collectProjectTestContext,
  extractTypeContext,
  fillSourceSnippet
} from './context-collector'
import {detectFramework, type FrameworkRepoSnapshot} from './framework-detector'
import {LocalFsReader} from './fs-reader'
import {generateTests, type ChatFn} from './generator'
import type {
  DeliveryInput,
  DeliveryMode,
  DeliveryOutcome,
  GenerationInput,
  GenerationRunResult,
  SourceLanguage
} from './types'
import {dispatchDelivery} from './delivery'

export interface OrchestratorInput {
  owner: string
  repo: string
  prNumber: number
  /** 命令参数中的位置参数（如指定文件路径） */
  args: string[]
  /** 命令参数中的 kv（如 --function=foo） */
  kv: Record<string, string>
  /** 'comment' | 'commit' | 'pr' */
  mode: DeliveryMode
  /** 触发该命令的评论 id（用于 delivery 关联） */
  triggerCommentId: number
}

export interface OrchestratorDeps {
  heavyBot: Bot
}

export async function runUnitTestGeneration(
  input: OrchestratorInput,
  deps: OrchestratorDeps
): Promise<{
  run: GenerationRunResult
  delivery: DeliveryOutcome
  /** mode = comment 时为待发布到评论的 Markdown */
  commentBody?: string
}> {
  // 1. PR 元数据 + diff
  const prRes = await octokit.pulls.get({
    owner: input.owner,
    repo: input.repo,
    pull_number: input.prNumber
  })
  const pr = prRes.data
  const headSha = pr.head?.sha ?? ''
  const baseSha = pr.base?.sha ?? ''
  const branch = pr.head?.ref

  // 使用 paginate 处理超过 100 个变更文件的大 PR；上限 10 页（=1000 文件）兜底
  const MAX_FILE_PAGES = 10
  const PER_PAGE = 100
  const collected: Array<{
    filename: string
    status?: string
    patch?: string
  }> = []
  for (let page = 1; page <= MAX_FILE_PAGES; page++) {
    const res = await octokit.pulls.listFiles({
      owner: input.owner,
      repo: input.repo,
      pull_number: input.prNumber,
      per_page: PER_PAGE,
      page
    })
    for (const f of res.data) {
      collected.push({filename: f.filename, status: f.status, patch: f.patch})
    }
    if (res.data.length < PER_PAGE) break
  }
  const diffFiles: DiffFile[] = collected

  // 2. 抽取目标
  let targets = extractTestTargets(diffFiles)
  targets = filterTargetsByArgs(targets, input.args, input.kv)

  info(
    `unit-test/orchestrator: extracted ${targets.length} targets after filtering`
  )

  const run: GenerationRunResult = {
    tests: [],
    skipped: [],
    warnings: []
  }

  if (targets.length === 0) {
    run.warnings.push('未在 PR 变更中识别出需要测试的函数/类')
    const delivery = await deliveryStep(input, run, branch)
    return {run, delivery: delivery.outcome, commentBody: delivery.body}
  }

  // 3. 仓库快照 + 框架检测
  const fs = new LocalFsReader()
  const snapshot = await buildRepoSnapshot(fs, targets[0].language)
  const framework = detectFramework(snapshot)
  info(
    `unit-test/orchestrator: detected framework: ${framework.framework} (${framework.confidence})`
  )

  const hasUnderscoreTests = await detectHasUnderscoreTests(fs)
  const hasTestsDir = await fs.fileExists('tests')

  // 4. 填充上下文 + 组装 GenerationInput
  const inputs: GenerationInput[] = []
  for (const target of targets) {
    const filled = await fillSourceSnippet(target, fs)
    const projectContext = await collectProjectTestContext(filled, fs)
    const typeContext = extractTypeContext(filled.sourceSnippet ?? '')
    inputs.push({
      target: filled,
      framework,
      projectContext,
      typeContext,
      prMeta: {
        title: pr.title ?? '',
        headSha,
        baseSha
      }
    })
  }

  // 5. 生成
  const chat: ChatFn = async (msg, ids) => {
    const [text, newIds, steps] = await deps.heavyBot.chat(msg, ids)
    return [text, newIds, steps]
  }
  const runResult = await generateTests(inputs, chat, {
    hasUnderscoreTests,
    hasTestsDir
  })

  // 6. 交付
  const delivery = await deliveryStep(
    input,
    runResult,
    branch,
    headSha,
    baseSha
  )

  return {run: runResult, delivery: delivery.outcome, commentBody: delivery.body}
}

async function deliveryStep(
  input: OrchestratorInput,
  run: GenerationRunResult,
  branch: string | undefined,
  headSha = '',
  baseSha = ''
): Promise<{body?: string; outcome: DeliveryOutcome}> {
  const dInput: DeliveryInput = {
    owner: input.owner,
    repo: input.repo,
    prNumber: input.prNumber,
    headSha,
    baseSha,
    branch,
    run,
    triggerCommentId: input.triggerCommentId
  }
  return dispatchDelivery(input.mode, dInput)
}

/** 构造 framework-detector 所需的仓库快照 */
async function buildRepoSnapshot(
  fs: LocalFsReader,
  primaryLanguage: SourceLanguage
): Promise<FrameworkRepoSnapshot> {
  const candidates = [
    'vitest.config.ts',
    'vitest.config.js',
    'vitest.config.mjs',
    'jest.config.js',
    'jest.config.ts',
    'pytest.ini',
    'pyproject.toml',
    'package.json',
    'go.mod'
  ]
  const files = new Set<string>()
  for (const c of candidates) {
    if (await fs.fileExists(c)) files.add(c)
  }

  // 浅扫一层 *_test.go / test_*.py / *.test.ts 用于弱信号探测
  const goTests = await fs.list('', '_test.go')
  for (const f of goTests.slice(0, 5)) files.add(f)
  const jsTests = await fs.list('', '.test.')
  for (const f of jsTests.slice(0, 5)) files.add(f)
  const pyTests = await fs.list('', 'test_')
  for (const f of pyTests.slice(0, 5)) files.add(f)

  let packageJsonDeps: Record<string, string> | undefined
  if (files.has('package.json')) {
    const raw = await fs.readFile('package.json')
    if (raw) {
      try {
        const json = JSON.parse(raw)
        packageJsonDeps = {
          ...(json.dependencies ?? {}),
          ...(json.devDependencies ?? {})
        }
      } catch {
        // ignore
      }
    }
  }
  let pyprojectToml: string | undefined
  if (files.has('pyproject.toml')) {
    const raw = await fs.readFile('pyproject.toml')
    if (raw) pyprojectToml = raw
  }

  return {files, packageJsonDeps, pyprojectToml, primaryLanguage}
}

async function detectHasUnderscoreTests(fs: LocalFsReader): Promise<boolean> {
  const files = await fs.list('', '__tests__')
  return files.length > 0
}
