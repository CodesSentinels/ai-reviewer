/**
 * helpers/semantic-equivalence.ts — 跨平台语义等价判定（TEST-012~015）
 *
 * §14.2 要求「同一 diff fixture 在两平台产生语义等价的结果」，同时 TEST-015 明确
 * **允许**平台 URL、ID、作者和展示格式不同。这两句合起来就是一个归一化问题：
 * 先把平台专有的噪音抹平，再逐字比较剩下的内容。
 *
 * 归一化必须是**保守**的——抹掉的每一类都要能说清「为什么它不属于语义」。抹多了
 * 判定就失去意义：极端情况下把整段正文抹成空串，任何两个结果都"等价"。所以
 * 这里只处理下面这几类，并且每一类都有对应的负向用例守着
 * （见 dual-platform-equivalence.test.ts 的「归一化不能抹掉真实差异」一节）。
 *
 *   marker 命名空间   ai-reviewer:github:x ↔ ai-reviewer:gitlab:x
 *                     状态隔离要求两平台 marker 不同名（STATE-006），这是设计
 *                     使然，不是语义差异
 *   写操作 marker     STATE-015 埋的隐藏 marker，每次写入都不同（含随机 opId）
 *   仓库 URL          https://github.com/o/r ↔ https://gitlab.example.com/g/p
 *   数值 ID           评论 id / discussion id / review id，平台各自分配
 *   commit SHA        两平台的 fixture 用不同 SHA 时才需要；同 SHA 时不受影响
 *   账号名            GitHub App 名与 GitLab PAT 用户名本就不同
 */

/** 归一化选项：默认全开，负向用例可以逐项关掉来验证守卫有没有牙 */
export interface NormalizeOptions {
  /** 平台账号名，会被替换成占位符 */
  botLogins?: string[]
  /** 其他要抹掉的账号名（如 PR/MR 作者） */
  actorLogins?: string[]
}

const PLACEHOLDER = {
  platform: '<platform>',
  url: '<repo-url>',
  id: '<id>',
  login: '<login>',
  writeMarker: ''
}

/**
 * 把一段平台产物归一化成可比较的形态。
 *
 * 顺序有讲究：先抹写 marker（它内部含 16 位摘要，会被后面的 ID 规则误伤成
 * `<id>`，那样两平台就都变成同一个占位符，反而掩盖了「一边有 marker 一边没有」
 * 这种真实差异）。
 */
export function normalizeForComparison(text: string, options: NormalizeOptions = {}): string {
  let out = text

  // 1) 写操作 marker（STATE-015）：整条删掉，包括前置空行
  out = out.replace(
    /\n*<!-- ai-reviewer:(?:github|gitlab):write:\d+:[a-z][a-z0-9-]*:[0-9a-f]{16} -->/g,
    PLACEHOLDER.writeMarker
  )

  // 2) 状态 marker 的平台命名空间：只换平台段，marker 种类必须保留
  //    （种类不同是真实差异——摘要 marker 与 release notes marker 不能互相等价）
  out = out.replace(/ai-reviewer:(?:github|gitlab):/g, `ai-reviewer:${PLACEHOLDER.platform}:`)

  // 3) 仓库 URL
  out = out.replace(/https?:\/\/[^\s)>\]]+/g, PLACEHOLDER.url)

  // 4) 账号名
  //
  // 只替换 @提及 或**独立出现**的账号名。不能裸替换：GitLab 的 bot 账号恰好叫
  // `ai-reviewer`，而 marker 前缀也是 `ai-reviewer:` ——裸替换会把 marker 前缀
  // 一起吃掉，两平台的 marker 就都变成 `<login>:<platform>:xxx`，
  // 「marker 种类不同」这类真实差异随之被抹平。
  for (const login of [...(options.botLogins ?? []), ...(options.actorLogins ?? [])]) {
    if (login === '') continue
    const esc = escapeRegExp(login)
    // @提及
    out = out.replace(new RegExp(`@${esc}`, 'g'), PLACEHOLDER.login)
    // 独立出现：前后都不是标识符字符，且后面不是冒号（那是 marker 命名空间）
    out = out.replace(new RegExp(`(^|[^\\w@/-])${esc}(?![\\w:/-])`, 'g'), `$1${PLACEHOLDER.login}`)
  }

  // 5) 40 位 commit SHA 与其 7 位短写
  out = out.replace(/\b[0-9a-f]{40}\b/g, PLACEHOLDER.id)

  // 6) 独立出现的数值 ID（评论/discussion/review）
  //    只处理 `id: 123` / `#123` / `(123)` 这类明确是标识符的位置，
  //    不碰正文里的普通数字——行号、计数都是语义的一部分。
  out = out.replace(/\bid[:=]\s*\d+/gi, `id: ${PLACEHOLDER.id}`)

  // 7) 行尾空白与连续空行：展示格式差异
  out = out
    .split('\n')
    .map(line => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return out
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 行级发现的可比较形态：位置 + 正文，不含平台分配的 ID */
export interface ComparableFinding {
  path: string
  line: number
  body: string
}

export function normalizeFindings(
  findings: Array<{path: string; line: number; body: string}>,
  options: NormalizeOptions = {}
): ComparableFinding[] {
  return findings
    .map(f => ({path: f.path, line: f.line, body: normalizeForComparison(f.body, options)}))
    .sort((a, b) => (a.path === b.path ? a.line - b.line : a.path.localeCompare(b.path)))
}
