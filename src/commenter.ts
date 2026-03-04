/**
 * commenter.ts - GitHub 评论管理模块
 *
 * 负责所有与 GitHub PR 评论相关的操作，包括：
 * 1. 创建/替换 PR 评论（issue comment）
 * 2. 缓冲和批量提交代码审查评论（review comment）
 * 3. 回复用户的 review comment
 * 4. 更新 PR 描述（写入发布说明）
 * 5. 管理增量审查状态（已审查的 commit ID 追踪）
 * 6. 评论链（conversation chain）的获取和组装
 *
 * 使用 HTML 注释标签（如 <!-- tag -->）作为唯一标识，
 * 实现评论的幂等性操作（查找并替换已有评论，而非重复创建）
 */
import {getInput, info, warning} from '@actions/core'
// eslint-disable-next-line camelcase
import {context as github_context} from '@actions/github'
import {octokit} from './octokit'

// eslint-disable-next-line camelcase
const context = github_context
const repo = context.repo

// ==================== 标签常量 ====================
// 这些 HTML 注释标签用于标识和定位 bot 生成的各类评论

/** 评论顶部的问候语（包含 bot 图标） */
export const COMMENT_GREETING = `${getInput('bot_icon')}   AI Reviewer`

/** 标识 bot 自动生成的代码审查评论 */
export const COMMENT_TAG =
  '<!-- This is an auto-generated comment by AI Reviewer -->'

/** 标识 bot 自动生成的回复评论 */
export const COMMENT_REPLY_TAG =
  '<!-- This is an auto-generated reply by AI Reviewer -->'

/** 标识 bot 的摘要评论 */
export const SUMMARIZE_TAG =
  '<!-- This is an auto-generated comment: summarize by AI Reviewer -->'

/** 标识审查进行中的状态标签（开始） */
export const IN_PROGRESS_START_TAG =
  '<!-- This is an auto-generated comment: summarize review in progress by AI Reviewer -->'

/** 标识审查进行中的状态标签（结束） */
export const IN_PROGRESS_END_TAG =
  '<!-- end of auto-generated comment: summarize review in progress by AI Reviewer -->'

/** 标识 PR 描述中发布说明区域（开始） */
export const DESCRIPTION_START_TAG =
  '<!-- This is an auto-generated comment: release notes by AI Reviewer -->'

/** 标识 PR 描述中发布说明区域（结束） */
export const DESCRIPTION_END_TAG =
  '<!-- end of auto-generated comment: release notes by AI Reviewer -->'

/** 标识隐藏的原始摘要区域（开始），存储在摘要评论的 HTML 注释中 */
export const RAW_SUMMARY_START_TAG = `<!-- This is an auto-generated comment: raw summary by AI Reviewer -->
<!--
`
/** 标识隐藏的原始摘要区域（结束） */
export const RAW_SUMMARY_END_TAG = `-->
<!-- end of auto-generated comment: raw summary by AI Reviewer -->`

/** 标识隐藏的精简摘要区域（开始） */
export const SHORT_SUMMARY_START_TAG = `<!-- This is an auto-generated comment: short summary by AI Reviewer -->
<!--
`

/** 标识隐藏的精简摘要区域（结束） */
export const SHORT_SUMMARY_END_TAG = `-->
<!-- end of auto-generated comment: short summary by AI Reviewer -->`

/** 标识已审查的 commit ID 列表（开始） */
export const COMMIT_ID_START_TAG = '<!-- commit_ids_reviewed_start -->'

/** 标识已审查的 commit ID 列表（结束） */
export const COMMIT_ID_END_TAG = '<!-- commit_ids_reviewed_end -->'

/**
 * Commenter 类 - GitHub 评论管理器
 *
 * 封装所有 GitHub 评论的 CRUD 操作，提供：
 * - 评论的创建、替换、查找
 * - 审查评论的缓冲和批量提交
 * - 评论链的获取和组装
 * - 增量审查状态管理
 */
