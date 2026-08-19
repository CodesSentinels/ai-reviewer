/**
 * commands/rate-limit.ts - 命令速率限制
 *
 * 进程内令牌桶：同一**限流域**在 WINDOW_MS 内最多 MAX_PER_WINDOW 条命令。
 *
 * ## 限流域为什么不是「actor」（CMD-027）
 *
 * 早先的 key 是裸 actor 名。单平台单仓库时这没问题，双平台之后它会把毫不相干的
 * 场景挤到同一个桶里：同一个人在 GitHub PR 和 GitLab MR 上、在两个不同项目上、
 * 在同一项目的两个 MR 上发命令，会互相消耗配额——先在 A 处发满 10 条，B 处第一
 * 条就被拒。这既不符合直觉，也违反「不跨平台读写状态」的隔离原则（§1）。
 *
 * 所以限流域是 `platform + project + PR/MR + actor` 四元组。
 *
 * ## 接口为什么收结构体而不是字符串（CMD-028）
 *
 * 两个平台共用这一个接口，key 由各自的**规范化事件上下文**生成。收结构体而不是
 * 拼好的字符串，是为了让「漏拼一个维度」变成类型错误而不是运行时才发现的串桶。
 *
 * ## 这个实现保证什么、不保证什么（CMD-029）
 *
 * 它是**保留的进程内 best-effort 防护，当前调用模型下基本不会触发**。桶只活在
 * 单个 Node 进程里，而 GitHub comment 与 GitLab note 是一条事件一个新进程：
 *
 *   ❌ 跨 GitHub Actions run 不生效——每次 run 都是全新进程，桶是空的
 *   ❌ 跨 GitLab pipeline 同理，即便 resource_group 让它们串行执行
 *   ❌ 同一条评论的重复投递也轮不到它——dispatcher 里幂等检查排在限流之前，
 *      重复投递在那一步就返回了；不同投递又通常各在各的进程里
 *
 * 所以既不能说它「限制用户连续评论」，也不能说它「负责处理重复投递/webhook
 * 抖动」——后者是 event/note marker 幂等检查的职责（CMD-030），而且因为幂等在前，
 * 重复投递连配额都不消耗。持续性的滥用防护依赖平台自身的 abuse detection。
 *
 * 那它还留着做什么：一旦调用模型变化（单进程内处理多条命令、批量回放、未来的
 * 常驻进程），这层就立刻有意义了；而现在它的代价只是一个 Map。
 *
 * 本轮范围内不引入 Redis、数据库或任何持久化限流服务（CMD-032），桶就是一个
 * 进程内 Map，随进程退出消失。
 */
import type {Platform} from '../platform/execution-context'

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

/** 限流域：四个维度任一不同即互不影响 */
export interface RateLimitScope {
  platform: Platform
  /** 项目路径，如 `octo/demo` 或 `group/subgroup/demo` */
  projectPath: string
  /** PR number / MR iid */
  changeRequestId: number
  /** 发出命令的人 */
  actor: string
}

/**
 * 组装桶 key。
 *
 * 各段单独 encodeURIComponent 再用 `:` 连接：分隔符不会被段内容伪造出来，
 * 否则一个叫 `a:b` 的项目就能和另一个组合撞 key。
 */
export function rateLimitKey(scope: RateLimitScope): string {
  return [scope.platform, scope.projectPath, String(scope.changeRequestId), scope.actor]
    .map(part => encodeURIComponent(part))
    .join(':')
}

export function checkRateLimit(scope: RateLimitScope, now: number = Date.now()): RateLimitResult {
  const key = rateLimitKey(scope)
  let bucket = buckets.get(key)
  if (!bucket) {
    bucket = {timestamps: []}
    buckets.set(key, bucket)
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

/** 仅供测试：当前存在的桶数量，用来断言隔离而不是靠间接现象 */
export function _bucketCount(): number {
  return buckets.size
}

export const _RATE_LIMIT_CONSTANTS = {WINDOW_MS, MAX_PER_WINDOW}
