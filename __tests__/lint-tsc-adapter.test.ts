/**
 * lint-tsc-adapter.test.ts — TypeScript Compiler 适配器单元测试
 *
 * 覆盖：
 *   - tsconfig.json 检测：3 种命中文件名 + 全部缺失
 *   - tsc 输出解析：单错误 / 多错误 / 路径归一化 / 续行忽略
 *   - 沙箱安装失败 → unavailable
 *   - tsc --version 失败 → unavailable
 *   - scan 抛异常 → 0 finding
 */

import {describe, expect, jest, test, beforeEach, afterEach} from '@jest/globals'
import {mkdtempSync, rmSync, writeFileSync} from 'fs'
import {tmpdir} from 'os'
import * as path from 'path'

jest.mock('@actions/core', () => ({
  info: jest.fn(),
  warning: jest.fn()
}))

// 默认让 tool-installer 总返回成功；个别用例会覆盖
const ensureToolInstalledMock = jest.fn<
  () => Promise<{ok: boolean; binPath?: string; reason?: string}>
>()
jest.mock('../src/lint/tool-installer', () => ({
  ensureToolInstalled: () => ensureToolInstalledMock()
}))

// 默认让 runCommand 返回 tsc --version 成功；个别用例会覆盖
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

import {TscAdapter} from '../src/lint/adapters/tsc'

let tmpRoot: string

beforeEach(() => {
  tmpRoot = mkdtempSync(path.join(tmpdir(), 'tsc-test-'))
  ensureToolInstalledMock.mockReset()
  runCommandMock.mockReset()
  // 默认：装好了 + --version 正常
  ensureToolInstalledMock.mockResolvedValue({
    ok: true,
    binPath: '/tmp/ai-reviewer-lint-tools/node_modules/.bin/tsc'
  })
  runCommandMock.mockResolvedValue({
    exitCode: 0,
    timedOut: false,
    stdout: 'Version 5.6.3\n',
    stderr: '',
    spawnError: false
  })
})

afterEach(() => {
  rmSync(tmpRoot, {recursive: true, force: true})
})

describe('TscAdapter.detect', () => {
  test('沙箱安装失败 → available=false', async () => {
    ensureToolInstalledMock.mockResolvedValueOnce({
      ok: false,
      reason: 'npm install typescript@^5.6.0 failed (exit=1): network'
    })
    const det = await new TscAdapter().detect(tmpRoot)
    expect(det.available).toBe(false)
    expect(det.reason).toMatch(/bundled TypeScript install failed/)
    expect(det.reason).toMatch(/network/)
  })

  test('tsc --version 失败 → available=false', async () => {
    runCommandMock.mockResolvedValueOnce({
      exitCode: 1,
      timedOut: false,
      stdout: '',
      stderr: 'something broke\n',
      spawnError: false
    })
    const det = await new TscAdapter().detect(tmpRoot)
    expect(det.available).toBe(false)
    expect(det.reason).toMatch(/bundled tsc --version failed/)
    expect(det.reason).toMatch(/something broke/)
  })

  test('无 tsconfig.json → available=false（带具体 reason）', async () => {
    const det = await new TscAdapter().detect(tmpRoot)
    expect(det.available).toBe(false)
    expect(det.version).toBe('5.6.3')
    expect(det.reason).toMatch(/no tsconfig\.json found/)
  })

  test('tsconfig.json 存在 → available=true', async () => {
    writeFileSync(path.join(tmpRoot, 'tsconfig.json'), '{}')
    const det = await new TscAdapter().detect(tmpRoot)
    expect(det.available).toBe(true)
    expect(det.version).toBe('5.6.3')
  })

  test('tsconfig.base.json 也算命中（monorepo 常见）', async () => {
    writeFileSync(path.join(tmpRoot, 'tsconfig.base.json'), '{}')
    const det = await new TscAdapter().detect(tmpRoot)
    expect(det.available).toBe(true)
  })
})

