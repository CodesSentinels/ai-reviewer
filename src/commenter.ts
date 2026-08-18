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
import {getPlatform} from './platform/git-platform'
import {getLogger} from './platform/logger'
import {buildStateMarker} from './platform/state-namespace'
import {getExecCtx, getRepoCoords} from './platform/run-context'
import {updateDescriptionSection} from './description-state'

/**
 * 仓库坐标（ARCH-005）。
 *
 * 原先是模块级的 `const repo = context.repo`——`@actions/github` 的 getter 在
 * 没有 GITHUB_REPOSITORY 时直接抛，导致 GitLab 入口一 import 本文件就崩。
 *
 * 这里保留 `repo.owner` / `repo.repo` 的写法（18 个调用点一字不改），只把求值
 * 从**加载期**挪到**调用期**：属性访问器每次现算，不再依赖任何平台 SDK。
 */
const repo = {
  get owner(): string {
    return getRepoCoords().owner
  },
  get repo(): string {
    return getRepoCoords().repo
  }
}

// ==================== 标签常量 ====================
// 这些 HTML 注释标签用于标识和定位 bot 生成的各类评论

/**
 * 评论顶部的问候语（包含 bot 图标 + 可配置名称）。
 * 由 initBotGreeting() 初始化，避免模块级直读 @actions/core getInput（CFG-005）。
 */
let _commentGreeting = '🤖   AI Reviewer'

/** 获取 bot 问候语，用于评论头部 */
export function getCommentGreeting(): string {
  return _commentGreeting
}

/**
 * 配置的 bot 登录名（GitHub: bot_github_login；GitLab: PAT 用户名）。
 * 空串表示未配置，此时退化为向平台查询。
 */
let _configuredBotLogin = ''

/**
 * 初始化 bot 问候语与身份。由入口在构建 Options 后调用一次。
 */
export function initBotGreeting(icon: string, name: string, botLogin = ''): void {
  _commentGreeting = `${icon}   ${name}`
  _configuredBotLogin = botLogin.trim()
  _resolvedBotLogin = undefined
}

/** 解析结果缓存：undefined = 还没查过，null = 查不到 */
let _resolvedBotLogin: string | null | undefined

/**
 * 本次运行的 bot 登录名（REVIEW-008 / STATE-008）。
 *
 * 为什么必须知道「我是谁」：定位既有摘要评论靠的是正文里的 marker，而用户用
 * 「引用回复」会把整段正文连同 marker 一起复制过去。不校验作者的话：
 *
 *   - 用户那条引用可能被当成我们的摘要**覆盖**掉；
 *   - 匹配到多条时，除第一条外全部会被**删除**；
 *   - findCommentWithTag 可能读到用户引用里的旧 reviewed SHA，污染增量审查状态。
 *
 * 优先用配置值（省一次 API），否则查一次并缓存。两者都拿不到时返回 null，
 * 调用方按「身份未知」fail closed。
 */
async function resolveBotLogin(): Promise<string | null> {
  if (_resolvedBotLogin !== undefined) return _resolvedBotLogin
  if (_configuredBotLogin !== '') {
    _resolvedBotLogin = _configuredBotLogin
    return _resolvedBotLogin
  }
  try {
    const login = await getPlatform().getAuthenticatedLogin()
    // adapter 理论上返回 string，但真实现可能因 API 变更/降级返回空值。
    // 靠 try/catch 兜 TypeError 会把「身份拿不到」和「调用出错」混成一件事，
    // 这里显式判类型，两种情况都 fail closed。
    const trimmed = typeof login === 'string' ? login.trim() : ''
    _resolvedBotLogin = trimmed === '' ? null : trimmed
  } catch (e) {
    getLogger().warning(
      `Failed to resolve bot identity: ${String(e)} — comment ownership checks will fail closed`
    )
    _resolvedBotLogin = null
  }
  return _resolvedBotLogin
}

/** 仅供测试重置身份缓存 */
export function _resetBotIdentity(): void {
  _configuredBotLogin = ''
  _resolvedBotLogin = undefined
}

/** 行级评论的位置键，用于把「待清理的旧评论」和「这次要发的新评论」对上 */
function commentKey(c: {path: string; startLine: number; endLine: number}): string {
  return `${c.path}:${c.startLine}-${c.endLine}`
}

/**
 * 平台 draft 的位置键，必须与 commentKey 算出同一个值。
 *
 * toDraft 在单行时会把 startLine 置成 undefined（平台要求），所以这里要还原成
 * endLine，否则单行评论的失败项对不回本地缓冲。
 */
function draftKey(d: {path: string; line: number; startLine?: number}): string {
  return `${d.path}:${d.startLine ?? d.line}-${d.line}`
}

