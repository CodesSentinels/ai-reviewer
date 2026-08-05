/**
 * lint-orchestrator.test.ts - 工具编排引擎的端到端测试
 *
 * 用一个 fake 适配器替代真实工具，验证：
 * - 启用/禁用通过 ToolsConfig 起作用
 * - 不可用工具记入 ToolSummary 但不阻塞其他工具
 * - 变更行过滤 + 跨工具去重在 orchestrator 串联中正常工作
 * - 适配器抛异常时记录警告但不影响整体结果
 */

import {describe, expect, jest, test} from '@jest/globals'

jest.mock('@actions/core', () => ({
  info: jest.fn(),
  warning: jest.fn()
}))

// 阻断真实文件系统读取（loadConfig 依赖 fs）
jest.mock('fs', () => ({
  existsSync: jest.fn(() => false),
  readFileSync: jest.fn()
}))

import {runLintTools} from '../src/lint/orchestrator'
import {
  type InstallSpec,
  type LintResult,
  type ToolAdapter,
  type ToolDetection
} from '../src/lint/types'

class FakeAdapter implements ToolAdapter {
  readonly name: string
  readonly displayName: string
  readonly supportedLanguages = ['typescript']
  readonly fileExtensions = ['.ts']
  readonly defaultEnabled: boolean
  /** 测试用 stub：满足 ToolAdapter 接口；FakeAdapter.detect() 不真用它 */
  readonly installSpec: InstallSpec = {
    kind: 'npm',
    package: 'fake-not-used',
    binName: 'fake',
    version: '0.0.0'
  }

  /** 记录 detect 被传入的 versionOverride，用于版本覆盖测试断言 */
  lastVersionOverride: string | undefined

  constructor(
    name: string,
    private readonly detection: ToolDetection,
    private readonly findings: LintResult[],
    defaultEnabled = true,
    private readonly throwOnScan = false
  ) {
    this.name = name
    this.displayName = name
    this.defaultEnabled = defaultEnabled
  }

  async detect(_repoRoot: string, versionOverride?: string): Promise<ToolDetection> {
    this.lastVersionOverride = versionOverride
    return this.detection
  }

  async scan(): Promise<LintResult[]> {
    if (this.throwOnScan) throw new Error('boom')
    return this.findings
  }
}

const filesAndChanges: Array<[string, string, string, Array<[number, number, string]>]> = [
  [
    'src/a.ts',
    'content',
    `@@ -1,1 +1,2 @@
 keep
+changed`,
    []
  ]
]