describe('TscAdapter.scan — 输出解析', () => {
  beforeEach(() => {
    writeFileSync(path.join(tmpRoot, 'tsconfig.json'), '{}')
  })

  test('解析单条 error TS2322', async () => {
    // detect 调用一次（返回 version stdout），scan 调用一次（返回错误列表）
    runCommandMock.mockReset()
    runCommandMock
      .mockResolvedValueOnce({
        exitCode: 0,
        timedOut: false,
        stdout: 'Version 5.6.3\n',
        stderr: '',
        spawnError: false
      })
      .mockResolvedValueOnce({
        exitCode: 1, // 有错误时 tsc 返回非零
        timedOut: false,
        stdout:
          "src/utils.ts(15,7): error TS2322: Type 'string' is not assignable to type 'number'.\n",
        stderr: '',
        spawnError: false
      })

    const adapter = new TscAdapter()
    await adapter.detect(tmpRoot)
    const findings = await adapter.scan(['src/utils.ts'], tmpRoot, {})

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      tool: 'TypeScript',
      file: 'src/utils.ts',
      line: 15,
      column: 7,
      severity: 'error',
      ruleId: 'TS2322',
      message: "Type 'string' is not assignable to type 'number'."
    })
  })

  test('解析多条 error，忽略续行 type chain', async () => {
    runCommandMock.mockReset()
    runCommandMock
      .mockResolvedValueOnce({
        exitCode: 0,
        timedOut: false,
        stdout: 'Version 5.6.3\n',
        stderr: '',
        spawnError: false
      })
      .mockResolvedValueOnce({
        exitCode: 1,
        timedOut: false,
        stdout: [
          "src/a.ts(10,5): error TS2339: Property 'foo' does not exist on type 'Bar'.",
          "src/b.ts(22,12): error TS2345: Argument of type '{ a: string; }' is not assignable to parameter of type '{ a: number; }'.",
          "  Types of property 'a' are incompatible.", // 续行：缩进，应被忽略
          "    Type 'string' is not assignable to type 'number'.",
          'Found 2 errors in 2 files.', // 概要行：应被忽略
          ''
        ].join('\n'),
        stderr: '',
        spawnError: false
      })

    const adapter = new TscAdapter()
    await adapter.detect(tmpRoot)
    const findings = await adapter.scan([], tmpRoot, {})

    expect(findings).toHaveLength(2)
    expect(findings[0].ruleId).toBe('TS2339')
    expect(findings[0].file).toBe('src/a.ts')
    expect(findings[1].ruleId).toBe('TS2345')
    expect(findings[1].file).toBe('src/b.ts')
  })

  test('绝对路径被归一化为相对仓库根', async () => {
    runCommandMock.mockReset()
    runCommandMock
      .mockResolvedValueOnce({
        exitCode: 0,
        timedOut: false,
        stdout: 'Version 5.6.3\n',
        stderr: '',
        spawnError: false
      })
      .mockResolvedValueOnce({
        exitCode: 1,
        timedOut: false,
        stdout: `${tmpRoot}/src/utils.ts(15,7): error TS2322: bad.\n`,
        stderr: '',
        spawnError: false
      })

    const adapter = new TscAdapter()
    await adapter.detect(tmpRoot)
    const findings = await adapter.scan([], tmpRoot, {})

    expect(findings).toHaveLength(1)
    expect(findings[0].file).toBe('src/utils.ts')
  })

  test('tsc 无错误（exit=0，stdout 为空） → 0 findings', async () => {
    runCommandMock.mockReset()
    runCommandMock
      .mockResolvedValueOnce({
        exitCode: 0,
        timedOut: false,
        stdout: 'Version 5.6.3\n',
        stderr: '',
        spawnError: false
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        timedOut: false,
        stdout: '',
        stderr: '',
        spawnError: false
      })

    const adapter = new TscAdapter()
    await adapter.detect(tmpRoot)
    const findings = await adapter.scan([], tmpRoot, {})
    expect(findings).toHaveLength(0)
  })

  test('spawnError → 不抛异常，0 findings', async () => {
    runCommandMock.mockReset()
    runCommandMock
      .mockResolvedValueOnce({
        exitCode: 0,
        timedOut: false,
        stdout: 'Version 5.6.3\n',
        stderr: '',
        spawnError: false
      })
      .mockResolvedValueOnce({
        exitCode: null,
        timedOut: false,
        stdout: '',
        stderr: '',
        spawnError: true,
        spawnErrorMessage: 'command not found'
      })

    const adapter = new TscAdapter()
    await adapter.detect(tmpRoot)
    const findings = await adapter.scan([], tmpRoot, {})
    expect(findings).toEqual([])
  })
})
