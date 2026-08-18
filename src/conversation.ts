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
import {type Bot} from './bot'
import type {ExecutionContext} from './platform/execution-context'
import {repoCoordsOf} from './platform/run-context'
import {getPermissionResult} from './commands/permission'
import {permissionAtLeast, type PermissionLevel} from './commands/types'
import {
  Commenter,
  isOwnAuthor,
  bodyHasMarker,
  commentReplyTag,
  getCommentGreeting,
  stateMarkerVariantsFor,
  summarizeTag
} from './commenter'
import {BOT_MENTIONS} from './constants'
import {Inputs} from './inputs'
import {type Options} from './options'
import {getPlatform} from './platform/git-platform'
import {getLogger} from './platform/logger'
import {buildStateMarker, hasStateMarker, stateMarkerVariants} from './platform/state-namespace'
import {type Prompts} from './prompts'
import {getTokenCount} from './tokenizer'

/** 默认的 bot mention 别名（小写匹配，与命令解析器保持一致）。共享自 constants。 */
export {BOT_MENTIONS}

/**
 * 标识 bot 在对话链中出现过的标签（用于轮次统计 / 意图识别）。
 *
 * 必须是函数：命名空间由入口在运行时设置，模块级常量会在 import 时就固化成
 * 默认的 github 前缀，GitLab 入口再调 setStateNamespace() 也改不回来。
 * 同时返回 current + legacy 两种形态，否则升级前发的 bot 评论会被当成人类评论。
 */
export function botCommentTagVariants(): string[] {
  return [...stateMarkerVariantsFor('comment'), ...stateMarkerVariantsFor('commentReply')]
}

/** 单个 thread 的对话轮次上限（bot 已回复的次数），超过后停止追问 */
export const MAX_CONVERSATION_TURNS = 10

/** 对话历史进入 Prompt 时的字符上限（粗粒度预算，token 预算另行精确校验） */
export const MAX_CHAIN_CHARS = 12_000

/** 对话历史截断时的分隔符（与 Commenter.composeCommentChain 对齐） */
const CHAIN_SEPARATOR = '\n---\n'

/**
 * 主评论区（issue_comment）对话回复的幂等标签前缀。
 *
 * 主评论区是扁平结构（无内嵌 thread），无法像行级评论那样靠 in_reply_to 归位。
 * 我们给每条 bot 回复写入 `${PREFIX}:${触发评论 id} -->`，回复前扫描是否已存在同一
 * 触发评论 id 的标签 —— 命中即跳过，避免 Action 重投递/重试时对同一条提问重复回帖。
 * 这也是「连续快速提问」场景下每条回复能稳定对应到各自问题、且不丢不重的关键。
 */
export const CONV_REPLY_TAG_PREFIX = '<!-- codesentinel-conv-reply'

/** 组装主评论区对话回复的幂等标签（带平台命名空间，用于写入，GH-014） */
export function buildIssueConvReplyTag(originalCommentId: number): string {
  return buildStateMarker('conv-reply', originalCommentId)
}

/** 历史格式的幂等标签（仅用于匹配在途 PR 的旧回复） */
export function legacyIssueConvReplyTag(originalCommentId: number): string {
  return `${CONV_REPLY_TAG_PREFIX}:${originalCommentId} -->`
}

/** 匹配时应接受的全部形态：新命名空间格式 + 历史格式 */
export function issueConvReplyTagVariants(originalCommentId: number): string[] {
  return stateMarkerVariants(
    'conv-reply',
    legacyIssueConvReplyTag(originalCommentId),
    originalCommentId
  )
}

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
/**
 * 自然语言追问所需的最低权限（REVIEW-017）。
 *
 * 与 `review` 命令同基线：两者触发的是同一个重量模型，成本相当。选 write 而不是
 * read，是因为「能看见仓库的人都能让 bot 跑模型」在私有仓库/大群组里等于把
 * 模型预算敞开给所有可见成员。
 */
const CONVERSATION_MIN_PERMISSION: PermissionLevel = 'write'

