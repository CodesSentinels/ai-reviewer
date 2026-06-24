/**
 * fix-suggestion-header.ts - 把 LLM 评论里的 `diff` 代码块包进可折叠的
 * `<details><summary>🔧 Suggested fix</summary>` 块
 *
 * 与之前实现差异：早期实现只在 diff 前加 `**🔧 Suggested fix**` 粗体标头，
 * 但与现有 "🧩 Analysis chain" 的交互风格不一致。改为统一用
 * `<details>/<summary>` 折叠组件，默认收起，点击展开看到 diff —— 让 PR 评
 * 论区更清爽，长 diff 也不刷屏。
 *
 * 设计原则：
 *   - 已经被 `<details>` 包裹（且 summary 含 🔧 / fix / 修复 等关键词）时
 *     **不重复包**
 *   - 非 diff 代码块（```typescript / ```bash 等）不动
 *   - 一条评论中多个 diff 块各自获得独立的 `<details>`
 *   - GitHub Flavored Markdown 要求 `<summary>` 与代码块之间有空行，否则
 *     代码块不会渲染 —— 注入时保证这一点
 */

import {info} from '@actions/core'

const SUMMARY_LINE = '<summary>🔧 Suggested fix</summary>'
/** 标头识别关键词（含本地化变体）— 用于判定"是否已经包过" */
const FIX_KEYWORDS_RE = /(fix|修复|수정|fixar|réparer|поправ|correção)/i

/**
 * 检测一段（紧贴 diff 块之前的）文本是否含已知的"修复建议"标记
 *
 * 同时识别两种形态：
 *   - 新格式：`<summary>🔧 Suggested fix</summary>`（或本地化）
 *   - 旧/兼容格式：`**🔧 Suggested fix**` 粗体
 */
function hasFixMarker(text: string): boolean {
  if (!text.includes('🔧')) return false
  return FIX_KEYWORDS_RE.test(text)
}

/**
 * 把每个 ```diff 块包进 `<details>` 折叠块。
 *
 * @param commentBody 单条 AI 评论的 markdown 内容
 * @returns 已包好的内容；输入无 diff 块时原样返回
 */
export function ensureFixSuggestionHeaders(commentBody: string): string {
  if (!commentBody.includes('```diff')) return commentBody

  const lines = commentBody.split('\n')
  const out: string[] = []
  let wrappedCount = 0
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    if (line.trim() === '```diff') {
      // 找到这个 diff 块的结束位置
      let endIdx = -1
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim() === '```') {
          endIdx = j
          break
        }
      }
      if (endIdx === -1) {
        // 没找到闭合 fence — 异常情况，原样输出，不包
        out.push(line)
        i++
        continue
      }

      // 检查是否已经在 <details> 里
      const lookback = out.slice(-5).join('\n')
      const lookahead = lines.slice(endIdx + 1, endIdx + 6).join('\n')
      const alreadyWrapped =
        lookback.includes('<details>') &&
        hasFixMarker(lookback) &&
        lookahead.includes('</details>')

      if (alreadyWrapped) {
        // 原样照搬整个 diff 块
        for (let k = i; k <= endIdx; k++) out.push(lines[k])
        i = endIdx + 1
        continue
      }

      // 注入 <details> 包装
      // 1) 前一行不是空行时先补一行（让 details 块独立成段）
      if (out.length > 0 && out[out.length - 1].trim() !== '') {
        out.push('')
      }
      out.push('<details>')
      out.push(SUMMARY_LINE)
      // GFM：summary 与代码块之间必须有空行，否则代码块不渲染
      out.push('')
      // 把 diff 块原样塞进去
      for (let k = i; k <= endIdx; k++) out.push(lines[k])
      // 闭合 details 前留一行空行
      out.push('')
      out.push('</details>')
      wrappedCount += 1

      i = endIdx + 1
    } else {
      out.push(line)
      i++
    }
  }

  if (wrappedCount > 0) {
    info(`[fix-header] wrapped ${wrappedCount} diff block(s) in <details>`)
  }
  return out.join('\n')
}