describe('runLintTools', () => {
  test('runs only enabled+available adapters and aggregates results', async () => {
    const finding: LintResult = {
      tool: 'fake',
      toolVersion: '1.0.0',
      file: 'src/a.ts',
      line: 2,
      column: 1,
      severity: 'error',
      ruleId: 'fake/rule',
      message: 'oops',
      fixable: false
    }
    const enabled = new FakeAdapter('fake', {available: true, version: '1.0.0'}, [finding])
    const unavailable = new FakeAdapter('gone', {available: false, reason: 'not installed'}, [])
    const disabled = new FakeAdapter('off', {available: true, version: '1'}, [
      {...finding, tool: 'off'}
    ])

    const report = await runLintTools(
      {
        repoRoot: '/tmp',
        filesAndChanges,
        toolEnableOverrides: {off: false}
      },
      [enabled, unavailable, disabled]
    )

    expect(report.results.length).toBe(1)
    expect(report.results[0].tool).toBe('fake')

    const summaryNames = report.toolSummaries.map(s => s.tool).sort()
    // 'off' is filtered out before detect; 'gone' marks available=false
    expect(summaryNames).toEqual(['fake', 'gone'])
    const goneSummary = report.toolSummaries.find(s => s.tool === 'gone')!
    expect(goneSummary.available).toBe(false)
  })

  test('drops findings outside changed-line window', async () => {
    const outOfWindow: LintResult = {
      tool: 'fake',
      toolVersion: '1.0.0',
      file: 'src/a.ts',
      line: 50, // changed line is 2, default tolerance 3
      column: 1,
      severity: 'error',
      ruleId: 'fake/rule',
      message: 'far away',
      fixable: false
    }
    const adapter = new FakeAdapter('fake', {available: true, version: '1.0.0'}, [outOfWindow])

    const report = await runLintTools({repoRoot: '/tmp', filesAndChanges}, [adapter])
    expect(report.results.length).toBe(0)
  })

  test('toolSummary 同时上报 raw count（errors）与 post-filter count（errorsOnChanges）', async () => {
    // 模拟项目级扫描器（如 tsc）：报 3 条 error，其中只有 1 条落在变更行附近
    const onChanged: LintResult = {
      tool: 'fake',
      toolVersion: '1.0.0',
      file: 'src/a.ts',
      line: 2, // changed line is 2 → 命中
      column: 1,
      severity: 'error',
      ruleId: 'fake/A',
      message: 'on-changed',
      fixable: false
    }
    const offChanged1: LintResult = {
      ...onChanged,
      line: 100,
      ruleId: 'fake/B',
      message: 'off-1'
    }
    const offChanged2: LintResult = {
      ...onChanged,
      line: 200,
      ruleId: 'fake/C',
      message: 'off-2',
      severity: 'warning'
    }
    const adapter = new FakeAdapter('fake', {available: true, version: '1.0.0'}, [
      onChanged,
      offChanged1,
      offChanged2
    ])

    const report = await runLintTools({repoRoot: '/tmp', filesAndChanges}, [adapter])

    expect(report.results.length).toBe(1) // 只有变更行上的进入最终结果
    const s = report.toolSummaries[0]
    // 原始扫到的总数（errors=2 是 onChanged + offChanged1）
    expect(s.errors).toBe(2)
    expect(s.warnings).toBe(1)
    // 变更行 + 去重后的最终数（只有 onChanged 一条 error 进了 PR 评论）
    expect(s.errorsOnChanges).toBe(1)
    expect(s.warningsOnChanges).toBe(0)
  })

  test('adapter throwing during scan is treated as no findings', async () => {
    const adapter = new FakeAdapter('fake', {available: true, version: '1.0.0'}, [], true, true)
    const report = await runLintTools({repoRoot: '/tmp', filesAndChanges}, [adapter])
    expect(report.results.length).toBe(0)
    expect(report.toolSummaries[0].available).toBe(true)
  })

  test('disabled flag short-circuits the orchestrator', async () => {
    const adapter = new FakeAdapter('fake', {available: true, version: '1.0.0'}, [
      {
        tool: 'fake',
        toolVersion: '1.0.0',
        file: 'src/a.ts',
        line: 2,
        column: 1,
        severity: 'error',
        ruleId: 'fake/rule',
        message: 'oops',
        fixable: false
      }
    ])
    const report = await runLintTools({repoRoot: '/tmp', filesAndChanges, disabled: true}, [
      adapter
    ])
    expect(report.results.length).toBe(0)
    expect(report.toolSummaries.length).toBe(0)
  })

  test('toolVersionOverrides 透传到 adapter.detect 的 versionOverride 参数', async () => {
    const adapter = new FakeAdapter('eslint', {available: true, version: '8.57.0'}, [])
    await runLintTools(
      {
        repoRoot: '/tmp',
        filesAndChanges,
        toolVersionOverrides: {eslint: '^8.57.0'}
      },
      [adapter]
    )
    expect(adapter.lastVersionOverride).toBe('^8.57.0')
  })

  test('未配置 toolVersionOverrides[adapter.name] 时，detect 收到 undefined', async () => {
    const adapter = new FakeAdapter('eslint', {available: true, version: '9.15.0'}, [])
    await runLintTools(
      {
        repoRoot: '/tmp',
        filesAndChanges,
        toolVersionOverrides: {biome: '^2.3.0'} // 故意不写 eslint
      },
      [adapter]
    )
    expect(adapter.lastVersionOverride).toBeUndefined()
  })

  test('toolVersionOverrides 整个未提供时，所有 adapter 都收到 undefined', async () => {
    const adapter = new FakeAdapter('fake', {available: true, version: '1.0.0'}, [])
    await runLintTools({repoRoot: '/tmp', filesAndChanges}, [adapter])
    expect(adapter.lastVersionOverride).toBeUndefined()
  })
})
