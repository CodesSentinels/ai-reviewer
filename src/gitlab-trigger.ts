/**
 * gitlab-trigger.ts - GitLab trigger CLI 入口（EVENT-001/002）
 *
 * 由 protected main 的 ai-review-trigger job 调用（未来，本任务不含该 CI 接入，
 * 见 docs/tasks/gitlab-trigger-cli-design.md 阶段四）。从 file-type CI 变量
 * TRIGGER_PAYLOAD 指向的文件路径读取原始事件 → 解析 JSON → 结构校验 →
 * 构造 ExecutionContext → 打印摘要。
 *
 * 成功路径目前只打印日志，不调用模型、不写 GitLab note/discussion——真正的
 * 审查/评论动作需要 GLAPI-*（GitLab REST API adapter），本任务不实现，见设计
 * 文档第 3 节。
 *
 * 注：不 import @actions/core / @actions/github——GitLab-only 启动不得依赖
 * GitHub 专有运行时（对齐 ARCH-015）。Logger 抽象本身是 ARCH-012~015 的范围，
 * 本文件暂时直接用 console，等 Logger 任务落地后切换。
 */
import {readFileSync} from 'fs'
import {createGitLabExecutionContext} from './platform/gitlab-execution-context'
import {ExecutionContextError} from './platform/execution-context'
import {validateTriggerPayload} from './gitlab-trigger-validation'
import {redact} from './gitlab-trigger-redact'

export async function run(): Promise<void> {
  const payloadPath = process.env.TRIGGER_PAYLOAD
  if (payloadPath == null || payloadPath === '') {
    console.error('TRIGGER_PAYLOAD is not set')
    process.exitCode = 1
    return
  }

  let raw: string
  try {
    raw = readFileSync(payloadPath, 'utf8')
  } catch (e) {
    console.error(`Failed to read TRIGGER_PAYLOAD file: ${redact(String(e))}`)
    process.exitCode = 1
    return
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // 不打印 raw 内容本身——即使只是"JSON 解析失败"也可能包含敏感字段
    console.error('TRIGGER_PAYLOAD content is not valid JSON')
    process.exitCode = 1
    return
  }

  const validation = validateTriggerPayload(parsed)
  if (!validation.ok) {
    console.error(`TRIGGER_PAYLOAD failed validation: ${validation.reason}`)
    process.exitCode = 1
    return
  }
  if (validation.sourceTargetMismatch) {
    // EVENT-003 只做结构校验 + 记录；是否拒绝 fork MR 是 EVENT-010，不在本任务实现
    console.log(
      'Note: source_project_id != target_project_id (fork MR) — rejection logic is EVENT-010, not yet implemented'
    )
  }

  let execCtx
  try {
    execCtx = createGitLabExecutionContext(parsed)
  } catch (e) {
    if (
      e instanceof ExecutionContextError &&
      (e.reason === 'unknown_event' || e.reason === 'ignorable_event')
    ) {
      // EVENT-004：完全不认识的事件（unknown_event）；EVENT-016/017：认识但
      // 业务上不需要处理的事件，如 note 编辑/删除、system note（ignorable_event，
      // 修复 Issue #66）。两者都优雅跳过，不应 fail closed。
      console.log(`Skipped: ${e.message}`)
      return
    }
    console.error(
      `Failed to build ExecutionContext: ${redact(
        e instanceof Error ? e.message : String(e)
      )}`
    )
    process.exitCode = 1
    return
  }

  console.log(
    `GitLab event validated: platform=${execCtx.platform} eventKind=${execCtx.eventKind} project=${execCtx.projectPath} mr=${execCtx.changeRequestId}`
  )
  // 真正的审查/评论动作需要 GLAPI-*（GitLab REST API adapter），本任务不实现。
}

// 不用顶层 await（同 main.ts 的既有原因：ts-jest 的 CommonJS 转译不支持顶层
// await，会导致本文件无法被测试 import）。run() 内部已自行处理所有已知错误
// 路径并设置 exitCode，理论上不会 reject；仍加 catch 兜底避免真正的意外异常
// 变成未处理的 Promise rejection。
void (async (): Promise<void> => {
  try {
    await run()
  } catch (e) {
    console.error(
      `Unhandled error in gitlab-trigger run(): ${redact(String(e))}`
    )
    process.exitCode = 1
  }
})()
