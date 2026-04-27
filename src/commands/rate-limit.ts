/**
 * commands/rate-limit.ts - 命令速率限制
 *
 * 简单的进程内令牌桶: 同一 actor 在 WINDOW_MS 内最多 MAX_PER_WINDOW 条命令。
 *
 * 注意: Actions 是无状态环境，跨 run 无法限流；本实现仅在单次 run 内有效。
 * 这足以防止同一次 webhook 抖动下的重复处理，但不防"攻击者分多次提交评论"。
 * 后者需要在更上层做（例如 GitHub 自身的 abuse detection）。
 */

const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 10

interface Bucket {
  /** 窗口内的请求时间戳（升序） */
  timestamps: number[]
}

const buckets = new Map<string, Bucket>()

export interface RateLimitResult {
  allowed: boolean
  retryAfterMs?: number
}

export function checkRateLimit(
  actor: string,
  now: number = Date.now()
): RateLimitResult {
  let bucket = buckets.get(actor)
  if (!bucket) {
    bucket = {timestamps: []}
    buckets.set(actor, bucket)
  }
  // 清理窗口外的记录
  const cutoff = now - WINDOW_MS
  while (bucket.timestamps.length && bucket.timestamps[0] < cutoff) {
    bucket.timestamps.shift()
  }
  if (bucket.timestamps.length >= MAX_PER_WINDOW) {
    const earliest = bucket.timestamps[0]
    return {
      allowed: false,
      retryAfterMs: Math.max(0, earliest + WINDOW_MS - now)
    }
  }
  bucket.timestamps.push(now)
  return {allowed: true}
}

/** 仅供测试 */
export function _resetRateLimit(): void {
  buckets.clear()
}

export const _RATE_LIMIT_CONSTANTS = {WINDOW_MS, MAX_PER_WINDOW}
