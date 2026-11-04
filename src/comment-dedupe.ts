/**
 * comment-dedupe.ts — 按“同一问题”给新评论去重（内容层）
 *
 * 位置层的去重（commenter.ts 的 isSameCommentLocation）只认行范围：旧评论 5-10、
 * 新评论 1-17 就认不出来，同一个问题被换个行范围重新发布。回归测试里两处都踩到了：
 *   - FT-055：full review 对已有未解决评论的同一函数、同一缺陷重复发布；
 *   - FT-092：截断后再审，已发布过的 `loadAll` 被再次发布。
 *
 * 这里补一层内容判断：评论正文里反引号包起来的代码标识符（函数名、变量名、表达式）
 * 基本就是“哪个缺陷”的指纹。新评论的某一段（或某一条要点）的指纹绝大部分已经出现在
 * 同文件的未解决 bot 评论里，就当作同一问题，不再发布。
 *
 * 保守原则：宁可多发，不能漏发。没有可识别的标识符、或只有少数标识符重合时一律保留。
 */

/** 太泛的标识符：它们出现在几乎所有评论里，不能当指纹 */
const GENERIC_KEYS = new Set([
  'undefined',
  'null',
  'true',
  'false',
  'nan',
  'string',
  'number',
  'boolean',
  'object',
  'array',
  'any',
  'unknown',
  'void',
  'never',
  'promise',
  'async',
  'await',
  'return',
  'const',
  'let',
  'var',
  'function',
  'class',
  'type',
  'interface',
  'typeof',
  'error',
  'json',
  'fetch',
  'response',
  'map',
  'set',
  'diff'
])

/** 一段评论算“已报告过”所需的指纹覆盖率 */
const SECTION_COVERAGE = 0.7
/** 一条要点算“已报告过”所需的指纹覆盖率 */
const BULLET_COVERAGE = 0.8

// 不直接写 `<!--` 字面量：arch-guard 会把它当成未登记的状态 marker（见 GH-015）
const MARKER_COMMENT = /<!-{2}[\s\S]*?-{2}>/g
const DETAILS_BLOCK = /<details[\s\S]*?<\/details>/gi
const FENCED_CODE = /```[\s\S]*?```/g

/** 去掉标记、折叠块（修复建议 / 分析链）和代码围栏，只留正文 */
export function stripToProse(text: string): string {
  return (text ?? '')
    .replace(MARKER_COMMENT, '')
    .replace(DETAILS_BLOCK, '')
    .replace(FENCED_CODE, '')
}

/** 提取正文里反引号包起来的标识符，作为这段评论的指纹 */
export function extractIssueKeys(text: string): Set<string> {
  const keys = new Set<string>()
  const prose = stripToProse(text)
  const re = /`([^`\n]{3,80})`/g
  let m: RegExpExecArray | null
  while ((m = re.exec(prose)) != null) {
    const key = m[1].trim().replace(/\(\)$/, '').toLowerCase()
    if (key.length < 3 || /\s/.test(key) || GENERIC_KEYS.has(key)) continue
    keys.add(key)
  }
  return keys
}

/**
 * 把合并后的评论拆成各段（合并时用单独一行的 `---` 分隔）。
 * 围栏代码块和 `<details>` 里的 `---` 不是分隔符。
 */
export function splitReviewSections(message: string): string[] {
  const sections: string[] = []
  let current: string[] = []
  let inFence = false
  let detailsDepth = 0
  for (const line of (message ?? '').split('\n')) {
    if (/^\s*```/.test(line)) inFence = !inFence
    if (!inFence) {
      const opens = (line.match(/<details[\s>]/gi) ?? []).length
      const closes = (line.match(/<\/details>/gi) ?? []).length
      detailsDepth = Math.max(0, detailsDepth + opens - closes)
    }
    if (!inFence && detailsDepth === 0 && /^\s*---\s*$/.test(line)) {
      sections.push(current.join('\n'))
      current = []
      continue
    }
    current.push(line)
  }
  sections.push(current.join('\n'))
  return sections
}

/**
 * 评论里「修复建议」diff 的签名：删掉的行和新增的行各自去掉全部空白后拼起来。
 *
 * 标识符指纹靠正文里反引号包起来的名字，措辞一换（新评论提到函数名 `share`，旧评论没提）
 * 覆盖率就掉下去，同一个缺陷会被再发一遍，而且常常锚在本次提交新增的无关行上。
 * 两条评论建议把同一处代码改成同一个样子，说的就是同一件事，不看措辞。
 *
 * 去掉全部空白是为了容忍同一个修复换了排版（单行 `{ return a / b }` 与分行写法）。
 * 只认修复建议里「有删除行」的 diff：纯新增的建议没有锚定到具体问题代码，不拿来判重。
 */
export function extractFixSignatures(text: string): Set<string> {
  const sigs = new Set<string>()
  const re = /```diff[^\n]*\n([\s\S]*?)```/g
  let m: RegExpExecArray | null
  while ((m = re.exec((text ?? '').replace(MARKER_COMMENT, ''))) != null) {
    const removed: string[] = []
    const added: string[] = []
    for (const line of m[1].split('\n')) {
      if (line.startsWith('---') || line.startsWith('+++')) continue
      if (line.startsWith('-')) removed.push(line.slice(1).replace(/\s+/g, ''))
      else if (line.startsWith('+')) added.push(line.slice(1).replace(/\s+/g, ''))
    }
    const removedKey = removed.join('')
    if (removedKey === '') continue
    sigs.add(`${removedKey}=>${added.join('')}`)
  }
  return sigs
}

