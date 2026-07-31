/**
 * platform/github-logger.ts - GitHub Actions Logger（ARCH-013）
 *
 * 委托 @actions/core 的 info/warning/error/debug，
 * 保留 Actions annotation 能力（warning/error 会在 PR check 页面显示注解）。
 */

import {debug, error, info, warning} from '@actions/core'
import type {Logger} from './logger'

export class GitHubLogger implements Logger {
  info(msg: string): void {
    info(msg)
  }

  warning(msg: string): void {
    warning(msg)
  }

  error(msg: string): void {
    error(msg)
  }

  debug(msg: string): void {
    debug(msg)
  }
}
