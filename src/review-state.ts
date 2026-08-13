/**
 * review-state.ts — PR/MR body 中的 pause/resume marker（GH-012）
 *
 * marker 带平台命名空间（GH-014）；匹配同时接受历史格式，升级不会把在途 PR 的
 * 暂停状态读成 active。已存在的历史区块就地保留其标签，只有新建区块用新格式——
 * 这样即使回滚到旧版本，旧版本仍能读到自己认识的暂停状态。
 */
import {getPlatform} from './platform/git-platform'
import {STATE_MARKERS, stateMarker} from './state-markers'

export type ReviewState = 'active' | 'paused'

/** 历史格式起止标签（无平台命名空间），仅用于匹配在途 PR 的旧区块 */
export const REVIEW_STATE_START_TAG = STATE_MARKERS.reviewStateStart.legacy
export const REVIEW_STATE_END_TAG = STATE_MARKERS.reviewStateEnd.legacy

/** 当前平台命名空间下的 pause/resume 区块标签（用于新建区块） */
export function reviewStateTags(): {start: string; end: string} {
  return {start: stateMarker('reviewStateStart'), end: stateMarker('reviewStateEnd')}
}

/** 定位 pause/resume 区块，命名空间格式优先，回退历史格式 */
function locateStateBlock(
  body: string
): {start: number; end: number; startTag: string; endTag: string} | null {
  const namespaced = reviewStateTags()
  for (const {start: startTag, end: endTag} of [
    namespaced,
    {start: REVIEW_STATE_START_TAG, end: REVIEW_STATE_END_TAG}
  ]) {
    const start = body.indexOf(startTag)
    const end = body.indexOf(endTag)
    if (start !== -1 && end !== -1) return {start, end, startTag, endTag}
  }
  return null
}

export function getReviewStateFromBody(body = ''): ReviewState {
  const block = locateStateBlock(body)
  if (block == null) return 'active'

  const content = body.slice(block.start + block.startTag.length, block.end)
  return content.includes('state: paused') ? 'paused' : 'active'
}

export function writeReviewStateToBody(body: string, state: ReviewState): string {
  const existing = locateStateBlock(body)
  // 已有区块保持其原有标签（回滚到旧版本仍能读懂），新建区块才用命名空间格式
  const fresh = reviewStateTags()
  const startTag = existing?.startTag ?? fresh.start
  const endTag = existing?.endTag ?? fresh.end
  const stateBlock = `${startTag}
state: ${state}
${endTag}`

  if (existing != null) {
    const before = body.slice(0, existing.start).trimEnd()
    const after = body.slice(existing.end + existing.endTag.length).trim()
    return [before, stateBlock, after].filter(Boolean).join('\n\n')
  }

  return [body.trimEnd(), stateBlock].filter(Boolean).join('\n\n')
}

export async function getReviewState(
  owner: string,
  repo: string,
  pullNumber: number
): Promise<ReviewState> {
  const platform = getPlatform()
  const cr = await platform.getChangeRequest(owner, repo, pullNumber)
  return getReviewStateFromBody(cr.body ?? '')
}

export async function setReviewState(
  owner: string,
  repo: string,
  pullNumber: number,
  state: ReviewState
): Promise<void> {
  const platform = getPlatform()
  const cr = await platform.getChangeRequest(owner, repo, pullNumber)
  await platform.updateChangeRequestBody(
    owner,
    repo,
    pullNumber,
    writeReviewStateToBody(cr.body ?? '', state)
  )
}
