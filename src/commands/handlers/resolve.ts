import type {CommandHandler, CommandContext, CommandResult} from '../types'
import type {Options} from '../../options'
import {
  getBotLogin,
  fetchUnresolvedBotThreads,
  batchResolve
} from '../../github/review-thread'

// ─── Handler ──────────────────────────────────────────────────────────────────

export const resolveHandler: CommandHandler = {
  name: 'resolve',
  description: '批量将所有 CodeSentinel 审查意见标记为已解决',
  usage: '@ai-reviewer resolve',
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

  const {ok, failed} = await batchResolve(threads)
  return {message: formatResult(ok, failed, threads.length)}
}

// ─── External API (for member C) ──────────────────────────────────────────────

export async function resolveAllBotComments(params: {
  owner: string
  repo: string
  prNumber: number
  options: Options
}): Promise<{ok: number; failed: number}> {
  const botLogin = await getBotLogin(params.options)
  const threads = await fetchUnresolvedBotThreads(params, botLogin)
  if (threads.length === 0) return {ok: 0, failed: 0}
  return batchResolve(threads)
}

// ─── Formatting ───────────────────────────────────────────────────────────────

function formatResult(ok: number, failed: number, total: number): string {
  if (failed === 0) {
    return `✅ 已解决 **${ok}** 条 CodeSentinel 审查意见`
  }
  if (ok === 0) {
    return `❌ 解决失败，请检查 Bot 权限（\`pull-requests: write\`）`
  }
  return `⚠️ 共 **${total}** 条，成功解决 **${ok}** 条，**${failed}** 条失败（可手动解决）`
}
