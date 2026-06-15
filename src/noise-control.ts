/**
 * noise-control.ts - 评论噪音控制（迭代二 · 成员 D · 2.5）
 *
 * 避免 Bot 评论过多干扰开发者，提供：
 *
 *   1. 同类评论合并去重  —— 相同文件 / 相同类别的问题合并为一条
 *   2. 单次评论数量上限  —— 默认 N=20，按优先级截断
 *   3. 低优先级折叠      —— Minor / Nit / Info 级别用 <details> 折叠
 *   4. PR 顶部汇总评论    —— 概述所有发现（按严重级别统计）
 *
 * 对外提供（供成员 C 在审查完成后调用，见拆分文档 §5 接口契约）：
 *   - formatComments(findings, options)        通用评论渲染（去重 + 截断 + 折叠）
 *   - postSummaryComment(prNumber, findings)   PR 顶部汇总评论
 *   - prepareFindings(findings, options)        去重 + 排序 + 截断后的结构化结果
 */
import {info} from '@actions/core'
import {Commenter} from './commenter'

/** 审查发现的严重级别（由高到低） */
export type FindingSeverity = 'critical' | 'major' | 'minor' | 'nit' | 'info'

/** 单条审查发现 */
export interface Finding {
  /** 文件路径 */
  path: string
  /** 起始行号 */
  startLine: number
  /** 结束行号 */
  endLine: number
  /** 严重级别 */
  severity: FindingSeverity
  /** 问题类别（用于同类合并，如 "security" / "style"） */
  category?: string
  /** 简短标题 */
  title?: string
  /** 评论正文（markdown） */
  body: string
}

/** 噪音控制配置 */
export interface NoiseControlOptions {
  /** 单次审查最多展示的评论数（默认 20） */
  maxComments?: number
  /** 需要折叠的低优先级级别（默认 minor / nit / info） */
  foldSeverities?: FindingSeverity[]
  /** 是否对同类发现去重合并（默认 true） */
  dedupe?: boolean
}

/** 严重级别排序权重（数值越大优先级越高） */
const SEVERITY_RANK: Record<FindingSeverity, number> = {
  critical: 4,
  major: 3,
  minor: 2,
  nit: 1,
  info: 0
}

/** 严重级别的展示样式 */
const SEVERITY_DISPLAY: Record<
  FindingSeverity,
  {emoji: string; label: string}
> = {
  critical: {emoji: '🔴', label: '严重'},
  major: {emoji: '🟠', label: '重要'},
  minor: {emoji: '🟡', label: '次要'},
  nit: {emoji: '⚪', label: '吹毛求疵'},
  info: {emoji: 'ℹ️', label: '提示'}
}

const DEFAULT_MAX_COMMENTS = 20
const DEFAULT_FOLD_SEVERITIES: FindingSeverity[] = ['minor', 'nit', 'info']

/** 标识噪音控制汇总评论（独立于迭代一的 SUMMARIZE_TAG，避免互相覆盖） */
export const FINDINGS_SUMMARY_TAG =
  '<!-- This is an auto-generated comment: findings summary by AI Reviewer -->'

/**
 * 同类评论合并去重。
 *
 * 合并键 = 文件路径 + 类别 + 归一化标题（无标题则取正文首行）。
 * 命中同一键的发现合并为一条，保留**最高严重级别**与首条正文，
 * 并在标题后标注合并数量。
 */
export function dedupeFindings(findings: Finding[]): Finding[] {
  const map = new Map<string, {finding: Finding; count: number}>()
  const order: string[] = []

  for (const f of findings) {
    const titleKey = (f.title ?? firstLine(f.body)).trim().toLowerCase()
    const key = `${f.path}|${f.category ?? ''}|${titleKey}`
    const existing = map.get(key)
    if (existing) {
      existing.count++
      // 保留更高的严重级别
      if (
        SEVERITY_RANK[f.severity] > SEVERITY_RANK[existing.finding.severity]
      ) {
        existing.finding = {...existing.finding, severity: f.severity}
      }
    } else {
      map.set(key, {finding: {...f}, count: 1})
      order.push(key)
    }
  }

  return order.map(key => {
    const {finding, count} = map.get(key)!
    if (count > 1) {
      const base = finding.title ?? firstLine(finding.body)
      return {...finding, title: `${base}（合并 ${count} 处同类问题）`}
    }
    return finding
  })
}

/**
 * 去重 + 按严重级别排序 + 截断到上限。
 * 返回结构化结果，供调用方逐条发布行级评论。
 *
 * @returns kept: 保留的发现（已排序）；truncated: 被截断丢弃的数量
 */
