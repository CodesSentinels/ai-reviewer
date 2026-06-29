/**
 * conversation.ts - 对话式追问交互（迭代二 · 成员 D · 2.3）
 *
 * 当开发者在 PR 的代码审查评论中回复并 @ 机器人，或在已有的 bot 对话链中继续
 * 追问时，本模块负责：
 *
 *   1. 追问意图识别        —— 区分"追问 Bot"与"普通评论"，避免无关回帖
 *   2. Thread 对话历史收集  —— 拉取完整对话链并格式化
 *   3. 关联代码行/扩展上下文 —— 评论所在 diff hunk + 文件完整 diff
 *   4. 对话 Prompt 组装     —— 历史 + 代码 + diff + PR 摘要
 *   5. LLM 对话推理         —— 复用迭代一的重量模型（Analysis Chain / Web Query）
 *   6. 回复发布到 thread
 *   7. 上下文截断 + 摘要压缩 —— 防止长对话 Token 超限
 *   8. 对话轮次上限控制     —— 防止无限对话消耗资源
 *
 * 设计原则：纯逻辑（意图识别 / 截断 / 轮次统计）抽成可独立单测的函数，
 * I/O 编排集中在 handleConversation 中，复用既有 Commenter / Bot / Prompts。
 */
import {info, warning} from '@actions/core'
// eslint-disable-next-line camelcase
import {context as github_context} from '@actions/github'
import {type Bot} from './bot'
import {
  Commenter,
  COMMENT_REPLY_TAG,
  COMMENT_TAG,
  SUMMARIZE_TAG
} from './commenter'
import {BOT_MENTIONS} from './constants'
import {Inputs} from './inputs'
import {octokit} from './octokit'
import {type Options} from './options'
import {type Prompts} from './prompts'
import {getTokenCount} from './tokenizer'

// eslint-disable-next-line camelcase
const context = github_context

/** 默认的 bot mention 别名（小写匹配，与命令解析器保持一致）。共享自 constants。 */
export {BOT_MENTIONS}

/** 标识 bot 在对话链中出现过的标签（用于轮次统计 / 意图识别） */
export const BOT_COMMENT_TAGS = [COMMENT_TAG, COMMENT_REPLY_TAG]

/** 单个 thread 的对话轮次上限（bot 已回复的次数），超过后停止追问 */
export const MAX_CONVERSATION_TURNS = 10

/** 对话历史进入 Prompt 时的字符上限（粗粒度预算，token 预算另行精确校验） */
export const MAX_CHAIN_CHARS = 12_000

/** 对话历史截断时的分隔符（与 Commenter.composeCommentChain 对齐） */
const CHAIN_SEPARATOR = '\n---\n'

/**
 * 追问意图识别：判断一条评论是否应触发 bot 对话回复。
 *
 * 触发条件：**评论必须显式 @ 了机器人**（首轮与续轮一致），
 * 以避免把 thread 内真人之间的讨论误当成追问。
 *
 * 排除规则（优先级最高）：
 *   - 评论来自 bot 自身（避免自我触发循环）
 *   - 评论正文含 bot 专属标签（视为 bot 文案）
 *
 * @returns true 表示需要 bot 介入回复
 */
export function isFollowUpQuestion(opts: {
  commentBody: string
  authorIsBot: boolean
  mentions?: string[]
  botCommentTags?: string[]
}): boolean {
  const {commentBody, authorIsBot} = opts
  if (authorIsBot) {
    return false
  }
  const body = commentBody ?? ''
  // bot 自动生成的内容带有专属标签，二次保险，避免把 bot 文案当成追问
  const botTags = opts.botCommentTags ?? BOT_COMMENT_TAGS
  if (botTags.some(tag => body.includes(tag))) {
    return false
  }

  const mentions = (opts.mentions ?? BOT_MENTIONS).map(m => m.toLowerCase())
  const lowerBody = body.toLowerCase()
  return mentions.some(m => lowerBody.includes(m))
}

/**
 * 统计对话链中 bot 已回复的轮次。
 * 以 bot 专属标签出现次数为准（每条 bot 评论都会携带一个标签）。
 */
export function countBotTurns(
  commentChain: string,
  botCommentTags: string[] = BOT_COMMENT_TAGS
): number {
  if (!commentChain) {
    return 0
  }
  let count = 0
  for (const tag of botCommentTags) {
    count += occurrences(commentChain, tag)
  }
  return count
}

