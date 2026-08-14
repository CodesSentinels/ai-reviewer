/**
 * gitlab-trigger.ts - GitLab trigger CLI 入口（EVENT-001/002）
 *
 * 由 protected main 的 ai-review-trigger job 调用。从 file-type CI 变量
 * TRIGGER_PAYLOAD 指向的文件路径读取原始事件 → 解析 JSON → 结构校验 →
 * 构造 ExecutionContext → 打印摘要。
 *
 * 不 import @actions/core / @actions/github（ARCH-015）。
 * 使用 Logger 抽象（ARCH-012）和 handleExecCtxError（ARCH-026）。
 */
import {readFileSync} from 'fs'
import {createGitLabExecutionContext} from './platform/gitlab-execution-context'
import type {ExecutionContext} from './platform/execution-context'
import {GitLabLogger} from './platform/gitlab-logger'
import {GitLabPlatform} from './platform/gitlab-platform'
import {describeGitLabClientConfig, resolveGitLabClientConfig} from './platform/gitlab-client'
import {setPlatform} from './platform/git-platform'
import {setStateNamespace} from './platform/state-namespace'
import {setLogger} from './platform/logger'
import {handleExecCtxError} from './platform/exec-ctx-error-handler'
import {GitLabConfigProvider} from './platform/gitlab-config-provider'
import {runOrchestrator} from './platform/orchestrator'
import {createBots} from './bot-factory'
import {validateTriggerPayload} from './gitlab-trigger-validation'
import {redact} from './gitlab-trigger-redact'
import {checkForkMergeRequest} from './gitlab-mr-hook-rules'
import {isSelfNote} from './gitlab-note-hook-rules'

const logger = new GitLabLogger()

/**
 * 启动期身份自检（GLAPI-022/029）。
 *
 * 作用范围严格限定在**身份**：探 `GET /user`，回答「凭据能不能解析出自己是谁」。
 * 它证明不了权限查询可用——那条链路走的是 `GET /users` +
 * `GET /projects/:id/members`，是另外的端点和授权范围。所以这里的日志只谈
 * bot 身份，不谈命令权限；凭据类型层面的能力差异由
 * JOB_TOKEN_LIMITATION_WARNING 在配置期声明，运行期的权限判定由
 * getCollaboratorPermission 抛错 + dispatcher 的 queryFailed 分支 fail closed。
 *
 * 自检失败不中止运行：CI_JOB_TOKEN 是文档里支持的认证方式，只是能力受限。
 */
async function verifyBotIdentity(platform: GitLabPlatform): Promise<string[]> {
  const configuredLogin = (process.env.AI_REVIEWER_BOT_GITLAB_LOGIN ?? '').trim()
  try {
    const login = await platform.verifyCredential()
    logger.info(`GitLab bot identity resolved: acting as @${login}`)
    if (configuredLogin !== '' && configuredLogin.toLowerCase() !== login.toLowerCase()) {
      // 两者不一致几乎总是配错了（改过 PAT 却忘了改配置），必须说出来
      logger.warning(
        `AI_REVIEWER_BOT_GITLAB_LOGIN is "${configuredLogin}" but the credential belongs to ` +
          `"${login}" — both are treated as the reviewer's own identity; ` +
          'update the configuration to match the credential.'
      )
    }
    // 自检成功时**两个身份都算自己**。
    //
    // 早先只返回配置值（配置优先），结果配置过期或写错时，真实账号发出的 note
    // 不会被识别成自评论——反馈循环保护恰好在最容易配错的场景下失效。真实身份
    // 来自凭据，是最可靠的那一个；配置值仍然保留，因为它可能指向另一个也属于
    // 本 reviewer 的账号（例如轮换期新旧两个 PAT）。
    return [login, configuredLogin].filter(v => v !== '')
  } catch (e) {
    const detail = redact(e instanceof Error ? e.message : String(e))
    if (configuredLogin !== '') {
      // 自检失败时拿不到真实身份，只能退回配置值
      logger.warning(
        `GitLab bot identity check failed (${detail}); using the configured bot login ` +
          `"${configuredLogin}".`
      )
      return [configuredLogin]
    }
    logger.warning(
      `GitLab bot identity check failed (${detail}) and AI_REVIEWER_BOT_GITLAB_LOGIN is not set. ` +
        'Bot-authored threads will not be recognized. Set AI_REVIEWER_BOT_GITLAB_LOGIN to the ' +
        'bot username, or use a GITLAB_PAT whose identity can be resolved.'
    )
    return []
  }
}

