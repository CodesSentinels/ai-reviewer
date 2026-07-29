/**
 * commands/handlers/stubs.ts - B/C/D 命令的占位实现
 *
 * 成员 A 负责在命令框架中登记这些命令名，确保:
 *   1. 白名单完整，parser 能正确识别
 *   2. help 命令能展示
 *   3. 未实现时反馈统一的 NOT_IMPLEMENTED 错误
 *
 * 随着 B/C/D 接入，应**逐个替换**本文件中的 stub 为真实 handler。
 */
import type {CommandHandler, CommandContext, CommandResult} from '../types'
import {getReviewState, setReviewState} from '../../review-state'
import {clearReviewedCommitIds, isHeadAlreadyReviewed} from '../../review-commit-ids'
import {PRIMARY_BOT_MENTION} from '../../constants'

function notImplemented(name: string): CommandHandler['execute'] {
  return async (_ctx: CommandContext): Promise<CommandResult> => {
    // 调度器会把抛出的标记型错误转成 NOT_IMPLEMENTED 反馈
    const e = new Error(`Command not implemented: ${name}`)
    ;(e as Error & {code?: string}).code = 'NOT_IMPLEMENTED'
    throw e
  }
}

/** 成员 C */
export const reviewStub: CommandHandler = {
  name: 'review',
  description: '触发增量审查（仅审查自上次审查以来的新增变更）',
  usage: `${PRIMARY_BOT_MENTION} review`,
  needsAck: true,
  minPermission: 'write',
  async execute(ctx: CommandContext): Promise<CommandResult> {
    if (ctx.triggerReview == null) return await notImplemented('review')(ctx)
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

export const fullReviewStub: CommandHandler = {
  name: 'full review',
  description: '触发全量审查（从 base 到 HEAD 的完整 diff）',
  usage: `${PRIMARY_BOT_MENTION} full review`,
  needsAck: true,
  minPermission: 'write',
  async execute(ctx: CommandContext): Promise<CommandResult> {
    if (ctx.triggerReview == null)
      return await notImplemented('full review')(ctx)
    const alreadyReviewed = await isHeadAlreadyReviewed(
      ctx.prNumber,
      ctx.headSha
    )
    if (alreadyReviewed) {
      return {
        message: `✅ Full review finished.\n\n> **Note:** The current HEAD (\`${ctx.headSha.slice(0, 7)}\`) has already been reviewed. No new changes detected since the last review.`
      }
    }
    await ctx.triggerReview('full')
    return {message: '✅ Full review finished.'}
  }
}

export const summaryStub: CommandHandler = {
  name: 'summary',
  description: '基于当前最新代码重新生成 PR 摘要',
  usage: `${PRIMARY_BOT_MENTION} summary`,
  needsAck: true,
  minPermission: 'write',
  async execute(ctx: CommandContext): Promise<CommandResult> {
    if (ctx.triggerReview == null) return await notImplemented('summary')(ctx)
    await ctx.triggerReview('summary')
    return {message: 'PR 摘要已重新生成'}
  }
}

export const pauseStub: CommandHandler = {
  name: 'pause',
  description: '暂停对当前 PR 的自动审查',
  usage: `${PRIMARY_BOT_MENTION} pause`,
  needsAck: false,
  minPermission: 'write',
  async execute(ctx: CommandContext): Promise<CommandResult> {
    await setReviewState(ctx.owner, ctx.repo, ctx.prNumber, 'paused')
    await clearReviewedCommitIds(ctx.prNumber)
    return {
      message: `已暂停当前 PR 的自动审查。使用 \`${PRIMARY_BOT_MENTION} resume\` 恢复。`
    }
  }
}

export const resumeStub: CommandHandler = {
  name: 'resume',
  description: '恢复对当前 PR 的自动审查',
  usage: `${PRIMARY_BOT_MENTION} resume`,
  needsAck: false,
  minPermission: 'write',
  async execute(ctx: CommandContext): Promise<CommandResult> {
    await setReviewState(ctx.owner, ctx.repo, ctx.prNumber, 'active')
    return {message: '已恢复当前 PR 的自动审查。'}
  }
}

export const configurationStub: CommandHandler = {
  name: 'configuration',
  description: '显示当前仓库的审查配置',
  usage: `${PRIMARY_BOT_MENTION} configuration`,
  needsAck: false,
  minPermission: 'read',
  async execute(ctx: CommandContext): Promise<CommandResult> {
    const state = await getReviewState(ctx.owner, ctx.repo, ctx.prNumber)
    const o = ctx.options
    const message = `## 当前审查配置

| 配置 | 值 |
| :--- | :--- |
| 自动审查状态 | \`${state}\` |
| disable_review | \`${o.disableReview}\` |
| disable_release_notes | \`${o.disableReleaseNotes}\` |
| max_files | \`${o.maxFiles}\` |
| review_simple_changes | \`${o.reviewSimpleChanges}\` |
| review_comment_lgtm | \`${o.reviewCommentLGTM}\` |
| openai_light_model | \`${o.openaiLightModel}\` |
| openai_heavy_model | \`${o.openaiHeavyModel}\` |
| openai_concurrency_limit | \`${o.openaiConcurrencyLimit}\` |
| github_concurrency_limit | \`${o.githubConcurrencyLimit}\` |
| enable_dependency_analysis | \`${o.enableDependencyAnalysis}\` |
| max_dependency_files | \`${o.maxDependencyFiles}\` |
| enable_web_search | \`${o.enableWebSearch}\` |
| enable_shell | \`${o.enableShell}\` |
| language | \`${o.language}\` |`
    return {message}
  }
}

export const ALL_STUBS: CommandHandler[] = [
  reviewStub,
  fullReviewStub,
  summaryStub,
  pauseStub,
  resumeStub,
  configurationStub
]
