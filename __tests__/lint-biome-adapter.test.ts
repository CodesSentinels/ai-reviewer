/**
 * lint-biome-adapter.test.ts — Biome 适配器 GitHub annotation 解析测试
 *
 * 覆盖场景：
 *   - error / warning / notice 三种级别
 *   - 带 endLine/endColumn 与不带
 *   - 多条诊断的逐行解析
 *   - 绝对路径归一化为相对仓库根
 *   - 沙箱安装失败 → unavailable
 *   - tsc --version 失败 → unavailable
 *   - 输出空 / 不符合格式的行被忽略
 *
 * 不真实执行 biome；runCommand 全部 mock。
 */

import {describe, expect, jest, test, beforeEach, afterEach} from '@jest/globals'
import {mkdtempSync, rmSync} from 'fs'
import {tmpdir} from 'os'
import * as path from 'path'

jest.mock('@actions/core', () => ({
  info: jest.fn(),
  warning: jest.fn()
}))

jest.mock('../src/lint/tool-installer', () => ({
  ensureToolInstalled: jest.fn(async () => ({
    ok: true,
    binPath: '/tmp/ai-reviewer-lint-tools/node_modules/.bin/biome'
  }))
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
jest.mock('../src/lint/adapters/exec', () => ({
  runCommand: (opts: unknown) => runCommandMock(opts),
  extractVersion: (s: string) => s.match(/v?(\d+\.\d+\.\d+)/)?.[1] ?? '',
  parseJsonSafe: jest.fn()
}))

import {BiomeAdapter} from '../src/lint/adapters/biome'

let tmpRoot: string

beforeEach(() => {
  tmpRoot = mkdtempSync(path.join(tmpdir(), 'biome-test-'))
  runCommandMock.mockReset()
})

afterEach(() => {
  rmSync(tmpRoot, {recursive: true, force: true})
})

/** 默认让 detect 走通：第一次调用返回 --version 成功 */
function arrangeDetect(): void {
  runCommandMock.mockResolvedValueOnce({
    exitCode: 0,
    timedOut: false,
    stdout: 'Version: 2.4.14\n',
    stderr: '',
    spawnError: false
  })
}

/** 安排 scan 步骤的输出（GitHub annotation 格式） */
function arrangeScanStdout(stdout: string): void {
  runCommandMock.mockResolvedValueOnce({
    exitCode: 1, // 有发现时 biome 返回非零
    timedOut: false,
    stdout,
    stderr: '',
    spawnError: false
  })
}

describe('BiomeAdapter — github reporter 解析', () => {
  test('解析单条 error，含 endLine/endColumn', async () => {
    arrangeDetect()
    arrangeScanStdout(
      '::error title=lint/suspicious/noDoubleEquals,file=src/foo.ts,line=42,col=15,endLine=42,endColumn=22::Use === instead of ==.\n'
    )

    const adapter = new BiomeAdapter()
    await adapter.detect(tmpRoot)
    const findings = await adapter.scan(['src/foo.ts'], tmpRoot)

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      tool: 'Biome',
      file: 'src/foo.ts',
      line: 42,
      column: 15,
      endLine: 42,
      endColumn: 22,
      severity: 'error',
      ruleId: 'lint/suspicious/noDoubleEquals',
      message: 'Use === instead of ==.'
    })
  })

  test('解析多条 + warning + notice（多种 level）', async () => {
    arrangeDetect()
    arrangeScanStdout(
      [
        '::error title=lint/correctness/noUnusedVariables,file=src/a.ts,line=10,col=7::"tempData" is unused.',
        '::warning title=lint/suspicious/noConsole,file=src/b.ts,line=5,col=1::Avoid console.log in production code.',
        '::notice title=lint/style/useConst,file=src/c.ts,line=1,col=1::Prefer const over let.'
      ].join('\n')
    )

    const adapter = new BiomeAdapter()
    await adapter.detect(tmpRoot)
    const findings = await adapter.scan(
      ['src/a.ts', 'src/b.ts', 'src/c.ts'],
      tmpRoot
    )

    expect(findings).toHaveLength(3)
    expect(findings[0].severity).toBe('error')
    expect(findings[1].severity).toBe('warning')
    expect(findings[2].severity).toBe('info')
    expect(findings[2].ruleId).toBe('lint/style/useConst')
  })

  test('绝对路径归一化为相对 repoRoot', async () => {
    arrangeDetect()
    arrangeScanStdout(
      `::error title=lint/suspicious/noDoubleEquals,file=${tmpRoot}/utils/foo.ts,line=42,col=15::Use === instead of ==.\n`
    )

    const adapter = new BiomeAdapter()
    await adapter.detect(tmpRoot)
    const findings = await adapter.scan(['utils/foo.ts'], tmpRoot)

    expect(findings).toHaveLength(1)
    expect(findings[0].file).toBe('utils/foo.ts')
  })

  test('混入空行 / 非 annotation 行 / 概要行 → 仅解析有效条目', async () => {
    arrangeDetect()
    arrangeScanStdout(
      [
        'biome v2.4.14',
        '',
        '::error title=lint/suspicious/noDoubleEquals,file=src/foo.ts,line=10,col=5::Use ===',
        'Found 1 error.',
        ''
      ].join('\n')
    )

    const adapter = new BiomeAdapter()
    await adapter.detect(tmpRoot)
    const findings = await adapter.scan(['src/foo.ts'], tmpRoot)

    expect(findings).toHaveLength(1)
    expect(findings[0].ruleId).toBe('lint/suspicious/noDoubleEquals')
  })

  test('全部输出无 annotation → 0 findings（不抛异常）', async () => {
    arrangeDetect()
    arrangeScanStdout('Checked 5 files in 200ms. No issues found.\n')

    const adapter = new BiomeAdapter()
    await adapter.detect(tmpRoot)
    const findings = await adapter.scan(['src/foo.ts'], tmpRoot)
    expect(findings).toHaveLength(0)
  })

  test('沙箱安装失败 → available=false', async () => {
    const installer = require('../src/lint/tool-installer') as {
      ensureToolInstalled: jest.Mock
    }
    const original = installer.ensureToolInstalled
    installer.ensureToolInstalled = jest.fn(async () => ({
      ok: false,
      reason: 'npm install @biomejs/biome@^2.3.0 failed (exit=1): network error'
    })) as unknown as typeof original

    const det = await new BiomeAdapter().detect(tmpRoot)
    expect(det.available).toBe(false)
    expect(det.reason).toMatch(/bundled Biome install failed/)
    expect(det.reason).toMatch(/network error/)

    // 恢复 mock
    installer.ensureToolInstalled = original
  })

  test('biome --version 失败 → available=false', async () => {
    runCommandMock.mockResolvedValueOnce({
      exitCode: 1,
      timedOut: false,
      stdout: '',
      stderr: 'biome: command malformed\n',
      spawnError: false
    })
    const det = await new BiomeAdapter().detect(tmpRoot)
    expect(det.available).toBe(false)
    expect(det.reason).toMatch(/bundled Biome --version failed/)
    expect(det.reason).toMatch(/biome: command malformed/)
  })

  test('调用 biome 时确保使用 --reporter=github 与 --max-diagnostics', async () => {
    arrangeDetect()
    arrangeScanStdout('')

    const adapter = new BiomeAdapter()
    await adapter.detect(tmpRoot)
    await adapter.scan(['src/foo.ts'], tmpRoot)

    // 第二次 runCommand 调用（scan）的参数
    const scanCall = runCommandMock.mock.calls[1]?.[0] as
      | {args: string[]; cwd: string}
      | undefined
    expect(scanCall?.args).toEqual(
      expect.arrayContaining([
        'check',
        '--reporter=github',
        '--max-diagnostics=999',
        'src/foo.ts'
      ])
    )
  })
})
