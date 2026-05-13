/**
 * fix-suggestion-header.ts - 为 LLM 评论里的 `diff` 代码块强制添加"🔧 修复建议"标头
 *
 * Prompt 里已经要求 LLM 在 \`\`\`diff 块前加 `**🔧 Suggested fix**` 标头（详见
 * src/prompts.ts），但模型有时会忘掉。本模块作为**后处理 safety net**：扫描评论
 * body，发现"裸"的 diff 块（前面 ~5 行内没有 🔧 标头），就自动注入一行。
 *
 * 设计原则：
 *   - 已有 🔧 标头时**不重复添加**（检查紧邻 diff 块前 5 行内是否含 🔧 与 "fix"/"修复"）
 *   - 非 diff 块（plain code / typescript 等）**不动**，仅针对修复用的 diff 块
 *   - 标头文字使用英文 "Suggested fix"，markdown 里跟 emoji 一起渲染，与
 *     CodeRabbit / ai-reviewer 既有的 "🧰 Tools" 标签风格保持一致；如果模型
 *     已经用本地化文字（如"修复建议"）也保留不覆盖
 *   - 完全本地化（非英文）的 fallback 文字保留模型自主决定，因为不同 PR 评论
 *     的语言由 review 配置的 `language` 决定，我们这里只在**完全没有任何标头**
 *     时补上一个通用英文版本
 */

/** 修复建议标头的统一 markdown 写法（注入时使用） */
const FIX_HEADER = '**🔧 Suggested fix**'

/** 检测一段文本中是否已经有修复建议标头（兼容多种本地化和写法） */
function hasFixHeader(text: string): boolean {
  // 必须含 🔧 emoji + "fix" 或 "修复" 或 "수정" 等已知本地化关键词
  if (!text.includes('🔧')) return false
  return /(fix|修复|수정|fixar|réparer|поправ|correção)/i.test(text)
}

/**
 * 在每个 \`\`\`diff 块前注入 🔧 标头（仅当之前 5 行内未出现标头时）。
 *
 * @param commentBody 单条 AI 评论的 markdown 内容
 * @returns 已注入标头的内容；输入无 diff 块时原样返回
 */
export function ensureFixSuggestionHeaders(commentBody: string): string {
  if (!commentBody.includes('```diff')) return commentBody

  const lines = commentBody.split('\n')
  const out: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '```diff') {
      // 检查前 5 行是否已有标头
      const lookback = out.slice(-5).join('\n')
      if (!hasFixHeader(lookback)) {
        // 注入：如果前一行不是空行，先加空行；然后标头；然后空行；然后 diff
        if (out.length > 0 && out[out.length - 1].trim() !== '') {
          out.push('')
        }
        out.push(FIX_HEADER)
        out.push('')
      }
    }
    out.push(line)
  }

  return out.join('\n')
}
