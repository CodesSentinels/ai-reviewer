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
import {describe, expect, test, jest, beforeEach, afterEach} from '@jest/globals'

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

// 凭据自检会真的调 Users.showCurrentUser()，必须 mock 掉，
// 否则测试会朝 gitlab.com 发真实请求
const mockUsers = {showCurrentUser: jest.fn<() => Promise<any>>()}
jest.mock('@gitbeaker/rest', () => ({
  Gitlab: jest.fn().mockImplementation(() => ({Users: mockUsers}))
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
    // GitLabPlatform 初始化需要 token
    process.env.GITLAB_PAT = 'glpat-test-token'
    delete process.env.AI_REVIEWER_BOT_GITLAB_LOGIN
    mockUsers.showCurrentUser.mockResolvedValue({username: 'ai-reviewer-bot'})
    process.exitCode = undefined
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
    warnSpy.mockRestore()
    errorSpy.mockRestore()
    delete process.env.GITLAB_PAT
    delete process.env.CI_JOB_TOKEN
    delete process.env.AI_REVIEWER_BOT_GITLAB_LOGIN
    process.exitCode = undefined
  })

  test('GITLAB_PAT 和 CI_JOB_TOKEN 均未设置 → 报错退出', async () => {
    delete process.env.GITLAB_PAT
    delete process.env.CI_JOB_TOKEN
    await runTrigger()

    expect(errorSpy).toHaveBeenCalledWith('[ERROR] GITLAB_PAT or CI_JOB_TOKEN is required')
    expect(process.exitCode).toBe(1)
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

    expect(errorSpy).toHaveBeenCalledWith('[ERROR] TRIGGER_PAYLOAD content is not valid JSON')
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
      expect.stringContaining('Skipped: Unsupported GitLab object_kind: pipeline')
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

  test('fork MR（source!=target）→ EVENT-010 fail closed 拒绝，退出码 1，不构造 ExecutionContext', async () => {
    process.env.TRIGGER_PAYLOAD = '/tmp/payload.json'
    fsState.readFileSync.mockReturnValue(JSON.stringify(mrFork))

    await runTrigger()

    expect(process.exitCode).toBe(1)
    expect(logSpy).not.toHaveBeenCalled()
    const message = errorSpy.mock.calls[0][0] as string
    expect(message).toContain('Rejected: fork MR not supported')
    expect(message).toContain('source_project_id(99) !== target_project_id(42)')
  })

  test('EVENT-016/017（Issue #66 修复）：note action != create → 优雅跳过，退出码保持成功', async () => {
    process.env.TRIGGER_PAYLOAD = '/tmp/payload.json'
    fsState.readFileSync.mockReturnValue(JSON.stringify(noteNonCreate))

    await runTrigger()

    expect(errorSpy).not.toHaveBeenCalled()
    expect(process.exitCode).toBeUndefined()
    // 优雅跳过走 GitLabLogger.warning → console.warn
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("note action is 'update', not 'create'")
    )
  })

  test('EVENT-017：system note → 优雅跳过，退出码保持成功', async () => {
    process.env.TRIGGER_PAYLOAD = '/tmp/payload.json'
    fsState.readFileSync.mockReturnValue(JSON.stringify(noteSystem))

    await runTrigger()

    expect(errorSpy).not.toHaveBeenCalled()
    expect(process.exitCode).toBeUndefined()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('system note'))
  })

  test('EVENT-017：非 MR note（noteable_type=Issue）→ 优雅跳过，退出码保持成功', async () => {
    process.env.TRIGGER_PAYLOAD = '/tmp/payload.json'
    fsState.readFileSync.mockReturnValue(JSON.stringify(noteNonMr))

    await runTrigger()

    expect(errorSpy).not.toHaveBeenCalled()
    expect(process.exitCode).toBeUndefined()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('is not MergeRequest'))
  })

  // ─── GLAPI-022/029：凭据自检 ─────────────────────────────────────────────

  describe('身份自检', () => {
    beforeEach(() => {
      process.env.TRIGGER_PAYLOAD = '/tmp/payload.json'
      fsState.readFileSync.mockReturnValue(JSON.stringify(mrOpen))
    })

    test('自检成功 → 打印真实 bot 身份，不报错', async () => {
      await runTrigger()

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('acting as @ai-reviewer-bot'))
      expect(process.exitCode).toBeUndefined()
    })

    test('自检失败且未配置 bot login → 只谈身份后果，不冒充权限结论', async () => {
      mockUsers.showCurrentUser.mockRejectedValue(new Error('401 Unauthorized'))

      await runTrigger()

      const warned = warnSpy.mock.calls.map(c => String(c[0])).join('\n')
      expect(warned).toContain('bot identity check failed')
      expect(warned).toContain('AI_REVIEWER_BOT_GITLAB_LOGIN')
      // 自检探的是 GET /user，证明不了权限链路（GET /users + /members）的可用性，
      // 所以不得声称「所有命令会被拒」——那是凭据类型层面的结论
      expect(warned).not.toContain('deny everyone')
      expect(warned).not.toContain('permission')
      // 自检失败不 fail closed：job token 是文档支持的认证方式，只是能力受限
      expect(process.exitCode).toBeUndefined()
    })

    test('自检失败但配了 bot login → 降级为「继续用配置值」而不是全量告警', async () => {
      process.env.AI_REVIEWER_BOT_GITLAB_LOGIN = 'my-bot'
      mockUsers.showCurrentUser.mockRejectedValue(new Error('401 Unauthorized'))

      await runTrigger()

      const warned = warnSpy.mock.calls.map(c => String(c[0])).join('\n')
      expect(warned).toContain('using the configured bot login')
      expect(warned).toContain('my-bot')
    })

    test('配置的 bot login 与凭据真实身份不一致 → 告警（几乎总是配错了）', async () => {
      process.env.AI_REVIEWER_BOT_GITLAB_LOGIN = 'wrong-bot'

      await runTrigger()

      const warned = warnSpy.mock.calls.map(c => String(c[0])).join('\n')
      expect(warned).toContain('wrong-bot')
      expect(warned).toContain('ai-reviewer-bot')
      expect(warned).toContain('will not be recognized')
    })

    test('配置值与真实身份一致（忽略大小写）→ 不告警', async () => {
      process.env.AI_REVIEWER_BOT_GITLAB_LOGIN = 'AI-Reviewer-Bot'

      await runTrigger()

      const warned = warnSpy.mock.calls.map(c => String(c[0])).join('\n')
      expect(warned).not.toContain('will not be recognized')
    })

    test('选中 CI_JOB_TOKEN → 配置期就告知能力降级，不必等运行时 401', async () => {
      delete process.env.GITLAB_PAT
      process.env.CI_JOB_TOKEN = 'job-token-value'

      await runTrigger()

      const warned = warnSpy.mock.calls.map(c => String(c[0])).join('\n')
      expect(warned).toContain('CI_JOB_TOKEN')
      expect(warned).toContain('/projects/:id/members')
      expect(warned).toContain('fail closed')
    })
  })

  test('ARCH-015: gitlab-trigger.ts 不 import orchestrator / @actions/core / @actions/github', () => {
    const fs = require('fs')
    const path = require('path')
    const source = fs.readFileSync(path.resolve(__dirname, '../src/gitlab-trigger.ts'), 'utf8')
    expect(source).not.toContain("from './platform/orchestrator'")
    expect(source).not.toContain("from '@actions/core'")
    expect(source).not.toContain("from '@actions/github'")
  })
})
