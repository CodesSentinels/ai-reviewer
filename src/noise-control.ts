/**
 * noise-control.ts - 评论噪音控制（迭代二 · 成员 D · 2.5）
 *
 * 避免 Bot 评论过多干扰开发者，提供：
 *
 *   1. 同类评论合并去重  —— 相同文件 / 相同类别的问题合并为一条
 *   2. 单次评论数量上限  —— 默认 N=20，按优先级截断
 *   3. 行级严重级别徽标  —— 每条行级评论顶部直接标注级别（severityBadge）
 *
 * 对外提供（供成员 C 在审查完成后调用，见拆分文档 §5 接口契约）：
 *   - prepareFindings(findings, options)   去重 + 排序 + 截断后的结构化结果
 *   - severityBadge(severity)              行级评论的严重级别徽标
 *   - classifyFindingSeverity(text)        从评论文本启发式推断严重级别
 *
 * 注：早期的「低优先级折叠 / PR 顶部汇总评论」（formatComments / buildSummaryBody /
 * postSummaryComment）已随「级别分散到各评论」改造移除——级别现以徽标形式直接置于
 * 每条行级评论顶部。
 */

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

/** 严重级别的展示样式（emoji + 中文标签 + GitHub 警示框类型 + 一句话说明） */
const SEVERITY_DISPLAY: Record<
  FindingSeverity,
  {emoji: string; label: string; alert: string; hint: string}
> = {
  critical: {
    emoji: '🔴',
    label: '严重',
    alert: 'CAUTION',
    hint: '需优先修复'
  },
  major: {emoji: '🟠', label: '重要', alert: 'WARNING', hint: '建议尽快处理'},
  minor: {emoji: '🟡', label: '次要', alert: 'NOTE', hint: '可酌情优化'},
  nit: {emoji: '⚪', label: '吹毛求疵', alert: 'TIP', hint: '锦上添花'},
  info: {emoji: 'ℹ️', label: '提示', alert: 'NOTE', hint: ''}
}

/**
 * 行级评论的严重级别徽标。
 *
 * 用 GitHub 警示框（`> [!CAUTION]` 等）渲染成带颜色的标题块，配合 emoji + 中文标签，
 * 让每条行级评论一眼能看出严重级别（取代原先在 PR 顶部单独发的汇总评论）。
 */
export function severityBadge(severity: FindingSeverity): string {
  const {emoji, label, alert, hint} = SEVERITY_DISPLAY[severity]
  const tail = hint ? ` — ${hint}` : ''
  return `> [!${alert}]\n> ${emoji} **${label}**${tail}`
}

const DEFAULT_MAX_COMMENTS = 20

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

function firstLine(text: string): string {
  const line = (text ?? '').split('\n').find(l => l.trim().length > 0)
  return (line ?? '').trim()
}

/**
 * 启发式严重级别分类：从一条审查评论的文本推断严重级别。
 *
 * 审查模型当前并不直接输出级别，这里用关键词（中英）做轻量分类，
 * 用于噪音控制的排序 / 截断 / 折叠。按"高 → 低"顺序匹配，命中即返回。
 * 无明显信号时归为 minor（既不抢占高优先级，也不会被当作纯提示丢弃）。
 */
export function classifyFindingSeverity(text: string): FindingSeverity {
  const t = (text ?? '').toLowerCase()
  const has = (...kw: string[]): boolean => kw.some(k => t.includes(k))

  if (
    has(
      'security',
      'vulnerab',
      'injection',
      'xss',
      'csrf',
      'rce',
      'redos',
      'secret',
      'credential',
      'hardcoded',
      'api key',
      '密钥',
      '凭证',
      '注入',
      '漏洞',
      '安全'
    )
  ) {
    return 'critical'
  }
  if (
    has(
      'crash',
      'null pointer',
      'race condition',
      'data loss',
      'memory leak',
      'leak',
      'off-by-one',
      'off by one',
      'incorrect',
      'unhandled',
      'exception',
      'await',
      'deadlock',
      '错误',
      '正确性',
      '缺陷',
      '异常',
      '泄露',
      '崩溃'
    )
  ) {
    return 'major'
  }
  if (
    has(
      'nit',
      'typo',
      'formatting',
      'indentation',
      'naming',
      '拼写',
      '格式',
      '命名'
    )
  ) {
    return 'nit'
  }
  if (
    has(
      'consider',
      'recommend',
      'prefer',
      'readability',
      'document',
      '建议',
      '可读性',
      '推荐'
    )
  ) {
    return 'minor'
  }
  return 'minor'
}