/** 缓冲中的一条行级评论 */
export interface ReviewCommentBuffer {
  /** 文件路径 */
  path: string
  /** 评论起始行号 */
  startLine: number
  /** 评论结束行号 */
  endLine: number
  /** 评论内容 */
  message: string
}

/** 这条评论是不是我们自己发的（身份未知时返回 null，表示无法判断） */
function isOwnComment(comment: {user?: {login?: string}}, botLogin: string | null): boolean | null {
  if (botLogin == null) return null
  const author = (comment.user?.login ?? '').trim()
  if (author === '') return null
  return author.toLowerCase() === botLogin.toLowerCase()
}

/**
 * 按作者判断某条评论是否出自本 reviewer（REVIEW-012/013）。
 *
 * 供 commenter 之外的去重逻辑复用（如 review.ts 的 full review 覆盖范围计算）。
 * 返回 null 表示「判断不了」——调用方必须自己决定保守方向，不要当成 false。
 */
export async function isOwnAuthor(author: string | undefined | null): Promise<boolean | null> {
  const botLogin = await resolveBotLogin()
  return isOwnComment({user: {login: author ?? undefined}}, botLogin)
}

// 状态 marker 清单集中在 state-markers.ts（GH-014），此处 re-export 保持调用方 import 不变
export {
  STATE_MARKERS,
  stateMarker,
  stateMarkerVariantsFor,
  variantsForTag,
  tagPairVariants,
  locateMarkerBlock,
  bodyHasMarker,
  type StateMarkerSpec,
  type StateMarkerName
} from './state-markers'
import {
  STATE_MARKERS,
  stateMarker,
  bodyHasMarker,
  locateMarkerBlock,
  stateMarkerVariantsFor,
  variantsForTag,
  tagPairVariants
} from './state-markers'

/** 定位摘要评论里的「审查进行中」区块（新旧格式皆可） */
function locateInProgressBlock(
  body: string
): {start: number; end: number; startTag: string; endTag: string} | null {
  return locateMarkerBlock(body, 'inProgressStart', 'inProgressEnd')
}

/** 标识 bot 自动生成的代码审查评论 */
export function commentTag(): string {
  return stateMarker('comment')
}

/** 标识 bot 自动生成的回复评论 */
export function commentReplyTag(): string {
  return stateMarker('commentReply')
}

/** 标识 bot 的摘要评论 */
export function summarizeTag(): string {
  return stateMarker('summarize')
}

/** 标识审查进行中的状态标签（开始 / 结束） */
export function inProgressStartTag(): string {
  return stateMarker('inProgressStart')
}
export function inProgressEndTag(): string {
  return stateMarker('inProgressEnd')
}

/** 标识 PR 描述中发布说明区域（开始 / 结束） */
export function descriptionStartTag(): string {
  return stateMarker('descriptionStart')
}
export function descriptionEndTag(): string {
  return stateMarker('descriptionEnd')
}

/** 标识隐藏的原始摘要区域（开始 / 结束） */
export function rawSummaryStartTag(): string {
  return stateMarker('rawSummaryStart')
}
export function rawSummaryEndTag(): string {
  return stateMarker('rawSummaryEnd')
}

/** 标识隐藏的精简摘要区域（开始 / 结束） */
export function shortSummaryStartTag(): string {
  return stateMarker('shortSummaryStart')
}
export function shortSummaryEndTag(): string {
  return stateMarker('shortSummaryEnd')
}

/** 标识已审查的 commit ID 列表（开始） */
/**
 * 已审查 commit ID 区块的历史起止标签（无平台命名空间）。
 * 仍用于**匹配**在途 PR 里已存在的旧区块；新写入走 commitIdTags()。
 */
export const COMMIT_ID_START_TAG = STATE_MARKERS.commitIdsStart.legacy

/** 标识已审查的 commit ID 列表（结束） */
export const COMMIT_ID_END_TAG = STATE_MARKERS.commitIdsEnd.legacy

/** 当前平台命名空间下的已审查 commit ID 区块标签（用于新建区块） */
export function commitIdTags(): {start: string; end: string} {
  return {start: stateMarker('commitIdsStart'), end: stateMarker('commitIdsEnd')}
}

/**
 * 在正文中定位已审查 commit ID 区块，命名空间格式优先，回退历史格式。
 *
 * 返回命中的标签本身，调用方据此就地改写，不会把旧区块的标签换成新的——
 * 升级不需要重写在途 PR 已有的 marker。
 */
