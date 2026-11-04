/**
 * large-pr.ts - 大型 PR 的处理策略（Issue #51）
 *
 * 文件很多的 PR 有三件事要处理，规则都集中在这里（纯函数，便于单测）：
 *
 *   1. 超出 max_files 时先按优先级排序再截断，而不是按平台返回的顺序硬截断
 *   2. 文件数超过 warn_files 时在摘要里提醒（审查会更慢、费用更高）
 *   3. 识别「初始化 PR」（几乎全是新增文件），自动审查时只生成摘要、跳过行级审查
 *
 * 单个超大文件撑破上下文窗口的问题已经由别处兜住：文件全文不会发给模型（提示词
 * 模板不使用 `$file_content`），摘要阶段 diff 超出 token 上限会跳过并列出文件名，
 * 审查阶段按 token 预算只装入放得下的 patch。
 */

/** 低价值文件：锁文件、快照、source map、压缩产物等。截断时排在最后 */
const LOW_VALUE_PATTERNS: RegExp[] = [
  /(^|\/)package-lock\.json$/,
  /(^|\/)npm-shrinkwrap\.json$/,
  /(^|\/)composer\.lock$/,
  /(^|\/)Gemfile\.lock$/,
  /(^|\/)poetry\.lock$/,
  /(^|\/)go\.sum$/,
  /-lock\.(json|ya?ml)$/,
  /\.lock$/,
  /(^|\/)__snapshots__\//,
  /\.snap$/,
  /\.map$/,
  /\.min\.(js|css)$/
]

/** 文档类文件：价值低于代码，高于低价值文件 */
const DOC_PATTERNS: RegExp[] = [/\.(md|mdx|markdown|rst|txt|adoc)$/i, /(^|\/)(LICENSE|NOTICE)$/]

/** 截断时参与排序的单个文件 */
export interface PrioritizedFile {
  filename: string
  /** 平台给出的变更状态（added / modified / removed / renamed …） */
  status?: string
  /** unified diff 文本，用于统计变更行数 */
  patch?: string
}

/** 文件所在的优先级档位：数字越小越先处理 */
export function fileTier(file: PrioritizedFile): number {
  // 已删除的文件只在摘要里有意义，不进入行级审查
  if (file.status === 'removed') return 3
  if (LOW_VALUE_PATTERNS.some(p => p.test(file.filename))) return 3
  // 只改名、没有内容变更：没有可审的内容
  if (file.status === 'renamed' && countChangedLines(file.patch) === 0) return 3
  if (DOC_PATTERNS.some(p => p.test(file.filename))) return 2
  return 1
}

/** 统计 patch 中新增和删除的行数（不含 diff 头） */
export function countChangedLines(patch: string | undefined): number {
  if (patch == null || patch === '') return 0
  let n = 0
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (line.startsWith('+') || line.startsWith('-')) n++
  }
  return n
}

/**
 * 按优先级给文件排序：先按档位（代码 > 文档 > 低价值 / 删除 / 纯改名），
 * 同一档位内变更行数多的在前，再相同时保持原顺序。
 *
 * 只在需要截断时调用：不截断时保持平台原顺序，避免无谓地改变摘要和评论里的文件次序。
 */
export function prioritizeFiles<T>(items: T[], describe: (item: T) => PrioritizedFile): T[] {
  return items
    .map((item, index) => {
      const file = describe(item)
      return {item, index, tier: fileTier(file), changed: countChangedLines(file.patch)}
    })
    .sort((a, b) => a.tier - b.tier || b.changed - a.changed || a.index - b.index)
    .map(x => x.item)
}

/** 判定为初始化 PR 的最少新增文件数 */
export const INITIAL_PR_MIN_ADDED_FILES = 80
/** 判定为初始化 PR 的新增文件占比下限 */
export const INITIAL_PR_MIN_ADDED_RATIO = 0.9

export interface InitialPrDetection {
  isInitial: boolean
  added: number
  total: number
}

/**
 * 识别初始化 PR：新增文件数达到下限，且占比超过 90%。
 *
 * 两个条件缺一不可：只看占比会把「新建 3 个文件」的小 PR 误判进来；只看数量会把
 * 「新增 80 个、同时大改 200 个」的大重构误判进来。统计的是经过路径过滤之后的文件。
 */
export function detectInitialPr(statuses: Array<string | undefined>): InitialPrDetection {
  const total = statuses.length
  const added = statuses.filter(s => s === 'added').length
  const isInitial =
    added >= INITIAL_PR_MIN_ADDED_FILES && total > 0 && added / total > INITIAL_PR_MIN_ADDED_RATIO
  return {isInitial, added, total}
}

/** 文件数超过 warn_files 时的提示；warnFiles ≤ 0 表示关闭提示 */
export function largePrNotice(fileCount: number, warnFiles: number): string | null {
  // 写成 !(warnFiles > 0)：未配置或解析失败（undefined / NaN）时同样视为关闭
  if (!(warnFiles > 0) || fileCount <= warnFiles) return null
  return (
    `本次变更涉及 ${fileCount} 个文件，超过 \`warn_files\`（${warnFiles}）。` +
    '审查耗时和模型费用会随文件数增加；可以拆分 PR，或用 `path_filters` 排除不需要审查的文件。'
  )
}

/** 初始化 PR 跳过行级审查时的说明 */
export function initialPrNotice(detection: InitialPrDetection, mention: string): string {
  return (
    `检测到初始化类变更（新增 ${detection.added} / ${detection.total} 个文件），` +
    '本次只生成摘要，跳过逐文件的行级审查，以免产生大量低价值评论。' +
    `如需逐文件审查，请评论 \`${mention} full review\`。`
  )
}
