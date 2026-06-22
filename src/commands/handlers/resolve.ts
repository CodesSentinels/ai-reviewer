import type {CommandHandler, CommandContext, CommandResult} from '../types'
import {
  getBotLogin,
  fetchUnresolvedBotThreads,
  batchResolve
} from '../../github/review-thread'
import {PRIMARY_BOT_MENTION} from '../../constants'

// ─── Handler ──────────────────────────────────────────────────────────────────

export const resolveHandler: CommandHandler = {
  name: 'resolve',
  description: '批量将所有 CodeSentinel 审查意见标记为已解决',
  usage: `${PRIMARY_BOT_MENTION} resolve`,
  needsAck: true,
  minPermission: 'write',
  execute
}

async function execute(ctx: CommandContext): Promise<CommandResult> {
  const botLogin = await getBotLogin(ctx.options)
  const threads = await fetchUnresolvedBotThreads(
    {owner: ctx.owner, repo: ctx.repo, prNumber: ctx.prNumber},
    botLogin
  )

  if (threads.length === 0) {
    return {message: 'ℹ️ 没有找到待解决的 CodeSentinel 审查意见'}
  }

  const {ok, failed, errors} = await batchResolve(threads)
  return {message: formatResult(ok, failed, threads.length, errors)}
}

// ─── Formatting ───────────────────────────────────────────────────────────────

function formatResult(
  ok: number,
  failed: number,
  total: number,
  errors: Error[]
): string {
  if (failed === 0) {
    return `✅ 已解决 **${ok}** 条 CodeSentinel 审查意见`
  }
  const errDetail =
    errors.length > 0 ? `\n\n错误详情：\`${errors[0].message}\`` : ''
  if (ok === 0) {
    return `❌ 解决失败（共 **${total}** 条）${errDetail}`
  }
  return `⚠️ 共 **${total}** 条，成功解决 **${ok}** 条，**${failed}** 条失败（可手动解决）${errDetail}`
}
