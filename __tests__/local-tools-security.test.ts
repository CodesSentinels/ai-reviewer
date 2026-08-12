/**
 * local-tools-security.test.ts — secret-bearing 执行面的本地工具策略
 * （LOCAL-001~003 / LINT-001~003）
 *
 * 背景：GitHub 侧的 P0 止血（SEC-001）把 `enable_lint_tools` / `enable_shell`
 * 关掉了，整个方案建立在「关掉之后确实什么都不跑」这个假设上；GitLab 侧
 * secret-bearing trigger 更是从设计上强制关闭（CFG-002）。
 *
 * 既有的 `lint-orchestrator.test.ts` 只断言 disabled 时**报告为空**——报告为空
 * 不等于什么都没干：适配器可能已经探测过环境、跑过 npm install、拉过网络。
 * 本文件补的正是这层：断言**副作用为零**。
 */
import {describe, expect, test, jest, beforeEach} from '@jest/globals'
import * as fs from 'fs'
import * as path from 'path'
import type {LintResult, ToolAdapter, ToolDetection, InstallSpec} from '../src/lint/types'

// ─── 把「网络 / 安装 / 工具执行」的唯一咽喉锁住 ────────────────────────────
// lint 子系统所有外部动作最终都经 runCommand：npm install 装工具、跑 eslint/tsc/
// semgrep 都走它。断言它零调用，等价于断言「没探测、没下载、没安装、没扫描」。
const execState = {runCommand: jest.fn<any>()}
jest.mock('../src/lint/adapters/exec', () => ({
  runCommand: (...a: any[]) => execState.runCommand(...a)
}))

const installerState = {ensureToolInstalled: jest.fn<any>()}
jest.mock('../src/lint/tool-installer', () => ({
  ensureToolInstalled: (...a: any[]) => installerState.ensureToolInstalled(...a)
}))

