/**
 * gitlab-trigger.ts - GitLab trigger CLI 入口（EVENT-001/002）
 *
 * 由 protected main 的 ai-review-trigger job 调用。从 file-type CI 变量
 * TRIGGER_PAYLOAD 指向的文件路径读取原始事件 → 解析 JSON → 结构校验 →
 * 构造 ExecutionContext → 打印摘要。
 *
 * 成功路径目前只打印日志，不调用模型、不写 GitLab note/discussion——真正的
 * 审查/评论动作需要 GLAPI-*（GitLab REST API adapter），不在本任务实现。
 *
 * 不 import @actions/core / @actions/github（ARCH-015）。
 * 使用 Logger 抽象（ARCH-012）和 handleExecCtxError（ARCH-026）。
 */
import {readFileSync} from 'fs'
import {createGitLabExecutionContext} from './platform/gitlab-execution-context'
import {GitLabLogger} from './platform/gitlab-logger'
import {setLogger} from './platform/logger'
import {handleExecCtxError} from './platform/exec-ctx-error-handler'
import {validateTriggerPayload} from './gitlab-trigger-validation'
import {redact} from './gitlab-trigger-redact'

const logger = new GitLabLogger()

export async function run(): Promise<void> {
  // 初始化 GitLab Logger（ARCH-014）
  setLogger(logger)

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
    logger.info(
      'Note: source_project_id != target_project_id (fork MR) — rejection logic is EVENT-010, not yet implemented'
    )
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
  // 真正的审查/评论动作需要 GLAPI-*，本任务不实现。
  // 待 GLAPI 就绪后，此处调用 runOrchestrator 或 dispatchEvent。
}

// 不用顶层 await（同 main.ts 的既有原因）
void (async (): Promise<void> => {
  try {
    await run()
  } catch (e) {
    logger.error(
      `Unhandled error in gitlab-trigger run(): ${redact(String(e))}`
    )
    process.exitCode = 1
  }
})()
