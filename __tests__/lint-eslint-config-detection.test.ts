/**
 * lint-eslint-config-detection.test.ts — 改进 A 单元测试
 *
 * 验证 EslintAdapter.detect() 在仓库根缺少 ESLint 配置时返回 available=false，
 * 让用户在 PR 摘要的统计表中直接看到原因（而不是面对"扫描了 N 文件 0 finding"的迷惑）。
 *
 * 不打算 mock fs — 用真实临时目录更接近运行时行为，且能覆盖
 * `findEslintConfig` 内部的所有候选文件。
 */

import {
  describe,
  expect,
  jest,
  test,
  beforeEach,
  afterEach
} from '@jest/globals'
import {mkdtempSync, rmSync, writeFileSync} from 'fs'
import {tmpdir} from 'os'
import * as path from 'path'

jest.mock('@actions/core', () => ({
  info: jest.fn(),
  warning: jest.fn()
}))

// 跳过真实 npm install — 让 ensureToolInstalled 始终返回成功
jest.mock('../src/lint/tool-installer', () => ({
  ensureToolInstalled: jest.fn(async () => ({
    ok: true,
    binPath: '/tmp/ai-reviewer-lint-tools/node_modules/.bin/eslint'
  }))
}))

// 强制 EslintAdapter 的二进制版本检测认为 eslint 可用，
// 这样我们可以专注测试项目配置检查的逻辑
jest.mock('../src/lint/adapters/exec', () => ({
  runCommand: jest.fn(async () => ({
    exitCode: 0,
    timedOut: false,
    stdout: 'v9.15.0\n',
    stderr: '',
    spawnError: false
  })),
  parseJsonSafe: jest.fn(),
  extractVersion: jest.fn(
    (s: string) => s.match(/v?(\d+\.\d+\.\d+)/)?.[1] ?? ''
  )
}))

import {EslintAdapter} from '../src/lint/adapters/eslint'

describe('EslintAdapter.detect — 项目配置检查（改进 A）', () => {
  let tmpRoot: string

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'eslint-detect-'))
  })

  afterEach(() => {
    rmSync(tmpRoot, {recursive: true, force: true})
  })

  test('无任何配置 → available=false，reason 提示用户', async () => {
    const adapter = new EslintAdapter()
    const det = await adapter.detect(tmpRoot)

    expect(det.available).toBe(false)
    expect(det.version).toBe('9.15.0') // 二进制版本仍然探测出来，便于诊断
    expect(det.reason).toMatch(/no ESLint config found/i)
    expect(det.reason).toMatch(/eslint\.config/)
  })

  test('Flat Config (eslint.config.js) 存在 → available=true', async () => {
    writeFileSync(path.join(tmpRoot, 'eslint.config.js'), 'export default []\n')
    const adapter = new EslintAdapter()
    const det = await adapter.detect(tmpRoot)

    expect(det.available).toBe(true)
    expect(det.version).toBe('9.15.0')
    expect(det.reason).toBeUndefined()
  })

  test('Flat Config (eslint.config.mjs) 存在 → available=true', async () => {
    writeFileSync(
      path.join(tmpRoot, 'eslint.config.mjs'),
      'export default []\n'
    )
    const det = await new EslintAdapter().detect(tmpRoot)
    expect(det.available).toBe(true)
  })

  test('Legacy .eslintrc.json 存在 → available=true', async () => {
    writeFileSync(path.join(tmpRoot, '.eslintrc.json'), '{"rules": {}}\n')
    const det = await new EslintAdapter().detect(tmpRoot)
    expect(det.available).toBe(true)
  })

  test('package.json 内嵌 eslintConfig 字段 → available=true', async () => {
    writeFileSync(
      path.join(tmpRoot, 'package.json'),
      JSON.stringify({name: 'demo', eslintConfig: {rules: {}}})
    )
    const det = await new EslintAdapter().detect(tmpRoot)
    expect(det.available).toBe(true)
  })

  test('package.json 无 eslintConfig 字段 → 仍 available=false', async () => {
    writeFileSync(
      path.join(tmpRoot, 'package.json'),
      JSON.stringify({name: 'demo'})
    )
    const det = await new EslintAdapter().detect(tmpRoot)
    expect(det.available).toBe(false)
    expect(det.reason).toMatch(/no ESLint config/i)
  })

  test('package.json 损坏 → 不抛异常，回退到"无配置"', async () => {
    writeFileSync(path.join(tmpRoot, 'package.json'), 'not valid json{{{')
    const det = await new EslintAdapter().detect(tmpRoot)
    expect(det.available).toBe(false)
    expect(det.reason).toMatch(/no ESLint config/i)
  })
})
