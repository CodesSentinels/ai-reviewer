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
// 只替换 readFileSync，其余原样透传。
// 早先这里返回一个只有 readFileSync 的对象，等于把整个 fs 挖空——
// 接上共享编排层后传递依赖里有模块在加载期读 fs.promises，会直接抛
// 「Cannot destructure property 'access'」。那是 mock 的问题，不是被测代码的：
// 真实运行环境里 fs.promises 一直都在（打包产物实测可正常启动）。
jest.mock('fs', () => ({
  ...(jest.requireActual('fs') as object),
  readFileSync: (...a: any[]) => fsState.readFileSync(...a)
}))

// Bot 的依赖 p-retry 是纯 ESM，jest 解析不了；本文件关心的是入口编排，
// 不关心模型客户端本身，直接把工厂换成存根。
jest.mock('../src/bot-factory', () => ({
  createBots: () => ({lightBot: {}, heavyBot: {}})
}))

// tokenizer.ts 在模块加载期就 get_encoding('o200k_base')，jest 里解析不到
// wasm 资产。接上共享编排层后它进入本文件的传递依赖，与其他碰到审查核心的
// 用例（characterization / github-only 等）一样在这里替换掉。
// 打包产物不受影响：dist/gitlab-trigger/ 已随构建复制 tiktoken_bg.wasm。
jest.mock('../src/tokenizer', () => ({getTokenCount: () => 0}))

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
      // 不一致仍要告警（几乎总是配错了），但后果不再是「认不出 bot 自己」——
      // 两个身份现在都算 reviewer 本人，见 verifyBotIdentity 的返回值注释。
      // 实际的过滤行为由 gitlab-trigger-dispatch.integration.test.ts 验证。
      expect(warned).not.toContain('will not be recognized')
      expect(warned).toContain("both are treated as the reviewer's own identity")
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

  /**
   * 原先这条还禁止 import orchestrator。那不是 ARCH-015 的本意，而是当时的
   * 权宜之计：共享核心（review.ts / commenter.ts / dispatcher.ts）在模块级求值
   * `@actions/github` 的 context.repo，一 import 编排层就会在加载期崩掉。
   *
   * 三者迁移到 ExecutionContext 之后，GitLab 入口**必须**经由同一个编排层执行
   * 审查——那正是「两个平台调用同一共享核心」的含义。禁令随之取消，改为直接
   * 断言真正的约束：入口不碰平台 SDK。
   */
  test('ARCH-015: gitlab-trigger.ts 不 import @actions/core / @actions/github', () => {
    const fs = jest.requireActual('fs') as typeof import('fs')
    const path = require('path')
    const source: string = fs.readFileSync(
      path.resolve(__dirname, '../src/gitlab-trigger.ts'),
      'utf8'
    )
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(code).not.toContain("from '@actions/core'")
    expect(code).not.toContain("from '@actions/github'")
  })

  test('gitlab-trigger.ts 确实接上了共享编排层（不是空跑到底）', () => {
    // 本文件 mock 了 fs，读真实源码要绕过 mock
    const fs = jest.requireActual('fs') as typeof import('fs')
    const path = require('path')
    const source: string = fs.readFileSync(
      path.resolve(__dirname, '../src/gitlab-trigger.ts'),
      'utf8'
    )
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(code).toContain('runOrchestrator(')
    // 复用已构造好的 execCtx，不重复解析 payload
    expect(code).toMatch(/createExecCtx:\s*\(\)\s*=>\s*execCtx/)
    // 曾经的占位 TODO 必须已经消失
    expect(source).not.toContain('此处调用 runOrchestrator 或 dispatchEvent')
  })
})
