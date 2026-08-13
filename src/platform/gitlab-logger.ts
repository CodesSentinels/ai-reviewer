/**
 * platform/gitlab-logger.ts - GitLab CI Logger（ARCH-014）
 *
 * 输出到 stdout/stderr，不 import @actions/core（ARCH-015）。
 * GitLab CI job log 天然支持 ANSI 颜色，但 MVP 阶段只输出纯文本。
 */

import type {Logger} from './logger'

export class GitLabLogger implements Logger {
  info(msg: string): void {
    // eslint-disable-next-line no-console
    console.log(msg)
  }

  warning(msg: string): void {
    // eslint-disable-next-line no-console
    console.warn(`[WARNING] ${msg}`)
  }

  error(msg: string): void {
    // eslint-disable-next-line no-console
    console.error(`[ERROR] ${msg}`)
  }

  debug(msg: string): void {
    if (process.env.AI_REVIEWER_DEBUG === 'true') {
      // eslint-disable-next-line no-console
      console.log(`[DEBUG] ${msg}`)
    }
  }
}
