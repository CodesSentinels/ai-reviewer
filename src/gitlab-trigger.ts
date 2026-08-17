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
import {checkForkMergeRequest, isHeadStale, buildMrIdempotencyKey} from './gitlab-mr-hook-rules'
import {hasHeadBeenReviewed} from './gitlab-mr-idempotency'
import {isSelfNote, buildNoteIdempotencyKey} from './gitlab-note-hook-rules'
import {hasNoteBeenProcessed, markNoteAsProcessed} from './gitlab-note-idempotency'
import {parse, resolveBotMentions} from './commands/parser'

const logger = new GitLabLogger()

/**
 * 从 GitLab 项目路径拆出 owner/repo——subgroup 项目路径可能含多级 namespace
 * （如 group/subgroup/repo），用 lastIndexOf 确保 owner 保留完整 namespace。
 * 与 commands/early-reaction.ts 的同名逻辑保持一致。
 */
function splitProjectPath(projectPath: string): {owner: string; repo: string} {
  const lastSlash = projectPath.lastIndexOf('/')
  return {
    owner: projectPath.substring(0, lastSlash),
    repo: projectPath.substring(lastSlash + 1)
  }
}

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

  // ─── EVENT-012：MR HEAD 陈旧检查 ─────────────────────────────────────────
  //
  // GitLab webhook 不保证顺序投递，CI job 排队期间也可能被更新的 push 事件
  // 抢先执行完。若此时仍按 payload 里那个（已经不是最新的）headSha 跑审查，
  // 审查的是过期代码，且容易和随后处理的新事件互相覆盖评论。写操作前重新
  // 读取当前 HEAD，与事件不一致就跳过——真正最新的 commit 有自己的 webhook
  // 投递，不会因为这次跳过而丢失。
  //
  // 重新读取失败（网络错误等）时不 fail closed：这里防的是「审查陈旧代码」
  // 的浪费/噪音，不是安全边界，查询失败就按事件自带的 headSha 继续，比因为
  // 一次探测失败连正常的审查都拦下更安全。
  const isMrEvent =
    execCtx.eventKind === 'pr_opened' ||
    execCtx.eventKind === 'pr_synchronize' ||
    execCtx.eventKind === 'pr_reopened'
  if (isMrEvent) {
    const {owner, repo} = splitProjectPath(execCtx.projectPath)
    try {
      const current = await platform.getChangeRequest(owner, repo, execCtx.changeRequestId)
      const staleCheck = isHeadStale(execCtx.headSha, current.headSha)
      if (staleCheck.stale) {
        logger.info(
          `MR ${execCtx.changeRequestId} HEAD has moved since this event was emitted ` +
            `(event=${staleCheck.eventHeadSha} current=${staleCheck.currentHeadSha}) — ` +
            'skipping stale delivery (EVENT-012)'
        )
        return
      }
    } catch (e) {
      logger.warning(
        `gitlab-trigger: failed to re-check current MR HEAD before review, proceeding with the ` +
          `event's own headSha: ${redact(String(e))}`
      )
    }

    // ─── EVENT-013：MR 自动审查幂等 ───────────────────────────────────────
    //
    // GitLab webhook 不保证恰好投递一次；CI job 也可能被重试。重复投递同一个
    // headSha 不得重复调模型跑同一次审查。判断依据是 summary note 里已有的
    // reviewed-commit-ids marker（review.ts 每次成功审查后都会写入），见
    // gitlab-mr-idempotency.ts 的文件头说明——不新建独立存储，直接复用这一条
    // 既有机制。
    const alreadyReviewed = await hasHeadBeenReviewed(
      owner,
      repo,
      execCtx.changeRequestId,
      execCtx.headSha
    )
    if (alreadyReviewed) {
      logger.info(
        `MR ${execCtx.changeRequestId} headSha ${execCtx.headSha} already reviewed ` +
          `(idempotency key ${buildMrIdempotencyKey(
            execCtx.projectId,
            execCtx.changeRequestId,
            execCtx.headSha
          )}) — skipping duplicate delivery (EVENT-013)`
      )
      return
    }
  }

  // ─── EVENT-020/021：Note Hook 幂等 ───────────────────────────────────────
  //
  // GitLab webhook 不保证恰好投递一次；CI job 也可能被重试。重复投递同一条
  // note（相同 note_id）不得重复调模型或重复回复。幂等键的记账位置见
  // gitlab-note-idempotency.ts 的文件头说明（独立 note，不与 summary note
  // 混用）。自评论（isBot=true）已经会被下游 dispatcher 过滤掉、不产生任何
  // 调用/回复，这里不必再为它多查一次幂等账本。
  //
  // 只对「确实 @ 了 bot」的 note 记账：完全不提 bot 的普通讨论无论被重复投递
  // 多少次，dispatcher 都会走 `{kind: 'ignored', reason: 'no bot mention'}`
  // 原地跳过，本来就没有副作用可去重——为它写一条记账评论纯属浪费一次 API
  // 调用，还会在 MR 上留下与内容无关的噪音评论。判断标准复用 dispatcher 自己
  // 用来识别命令/对话触发的同一个 parse()，避免这里另起一套 mention 规则
  // 和共享核心的判定跑偏。
  let noteIdempotencyKey: string | null = null
  if (isCommentEvent && !execCtx.actor.isBot && execCtx.comment != null) {
    const mentions = resolveBotMentions(process.env.AI_REVIEWER_BOT_GITLAB_LOGIN)
    const mentionsBot =
      typeof execCtx.comment.body === 'string' &&
      parse(execCtx.comment.body, {registeredCommands: new Set(), botMentions: mentions}).kind !==
        'none'

    if (mentionsBot) {
      noteIdempotencyKey = buildNoteIdempotencyKey(
        execCtx.projectId,
        execCtx.changeRequestId,
        execCtx.comment.id
      )
      const {owner, repo} = splitProjectPath(execCtx.projectPath)
      const alreadyProcessed = await hasNoteBeenProcessed(
        owner,
        repo,
        execCtx.changeRequestId,
        noteIdempotencyKey
      )
      if (alreadyProcessed) {
        logger.info(
          `Note ${execCtx.comment.id} already processed (idempotency key ${noteIdempotencyKey}) — skipping duplicate delivery (EVENT-021)`
        )
        return
      }
    }
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

  // 只在真正跑成功之后才记账——onFailed 会把 exitCode 设成 1，失败的这次不能
  // 被记成"已处理"，否则下次重试会被幂等检查拦住，永远无法真正跑成功。
  if (noteIdempotencyKey != null && process.exitCode !== 1) {
    const {owner, repo} = splitProjectPath(execCtx.projectPath)
    await markNoteAsProcessed(owner, repo, execCtx.changeRequestId, noteIdempotencyKey)
  }
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
