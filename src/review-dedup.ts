/**
 * review-dedup.ts - AI 评论级去重
 *
 * 处理"LLM 在响应中对同一行号范围写了多条评论"的情况。
 *
 * **与 lint-filter.ts 的区别**：
 *   - lint-filter.ts::deduplicateResults 在"lint 工具发现"层做去重（如 ESLint
 *     与 Biome 同时报 no-unused-vars 时合并）
 *   - 本模块在"LLM 解析后的 Review[]"层做去重，针对模型自己产出两条针对同一行
 *     的评论
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
 * 对 Review[] 做"行号范围"层面的去重合并
 *
 * **为什么需要**：lint 工具层级的去重只处理"ESLint 与 Biome 报同一规则"这类
 * 工具间重复。当 lint 只报 1 条 finding 时，**LLM 仍可能对该行写出多条不同
 * 角度的评论**（例：一条强调"必然报错"，另一条强调"测试隔离"），最终在 PR 上
 * 显示为两条独立 review comment，对用户来说就是"为什么同一处问题刷两条"。
 *
 * 合并策略：
 *   - key 为 `${startLine}-${endLine}`
 *   - 同 key 的多条评论按出现顺序拼接，中间插入 `\n\n---\n\n` 分隔符
 *   - 保留所有视角的内容（不丢信息），但只占一条 GitHub 评论位
 *
 * 与"严格保留最长的一条"等替代策略相比，合并方式是更保守的选择 —— LLM 写两条
 * 通常确实是从不同角度看同一问题，merge 让审阅者两条都能读到。
 *
 * @param reviews 来自 parseReview 的原始数组
 * @param filename 仅用于日志（便于排查"为啥又重复了"）
 * @returns 合并后的数组；若有合并触发，会在 `@actions/core::info` 打一条日志
 */
export function mergeReviewsByLineRange(
  reviews: Review[],
  filename: string
): Review[] {
  // 用 require 而非 import，避免在 .d.ts 推断时把 @actions/core 提前 evaluate
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const {info} = require('@actions/core') as {info: (msg: string) => void}

  const byKey = new Map<string, Review>()
  let mergedCount = 0
  for (const r of reviews) {
    const key = `${r.startLine}-${r.endLine}`
    const existing = byKey.get(key)
    if (existing == null) {
      byKey.set(key, {...r})
    } else {
      existing.comment = `${existing.comment.trimEnd()}\n\n---\n\n${r.comment.trimStart()}`
      mergedCount += 1
    }
  }
  if (mergedCount > 0) {
    info(
      `[review-dedup] ${filename}: merged ${mergedCount} duplicate same-line comment(s) into ${byKey.size} unique entries`
    )
  }
  return Array.from(byKey.values())
}
