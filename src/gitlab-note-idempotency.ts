/**
 * gitlab-note-idempotency.ts - Note Hook 幂等标记的存储与接线（STATE-005 / EVENT-020/021）
 *
 * `gitlab-note-hook-rules.ts` 的 `buildNoteIdempotencyKey()` 只生成幂等键字符串，
 * 不做任何 IO——本文件负责"处理过的标记记在哪、怎么查、怎么写"。
 *
 * 设计要点：
 *
 * - **标记 = bot 在触发命令的那条 note 上添加的「完成」表情。** 收到命令时
 *   bot 先加 ACK 表情（默认 🚀），处理成功后再加完成表情（默认 👍）。标记与
 *   note 一一对应，不需要额外的评论或描述区块，对用户而言还是一个直观的
 *   「已收到 → 已完成」信号。
 *
 *   此前的做法是在 MR 上维护一条独立的「记账评论」
 *   （`_Internal bookkeeping by AI Reviewer …_`）。它避开了与 summary note 的
 *   耦合（`codeReview()` 每次会整体重写 summary），但对用户可见、干扰阅读。
 *   表情标记同样不与任何会被重写的文本耦合。
 * - **只认 bot 自己加的完成表情。** 其他人也可以在 note 上点同一个表情，
 *   判断时按添加者匹配 bot 身份；身份未知时一律视为"未处理"。
 * - **完成表情与 ACK 表情必须不同。** ACK 在处理前就加上了；两者相同时，一次
 *   失败的处理也会被误认为已完成，重试会被拦住。ACK 可配置，所以完成表情按
 *   ACK 取值避让（见 completionReactionFor）。
 * - **兼容旧的记账评论（只读）。** 已部署过旧版本的 MR 上仍有记账评论，其中
 *   记录的 note 继续视为已处理；新版本不再写入。
 * - **找不到/API 失败时的语义是"未处理过"，不是抛错。** 幂等检查的目的是防止
 *   重复调用模型或重复回复，不是新增一个可能 fail closed 拦住正常处理的关卡；
 *   查询失败时宁可退化为"当作没处理过"重新走一次（下游逻辑仍有各自的去重
 *   保护），也不能因为标记读取失败就让整个事件处理停摆。
 * - **只用 `getPlatform()`，不经过 `Commenter` 类。**
 */
import {getPlatform} from './platform/git-platform'
import {getLogger} from './platform/logger'
import type {ReactionContent} from './platform/git-platform'
import {bodyHasMarker, locateMarkerBlock} from './state-markers'

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

/** 触发命令的 note 及其幂等键 */
export interface NoteRef {
  owner: string
  repo: string
  changeRequestId: number
  noteId: number
  idempotencyKey: string
}

/** 完成表情：默认 👍；ACK 恰好配置成 👍 时改用 🎉，保证两者可区分 */
export function completionReactionFor(ackReaction: string): ReactionContent {
  return ackReaction === '+1' ? 'hooray' : '+1'
}

/**
 * 查询 note 是否已经处理过（EVENT-021 的判断依据）：bot 在该 note 上加过完成
 * 表情，或旧版记账评论里记录过它的幂等键。
 *
 * 各项查询失败都按"未处理过"处理，不向上抛——见文件头说明。
 */
export async function hasNoteBeenProcessed(
  ref: NoteRef,
  botLogins: string[],
  completion: ReactionContent
): Promise<boolean> {
  const bots = new Set(botLogins.map(l => l.toLowerCase()).filter(l => l !== ''))
  if (bots.size > 0) {
    try {
      const reactions = await getPlatform().listReactions(
        ref.owner,
        ref.repo,
        ref.changeRequestId,
        ref.noteId,
        'issue_comment'
      )
      if (reactions.some(r => r.content === completion && bots.has(r.userLogin.toLowerCase()))) {
        return true
      }
    } catch (e) {
      getLogger().warning(`gitlab-note-idempotency: failed to list reactions: ${String(e)}`)
    }
  }

  // 兼容旧版：MR 上的记账评论
  try {
    const comment = await findMarkerComment(ref.owner, ref.repo, ref.changeRequestId)
    return comment != null && extractProcessedKeys(comment.body).includes(ref.idempotencyKey)
  } catch (e) {
    getLogger().warning(`gitlab-note-idempotency: failed to check legacy ledger: ${String(e)}`)
    return false
  }
}

/**
 * 标记 note 已处理：在 note 上添加完成表情（在成功完成一次 Note Hook 事件处理
 * 之后调用）。
 *
 * 写入失败只记警告，不向上抛错——标记失败不应该让已经成功的事件处理结果
 * （已调用模型、已发布回复）反过来显示为失败。代价是下次重复投递可能被重新
 * 处理一次，比起让成功的操作显示失败，这是更安全的一侧。
 */
export async function markNoteAsProcessed(
  ref: NoteRef,
  completion: ReactionContent
): Promise<void> {
  try {
    await getPlatform().addReaction(
      ref.owner,
      ref.repo,
      ref.changeRequestId,
      ref.noteId,
      completion,
      'issue_comment'
    )
  } catch (e) {
    getLogger().warning(`gitlab-note-idempotency: failed to mark note as processed: ${String(e)}`)
  }
}
