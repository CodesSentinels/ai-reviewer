/**
 * commands/handlers/pause.ts — 自动审查开关（CMD-020/021）
 *
 * `pause` / `resume` 把状态写在 PR/MR description 的 reviewer 管理区块里，
 * 两个平台共用 `review-state.ts` → `description-state.ts` 这条链路：读最新值 →
 * 只改指定 marker 区域 → 写前重读 → 写后校验。marker 带平台命名空间，所以
 * GitHub PR 与 GitLab MR 的状态互不可见（STATE-007）。
 *
 * 从 stubs.ts 转正。写入失败无需在这里兜——`setReviewState` 在
 * `updateDescriptionSection` 返回 not ok 时会抛，dispatcher 统一转成 INTERNAL
 * 并把原因带给用户，不存在「说暂停了其实没暂停」。
 *
 * 真正补上的是**幂等**（CMD-021）：状态已经是目标值时不再走一遍读改写。
 * 重复 pause / resume 是常见操作（用户不确定有没有生效就再发一次），每次都
 * 读改写 description 等于白白拉长并发窗口，而 description 正是 release notes、
 * reviewed SHA 共用的那份文本。
 *
 * ## pause 不再清除 reviewed SHA
 *
 * 原实现在暂停时调 `clearReviewedCommitIds()` 抹掉增量基线，这和 CMD-017 直接
 * 冲突：`review` 命令只在暂停状态下才真正执行，而基线一旦被清空，
 * `review.ts` 会走「首次审查」分支从 base commit 开始——handler 传的是
 * `incremental`，实际跑的是整份 diff，「仅审查自上次审查以来的新增变更」形同虚设。
 *
 * 保留基线也不会漏审：暂停期间的 commit 都还在基线之后，resume 后的第一次
 * 增量审查照样覆盖得到。确实想重审全部时有 `full review`。
 */
import type {CommandHandler, CommandContext, CommandResult} from '../types'
import {getReviewState, setReviewState} from '../../review-state'
import {PRIMARY_BOT_MENTION} from '../../constants'

export const pauseHandler: CommandHandler = {
  name: 'pause',
  description: '暂停对当前 PR 的自动审查',
  usage: `${PRIMARY_BOT_MENTION} pause`,
  needsAck: false,
  minPermission: 'write',
  async execute(ctx: CommandContext): Promise<CommandResult> {
    // 重复 pause 是幂等的：状态已是 paused 就不再写 description，避免无谓的
    // 读改写把并发窗口拉长（CMD-021 的幂等要求对 pause 同样成立）。
    const current = await getReviewState(ctx.owner, ctx.repo, ctx.prNumber)
    if (current === 'paused') {
      return {
        message: `ℹ️ 当前 PR 的自动审查已处于暂停状态。使用 \`${PRIMARY_BOT_MENTION} resume\` 恢复。`
      }
    }

    await setReviewState(ctx.owner, ctx.repo, ctx.prNumber, 'paused')

    return {
      message: `已暂停当前 PR 的自动审查。使用 \`${PRIMARY_BOT_MENTION} resume\` 恢复。`
    }
  }
}

export const resumeHandler: CommandHandler = {
  name: 'resume',
  description: '恢复对当前 PR 的自动审查',
  usage: `${PRIMARY_BOT_MENTION} resume`,
  needsAck: false,
  minPermission: 'write',
  async execute(ctx: CommandContext): Promise<CommandResult> {
    const current = await getReviewState(ctx.owner, ctx.repo, ctx.prNumber)
    if (current === 'active') {
      return {message: 'ℹ️ 当前 PR 的自动审查已处于启用状态。'}
    }

    await setReviewState(ctx.owner, ctx.repo, ctx.prNumber, 'active')
    return {message: '已恢复当前 PR 的自动审查。'}
  }
}
