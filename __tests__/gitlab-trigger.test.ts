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
import noteToplevel from './fixtures/gitlab-note-hook-toplevel.json'

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
// EVENT-012 陈旧检查会调 MergeRequests.show() 重新读取当前 HEAD；不 mock 时
// 直接抛错，恰好落入「读取失败→放行」分支，掩盖了「读取成功→比较结果」这条
// 真正要测的路径，所以这里显式给出可控的默认返回值。
const mockMergeRequests = {show: jest.fn<(...a: any[]) => Promise<any>>()}
jest.mock('@gitbeaker/rest', () => ({
  Gitlab: jest.fn().mockImplementation(() => ({Users: mockUsers, MergeRequests: mockMergeRequests}))
}))

// EVENT-020/021 幂等账本的存储机制（gitlab-note-idempotency.ts）已有独立单元
// 测试覆盖其自身的读写正确性；这里只关心 gitlab-trigger.ts 有没有在正确的
// 位置调用它、参数对不对、命中时是否真的短路——不需要真的经过
// GitLabPlatform/@gitbeaker 才能验证这件事。
const noteIdempotencyState = {
  hasNoteBeenProcessed: jest.fn<(...a: any[]) => Promise<boolean>>(),
  markNoteAsProcessed: jest.fn<(...a: any[]) => Promise<void>>()
}
jest.mock('../src/gitlab-note-idempotency', () => ({
  hasNoteBeenProcessed: (...a: any[]) => noteIdempotencyState.hasNoteBeenProcessed(...a),
  markNoteAsProcessed: (...a: any[]) => noteIdempotencyState.markNoteAsProcessed(...a)
}))

