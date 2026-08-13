/**
 * platform/exec-ctx-error-handler.ts — ExecutionContextError 统一处理（ARCH-026）
 *
 * 从 orchestrator.ts 拆出，确保 gitlab-trigger.ts 可以单独引入，
 * 不间接拉入 commenter/review/command-handler 等 GitHub 侧依赖（ARCH-015）。
 */

import {ExecutionContextError} from './execution-context'
import type {Logger} from './logger'

/**
 * ExecutionContextError 统一处理（ARCH-026）。
 *
 * @returns 'skip' 表示无关事件可跳过，'fatal' 表示需要 fail closed
 */
export function handleExecCtxError(
  e: unknown,
  logger: Logger,

  onFailed: (msg: string) => void
): 'skip' | 'fatal' {
  if (
    e instanceof ExecutionContextError &&
    (e.reason === 'unknown_event' || e.reason === 'ignorable_event')
  ) {
    // unknown_event：完全不认识的事件；ignorable_event：认识但业务上不需要处理
    // 的事件（note 编辑/删除、system note、非 MR note，见 EVENT-016/017、Issue #66）。
    // 两者都优雅跳过（skip），不应 fail closed。
    logger.warning(`Skipped: ${e.message}`)
    return 'skip'
  }
  if (e instanceof ExecutionContextError) {
    onFailed(`Failed to build ExecutionContext: ${e.message}`)
  } else if (e instanceof Error) {
    onFailed(`Failed to build ExecutionContext: ${e.message}, backtrace: ${e.stack}`)
  } else {
    onFailed(`Failed to build ExecutionContext: ${e}`)
  }
  return 'fatal'
}
