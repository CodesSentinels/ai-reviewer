/**
 * review-dedup.ts - AI 评论级去重（基于"共享 tool finding"的贪心聚类）
 *
 * 处理"LLM 对同一个 lint 工具发现写了多条评论"的情况。
 *
 * ## 与 lint-filter.ts 的区别
 *
 *   - `lint-filter.ts::deduplicateResults` 在**lint 工具发现**层去重
 *     （如 ESLint 与 Biome 同时报 no-unused-vars 时合并）
 *   - 本模块在**LLM 解析后的 Review[]**层去重，针对模型自己对同一个工具
 *     发现写出多条评论
 *
 * ## 演进
 *
 *   - v1：精确 `(startLine, endLine)` match。LLM 把两条评论挂在不同行
 *     （一条 98-98，另一条 95-100）就漏掉
 *   - v2：用"重叠的 ruleId 集合"做 key。但要求**集合完全相等**，对
 *     "review A 覆盖 {TS2345}，review B 覆盖 {TS2339, TS2345}"的部分
 *     重叠场景仍然漏（key 不一样）—— 用户在 2026-05-13 报到的实际场景
 *   - **v3（本版本）**：贪心聚类。两条评论只要**共享任意一个 tool finding
 *     的 ruleId** 就视为同议题；通过greedy一次扫描自然形成传递闭包
 *
 * ## 设计权衡
 *
 * 贪心聚类有"过度合并"的理论风险：例如一条"函数级别"评论覆盖 5 个 finding，
 * 另一条只覆盖其中 1 个 specific finding，它们会被合并。但在 PR review 实
 * 际语境下，**合并 > 多条独立评论刷屏**：合并后的评论以 `---` 分隔保留所有
 * 视角，reviewer 读得到全部内容，但只占一条 GitHub 评论位。
 *
 * 抽离为独立文件是为了让单元测试可以直接导入，无须把 review.ts 的全部运行时
 * 依赖（@actions/github / octokit / p-limit）一起拉起来。
 */

/** 审查评论的结构化表示 */
export interface Review {
  /** 评论起始行号（基于 PR 新文件的行号） */
  startLine: number
  /** 评论结束行号 */
  endLine: number
  /** 评论内容（markdown） */
  comment: string
}

/**
 * Lint 工具发现的极简视图（仅本模块去重需要的字段）
 *
 * 不直接 import `LintResult` 是为了避免反向依赖 lint 模块，让 review-dedup
 * 保持与 lint 子系统的解耦。调用方传入时把 LintResult 投影到这个形状即可。
 */
export interface ToolFindingForDedup {
  /** 在 PR 新文件中的起始行 */
  line: number
  /** 在 PR 新文件中的结束行；缺省视为 == line */
  endLine?: number
  /** 工具规则 ID（如 'TS2345' / 'no-unused-vars'），用作 dedup 议题键 */
  ruleId: string
}

/**
 * 判断 review 与 finding 在行号上是否重叠
 *
 * 与 formatToolAttribution 使用的判定保持一致，保证"评论上挂着哪些 Tools 卡片"
 * 与"评论按哪些 finding 去重"两者口径相同。
 */
function overlapsFinding(review: Review, finding: ToolFindingForDedup): boolean {
  const fEnd = finding.endLine ?? finding.line
  return fEnd >= review.startLine && finding.line <= review.endLine
}

/** 判断两个 ruleId 集合是否有任何共同元素 */
function shareAnyRuleId(a: Set<string>, b: Set<string>): boolean {
  // 优化：遍历较小的那个集合
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a]
  for (const rid of smaller) {
    if (larger.has(rid)) return true
  }
  return false
}

interface ClusteredEntry {
  review: Review
  ruleIds: Set<string>
}

/**
 * 把"谈论同议题"的多条 AI 评论合并为一条
 *
 * 算法：贪心聚类。对每条 review，找出它与已有 group 中**任意一条** review
 * 共享 ruleId 的情况 → 加入该 group；否则单独成 group。最后每个 group
 * 合并成一条评论。
 *
 * 同议题判定：
 *   - 至少有一条 finding 同时与两条 review 的行号范围重叠（即两条都覆盖
 *     该 finding）
 *   - 或者：两条 review 都没有重叠 finding，但行号范围完全相同（退回 v1
 *     行为，保护"纯 AI 洞察"场景的精确匹配语义）
 *
 * 合并策略：
 *   - 评论 body 按出现顺序拼接，中间插入 `\n\n---\n\n` 分隔符
 *   - 行号范围扩大到能覆盖 group 内所有 review（GitHub 评论锚点更合理）
 *
 * @param reviews 来自 parseReview 的原始数组
 * @param filename 用于日志（便于排查"为啥又重复了"）
 * @param toolFindings 该文件中所有 lint 工具发现的简化视图
 *
 * @returns 合并后的数组，保持原始顺序（每个 group 用第一条 review 的位置）
 */
