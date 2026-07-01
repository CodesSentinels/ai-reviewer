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

const pipSpec: PipInstallSpec = {
  kind: 'pip',
  package: 'semgrep',
  binName: 'semgrep',
  version: '^1.95.0'
}

/** 模拟 pip install 成功：把 console script 创建到沙箱 python-tools/bin 里 */
function mockPipInstallSuccess(binName: string): void {
  runCommandMock.mockImplementationOnce(async () => {
    const installRoot = path.join(testTmp, 'ai-reviewer-lint-tools')
    const binDir = path.join(installRoot, 'python-tools', 'bin')
    require('fs').mkdirSync(binDir, {recursive: true})
    writeFileSync(path.join(binDir, binName), '#!/usr/bin/env python3\n')
    return {
      exitCode: 0,
      timedOut: false,
      stdout: '',
      stderr: '',
      spawnError: false
    }
  })
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

describe('ensureToolInstalled — pip 策略（Phase 4：semgrep）', () => {
  test('首次安装成功 → 返回 binPath（指向 python-tools/bin/）', async () => {
    mockPipInstallSuccess('semgrep')
    const result = await ensureToolInstalled(pipSpec)

    expect(result.ok).toBe(true)
    expect(result.binPath).toBe(
      path.join(
        testTmp,
        'ai-reviewer-lint-tools',
        'python-tools',
        'bin',
        'semgrep'
      )
    )
    expect(existsSync(result.binPath as string)).toBe(true)
    // pip install 应被调用一次
    expect(runCommandMock).toHaveBeenCalledTimes(1)
    const call = runCommandMock.mock.calls[0][0] as Record<string, unknown>
    expect(call.command).toBe('python3')
    // npm-range "^1.95.0" 应该被转成 pip range ">=1.95.0,<2"
    const args = call.args as string[]
    expect(args).toEqual(
      expect.arrayContaining(['-m', 'pip', 'install', 'semgrep>=1.95.0,<2'])
    )
    // --target 应指向沙箱 python-tools 子目录
    expect(args.find(a => a.startsWith('--target='))).toBe(
      `--target=${path.join(testTmp, 'ai-reviewer-lint-tools', 'python-tools')}`
    )
  })

  test('缓存命中：console script 已存在 → 不再调用 pip', async () => {
    const binDir = path.join(
      testTmp,
      'ai-reviewer-lint-tools',
      'python-tools',
      'bin'
    )
    require('fs').mkdirSync(binDir, {recursive: true})
    writeFileSync(path.join(binDir, 'semgrep'), '#!/usr/bin/env python3\n')

    const result = await ensureToolInstalled(pipSpec)

    expect(result.ok).toBe(true)
    expect(result.binPath).toContain('semgrep')
    expect(runCommandMock).not.toHaveBeenCalled()
  })

  test('沙箱 python-tools 子目录被自动创建', async () => {
    mockPipInstallSuccess('semgrep')
    const pythonToolsDir = path.join(
      testTmp,
      'ai-reviewer-lint-tools',
      'python-tools'
    )
    expect(existsSync(pythonToolsDir)).toBe(false)

    await ensureToolInstalled(pipSpec)

    expect(existsSync(pythonToolsDir)).toBe(true)
    expect(statSync(pythonToolsDir).isDirectory()).toBe(true)
  })

  test('pip install 失败（exit ≠ 0） → 返回明确 reason + stderr 首行', async () => {
    runCommandMock.mockResolvedValueOnce({
      exitCode: 1,
      timedOut: false,
      stdout: '',
      stderr:
        'ERROR: Could not find a version that satisfies the requirement semgrep\n',
      spawnError: false
    })

    const result = await ensureToolInstalled(pipSpec)

    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/pip install semgrep>=1\.95\.0,<2 failed/)
    expect(result.reason).toMatch(/exit=1/)
    expect(result.reason).toMatch(/Could not find a version/)
  })

  test('python3 不存在（spawnError） → 明确指引自托管 runner 用户', async () => {
    runCommandMock.mockResolvedValueOnce({
      exitCode: null,
      timedOut: false,
      stdout: '',
      stderr: '',
      spawnError: true,
      spawnErrorMessage: 'command not found: python3'
    })

    const result = await ensureToolInstalled(pipSpec)

    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/python3 not found on runner/)
    expect(result.reason).toMatch(/self-hosted runner/)
  })

  test('pip 报告成功但 console script 未生成 → 防御性 false', async () => {
    runCommandMock.mockResolvedValueOnce({
      exitCode: 0,
      timedOut: false,
      stdout: '',
      stderr: '',
      spawnError: false
    })
    // 不预创建 bin 文件

    const result = await ensureToolInstalled(pipSpec)

    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/console script not at/)
    expect(result.reason).toMatch(/console_scripts entry/)
  })
})

describe('npmRangeToPipSpecifier', () => {
  test('caret range → >=,< 形式锁主版本', () => {
    expect(npmRangeToPipSpecifier('^1.95.0')).toBe('>=1.95.0,<2')
    expect(npmRangeToPipSpecifier('^2.0.0')).toBe('>=2.0.0,<3')
  })

  test('tilde range → >=,< 形式锁次版本', () => {
    expect(npmRangeToPipSpecifier('~1.95.0')).toBe('>=1.95.0,<1.96')
    expect(npmRangeToPipSpecifier('~2.3.5')).toBe('>=2.3.5,<2.4')
  })

  test('裸版本号 → ==精确等于', () => {
    expect(npmRangeToPipSpecifier('1.95.0')).toBe('==1.95.0')
  })

  test('已经是 pip 语法 → 原样透传', () => {
    expect(npmRangeToPipSpecifier('>=1.95,<2')).toBe('>=1.95,<2')
    expect(npmRangeToPipSpecifier('==1.95.0')).toBe('==1.95.0')
    expect(npmRangeToPipSpecifier('~=1.95')).toBe('~=1.95')
  })

  test('空字符串 / `*` / `latest` → 空（让 pip 装最新）', () => {
    expect(npmRangeToPipSpecifier('')).toBe('')
    expect(npmRangeToPipSpecifier('  ')).toBe('')
    expect(npmRangeToPipSpecifier('*')).toBe('')
    expect(npmRangeToPipSpecifier('latest')).toBe('')
  })
})
