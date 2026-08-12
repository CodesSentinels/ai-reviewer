/**
 * commands/early-reaction.ts - 评论事件的提前 ACK 表情
 *
 * 在 main.ts 中、Bot 初始化之前调用。目的是在 Actions 冷启动后尽快
 * 给用户评论打一个表情反应（默认 👀），让用户知道"已收到"。
 *
 * 只做三件事：
 *   1. 校验评论正文存在 + 发起人不是 bot
 *   2. 解析评论是否 @bot（命令或对话式追问皆可）
 *   3. 是 → 打表情；不是 → 跳过
 *
 * 不做 Bot 初始化、权限查询、幂等检查等重操作。
 *
 * ARCH-005：不直接 import `@actions/github`，也不读取 `execCtx.raw`——
 * 事件坐标全部来自调用方传入的 ExecutionContext 归一化字段。"action != created"
 * 和"issue_comment 是否挂在 PR 上"这两条判断已经上移到 `createGitHubExecutionContext()`
 * 构造阶段（见该文件），构造失败会走 `ignorable_event` 优雅跳过，本函数根本不会被
 * 调用，因此不需要在这里重复判断（GitHub Issue #88 P2 复核）。
 */
import {info} from '../actions-log'
import {bootstrapCommands} from './bootstrap'
import {getRegistry} from './registry'
import {parse, DEFAULT_BOT_MENTIONS} from './parser'
import {addAckReaction} from './reaction'
import type {CommandEventName} from './types'
import type {ExecutionContext} from '../platform/execution-context'

/**
 * 尝试在 Bot 初始化前尽快给用户评论打 ACK 表情。
 * 失败或非命令场景下静默返回，不影响后续流程。
 */
export async function tryEarlyReaction(
  execCtx: ExecutionContext,
  rawReaction: string | undefined
): Promise<void> {
  try {
    if (execCtx.eventKind !== 'comment_created' && execCtx.eventKind !== 'review_comment_created') {
      return
    }
    const eventName: CommandEventName =
      execCtx.eventKind === 'review_comment_created'
        ? 'pull_request_review_comment'
        : 'issue_comment'

    const comment = execCtx.comment
    if (comment == null || typeof comment.body !== 'string') return

    if (execCtx.actor.isBot) return

    bootstrapCommands()

    const registry = getRegistry()
    const outcome = parse(comment.body, {
      registeredCommands: registry.getRegisteredNames(),
      botMentions: DEFAULT_BOT_MENTIONS
    })

    // 命令（@bot <cmd>）与对话式追问（@bot <自然语言>）都先打 ACK 表情：
    // 二者都会触发后续 bot 回帖，提前给用户一个"已收到"的可见信号。
    // 'none' 分支（未 @bot / 非触发）不打表情，避免打扰真人之间的普通讨论。
    if (outcome.kind !== 'command' && outcome.kind !== 'conversation') return

    // GitLab subgroup 项目路径可能含多级 namespace（如 group/subgroup/repo），
    // 用 lastIndexOf 确保 owner 保留完整 namespace
    const lastSlash = execCtx.projectPath.lastIndexOf('/')
    const owner = execCtx.projectPath.substring(0, lastSlash)
    const repo = execCtx.projectPath.substring(lastSlash + 1)

    await addAckReaction({
      owner,
      repo,
      changeRequestId: execCtx.changeRequestId,
      commentId: comment.id,
      eventName,
      rawReaction
    })

    info(`early ack reaction sent for commentId=${comment.id}`)
  } catch (e) {
    info(`early ack reaction skipped: ${String(e)}`)
  }
}
