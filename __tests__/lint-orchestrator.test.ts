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

  async detect(): Promise<ToolDetection> {
    return this.detection
  }

  async scan(): Promise<LintResult[]> {
    if (this.throwOnScan) throw new Error('boom')
    return this.findings
  }
}

const filesAndChanges: Array<
  [string, string, string, Array<[number, number, string]>]
> = [
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
    const enabled = new FakeAdapter(
      'fake',
      {available: true, version: '1.0.0'},
      [finding]
    )
    const unavailable = new FakeAdapter(
      'gone',
      {available: false, reason: 'not installed'},
      []
    )
    const disabled = new FakeAdapter('off', {available: true, version: '1'}, [
      {...finding, tool: 'off'}
    ])

    const report = await runLintTools(
      {
        repoRoot: '/tmp',
        filesAndChanges,
        configOverride: {tools: {off: {enabled: false}}}
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
    const adapter = new FakeAdapter(
      'fake',
      {available: true, version: '1.0.0'},
      [outOfWindow]
    )

    const report = await runLintTools({repoRoot: '/tmp', filesAndChanges}, [
      adapter
    ])
    expect(report.results.length).toBe(0)
  })

  test('adapter throwing during scan is treated as no findings', async () => {
    const adapter = new FakeAdapter(
      'fake',
      {available: true, version: '1.0.0'},
      [],
      true,
      true
    )
    const report = await runLintTools({repoRoot: '/tmp', filesAndChanges}, [
      adapter
    ])
    expect(report.results.length).toBe(0)
    expect(report.toolSummaries[0].available).toBe(true)
  })

  test('disabled flag short-circuits the orchestrator', async () => {
    const adapter = new FakeAdapter(
      'fake',
      {available: true, version: '1.0.0'},
      [
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
      ]
    )
    const report = await runLintTools(
      {repoRoot: '/tmp', filesAndChanges, disabled: true},
      [adapter]
    )
    expect(report.results.length).toBe(0)
    expect(report.toolSummaries.length).toBe(0)
  })
})
