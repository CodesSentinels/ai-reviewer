/**
 * platform/gitlab-logger.ts - GitLab CI Logger（ARCH-014）
 *
 * 输出到 stdout/stderr，不 import @actions/core（ARCH-015）。
 * GitLab CI job log 天然支持 ANSI 颜色，但 MVP 阶段只输出纯文本。
 *
 * SEC-008：所有输出经 redactForLog() 脱敏——与 GitHubLogger 同一层设计，
 * 放在 Logger 边界而不是各调用点，避免有人新增日志时忘记脱敏。
 *
 * 这里此前是漏的：GitHubLogger 四个方法全过脱敏，GitLabLogger 一个都没有。
 * 后果在 debug 模式下最明显——sanitize-model-output 会把清理前后的**完整模型
 * 文本**写进 debug 日志，其中可能含搜索结果、源码内容，以及模型回显的 token；
 * 在 GitLab job log 里就是明文（WS-004）。
 */

import type {Logger} from './logger'
import {redactForLog} from '../redact'

export class GitLabLogger implements Logger {
  info(msg: string): void {
    // eslint-disable-next-line no-console
    console.log(redactForLog(msg))
  }

  warning(msg: string): void {
    // eslint-disable-next-line no-console
    console.warn(`[WARNING] ${redactForLog(msg)}`)
  }

  error(msg: string): void {
    // eslint-disable-next-line no-console
    console.error(`[ERROR] ${redactForLog(msg)}`)
  }

  debug(msg: string): void {
    if (process.env.AI_REVIEWER_DEBUG === 'true') {
      // eslint-disable-next-line no-console
      console.log(`[DEBUG] ${redactForLog(msg)}`)
    }
  }

  /**
   * GitLab job log 的可折叠分段：
   * https://docs.gitlab.com/ci/jobs/job_logs/#custom-collapsible-sections
   * section 头会显示该段耗时；默认折叠，展开即可看到段内全部日志。
   */
  startSection(id: string, title: string): void {
    // eslint-disable-next-line no-console
    console.log(
      `\x1b[0Ksection_start:${unixNow()}:${id}[collapsed=true]\r\x1b[0K${redactForLog(title)}`
    )
  }

  endSection(id: string): void {
    // eslint-disable-next-line no-console
    console.log(`\x1b[0Ksection_end:${unixNow()}:${id}\r\x1b[0K`)
  }
}

function unixNow(): number {
  return Math.floor(Date.now() / 1000)
}
