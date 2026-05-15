/**
 * lint-semgrep-adapter.test.ts — Semgrep 适配器单元测试
 *
 * 覆盖：
 *   - 构造时默认 config = 'p/default'，可被构造参数覆盖
 *   - detect：装包失败 / version 失败 / 成功三条路径
 *   - scan：JSON 解析（多条 finding / 严重级映射 / 路径归一化 / 空结果 / spawnError）
 *
 * 不真实跑 semgrep —— runCommand 和 ensureToolInstalled 全部 mock。
 */

import {describe, expect, jest, test, beforeEach} from '@jest/globals'

jest.mock('@actions/core', () => ({
  info: jest.fn(),
  warning: jest.fn()
}))

interface FakeRunResult {
  exitCode: number | null
  timedOut: boolean
  stdout: string
  stderr: string
  spawnError: boolean
  spawnErrorMessage?: string
}

const runCommandMock = jest.fn<(opts: unknown) => Promise<FakeRunResult>>()
jest.mock('../src/lint/adapters/exec', () => {
  const real = jest.requireActual<typeof import('../src/lint/adapters/exec')>(
    '../src/lint/adapters/exec'
  )
  return {
    ...real,
    runCommand: (opts: unknown) => runCommandMock(opts)
  }
})

const ensureToolInstalledMock = jest.fn<
  (spec: unknown) => Promise<{
    ok: boolean
    binPath?: string
    reason?: string
  }>
>()
jest.mock('../src/lint/tool-installer', () => ({
  ensureToolInstalled: (spec: unknown) => ensureToolInstalledMock(spec)
}))

import {SemgrepAdapter} from '../src/lint/adapters/semgrep'

beforeEach(() => {
  runCommandMock.mockReset()
  ensureToolInstalledMock.mockReset()
})

/** 帮助函数：让 ensureToolInstalled 返回 success，bin 路径走 pip 沙箱结构 */
function mockInstallOk(): void {
  ensureToolInstalledMock.mockResolvedValueOnce({
    ok: true,
    binPath: '/tmp/ai-reviewer-lint-tools/python-tools/bin/semgrep'
  })
}

/** 帮助函数：让 --version 调用返回指定的 stdout */
function mockVersionOk(versionStdout = 'semgrep 1.95.0'): void {
  runCommandMock.mockResolvedValueOnce({
    exitCode: 0,
    timedOut: false,
    stdout: versionStdout,
    stderr: '',
    spawnError: false
  })
}

describe('SemgrepAdapter — 构造与默认值', () => {
  test('不传 config → 默认 p/default', () => {
    const a = new SemgrepAdapter()
    expect(a.config).toBe('p/default')
  })

  test('config 可被构造参数覆盖', () => {
    const a = new SemgrepAdapter({config: 'auto'})
    expect(a.config).toBe('auto')
  })

  test('config 为 undefined / 空字符串走默认', () => {
    expect(new SemgrepAdapter({config: undefined}).config).toBe('p/default')
    // 注意：构造函数用 `??` 而非 `||`，空字符串会被保留（让用户能显式传空）
    expect(new SemgrepAdapter({config: ''}).config).toBe('')
  })

  test('默认 enable = false（Phase 4 是 opt-in）', () => {
    const a = new SemgrepAdapter()
    expect(a.defaultEnabled).toBe(false)
  })

  test('installSpec 走 pip 策略', () => {
    const a = new SemgrepAdapter()
    expect(a.installSpec.kind).toBe('pip')
    expect((a.installSpec as {package: string}).package).toBe('semgrep')
    expect((a.installSpec as {binName: string}).binName).toBe('semgrep')
  })

  test('category 在 fileExtensions 中覆盖主流多语言', () => {
    const a = new SemgrepAdapter()
    // Phase 1/2/3 涉及的扩展名都应在内
    for (const ext of ['.js', '.ts', '.py', '.go', '.java', '.rb']) {
      expect(a.fileExtensions).toContain(ext)
    }
  })
})