/**
 * 追问者是否有权触发对话（REVIEW-017）。
 *
 * 三条规则，与命令路径保持一致：
 *   1. 权限达标 → 放行；
 *   2. 未达标但本人是 PR/MR 作者 → 放行（对自己的变更提问是主要场景）；
 *   3. **权限查询失败 → 拒绝**。不能因为「看起来是作者」就在权限未知时放行，
 *      那是 fail open——同 CMD-016 的教训。
 */
async function canConverse(
  execCtx: ExecutionContext,
  prAuthor: string
): Promise<{allowed: boolean; reason: string}> {
  const {owner, repo} = repoCoordsOf(execCtx)
  const actor = execCtx.actor.login
  const {level, queryFailed} = await getPermissionResult({owner, repo, username: actor})

  if (queryFailed) {
    return {allowed: false, reason: '权限查询失败'}
  }
  if (permissionAtLeast(level, CONVERSATION_MIN_PERMISSION)) {
    return {allowed: true, reason: `权限 ${level}`}
  }
  if (actor !== '' && actor === prAuthor) {
    return {allowed: true, reason: '变更作者豁免'}
  }
  return {allowed: false, reason: `权限不足（${level}）`}
}

/**
 * 这条评论是不是 reviewer 自己发的（REVIEW-018）。
 *
 * 判定顺序有讲究：
 *
 * 1. **构造阶段归一化的 actor.isBot** —— GitHub 认 `user.type === 'Bot'` 与
 *    `xxx[bot]` 后缀，GitLab 认 access token 账号的权威命名（CMD-006）。
 * 2. **作者是否等于本 reviewer** —— 权威信号，覆盖「以个人 PAT 身份发言」的
 *    GitLab 常见形态。
 * 3. **正文带 bot marker** —— 仅在前两条都判不出时作为兜底。
 *
 * 第 3 条单独用是有害的：用户「引用回复」会把 marker 一起复制过去，于是他带着
 * 引用提问就永远得不到回复（§8.3 留下的尾巴）。所以只有在**身份完全判不出**时
 * 才退回到它——那种情况下宁可少答一次，也不能让 bot 自问自答绕成死循环。
 */
