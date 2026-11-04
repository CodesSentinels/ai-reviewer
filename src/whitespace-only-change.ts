/**
 * whitespace-only-change.ts — 判断一个文件的 diff 是否只调整了缩进或换行
 *
 * 一个文件值不值得审查，原来完全交给摘要阶段的轻量模型分类。模型把纯格式改动
 * 判成 NEEDS_REVIEW 时，会白白花一次深度审查，还会把上一轮已经评论过的同一个
 * 问题换个行号再发一遍（按位置去重认不出来）。
 *
 * 这里在文件进入摘要与审查之前做确定性判断：把每个 hunk 还原成「旧版本的块」
 * （上下文行 + 删除行）和「新版本的块」（上下文行 + 新增行），各自去掉空白后比较，
 * 每个 hunk 两边都一致才说明只动了空白。
 *
 * 必须带上下文行、逐个 hunk 比：只拿被改的行去比，会把「语句被挪到另一行之后」
 * 「语句从一处删掉又在另一处原样加上」都当成只改了空白——它们是真实的语义改动。
 * 上下文行把位置锚住，挪动之后两边的块就不再相等。
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

/** 一个 hunk 还原出的两边（已含上下文行），以及是否真的有增删行 */
interface HunkSides {
  oldSide: string[]
  newSide: string[]
  changed: boolean
}

/**
 * 把统一 diff 拆成 hunk，每个 hunk 还原旧、新两边。
 * `\ No newline at end of file` 之类的提示行忽略；空行当作两边都有的空上下文行。
 */
function splitHunkSides(patch: string): HunkSides[] {
  const hunks: HunkSides[] = []
  let current: HunkSides | null = null
  for (const line of patch.split('\n')) {
    if (line.startsWith('@@')) {
      current = {oldSide: [], newSide: [], changed: false}
      hunks.push(current)
      continue
    }
    if (line.startsWith('\\')) continue
    // 没见到 hunk 头就开始的内容（平台只给了片段）也按一个 hunk 处理
    if (current == null) {
      current = {oldSide: [], newSide: [], changed: false}
      hunks.push(current)
    }
    if (line.startsWith('-')) {
      current.oldSide.push(line.slice(1))
      current.changed = true
    } else if (line.startsWith('+')) {
      current.newSide.push(line.slice(1))
      current.changed = true
    } else {
      const context = line.startsWith(' ') ? line.slice(1) : line
      current.oldSide.push(context)
      current.newSide.push(context)
    }
  }
  return hunks
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

  const hunks = splitHunkSides(patch)
  if (!hunks.some(h => h.changed)) return false

  for (const hunk of hunks) {
    const before = stripWhitespaceOutsideQuotes(hunk.oldSide.join('\n'))
    const after = stripWhitespaceOutsideQuotes(hunk.newSide.join('\n'))
    if (before == null || after == null || before !== after) return false
  }
  return true
}