export class Commenter {
  /**
   * 创建或替换 PR 评论
   * @param message - 评论内容
   * @param tag - HTML 标签，用于标识和查找评论
   * @param mode - "create"（新建）或 "replace"（查找并替换已有评论）
   */
  async comment(message: string, tag: string, mode: string) {
    let target: number
    if (context.payload.pull_request != null) {
      target = context.payload.pull_request.number
    } else if (context.payload.issue != null) {
      target = context.payload.issue.number
    } else {
      warning(
        'Skipped: context.payload.pull_request and context.payload.issue are both null'
      )
      return
    }

    if (!tag) {
      tag = COMMENT_TAG
    }

    // 组装评论正文：问候语 + 消息内容 + 标签
    const body = `${COMMENT_GREETING}

${message}

${tag}`

    if (mode === 'create') {
      await this.create(body, target)
    } else if (mode === 'replace') {
      await this.replace(body, tag, target)
    } else {
      warning(`Unknown mode: ${mode}, use "replace" instead`)
      await this.replace(body, tag, target)
    }
  }

  /**
   * 提取标签对之间的内容
   * 用于从评论正文中提取隐藏的状态数据（如原始摘要、已审查 commit ID 等）
   */
  getContentWithinTags(content: string, startTag: string, endTag: string) {
    const start = content.indexOf(startTag)
    const end = content.indexOf(endTag)
    if (start >= 0 && end >= 0) {
      return content.slice(start + startTag.length, end)
    }
    return ''
  }

  /** 移除标签对及其包含的内容 */
  removeContentWithinTags(content: string, startTag: string, endTag: string) {
    const start = content.indexOf(startTag)
    const end = content.lastIndexOf(endTag)
    if (start >= 0 && end >= 0) {
      return content.slice(0, start) + content.slice(end + endTag.length)
    }
    return content
  }

  /** 从摘要评论中提取原始摘要内容 */
  getRawSummary(summary: string) {
    return this.getContentWithinTags(
      summary,
      RAW_SUMMARY_START_TAG,
      RAW_SUMMARY_END_TAG
    )
  }

  /** 从摘要评论中提取精简摘要内容 */
  getShortSummary(summary: string) {
    return this.getContentWithinTags(
      summary,
      SHORT_SUMMARY_START_TAG,
      SHORT_SUMMARY_END_TAG
    )
  }

  /** 从 PR 描述中提取用户原始描述（移除 bot 生成的发布说明部分） */
  getDescription(description: string) {
    return this.removeContentWithinTags(
      description,
      DESCRIPTION_START_TAG,
      DESCRIPTION_END_TAG
    )
  }

  /** 从 PR 描述中提取发布说明内容 */
  getReleaseNotes(description: string) {
    const releaseNotes = this.getContentWithinTags(
      description,
      DESCRIPTION_START_TAG,
      DESCRIPTION_END_TAG
    )
    return releaseNotes.replace(/(^|\n)> .*/g, '')
  }

  /**
   * 更新 PR 描述，写入 AI 生成的发布说明
   * 将发布说明嵌入到 DESCRIPTION_START_TAG 和 DESCRIPTION_END_TAG 之间
   */
  async updateDescription(pullNumber: number, message: string) {
    try {
      // 获取 PR 的最新描述
      const pr = await octokit.pulls.get({
        owner: repo.owner,
        repo: repo.repo,
        // eslint-disable-next-line camelcase
        pull_number: pullNumber
      })
      let body = ''
      if (pr.data.body) {
        body = pr.data.body
      }
      // 移除已有的发布说明，保留用户原始描述
      const description = this.getDescription(body)

      const messageClean = this.removeContentWithinTags(
        message,
        DESCRIPTION_START_TAG,
        DESCRIPTION_END_TAG
      )
      // 在用户描述后追加发布说明（用标签包裹）
      const newDescription = `${description}\n${DESCRIPTION_START_TAG}\n${messageClean}\n${DESCRIPTION_END_TAG}`
      await octokit.pulls.update({
        owner: repo.owner,
        repo: repo.repo,
        // eslint-disable-next-line camelcase
        pull_number: pullNumber,
        body: newDescription
      })
    } catch (e) {
      warning(
        `Failed to get PR: ${e}, skipping adding release notes to description.`
      )
    }
  }