async function isSelfAuthoredComment(
  execCtx: ExecutionContext,
  commentBody: string
): Promise<boolean> {
  if (execCtx.actor.isBot) return true

  const own = await isOwnAuthor(execCtx.actor.login)
  if (own === true) return true
  // 身份可解析且确认不是自己 → 就是真人，哪怕正文里带着引用来的 marker
  if (own === false) return false

  // 身份判不出：退回 marker 兜底，宁可少答一次也不能形成反馈循环
  return bodyHasMarker(commentBody, 'comment') || bodyHasMarker(commentBody, 'commentReply')
}

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
  // marker 兜底：默认开启，用于调用方没做作者判定的场景。
  //
  // 注意它会误伤「引用回复」——用户引用 bot 的话再提问，正文里就带着 marker。
  // 生产调用方已在上游用 isSelfAuthoredComment 做过作者判定（REVIEW-018），
  // 那里才是权威信号，因此显式传 `botCommentTags: []` 关掉这层兜底。
  const botTags = opts.botCommentTags ?? botCommentTagVariants()
  if (botTags.length > 0 && botTags.some(tag => body.includes(tag))) {
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
  botCommentTags: string[] = botCommentTagVariants()
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
 * @param execCtx  - 平台无关执行上下文（ARCH-005：取代直接 import @actions/github）
 * @param heavyBot - 重量级模型，用于生成高质量回复
 * @param options  - 全局配置
 * @param prompts  - 提示词模板
 */
export const handleConversation = async (
  execCtx: ExecutionContext,
  heavyBot: Bot,
  options: Options,
  prompts: Prompts
): Promise<void> => {
  const commenter: Commenter = new Commenter()
  const inputs: Inputs = new Inputs()
  // 按**最后**一个斜杠切：GitLab 子组项目是 group/subgroup/project，
  // split('/') 取前两段会把 owner/repo 切错（repoCoordsOf 的既有语义）
  const {owner: repoOwner, repo: repoName} = repoCoordsOf(execCtx)

  const logger = getLogger()

  // ===== 1. 事件与 payload 校验 =====
  if (execCtx.eventKind !== 'review_comment_created') {
    logger.info(`conversation: skip non review_comment event (${execCtx.eventKind})`)
    return
  }
  // REVIEW-015/016：改读归一化字段。原先直接读 GitHub 的 review comment payload
  // （action / pull_request / repository / diff_hunk），GitLab 的 diff discussion
  // note 在第一道校验就被拒。
  //
  // 「action != created」已在 ExecutionContext 构造阶段判掉。
  const commentRef = execCtx.comment
  if (commentRef == null || typeof commentRef.body !== 'string') {
    logger.warning('conversation: skip (missing comment body)')
    return
  }

  // ===== 2. 过滤 bot 自身评论（REVIEW-018）=====
  if (await isSelfAuthoredComment(execCtx, commentRef.body)) {
    logger.info('conversation: skip (comment from bot itself)')
    return
  }

  const pullNumber = execCtx.changeRequestId

  // 对话链查找需要「评论自身」的形状（沿 in_reply_to_id 上溯、按 path/line 匹配），
  // 由归一化字段重建，不再依赖平台 payload
  const comment = {
    id: commentRef.id,
    body: commentRef.body,
    path: commentRef.path ?? '',
    line: commentRef.line,
    user: {login: execCtx.actor.login}
  }

  inputs.comment = `${execCtx.actor.login || 'unknown'}: ${commentRef.body}`
  // GitLab 的 note payload 没有 diff_hunk，留空即可——少一段上下文，不影响对话
  inputs.diff = commentRef.diffHunk ?? ''
  inputs.filename = commentRef.path ?? ''

  // PR 基本信息改由 IGitPlatform 现查（payload 形状两个平台不同）
  try {
    const cr = await getPlatform().getChangeRequest(repoOwner, repoName, pullNumber)
    inputs.title = cr.title
    if (cr.body) {
      inputs.description = commenter.getDescription(cr.body)
    }
  } catch (e) {
    logger.warning(`conversation: failed to load change request details: ${String(e)}`)
  }

  // ===== 3. Thread 对话历史收集 =====
  const {chain: rawChain, topLevelComment} = await commenter.getCommentChain(pullNumber, comment)
  if (!topLevelComment) {
    logger.warning('conversation: cannot locate top-level comment, abort')
    return
  }

  // ===== 4. 追问意图识别（必须 @bot） =====
  if (
    !isFollowUpQuestion({
      commentBody: comment.body,
      // 作者判定已在上游完成（isSelfAuthoredComment），这里关掉 marker 兜底，
      // 否则用户「引用回复」后提问会被误判成 bot 文案
      authorIsBot: false,
      botCommentTags: []
    })
  ) {
    logger.info('conversation: not a follow-up question (no @mention), skip')
    return
  }

  // ===== 4. 权限校验（REVIEW-017）=====
  // 放在意图识别之后：无关评论不必为它多查一次权限 API
  let prAuthor = ''
  try {
    prAuthor = (await getPlatform().getChangeRequest(repoOwner, repoName, pullNumber)).author
  } catch (e) {
    logger.warning(`conversation: failed to resolve change request author: ${String(e)}`)
  }
  const perm = await canConverse(execCtx, prAuthor)
  if (!perm.allowed) {
    logger.info(`conversation: skip (${perm.reason})`)
    return
  }

  // ===== 5. 对话轮次上限控制 =====
  const turns = countBotTurns(rawChain)
  if (turns >= MAX_CONVERSATION_TURNS) {
    logger.info(`conversation: turn limit reached (${turns}/${MAX_CONVERSATION_TURNS})`)
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
    // base/head 同样改为现查：评论事件的 payload 在两个平台形状不同，
    // 而 execCtx 对评论事件本就不带 base/head（构造阶段固定留空）
    const cr = await getPlatform().getChangeRequest(repoOwner, repoName, pullNumber)
    const diffResult = await getPlatform().compareDiff(repoOwner, repoName, cr.baseSha, cr.headSha)
    const file = diffResult.files.find(f => f.filename === comment.path)
    if (file?.patch) {
      fileDiff = file.patch
    }
  } catch (e) {
    logger.warning(`conversation: failed to get file diff: ${e}, continue without it`)
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
    inputs.commentChain = truncateConversationChain(rawChain, Math.floor(MAX_CHAIN_CHARS / 2))
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
      tokens + fileDiffTokens * fileDiffCount <= options.heavyTokenLimits.requestTokens
    ) {
      tokens += fileDiffTokens * fileDiffCount
      inputs.fileDiff = fileDiff
    }
  }

  // 预算允许时补充 PR 精简摘要
  const summary = await commenter.findCommentWithTag(summarizeTag(), pullNumber)
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
    logger.warning('conversation: empty reply from model, skip posting')
    return
  }
  // 由我们用真实评论者用户名前缀回复（模型已被要求不要自行 @）。
  // 防御性去掉模型可能仍残留的开头 "@user"（历史 prompt 遗留），避免误链到真实账号 user。
  const cleanedReply = reply.replace(/^\s*@user[，,：:\s]*/i, '').trimStart()
  const authorLogin: string = comment.user?.login ?? ''
  const mention = authorLogin ? `@${authorLogin} ` : ''
  const quotedQuestion = comment.body
    .split('\n')
    .map((l: string) => `> ${l}`)
    .join('\n')
  await commenter.reviewCommentReply(
    pullNumber,
    topLevelComment,
    `${quotedQuestion}\n\n${mention}${cleanedReply}`
  )
  logger.info(
    `conversation: replied on PR #${pullNumber} thread (top-level comment ${topLevelComment.id})`
  )
}

