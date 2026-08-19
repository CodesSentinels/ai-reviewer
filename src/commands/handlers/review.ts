/**
 * commands/handlers/review.ts — 审查触发类命令（CMD-017/018/019）
 *
 * `review`（增量）/ `full review`（全量）/ `summary`（只重建摘要）三条命令共用
 * 同一条链路：`ctx.triggerReview(mode)` → `codeReview()`。平台差异全部止于
 * adapter，本文件不区分 GitHub / GitLab。
 *
 * 从 stubs.ts 转正。原实现的逻辑基本保留，补上两处它没管的边界：
 *
 *   1. `ctx.headSha` 拿不到时（dispatcher 查 change request 失败会留空串）
 *      不能继续——`full review` 会拿空串去问「这个 HEAD 审过没有」，得到
 *      「没审过」于是重跑一遍全量；`review` 更糟，直接对着未知 HEAD 跑。
 *   2. `triggerReview` 抛错时要给出可读反馈，而不是让 dispatcher 兜成 INTERNAL。
 */
import type {CommandHandler, CommandContext, CommandResult} from '../types'
import {getReviewState} from '../../review-state'
import {isHeadAlreadyReviewed} from '../../review-commit-ids'
import {PRIMARY_BOT_MENTION} from '../../constants'
import {getLogger} from '../../platform/logger'

/**
 * 审查命令必须知道当前 HEAD 才能做正确的事。
 *
 * dispatcher 会在事件处理开头统一查一次 change request 补齐 head/base SHA
 * （CMD-017 要求「针对最新 HEAD」，所以取的是现查值而不是 payload 里可能过期的
 * 那个）。那次查询失败时 headSha 是空串——此时**不能**继续：
 *
 *   - `full review`：`isHeadAlreadyReviewed(pr, '')` 必然返回 false，于是明明
 *     刚审过也会再跑一次全量，白烧一轮模型调用
 *   - `review`：对着未知 HEAD 跑增量，结果写到哪个 SHA 上都说不清
 *
 * 宁可让用户重发一次命令。
 */
function requireHeadSha(ctx: CommandContext, command: string): CommandResult | null {
  if (ctx.headSha !== '') return null
  getLogger().warning(`${command}: aborted — current HEAD is unknown (change request query failed)`)
  return {
    message:
      '⚠️ 无法获取当前 HEAD，已中止。这通常是平台 API 暂时不可用，请稍后重试；' +
      '若持续出现请检查 token 权限。'
  }
}

/** triggerReview 未接线时（单测直接构造 ctx）走统一的 NOT_IMPLEMENTED */
function notWired(name: string): never {
  const e = new Error(`Command not implemented: ${name}`)
  ;(e as Error & {code?: string}).code = 'NOT_IMPLEMENTED'
  throw e
}

export const reviewHandler: CommandHandler = {
  name: 'review',
  description: '触发增量审查（仅审查自上次审查以来的新增变更）',
  usage: `${PRIMARY_BOT_MENTION} review`,
  needsAck: true,
  minPermission: 'write',
  async execute(ctx: CommandContext): Promise<CommandResult> {
    if (ctx.triggerReview == null) notWired('review')

    const aborted = requireHeadSha(ctx, 'review')
    if (aborted != null) return aborted

    // 自动审查处于活跃状态时，增量审查本来就会随 push 事件发生，手动再触发一次
    // 只会重复审已审过的 commit。这里直接说明，而不是空跑一轮。
    const state = await getReviewState(ctx.owner, ctx.repo, ctx.prNumber)
    if (state !== 'paused') {
      return {
        message: `<details>
✅ Review finished.

> **Note:** CodeSentinel is an incremental review system and does not re-review already reviewed commits. This command is applicable only when automatic reviews are paused.

</details>`
      }
    }

    await ctx.triggerReview('incremental')
    return {message: '增量审查已完成'}
  }
}

export const fullReviewHandler: CommandHandler = {
  name: 'full review',
  description: '触发全量审查（从 base 到 HEAD 的完整 diff）',
  usage: `${PRIMARY_BOT_MENTION} full review`,
  needsAck: true,
  minPermission: 'write',
  async execute(ctx: CommandContext): Promise<CommandResult> {
    if (ctx.triggerReview == null) notWired('full review')

    const aborted = requireHeadSha(ctx, 'full review')
    if (aborted != null) return aborted

    if (await isHeadAlreadyReviewed(ctx.prNumber, ctx.headSha)) {
      return {
        message:
          `✅ Full review finished.\n\n> **Note:** The current HEAD ` +
          `(\`${ctx.headSha.slice(0, 7)}\`) has already been reviewed. ` +
          `No new changes detected since the last review.`
      }
    }

    await ctx.triggerReview('full')
    return {message: '✅ Full review finished.'}
  }
}

export const summaryHandler: CommandHandler = {
  name: 'summary',
  description: '基于当前最新代码重新生成 PR 摘要',
  usage: `${PRIMARY_BOT_MENTION} summary`,
  needsAck: true,
  minPermission: 'write',
  async execute(ctx: CommandContext): Promise<CommandResult> {
    if (ctx.triggerReview == null) notWired('summary')

    // summary 同样要基于最新 HEAD 重建，HEAD 未知时重建出来的摘要会指向错误的
    // commit 范围（CMD-019）。
    const aborted = requireHeadSha(ctx, 'summary')
    if (aborted != null) return aborted

    await ctx.triggerReview('summary')
    return {message: 'PR 摘要已重新生成'}
  }
}