/** 这一段的修复建议全部已经在已有评论里出现过（至少有一条可比较的 diff） */
function fixCovered(section: string, existingSigs: Set<string>): boolean {
  const sigs = extractFixSignatures(section)
  if (sigs.size === 0) return false
  for (const sig of sigs) if (!existingSigs.has(sig)) return false
  return true
}

function coverage(keys: Set<string>, existing: Set<string>): number {
  if (keys.size === 0) return 0
  let hit = 0
  for (const k of keys) if (existing.has(k)) hit += 1
  return hit / keys.size
}

export interface DedupeResult {
  /** 去重后的评论正文；空串表示整条都已被已有评论覆盖 */
  message: string
  droppedSections: number
  droppedBullets: number
}

/** 去掉一段里已被覆盖的要点（列表项）；段落其余部分原样保留 */
function dropCoveredBullets(
  section: string,
  existing: Set<string>
): {text: string; dropped: number} {
  const lines = section.split('\n')
  const out: string[] = []
  let dropped = 0
  let inFence = false
  let detailsDepth = 0
  for (const line of lines) {
    if (/^\s*```/.test(line)) inFence = !inFence
    if (!inFence) {
      detailsDepth = Math.max(
        0,
        detailsDepth +
          (line.match(/<details[\s>]/gi) ?? []).length -
          (line.match(/<\/details>/gi) ?? []).length
      )
    }
    const isBullet = !inFence && detailsDepth === 0 && /^\s*(?:[-*]|\d+\.)\s+/.test(line)
    if (isBullet) {
      const keys = extractIssueKeys(line)
      if (keys.size > 0 && coverage(keys, existing) >= BULLET_COVERAGE) {
        dropped += 1
        continue
      }
    }
    out.push(line)
  }
  return {text: out.join('\n'), dropped}
}

/**
 * 对照同文件已有的未解决 bot 评论正文，去掉新评论里已经报告过的部分。
 *
 * - 整段的指纹覆盖率 ≥ 0.7 → 整段丢弃；
 * - 否则逐条检查要点，覆盖率 ≥ 0.8 的要点丢弃；
 * - 其余原样保留。
 */
export function dedupeAgainstExisting(message: string, existingBodies: string[]): DedupeResult {
  const existing = new Set<string>()
  const existingSigs = new Set<string>()
  for (const body of existingBodies) {
    for (const k of extractIssueKeys(body)) existing.add(k)
    for (const sig of extractFixSignatures(body)) existingSigs.add(sig)
  }
  if (existing.size === 0 && existingSigs.size === 0) {
    return {message, droppedSections: 0, droppedBullets: 0}
  }

  const sections = splitReviewSections(message)
  const kept: string[] = []
  let droppedSections = 0
  let droppedBullets = 0
  // 评论开头的机器人署名与严重级别提示只出现在第一段；第一段被丢弃时要把它们留给后面的段
  let orphanHeader = ''
  for (const [index, section] of sections.entries()) {
    const {header, body} = index === 0 ? splitHeader(section) : {header: '', body: section}
    const keys = extractIssueKeys(body)
    // 修复建议与已有评论完全相同 → 同一个问题（标识符指纹认不出措辞不同的重复）
    if (fixCovered(body, existingSigs)) {
      droppedSections += 1
      if (index === 0) orphanHeader = header
      continue
    }
    if (keys.size > 0 && coverage(keys, existing) >= SECTION_COVERAGE) {
      droppedSections += 1
      if (index === 0) orphanHeader = header
      continue
    }
    const {text, dropped} = dropCoveredBullets(body, existing)
    droppedBullets += dropped
    kept.push(header !== '' ? `${header}\n${text}` : text)
  }
  // 什么都没去掉：原样返回，不做任何规整（空白、换行都保持原样）
  if (droppedSections === 0 && droppedBullets === 0)
    return {message, droppedSections, droppedBullets}
  if (kept.length === 0) return {message: '', droppedSections, droppedBullets}
  if (orphanHeader !== '') kept[0] = `${orphanHeader}\n${kept[0]}`
  const result = kept
    .map(s => s.trim())
    .filter(s => s !== '')
    .join('\n\n---\n\n')
  return {message: result, droppedSections, droppedBullets}
}

/**
 * 第一段开头的署名行与引用块（`> [!CAUTION]` 之类）归为 header，不参与指纹计算。
 * header 是开头连续的“第一行 / 空行 / 以 > 开头的行”。
 */
function splitHeader(section: string): {header: string; body: string} {
  const lines = section.split('\n')
  let i = 0
  while (i < lines.length && (i === 0 || lines[i].trim() === '' || lines[i].startsWith('>'))) i += 1
  return {header: lines.slice(0, i).join('\n').trimEnd(), body: lines.slice(i).join('\n')}
}