  // ==================== 代码审查评论缓冲区 ====================

  /** 审查评论缓冲区：在内存中暂存所有审查评论，最后一次性提交 */
  private readonly reviewCommentsBuffer: Array<{
    path: string       // 文件路径
    startLine: number  // 评论起始行号
    endLine: number    // 评论结束行号
    message: string    // 评论内容
  }> = []

  /**
   * 将审查评论添加到缓冲区（不立即提交）
   * 所有缓冲的评论将在 submitReview() 中一次性提交
   */
  async bufferReviewComment(
    path: string,
    startLine: number,
    endLine: number,
    message: string
  ) {
    message = `${COMMENT_GREETING}

${message}

${COMMENT_TAG}`
    this.reviewCommentsBuffer.push({
      path,
      startLine,
      endLine,
      message
    })
  }

  /**
   * 删除处于 PENDING 状态的审查
   * 在提交新审查前调用，避免残留的待处理审查
   */
  async deletePendingReview(pullNumber: number) {
    try {
      const reviews = await octokit.pulls.listReviews({
        owner: repo.owner,
        repo: repo.repo,
        // eslint-disable-next-line camelcase
        pull_number: pullNumber
      })

      const pendingReview = reviews.data.find(
        review => review.state === 'PENDING'
      )

      if (pendingReview) {
        info(
          `Deleting pending review for PR #${pullNumber} id: ${pendingReview.id}`
        )
        try {
          await octokit.pulls.deletePendingReview({
            owner: repo.owner,
            repo: repo.repo,
            // eslint-disable-next-line camelcase
            pull_number: pullNumber,
            // eslint-disable-next-line camelcase
            review_id: pendingReview.id
          })
        } catch (e) {
          warning(`Failed to delete pending review: ${e}`)
        }
      }
    } catch (e) {
      warning(`Failed to list reviews: ${e}`)
    }
  }