export function locateCommitIdBlock(
  body: string
): {start: number; end: number; startTag: string; endTag: string} | null {
  const namespaced = commitIdTags()
  for (const {start: startTag, end: endTag} of [
    namespaced,
    {start: COMMIT_ID_START_TAG, end: COMMIT_ID_END_TAG}
  ]) {
    const start = body.indexOf(startTag)
    const end = body.indexOf(endTag)
    if (start !== -1 && end !== -1) return {start, end, startTag, endTag}
  }
  return null
}

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
  /**
   * 发布/更新一条顶层评论。
   *
   * 返回是否真的投递成功。此前内部 create()/replace() 各自吞掉异常，调用方拿不到
   * 任何信号——REVIEW-014 的降级路径因此在评论创建失败时仍打印「已发布」，
   * 发现照样静默丢失。
   */
  async comment(message: string, tag: string, mode: string): Promise<boolean> {
    // PR number / MR iid 已由 ExecutionContext 归一化（GitHub 的 payload 里
    // 它可能来自 pull_request 也可能来自 issue，两者在构造阶段已经合流）
    const target = getExecCtx().changeRequestId
    if (!target) {
      getLogger().warning('Skipped: execution context carries no change request id')
      return false
    }

    if (!tag) {
      tag = commentTag()
    }

    // 组装评论正文：问候语 + 消息内容 + 标签
    const body = `${getCommentGreeting()}

${message}

${tag}`

    if (mode === 'create') {
      return await this.create(body, target)
    } else if (mode === 'replace') {
      return await this.replace(body, tag, target)
    } else {
      getLogger().warning(`Unknown mode: ${mode}, use "replace" instead`)
      return await this.replace(body, tag, target)
    }
  }

  /**
   * 提取标签对之间的内容
   * 用于从评论正文中提取隐藏的状态数据（如原始摘要、已审查 commit ID 等）
   */
  getContentWithinTags(content: string, startTag: string, endTag: string) {
    // 写新读旧：先按传入（新格式）标签找，找不到再回退到对应的历史标签
    for (const [s, e] of tagPairVariants(startTag, endTag)) {
      const start = content.indexOf(s)
      const end = content.indexOf(e)
      if (start >= 0 && end >= 0) {
        return content.slice(start + s.length, end)
      }
    }
    return ''
  }

  /** 移除标签对及其包含的内容 */
  removeContentWithinTags(content: string, startTag: string, endTag: string) {
    for (const [s, e] of tagPairVariants(startTag, endTag)) {
      const start = content.indexOf(s)
      const end = content.lastIndexOf(e)
      if (start >= 0 && end >= 0) {
        return content.slice(0, start) + content.slice(end + e.length)
      }
    }
    return content
  }

  /** 从摘要评论中提取原始摘要内容 */
  getRawSummary(summary: string) {
    return this.getContentWithinTags(summary, rawSummaryStartTag(), rawSummaryEndTag())
  }

  /** 从摘要评论中提取精简摘要内容 */
  getShortSummary(summary: string) {
    return this.getContentWithinTags(summary, shortSummaryStartTag(), shortSummaryEndTag())
  }

  /** 从 PR 描述中提取用户原始描述（移除 bot 生成的发布说明部分） */
  getDescription(description: string) {
    return this.removeContentWithinTags(description, descriptionStartTag(), descriptionEndTag())
  }

  /** 从 PR 描述中提取发布说明内容 */
  getReleaseNotes(description: string) {
    const releaseNotes = this.getContentWithinTags(
      description,
      descriptionStartTag(),
      descriptionEndTag()
    )
    return releaseNotes.replace(/(^|\n)> .*/g, '')
  }

  /**
   * 更新 PR 描述，写入 AI 生成的发布说明
   * 将发布说明嵌入到 descriptionStartTag() 和 descriptionEndTag() 之间
   */
  async updateDescription(pullNumber: number, message: string) {
    // STATE-016：走分区更新而不是「读整份 → 拼 → 整份写回」。
    // 旧写法与 pause/resume（review-state.ts）是两条独立的整份覆盖路径，
    // 交错执行时后写的一方会用自己读到的旧快照抹掉对方刚写入的区块。
    const messageClean = this.removeContentWithinTags(
      message,
      descriptionStartTag(),
      descriptionEndTag()
    )

    const outcome = await updateDescriptionSection({
      owner: repo.owner,
      repo: repo.repo,
      changeRequestId: pullNumber,
      startTag: descriptionStartTag(),
      endTag: descriptionEndTag(),
      render: () => messageClean
    })

    if (!outcome.ok) {
      getLogger().warning(
        `Skipped adding release notes to description (${outcome.reason}, ` +
          `${outcome.attempts} attempt(s)).`
      )
    }
  }

  // ==================== 代码审查评论缓冲区 ====================

  /** 审查评论缓冲区：在内存中暂存所有审查评论，最后一次性提交 */
  private readonly reviewCommentsBuffer: ReviewCommentBuffer[] = []

  /**
   * 将审查评论添加到缓冲区（不立即提交）
   * 所有缓冲的评论将在 submitReview() 中一次性提交
   */
  async bufferReviewComment(path: string, startLine: number, endLine: number, message: string) {
    message = `${getCommentGreeting()}

${message}

${commentTag()}`
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
      await getPlatform().deletePendingReview(repo.owner, repo.repo, pullNumber)
    } catch (e) {
      getLogger().warning(`Failed to delete pending review: ${e}`)
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
  async submitReview(
    pullNumber: number,
    commitId: string,
    statusMsg: string,
    threadStatusMap?: Map<string, boolean>
  ) {
    const body = `${getCommentGreeting()}

${statusMsg}
`

    const platform = getPlatform()
    const logger = getLogger()

    if (this.reviewCommentsBuffer.length === 0) {
      // 没有审查评论时，跳过空审查提交（GitHub API 不允许无评论的 COMMENT 审查）
      logger.info(`Skipping empty review for PR #${pullNumber} — no review comments to submit`)
      return
    }

    // 去重：跳过同位置已有未 resolved bot 评论的新评论，避免重复
    const commentsToSubmit: typeof this.reviewCommentsBuffer = []
    // REVIEW-013：位置 → 待清理的旧评论 id。发布成功后才真正删除。
    const pendingDeletions = new Map<string, number[]>()
    for (const comment of this.reviewCommentsBuffer) {
      const existingComments = await this.getCommentsAtRange(
        pullNumber,
        comment.path,
        comment.startLine,
        comment.endLine
      )
      // REVIEW-012/013：带 marker 不等于是我们发的。用户引用回复会把 marker 一起
      // 复制过去，只按 marker 判定会造成两种损失：
      //   未 resolved → 误判为「同位置已有我们的评论」，本次发现被丢弃；
      //   已 resolved → 把用户那条评论当成自己的旧评论**删掉**。
      const taggedAtRange = existingComments.filter(c => bodyHasMarker(c.body, 'comment'))
      // 注意字段：listReviewComments 映射后作者在 user.login，不是 c.author
      const ownership = await Promise.all(
        taggedAtRange.map(async c => await isOwnAuthor(c.user?.login))
      )
      const existingBotComments = taggedAtRange.filter((_c, i) => ownership[i] === true)
      // 身份判断不了时 ownership 全是 null，existingBotComments 因此为空，
      // 于是这条发现会被照常发布——可能与旧评论重复，但绝不会删掉任何东西。
      // 这个方向是刻意选的：重复可以人工清理，删错的内容找不回来。
      if (ownership.some(o => o == null)) {
        logger.warning(
          `[submit-dedup] bot identity is unknown — publishing at ` +
            `${comment.path}:${comment.startLine}-${comment.endLine} without deduplication; ` +
            'existing comments are left untouched'
        )
      } else if (taggedAtRange.length > existingBotComments.length) {
        logger.info(
          `[submit-dedup] ignoring ${taggedAtRange.length - existingBotComments.length} ` +
            `comment(s) at ${comment.path}:${comment.startLine}-${comment.endLine} that carry our ` +
            'marker but were authored by someone else'
        )
      }
      if (existingBotComments.length > 0) {
        // 检查该位置是否已 resolved
        const key = `${comment.path}:${comment.endLine}`
        const isResolved = threadStatusMap?.get(key)
        if (isResolved !== true) {
          logger.info(
            `[submit-dedup] skipping comment for ${comment.path}:${comment.startLine}-${comment.endLine} — existing unresolved bot comment found`
          )
          continue
        }
        // 已 resolved 的旧评论要被新发现取代，但**不能在这里就删**。
        //
        // 真正的发布发生在后面的批量/逐条请求里；先删后发的话，一旦平台拒收新
        // 行号（422），旧讨论已经没了，新发现也发不出去——历史和新内容一起丢。
        // 这里只登记，等确认新评论落地后再清理。
        pendingDeletions.set(
          commentKey(comment),
          existingBotComments.map(c => c.id)
        )
      }
      commentsToSubmit.push(comment)
    }

    if (commentsToSubmit.length === 0) {
      logger.info(
        `[submit-dedup] all ${this.reviewCommentsBuffer.length} comment(s) skipped — already covered by existing bot comments`
      )
      return
    }

    // 清理已有的 PENDING 审查
    await this.deletePendingReview(pullNumber)

    // 生成 ReviewCommentDraft 格式
    const toDraft = (comment: any) => ({
      path: comment.path as string,
      body: comment.message as string,
      line: comment.endLine as number,
      startLine: comment.startLine !== comment.endLine ? (comment.startLine as number) : undefined,
      startSide: comment.startLine !== comment.endLine ? 'RIGHT' : undefined
    })

    try {
      const result = await platform.submitReviewComments(
        repo.owner,
        repo.repo,
        pullNumber,
        commitId,
        commentsToSubmit.map(toDraft),
        body
      )

      logger.info(
        `Submitting review for PR #${pullNumber}, delivered: ${result.delivered.length}, ` +
          `failed: ${result.failed.length}`
      )

      // adapter 可能部分成功：GitHub 的 createReview 是原子的，GitLab 则逐条创建
      // discussion，部分失败时只返回一个总数是不够的。按位置对回本地缓冲，
      // **只清理确认投递成功的那些**，否则新发现没发成、被取代的旧讨论却已经删了。
      const failedKeys = new Set(result.failed.map(d => draftKey(d)))
      const deliveredComments = commentsToSubmit.filter(c => !failedKeys.has(commentKey(c)))
      await this.flushPendingDeletions(deliveredComments, pendingDeletions)

      // 两层都没送出去的，交给统一的顶层降级（REVIEW-014），
      // 而不是让 adapter 各自静默跳过
      if (result.failed.length > 0) {
        const undelivered = commentsToSubmit.filter(c => failedKeys.has(commentKey(c)))
        await this.postUndeliverableAsTopLevel(pullNumber, undelivered)
      }
    } catch (e) {
      // 批量提交失败时，降级为逐条提交
      logger.warning(`Failed to create review: ${e}. Falling back to individual comments.`)
      await this.deletePendingReview(pullNumber)
      let commentCounter = 0
      // REVIEW-014：逐条也发不出去的（最常见是行号不在 diff 内，平台返回 422），
      // 原先只打一条 warning 就没了——审查发现被静默丢弃。收集起来，最后统一
      // 降级到顶层评论：位置精度不如行级，但至少内容不会消失。
      const undeliverable: ReviewCommentBuffer[] = []
      for (const comment of commentsToSubmit) {
        logger.info(
          `Creating new review comment for ${comment.path}:${comment.startLine}-${comment.endLine}: ${comment.message}`
        )

        try {
          await platform.createReviewComment(
            repo.owner,
            repo.repo,
            pullNumber,
            commitId,
            toDraft(comment)
          )
        } catch (ee) {
          logger.warning(
            `Failed to create review comment at ${comment.path}:${comment.startLine}-${comment.endLine}: ${ee}`
          )
          undeliverable.push(comment)
        }

        commentCounter++
        logger.info(`Comment ${commentCounter}/${commentsToSubmit.length} posted`)
      }

      // 只清理「新评论确实发出去了」的那些位置；发不出去的保留旧讨论，
      // 否则用户既看不到新发现，也失去了历史上下文
      const undeliverableKeys = new Set(undeliverable.map(commentKey))
      const delivered = commentsToSubmit.filter(c => !undeliverableKeys.has(commentKey(c)))
      await this.flushPendingDeletions(delivered, pendingDeletions)

      if (undeliverable.length > 0) {
        await this.postUndeliverableAsTopLevel(pullNumber, undeliverable)
      }
    }
  }

  /**
   * 清理被新评论取代的旧讨论（REVIEW-013）。
   *
   * 只对**确认已发布**的位置执行——见 submitReview 里登记 pendingDeletions 的
   * 注释：先删后发会在平台拒收新行号时把历史和新发现一起弄丢。
   */
  private async flushPendingDeletions(
    published: ReviewCommentBuffer[],
    pending: Map<string, number[]>
  ): Promise<void> {
    const platform = getPlatform()
    const logger = getLogger()
    for (const comment of published) {
      const ids = pending.get(commentKey(comment))
      if (ids == null) continue
      for (const id of ids) {
        logger.info(`Deleting superseded resolved review comment ${id} at ${commentKey(comment)}`)
        try {
          await platform.deleteReviewComment(repo.owner, repo.repo, id)
        } catch (e) {
          logger.warning(`Failed to delete review comment: ${e}`)
        }
      }
    }
  }

  /**
   * 把发不出去的行级评论降级为一条顶层评论（REVIEW-014）。
   *
   * 触发场景是行号映射失败：模型给出的行不在本次 diff 的可评论范围内，平台
   * 直接拒收（GitHub 422 "line must be part of the diff"）。这类失败无法靠重试
   * 解决，但发现本身是有价值的——把文件与行号写进正文，用户照样能定位。
   *
   * 用 replace 模式发，避免每次审查都堆一条新的。
   */
  private async postUndeliverableAsTopLevel(
    pullNumber: number,
    comments: ReviewCommentBuffer[]
  ): Promise<void> {
    const logger = getLogger()
    const items = comments
      .map(c => {
        const range = c.startLine === c.endLine ? `${c.endLine}` : `${c.startLine}-${c.endLine}`
        return `<details>\n<summary><code>${c.path}:${range}</code></summary>\n\n${c.message}\n\n</details>`
      })
      .join('\n')

    const body = `> ⚠️ 以下 ${comments.length} 条发现无法作为行级评论发布（通常是行号不在本次 diff 的可评论范围内），改以顶层评论呈现：\n\n${items}`

    const delivered = await this.comment(body, stateMarker('undeliverableFindings'), 'replace')
    if (delivered) {
      logger.info(
        `[review-014] posted ${comments.length} undeliverable finding(s) as a top-level comment`
      )
      return
    }
    // 最后一层也没送出去：如实报告「彻底丢失」，并把内容写进日志，让运维至少能
    // 从 job 日志里捞回来。此前这里靠 try/catch 判断成功，而 comment() 内部把
    // 异常吞了，于是失败也照样打印「已发布」。
    logger.error(
      `[review-014] failed to deliver ${comments.length} finding(s) — they are NOT visible on the ` +
        'pull request. Contents follow so they are at least recoverable from this log:'
    )
    for (const c of comments) {
      logger.error(`  ${commentKey(c)}: ${c.message}`)
    }
  }

  /**
   * 回复用户的 review comment
   *
   * 在顶层评论下创建回复，并将顶层评论的标签从 commentTag() 更新为 commentReplyTag()，
   * 表示该评论链已有 bot 参与回复
   */
  async reviewCommentReply(pullNumber: number, topLevelComment: any, message: string) {
    const platform = getPlatform()
    const logger = getLogger()
    const reply = `${getCommentGreeting()}

${message}

${commentReplyTag()}
`
    try {
      await platform.replyToReviewComment(
        repo.owner,
        repo.repo,
        pullNumber,
        topLevelComment.id,
        reply
      )
    } catch (error) {
      logger.warning(`Failed to reply to the top-level comment ${error}`)
      try {
        await platform.replyToReviewComment(
          repo.owner,
          repo.repo,
          pullNumber,
          topLevelComment.id,
          `Could not post the reply to the top-level comment due to the following error: ${error}`
        )
      } catch (e) {
        logger.warning(`Failed to reply to the top-level comment ${e}`)
      }
    }
    try {
      const hitTag = stateMarkerVariantsFor('comment').find((v: string) =>
        topLevelComment.body.includes(v)
      )
      if (hitTag != null) {
        // 命中哪种形态就替换哪种：历史评论保持历史格式，新评论用命名空间格式
        const replacement =
          hitTag === STATE_MARKERS.comment.legacy
            ? STATE_MARKERS.commentReply.legacy
            : commentReplyTag()
        const newBody = topLevelComment.body.replace(hitTag, replacement)
        await platform.updateReviewComment(repo.owner, repo.repo, topLevelComment.id, newBody)
      }
    } catch (error) {
      logger.warning(`Failed to update the top-level comment ${error}`)
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
  async getCommentsAtRange(pullNumber: number, path: string, startLine: number, endLine: number) {
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
   *
   * @param threadStatusMap 可选的线程状态 map（path:line → isResolved），
   *   由 fetchThreadStatusMap() 生成。传入后每条链头部会加上
   *   [OPEN] 或 [RESOLVED] 标签，让 AI 知道是否应跳过 / reopen。
   */
  async getCommentChainsWithinRange(
    pullNumber: number,
    path: string,
    startLine: number,
    endLine: number,
    tag = '',
    threadStatusMap?: Map<string, boolean>
  ) {
    const existingComments = await this.getCommentsWithinRange(pullNumber, path, startLine, endLine)
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
      const chain = await this.composeCommentChain(existingComments, topLevelComment)
      if (chain && chain.includes(tag)) {
        chainNum += 1
        // 从 threadStatusMap 推断该评论所在行是否已 resolved
        let statusLabel = ''
        if (threadStatusMap != null) {
          const commentLine: number =
            topLevelComment.line ?? topLevelComment.original_line ?? startLine
          const key = `${path}:${commentLine}`
          const isResolved = threadStatusMap.get(key)
          // 只在明确知道状态时加标签；未命中 map 的保持无标签（兼容旧行为）
          if (isResolved === true) {
            statusLabel = ' [RESOLVED]'
          } else if (isResolved === false) {
            statusLabel = ' [OPEN]'
          }
        }
        allChains += `Conversation Chain ${chainNum}${statusLabel}:
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

    conversationChain.unshift(`${topLevelComment.user.login}: ${topLevelComment.body}`)

    return conversationChain.join('\n---\n')
  }

  /**
   * 获取指定评论的完整对话链
   * @returns { chain: 对话链字符串, topLevelComment: 顶层评论对象 }
   */
  async getCommentChain(pullNumber: number, comment: any) {
    try {
      const reviewComments = await this.listReviewComments(pullNumber)
      const topLevelComment = await this.getTopLevelComment(reviewComments, comment)
      const chain = await this.composeCommentChain(reviewComments, topLevelComment)
      return {chain, topLevelComment}
    } catch (e) {
      getLogger().warning(`Failed to get conversation chain: ${e}`)
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

    try {
      const comments = await getPlatform().listReviewComments(repo.owner, repo.repo, target)
      // 映射为旧 Octokit 格式以保持 getCommentsWithinRange 等消费者兼容
      const mapped = comments.map(c => ({
        id: c.id,
        body: c.body,
        path: c.path,
        line: c.line,
        // eslint-disable-next-line camelcase
        start_line: c.startLine,
        // eslint-disable-next-line camelcase
        original_line: c.originalLine,
        // eslint-disable-next-line camelcase
        in_reply_to_id: c.in_reply_to_id,
        user: {login: c.author},
        // eslint-disable-next-line camelcase
        node_id: c.nodeId,
        // eslint-disable-next-line camelcase
        created_at: c.createdAt
      }))
      this.reviewCommentsCache[target] = mapped
      return mapped
    } catch (e) {
      getLogger().warning(`Failed to list review comments: ${e}`)
      return []
    }
  }

  /** 创建新的 issue comment */
  async create(body: string, target: number): Promise<boolean> {
    try {
      const result = await getPlatform().createComment(repo.owner, repo.repo, target, body)
      const data = {
        id: result.id,
        body: result.body,
        user: {login: result.author},
        // eslint-disable-next-line camelcase
        node_id: result.nodeId,
        // eslint-disable-next-line camelcase
        created_at: result.createdAt
      }
      if (this.issueCommentsCache[target]) {
        this.issueCommentsCache[target].push(data)
      } else {
        this.issueCommentsCache[target] = [data]
      }
      return true
    } catch (e) {
      getLogger().warning(`Failed to create comment: ${e}`)
      return false
    }
  }

  /** 查找并替换已有评论；如果不存在则新建。同时清理并发运行产生的重复评论 */
  async replace(body: string, tag: string, target: number): Promise<boolean> {
    const platform = getPlatform()
    const logger = getLogger()
    try {
      const comments = await this.listComments(target)
      const variants = variantsForTag(tag)
      const taggedComments = comments.filter(
        (cmt: any) => cmt.body && variants.some(v => cmt.body.includes(v))
      )

      // REVIEW-008：带 marker 不等于是我们发的。用户「引用回复」会把整段正文连同
      // marker 一起复制过去，不校验作者就会覆盖甚至删掉用户自己的评论。
      const botLogin = await resolveBotLogin()

      // 身份未知时 fail closed：既不更新也不删除任何既有评论，直接新发一条。
      //
      // 只挡删除是不够的——覆盖比删除破坏性更大：被删的评论用户还能从邮件通知里
      // 找回原文，被覆盖的内容彻底消失。宁可留下重复的摘要（下次身份可解析时会
      // 自动收敛），也不能赌「第一条带 marker 的评论就是我们自己的」。
      if (botLogin == null) {
        logger.warning(
          `Bot identity is unknown — posting a new comment with tag ${tag} instead of updating ` +
            `${taggedComments.length} existing match(es), to avoid overwriting user comments. ` +
            'Set the bot login in configuration to restore in-place updates.'
        )
        return await this.create(body, target)
      }

      const ownComments = taggedComments.filter((cmt: any) => isOwnComment(cmt, botLogin) === true)
      const foreignCount = taggedComments.length - ownComments.length
      if (foreignCount > 0) {
        logger.info(
          `Ignoring ${foreignCount} comment(s) carrying tag ${tag} but authored by someone else ` +
            '(likely a quoted reply)'
        )
      }

      if (ownComments.length > 0) {
        await platform.updateComment(repo.owner, repo.repo, ownComments[0].id, body)

        for (let i = 1; i < ownComments.length; i++) {
          logger.info(`Deleting duplicate comment ${ownComments[i].id} with tag ${tag}`)
          try {
            await platform.deleteComment(repo.owner, repo.repo, ownComments[i].id)
          } catch (e) {
            logger.warning(`Failed to delete duplicate comment: ${e}`)
          }
        }
        return true
      }
      return await this.create(body, target)
    } catch (e) {
      logger.warning(`Failed to replace comment: ${e}`)
      return false
    }
  }

  /** 查找包含指定标签的 issue comment */
  async findCommentWithTag(tag: string, target: number) {
    try {
      const comments = await this.listComments(target)
      const variants = variantsForTag(tag)
      // 同 replace()：用户引用回复里的 marker 不能被当成我们自己的状态，
      // 否则会从中读出过期的 reviewed SHA，把增量审查的起点带偏。
      //
      // 身份未知时返回 null 而不是「第一条带 marker 的」：拿不准归属就不恢复
      // 状态。代价是这次退化成全量审查，比从用户引用里读出错误的起点安全。
      const botLogin = await resolveBotLogin()
      if (botLogin == null) {
        getLogger().warning(
          `Bot identity is unknown — not restoring state from comments with tag ${tag}; ` +
            'this run will not use previous review state.'
        )
        return null
      }
      for (const cmt of comments) {
        if (!cmt.body || !variants.some(v => cmt.body.includes(v))) continue
        if (isOwnComment(cmt, botLogin) !== true) continue
        return cmt
      }

      return null
    } catch (e: unknown) {
      getLogger().warning(`Failed to find comment with tag: ${e}`)
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

    try {
      const comments = await getPlatform().listComments(repo.owner, repo.repo, target)
      const mapped = comments.map(c => ({
        id: c.id,
        body: c.body,
        user: {login: c.author},
        // eslint-disable-next-line camelcase
        node_id: c.nodeId,
        // eslint-disable-next-line camelcase
        created_at: c.createdAt
      }))
      this.issueCommentsCache[target] = mapped
      return mapped
    } catch (e: any) {
      getLogger().warning(`Failed to list comments: ${e}`)
      return []
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
    const block = locateCommitIdBlock(commentBody)
    if (block == null) {
      return []
    }
    const ids = commentBody.substring(block.start + block.startTag.length, block.end)
    // 解析 <!-- sha --> 格式的 commit ID
    return ids
      .split('<!--')
      .map(id => id.replace('-->', '').trim())
      .filter(id => id !== '')
  }

  /** 提取已审查 commit ID 的完整区块（包含标签） */
  getReviewedCommitIdsBlock(commentBody: string): string {
    const block = locateCommitIdBlock(commentBody)
    if (block == null) {
      return ''
    }
    return commentBody.substring(block.start, block.end + block.endTag.length)
  }

  /**
   * 向已审查 commit ID 列表中添加新的 commit ID
   * 如果标签不存在则创建新的区块
   */
  addReviewedCommitId(commentBody: string, commitId: string): string {
    const block = locateCommitIdBlock(commentBody)
    if (block == null) {
      // 新建区块用当前平台命名空间；已存在的旧区块保持原标签就地追加
      const tags = commitIdTags()
      return `${commentBody}\n${tags.start}\n<!-- ${commitId} -->\n${tags.end}`
    }
    if (this.getReviewedCommitIds(commentBody).includes(commitId)) {
      return commentBody
    }
    const ids = commentBody.substring(block.start + block.startTag.length, block.end)
    return `${commentBody.substring(
      0,
      block.start + block.startTag.length
    )}${ids}<!-- ${commitId} -->\n${commentBody.substring(block.end)}`
  }

  /**
   * 从 commit 列表中找到最近一次已审查的 commit ID
   * 从后向前遍历，返回第一个匹配的已审查 commit
   */
  getHighestReviewedCommitId(commitIds: string[], reviewedCommitIds: string[]): string {
    for (let i = commitIds.length - 1; i >= 0; i--) {
      if (reviewedCommitIds.includes(commitIds[i])) {
        return commitIds[i]
      }
    }
    return ''
  }

  /** 获取 PR 的所有 commit ID（分页获取完整列表） */
  async getAllCommitIds(): Promise<string[]> {
    const execCtx = getExecCtx()
    if (execCtx.changeRequestId) {
      return getPlatform().listChangeRequestCommits(repo.owner, repo.repo, execCtx.changeRequestId)
    }
    return []
  }

  // ==================== 审查进度状态管理 ====================

  /**
   * 在摘要评论中添加"审查进行中"的状态提示
   * 如果已存在则不重复添加
   */
  addInProgressStatus(commentBody: string, statusMsg: string): string {
    // 写新读旧：已有历史格式的进度块时不重复插入
    if (locateInProgressBlock(commentBody) != null) {
      return commentBody
    }
    {
      return `${inProgressStartTag()}

Currently reviewing new changes in this PR...

${statusMsg}

${inProgressEndTag()}

---

${commentBody}`
    }
  }

  /** 从摘要评论中移除"审查进行中"的状态提示 */
  removeInProgressStatus(commentBody: string): string {
    const block = locateInProgressBlock(commentBody)
    if (block != null) {
      return (
        commentBody.substring(0, block.start) +
        commentBody.substring(block.end + block.endTag.length)
      )
    }
    return commentBody
  }
}
