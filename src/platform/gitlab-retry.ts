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
 * 兜底：因此 maxAttempts 保持小值（4），避免两层重试相乘放大等待时间。
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
  /** 超时后探测写入是否落库的最长等待（ms），默认 GITLAB_TIMEOUT_PROBE_DEFAULTS.windowMS */
  timeoutProbeWindowMS?: number
  /** 超时后探测写入的间隔（ms） */
  timeoutProbeIntervalMS?: number
  /** 整个进程里所有超时探测累计最多等待的时间（ms），用完后不再等待、直接重发 */
  timeoutProbeBudgetMS?: number
}

/**
 * 写操作超时后「等一等再重发」的默认参数。
 *
 * 客户端超时不等于服务端没写：GitLab 响应变慢时，第一次请求在超时之后仍会落库，实测
 * 在客户端放弃约 100 秒之后才出现（ai-reviewer-test#4）。重试前只探测一次，什么都看不到就
 * 重发，结果两个请求都落库，MR 里出现两条一模一样的评论。超时之后先多探测几次，确认
 * 真的没落库再重发。
 */
export const GITLAB_TIMEOUT_PROBE_DEFAULTS = {
  windowMS: 180_000,
  intervalMS: 15_000,
  budgetMS: 300_000
} as const

export const GITLAB_RETRY_DEFAULTS: GitLabRetryPolicy = {
  maxAttempts: 4,
  baseDelayMS: 1_000,
  maxDelayMS: 8_000,
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
  probeBudgetUsedMS = 0
}

/** 进程内已经花在超时探测上的等待时间；GitLab 持续变慢时用它封顶，避免整轮审查被拖死 */
let probeBudgetUsedMS = 0

/**
 * 计算第 attempt 次失败后的退避时长（attempt 从 1 开始）。
 *
 * 指数退避 + 半抖动（equal jitter）：delay = capped/2 + random() * capped/2，
 * 其中 capped = min(base * 2^(attempt-1), maxDelay)。
 * 抖动用来避免多个并发请求在同一时刻重试造成二次冲击；保留一半作为下限，
 * 是因为全抖动（random() * capped）可能抽到接近 0 的值，第一次重试几乎不等待，
 * 对超时、限流这类需要时间恢复的故障等于没有退避（实测批量文件审查时多个文件
 * 在几百毫秒内连续重试仍然超时，最终被判为失败）。
 */
export function computeBackoffMS(
  attempt: number,
  policy: GitLabRetryPolicy = GITLAB_RETRY_DEFAULTS
): number {
  const random = policy.random ?? Math.random
  const exponential = policy.baseDelayMS * 2 ** Math.max(0, attempt - 1)
  const capped = Math.min(exponential, policy.maxDelayMS)
  return Math.round(capped / 2 + (random() * capped) / 2)
}

/**
 * 执行一次 GitLab API 调用，按统一策略归一化错误并做有上限的退避重试。
 *
 * 所有 GitLab adapter 的 API 调用都应经过这里，保证：
 * 重试语义、错误 kind、日志脱敏在整个 adapter 内一致（GLAPI-032）。
 */
export async function withGitLabRetry<T>(
  operation: string,
  fn: (attempt: number, lastError?: GitPlatformError) => Promise<T>,
  overrides: Partial<GitLabRetryPolicy> = {}
): Promise<T> {
  const policy: GitLabRetryPolicy = {...GITLAB_RETRY_DEFAULTS, ...policyOverrides, ...overrides}
  const sleep = policy.sleep ?? defaultSleep
  const logger = getLogger()

  let lastError: GitPlatformError | undefined
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    try {
      return await fn(attempt, lastError)
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

/**
 * 写操作重试前的「是否已落库」探测。
 *
 * - 先探测一次；命中就返回，调用方不要重发；
 * - 上一次失败是超时（请求可能仍在服务端处理中）时，继续按间隔探测，直到命中或超过窗口，
 *   窗口内一直没命中才返回未命中，调用方再重发；
 * - 其他错误（5xx、限流等，请求明确没被处理）只探测一次，不额外等待；
 * - 所有探测累计的等待有进程级预算，用完后退化成只探测一次，避免 GitLab 持续变慢时拖垮整轮审查。
 *
 * @param probe 查询是否已落库，返回查询结果（异常原样抛出，由 withGitLabRetry 当作本次尝试的失败）
 * @param found 判断查询结果是否表示已落库
 */
export async function probeAfterTimeout<T>(
  operation: string,
  probe: () => Promise<T>,
  found: (result: T) => boolean,
  lastError: GitPlatformError | undefined,
  overrides: Partial<GitLabRetryPolicy> = {}
): Promise<T> {
  let result = await probe()
  if (found(result) || lastError?.errorKind !== 'timeout') return result

  const policy: GitLabRetryPolicy = {...GITLAB_RETRY_DEFAULTS, ...policyOverrides, ...overrides}
  const sleep = policy.sleep ?? defaultSleep
  const windowMS = policy.timeoutProbeWindowMS ?? GITLAB_TIMEOUT_PROBE_DEFAULTS.windowMS
  const intervalMS = policy.timeoutProbeIntervalMS ?? GITLAB_TIMEOUT_PROBE_DEFAULTS.intervalMS
  const budgetMS = policy.timeoutProbeBudgetMS ?? GITLAB_TIMEOUT_PROBE_DEFAULTS.budgetMS
  const logger = getLogger()

  let waited = 0
  while (waited < windowMS) {
    if (probeBudgetUsedMS + intervalMS > budgetMS) {
      logger.warning(
        `${operation}: timeout-probe budget (${budgetMS}ms) exhausted — resending without further waiting`
      )
      return result
    }
    await sleep(intervalMS)
    waited += intervalMS
    probeBudgetUsedMS += intervalMS
    result = await probe()
    if (found(result)) {
      logger.info(
        `${operation}: the timed-out request landed after ${waited}ms — not resending (avoids a duplicate)`
      )
      return result
    }
  }
  logger.warning(
    `${operation}: previous request timed out and nothing landed within ${waited}ms — resending`
  )
  return result
}