/**
 * 把主评论区的 issue comment 列表组装为对话链字符串。
 *
 * 与 Commenter.composeCommentChain（行级）对齐：`login: body`，`\n---\n` 分隔。
 * 主评论区是扁平结构，这里按时间顺序（列表接口本身已按 created_at 升序返回）
 * 截止到「当前触发评论」为止，过滤掉空 body，避免把当前评论之后的内容也纳入历史。
 *
 * 纯函数，便于单测。
 */
export function composeIssueCommentChain(
  comments: Array<{id?: number; body?: string; user?: {login?: string}}>,
  currentCommentId: number
): string {
  const chain: string[] = []
  for (const c of comments) {
    const body = c.body ?? ''
    if (body.trim().length > 0) {
      chain.push(`${c.user?.login ?? 'unknown'}: ${body}`)
    }
    // 截止到当前触发评论（含），忽略其后的评论
    if (c.id === currentCommentId) {
      break
    }
  }
  return chain.join(CHAIN_SEPARATOR)
}

/**
 * 主评论区（issue_comment）对话式追问主入口。
 *
 * 仅处理 PR 主评论区的 issue_comment 事件（非代码行级）。由 command-handler.ts 在
 * 命令解析判定为 "fallback_conversation" 且事件为 issue_comment 时调用。
 *
 * 与行级对话（handleConversation）的差异：
 *   - 上下文是**整个 PR**（title/description/summary/整体 diff），而非单文件 diff hunk
 *   - 主评论区扁平无 thread → 用隐藏幂等标签防止连续提问时重复回帖
 *   - 无关问题由模型判定并友好婉拒（见 prompts.commentIssue）
 *
 * @param execCtx  - 平台无关执行上下文（ARCH-005：取代直接 import @actions/github）
 * @param heavyBot - 重量级模型，用于生成高质量回复
 * @param options  - 全局配置
 * @param prompts  - 提示词模板
 */
