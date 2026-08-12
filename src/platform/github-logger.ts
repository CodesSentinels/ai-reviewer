/**
 * platform/github-logger.ts - GitHub Actions Logger（ARCH-013）
 *
 * 委托 @actions/core 的 info/warning/error/debug，
 * 保留 Actions annotation 能力（warning/error 会在 PR check 页面显示注解）。
 *
 * SEC-008：所有输出经 redactForLog() 脱敏。放在 Logger 这一层而不是各调用点，
 * 是因为调用点有几百处，漏一处就等于没做——debug 输出尤其容易被忽略。
 */

import {debug, error, info, warning} from '@actions/core'
import type {Logger} from './logger'
import {redactForLog} from '../redact'

export class GitHubLogger implements Logger {
  info(msg: string): void {
    info(redactForLog(msg))
  }

  warning(msg: string): void {
    warning(redactForLog(msg))
  }

  error(msg: string): void {
    error(redactForLog(msg))
  }

  debug(msg: string): void {
    debug(redactForLog(msg))
  }
}