// EVENT-013 幂等判断的读取机制（gitlab-mr-idempotency.ts）已有独立单元测试
// 覆盖其自身的 marker 解析正确性；这里同样只关心 gitlab-trigger.ts 有没有在
// EVENT-012 陈旧检查之后、runOrchestrator 之前调用它、参数对不对、命中时是否
// 真的短路。
const mrIdempotencyState = {
  hasHeadBeenReviewed: jest.fn<(...a: any[]) => Promise<boolean>>()
}
jest.mock('../src/gitlab-mr-idempotency', () => ({
  hasHeadBeenReviewed: (...a: any[]) => mrIdempotencyState.hasHeadBeenReviewed(...a)
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
    // clearAllMocks 只清 mock.calls，不清 mockResolvedValue/mockRejectedValue
    // 配置的实现；EVENT-012/013 用例会显式给 mockMergeRequests.show 配置返回值，
    // 不在这里 mockReset() 的话，那份配置会原样"泄漏"进文件里排在它们之后的
    // 用例（如「身份自检」），让那些原本依赖"调用 MergeRequests 会失败"这个
    // 前提的用例意外变成"调用成功"，进而在没被完整 mock 的下游 codeReview 里
    // 产生这里根本不关心的 errorSpy/exitCode 噪音。
    mockMergeRequests.show.mockReset()
    delete process.env.TRIGGER_PAYLOAD
    // GitLabPlatform 初始化需要 token
    process.env.GITLAB_PAT = 'glpat-test-token'
    delete process.env.AI_REVIEWER_BOT_GITLAB_LOGIN
    mockUsers.showCurrentUser.mockResolvedValue({username: 'ai-reviewer-bot'})
    // 故意不给 mockMergeRequests.show 配置默认返回值：本文件的既有用例（EVENT-012
    // 之外）依赖的是「@gitbeaker/rest 没被完整 mock、调用 MergeRequests 会失败」这个
    // 原有前提本身被下游（codeReview / dispatcher）优雅吞掉，不产生 errorSpy/exitCode。
    // 只在 EVENT-012/013 describe 块内部按需显式配置 resolve/reject，避免影响其余用例。
    // 默认"未处理过"，让不关心幂等这条线的既有用例保持原有行为
    noteIdempotencyState.hasNoteBeenProcessed.mockResolvedValue(false)
    noteIdempotencyState.markNoteAsProcessed.mockResolvedValue(undefined)
    // 默认"未审查过"，让不关心 EVENT-013 这条线的既有用例保持原有行为
    mrIdempotencyState.hasHeadBeenReviewed.mockResolvedValue(false)
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

  // ─── EVENT-012：MR HEAD 陈旧检查 ─────────────────────────────────────────

  describe('EVENT-012：MR HEAD 陈旧检查', () => {
    /**
     * 这四个用例只关心「陈旧判断本身对不对」，不断言 codeReview 之后能否
     * 全须全尾跑完——本文件刻意不完整 mock @gitbeaker/rest 的全部 resource
     * （见文件头说明），"未陈旧"分支之后 codeReview 会继续调用其他没配置的
     * API 而失败，那是本文件既有的、与 EVENT-012 无关的 mocking 缺口，
     * 完整平台行为覆盖属于 gitlab-trigger-dispatch.integration.test.ts。
     */
    test('重新读取到的 HEAD 与事件一致 → 不判定为陈旧，不提前跳过', async () => {
      process.env.TRIGGER_PAYLOAD = '/tmp/payload.json'
      fsState.readFileSync.mockReturnValue(JSON.stringify(mrOpen))
      mockMergeRequests.show.mockResolvedValue({
        iid: 7,
        title: 'MR title',
        description: 'MR body',
        state: 'opened',
        target_branch: 'main',
        source_branch: 'feature',
        diff_refs: {base_sha: 'base-sha-0001', head_sha: 'head-sha-0001'},
        author: {username: 'alice'}
      })

      await runTrigger()

      expect(mockMergeRequests.show).toHaveBeenCalledWith('octo/demo', 7)
      const logged = logSpy.mock.calls.map(c => String(c[0])).join('\n')
      expect(logged).not.toContain('skipping stale delivery')
    })

    test('重新读取到的 HEAD 已经变化 → 跳过，不进入编排层', async () => {
      process.env.TRIGGER_PAYLOAD = '/tmp/payload.json'
      fsState.readFileSync.mockReturnValue(JSON.stringify(mrOpen))
      mockMergeRequests.show.mockResolvedValue({
        iid: 7,
        title: 'MR title',
        description: 'MR body',
        state: 'opened',
        target_branch: 'main',
        source_branch: 'feature',
        diff_refs: {base_sha: 'base-sha-0001', head_sha: 'head-sha-9999'},
        author: {username: 'alice'}
      })

      await runTrigger()

      // 判定为陈旧后提前 return，不会走到 runOrchestrator/codeReview，
      // 这条路径本身不触碰任何未 mock 的 API，因此可以放心断言干净退出。
      expect(errorSpy).not.toHaveBeenCalled()
      expect(process.exitCode).toBeUndefined()
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'event=head-sha-0001 current=head-sha-9999) — skipping stale delivery (EVENT-012)'
        )
      )
    })

    test('重新读取 HEAD 失败 → 记警告但不 fail closed，不提前跳过', async () => {
      process.env.TRIGGER_PAYLOAD = '/tmp/payload.json'
      fsState.readFileSync.mockReturnValue(JSON.stringify(mrOpen))
      mockMergeRequests.show.mockRejectedValue(new Error('502 Bad Gateway'))

      await runTrigger()

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('failed to re-check current MR HEAD before review')
      )
      const logged = logSpy.mock.calls.map(c => String(c[0])).join('\n')
      expect(logged).not.toContain('skipping stale delivery')
    })

    test('评论类事件不触发 HEAD 陈旧检查', async () => {
      process.env.TRIGGER_PAYLOAD = '/tmp/payload.json'
      fsState.readFileSync.mockReturnValue(JSON.stringify(noteToplevel))

      await runTrigger()

      // dispatcher.ts 自己也会查一次 head/base sha + 作者（与陈旧检查无关），
      // 这里断言只发生了那一次，证明 EVENT-012 没有对评论事件多查一次陈旧账本。
      expect(mockMergeRequests.show).toHaveBeenCalledTimes(1)
      const logged = logSpy.mock.calls.map(c => String(c[0])).join('\n')
      expect(logged).not.toContain('skipping stale delivery')
    })
  })

  // ─── EVENT-013：MR 自动审查幂等 ─────────────────────────────────────────

  describe('EVENT-013：MR 自动审查幂等', () => {
    beforeEach(() => {
      // 让 EVENT-012 陈旧检查判定为「未陈旧」，走到 EVENT-013 这一步
      mockMergeRequests.show.mockResolvedValue({
        iid: 7,
        title: 'MR title',
        description: 'MR body',
        state: 'opened',
        target_branch: 'main',
        source_branch: 'feature',
        diff_refs: {base_sha: 'base-sha-0001', head_sha: 'head-sha-0001'},
        author: {username: 'alice'}
      })
    })

    test('未审查过 → 不跳过，按正确参数查询过一次', async () => {
      process.env.TRIGGER_PAYLOAD = '/tmp/payload.json'
      fsState.readFileSync.mockReturnValue(JSON.stringify(mrOpen))
      mrIdempotencyState.hasHeadBeenReviewed.mockResolvedValue(false)

      await runTrigger()

      expect(mrIdempotencyState.hasHeadBeenReviewed).toHaveBeenCalledWith(
        'octo',
        'demo',
        7,
        'head-sha-0001'
      )
      const logged = logSpy.mock.calls.map(c => String(c[0])).join('\n')
      expect(logged).not.toContain('already reviewed')
    })

    test('已审查过 → 跳过，不进入编排层', async () => {
      process.env.TRIGGER_PAYLOAD = '/tmp/payload.json'
      fsState.readFileSync.mockReturnValue(JSON.stringify(mrOpen))
      mrIdempotencyState.hasHeadBeenReviewed.mockResolvedValue(true)

      await runTrigger()

      expect(errorSpy).not.toHaveBeenCalled()
      expect(process.exitCode).toBeUndefined()
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'headSha head-sha-0001 already reviewed (idempotency key ' +
            'gitlab:42:7:head:head-sha-0001) — skipping duplicate delivery (EVENT-013)'
        )
      )
    })

    test('评论类事件不触发 EVENT-013 检查', async () => {
      process.env.TRIGGER_PAYLOAD = '/tmp/payload.json'
      fsState.readFileSync.mockReturnValue(JSON.stringify(noteToplevel))

      await runTrigger()

      expect(mrIdempotencyState.hasHeadBeenReviewed).not.toHaveBeenCalled()
    })
  })

  // ─── EVENT-020/021：Note Hook 幂等 ───────────────────────────────────────

  describe('EVENT-020/021：Note Hook 幂等', () => {
    test('首次投递（未处理过）→ 正常走完编排层，成功后记账', async () => {
      process.env.TRIGGER_PAYLOAD = '/tmp/payload.json'
      fsState.readFileSync.mockReturnValue(JSON.stringify(noteToplevel))
      noteIdempotencyState.hasNoteBeenProcessed.mockResolvedValue(false)

      await runTrigger()

      expect(noteIdempotencyState.hasNoteBeenProcessed).toHaveBeenCalledWith(
        'octo',
        'demo',
        7,
        'gitlab:42:7:note:5001:create'
      )
      // 未失败（onFailed 没被触发）才应该记账
      expect(process.exitCode).not.toBe(1)
      expect(noteIdempotencyState.markNoteAsProcessed).toHaveBeenCalledWith(
        'octo',
        'demo',
        7,
        'gitlab:42:7:note:5001:create'
      )
    })

    test('重复投递（已处理过）→ 直接跳过，不记第二次账', async () => {
      process.env.TRIGGER_PAYLOAD = '/tmp/payload.json'
      fsState.readFileSync.mockReturnValue(JSON.stringify(noteToplevel))
      noteIdempotencyState.hasNoteBeenProcessed.mockResolvedValue(true)

      await runTrigger()

      expect(errorSpy).not.toHaveBeenCalled()
      expect(process.exitCode).toBeUndefined()
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('already processed (idempotency key gitlab:42:7:note:5001:create)')
      )
      expect(noteIdempotencyState.markNoteAsProcessed).not.toHaveBeenCalled()
    })

    test('MR 事件（非评论类）不触发幂等检查', async () => {
      process.env.TRIGGER_PAYLOAD = '/tmp/payload.json'
      fsState.readFileSync.mockReturnValue(JSON.stringify(mrOpen))

      await runTrigger()

      expect(noteIdempotencyState.hasNoteBeenProcessed).not.toHaveBeenCalled()
      expect(noteIdempotencyState.markNoteAsProcessed).not.toHaveBeenCalled()
    })
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

  /**
   * Issue #124（2026-08-18 真实环境验证发现）：main.ts 一直传了
   * earlyReaction，gitlab-trigger.ts 没传，导致 GitLab 侧命令/对话式追问从未
   * 收到 Award Emoji ACK。tryEarlyReaction() 本身早已是平台无关实现，缺的只
   * 是这一行接线——真实调用链路的断言放在
   * gitlab-trigger-dispatch.integration.test.ts（那边已经完整 mock 了
   * getPlatform()，能直接断言 addReaction 被调用；本文件只 mock 了部分
   * @gitbeaker/rest 资源，不足以让 help 命令走完全程）。
   */
  test('earlyReaction 回调已作为 runOrchestrator 的参数传入（Issue #124）', () => {
    const fs = jest.requireActual('fs') as typeof import('fs')
    const path = require('path')
    const source: string = fs.readFileSync(
      path.resolve(__dirname, '../src/gitlab-trigger.ts'),
      'utf8'
    )
    expect(source).toMatch(/earlyReaction:\s*tryEarlyReaction/)
  })
})
