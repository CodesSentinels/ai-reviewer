/**
 * platform/gitlab-retry.ts — GitLab API 有上限退避重试（GLAPI-025/026/027）
 *
 * - GLAPI-025：429 / 5xx / 网络超时按指数退避重试，次数和单次等待都有上限；
 *   429 带 Retry-After 时优先尊重该值，超过上限则直接放弃而不是长时间空等。
 * - GLAPI-026：401/403 立即失败并带权限诊断，绝不重试（重试只会加剧锁定风险）。
 * - GLAPI-027：回调收到 attempt 序号，写操作可在 attempt > 1 时先按 marker 探测
 *   上一次是否其实已写入成功，避免超时重试产生重复内容。
 *
 * 注意 gitbeaker 自身对 429/502 也有内部重试（最多 10 次），本层是在其之上的
 * 兜底：因此 maxAttempts 保持小值，避免两层重试相乘放大等待时间。
 */

import {getLogger} from './logger'
import type {GitPlatformError} from './git-platform'
import {extractRetryAfterMS, isRetryableErrorKind, normalizeGitLabError} from './gitlab-errors'

export interface GitLabRetryPolicy {
  /** 包含首次调用在内的最大尝试次数 */
  maxAttempts: number
  /** 首次退避基准（ms） */
  baseDelayMS: number
  /** 单次退避上限（ms） */
  maxDelayMS: number
  /** Retry-After 可接受的上限（ms），超过则不再等待直接失败 */
  maxRetryAfterMS: number
  /** 抖动因子生成器，默认 Math.random（测试可注入固定值） */
  random?: () => number
  /** sleep 实现，测试可注入 */
  sleep?: (ms: number) => Promise<void>
}

export const GITLAB_RETRY_DEFAULTS: GitLabRetryPolicy = {
  maxAttempts: 3,
  baseDelayMS: 500,
  maxDelayMS: 5_000,
  maxRetryAfterMS: 30_000
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 进程级策略覆盖。入口可按运行环境收紧/放宽重试预算；
 * 测试用它注入确定性 random 与 no-op sleep，避免真实等待。
 */
let policyOverrides: Partial<GitLabRetryPolicy> = {}

export function configureGitLabRetry(overrides: Partial<GitLabRetryPolicy>): void {
  policyOverrides = {...policyOverrides, ...overrides}
}

export function resetGitLabRetryPolicy(): void {
  policyOverrides = {}
}

/**
 * 计算第 attempt 次失败后的退避时长（attempt 从 1 开始）。
 *
 * 指数退避 + 全抖动（full jitter）：delay = random() * min(base * 2^(attempt-1), maxDelay)。
 * 全抖动可以避免多个并发请求在同一时刻重试造成二次冲击。
 */
export function computeBackoffMS(
  attempt: number,
  policy: GitLabRetryPolicy = GITLAB_RETRY_DEFAULTS
): number {
  const random = policy.random ?? Math.random
  const exponential = policy.baseDelayMS * 2 ** Math.max(0, attempt - 1)
  const capped = Math.min(exponential, policy.maxDelayMS)
  return Math.round(random() * capped)
}

/**
 * 执行一次 GitLab API 调用，按统一策略归一化错误并做有上限的退避重试。
 *
 * 所有 GitLab adapter 的 API 调用都应经过这里，保证：
 * 重试语义、错误 kind、日志脱敏在整个 adapter 内一致（GLAPI-032）。
 */
export async function withGitLabRetry<T>(
  operation: string,
  fn: (attempt: number) => Promise<T>,
  overrides: Partial<GitLabRetryPolicy> = {}
): Promise<T> {
  const policy: GitLabRetryPolicy = {...GITLAB_RETRY_DEFAULTS, ...policyOverrides, ...overrides}
  const sleep = policy.sleep ?? defaultSleep
  const logger = getLogger()

  let lastError: GitPlatformError | undefined
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    try {
      return await fn(attempt)
    } catch (e) {
      const err = normalizeGitLabError(e, operation)
      lastError = err

      if (!isRetryableErrorKind(err.errorKind)) throw err
      if (attempt >= policy.maxAttempts) break

      const retryAfterMS = extractRetryAfterMS(e)
      if (retryAfterMS != null && retryAfterMS > policy.maxRetryAfterMS) {
        logger.warning(
          `${operation}: rate limited, Retry-After ${retryAfterMS}ms exceeds ` +
            `${policy.maxRetryAfterMS}ms budget — giving up`
        )
        throw err
      }

      const delayMS = retryAfterMS ?? computeBackoffMS(attempt, policy)
      logger.warning(
        `${operation}: ${err.errorKind}${err.statusCode == null ? '' : ` (${err.statusCode})`}, ` +
          `retrying in ${delayMS}ms (attempt ${attempt + 1}/${policy.maxAttempts})`
      )
      await sleep(delayMS)
    }
  }

  // 循环只可能因「重试次数耗尽」退出，此时 lastError 必然存在
  throw lastError ?? normalizeGitLabError(new Error('unknown failure'), operation)
}
