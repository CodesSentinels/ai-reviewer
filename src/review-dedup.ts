/**
 * review-dedup.ts - AI 评论级去重（按"底层问题"合并）
 *
 * 处理"LLM 对同一个 lint 工具发现写了多条评论"的情况。
 *
 * ## 与 lint-filter.ts 的区别
 *
 *   - `lint-filter.ts::deduplicateResults` 在**lint 工具发现**层去重
 *     （如 ESLint 与 Biome 同时报 no-unused-vars 时合并）
 *   - 本模块在**LLM 解析后的 Review[]**层去重，针对模型自己对同一个工具
 *     发现写出多条评论（角度不同但谈的是同一个 bug）
 *
 * ## 演进
 *
 *   - v1：精确 `(startLine, endLine)` match。LLM 把两条评论挂在不同行
 *     （一条 98-98，另一条 95-100）就漏掉 → 修复后用户仍看到重复
 *   - v2（本版本）：用**底层 lint 发现的 ruleId 集合**当 key。两条 review
 *     若关联到同一组 tool finding（如都覆盖 TS2345 在 line 98 的位置）就
 *     视为同一议题，合并到一条评论里
 *   - 无 tool finding 关联的纯 AI 洞察 → 退回 v1 的行号精确 match
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
 * 计算"议题键"
 *
 * 思路：找出与 review 行号范围重叠的所有 tool finding，把它们的 ruleId
 * 排序去重拼成字符串 —— 这就是这条 review 谈论的"底层议题"。
 *
 * - 有重叠 finding → key 形如 `topic:TS2345`（同议题的不同行号 review 会合并）
 * - 无重叠 finding → key 形如 `range:98-98`（回退到精确行号匹配）
 */
function computeTopicKey(
  review: Review,
  findings: ToolFindingForDedup[]
): string {
  const overlapping = findings.filter(f => {
    const fEnd = f.endLine ?? f.line
    return fEnd >= review.startLine && f.line <= review.endLine
  })
  if (overlapping.length === 0) {
    return `range:${review.startLine}-${review.endLine}`
  }
  const uniqueRuleIds = [...new Set(overlapping.map(f => f.ruleId))].sort()
  return `topic:${uniqueRuleIds.join('|')}`
}

/**
 * 把"谈论同一议题"的多条 AI 评论合并为一条
 *
 * 合并策略：按出现顺序拼接，中间插入 `\n\n---\n\n` 分隔符；保留所有视角的
 * 内容，只占一条 GitHub 评论位。
 *
 * @param reviews 来自 parseReview 的原始数组
 * @param filename 用于日志（便于排查"为啥又重复了"）
 * @param toolFindings 该文件中所有 lint 工具发现的简化视图（用于计算议题键）；
 *                    传 `[]` 时退化为按行号精确去重
 * @returns 合并后的数组
 */
export function mergeReviewsByTopic(
  reviews: Review[],
  filename: string,
  toolFindings: ToolFindingForDedup[]
): Review[] {
  // 仅在测试环境之外 require @actions/core，避免 jest 启动时直接拉起 GitHub runtime
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const {info} = require('@actions/core') as {info: (msg: string) => void}

  const byKey = new Map<string, Review>()
  let mergedCount = 0
  for (const r of reviews) {
    const key = computeTopicKey(r, toolFindings)
    const existing = byKey.get(key)
    if (existing == null) {
      byKey.set(key, {...r})
    } else {
      existing.comment = `${existing.comment.trimEnd()}\n\n---\n\n${r.comment.trimStart()}`
      // 合并时让评论的行号范围扩大到能覆盖两者（GitHub 评论锚点更合理）
      existing.startLine = Math.min(existing.startLine, r.startLine)
      existing.endLine = Math.max(existing.endLine, r.endLine)
      mergedCount += 1
    }
  }
  if (mergedCount > 0) {
    info(
      `[review-dedup] ${filename}: merged ${mergedCount} duplicate comment(s) into ${byKey.size} unique entries (topic-based)`
    )
  }
  return Array.from(byKey.values())
}

/**
 * 向后兼容别名：按行号精确去重（v1 行为）
 *
 * 等价于调用 `mergeReviewsByTopic(reviews, filename, [])` —— 退化到 range 键。
 *
 * @deprecated 新代码请用 `mergeReviewsByTopic` 并传入 toolFindings 让议题级
 *   去重生效；本别名仅为旧测试保留
 */
export function mergeReviewsByLineRange(
  reviews: Review[],
  filename: string
): Review[] {
  return mergeReviewsByTopic(reviews, filename, [])
}
