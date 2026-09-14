/**
 * review-idempotency.ts — 自动审查的重复投递判定（STATE-013/014/015）
 *
 * 原先这套判定只存在于 `gitlab-mr-idempotency.ts`，且只在 GitLab trigger 入口
 * 调用。结果是同一条规则只覆盖了一半：
 *
 *   GitLab job Retry / webhook 重投  → trigger 入口拦住（EVENT-013，已真实验证）
 *   GitHub workflow rerun            → **没有任何拦截**
 *
 * GitHub rerun 的后果不是「多打一条日志」。`review.ts` 决定 diff 起点时，
 * 若最高已审 commit 恰好等于当前 HEAD，会走「已是最新」分支回退到 base commit
 * 重跑**整份** diff——于是一次 rerun 就是一轮完整的模型调用，外加重新发布摘要与
 * 行级评论。这正是 STATE-013 要防的。
 *
 * 所以判定挪到平台无关模块，由**共享分发层**（orchestrator.dispatchEvent）统一
 * 把关，两个平台走同一条规则（STATE-015）。GitLab trigger 入口保留它自己那道
 * 前置检查：那道更早，能在构造 bot、进入编排之前就退出，省掉整段初始化，
 * 且它的日志格式已经过真实环境验证。两处调用的是同一个函数，不存在规则漂移。
 *
 * ## 判定依据
 *
 * summary comment 里的 reviewed-commit-ids marker——`review.ts` 每次成功审查后
 * 都会把 `pr.head.sha` 写进去（`commenter.addReviewedCommitId()`），这是两个平台
 * 共用的既有机制。不新建独立存储：再发明一套只会产生两份可能互相不一致的状态。
 *
 * ## 查询失败按「未审查过」处理
 *
 * 这层防的是「重复投递浪费一次模型调用」，不是安全边界。查询失败时宁可再审一次
 * （`review.ts` 自身的增量逻辑仍会尽量减少重复工作），也不能因为这层读取失败就
 * 让正常审查停摆。
 *
 * 注意与 REVIEW-003 的分工：那条防的是「审查跑到一半 HEAD 变了，别写旧结果」
 * （fail closed）；这条防的是「同一个 HEAD 被投递了两次，别重跑」（fail open）。
 * 方向相反是有意的——前者错了会写脏数据，后者错了只是多花一次钱。
 */
import {getPlatform} from './platform/git-platform'
import {getLogger} from './platform/logger'
import {bodyHasMarker} from './state-markers'
import {Commenter, isOwnAuthor} from './commenter'

/**
 * 这个 headSha 是否已经被自动审查覆盖过。
 *
 * 只用 `getPlatform()` 和 `Commenter` 的纯字符串方法，不依赖 execCtx 就绪——
 * GitLab trigger 在 `setExecCtx()` 之前就要调它。`getReviewedCommitIds()` 只解析
 * 传入正文，不 touch `this`/execCtx；而 `findCommentWithTag()` 依赖模块级 repo
 * 绑定，所以查找 summary comment 这一步直接走 `getPlatform().listComments()`。
 */
export async function hasHeadBeenReviewed(
  owner: string,
  repo: string,
  changeRequestId: number,
  headSha: string
): Promise<boolean> {
  // 没有基准就无从判断。空 headSha 判为「未审查过」，与查询失败同口径。
  if (headSha === '') return false

  try {
    const comments = await getPlatform().listComments(owner, repo, changeRequestId)

    // 只认 reviewer 自己发布的 summary。
    //
    // marker 格式和 HEAD SHA 都是公开信息——任何能评论的人都能贴一条带正确
    // marker 和当前 SHA 的评论。不校验作者的话，这就是一个**任意用户可触发的
    // 审查静默开关**：伪造一条，共享分发层立刻判定「审过了」并跳过整轮审查，
    // 而且日志里看起来完全正常。
    //
    // 身份确认不了时不采信这条评论（继续审查）。这与本模块整体的 fail open 一致：
    // 宁可多审一次，也不能被一条来路不明的评论关掉审查。
    for (const c of comments) {
      if (!bodyHasMarker(c.body, 'summarize')) continue
      if ((await isOwnAuthor(c.author)) !== true) continue
      if (new Commenter().getReviewedCommitIds(c.body ?? '').includes(headSha)) return true
    }
    return false
  } catch (e) {
    getLogger().warning(`review-idempotency: failed to check reviewed headSha: ${String(e)}`)
    return false
  }
}

/** 幂等键。只用于日志与排查，判定本身不依赖它 */
export function buildReviewIdempotencyKey(
  platform: string,
  projectId: string,
  changeRequestId: number,
  headSha: string
): string {
  return `${platform}:${projectId}:${changeRequestId}:head:${headSha}`
}
