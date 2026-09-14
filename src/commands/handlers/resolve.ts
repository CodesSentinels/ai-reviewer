import type {CommandHandler, CommandContext, CommandResult} from '../types'
import type {Options} from '../../options'
import type {FailedThread} from '../../github/review-thread'
import {
  getBotLogin,
  fetchUnresolvedBotThreads,
  batchResolve,
  threadLabel,
  isPermissionError,
  isNetworkError
} from '../../github/review-thread'
import type {Platform} from '../../platform/execution-context'
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

  // 测试用：注入假 thread ID，模拟部分失败场景。
  // 按 notfound → permission → network 轮换，覆盖三类错误。
  // const injectCount = ctx.options.debugResolveInjectFailures
  // if (injectCount > 0) {
  //   const kinds = ['notfound', 'permission', 'network'] as const
  //   for (let i = 0; i < injectCount; i++) {
  //     const kind = kinds[i % kinds.length]
  //     threads.push({
  //       id: `PRRT_debug_inject_${kind}_${i + 1}`,
  //       isResolved: false,
  //       firstCommentAuthorLogin: botLogin,
  //       path: threads[0].path,
  //       line: 9000 + i,
  //       firstCommentBody: `[debug] injected ${kind} failure ${i + 1}`
  //     })
  //   }
  // }

  const {ok, failed, failedItems} = await batchResolve(threads)
  const platform = ctx.execCtx?.platform ?? 'github'
  return {message: formatResult(ok, failed, threads.length, failedItems, platform)}
}

// ─── Formatting ───────────────────────────────────────────────────────────────

// TODO Refer to CodeRabbit for the original implementation of this formatting logic.
/**
 * 权限失败时给出的可操作建议（CMD-024）。
 *
 * 两个平台的失败原因和补救方式完全不同，此前只有 GitHub 那套：
 *
 *   GitHub — resolveReviewThread 是 GraphQL mutation，GITHUB_TOKEN 会被拒为
 *            "Resource not accessible by integration"，需要用户 PAT
 *   GitLab — discussion resolve 走 REST，需要 PAT 至少 Developer(30)，
 *            且 MVP 里 reviewer 用的就是 GITLAB_PAT，没有 resolve_token 这一说
 *
 * 在 GitLab 上告诉用户「去配 resolve_token」是纯误导——那个 input 根本不存在。
 */
function permissionAdvice(platform: Platform): string {
  return platform === 'gitlab'
    ? '请确认 `GITLAB_PAT` 对应的账号在本项目至少具有 Developer(30) 权限，或手动解决。'
    : '请将 `resolve_token` 输入配置为具有 repo 权限的 classic PAT，' +
        '或在 workflow 中授予 `permissions: pull-requests: write`，或手动解决。'
}

function formatResult(
  ok: number,
  failed: number,
  total: number,
  failedItems: FailedThread[],
  platform: Platform
): string {
  if (failed === 0) {
    return `✅ 已解决 **${ok}** 条 CodeSentinel 审查意见`
  }
  const errDetail =
    failedItems.length > 0
      ? `\n\n失败详情：\n${failedItems
          .map(
            ({thread, error}) =>
              `- ${errorTag(error)} \`${threadLabel(thread)}\`：${flattenError(error.message)}`
          )
          .join('\n')}${permissionHint(failedItems, platform)}`
      : ''
  if (ok === 0) {
    // 全部失败时几乎一定是权限问题，给出可操作提示，避免用户只看到一句干巴巴的
    // forbidden。建议按平台分（见 permissionAdvice）。
    const hint = `\n\n💡 这通常是权限不足：${permissionAdvice(platform)}`
    return `❌ 解决失败（共 **${total}** 条）${errDetail}${hint}`
  }
  return `⚠️ 共 **${total}** 条，成功解决 **${ok}** 条，**${failed}** 条失败（可手动解决）${errDetail}`
}

/** 给每条失败打上分类标签，方便用户一眼区分错误类型 */
function errorTag(error: Error): string {
  if (isPermissionError(error)) return '🔒 权限不足'
  if (isNetworkError(error)) return '🌐 网络错误'
  return '⚠️ 其他错误'
}

/** 存在权限错误时，追加可操作提示 */
function permissionHint(failedItems: FailedThread[], platform: Platform): string {
  if (!failedItems.some(({error}) => isPermissionError(error))) return ''
  return `\n\n💡 存在权限不足导致的失败：当前 token 无法解决审查线程，${permissionAdvice(platform)}`
}

/** 将多行错误信息压成单行，避免错误中的 ` - ` 被 Markdown 当作嵌套列表渲染 */
function flattenError(message: string): string {
  return message.replace(/\s+/g, ' ').trim()
}
