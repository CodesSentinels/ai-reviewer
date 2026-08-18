/**
 * gitlab-mr-idempotency.ts - MR 自动审查幂等判断（EVENT-013）
 *
 * `gitlab-mr-hook-rules.ts` 的 `buildMrIdempotencyKey()` 只生成
 * `gitlab:{project_id}:{mr_iid}:head:{head_sha}` 这个幂等键字符串，供日志/排查
 * 使用；本文件负责"这个 headSha 到底判没判过"的真正判断。
 *
 * 设计要点：
 *
 * - **复用 summary note 里已有的 reviewed-commit-ids marker，不新建独立存储。**
 *   `review.ts` 每次成功审查后已经会把 `pr.head.sha` 写进 summary comment 的
 *   `commit_ids_reviewed` 区块（`commenter.addReviewedCommitId()`），这是
 *   GitHub/GitLab 共用的既有机制。TODO 文档原文"MR 自动审查幂等键...并与
 *   summary note 中的 reviewed SHA marker 一起判断"明确要求接到这一套上，而不是
 *   像 Note Hook（`gitlab-note-idempotency.ts`）那样另起一条独立记账 note——
 *   两者场景不同：Note Hook 的幂等键要按事件 note_id 逐条区分，天然不适合塞进
 *   会被整体重写的 summary comment；MR 幂等只关心"这个 headSha 审过没有"，
 *   而这正是 summary comment 已经在维护的信息，重新发明一套只会产生两份可能
 *   互相不一致的状态。
 * - **只用 `getPlatform()` + `Commenter` 的纯字符串方法，不依赖 execCtx 已经
 *   ready。** 本文件在 `gitlab-trigger.ts` 里于 `runOrchestrator()`（真正
 *   `setExecCtx()` 的地方）之前调用，这时候 `getExecCtx()` 还不可用。
 *   `Commenter.getReviewedCommitIds()` 只解析传入的字符串正文，不touch
 *   `this`/`execCtx`，可以在 execCtx 就绪前安全调用；但 `Commenter.
 *   findCommentWithTag()`/`listComments()` 依赖模块级 `repo` 绑定，同样不能用，
 *   所以查找 summary comment 这一步改用 `getPlatform().listComments()` 直接查。
 * - **找不到/查询失败时的语义是"未审查过"，不是抛错。** 与 Note Hook 幂等
 *   同样的理由：这里防的是"重复投递浪费一次模型调用"，不是安全边界；查询失败
 *   时宁可再审一次（下游 review.ts 自身的增量逻辑仍会尽量减少重复工作），也不能
 *   因为这层读取失败就让正常的审查停摆。
 */
import {getPlatform} from './platform/git-platform'
import {getLogger} from './platform/logger'
import {bodyHasMarker} from './state-markers'
import {Commenter} from './commenter'

/**
 * 判断给定 MR 的 headSha 是否已经被自动审查过（EVENT-013 的判断依据）。
 *
 * 读取 summary comment（`summarizeTag()` 标识）里既有的 reviewed-commit-ids
 * marker，检查 headSha 是否已在其中——这条 marker 由 `review.ts` 每次成功审查
 * 后写入，语义与"这个 commit 是否已经被增量审查覆盖过"完全一致。
 */
export async function hasHeadBeenReviewed(
  owner: string,
  repo: string,
  changeRequestId: number,
  headSha: string
): Promise<boolean> {
  try {
    const comments = await getPlatform().listComments(owner, repo, changeRequestId)
    const summaryComment = comments.find(c => bodyHasMarker(c.body, 'summarize'))
    if (summaryComment == null) return false
    const reviewedIds = new Commenter().getReviewedCommitIds(summaryComment.body ?? '')
    return reviewedIds.includes(headSha)
  } catch (e) {
    getLogger().warning(`gitlab-mr-idempotency: failed to check reviewed headSha: ${String(e)}`)
    return false
  }
}
