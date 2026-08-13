/**
 * actions-log.ts — @actions/core 日志出口的脱敏包装（SEC-008）
 *
 * 只把脱敏做在 `GitHubLogger` 里是不够的：仓库里有 17 个文件、上百个调用点
 * 直接 `import {info, warning} from '@actions/core'`，完全绕过 Logger 抽象。
 * 其中风险最高的是 `bot.ts` —— 它会打印 `${e}, backtrace: ${e.stack}`，
 * OpenAI SDK 的错误对象里可能带着请求头和请求体。
 *
 * 全量迁移到 `getLogger()` 是 ARCH-018 的收尾工作，涉及面大；在那之前，
 * 本模块提供**同签名**的替代品：调用方只需把 import 源从 `@actions/core`
 * 换成 `./actions-log`，行为不变，但所有输出先过 `redactForLog()`。
 *
 * `arch-guard.test.ts` 会守住这条边界：除本文件和 `platform/github-logger.ts`
 * 外，任何文件都不得再从 `@actions/core` 导入日志函数。
 */

import * as core from '@actions/core'
import {redactForLog} from './redact'

export function info(message: string): void {
  core.info(redactForLog(message))
}

export function warning(message: string | Error): void {
  core.warning(redactForLog(message))
}

export function error(message: string | Error): void {
  core.error(redactForLog(message))
}

export function debug(message: string): void {
  core.debug(redactForLog(message))
}

/**
 * setFailed 同时写日志并把 job 标记为失败——失败路径恰恰最可能带上
 * 异常详情，因此同样必须脱敏。
 */
export function setFailed(message: string | Error): void {
  core.setFailed(redactForLog(message))
}
