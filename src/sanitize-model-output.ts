/**
 * sanitize-model-output.ts - 清理 LLM 文本输出中的"引用标记"
 *
 * OpenAI（及兼容 API）的模型在使用 web_search / browse / file_search 等工具时，
 * 会在自然语言文本里插入"citation marker"以指向某个搜索结果。在 ChatGPT 网页端
 * 这些标记会被渲染为可点击的内联引用，但通过 API 拿到的 raw 文本里它们以原样
 * 出现，看起来像乱码。
 *
 * 已观察到的形态（持续更新）：
 *
 *   1. 私有区（U+E000-U+F8FF）包裹：
 *        `<E200>cite<E200>turn0search0<E201>`
 *      早期 OpenAI 模型常用，PUA 字符在 GitHub PR 评论里通常显示为豆腐块。
 *
 *   2. **Block Elements（U+2580-U+259F）包裹**：
 *        `▌cite▌turn0search0▌`
 *      2026-05 起观察到的新格式，用 `▌`（U+258C LEFT HALF BLOCK）做分隔符。
 *      用户上报"评论区出现乱码"的实际形态。
 *
 *   3. 零宽空白（U+200B-U+200F）混杂：偶尔出现在标记中间。
 *
 *   4. 完全裸文本：分隔符被前端或复制粘贴吞掉时，剩 `citeturn0search0` 这种。
 *
 * ai-reviewer 把 LLM 输出直接贴到 GitHub PR 评论，所以必须先剥这些标记，否则
 * 评审者看到的就是一串无意义的字符。
 *
 * 设计原则：
 *   - 只剥已知的 citation marker 模式，**不动**其他文本
 *   - 不尝试还原成 markdown 链接（拿不到原始 URL；OpenAI Responses API 把
 *     URL 放在 annotations 字段，而非 inline 文本里）—— 直接删除是最稳妥的
 *   - **不**做全局空白折叠（会破坏代码块缩进）；只把紧贴标记的空白连同删除
 */

/**
 * 引用分隔符的字符集：PUA + Block Elements + 零宽空白
 *
 * 用 character class 同时覆盖三类。未来再出新形态在这里加范围即可。
 */
const SEPARATOR_CHARS = '\\uE000-\\uF8FF\\u2580-\\u259F\\u200B-\\u200F'

/** 匹配单个"分隔符"字符（孤立残留时清掉） */
const SEPARATOR_RE = new RegExp(`[${SEPARATOR_CHARS}]`, 'g')

/**
 * source 后缀列表（已知的 OpenAI 工具名）—— 保留扩展空间，将来出新工具就在
 * 这里加。
 */
const SOURCE_SUFFIXES = 'search|file|sg|tab|news|video|image|web|browser'

/**
 * 匹配"完整的"分隔符包裹引用，**显式覆盖 `cite ... turnN sourceN` 全结构**。
 *
 * 早期版本写 `[sep]+cite[\s\S]*?[sep]+` 时，遇到 `▌cite▌turn0search0▌`（分隔符
 * 在 cite 与 turn 之间出现一次）会因为 lazy 匹配在中间那个 `▌` 处停下，留下
 * `turn0search0▌` 没剥掉。所以这里把后缀模式也加进来，确保整段一次性吃掉。
 *
 * 允许中间穿插任意分隔符 / 字母（OpenAI 见过 `▌cite▌turn0search0▌`、
 * `<E200>cite<ZWSP>turn0search0<E201>`、`citenavturn0search0` 等多种排列）。
 */
const WRAPPED_CITATION_RE = new RegExp(
  `[${SEPARATOR_CHARS}]+cite[${SEPARATOR_CHARS}a-z]{0,12}turn\\d+(?:${SOURCE_SUFFIXES})\\d+[${SEPARATOR_CHARS}]*`,
  'gi'
)

/**
 * Pass 1：匹配"前面带空白"的裸引用标记，**连同前导空白一起**删掉。
 * 这处理最常见的"句子中间穿插引用"情形：`text X text` → `text text`。
 */
const BARE_CITATION_WITH_LEADING_WS_RE = new RegExp(
  `[ \\t]+cite[a-z]{0,12}turn\\d+(?:${SOURCE_SUFFIXES})\\d+`,
  'gi'
)

/**
 * Pass 2：匹配"无前导空白"的裸引用标记（行首、紧跟非空白字符等），**连同
 * 后续空白一起**删掉。这处理 CJK 文本紧跟标记（中文标点前后无空格）以及标
 * 记出现在字符串/段落开头的情形。
 */
const BARE_CITATION_AT_BOUNDARY_RE = new RegExp(
  `cite[a-z]{0,12}turn\\d+(?:${SOURCE_SUFFIXES})\\d+[ \\t]*`,
  'gi'
)

/**
 * 清理模型输出中的引用标记
 *
 * **不**做全局的空白折叠或换行折叠 —— 这会破坏 markdown 代码块、diff 块、
 * 表格等有意义的空白结构。只把标记本身和**紧贴标记**的空白删掉。
 *
 * @param text LLM 原始返回的文本
 * @returns 剥离引用标记后的文本；输入是空串/null 时原样返回
 */
import {getLogger} from './platform/logger'

export function sanitizeModelOutput(text: string): string {
  if (text == null || text.length === 0) return text

  let out = text

  // 第一步：剥离完整的分隔符包裹引用（PUA / Block Elements / 混合）
  out = out.replace(WRAPPED_CITATION_RE, '')

  // 第二步：处理裸文本形式 — 先吃"带前导空白"的（最常见），再吃边界处的
  out = out.replace(BARE_CITATION_WITH_LEADING_WS_RE, '')
  out = out.replace(BARE_CITATION_AT_BOUNDARY_RE, '')

  // 第三步：清掉任何残留的孤立分隔符字符
  out = out.replace(SEPARATOR_RE, '')

  // SEC-008：原先是无条件 console.log 整段模型输入/输出——既绕过脱敏，
  // 又把 PR 内容和模型返回原样打进日志。改走 Logger 的 debug 级：
  // GitHub 侧经 redactForLog 脱敏，且只有开启 debug 时才输出。
  const logger = getLogger()
  logger.debug(`sanitize input: ${JSON.stringify(text)}`)
  logger.debug(`sanitize output: ${JSON.stringify(out)}`)

  return out
}