  /**
   * 提交所有缓冲的审查评论
   *
   * 流程：
   * 1. 如果缓冲区为空，提交一个仅包含状态消息的空审查
   * 2. 删除同一位置的旧 bot 评论（避免重复）
   * 3. 清理已有的 PENDING 审查
   * 4. 尝试一次性提交所有评论（createReview + submitReview）
   * 5. 如果批量提交失败，降级为逐条提交（createReviewComment）
   *
   * @param pullNumber - PR 编号
   * @param commitId - 提交的 commit SHA
   * @param statusMsg - 审查状态消息（包含处理统计信息）
   */
  async submitReview(pullNumber: number, commitId: string, statusMsg: string) {
    const body = `${COMMENT_GREETING}

${statusMsg}
`

    if (this.reviewCommentsBuffer.length === 0) {
      // 没有审查评论时，提交一个仅包含状态消息的空审查
      info(`Submitting empty review for PR #${pullNumber}`)
      try {
        await octokit.pulls.createReview({
          owner: repo.owner,
          repo: repo.repo,
          // eslint-disable-next-line camelcase
          pull_number: pullNumber,
          // eslint-disable-next-line camelcase
          commit_id: commitId,
          event: 'COMMENT',
          body
        })
      } catch (e) {
        warning(`Failed to submit empty review: ${e}`)
      }
      return
    }

    // 删除同一位置的旧 bot 评论，避免重复评论
    for (const comment of this.reviewCommentsBuffer) {
      const comments = await this.getCommentsAtRange(
        pullNumber,
        comment.path,
        comment.startLine,
        comment.endLine
      )
      for (const c of comments) {
        if (c.body.includes(COMMENT_TAG)) {
          info(
            `Deleting review comment for ${comment.path}:${comment.startLine}-${comment.endLine}: ${comment.message}`
          )
          try {
            await octokit.pulls.deleteReviewComment({
              owner: repo.owner,
              repo: repo.repo,
              // eslint-disable-next-line camelcase
              comment_id: c.id
            })
          } catch (e) {
            warning(`Failed to delete review comment: ${e}`)
          }
        }
      }
    }

    // 清理已有的 PENDING 审查
    await this.deletePendingReview(pullNumber)

    // 生成单条评论的 API 数据格式
    const generateCommentData = (comment: any) => {
      const commentData: any = {
        path: comment.path,
        body: comment.message,
        line: comment.endLine
      }

      // 如果是多行评论，添加起始行信息
      if (comment.startLine !== comment.endLine) {
        // eslint-disable-next-line camelcase
        commentData.start_line = comment.startLine
        // eslint-disable-next-line camelcase
        commentData.start_side = 'RIGHT'
      }

      return commentData
    }

    try {
      // 尝试一次性批量提交所有审查评论
      const review = await octokit.pulls.createReview({
        owner: repo.owner,
        repo: repo.repo,
        // eslint-disable-next-line camelcase
        pull_number: pullNumber,
        // eslint-disable-next-line camelcase
        commit_id: commitId,
        comments: this.reviewCommentsBuffer.map(comment =>
          generateCommentData(comment)
        )
      })

      info(
        `Submitting review for PR #${pullNumber}, total comments: ${this.reviewCommentsBuffer.length}, review id: ${review.data.id}`
      )

      // 正式提交审查（从 PENDING 变为 COMMENT）
      await octokit.pulls.submitReview({
        owner: repo.owner,
        repo: repo.repo,
        // eslint-disable-next-line camelcase
        pull_number: pullNumber,
        // eslint-disable-next-line camelcase
        review_id: review.data.id,
        event: 'COMMENT',
        body
      })
    } catch (e) {
      // 批量提交失败时，降级为逐条提交
      warning(
        `Failed to create review: ${e}. Falling back to individual comments.`
      )
      await this.deletePendingReview(pullNumber)
      let commentCounter = 0
      for (const comment of this.reviewCommentsBuffer) {
        info(
          `Creating new review comment for ${comment.path}:${comment.startLine}-${comment.endLine}: ${comment.message}`
        )
        const commentData: any = {
          owner: repo.owner,
          repo: repo.repo,
          // eslint-disable-next-line camelcase
          pull_number: pullNumber,
          // eslint-disable-next-line camelcase
          commit_id: commitId,
          ...generateCommentData(comment)
        }

        try {
          await octokit.pulls.createReviewComment(commentData)
        } catch (ee) {
          warning(`Failed to create review comment: ${ee}`)
        }

        commentCounter++
        info(
          `Comment ${commentCounter}/${this.reviewCommentsBuffer.length} posted`
        )
      }
    }
  }

  /**
   * 回复用户的 review comment
   *
   * 在顶层评论下创建回复，并将顶层评论的标签从 COMMENT_TAG 更新为 COMMENT_REPLY_TAG，
   * 表示该评论链已有 bot 参与回复
   */
  async reviewCommentReply(
    pullNumber: number,
    topLevelComment: any,
    message: string
  ) {
    const reply = `${COMMENT_GREETING}

${message}

${COMMENT_REPLY_TAG}
`
    try {
      // 在顶层评论下发布回复
      await octokit.pulls.createReplyForReviewComment({
        owner: repo.owner,
        repo: repo.repo,
        // eslint-disable-next-line camelcase
        pull_number: pullNumber,
        body: reply,
        // eslint-disable-next-line camelcase
        comment_id: topLevelComment.id
      })
    } catch (error) {
      warning(`Failed to reply to the top-level comment ${error}`)
      try {
        await octokit.pulls.createReplyForReviewComment({
          owner: repo.owner,
          repo: repo.repo,
          // eslint-disable-next-line camelcase
          pull_number: pullNumber,
          body: `Could not post the reply to the top-level comment due to the following error: ${error}`,
          // eslint-disable-next-line camelcase
          comment_id: topLevelComment.id
        })
      } catch (e) {
        warning(`Failed to reply to the top-level comment ${e}`)
      }
    }
    try {
      // 将顶层评论的标签更新为回复标签，标识该链已有 bot 参与
      if (topLevelComment.body.includes(COMMENT_TAG)) {
        const newBody = topLevelComment.body.replace(
          COMMENT_TAG,
          COMMENT_REPLY_TAG
        )
        await octokit.pulls.updateReviewComment({
          owner: repo.owner,
          repo: repo.repo,
          // eslint-disable-next-line camelcase
          comment_id: topLevelComment.id,
          body: newBody
        })
      }
    } catch (error) {
      warning(`Failed to update the top-level comment ${error}`)
    }
  }

