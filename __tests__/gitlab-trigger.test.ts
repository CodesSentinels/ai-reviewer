/**
 * gitlab-trigger.test.ts — CLI 入口行为断言（EVENT-001/002/004，含 EVENT-016/017）
 *
 * c9672be 的提交信息称"已用 ts-node 对全部 7 种场景手动跑通验证"，但没有留下
 * 自动化测试——本文件把那些手动场景转成自动化用例，只 mock `fs.readFileSync`
 * （文件 IO 边界），validateTriggerPayload/createGitLabExecutionContext/redact
 * 全部用真实实现，贴近 CLI 实际的端到端行为。
 *
 * note action != create 的用例此前刻意保留 fail-closed 行为并断言之
 * （Issue #66 已知缺口）；本文件随 EVENT-016/017 的修复同步更新为断言
 * 优雅跳过（exit 0），并新增 system note/非 MR note 两个同类场景。
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
import noteSystem from './fixtures/gitlab-note-hook-system.json'
import noteNonMr from './fixtures/gitlab-note-hook-non-mr.json'

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
  let errorSpy: jest.SpiedFunction<typeof console.error>

  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.TRIGGER_PAYLOAD
    process.exitCode = undefined
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
    errorSpy.mockRestore()
    process.exitCode = undefined
  })

  test('TRIGGER_PAYLOAD 未设置 → 报错退出，不读文件', async () => {
    await runTrigger()

    expect(errorSpy).toHaveBeenCalledWith('TRIGGER_PAYLOAD is not set')
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
      'TRIGGER_PAYLOAD content is not valid JSON'
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
    expect(logSpy).toHaveBeenCalledWith(
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
      'TRIGGER_PAYLOAD failed validation: missing object_attributes.iid'
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

  test('EVENT-016/017（Issue #66 修复）：note action != create → 优雅跳过，退出码保持成功', async () => {
    process.env.TRIGGER_PAYLOAD = '/tmp/payload.json'
    fsState.readFileSync.mockReturnValue(JSON.stringify(noteNonCreate))

    await runTrigger()

    expect(errorSpy).not.toHaveBeenCalled()
    expect(process.exitCode).toBeUndefined()
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("note action is 'update', not 'create'")
    )
  })

  test('EVENT-017：system note → 优雅跳过，退出码保持成功', async () => {
    process.env.TRIGGER_PAYLOAD = '/tmp/payload.json'
    fsState.readFileSync.mockReturnValue(JSON.stringify(noteSystem))

    await runTrigger()

    expect(errorSpy).not.toHaveBeenCalled()
    expect(process.exitCode).toBeUndefined()
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('system note'))
  })

  test('EVENT-017：非 MR note（noteable_type=Issue）→ 优雅跳过，退出码保持成功', async () => {
    process.env.TRIGGER_PAYLOAD = '/tmp/payload.json'
    fsState.readFileSync.mockReturnValue(JSON.stringify(noteNonMr))

    await runTrigger()

    expect(errorSpy).not.toHaveBeenCalled()
    expect(process.exitCode).toBeUndefined()
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('is not MergeRequest')
    )
  })
})
