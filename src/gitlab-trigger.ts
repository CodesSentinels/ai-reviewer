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
import {GitLabLogger} from './platform/gitlab-logger'
import {GitLabPlatform} from './platform/gitlab-platform'
import {setPlatform} from './platform/git-platform'
import {setLogger} from './platform/logger'
import {handleExecCtxError} from './platform/exec-ctx-error-handler'
import {validateTriggerPayload} from './gitlab-trigger-validation'
import {redact} from './gitlab-trigger-redact'
import {checkForkMergeRequest} from './gitlab-mr-hook-rules'

const logger = new GitLabLogger()

export async function run(): Promise<void> {
  // 初始化 GitLab Logger（ARCH-014）+ Platform（ARCH-018/020）
  setLogger(logger)

  const gitlabToken = process.env.GITLAB_PAT ?? process.env.CI_JOB_TOKEN ?? ''
  if (gitlabToken === '') {
    logger.error('GITLAB_PAT or CI_JOB_TOKEN is required')
    process.exitCode = 1
    return
  }
  const gitlabHost = process.env.CI_SERVER_URL ?? 'https://gitlab.com'
  setPlatform(new GitLabPlatform(gitlabToken, gitlabHost))

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

  let execCtx
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
  // TODO: 待 GLAPI-* 补全后，此处调用 runOrchestrator 或 dispatchEvent 执行审查。
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