  // ==================== 评论查询方法 ====================

  /** 获取指定行号范围内的所有 review comment */
  async getCommentsWithinRange(
    pullNumber: number,
    path: string,
    startLine: number,
    endLine: number
  ) {
    const comments = await this.listReviewComments(pullNumber)
    return comments.filter(
      (comment: any) =>
        comment.path === path &&
        comment.body !== '' &&
        ((comment.start_line !== undefined &&
          comment.start_line >= startLine &&
          comment.line <= endLine) ||
          (startLine === endLine && comment.line === endLine))
    )
  }

  /** 获取精确匹配指定行号范围的 review comment */
  async getCommentsAtRange(
    pullNumber: number,
    path: string,
    startLine: number,
    endLine: number
  ) {
    const comments = await this.listReviewComments(pullNumber)
    return comments.filter(
      (comment: any) =>
        comment.path === path &&
        comment.body !== '' &&
        ((comment.start_line !== undefined &&
          comment.start_line === startLine &&
          comment.line === endLine) ||
          (startLine === endLine && comment.line === endLine))
    )
  }

  /**
   * 获取指定行号范围内的所有评论对话链
   * 用于在代码审查时提供已有评论上下文
   */
  async getCommentChainsWithinRange(
    pullNumber: number,
    path: string,
    startLine: number,
    endLine: number,
    tag = ''
  ) {
    const existingComments = await this.getCommentsWithinRange(
      pullNumber,
      path,
      startLine,
      endLine
    )
    // 找出所有顶层评论（没有 in_reply_to_id 的评论）
    const topLevelComments = []
    for (const comment of existingComments) {
      if (!comment.in_reply_to_id) {
        topLevelComments.push(comment)
      }
    }

    // 组装所有包含指定标签的对话链
    let allChains = ''
    let chainNum = 0
    for (const topLevelComment of topLevelComments) {
      const chain = await this.composeCommentChain(
        existingComments,
        topLevelComment
      )
      if (chain && chain.includes(tag)) {
        chainNum += 1
        allChains += `Conversation Chain ${chainNum}:
${chain}
---
`
      }
    }
    return allChains
  }

  /**
   * 组装单个评论对话链
   * 将顶层评论和其所有回复按顺序拼接为 "用户: 内容" 格式的字符串
   */
  async composeCommentChain(reviewComments: any[], topLevelComment: any) {
    const conversationChain = reviewComments
      .filter((cmt: any) => cmt.in_reply_to_id === topLevelComment.id)
      .map((cmt: any) => `${cmt.user.login}: ${cmt.body}`)

    conversationChain.unshift(
      `${topLevelComment.user.login}: ${topLevelComment.body}`
    )

    return conversationChain.join('\n---\n')
  }

  /**
   * 获取指定评论的完整对话链
   * @returns { chain: 对话链字符串, topLevelComment: 顶层评论对象 }
   */
  async getCommentChain(pullNumber: number, comment: any) {
    try {
      const reviewComments = await this.listReviewComments(pullNumber)
      const topLevelComment = await this.getTopLevelComment(
        reviewComments,
        comment
      )
      const chain = await this.composeCommentChain(
        reviewComments,
        topLevelComment
      )
      return {chain, topLevelComment}
    } catch (e) {
      warning(`Failed to get conversation chain: ${e}`)
      return {
        chain: '',
        topLevelComment: null
      }
    }
  }

  /**
   * 沿着 in_reply_to_id 链向上查找顶层评论
   * 顶层评论是对话链的起始评论（没有 in_reply_to_id）
   */
  async getTopLevelComment(reviewComments: any[], comment: any) {
    let topLevelComment = comment

    while (topLevelComment.in_reply_to_id) {
      const parentComment = reviewComments.find(
        (cmt: any) => cmt.id === topLevelComment.in_reply_to_id
      )

      if (parentComment) {
        topLevelComment = parentComment
      } else {
        break
      }
    }

    return topLevelComment
  }

