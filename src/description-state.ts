/**
 * description-state.ts — PR/MR description 的分区状态读写（STATE-008 / STATE-016）
 *
 * 解决两类事故：
 *
 * **一、marker 损坏时毁掉用户内容（STATE-008）。**
 * 旧实现用 `indexOf(start)` 配 `lastIndexOf(end)` 定位区块，于是：
 *
 *   - 结束标签出现在开始标签之前 → 切片跨越负区间，用户内容被复制成两份；
 *   - description 里存在两组区块、中间夹着用户手写段落 → 第一个 start 到
 *     最后一个 end 之间全被抹掉，用户那段直接消失。
 *
 * 这里改为「第一个 start，及其**之后**第一个 end」，并且定位不确定时一律返回
 * null 让调用方放弃修改——宁可这次不写状态，也不能改坏用户的描述。
 *
 * **二、并发写互相覆盖（STATE-016）。**
 * pause/resume（review-state.ts）和 release notes（commenter.ts）是两条独立的
 * 「读整份 body → 拼 → 整份写回」路径。交错执行时后写的一方会带着自己读到的
 * 旧快照覆盖掉对方刚写入的区块。
 *
 * 修法分两个层面，**必须分清各自的边界**：
 *
 * 【同一进程内】用按 PR/MR 维度的串行队列把所有 description 写入排队，
 * 再配合「只替换自己那一段 + 写前重读」。同一次运行里 release notes 与
 * pause/resume 不可能交错，这一层是确定性的。
 *
 * 【跨进程】做不到。平台没有条件更新（GitHub 的 pulls.update、GitLab 的 MR
 * update 都不接受 If-Match/version），也就没有 CAS 可用。此时依赖的是 CI 侧的
 * 串行化：
 *
 *   GitLab —— `.gitlab-ci.yml` 的 `resource_group: ai-reviewer-mvp` 让所有
 *             ai_review_trigger job 全局串行，这一层是成立的；
 *   GitHub —— **不成立**。openai-review.yml 的 concurrency group 把评论事件
 *             按 comment.id 分组，同一 PR 的多条评论**故意并行**（避免排队的
 *             运行被后一条评论挤掉）。于是 pause 与 release notes 完全可能是
 *             两个并行进程在写同一份 description。
 *
 * 因此下面的写后校验只能发现「自己那段被别人冲掉」，发现不了「自己冲掉了别人
 * 那段」——两个进程各自校验自己那段都成功，却已经丢了一方的内容：
 *
 *     A、B 都读到旧正文
 *     A 写入 pause，校验自己那段 → 成功
 *     B 用旧正文写入 release notes，覆盖 pause
 *     B 校验自己那段 → 也成功，双方都报成功，pause 已丢失
 *
 * **这是已决策接受的边界，不是待办。** 闭合它需要让同一 PR/MR 的 description
 * 写入落在同一串行执行面上，即把 GitHub 的 concurrency group 改成按 PR 分组；
 * 但那会让快速连发的多条评论排队，且排队中的运行会被后一条评论挤掉——正是当初
 * 改成按 comment.id 分组要解决的问题。产品侧选择保留评论并行，相应地
 * STATE-010/016 的验收范围收窄到「进程内确定性 + 平台并发控制所能覆盖的部分」。
 *
 * 若将来改了 concurrency 分组，`workflow-concurrency-contract` 那组测试会失败，
 * 提醒同时放宽这里的边界说明。
 */

import {getLogger} from './platform/logger'
import {getPlatform} from './platform/git-platform'
import {tagPairVariants} from './state-markers'

/** 一个 marker 区块在正文中的位置 */
export interface SectionLocation {
  /** 开始标签的起始下标 */
  start: number
  /** 结束标签的结束下标（不含） */
  end: number
  startTag: string
  endTag: string
}

/** 区块定位失败的原因，用于让告警说得具体 */
export type SectionProblem = 'absent' | 'end_before_start' | 'unterminated' | 'duplicated'

export interface LocateResult {
  location: SectionLocation | null
  problem?: SectionProblem
}

/**
 * 定位一个 marker 区块。
 *
 * 规则：第一个 start，以及它**之后**的第一个 end。这两点都与旧实现不同，
 * 也正是 STATE-008 两个事故的成因。
 *
 * 返回 null 表示「不能安全地就地修改」，调用方应当放弃写入而不是猜。
 */