describe('SemgrepAdapter.detect', () => {
  test('装包失败 → available=false，reason 带原因', async () => {
    ensureToolInstalledMock.mockResolvedValueOnce({
      ok: false,
      reason: 'pip install semgrep>=1.95.0,<2 failed (exit=1): ERROR: …'
    })

    const det = await new SemgrepAdapter().detect('/repo')

    expect(det.available).toBe(false)
    expect(det.reason).toMatch(/bundled Semgrep install failed/)
    expect(det.reason).toMatch(/ERROR/)
  })

  test('--version 返回非零 → available=false，附带 stderr 首行', async () => {
    mockInstallOk()
    runCommandMock.mockResolvedValueOnce({
      exitCode: 1,
      timedOut: false,
      stdout: '',
      stderr: 'ModuleNotFoundError: No module named semgrep\nadditional line',
      spawnError: false
    })

    const det = await new SemgrepAdapter().detect('/repo')

    expect(det.available).toBe(false)
    expect(det.reason).toMatch(/bundled semgrep --version failed/)
    expect(det.reason).toMatch(/exit=1/)
    expect(det.reason).toMatch(/ModuleNotFoundError/)
  })

  test('正常路径 → available=true，version 从 stdout 提取', async () => {
    mockInstallOk()
    mockVersionOk('semgrep 1.95.0\n')

    const det = await new SemgrepAdapter().detect('/repo')

    expect(det.available).toBe(true)
    expect(det.version).toBe('1.95.0')
  })

  test('versionOverride 非空时透传到 installSpec', async () => {
    mockInstallOk()
    mockVersionOk('semgrep 1.80.0')

    await new SemgrepAdapter().detect('/repo', '~=1.80')

    const installCall = ensureToolInstalledMock.mock.calls[0][0] as {
      kind: string
      version: string
    }
    expect(installCall.kind).toBe('pip')
    expect(installCall.version).toBe('~=1.80')
  })

  test('versionOverride 空字符串 → 走默认 installSpec.version', async () => {
    mockInstallOk()
    mockVersionOk()

    await new SemgrepAdapter().detect('/repo', '')

    const installCall = ensureToolInstalledMock.mock.calls[0][0] as {
      version: string
    }
    expect(installCall.version).toBe('^1.95.0')
  })
})