function occurrences(haystack: string, needle: string): number {
  if (!needle) {
    return 0
  }
  let count = 0
  let idx = haystack.indexOf(needle)
  while (idx !== -1) {
    count++
    idx = haystack.indexOf(needle, idx + needle.length)
  }
  return count
}

/**
 * 对话历史截断 + 摘要压缩。
 *
 * 长对话会撑爆 Token 预算。这里保留**最近**的若干轮对话（信息最相关），
 * 较早的内容压缩为一行提示，避免直接截断造成上下文割裂。
 *
 * @param chain    composeCommentChain 产出的对话链字符串
 * @param maxChars 字符预算上限
 */
export function truncateConversationChain(
  chain: string,
  maxChars: number = MAX_CHAIN_CHARS
): string {
  if (!chain || chain.length <= maxChars) {
    return chain
  }

  const turns = chain.split(CHAIN_SEPARATOR)
  const kept: string[] = []
  let used = 0
  let omitted = 0

  // 从最新的一轮往前累加，直到预算用尽
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i]
    const cost = turn.length + CHAIN_SEPARATOR.length
    if (used + cost <= maxChars || kept.length === 0) {
      kept.unshift(turn)
      used += cost
    } else {
      omitted = i + 1
      break
    }
  }

  if (omitted > 0) {
    kept.unshift(
      `> _（为控制上下文长度，较早的 ${omitted} 条对话已省略，仅保留最近 ${kept.length} 条）_`
    )
  }
  return kept.join(CHAIN_SEPARATOR)
}

/**
 * 对话式追问主入口。
 *
 * 仅处理 pull_request_review_comment 事件（代码行级评论中的追问）。
 * 由 command-handler.ts 在命令解析判定为 "fallback_conversation" 时调用。
 *
 * @param heavyBot - 重量级模型，用于生成高质量回复
 * @param options  - 全局配置
 * @param prompts  - 提示词模板
 */