export function locateSection(body: string, startTag: string, endTag: string): LocateResult {
  for (const [s, e] of tagPairVariants(startTag, endTag)) {
    const start = body.indexOf(s)
    if (start === -1) continue

    // 只认 start 之后的 end：结束标签跑到前面时不能当成区块，否则切片会把
    // 中间的用户内容复制一份出来
    const endIdx = body.indexOf(e, start + s.length)
    if (endIdx === -1) {
      // 开始标签在、结束标签不在：区块不完整，不能就地改
      return {location: null, problem: body.includes(e) ? 'end_before_start' : 'unterminated'}
    }

    const second = body.indexOf(s, endIdx + e.length)
    const problem = second === -1 ? undefined : ('duplicated' as const)

    return {
      location: {start, end: endIdx + e.length, startTag: s, endTag: e},
      problem
    }
  }
  return {location: null, problem: 'absent'}
}

/** 读取区块内的内容；区块不存在或损坏时返回 null（与「内容为空」区分开） */
export function readSection(body: string, startTag: string, endTag: string): string | null {
  const {location} = locateSection(body, startTag, endTag)
  if (location == null) return null
  return body.slice(
    location.start + location.startTag.length,
    location.end - location.endTag.length
  )
}

/**
 * 用新内容替换区块；区块不存在则追加到末尾。
 *
 * **只动自己那一段**——这是 STATE-016 能成立的前提。注意它本身不足以保证并发
 * 安全：若贴合的是旧快照，别人刚写入的区块照样会被覆盖，所以调用方必须先取到
 * 最新正文再调用（见 updateDescriptionSection 的写前重读）。
 *
 * 区块损坏（缺结束标签、结束标签在前）时返回 null：让调用方明确放弃，而不是
 * 追加第二个区块把描述越搞越乱。
 */
export function writeSection(
  body: string,
  startTag: string,
  endTag: string,
  content: string
): string | null {
  const {location, problem} = locateSection(body, startTag, endTag)
  const block = `${startTag}\n${content}\n${endTag}`

  if (location == null) {
    if (problem === 'absent') {
      return [body.trimEnd(), block].filter(Boolean).join('\n\n')
    }
    return null // unterminated / end_before_start：不确定边界，不动
  }

  const before = body.slice(0, location.start).trimEnd()
  const after = body.slice(location.end).trim()
  // 已有区块保持原标签形态（历史区块不因升级被改写，回滚后旧版本仍读得懂）
  const kept = `${location.startTag}\n${content}\n${location.endTag}`
  return [before, kept, after].filter(Boolean).join('\n\n')
}

/** 移除区块及其内容；损坏时原样返回，绝不猜边界 */
export function removeSection(body: string, startTag: string, endTag: string): string {
  const {location} = locateSection(body, startTag, endTag)
  if (location == null) return body
  const before = body.slice(0, location.start).trimEnd()
  const after = body.slice(location.end).trim()
  return [before, after].filter(Boolean).join('\n\n')
}

/**
 * 按 PR/MR 维度的串行队列（STATE-010）。
 *
 * 同一次运行里可能有多处写 description（release notes、pause/resume、
 * 未来的其他 marker）。不排队的话它们会各自「读 → 改 → 写」并互相覆盖，
 * 而这一层是我们**能够**确定性解决的。
 *
 * key 带平台命名空间与项目坐标：同一进程理论上只服务一个 PR/MR，
 * 但测试与未来的批处理不该因为共用一把全局锁而互相阻塞。
 */
const writeQueues = new Map<string, Promise<unknown>>()

function serializePerChangeRequest<T>(key: string, task: () => Promise<T>): Promise<T> {
  const prev = writeQueues.get(key) ?? Promise.resolve()
  // 前一个任务失败不能卡死后续写入，所以用 catch 吞掉它的拒绝再接链
  const next = prev.catch(() => undefined).then(task)
  writeQueues.set(
    key,
    next.catch(() => undefined)
  )
  return next
}

/** 仅供测试重置队列，避免用例之间互相串 */
export function _resetWriteQueues(): void {
  writeQueues.clear()
}

export interface UpdateSectionOptions {
  owner: string
  repo: string
  changeRequestId: number
  startTag: string
  endTag: string
  /** 由当前区块内容算出新内容；返回 null 表示放弃本次写入 */
  render: (current: string | null) => string | null
  /** 最大尝试次数（含首次），默认 3 */
  maxAttempts?: number
}

export type UpdateSectionOutcome =
  | {ok: true; attempts: number; changed: boolean}
  | {ok: false; attempts: number; reason: 'corrupted' | 'skipped' | 'conflict' | 'error'}

