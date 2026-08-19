/**
 * state-markers.ts — 状态 marker 权威清单（GH-014）
 *
 * 独立于 commenter.ts：清单是纯数据 + 命名空间逻辑，不依赖 GitHub context，
 * 这样架构守卫等静态检查可以直接读取它，而不会因为 import 链上的
 * `context.repo` 而炸掉。commenter.ts 负责 re-export，调用方无需改 import。
 */
import {buildStateMarker, currentNamespace} from './platform/state-namespace'

// ==================== 状态 marker 注册表（GH-014）====================
//
// 这些 marker 决定行为：定位唯一摘要评论、行级评论去重、发布说明区域替换、
// 隐藏摘要读写。它们必须带平台命名空间，否则 GitHub 与 GitLab 共用 Commenter 时
// 会互相命中对方写下的状态。
//
// 命名空间在运行时由入口设置，因此 marker 必须是**函数**而不是模块级常量——
// 常量在 import 时求值，那时 setStateNamespace() 还没执行。
//
// 每个 marker 都有 legacy 形态（升级前写下的无前缀版本）：写入一律用新格式，
// 匹配同时接受新旧，否则升级当天在途 PR 会「找不到自己写过的 marker」。

/** 单个状态 marker 的定义 */
export interface StateMarkerSpec {
  /** state-namespace 使用的 kind */
  kind: string
  /** 升级前的历史形态，仅用于匹配 */
  legacy: string
  /** 当前平台命名空间下的形态，用于写入 */
  current: () => string
}

/** 把 kind 包成隐藏 HTML 注释块的开/闭形态（raw/short summary 用） */
function wrappedStart(kind: string): string {
  return `${buildStateMarker(kind)}\n<!--\n`
}
function wrappedEnd(kind: string): string {
  return `-->\n${buildStateMarker(kind)}`
}

/**
 * 全部状态 marker 的权威清单。
 *
 * 新增任何参与查找/去重/状态更新的 marker 都必须登记在此——
 * `state-marker-inventory.test.ts` 会校验清单完整性与命名空间正确性。
 */
export const STATE_MARKERS = {
  comment: {
    kind: 'comment',
    legacy: '<!-- This is an auto-generated comment by AI Reviewer -->',
    current: () => buildStateMarker('comment')
  },
  commentReply: {
    kind: 'comment-reply',
    legacy: '<!-- This is an auto-generated reply by AI Reviewer -->',
    current: () => buildStateMarker('comment-reply')
  },
  summarize: {
    kind: 'summarize',
    legacy: '<!-- This is an auto-generated comment: summarize by AI Reviewer -->',
    current: () => buildStateMarker('summarize')
  },
  inProgressStart: {
    kind: 'in-progress-start',
    legacy:
      '<!-- This is an auto-generated comment: summarize review in progress by AI Reviewer -->',
    current: () => buildStateMarker('in-progress-start')
  },
  inProgressEnd: {
    kind: 'in-progress-end',
    legacy: '<!-- end of auto-generated comment: summarize review in progress by AI Reviewer -->',
    current: () => buildStateMarker('in-progress-end')
  },
  descriptionStart: {
    kind: 'release-notes-start',
    legacy: '<!-- This is an auto-generated comment: release notes by AI Reviewer -->',
    current: () => buildStateMarker('release-notes-start')
  },
  descriptionEnd: {
    kind: 'release-notes-end',
    legacy: '<!-- end of auto-generated comment: release notes by AI Reviewer -->',
    current: () => buildStateMarker('release-notes-end')
  },
  rawSummaryStart: {
    kind: 'raw-summary-start',
    legacy: `<!-- This is an auto-generated comment: raw summary by AI Reviewer -->\n<!--\n`,
    current: () => wrappedStart('raw-summary-start')
  },
  rawSummaryEnd: {
    kind: 'raw-summary-end',
    legacy: `-->\n<!-- end of auto-generated comment: raw summary by AI Reviewer -->`,
    current: () => wrappedEnd('raw-summary-end')
  },
  shortSummaryStart: {
    kind: 'short-summary-start',
    legacy: `<!-- This is an auto-generated comment: short summary by AI Reviewer -->\n<!--\n`,
    current: () => wrappedStart('short-summary-start')
  },
  shortSummaryEnd: {
    kind: 'short-summary-end',
    legacy: `-->\n<!-- end of auto-generated comment: short summary by AI Reviewer -->`,
    current: () => wrappedEnd('short-summary-end')
  },
  commitIdsStart: {
    kind: 'commit-ids-reviewed-start',
    legacy: '<!-- commit_ids_reviewed_start -->',
    current: () => buildStateMarker('commit-ids-reviewed-start')
  },
  commitIdsEnd: {
    kind: 'commit-ids-reviewed-end',
    legacy: '<!-- commit_ids_reviewed_end -->',
    current: () => buildStateMarker('commit-ids-reviewed-end')
  },
  reviewInvalidated: {
    kind: 'review-invalidated',
    // 新增 marker，无历史形态（空串会被 includes('') 恒真命中，故用占位）
    legacy: '<!-- ai-reviewer:__no-legacy:review-invalidated -->',
    current: () => buildStateMarker('review-invalidated')
  },
  undeliverableFindings: {
    kind: 'undeliverable-findings',
    // 新增 marker，没有历史形态；legacy 留空串会被 includes('') 恒真命中，
    // 因此用一个不可能出现在正文里的占位
    legacy: '<!-- ai-reviewer:__no-legacy:undeliverable-findings -->',
    current: () => buildStateMarker('undeliverable-findings')
  },
  reviewStateStart: {
    kind: 'review-state-start',
    legacy: '<!-- codesentinel-review-state:start -->',
    current: () => buildStateMarker('review-state-start')
  },
  reviewStateEnd: {
    kind: 'review-state-end',
    legacy: '<!-- codesentinel-review-state:end -->',
    current: () => buildStateMarker('review-state-end')
  },
  noteHookMarkersStart: {
    kind: 'note-hook-markers-start',
    // 这个 marker 是随命名空间一起引入的（STATE-005），没有真正的历史无前缀形态；
    // legacy 只是占位，保持字段完整性和 tagPairVariants 回退逻辑一致，不会在真实
    // 数据里命中。
    legacy: '<!-- ai-reviewer-note-hook-markers-start -->',
    current: () => buildStateMarker('note-hook-markers-start')
  },
  noteHookMarkersEnd: {
    kind: 'note-hook-markers-end',
    legacy: '<!-- ai-reviewer-note-hook-markers-end -->',
    current: () => buildStateMarker('note-hook-markers-end')
  }
} as const satisfies Record<string, StateMarkerSpec>