export const handleConversation = async (
  heavyBot: Bot,
  options: Options,
  prompts: Prompts
): Promise<void> => {
  const commenter: Commenter = new Commenter()
  const inputs: Inputs = new Inputs()
  const repo = context.repo

  // ===== 1. 事件与 payload 校验 =====
  if (context.eventName !== 'pull_request_review_comment') {
    info(`conversation: skip non review_comment event (${context.eventName})`)
    return
  }
  const payload = context.payload
  if (!payload || payload.action !== 'created') {
    info('conversation: skip (missing payload or action != created)')
    return
  }
  const comment = payload.comment
  if (comment == null || typeof comment.body !== 'string') {
    warning('conversation: skip (missing comment body)')
    return
  }
  if (payload.pull_request == null || payload.repository == null) {
    warning('conversation: skip (missing pull_request/repository)')
    return
  }

  // ===== 2. 过滤 bot 自身评论 =====
  const authorIsBot =
    comment.user?.type === 'Bot' ||
    /\[bot\]$/i.test(comment.user?.login ?? '') ||
    comment.body.includes(COMMENT_TAG) ||
    comment.body.includes(COMMENT_REPLY_TAG)
  if (authorIsBot) {
    info('conversation: skip (comment from bot itself)')
    return
  }

  const pullNumber = payload.pull_request.number

  // 填充 PR 基本信息
  inputs.title = payload.pull_request.title
  if (payload.pull_request.body) {
    inputs.description = commenter.getDescription(payload.pull_request.body)
  }
  inputs.comment = `${comment.user.login}: ${comment.body}`
  inputs.diff = comment.diff_hunk ?? ''
  inputs.filename = comment.path ?? ''

  // ===== 3. Thread 对话历史收集 =====
  const {chain: rawChain, topLevelComment} = await commenter.getCommentChain(
    pullNumber,
    comment
  )
  if (!topLevelComment) {
    warning('conversation: cannot locate top-level comment, abort')
    return
  }

  // ===== 4. 追问意图识别（必须 @bot） =====
  if (
    !isFollowUpQuestion({
      commentBody: comment.body,
      authorIsBot: false
    })
  ) {
    info('conversation: not a follow-up question (no @mention), skip')
    return
  }

  // ===== 5. 对话轮次上限控制 =====
  const turns = countBotTurns(rawChain)
  if (turns >= MAX_CONVERSATION_TURNS) {
    info(
      `conversation: turn limit reached (${turns}/${MAX_CONVERSATION_TURNS})`
    )
    await commenter.reviewCommentReply(
      pullNumber,
      topLevelComment,
      `本话题的自动对话轮次已达上限（${MAX_CONVERSATION_TURNS} 轮）。如需继续深入，请新开一条评论或联系人工 reviewer。`
    )
    return
  }

  // ===== 6. 上下文截断 + 摘要压缩 =====
  inputs.commentChain = truncateConversationChain(rawChain)

  // ===== 7. 关联代码行及扩展上下文（文件完整 diff） =====
  let fileDiff = ''
  try {
    const diffAll = await octokit.repos.compareCommits({
      owner: repo.owner,
      repo: repo.repo,
      base: payload.pull_request.base.sha,
      head: payload.pull_request.head.sha
    })
    const file = diffAll.data?.files?.find(f => f.filename === comment.path)
    if (file?.patch) {
      fileDiff = file.patch
    }
  } catch (e) {
    warning(`conversation: failed to get file diff: ${e}, continue without it`)
  }

  // 评论本身没有 diff 片段时，退化为使用完整文件 diff
  if (inputs.diff.length === 0) {
    if (fileDiff.length > 0) {
      inputs.diff = fileDiff
      fileDiff = ''
    } else {
      await commenter.reviewCommentReply(
        pullNumber,
        topLevelComment,
        '无法回复该评论：未能定位关联的代码 diff。'
      )
      return
    }
  }

  // ===== 8. Token 预算内打包上下文 =====
  let tokens = getTokenCount(prompts.renderComment(inputs))

  if (tokens > options.heavyTokenLimits.requestTokens) {
    // 对话链可能仍过长，进一步压缩后重试一次
    inputs.commentChain = truncateConversationChain(
      rawChain,
      Math.floor(MAX_CHAIN_CHARS / 2)
    )
    tokens = getTokenCount(prompts.renderComment(inputs))
  }
  if (tokens > options.heavyTokenLimits.requestTokens) {
    await commenter.reviewCommentReply(
      pullNumber,
      topLevelComment,
      '无法回复该评论：关联的上下文过大，超出了模型的 token 限制。'
    )
    return
  }

  // 预算允许时补充完整文件 diff
  if (fileDiff.length > 0) {
    const fileDiffCount = prompts.comment.split('$file_diff').length - 1
    const fileDiffTokens = getTokenCount(fileDiff)
    if (
      fileDiffCount > 0 &&
      tokens + fileDiffTokens * fileDiffCount <=
        options.heavyTokenLimits.requestTokens
    ) {
      tokens += fileDiffTokens * fileDiffCount
      inputs.fileDiff = fileDiff
    }
  }

  // 预算允许时补充 PR 精简摘要
  const summary = await commenter.findCommentWithTag(SUMMARIZE_TAG, pullNumber)
  if (summary) {
    const shortSummary = commenter.getShortSummary(summary.body)
    const shortSummaryTokens = getTokenCount(shortSummary)
    if (tokens + shortSummaryTokens <= options.heavyTokenLimits.requestTokens) {
      tokens += shortSummaryTokens
      inputs.shortSummary = shortSummary
    }
  }

  // ===== 9. LLM 对话推理 + 发布回复 =====
  const [reply] = await heavyBot.chat(prompts.renderComment(inputs), {})
  if (!reply) {
    warning('conversation: empty reply from model, skip posting')
    return
  }
  // 由我们用真实评论者用户名前缀回复（模型已被要求不要自行 @）。
  // 防御性去掉模型可能仍残留的开头 "@user"（历史 prompt 遗留），避免误链到真实账号 user。
  const cleanedReply = reply.replace(/^\s*@user[，,：:\s]*/i, '').trimStart()
  const authorLogin: string = comment.user?.login ?? ''
  const mention = authorLogin ? `@${authorLogin} ` : ''
  await commenter.reviewCommentReply(
    pullNumber,
    topLevelComment,
    `${mention}${cleanedReply}`
  )
  info(
    `conversation: replied on PR #${pullNumber} thread (top-level comment ${topLevelComment.id})`
  )
}