export function mergeReviewsByTopic(
  reviews: Review[],
  filename: string,
  toolFindings: ToolFindingForDedup[]
): Review[] {
  // 仅在测试环境之外 require @actions/core，避免 jest 启动时直接拉起 GitHub runtime

  const {info} = require('@actions/core') as {info: (msg: string) => void}

  // Step 1: 为每条 review 计算其重叠的 ruleId 集合
  const entries: ClusteredEntry[] = reviews.map(r => {
    const ruleIds = new Set<string>()
    for (const f of toolFindings) {
      if (overlapsFinding(r, f)) ruleIds.add(f.ruleId)
    }
    return {review: {...r}, ruleIds}
  })

  // Step 2: 贪心聚类。每条 review 加入"与之共享 ruleId 的"已有 group；
  // 若都不共享，则单独成新 group。
  // 注意：因为 group 之间会因新成员加入而扩大 ruleId 集合，需要在每次加入时
  // 更新 group 的"累积 ruleIds"以保持传递闭包（A↔B, B↔C, A 与 C 不直接
  // 共享也能聚到一起）。
  type Group = {members: Review[]; cumulativeRuleIds: Set<string>}
  const groups: Group[] = []

  for (const e of entries) {
    let attachedGroup: Group | null = null
    for (const g of groups) {
      if (canMerge(e, g)) {
        attachedGroup = g
        break
      }
    }
    if (attachedGroup != null) {
      attachedGroup.members.push(e.review)
      for (const rid of e.ruleIds) attachedGroup.cumulativeRuleIds.add(rid)
    } else {
      groups.push({
        members: [e.review],
        cumulativeRuleIds: new Set(e.ruleIds)
      })
    }
  }

  // Step 3: 把每个 group 合并成一条 review
  let mergedCount = 0
  const out: Review[] = groups.map(g => {
    if (g.members.length === 1) return g.members[0]
    mergedCount += g.members.length - 1
    const merged: Review = {...g.members[0]}
    for (let k = 1; k < g.members.length; k++) {
      const m = g.members[k]
      merged.comment = `${merged.comment.trimEnd()}\n\n---\n\n${m.comment.trimStart()}`
      merged.startLine = Math.min(merged.startLine, m.startLine)
      merged.endLine = Math.max(merged.endLine, m.endLine)
    }
    return merged
  })

  if (mergedCount > 0) {
    info(
      `[review-dedup] ${filename}: merged ${mergedCount} duplicate comment(s) into ${out.length} unique entries (greedy-clustered)`
    )
  }
  return out
}

/**
 * 判定 entry 是否可以加入 group
 *
 * 两种情况算 "可加入"：
 * 1. entry 有 ruleId 且 group 累积的 ruleIds 中有任意一个相同
 * 2. entry 和 group 中**任一**成员 ruleIds 都是空集（无 tool finding 覆盖），
 *    且行号范围完全相同 —— 退回 v1 行为，保护纯 AI 洞察的语义
 */
function canMerge(
  entry: ClusteredEntry,
  group: {members: Review[]; cumulativeRuleIds: Set<string>}
): boolean {
  if (entry.ruleIds.size > 0 && group.cumulativeRuleIds.size > 0) {
    return shareAnyRuleId(entry.ruleIds, group.cumulativeRuleIds)
  }
  if (entry.ruleIds.size === 0 && group.cumulativeRuleIds.size === 0) {
    // 两边都无 tool finding 覆盖 → 用 v1 行为：精确行号匹配
    return group.members.some(
      m => m.startLine === entry.review.startLine && m.endLine === entry.review.endLine
    )
  }
  // 一边有 ruleId 一边没有 → 不同类，不合并
  return false
}

/**
 * 向后兼容别名：按行号精确去重（v1 行为）
 *
 * 等价于调用 `mergeReviewsByTopic(reviews, filename, [])` —— 所有 review
 * 的 ruleIds 都是空集，全部退回到 v1 的精确行号匹配。
 *
 * @deprecated 新代码请用 `mergeReviewsByTopic` 并传入 toolFindings 让议题级
 *   去重生效；本别名仅为旧测试与外部调用方保留
 */
export function mergeReviewsByLineRange(reviews: Review[], filename: string): Review[] {
  return mergeReviewsByTopic(reviews, filename, [])
}