export type StateMarkerName = keyof typeof STATE_MARKERS

/** 当前平台命名空间下的 marker（用于写入） */
export function stateMarker(name: StateMarkerName): string {
  return STATE_MARKERS[name].current()
}

/** 匹配时应接受的全部形态：当前命名空间格式 + 历史格式 */
export function stateMarkerVariantsFor(name: StateMarkerName): string[] {
  return [STATE_MARKERS[name].current(), STATE_MARKERS[name].legacy]
}

/**
 * 由一个 marker 字符串反查其全部形态。
 *
 * `comment()` / `findCommentWithTag()` 接受调用方传入的 tag 字符串，
 * 这里把它还原成 [新格式, 历史格式] 以便写新读旧。未登记的自定义 tag 原样返回。
 */
export function variantsForTag(tag: string): string[] {
  for (const spec of Object.values(STATE_MARKERS)) {
    if (tag === spec.current() || tag === spec.legacy) {
      return [spec.current(), spec.legacy]
    }
  }
  return [tag]
}

/**
 * 由一对（起始、结束）标签反查其新旧两种组合。
 *
 * 起止标签必须成对回退：不能用新的起始标签配历史的结束标签，
 * 否则会截出错误区间、写坏用户正文。
 */
export function tagPairVariants(startTag: string, endTag: string): Array<[string, string]> {
  for (const spec of Object.values(STATE_MARKERS)) {
    if (startTag !== spec.current() && startTag !== spec.legacy) continue
    const endSpec = Object.values(STATE_MARKERS).find(
      e => endTag === e.current() || endTag === e.legacy
    )
    if (endSpec == null) break
    const pairs: Array<[string, string]> = [[spec.current(), endSpec.current()]]
    // 历史格式只归 GitHub——见 stateMarkerVariants 的说明。GitLab 若也接受它，
    // 会把升级前 GitHub 写入的区块当成自己的整段覆盖（REVIEW-023）。
    if (currentNamespace() === 'github') {
      pairs.push([spec.legacy, endSpec.legacy])
    }
    return pairs
  }
  return [[startTag, endTag]]
}

/**
 * 按 marker 名定位一个成对区块（新格式优先，回退历史格式）。
 *
 * 返回命中的标签本身，调用方据此就地改写——历史区块保持历史标签，
 * 回滚到旧版本时旧版本仍能认出它。
 */
export function locateMarkerBlock(
  body: string,
  startName: StateMarkerName,
  endName: StateMarkerName
): {start: number; end: number; startTag: string; endTag: string} | null {
  const pairs: Array<[string, string]> = [
    [STATE_MARKERS[startName].current(), STATE_MARKERS[endName].current()],
    [STATE_MARKERS[startName].legacy, STATE_MARKERS[endName].legacy]
  ]
  for (const [startTag, endTag] of pairs) {
    const start = body.indexOf(startTag)
    const end = body.indexOf(endTag)
    if (start !== -1 && end !== -1) return {start, end, startTag, endTag}
  }
  return null
}

/** 判断正文是否含指定 marker（新旧格式皆可） */
export function bodyHasMarker(body: unknown, name: StateMarkerName): boolean {
  if (typeof body !== 'string') return false
  return stateMarkerVariantsFor(name).some(v => body.includes(v))
}