export const handleIssueConversation = async (
  execCtx: ExecutionContext,
  heavyBot: Bot,
  options: Options,
  prompts: Prompts
): Promise<void> => {
  const commenter: Commenter = new Commenter()
  const inputs: Inputs = new Inputs()
  // 按**最后**一个斜杠切：GitLab 子组项目是 group/subgroup/project，
  // split('/') 取前两段会把 owner/repo 切错（repoCoordsOf 的既有语义）
  const {owner: repoOwner, repo: repoName} = repoCoordsOf(execCtx)
  const logger = getLogger()

  // ===== 1. 事件与 payload 校验 =====
  if (execCtx.eventKind !== 'comment_created') {
    logger.info(`issue-conversation: skip non issue_comment event (${execCtx.eventKind})`)
    return
  }
  // REVIEW-016：改读归一化字段。原先直接读 GitHub payload（`payload.action`、
  // `payload.issue.pull_request`），GitLab 的 note 事件在第一道校验就被拒——
  // 对话功能在 GitLab 上完全不可用。
  //
  // 「action != created」和「评论挂在非 PR issue 上」这两条判断已经在
  // ExecutionContext 构造阶段做掉（抛 ignorable_event），走到这里的一定是新建的
  // PR/MR 顶层评论，不必重复判断。
  const commentRef = execCtx.comment
  if (commentRef == null || typeof commentRef.body !== 'string') {
    logger.warning('issue-conversation: skip (missing comment body)')
    return
  }
  // 收窄 body 类型：CommentRef.body 是可选的（GitLab 早期未填充），上面已校验
  const comment = {id: commentRef.id, body: commentRef.body}

  // ===== 2. 过滤 bot 自身评论（REVIEW-018）=====
  if (await isSelfAuthoredComment(execCtx, comment.body)) {
    logger.info('issue-conversation: skip (comment from bot itself)')
    return
  }

  // ===== 3. 追问意图识别（必须 @bot） =====
  if (
    !isFollowUpQuestion({
      commentBody: comment.body,
      // 作者判定已在上游完成（isSelfAuthoredComment），这里关掉 marker 兜底，
      // 否则用户「引用回复」后提问会被误判成 bot 文案
      authorIsBot: false,
      botCommentTags: []
    })
  ) {
    logger.info('issue-conversation: not a follow-up question (no @mention), skip')
    return
  }

  const pullNumber = execCtx.changeRequestId

  // ===== 4. 权限校验（REVIEW-017）=====
  let prAuthor = ''
  try {
    prAuthor = (await getPlatform().getChangeRequest(repoOwner, repoName, pullNumber)).author
  } catch (e) {
    logger.warning(`issue-conversation: failed to resolve change request author: ${String(e)}`)
  }
  const issuePerm = await canConverse(execCtx, prAuthor)
  if (!issuePerm.allowed) {
    logger.info(`issue-conversation: skip (${issuePerm.reason})`)
    return
  }

  // ===== 4. 幂等去重（连续提问不丢/不重复的关键） =====
  const allComments = await commenter.listComments(pullNumber)
  const replyTagVariants = issueConvReplyTagVariants(comment.id)
  const alreadyReplied = allComments.some((c: any) => hasStateMarker(c.body, replyTagVariants))
  if (alreadyReplied) {
    logger.info(`issue-conversation: skip duplicate reply for comment ${comment.id}`)
    return
  }

  // ===== 5. 对话历史收集 + 轮次上限 =====
  const rawChain = composeIssueCommentChain(allComments, comment.id)
  const turns = countBotTurns(rawChain)
  if (turns >= MAX_CONVERSATION_TURNS) {
    logger.info(`issue-conversation: turn limit reached (${turns}/${MAX_CONVERSATION_TURNS})`)
    await postIssueReply(
      commenter,
      pullNumber,
      comment,
      execCtx.actor.login,
      `本话题的自动对话轮次已达上限（${MAX_CONVERSATION_TURNS} 轮）。如需继续深入，请新开一条评论或联系人工 reviewer。`
    )
    return
  }

  // ===== 6. 上下文组装（PR 级） =====
  // 标题/描述改由 IGitPlatform 现查：payload 形状两个平台不同，而下面本来就要
  // 调 getChangeRequest 拿 diff，顺带取回即可，不多一次 API
  inputs.comment = `${execCtx.actor.login || 'unknown'}: ${comment.body}`
  inputs.commentChain = truncateConversationChain(rawChain)

  // ===== 7. 拉取整个 PR 的 diff（可选，受 token 预算约束） =====
  let prDiff = ''
  try {
    const platform = getPlatform()
    const cr = await platform.getChangeRequest(repoOwner, repoName, pullNumber)
    inputs.title = cr.title
    if (cr.body) {
      inputs.description = commenter.getDescription(cr.body)
    }
    const diffResult = await platform.compareDiff(repoOwner, repoName, cr.baseSha, cr.headSha)
    prDiff = diffResult.files
      .map(f => (f.patch ? `--- ${f.filename}\n${f.patch}` : ''))
      .filter(s => s.length > 0)
      .join('\n\n')
  } catch (e) {
    logger.warning(`issue-conversation: failed to get PR diff: ${e}, continue without it`)
  }

  // ===== 8. Token 预算内打包上下文 =====
  let tokens = getTokenCount(prompts.renderCommentIssue(inputs))
  if (tokens > options.heavyTokenLimits.requestTokens) {
    // 对话链可能过长，进一步压缩后重试一次
    inputs.commentChain = truncateConversationChain(rawChain, Math.floor(MAX_CHAIN_CHARS / 2))
    tokens = getTokenCount(prompts.renderCommentIssue(inputs))
  }
  if (tokens > options.heavyTokenLimits.requestTokens) {
    await postIssueReply(
      commenter,
      pullNumber,
      comment,
      execCtx.actor.login,
      '无法回复该评论：关联的上下文过大，超出了模型的 token 限制。'
    )
    return
  }

  // 预算允许时补充整个 PR diff
  if (prDiff.length > 0) {
    const fileDiffCount = prompts.commentIssue.split('$file_diff').length - 1
    const prDiffTokens = getTokenCount(prDiff)
    if (
      fileDiffCount > 0 &&
      tokens + prDiffTokens * fileDiffCount <= options.heavyTokenLimits.requestTokens
    ) {
      tokens += prDiffTokens * fileDiffCount
      inputs.fileDiff = prDiff
    }
  }

  // 预算允许时补充 PR 精简摘要
  const summary = await commenter.findCommentWithTag(summarizeTag(), pullNumber)
  if (summary) {
    const shortSummary = commenter.getShortSummary(summary.body)
    const shortSummaryTokens = getTokenCount(shortSummary)
    if (tokens + shortSummaryTokens <= options.heavyTokenLimits.requestTokens) {
      tokens += shortSummaryTokens
      inputs.shortSummary = shortSummary
    }
  }

  // ===== 9. LLM 对话推理 + 发布回复 =====
  const [reply] = await heavyBot.chat(prompts.renderCommentIssue(inputs), {})
  if (!reply) {
    logger.warning('issue-conversation: empty reply from model, skip posting')
    return
  }
  const cleanedReply = reply.replace(/^\s*@user[，,：:\s]*/i, '').trimStart()
  await postIssueReply(commenter, pullNumber, comment, execCtx.actor.login, cleanedReply)
  logger.info(`issue-conversation: replied on PR #${pullNumber} main thread`)
}

/**
 * 在 PR 主评论区发布一条美观的对话回复：
 *   头部图标 + 引用用户原问题 + @提及 + 答案正文 + 隐藏幂等标签。
 *
 * 幂等标签使回复能稳定对应到触发它的提问（连续提问场景下不丢不重）。
 */
async function postIssueReply(
  commenter: Commenter,
  pullNumber: number,
  comment: {id: number; body: string},
  authorLogin: string,
  body: string
): Promise<void> {
  // 作者显式传入而不是从 comment.user 读：顶层对话的评论对象现在来自
  // ExecutionContext 的归一化字段，那里作者在 execCtx.actor 上（REVIEW-016）
  const mention = authorLogin ? `@${authorLogin} ` : ''
  const quotedQuestion = comment.body
    .split('\n')
    .map((l: string) => `> ${l}`)
    .join('\n')
  const message = `${getCommentGreeting()}

${quotedQuestion}

${mention}${body}

${commentReplyTag()}
${buildIssueConvReplyTag(comment.id)}
`
  await commenter.create(message, pullNumber)
}
