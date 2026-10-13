/**
 * lint-prettier-adapter.test.ts — Prettier 适配器输出解析回归
 *
 * 回归：CI 环境（CI / GITHUB_ACTIONS）下 Prettier 给 "warn" 上色，输出为
 * "[<ESC>[33mwarn<ESC>[39m] src/foo.ts"，旧解析只认字面量 "[warn]"，
 * 显式开启 Prettier 后永远 0 发现且没有任何提示。
 */
import {describe, expect, jest, test, beforeEach} from '@jest/globals'

const warningMock = jest.fn()
jest.mock('../src/actions-log', () => ({
  info: jest.fn(),
  warning: (m: unknown) => warningMock(m)
}))
jest.mock('../src/lint/tool-installer', () => ({
  ensureToolInstalled: jest.fn(async () => ({ok: true, binPath: '/tmp/x/prettier'}))
}))

interface FakeRun {
  exitCode: number | null
  timedOut: boolean
  stdout: string
  stderr: string
  spawnError: boolean
}
const runCommandMock = jest.fn<(o: any) => Promise<FakeRun>>()
jest.mock('../src/lint/adapters/exec', () => ({
  runCommand: (o: unknown) => runCommandMock(o as any),
  extractVersion: (s: string) => s.match(/v?(\d+\.\d+\.\d+)/)?.[1] ?? ''
}))

import {PrettierAdapter, parsePrettierCheckOutput} from '../src/lint/adapters/prettier'

const ESC = String.fromCharCode(27)

beforeEach(() => {
  runCommandMock.mockReset()
  warningMock.mockReset()
})

describe('parsePrettierCheckOutput', () => {
  test('无颜色输出：解析文件名并排除结尾的汇总行', () => {
    const stderr =
      '[warn] src/a.ts\n[warn] src/b.ts\n[warn] Code style issues found in 2 files. Run Prettier with --write to fix.\n'
    expect(parsePrettierCheckOutput('Checking formatting...\n', stderr)).toEqual([
      'src/a.ts',
      'src/b.ts'
    ])
  })

  test('带 ANSI 颜色码的输出（CI 环境）也能解析', () => {
    const stderr =
      `[${ESC}[33mwarn${ESC}[39m] style/ugly.ts\n` +
      `[${ESC}[33mwarn${ESC}[39m] Code style issues found in the above file. Run Prettier with --write to fix.\n`
    expect(parsePrettierCheckOutput('', stderr)).toEqual(['style/ugly.ts'])
  })

  test('没有问题文件 → 空数组', () => {
    expect(
      parsePrettierCheckOutput(
        'Checking formatting...\nAll matched files use Prettier code style!\n',
        ''
      )
    ).toEqual([])
  })
})

describe('PrettierAdapter.scan', () => {
  async function makeAdapter(): Promise<PrettierAdapter> {
    runCommandMock.mockResolvedValueOnce({
      exitCode: 0,
      timedOut: false,
      stdout: '3.3.3\n',
      stderr: '',
      spawnError: false
    })
    const a = new PrettierAdapter()
    await a.detect('/repo')
    return a
  }

  test('调用 prettier 时关闭颜色（NO_COLOR / FORCE_COLOR=0）', async () => {
    const a = await makeAdapter()
    runCommandMock.mockResolvedValueOnce({
      exitCode: 0,
      timedOut: false,
      stdout: '',
      stderr: '',
      spawnError: false
    })
    await a.scan(['src/a.ts'], '/repo')
    const opts = runCommandMock.mock.calls[1][0]
    expect(opts.env).toEqual({NO_COLOR: '1', FORCE_COLOR: '0'})
  })

  test('即使输出仍带颜色码也能报出发现', async () => {
    const a = await makeAdapter()
    runCommandMock.mockResolvedValueOnce({
      exitCode: 1,
      timedOut: false,
      stdout: '',
      stderr: `[${ESC}[33mwarn${ESC}[39m] style/ugly.ts\n[${ESC}[33mwarn${ESC}[39m] Code style issues found in the above file.\n`,
      spawnError: false
    })
    const findings = await a.scan(['style/ugly.ts'], '/repo')
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({file: 'style/ugly.ts', ruleId: 'prettier/format'})
    expect(warningMock).not.toHaveBeenCalled()
  })

  test('退出码为 1 却解析不到文件名 → 告警而不是静默当作无问题', async () => {
    const a = await makeAdapter()
    runCommandMock.mockResolvedValueOnce({
      exitCode: 1,
      timedOut: false,
      stdout: '',
      stderr: 'something unexpected\n',
      spawnError: false
    })
    const findings = await a.scan(['src/a.ts'], '/repo')
    expect(findings).toEqual([])
    expect(warningMock).toHaveBeenCalledTimes(1)
  })
})