export async function run(): Promise<void> {
  // 初始化 GitLab Logger（ARCH-014）+ Platform（ARCH-018/020）
  setLogger(logger)

  // GLAPI-029：host / 凭据 / timeout 统一从受信任配置解析并校验，非法即 fail closed
  let clientConfig
  try {
    clientConfig = resolveGitLabClientConfig()
  } catch (e) {
    logger.error(redact(e instanceof Error ? e.message : String(e)))
    process.exitCode = 1
    return
  }
  // 摘要只含 host/凭据类型/timeout，不含 token（GLAPI-029）；
  // 走 debug 级别，避免在事件被拒绝（如 fork MR）前产生无关输出
  logger.debug(`GitLab client: ${describeGitLabClientConfig(clientConfig)}`)
  const platform = new GitLabPlatform(clientConfig)
  setPlatform(platform)
  // GH-014 / STATE-006：本次运行写入的 marker / 幂等键带 gitlab: 命名空间
  setStateNamespace('gitlab')

  const payloadPath = process.env.TRIGGER_PAYLOAD
  if (payloadPath == null || payloadPath === '') {
    logger.error('TRIGGER_PAYLOAD is not set')
    process.exitCode = 1
    return
  }

  let raw: string
  try {
    raw = readFileSync(payloadPath, 'utf8')
  } catch (e) {
    logger.error(`Failed to read TRIGGER_PAYLOAD file: ${redact(String(e))}`)
    process.exitCode = 1
    return
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    logger.error('TRIGGER_PAYLOAD content is not valid JSON')
    process.exitCode = 1
    return
  }

  const validation = validateTriggerPayload(parsed)
  if (!validation.ok) {
    logger.error(`TRIGGER_PAYLOAD failed validation: ${validation.reason}`)
    process.exitCode = 1
    return
  }
  if (validation.sourceTargetMismatch) {
    // EVENT-010：fork MR 是需要人工关注的安全边界，fail closed 而非优雅跳过
    // （区别于 unknown_event 的 exit 0 语义）——见 docs/tasks/gitlab-mr-hook-design.md 第 3.2 节。
    const attrs = (parsed as Record<string, any>).object_attributes
    const forkCheck = checkForkMergeRequest(attrs.source_project_id, attrs.target_project_id)
    logger.error(`Rejected: fork MR not supported (MVP) — ${redact(forkCheck.reason ?? '')}`)
    process.exitCode = 1
    return
  }

  let execCtx: ExecutionContext
  try {
    execCtx = createGitLabExecutionContext(parsed)
  } catch (e) {
    // ARCH-026：统一 ExecCtxError 处理
    const result = handleExecCtxError(e, logger, (msg: string) => {
      logger.error(redact(msg))
      process.exitCode = 1
    })
    if (result === 'skip') return // 无关事件，成功退出
    return // fatal，exitCode 已设置
  }

  logger.info(
    `GitLab event validated: platform=${execCtx.platform} eventKind=${execCtx.eventKind} project=${execCtx.projectPath} mr=${execCtx.changeRequestId}`
  )

  // 事件被接受之后才自检：被拒绝的事件（fork MR、无关事件）不该产生无关输出，
  // 也不该为此多打一次 API
  const botLogins = await verifyBotIdentity(platform)

  // ─── EVENT-018：自评论过滤 ───────────────────────────────────────────────
  //
  // ExecutionContext 构造阶段把 actor.isBot 恒定填 false，是刻意的：那一层不该
  // 依赖「已配置的 PAT 用户名」这个外部输入（ARCH-002）。但共享 dispatcher 只按
  // actor.isBot 过滤自评论，所以判定必须在这里补上——否则 bot 自己的回帖会再次
  // 触发命令，形成反馈循环。
  //
  // 只对评论类事件生效：MR 事件的 actor 是提交者，与反馈循环无关。
  const isCommentEvent =
    execCtx.eventKind === 'comment_created' || execCtx.eventKind === 'review_comment_created'
  if (isCommentEvent && botLogins.some(login => isSelfNote(execCtx.actor.login, login))) {
    execCtx = {...execCtx, actor: {...execCtx.actor, isBot: true}}
    logger.info(`Note authored by the reviewer itself (@${execCtx.actor.login}) — will be ignored`)
  }

  // ─── 执行审查 / 命令（ARCH-025）──────────────────────────────────────────
  //
  // 走与 GitHub 入口完全相同的编排层：配置 → 事件分发 → codeReview 或
  // handleCommentEvent。两个入口的差异只剩下 configProvider / logger /
  // 失败处理这三件平台相关的事。
  //
  // 这一步长期接不上，卡的不是 GLAPI（§7 早已全绿），而是共享核心里
  // review.ts / commenter.ts / commands/dispatcher.ts 三个文件在**模块级**
  // 求值 `@actions/github` 的 `context.repo`——那个 getter 没有
  // GITHUB_REPOSITORY 就抛，于是本文件一 import 编排层，模块加载阶段就崩，
  // run() 根本执行不到。三者迁移到 ExecutionContext 之后（ARCH-005），
  // 这里才成立。
  await runOrchestrator({
    configProvider: new GitLabConfigProvider(),
    // ExecutionContext 已在上面构造并校验过，这里直接复用，不重复解析 payload
    createExecCtx: () => execCtx,
    logger,
    onFailed: (msg: string) => {
      logger.error(redact(msg))
      process.exitCode = 1
    },
    createBots: options => createBots(options, (msg: string) => logger.warning(redact(msg)))
  })
}

// 不用顶层 await（同 main.ts 的既有原因）
void (async (): Promise<void> => {
  try {
    await run()
  } catch (e) {
    logger.error(`Unhandled error in gitlab-trigger run(): ${redact(String(e))}`)
    process.exitCode = 1
  }
})()