export function prepareFindings(
  findings: Finding[],
  options: NoiseControlOptions = {}
): {kept: Finding[]; truncated: number} {
  const maxComments = options.maxComments ?? DEFAULT_MAX_COMMENTS
  const deduped =
    options.dedupe === false ? [...findings] : dedupeFindings(findings)

  // 按严重级别降序稳定排序
  const sorted = deduped
    .map((f, i) => ({f, i}))
    .sort((a, b) => {
      const diff = SEVERITY_RANK[b.f.severity] - SEVERITY_RANK[a.f.severity]
      return diff !== 0 ? diff : a.i - b.i
    })
    .map(x => x.f)

  if (maxComments > 0 && sorted.length > maxComments) {
    return {
      kept: sorted.slice(0, maxComments),
      truncated: sorted.length - maxComments
    }
  }
  return {kept: sorted, truncated: 0}
}

/**
 * 通用评论渲染：去重 + 截断 + 折叠。
 *
 * 高优先级发现直接展开列出；低优先级发现折叠进 <details>。
 * 超出数量上限时追加截断提示。
 *
 * @returns 渲染后的 markdown 字符串（无发现时返回空字符串）
 */
export function formatComments(
  findings: Finding[],
  options: NoiseControlOptions = {}
): string {
  if (!findings || findings.length === 0) {
    return ''
  }
  const foldSet = new Set(options.foldSeverities ?? DEFAULT_FOLD_SEVERITIES)
  const {kept, truncated} = prepareFindings(findings, options)

  const highPriority = kept.filter(f => !foldSet.has(f.severity))
  const lowPriority = kept.filter(f => foldSet.has(f.severity))

  const parts: string[] = []

  for (const f of highPriority) {
    parts.push(renderFinding(f))
  }

  if (lowPriority.length > 0) {
    const inner = lowPriority.map(renderFinding).join('\n\n')
    parts.push(
      `<details>\n<summary>低优先级建议（${lowPriority.length} 条，已折叠）</summary>\n\n${inner}\n\n</details>`
    )
  }

  if (truncated > 0) {
    parts.push(`> _另有 ${truncated} 条较低优先级的发现因数量上限未展示。_`)
  }

  return parts.join('\n\n')
}

/** 渲染单条发现 */
function renderFinding(f: Finding): string {
  const {emoji, label} = SEVERITY_DISPLAY[f.severity]
  const loc =
    f.startLine === f.endLine
      ? `${f.path}:${f.startLine}`
      : `${f.path}:${f.startLine}-${f.endLine}`
  const title = f.title ?? firstLine(f.body)
  const category = f.category ? ` · \`${f.category}\`` : ''
  return `${emoji} **[${label}]** \`${loc}\`${category}\n\n${
    title === firstLine(f.body) ? f.body : `**${title}**\n\n${f.body}`
  }`
}

/**
 * 生成 PR 顶部汇总评论的正文（按严重级别统计 + 渲染发现列表）。
 * 单独导出以便单测。
 */
export function buildSummaryBody(
  findings: Finding[],
  options: NoiseControlOptions = {}
): string {
  if (!findings || findings.length === 0) {
    return `### 🛡️ CodeSentinel 审查摘要\n\n本次审查未发现需要关注的问题。✅`
  }

  // 统计（基于去重后的结果，保证与展示一致）
  const deduped = options.dedupe === false ? findings : dedupeFindings(findings)
  const counts: Record<FindingSeverity, number> = {
    critical: 0,
    major: 0,
    minor: 0,
    nit: 0,
    info: 0
  }
  for (const f of deduped) {
    counts[f.severity]++
  }

  const order: FindingSeverity[] = ['critical', 'major', 'minor', 'nit', 'info']
  const rows = order
    .filter(s => counts[s] > 0)
    .map(s => {
      const {emoji, label} = SEVERITY_DISPLAY[s]
      return `| ${emoji} ${label} | ${counts[s]} |`
    })
    .join('\n')

  const table = `| 级别 | 数量 |\n| :--- | :---: |\n${rows}`
  const body = formatComments(findings, options)

  return `### 🛡️ CodeSentinel 审查摘要\n\n本次审查共发现 **${deduped.length}** 个问题：\n\n${table}\n\n---\n\n${body}`
}

/**
 * 发布 / 更新 PR 顶部汇总评论。
 *
 * 供成员 C 在审查完成后调用（拆分文档 §5：D → C 接口契约）。
 * 使用 FINDINGS_SUMMARY_TAG 做幂等替换，重复调用只更新同一条评论。
 *
 * @param prNumber  PR 编号（保留以对齐接口契约；实际目标由 Commenter 依据
 *                  GitHub context 决定，与既有 review 流程一致）
 * @param findings  审查发现列表
 * @param options   噪音控制配置
 * @param commenter 可选，注入自定义 Commenter（便于测试）
 */
export async function postSummaryComment(
  prNumber: number,
  findings: Finding[],
  options: NoiseControlOptions = {},
  commenter: Commenter = new Commenter()
): Promise<void> {
  const body = buildSummaryBody(findings, options)
  info(
    `noise-control: posting findings summary for PR #${prNumber} (${findings.length} findings)`
  )
  await commenter.comment(body, FINDINGS_SUMMARY_TAG, 'replace')
}

function firstLine(text: string): string {
  const line = (text ?? '').split('\n').find(l => l.trim().length > 0)
  return (line ?? '').trim()
}
