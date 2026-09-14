/**
 * gitlab-note-idempotency.ts - Note Hook 幂等 marker 的存储与接线（STATE-005 / EVENT-020/021）
 *
 * `gitlab-note-hook-rules.ts` 的 `buildNoteIdempotencyKey()` 只生成幂等键字符串，
 * 不做任何 IO——本文件负责"这个键存在哪、怎么查、怎么写"。
 *
 * 设计要点：
 *
 * - **独立的专用 note，不复用 summary note。** `commenter.ts` 的
 *   `addReviewedCommitId()` 系列函数把"已审查 commit ID"写进 summary
 *   comment（`summarizeTag()` 定位），而 `codeReview()` 每次全量/增量审查都会
 *   `comment(..., 'replace')` 整体重写这条评论正文。如果把 Note Hook 幂等键也塞
 *   进同一条评论，就必须让 `review.ts` 的每一处重写逻辑都额外小心保留这段
 *   marker，任何一处遗漏都会静默清空已处理记录，导致 Note Hook 事件重放。
 *   用一条完全独立的 note（只由本文件读写，`codeReview()` 从不触碰）从架构上
 *   排除这个耦合——这也正是 TODO 文档原文"GitLab **reviewer note** 保存已处理
 *   Note Hook 幂等键 marker；自动 MR 审查**继续使用** summary note 中的
 *   reviewed SHA marker"这句话里，特意把两种 marker 分开表述的原因。
 * - **只用 `getPlatform()`，不经过 `Commenter` 类。** `Commenter` 依赖
 *   `getExecCtx()` 且承载大量 GitHub 历史逻辑；本文件只需要顶层 note 的
 *   增删查改，直接用 `IGitPlatform` 更少牵连、更容易独立测试。
 * - **找不到/API 失败时的语义是"未处理过"，不是抛错。** 幂等检查的目的是防止
 *   重复调用模型或重复回复，不是新增一个可能 fail closed 拦住正常审查的关卡；
 *   查询失败时宁可退化为"当作没处理过"重新走一次（模型调用/回复本身若真的
 *   已经完成过，其下游逻辑仍有各自的去重保护），也不能因为这层账本读取失败就
 *   让整个事件处理停摆。
 */
import {getPlatform} from './platform/git-platform'
import {getLogger} from './platform/logger'
import {bodyHasMarker, locateMarkerBlock, stateMarker} from './state-markers'

const MARKER_COMMENT_HEADER =
  '_Internal bookkeeping by AI Reviewer — tracks which Note Hook events have already been ' +
  'processed to avoid duplicate replies. Safe to ignore._'

/** 从 marker 区块正文中提取已记录的幂等键列表 */
export function extractProcessedKeys(body: string): string[] {
  const block = locateMarkerBlock(body, 'noteHookMarkersStart', 'noteHookMarkersEnd')
  if (block == null) return []
  const inner = body.slice(block.start + block.startTag.length, block.end)
  return inner
    .split('<!--')
    .map(s => s.replace('-->', '').trim())
    .filter(s => s !== '')
}

/**
 * 把一个幂等键追加进 marker 区块；区块不存在则新建（连同人类可读的说明头）。
 * 键已存在时原样返回，调用方据此判断是否需要真的发起一次写请求。
 */
export function appendProcessedKey(body: string, key: string): string {
  const block = locateMarkerBlock(body, 'noteHookMarkersStart', 'noteHookMarkersEnd')
  if (block == null) {
    const start = stateMarker('noteHookMarkersStart')
    const end = stateMarker('noteHookMarkersEnd')
    const base = body.trim() === '' ? MARKER_COMMENT_HEADER : body.trim()
    return `${base}\n\n${start}\n<!-- ${key} -->\n${end}`
  }
  if (extractProcessedKeys(body).includes(key)) return body
  const inner = body.slice(block.start + block.startTag.length, block.end)
  return (
    body.slice(0, block.start + block.startTag.length) +
    inner +
    `<!-- ${key} -->\n` +
    body.slice(block.end)
  )
}

interface MarkerComment {
  id: number
  body: string
}

async function findMarkerComment(
  owner: string,
  repo: string,
  changeRequestId: number
): Promise<MarkerComment | null> {
  const comments = await getPlatform().listComments(owner, repo, changeRequestId)
  for (const c of comments) {
    if (bodyHasMarker(c.body, 'noteHookMarkersStart')) {
      return {id: c.id, body: c.body ?? ''}
    }
  }
  return null
}

/**
 * 查询给定幂等键是否已经处理过（EVENT-021 的判断依据）。
 *
 * 找不到记账 note、或查询本身失败时返回 false（"未处理过"）——见文件头说明，
 * 这里刻意不 fail closed。
 */
export async function hasNoteBeenProcessed(
  owner: string,
  repo: string,
  changeRequestId: number,
  idempotencyKey: string
): Promise<boolean> {
  try {
    const comment = await findMarkerComment(owner, repo, changeRequestId)
    if (comment == null) return false
    return extractProcessedKeys(comment.body).includes(idempotencyKey)
  } catch (e) {
    getLogger().warning(`gitlab-note-idempotency: failed to check processed key: ${String(e)}`)
    return false
  }
}

/**
 * 把幂等键记为已处理（在成功完成一次 Note Hook 事件处理之后调用）。
 *
 * 写入失败只记警告，不向上抛错——记账失败不应该让已经成功的事件处理结果
 * （已调用模型、已发布回复）反过来显示为失败。代价是这次记账没生效，下次
 * 重复投递可能被重新处理一次，比起让成功的操作显示失败，这是更安全的一侧。
 */
export async function markNoteAsProcessed(
  owner: string,
  repo: string,
  changeRequestId: number,
  idempotencyKey: string
): Promise<void> {
  const platform = getPlatform()
  try {
    const existing = await findMarkerComment(owner, repo, changeRequestId)
    if (existing == null) {
      const body = appendProcessedKey('', idempotencyKey)
      await platform.createComment(owner, repo, changeRequestId, body)
      return
    }
    const updated = appendProcessedKey(existing.body, idempotencyKey)
    if (updated === existing.body) return // 已经记过，避免无意义的写请求
    await platform.updateComment(owner, repo, existing.id, updated)
  } catch (e) {
    getLogger().warning(`gitlab-note-idempotency: failed to record processed key: ${String(e)}`)
  }
}