jest.mock('@actions/core', () => ({
  info: jest.fn(),
  warning: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  setFailed: jest.fn()
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {runLintTools} = require('../src/lint/orchestrator')

/** 会记录每一次 detect / scan 调用的适配器 */
class RecordingAdapter implements ToolAdapter {
  readonly displayName = 'recording'
  readonly supportedLanguages = ['typescript']
  readonly fileExtensions = ['.ts']
  readonly installSpec: InstallSpec = {
    kind: 'npm',
    package: 'recording-tool',
    binName: 'recording',
    version: '1.0.0'
  }

  detectCalls = 0
  scanCalls = 0

  constructor(readonly name = 'recording', readonly defaultEnabled = true) {}

  async detect(): Promise<ToolDetection> {
    this.detectCalls++
    return {available: true, version: '1.0.0'}
  }

  async scan(): Promise<LintResult[]> {
    this.scanCalls++
    return [
      {
        tool: this.name,
        toolVersion: '1.0.0',
        file: 'src/a.ts',
        line: 1,
        column: 1,
        severity: 'error',
        ruleId: 'x/y',
        message: 'should never surface when disabled',
        fixable: false
      }
    ]
  }
}

const filesAndChanges: Array<[string, string, string, Array<[number, number, string]>]> = [
  ['src/a.ts', '', '', [[1, 2, '@@ -1,2 +1,2 @@\n line\n+added']]]
]

beforeEach(() => {
  jest.clearAllMocks()
  execState.runCommand.mockResolvedValue({exitCode: 0, stdout: '', stderr: ''})
  installerState.ensureToolInstalled.mockResolvedValue({ok: true, binPath: '/tmp/fake'})
})

describe('LINT-001: 关闭时不得探测、下载、安装、恢复缓存或扫描', () => {
  test('disabled=true → 适配器的 detect / scan 一次都不被调用', async () => {
    const adapter = new RecordingAdapter()

    const report = await runLintTools({repoRoot: '/tmp', filesAndChanges, disabled: true}, [
      adapter
    ])

    expect(adapter.detectCalls).toBe(0)
    expect(adapter.scanCalls).toBe(0)
    expect(report.results).toHaveLength(0)
    expect(report.toolSummaries).toHaveLength(0)
  })

  test('disabled=true → 不执行任何外部命令（无 npm install、无工具调用、无网络）', async () => {
    await runLintTools({repoRoot: '/tmp', filesAndChanges, disabled: true}, [
      new RecordingAdapter()
    ])

    expect(execState.runCommand).not.toHaveBeenCalled()
    expect(installerState.ensureToolInstalled).not.toHaveBeenCalled()
  })

  test('对照组：enabled 时确实会走 detect / scan（证明上面的断言不是空跑）', async () => {
    const adapter = new RecordingAdapter()

    const report = await runLintTools({repoRoot: '/tmp', filesAndChanges}, [adapter])

    expect(adapter.detectCalls).toBe(1)
    expect(adapter.scanCalls).toBe(1)
    expect(report.toolSummaries.length).toBeGreaterThan(0)
  })

  test('disabled=true 时即使适配器会报错也不受影响（根本没被碰到）', async () => {
    const exploding: ToolAdapter = {
      name: 'exploding',
      displayName: 'exploding',
      supportedLanguages: ['typescript'],
      fileExtensions: ['.ts'],
      defaultEnabled: true,
      installSpec: {kind: 'npm', package: 'x', binName: 'x', version: '1'},
      detect: async () => {
        throw new Error('detect must not run when lint is disabled')
      },
      scan: async () => {
        throw new Error('scan must not run when lint is disabled')
      }
    }

    await expect(
      runLintTools({repoRoot: '/tmp', filesAndChanges, disabled: true}, [exploding])
    ).resolves.toMatchObject({results: []})
  })

  test('所有适配器都被 override 关闭时同样不执行外部命令', async () => {
    const adapter = new RecordingAdapter('eslint')

    await runLintTools({repoRoot: '/tmp', filesAndChanges, toolEnableOverrides: {eslint: false}}, [
      adapter
    ])

    expect(adapter.detectCalls).toBe(0)
    expect(execState.runCommand).not.toHaveBeenCalled()
  })
})

describe('LINT-001: 用真实适配器验证（RecordingAdapter 重写了 detect，不足以证明）', () => {
  // 上一组用的 RecordingAdapter 自己实现了 detect/scan，enabled 时也不会碰
  // runCommand——那样断言「disabled 时零调用」就是空跑。这里换成仓库里真实的
  // 适配器，让 detect → ensureToolInstalled → runCommand 这条链真实存在。
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const {PrettierAdapter} = require('../src/lint/adapters/prettier')

  test('对照组：enabled + 真实适配器 → 确实会触发工具安装链', async () => {
    // prettier 的 defaultEnabled 是 false（与 action.yml 的默认值一致），
    // 必须显式 override 才会进入 detect，否则这个对照组本身就是空跑
    await runLintTools({repoRoot: '/tmp', filesAndChanges, toolEnableOverrides: {prettier: true}}, [
      new PrettierAdapter()
    ])

    expect(installerState.ensureToolInstalled).toHaveBeenCalled()
  })

  test('disabled=true + 真实适配器 → 工具安装链一次都不触发', async () => {
    // 同样显式打开 prettier：证明是 disabled 拦住的，而不是 defaultEnabled=false
    await runLintTools(
      {repoRoot: '/tmp', filesAndChanges, disabled: true, toolEnableOverrides: {prettier: true}},
      [new PrettierAdapter()]
    )

    expect(installerState.ensureToolInstalled).not.toHaveBeenCalled()
    expect(execState.runCommand).not.toHaveBeenCalled()
  })

  test('disabled=true + 全部默认适配器（不传 override）→ 同样零副作用', async () => {
    // 不传 adaptersOverride，走 defaultAdapters()，覆盖真实生产配置
    await runLintTools({repoRoot: '/tmp', filesAndChanges, disabled: true})

    expect(installerState.ensureToolInstalled).not.toHaveBeenCalled()
    expect(execState.runCommand).not.toHaveBeenCalled()
  })
})

describe('LINT-001: 审查主流程在关闭时根本不调用 orchestrator', () => {
  test('review.ts 用 options.enableLintTools 做前置判断，而不是把开关下推给 orchestrator', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../src/review.ts'), 'utf8')
    // 两级短路：外层 if 决定「连 runLintTools 都不调用」，
    // orchestrator 的 disabled 只是第二道保险
    expect(src).toMatch(/if\s*\(\s*options\.enableLintTools\s*\)/)
    const guardIndex = src.search(/if\s*\(\s*options\.enableLintTools\s*\)/)
    const callIndex = src.indexOf('runLintTools(')
    expect(guardIndex).toBeGreaterThan(-1)
    expect(callIndex).toBeGreaterThan(guardIndex)
  })
})

describe('LOCAL-001/002: GitLab secret-bearing trigger 强制关闭本地工具', () => {
  // 行为断言在 config-provider.test.ts 的 CFG-002 组（enable_shell / enable_lint_tools /
  // 每个 per-tool 开关都强制 false，且环境变量说 true 也无效）。这里只钉住
  // 「强制逻辑仍在 GitLab provider 里、没有被改成可配置」这条结构约束。
  const src = fs.readFileSync(
    path.resolve(__dirname, '../src/platform/gitlab-config-provider.ts'),
    'utf8'
  )

  test('GitLab provider 里 enableShell / enableLintTools 是硬编码 false，不读环境变量', () => {
    expect(src).toMatch(/false,\s*\/\/ enableShell/)
    expect(src).toMatch(/false,\s*\/\/ enableLintTools/)
    expect(src).not.toMatch(/envBool\(\s*'AI_REVIEWER_ENABLE_SHELL'/)
    expect(src).not.toMatch(/envBool\(\s*'AI_REVIEWER_ENABLE_LINT_TOOLS'/)
  })

  test('per-tool 开关同样强制 false，与总开关一致', () => {
    const block = src.slice(src.indexOf('toolEnableOverrides'), src.indexOf('semgrepConfig'))
    for (const tool of ['eslint', 'biome', 'tsc', 'prettier', 'semgrep']) {
      expect(block).toMatch(new RegExp(`${tool}:\\s*false`))
    }
  })
})

describe('LOCAL-003 / LINT-002: 禁用本地工具后仍能完成 API-only 审查', () => {
  test('无工具、无外网条件下 orchestrator 返回可用的空报告而非抛错', async () => {
    // 模拟「工具没装 + 没有外网」：任何外部命令一律失败
    execState.runCommand.mockRejectedValue(new Error('ENOTFOUND registry.npmjs.org'))
    installerState.ensureToolInstalled.mockResolvedValue({
      ok: false,
      reason: 'network unavailable'
    })

    const report = await runLintTools({repoRoot: '/tmp', filesAndChanges, disabled: true}, [
      new RecordingAdapter()
    ])

    // 关键：不抛错、结构完整，审查主流程可以继续走 API-only 路径
    expect(report.results).toEqual([])
    expect(report.toolSummaries).toEqual([])
    expect(typeof report.durationMs).toBe('number')
    expect(execState.runCommand).not.toHaveBeenCalled()
  })

  test('审查核心的 diff / 文件内容来自平台 API，不依赖工作区', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../src/review.ts'), 'utf8')
    // API-only 审查的前提：这三类数据都走 IGitPlatform 而不是本地文件系统
    expect(src).toMatch(/getPlatform\(\)\.getFileContent\(/)
    expect(src).toMatch(/getPlatform\(\)\.listRepositoryTree\(/)
    // 仅 lint 分支使用 process.cwd()，其余路径不读工作区
    const cwdUses = src.match(/process\.cwd\(\)/g) ?? []
    expect(cwdUses).toHaveLength(1)
  })
})

describe('LINT-003: MVP 不为 secret-bearing trigger 实现网络/缓存/离线镜像策略', () => {
  const installerSrc = fs.readFileSync(
    path.resolve(__dirname, '../src/lint/tool-installer.ts'),
    'utf8'
  )

  test('安装器没有 registry 覆盖、离线镜像或缓存恢复的配置面', () => {
    const code = installerSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    for (const forbidden of [
      '--registry',
      '--offline',
      '--prefer-offline',
      'NPM_CONFIG_REGISTRY',
      'cacheRestore',
      'restoreCache'
    ]) {
      expect(code).not.toContain(forbidden)
    }
  })

  test('GitLab trigger 入口不引用 lint 子系统（关闭是设计而非运行期判断）', () => {
    const triggerSrc = fs.readFileSync(path.resolve(__dirname, '../src/gitlab-trigger.ts'), 'utf8')
    expect(triggerSrc).not.toMatch(/lint\//)
  })
})