describe('SemgrepAdapter.scan', () => {
  /** 帮助函数：让 detect 跑通后调用 scan */
  async function detectThenScan(
    semgrepStdout: string,
    options: {exitCode?: number; stderr?: string; config?: string} = {}
  ) {
    const adapter = new SemgrepAdapter({config: options.config ?? 'p/default'})
    mockInstallOk()
    mockVersionOk('semgrep 1.95.0')
    await adapter.detect('/repo')

    // scan 阶段：用户给的 stdout/exit
    runCommandMock.mockResolvedValueOnce({
      exitCode: options.exitCode ?? 1, // semgrep 找到 finding 时 exit=1，正常
      timedOut: false,
      stdout: semgrepStdout,
      stderr: options.stderr ?? '',
      spawnError: false
    })
    return await adapter.scan(['src/foo.py'], '/repo')
  }

  test('空 results → 返回空数组', async () => {
    const results = await detectThenScan(
      JSON.stringify({results: [], errors: [], version: '1.95.0'}),
      {exitCode: 0}
    )
    expect(results).toEqual([])
  })

  test('单条 finding → LintResult 字段映射正确', async () => {
    const semgrepOut = {
      version: '1.95.0',
      errors: [],
      results: [
        {
          check_id:
            'python.lang.security.audit.dangerous-system-call.dangerous-system-call',
          path: 'src/utils.py',
          start: {line: 42, col: 3},
          end: {line: 42, col: 60},
          extra: {
            severity: 'ERROR',
            message: 'Detected subprocess call with shell=True',
            fix: 'use shell=False'
          }
        }
      ]
    }
    const results = await detectThenScan(JSON.stringify(semgrepOut))

    expect(results).toHaveLength(1)
    const r = results[0]
    expect(r.tool).toBe('Semgrep')
    expect(r.toolVersion).toBe('1.95.0')
    expect(r.file).toBe('src/utils.py')
    expect(r.line).toBe(42)
    expect(r.column).toBe(3)
    expect(r.endLine).toBe(42)
    expect(r.endColumn).toBe(60)
    expect(r.severity).toBe('error')
    expect(r.ruleId).toMatch(/dangerous-system-call/)
    expect(r.message).toBe('Detected subprocess call with shell=True')
    expect(r.fixable).toBe(true)
    expect(r.category).toBe('security')
  })

  test('severity 映射：ERROR / WARNING / INFO → error / warning / info', async () => {
    const semgrepOut = {
      results: [
        {
          check_id: 'a',
          path: 'a.py',
          start: {line: 1, col: 1},
          end: {line: 1, col: 1},
          extra: {severity: 'ERROR', message: ''}
        },
        {
          check_id: 'b',
          path: 'b.py',
          start: {line: 2, col: 1},
          end: {line: 2, col: 1},
          extra: {severity: 'WARNING', message: ''}
        },
        {
          check_id: 'c',
          path: 'c.py',
          start: {line: 3, col: 1},
          end: {line: 3, col: 1},
          extra: {severity: 'INFO', message: ''}
        }
      ]
    }
    const results = await detectThenScan(JSON.stringify(semgrepOut))
    expect(results.map(r => r.severity)).toEqual(['error', 'warning', 'info'])
  })

  test('severity 缺失 / 未知 → warning（保守兜底）', async () => {
    const semgrepOut = {
      results: [
        {
          check_id: 'x',
          path: 'a.py',
          start: {line: 1, col: 1},
          end: {line: 1, col: 1},
          extra: {message: ''} // severity 缺失
        },
        {
          check_id: 'y',
          path: 'b.py',
          start: {line: 2, col: 1},
          end: {line: 2, col: 1},
          extra: {severity: 'FATAL', message: ''} // 未知值
        }
      ]
    }
    const results = await detectThenScan(JSON.stringify(semgrepOut))
    expect(results.map(r => r.severity)).toEqual(['warning', 'warning'])
  })

  test('fix 字段缺失 → fixable=false', async () => {
    const semgrepOut = {
      results: [
        {
          check_id: 'r',
          path: 'a.py',
          start: {line: 1, col: 1},
          end: {line: 1, col: 1},
          extra: {severity: 'ERROR', message: 'm'}
        }
      ]
    }
    const results = await detectThenScan(JSON.stringify(semgrepOut))
    expect(results[0].fixable).toBe(false)
  })

  test('绝对路径 → 归一化为相对仓库根', async () => {
    const semgrepOut = {
      results: [
        {
          check_id: 'r',
          path: '/repo/src/utils.py',
          start: {line: 1, col: 1},
          end: {line: 1, col: 1},
          extra: {severity: 'ERROR', message: 'm'}
        }
      ]
    }
    const results = await detectThenScan(JSON.stringify(semgrepOut))
    expect(results[0].file).toBe('src/utils.py')
  })

  test('非 JSON 输出 → 返回空数组（不抛异常）', async () => {
    const results = await detectThenScan(
      'Traceback (most recent call last): ...\nFatalError',
      {exitCode: 2, stderr: 'usage: semgrep ...'}
    )
    expect(results).toEqual([])
  })

  test('spawnError → 返回空数组', async () => {
    const adapter = new SemgrepAdapter()
    mockInstallOk()
    mockVersionOk()
    await adapter.detect('/repo')

    runCommandMock.mockResolvedValueOnce({
      exitCode: null,
      timedOut: false,
      stdout: '',
      stderr: '',
      spawnError: true,
      spawnErrorMessage: 'command not found: semgrep'
    })
    const results = await adapter.scan(['a.py'], '/repo')
    expect(results).toEqual([])
  })

  test('files 为空 → 不调用 semgrep，直接返回空数组', async () => {
    const adapter = new SemgrepAdapter()
    mockInstallOk()
    mockVersionOk()
    await adapter.detect('/repo')

    // 不挂载 scan 的 runCommand mock 验证：files=[] 应该 short-circuit
    const before = runCommandMock.mock.calls.length
    const results = await adapter.scan([], '/repo')
    expect(results).toEqual([])
    expect(runCommandMock.mock.calls.length).toBe(before)
  })

  test('scan 命令包含 --config=<构造时的值>', async () => {
    await detectThenScan(JSON.stringify({results: []}), {config: 'p/security-audit'})

    // 最后一次 runCommand 调用应是 scan
    const lastCall = runCommandMock.mock.calls[runCommandMock.mock.calls.length - 1][0] as {
      args: string[]
    }
    expect(lastCall.args).toEqual(
      expect.arrayContaining(['scan', '--json', '--config=p/security-audit'])
    )
  })
})