  // ==================== 评论缓存和分页列表 ====================

  /** review comment 缓存（按 PR 编号索引），避免重复 API 调用 */
  private reviewCommentsCache: Record<number, any[]> = {}

  /**
   * 分页获取 PR 的所有 review comment
   * 结果会被缓存，同一 PR 编号的后续调用直接返回缓存
   */
  async listReviewComments(target: number) {
    if (this.reviewCommentsCache[target]) {
      return this.reviewCommentsCache[target]
    }

    const allComments: any[] = []
    let page = 1
    try {
      for (;;) {
        const {data: comments} = await octokit.pulls.listReviewComments({
          owner: repo.owner,
          repo: repo.repo,
          // eslint-disable-next-line camelcase
          pull_number: target,
          page,
          // eslint-disable-next-line camelcase
          per_page: 100
        })
        allComments.push(...comments)
        page++
        if (!comments || comments.length < 100) {
          break
        }
      }

      this.reviewCommentsCache[target] = allComments
      return allComments
    } catch (e) {
      warning(`Failed to list review comments: ${e}`)
      return allComments
    }
  }

  /** 创建新的 issue comment */
  async create(body: string, target: number) {
    try {
      const response = await octokit.issues.createComment({
        owner: repo.owner,
        repo: repo.repo,
        // eslint-disable-next-line camelcase
        issue_number: target,
        body
      })
      // 将新评论添加到缓存
      if (this.issueCommentsCache[target]) {
        this.issueCommentsCache[target].push(response.data)
      } else {
        this.issueCommentsCache[target] = [response.data]
      }
    } catch (e) {
      warning(`Failed to create comment: ${e}`)
    }
  }

  /** 查找并替换已有评论；如果不存在则新建 */
  async replace(body: string, tag: string, target: number) {
    try {
      const cmt = await this.findCommentWithTag(tag, target)
      if (cmt) {
        // 找到已有评论，更新其内容
        await octokit.issues.updateComment({
          owner: repo.owner,
          repo: repo.repo,
          // eslint-disable-next-line camelcase
          comment_id: cmt.id,
          body
        })
      } else {
        // 未找到，创建新评论
        await this.create(body, target)
      }
    } catch (e) {
      warning(`Failed to replace comment: ${e}`)
    }
  }

  /** 查找包含指定标签的 issue comment */
  async findCommentWithTag(tag: string, target: number) {
    try {
      const comments = await this.listComments(target)
      for (const cmt of comments) {
        if (cmt.body && cmt.body.includes(tag)) {
          return cmt
        }
      }

      return null
    } catch (e: unknown) {
      warning(`Failed to find comment with tag: ${e}`)
      return null
    }
  }

  /** issue comment 缓存（按 issue/PR 编号索引） */
  private issueCommentsCache: Record<number, any[]> = {}

  /** 分页获取 PR/issue 的所有 issue comment（带缓存） */
  async listComments(target: number) {
    if (this.issueCommentsCache[target]) {
      return this.issueCommentsCache[target]
    }

    const allComments: any[] = []
    let page = 1
    try {
      for (;;) {
        const {data: comments} = await octokit.issues.listComments({
          owner: repo.owner,
          repo: repo.repo,
          // eslint-disable-next-line camelcase
          issue_number: target,
          page,
          // eslint-disable-next-line camelcase
          per_page: 100
        })
        allComments.push(...comments)
        page++
        if (!comments || comments.length < 100) {
          break
        }
      }

      this.issueCommentsCache[target] = allComments
      return allComments
    } catch (e: any) {
      warning(`Failed to list comments: ${e}`)
      return allComments
    }
  }

  // ==================== 增量审查状态管理 ====================
  // 使用 HTML 注释标签在摘要评论中存储已审查的 commit ID 列表
  // 格式：<!-- commit_ids_reviewed_start --><!-- sha1 --><!-- sha2 --><!-- commit_ids_reviewed_end -->

