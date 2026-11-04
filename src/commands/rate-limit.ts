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
 *
 * ## 更新（回归测试 FT-128）
 *
 * 上面说的「基本不会触发」在实测里变成了事实问题：用户 35 秒内连发 12 条命令，12 条
 * 全部被执行。所以另加了一层 `checkBurstFromComments`：不引入任何外部存储，而是用平台
 * 自己保存的评论记录做计数（该用户 60 秒内、不晚于当前这条的、@ 了 bot 的评论条数）。
 * 进程内令牌桶保留不动，两层都通过才放行。
 */
import type {Platform} from '../platform/execution-context'
import type {PlatformComment, ReviewComment} from '../platform/git-platform'

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

// ─── 跨进程限流：以平台上的评论记录为准 ───────────────────────────────────
//
// 上面的进程内令牌桶在 GitHub / GitLab 上形同虚设（一条事件一个进程，桶永远是空的）。
// 用户连发 12 条命令，12 条全部被执行（回归测试 FT-128）。
//
// 这里改用**平台自己保存的评论**当计数器，不引入任何外部存储：
//   处理第 N 条命令时，数一数该用户在 WINDOW_MS 内、**不晚于这条命令**的、@ 了 bot 的
//   评论有几条（含这条）。超过 MAX_PER_WINDOW 就拒绝。
//
// 只数「不晚于这条」的评论是关键：各条命令在各自的进程里并发处理，每个进程看到的评论
// 列表可能多也可能少，但第 11、12 条命令总能看到前面至少 10 条，所以结果是确定的——
// 前 10 条放行，后面的被拒，而不依赖谁先抢到什么。

/** 正文里是否 @ 了 bot（两侧要有边界，避开 `foo@ai-reviewer.example` 这类邮箱） */
export function mentionsBot(body: string, botMentions: string[]): boolean {
  const text = body ?? ''
  return botMentions.some(m => {
    const esc = m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(^|[\\s,.;:，。；：])${esc}(?![A-Za-z0-9_-])`, 'i').test(text)
  })
}

type TimedComment = Pick<PlatformComment | ReviewComment, 'id' | 'body' | 'author' | 'createdAt'>

export interface PlatformBurstInput {
  /** 顶层评论 + 行级评论（调用方按事件类型决定要不要带上行级评论） */
  comments: TimedComment[]
  actor: string
  /** 当前正在处理的这条命令评论的 id */
  commentId: number
  botMentions: string[]
  now?: number
}

/**
 * 以平台评论为准判断这条命令是否超出限流。
 *
 * @returns allowed=false 时 retryAfterMs 为窗口内最早一条滑出窗口还需要的时间
 */
export function checkBurstFromComments(input: PlatformBurstInput): RateLimitResult {
  const {comments, actor, commentId, botMentions} = input
  const now = input.now ?? Date.now()
  const self = comments.find(c => c.id === commentId)
  const ref = self?.createdAt != null ? Date.parse(self.createdAt) : now
  if (Number.isNaN(ref)) return {allowed: true}

  const mine = comments.filter(
    c =>
      (c.author ?? '').toLowerCase() === actor.toLowerCase() &&
      c.createdAt != null &&
      mentionsBot(c.body, botMentions)
  )
  const inWindow = mine
    .map(c => ({id: c.id, t: Date.parse(c.createdAt as string)}))
    .filter(c => !Number.isNaN(c.t))
    // 不晚于当前这条：时间更早，或同一秒内 id 不更大
    .filter(c => c.t < ref || (c.t === ref && c.id <= commentId))
    .filter(c => c.t > ref - WINDOW_MS)
    .sort((a, b) => a.t - b.t || a.id - b.id)

  // 当前这条评论如果没出现在列表里（读写延迟），补上它自己
  const rank = inWindow.some(c => c.id === commentId) ? inWindow.length : inWindow.length + 1
  if (rank <= MAX_PER_WINDOW) return {allowed: true}

  const earliest = inWindow.length > 0 ? inWindow[0].t : ref
  return {allowed: false, retryAfterMs: Math.max(0, earliest + WINDOW_MS - ref)}
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
