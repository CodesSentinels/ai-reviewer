/**
 * commands/early-reaction.ts - 评论事件的提前 ACK 表情
 *
 * 在 main.ts 中、Bot 初始化之前调用。目的是在 Actions 冷启动后尽快
 * 给用户评论打一个表情反应（默认 👀），让用户知道"已收到"。
 *
 * 只做三件事：
 *   1. 校验事件 + payload
 *   2. 解析评论是否 @bot（命令或对话式追问皆可）
 *   3. 是 → 打表情；不是 → 跳过
 *
 * 不做 Bot 初始化、权限查询、幂等检查等重操作。
 */
import {info} from '@actions/core'
// eslint-disable-next-line camelcase
import {context as github_context} from '@actions/github'
import {bootstrapCommands} from './bootstrap'
import {getRegistry} from './registry'
import {parse, DEFAULT_BOT_MENTIONS} from './parser'
import {addAckReaction} from './reaction'
import type {CommandEventName} from './types'

// eslint-disable-next-line camelcase
const context = github_context

/**
 * 尝试在 Bot 初始化前尽快给用户评论打 ACK 表情。
 * 失败或非命令场景下静默返回，不影响后续流程。
 */
export async function tryEarlyReaction(
  rawReaction: string | undefined
): Promise<void> {
  try {
    const eventName = context.eventName as CommandEventName
    if (
      eventName !== 'issue_comment' &&
      eventName !== 'pull_request_review_comment'
    ) {
      return
    }

    const payload = context.payload
    if (!payload || payload.action !== 'created') return

    let comment: any
    if (eventName === 'issue_comment') {
      if (!payload.issue?.pull_request) return
      comment = payload.comment
    } else {
      if (!payload.pull_request) return
      comment = payload.comment
    }

    if (!comment || typeof comment.body !== 'string') return

    const actorIsBot =
      comment.user?.type === 'Bot' || /\[bot\]$/i.test(comment.user?.login ?? '')
    if (actorIsBot) return

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

    const owner = context.repo.owner
    const repo = context.repo.repo

    await addAckReaction({
      owner,
      repo,
      commentId: comment.id,
      eventName,
      rawReaction
    })

    info(`early ack reaction sent for commentId=${comment.id}`)
  } catch (e) {
    info(`early ack reaction skipped: ${String(e)}`)
  }
}