  /**
   * 从评论正文中提取已审查的 commit ID 列表
   * @returns commit SHA 字符串数组
   */
  getReviewedCommitIds(commentBody: string): string[] {
    const start = commentBody.indexOf(COMMIT_ID_START_TAG)
    const end = commentBody.indexOf(COMMIT_ID_END_TAG)
    if (start === -1 || end === -1) {
      return []
    }
    const ids = commentBody.substring(start + COMMIT_ID_START_TAG.length, end)
    // 解析 <!-- sha --> 格式的 commit ID
    return ids
      .split('<!--')
      .map(id => id.replace('-->', '').trim())
      .filter(id => id !== '')
  }

  /** 提取已审查 commit ID 的完整区块（包含标签） */
  getReviewedCommitIdsBlock(commentBody: string): string {
    const start = commentBody.indexOf(COMMIT_ID_START_TAG)
    const end = commentBody.indexOf(COMMIT_ID_END_TAG)
    if (start === -1 || end === -1) {
      return ''
    }
    return commentBody.substring(start, end + COMMIT_ID_END_TAG.length)
  }

  /**
   * 向已审查 commit ID 列表中添加新的 commit ID
   * 如果标签不存在则创建新的区块
   */
  addReviewedCommitId(commentBody: string, commitId: string): string {
    const start = commentBody.indexOf(COMMIT_ID_START_TAG)
    const end = commentBody.indexOf(COMMIT_ID_END_TAG)
    if (start === -1 || end === -1) {
      return `${commentBody}\n${COMMIT_ID_START_TAG}\n<!-- ${commitId} -->\n${COMMIT_ID_END_TAG}`
    }
    const ids = commentBody.substring(start + COMMIT_ID_START_TAG.length, end)
    return `${commentBody.substring(
      0,
      start + COMMIT_ID_START_TAG.length
    )}${ids}<!-- ${commitId} -->\n${commentBody.substring(end)}`
  }

  /**
   * 从 commit 列表中找到最近一次已审查的 commit ID
   * 从后向前遍历，返回第一个匹配的已审查 commit
   */
  getHighestReviewedCommitId(
    commitIds: string[],
    reviewedCommitIds: string[]
  ): string {
    for (let i = commitIds.length - 1; i >= 0; i--) {
      if (reviewedCommitIds.includes(commitIds[i])) {
        return commitIds[i]
      }
    }
    return ''
  }

  /** 获取 PR 的所有 commit ID（分页获取完整列表） */
  async getAllCommitIds(): Promise<string[]> {
    const allCommits = []
    let page = 1
    let commits
    if (context && context.payload && context.payload.pull_request != null) {
      do {
        commits = await octokit.pulls.listCommits({
          owner: repo.owner,
          repo: repo.repo,
          // eslint-disable-next-line camelcase
          pull_number: context.payload.pull_request.number,
          // eslint-disable-next-line camelcase
          per_page: 100,
          page
        })

        allCommits.push(...commits.data.map(commit => commit.sha))
        page++
      } while (commits.data.length > 0)
    }

    return allCommits
  }

  // ==================== 审查进度状态管理 ====================

  /**
   * 在摘要评论中添加"审查进行中"的状态提示
   * 如果已存在则不重复添加
   */
  addInProgressStatus(commentBody: string, statusMsg: string): string {
    const start = commentBody.indexOf(IN_PROGRESS_START_TAG)
    const end = commentBody.indexOf(IN_PROGRESS_END_TAG)
    if (start === -1 || end === -1) {
      return `${IN_PROGRESS_START_TAG}

Currently reviewing new changes in this PR...

${statusMsg}

${IN_PROGRESS_END_TAG}

---

${commentBody}`
    }
    return commentBody
  }

  /** 从摘要评论中移除"审查进行中"的状态提示 */
  removeInProgressStatus(commentBody: string): string {
    const start = commentBody.indexOf(IN_PROGRESS_START_TAG)
    const end = commentBody.indexOf(IN_PROGRESS_END_TAG)
    if (start !== -1 && end !== -1) {
      return (
        commentBody.substring(0, start) +
        commentBody.substring(end + IN_PROGRESS_END_TAG.length)
      )
    }
    return commentBody
  }
}
