/**
 * lint-tool-installer.test.ts — 多策略工具安装 dispatcher 单元测试
 *
 * 覆盖场景：
 *   - npm 策略：缓存命中 / 首次安装成功 / npm install 失败 / bin 不存在
 *   - binary 策略：当前阶段返回 "not yet implemented"
 *   - 沙箱目录初始化（mkdir + 写 package.json）
 *
 * 不真实执行 npm — runCommand 全部 mock，纯单元测试。
 */

import {
  describe,
  expect,
  jest,
  test,
  beforeEach,
  afterEach
} from '@jest/globals'
import {existsSync, mkdtempSync, rmSync, statSync, writeFileSync} from 'fs'
import * as path from 'path'

// 真实的 os 模块（jest.mock('os', ...) 之后顶层 import 拿到的是 mock 版本，
// 这里通过 requireActual 拿到真实的 tmpdir 用于 mkdtempSync）
const realOsTmpdir = jest.requireActual<typeof import('os')>('os').tmpdir

jest.mock('@actions/core', () => ({
  info: jest.fn(),
  warning: jest.fn()
}))

/** runCommand 的精简返回类型，仅覆盖测试需要的字段 */
interface FakeRunResult {
  exitCode: number | null
  timedOut: boolean
  stdout: string
  stderr: string
  spawnError: boolean
  spawnErrorMessage?: string
}

// 用 jest 工厂函数 mock runCommand —— 每个用例可以独立设置返回值
const runCommandMock = jest.fn<(opts: unknown) => Promise<FakeRunResult>>()
jest.mock('../src/lint/adapters/exec', () => ({
  runCommand: (opts: unknown) => runCommandMock(opts)
}))

// mock os.tmpdir 让沙箱位于受控的临时目录
let testTmp: string
jest.mock('os', () => {
  const real = jest.requireActual<typeof import('os')>('os')
  return {
    ...real,
    tmpdir: () => testTmp
  }
})

import {ensureToolInstalled} from '../src/lint/tool-installer'
import {type BinaryInstallSpec, type NpmInstallSpec} from '../src/lint/types'

const npmSpec: NpmInstallSpec = {
  kind: 'npm',
  package: 'eslint',
  binName: 'eslint',
  version: '^9.15.0'
}

const binarySpec: BinaryInstallSpec = {
  kind: 'binary',
  urlPattern: 'https://example.com/{version}/{os}-{arch}.tar.gz',
  version: '1.0.0',
  binPathInArchive: 'tool/bin'
}

beforeEach(() => {
  testTmp = mkdtempSync(path.join(realOsTmpdir(), 'installer-test-'))
  runCommandMock.mockReset()
})

afterEach(() => {
  rmSync(testTmp, {recursive: true, force: true})
})

/** 模拟 npm install 成功：把 bin 文件创建到沙箱里 */
function mockNpmInstallSuccess(binName: string): void {
  runCommandMock.mockImplementationOnce(async () => {
    const installRoot = path.join(testTmp, 'ai-reviewer-lint-tools')
    const binDir = path.join(installRoot, 'node_modules', '.bin')
    require('fs').mkdirSync(binDir, {recursive: true})
    writeFileSync(path.join(binDir, binName), '#!/usr/bin/env node\n')
    return {
      exitCode: 0,
      timedOut: false,
      stdout: '',
      stderr: '',
      spawnError: false
    }
  })
}

