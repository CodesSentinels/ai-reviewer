/**
 * review-comment.ts - PR 审查评论回复处理模块
 *
 * 处理 pull_request_review_comment 事件，即用户在 PR 的代码审查评论中发表回复。
 *
 * 触发条件（满足任一）：
 * 1. 评论对话链中已有 bot 的评论（继续对话）
 * 2. 评论内容中 @ai-reviewer（主动召唤 bot）
 *
 * 处理流程：
 * 1. 验证事件类型和 payload 数据
 * 2. 过滤 bot 自身发出的评论（避免自我回复循环）
 * 3. 获取评论对话链上下文
 * 4. 收集文件 diff、PR 摘要等辅助上下文
 * 5. 在 token 限制内打包所有上下文
 * 6. 调用 AI 生成回复并发布
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
import {Inputs} from './inputs'
import {octokit} from './octokit'
import {type Options} from './options'
import {type Prompts} from './prompts'
import {getTokenCount} from './tokenizer'

// eslint-disable-next-line camelcase
const context = github_context
const repo = context.repo

/** 用户在评论中 @ bot 的关键词 */
const ASK_BOT = '@ai-reviewer'

/**
 * 处理 PR 审查评论回复事件的主函数
 *
 * @param heavyBot - 重量级 AI 模型（用于生成高质量回复）
 * @param options - 全局配置选项
 * @param prompts - 提示词模板
 */
export const handleReviewComment = async (
  heavyBot: Bot,
  options: Options,
  prompts: Prompts
) => {
  const commenter: Commenter = new Commenter()
  const inputs: Inputs = new Inputs()

  // ===== 第一步：验证事件类型 =====
  if (context.eventName !== 'pull_request_review_comment') {
    warning(
      `Skipped: ${context.eventName} is not a pull_request_review_comment event`
    )
    return
  }

  if (!context.payload) {
    warning(`Skipped: ${context.eventName} event is missing payload`)
    return
  }

  const comment = context.payload.comment
  if (comment == null) {
    warning(`Skipped: ${context.eventName} event is missing comment`)
    return
  }
  if (
    context.payload.pull_request == null ||
    context.payload.repository == null
  ) {
    warning(`Skipped: ${context.eventName} event is missing pull_request`)
    return
  }

  // 填充 PR 基本信息到 inputs
  inputs.title = context.payload.pull_request.title
  if (context.payload.pull_request.body) {
    inputs.description = commenter.getDescription(
      context.payload.pull_request.body
    )
  }

  // ===== 第二步：只处理新创建的评论 =====
  if (context.payload.action !== 'created') {
    warning(`Skipped: ${context.eventName} event is not created`)
    return
  }

  // ===== 第三步：过滤 bot 自身的评论（避免自我回复循环） =====
  if (
    !comment.body.includes(COMMENT_TAG) &&
    !comment.body.includes(COMMENT_REPLY_TAG)
  ) {
    const pullNumber = context.payload.pull_request.number

    // 填充评论相关信息
    inputs.comment = `${comment.user.login}: ${comment.body}`
    inputs.diff = comment.diff_hunk  // 评论所在的 diff 片段
    inputs.filename = comment.path   // 评论所在的文件路径

    // 获取完整的评论对话链
    const {chain: commentChain, topLevelComment} =
      await commenter.getCommentChain(pullNumber, comment)

    if (!topLevelComment) {
      warning('Failed to find the top-level comment to reply to')
      return
    }

    inputs.commentChain = commentChain

    // ===== 第四步：判断是否需要 AI 回复 =====
    // 条件：对话链中已有 bot 评论（COMMENT_TAG/COMMENT_REPLY_TAG），
    //       或用户主动 @ai-reviewer
    if (
      commentChain.includes(COMMENT_TAG) ||
      commentChain.includes(COMMENT_REPLY_TAG) ||
      comment.body.includes(ASK_BOT)
    ) {
      // ===== 第五步：收集文件 diff 上下文 =====
      let fileDiff = ''
      try {
        // 获取文件的完整 diff（base 到 head 的对比）
        const diffAll = await octokit.repos.compareCommits({
          owner: repo.owner,
          repo: repo.repo,
          base: context.payload.pull_request.base.sha,
          head: context.payload.pull_request.head.sha
        })
        if (diffAll.data) {
          const files = diffAll.data.files
          if (files != null) {
            const file = files.find(f => f.filename === comment.path)
            if (file != null && file.patch) {
              fileDiff = file.patch
            }
          }
        }
      } catch (error) {
        warning(`Failed to get file diff: ${error}, skipping.`)
      }

      // 如果评论中没有 diff 片段，使用完整的文件 diff 替代
      if (inputs.diff.length === 0) {
        if (fileDiff.length > 0) {
          inputs.diff = fileDiff
          fileDiff = ''
        } else {
          await commenter.reviewCommentReply(
            pullNumber,
            topLevelComment,
            'Cannot reply to this comment as diff could not be found.'
          )
          return
        }
      }

      // ===== 第六步：在 token 限制内打包上下文 =====
      let tokens = getTokenCount(prompts.renderComment(inputs))

      // 检查基础提示词是否已超出 token 限制
      if (tokens > options.heavyTokenLimits.requestTokens) {
        await commenter.reviewCommentReply(
          pullNumber,
          topLevelComment,
          'Cannot reply to this comment as diff being commented is too large and exceeds the token limit.'
        )
        return
      }

      // 尝试将完整文件 diff 加入上下文（如果 token 预算允许）
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

      // 尝试将 PR 精简摘要加入上下文（如果 token 预算允许）
      const summary = await commenter.findCommentWithTag(
        SUMMARIZE_TAG,
        pullNumber
      )
      if (summary) {
        const shortSummary = commenter.getShortSummary(summary.body)
        const shortSummaryTokens = getTokenCount(shortSummary)
        if (
          tokens + shortSummaryTokens <=
          options.heavyTokenLimits.requestTokens
        ) {
          tokens += shortSummaryTokens
          inputs.shortSummary = shortSummary
        }
      }

      // ===== 第七步：调用 AI 生成回复并发布 =====
      const [reply] = await heavyBot.chat(prompts.renderComment(inputs), {})

      await commenter.reviewCommentReply(pullNumber, topLevelComment, reply)
    }
  } else {
    info(`Skipped: ${context.eventName} event is from the bot itself`)
  }
}