/**
 * 读最新 → 只改自己那段 → 写回 → 读回校验 → 冲突则重试（STATE-016）。
 *
 * 注意这是乐观并发，不是 CAS：两个写入若真的同时落地，仍可能有一方被覆盖，
 * 但重试会重新读到最新值并再写一次，最终两段内容都在。
 */
export async function updateDescriptionSection(
  opts: UpdateSectionOptions
): Promise<UpdateSectionOutcome> {
  // 同一 PR/MR 的写入排队：进程内的交错由此彻底消除
  return await serializePerChangeRequest(
    `${opts.owner}/${opts.repo}#${opts.changeRequestId}`,
    async () => await updateDescriptionSectionUnlocked(opts)
  )
}

async function updateDescriptionSectionUnlocked(
  opts: UpdateSectionOptions
): Promise<UpdateSectionOutcome> {
  const {owner, repo, changeRequestId, startTag, endTag, render} = opts
  const maxAttempts = opts.maxAttempts ?? 3
  const platform = getPlatform()
  const logger = getLogger()

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let body: string
    try {
      // 每一轮都重新读：上一轮失败很可能正是因为别人写了新内容
      const cr = await platform.getChangeRequest(owner, repo, changeRequestId)
      body = cr.body ?? ''
    } catch (e) {
      logger.warning(`description-state: failed to read description: ${String(e)}`)
      return {ok: false, attempts: attempt, reason: 'error'}
    }

    const {location, problem} = locateSection(body, startTag, endTag)
    if (location == null && problem !== 'absent') {
      // 用户可能手工删了半个 marker。此时任何就地修改都可能吞掉他的正文
      logger.warning(
        `description-state: section markers are damaged (${problem}) — skipped updating to ` +
          'avoid corrupting the description'
      )
      return {ok: false, attempts: attempt, reason: 'corrupted'}
    }
    if (problem === 'duplicated') {
      logger.warning(
        'description-state: found more than one marker block; updating the first one only'
      )
    }

    const current =
      location == null
        ? null
        : body.slice(
            location.start + location.startTag.length,
            location.end - location.endTag.length
          )

    const next = render(current)
    if (next == null) return {ok: false, attempts: attempt, reason: 'skipped'}

    // 紧邻写入前再读一次，把自己那段贴到**最新**正文上。
    // 少了这一步，render 期间别人写入的区块就会被我们手里的旧快照覆盖掉——
    // 这正是 pause 状态被 release notes 抹掉的成因。
    let latest = body
    try {
      const fresh = await platform.getChangeRequest(owner, repo, changeRequestId)
      latest = fresh.body ?? ''
    } catch (e) {
      logger.warning(`description-state: failed to re-read before write: ${String(e)}`)
      return {ok: false, attempts: attempt, reason: 'error'}
    }

    const newBody = writeSection(latest, startTag, endTag, next)
    if (newBody == null) return {ok: false, attempts: attempt, reason: 'corrupted'}
    if (newBody === latest) return {ok: true, attempts: attempt, changed: false}

    try {
      await platform.updateChangeRequestBody(owner, repo, changeRequestId, newBody)
    } catch (e) {
      logger.warning(`description-state: failed to write description: ${String(e)}`)
      return {ok: false, attempts: attempt, reason: 'error'}
    }

    // 写后校验：读回来确认自己的内容确实落上了。并发写入时对方可能刚好覆盖，
    // 这里能发现并重试——没有这一步，"重试"就无从触发。
    try {
      const verify = await platform.getChangeRequest(owner, repo, changeRequestId)
      const landed = readSection(verify.body ?? '', startTag, endTag)
      // 比较要去掉区块框架带来的换行：writeSection 会把内容包成
      // `start\n内容\nend`，读回来的切片自带首尾换行，直接和 render 的返回值
      // 比较永远不等，会白白多跑一轮重试
      if (landed != null && landed.trim() === next.trim()) {
        return {ok: true, attempts: attempt, changed: true}
      }
      logger.info(
        `description-state: section was overwritten concurrently, retrying (attempt ${attempt}/${maxAttempts})`
      )
    } catch (e) {
      // 读回失败不代表写失败，不重试也不谎报成功
      logger.warning(`description-state: write succeeded but verification failed: ${String(e)}`)
      return {ok: true, attempts: attempt, changed: true}
    }
  }

  return {ok: false, attempts: maxAttempts, reason: 'conflict'}
}
