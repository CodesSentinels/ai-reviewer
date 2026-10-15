/**
 * whitespace-only-change.ts — 判断一个文件的 diff 是否只调整了缩进或换行
 *
 * 一个文件值不值得审查，原来完全交给摘要阶段的轻量模型分类。模型把纯格式改动
 * 判成 NEEDS_REVIEW 时，会白白花一次深度审查，还会把上一轮已经评论过的同一个
 * 问题换个行号再发一遍（按位置去重认不出来）。
 *
 * 这里在文件进入摘要与审查之前做确定性判断：把 diff 里删除的行和新增的行各自
 * 去掉空白后比较，完全一致就说明只动了空白。
 *
 * 保守原则：宁可多审，不能漏审。以下情况一律不当作「只改空白」：
 * - 空白可能有语义的语言（Python、YAML、Makefile、模板类文件等）——只对白名单内的语言生效
 * - 字符串字面量里的空白变了
 * - 引号没有闭合（跨行字符串、注释里的撇号都会走到这里）
 * - 有行被增删、或者行序调换了
 */

/** 空白不影响语义的语言（按扩展名，小写，不含点） */
const WHITESPACE_INSENSITIVE_EXTENSIONS = new Set([
  'ts',
  'tsx',
  'mts',
  'cts',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'java',
  'kt',
  'kts',
  'go',
  'rs',
  'c',
  'h',
  'cc',
  'cpp',
  'cxx',
  'hpp',
  'cs',
  'swift',
  'php',
  'scala',
  'dart',
  'css',
  'scss',
  'less'
])

function extensionOf(filename: string): string {
  const base = filename.split('/').pop() ?? filename
  const dot = base.lastIndexOf('.')
  return dot < 0 ? '' : base.slice(dot + 1).toLowerCase()
}

/**
 * 去掉引号之外的所有空白，引号内的内容原样保留。
 * 引号没有闭合时返回 null——调用方据此保守地放弃判断。
 */
function stripWhitespaceOutsideQuotes(text: string): string | null {
  let out = ''
  let quote = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quote !== '') {
      out += ch
      if (ch === '\\' && i + 1 < text.length) {
        out += text[i + 1]
        i += 1
      } else if (ch === quote) {
        quote = ''
      }
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      out += ch
      continue
    }
    if (/\s/.test(ch)) continue
    out += ch
  }
  return quote === '' ? out : null
}

/** 取出统一 diff 里被删除、被新增的行（去掉前导的 -/+），忽略 hunk 头和上下文 */
function collectChangedLines(patch: string): {removed: string[]; added: string[]} {
  const removed: string[] = []
  const added: string[] = []
  for (const line of patch.split('\n')) {
    if (line.startsWith('@@') || line.startsWith('\\')) continue
    if (line.startsWith('-')) removed.push(line.slice(1))
    else if (line.startsWith('+')) added.push(line.slice(1))
  }
  return {removed, added}
}

/**
 * 这个文件的 diff 是否只调整了缩进或换行（没有任何语义变化）。
 *
 * @param filename 仓库内路径，用扩展名决定空白是否有语义
 * @param patch 统一 diff（平台返回的 file.patch，以 `@@` 开头）
 */
export function isWhitespaceOnlyChange(
  filename: string,
  patch: string | undefined | null
): boolean {
  if (patch == null || patch === '') return false
  if (!WHITESPACE_INSENSITIVE_EXTENSIONS.has(extensionOf(filename))) return false

  const {removed, added} = collectChangedLines(patch)
  if (removed.length === 0 && added.length === 0) return false

  const before = stripWhitespaceOutsideQuotes(removed.join('\n'))
  const after = stripWhitespaceOutsideQuotes(added.join('\n'))
  if (before == null || after == null) return false
  return before === after
}