describe('ensureToolInstalled — npm 策略', () => {
  test('首次安装成功 → 返回 binPath', async () => {
    mockNpmInstallSuccess('eslint')
    const result = await ensureToolInstalled(npmSpec)

    expect(result.ok).toBe(true)
    expect(result.binPath).toBe(
      path.join(
        testTmp,
        'ai-reviewer-lint-tools',
        'node_modules',
        '.bin',
        'eslint'
      )
    )
    expect(existsSync(result.binPath as string)).toBe(true)
    // npm install 应被调用一次
    expect(runCommandMock).toHaveBeenCalledTimes(1)
    const call = runCommandMock.mock.calls[0][0] as Record<string, unknown>
    expect(call.command).toBe('npm')
    expect(call.args).toEqual(
      expect.arrayContaining([
        'install',
        'eslint@^9.15.0',
        '--legacy-peer-deps'
      ])
    )
  })

  test('version 缺省 → 安装 latest（install target 不带 @<range>）', async () => {
    mockNpmInstallSuccess('eslint')
    // 退化场景：未经 Action 直接调用，spec 不含 version
    const specNoVersion: NpmInstallSpec = {
      kind: 'npm',
      package: 'eslint',
      binName: 'eslint'
    }
    const result = await ensureToolInstalled(specNoVersion)

    expect(result.ok).toBe(true)
    expect(runCommandMock).toHaveBeenCalledTimes(1)
    const call = runCommandMock.mock.calls[0][0] as Record<string, unknown>
    // 安装目标应为裸包名 'eslint'，而不是 'eslint@undefined'
    expect(call.args).toEqual(expect.arrayContaining(['install', 'eslint']))
    expect(call.args).not.toEqual(expect.arrayContaining(['eslint@undefined']))
  })

  test('缓存命中：bin 已存在 → 不再调用 npm install', async () => {
    // 预先在沙箱里放好 bin 文件
    const installRoot = path.join(testTmp, 'ai-reviewer-lint-tools')
    const binDir = path.join(installRoot, 'node_modules', '.bin')
    require('fs').mkdirSync(binDir, {recursive: true})
    writeFileSync(path.join(binDir, 'eslint'), '#!/usr/bin/env node\n')

    const result = await ensureToolInstalled(npmSpec)

    expect(result.ok).toBe(true)
    expect(result.binPath).toContain('eslint')
    // 缓存命中：根本不应跑 npm
    expect(runCommandMock).not.toHaveBeenCalled()
  })

  test('沙箱目录被自动创建（首次调用）', async () => {
    mockNpmInstallSuccess('eslint')
    const installRoot = path.join(testTmp, 'ai-reviewer-lint-tools')
    expect(existsSync(installRoot)).toBe(false)

    await ensureToolInstalled(npmSpec)

    expect(existsSync(installRoot)).toBe(true)
    expect(statSync(installRoot).isDirectory()).toBe(true)
    // 沙箱 package.json 也应被写入
    const sandboxPkg = path.join(installRoot, 'package.json')
    expect(existsSync(sandboxPkg)).toBe(true)
    const pkg = JSON.parse(require('fs').readFileSync(sandboxPkg, 'utf8'))
    expect(pkg.name).toBe('ai-reviewer-lint-tools')
    expect(pkg.private).toBe(true)
  })

  test('npm install 失败（exit ≠ 0） → 返回带 reason', async () => {
    runCommandMock.mockResolvedValueOnce({
      exitCode: 1,
      timedOut: false,
      stdout: '',
      stderr: 'npm error ERESOLVE could not resolve\n',
      spawnError: false
    })

    const result = await ensureToolInstalled(npmSpec)

    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/npm install eslint@\^9\.15\.0 failed/)
    expect(result.reason).toMatch(/exit=1/)
    expect(result.reason).toMatch(/ERESOLVE/)
  })

  test('npm 二进制找不到（spawnError） → 返回明确错误', async () => {
    runCommandMock.mockResolvedValueOnce({
      exitCode: null,
      timedOut: false,
      stdout: '',
      stderr: '',
      spawnError: true,
      spawnErrorMessage: 'command not found: npm'
    })

    const result = await ensureToolInstalled(npmSpec)

    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/npm not found on runner/)
  })

  test('npm install 报告成功但 bin 没生成 → 防御性 false', async () => {
    runCommandMock.mockResolvedValueOnce({
      exitCode: 0,
      timedOut: false,
      stdout: '',
      stderr: '',
      spawnError: false
    })
    // 不预创建 bin 文件，模拟"npm 装了但放在了别的位置"

    const result = await ensureToolInstalled(npmSpec)

    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/installed but bin not at/)
  })
})

describe('ensureToolInstalled — binary 策略（Phase 2+）', () => {
  test('暂未实现 → 返回明确错误，便于 PR 摘要展示', async () => {
    const result = await ensureToolInstalled(binarySpec)
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/binary install strategy not yet implemented/)
    expect(result.reason).toMatch(/Phase 2\+/)
    // 不应误调用 runCommand
    expect(runCommandMock).not.toHaveBeenCalled()
  })
})
