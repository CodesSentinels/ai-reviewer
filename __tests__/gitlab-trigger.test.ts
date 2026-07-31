/**
 * gitlab-trigger.test.ts — CLI 入口行为断言（EVENT-001/002/004）
 *
 * c9672be 的提交信息称"已用 ts-node 对全部 7 种场景手动跑通验证"，但没有留下
 * 自动化测试——本文件把那些手动场景转成自动化用例，只 mock `fs.readFileSync`
 * （文件 IO 边界），validateTriggerPayload/createGitLabExecutionContext/redact
 * 全部用真实实现，贴近 CLI 实际的端到端行为。
 *
 * 覆盖的最后一个用例（note action != create）刻意保留当前的 fail-closed 行为
 * 并断言之，与 c9672be 提交信息中记录的已知缺口一致：这属于 EVENT-016/017
 * （Issue #66），本任务范围不修复，只需如实反映现状。
 */
import {
  describe,
  expect,
  test,
  jest,
  beforeEach,
  afterEach
} from '@jest/globals'

import mrOpen from './fixtures/gitlab-mr-hook-open.json'
import mrFork from './fixtures/gitlab-mr-hook-fork.json'
import malformed from './fixtures/gitlab-malformed.json'
import unknownEvent from './fixtures/gitlab-unknown-event.json'
import noteNonCreate from './fixtures/gitlab-note-hook-non-create.json'

const fsState = {readFileSync: jest.fn<(...a: any[]) => string>()}
jest.mock('fs', () => ({
  readFileSync: (...a: any[]) => fsState.readFileSync(...a)
}))

async function runTrigger(): Promise<void> {
  jest.resetModules()
  await import('../src/gitlab-trigger')
  await new Promise(resolve => setImmediate(resolve))
}

describe('gitlab-trigger.ts run()', () => {
  let logSpy: jest.SpiedFunction<typeof console.log>
  let warnSpy: jest.SpiedFunction<typeof console.warn>
  let errorSpy: jest.SpiedFunction<typeof console.error>

  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.TRIGGER_PAYLOAD
    process.exitCode = undefined
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
    warnSpy.mockRestore()
    errorSpy.mockRestore()
    process.exitCode = undefined
  })

  test('TRIGGER_PAYLOAD 未设置 → 报错退出，不读文件', async () => {
    await runTrigger()

    expect(errorSpy).toHaveBeenCalledWith('[ERROR] TRIGGER_PAYLOAD is not set')
    expect(process.exitCode).toBe(1)
    expect(fsState.readFileSync).not.toHaveBeenCalled()
  })

  test('文件读取失败 → 报错退出，错误信息脱敏', async () => {
    process.env.TRIGGER_PAYLOAD = '/no/such/file.json'
    fsState.readFileSync.mockImplementation(() => {
      throw new Error('ENOENT: glpat-secretvalue123 not found')
    })

    await runTrigger()

    expect(process.exitCode).toBe(1)
    const message = errorSpy.mock.calls[0][0] as string
    expect(message).toContain('Failed to read TRIGGER_PAYLOAD file')
    expect(message).not.toContain('secretvalue123')
    expect(message).toContain('glpat-***')
  })

  test('文件内容不是合法 JSON → 报错退出，不回显原始内容', async () => {
    process.env.TRIGGER_PAYLOAD = '/tmp/payload.json'
    fsState.readFileSync.mockReturnValue('not json{{{')

    await runTrigger()

    expect(errorSpy).toHaveBeenCalledWith(
      '[ERROR] TRIGGER_PAYLOAD content is not valid JSON'
    )
    expect(process.exitCode).toBe(1)
  })

  test('正常 MR open payload → 打印成功摘要，exitCode 不被设置', async () => {
    process.env.TRIGGER_PAYLOAD = '/tmp/payload.json'
    fsState.readFileSync.mockReturnValue(JSON.stringify(mrOpen))

    await runTrigger()

    expect(errorSpy).not.toHaveBeenCalled()
    expect(process.exitCode).toBeUndefined()
    expect(logSpy).toHaveBeenCalledWith(
      'GitLab event validated: platform=gitlab eventKind=pr_opened project=octo/demo mr=7'
    )
  })

  test('未知 object_kind（EVENT-004）→ 优雅跳过，退出码保持成功', async () => {
    process.env.TRIGGER_PAYLOAD = '/tmp/payload.json'
    fsState.readFileSync.mockReturnValue(JSON.stringify(unknownEvent))

    await runTrigger()

    expect(errorSpy).not.toHaveBeenCalled()
    expect(process.exitCode).toBeUndefined()
    // GitLabLogger.warning → console.warn（带 [WARNING] 前缀）
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'Skipped: Unsupported GitLab object_kind: pipeline'
      )
    )
  })

  test('结构校验失败（缺 iid）→ 报错退出，不进入 ExecutionContext 构造', async () => {
    process.env.TRIGGER_PAYLOAD = '/tmp/payload.json'
    fsState.readFileSync.mockReturnValue(JSON.stringify(malformed))

    await runTrigger()

    expect(errorSpy).toHaveBeenCalledWith(
      '[ERROR] TRIGGER_PAYLOAD failed validation: missing object_attributes.iid'
    )
    expect(process.exitCode).toBe(1)
  })

  test('fork MR（source!=target）→ 先打印 EVENT-010 提示，再打印成功摘要', async () => {
    process.env.TRIGGER_PAYLOAD = '/tmp/payload.json'
    fsState.readFileSync.mockReturnValue(JSON.stringify(mrFork))

    await runTrigger()

    expect(process.exitCode).toBeUndefined()
    expect(logSpy).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('fork MR')
    )
    expect(logSpy).toHaveBeenNthCalledWith(2, expect.stringContaining('mr=8'))
  })

  test('已知缺口：note action != create 时 fail closed 退出码 1（非优雅跳过，Issue #66 待修）', async () => {
    process.env.TRIGGER_PAYLOAD = '/tmp/payload.json'
    fsState.readFileSync.mockReturnValue(JSON.stringify(noteNonCreate))

    await runTrigger()

    expect(process.exitCode).toBe(1)
    const message = errorSpy.mock.calls[0][0] as string
    expect(message).toContain('Failed to build ExecutionContext')
    expect(message).toContain('not a create action')
  })

  test('ARCH-015: gitlab-trigger.ts 不 import orchestrator / @actions/core / @actions/github', () => {
    const fs = require('fs')
    const path = require('path')
    const source = fs.readFileSync(
      path.resolve(__dirname, '../src/gitlab-trigger.ts'),
      'utf8'
    )
    expect(source).not.toContain("from './platform/orchestrator'")
    expect(source).not.toContain("from '@actions/core'")
    expect(source).not.toContain("from '@actions/github'")
  })
})
