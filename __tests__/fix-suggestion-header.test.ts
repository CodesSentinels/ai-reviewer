/**
 * fix-suggestion-header.test.ts — 修复建议标头注入 post-process 测试
 *
 * 验证 ensureFixSuggestionHeaders：
 *   - 裸 ```diff 块前会自动注入 **🔧 Suggested fix** 标头
 *   - 已有标头（含 🔧 + "fix" / "修复" / 其他本地化）时**不重复**注入
 *   - 非 diff 代码块（```typescript / ```bash 等）不被动
 *   - 一条评论中多个 diff 块各自获得标头
 *   - 空字符串 / 无 diff 块的纯文本原样返回
 */

import {describe, expect, jest, test} from '@jest/globals'

jest.mock('@actions/core', () => ({
  info: jest.fn(),
  warning: jest.fn()
}))

import {ensureFixSuggestionHeaders} from '../src/fix-suggestion-header'

describe('ensureFixSuggestionHeaders — 主路径', () => {
  test('裸 diff 块（无标头）自动注入 🔧 标头', () => {
    const input = `这里有个错误。

\`\`\`diff
-const x = 1
+const x = 2
\`\`\``
    const out = ensureFixSuggestionHeaders(input)
    expect(out).toContain('**🔧 Suggested fix**')
    // 标头应该在 diff 块之前
    const headerIdx = out.indexOf('**🔧 Suggested fix**')
    const diffIdx = out.indexOf('```diff')
    expect(headerIdx).toBeLessThan(diffIdx)
  })

  test('已含 🔧 + "Suggested fix" 标头时不重复注入', () => {
    const input = `**🔧 Suggested fix**

\`\`\`diff
-const x = 1
+const x = 2
\`\`\``
    const out = ensureFixSuggestionHeaders(input)
    // 只应该出现一次
    const headerCount = (out.match(/🔧/g) ?? []).length
    expect(headerCount).toBe(1)
  })

  test('已含 🔧 + "修复建议"（中文本地化）时不重复注入', () => {
    const input = `**🔧 修复建议**

\`\`\`diff
-const x = 1
+const x = 2
\`\`\``
    const out = ensureFixSuggestionHeaders(input)
    expect(out).toBe(input) // 完全无改动
  })

  test('一条评论含 2 个 diff 块 → 每个都获得自己的标头', () => {
    const input = `第一处：

\`\`\`diff
-a
+b
\`\`\`

第二处：

\`\`\`diff
-c
+d
\`\`\``
    const out = ensureFixSuggestionHeaders(input)
    const headerCount = (out.match(/🔧 Suggested fix/g) ?? []).length
    expect(headerCount).toBe(2)
  })

  test('混合情况：第一个 diff 块已有标头，第二个没有 → 只给第二个补', () => {
    const input = `**🔧 修复建议**

\`\`\`diff
-a
+b
\`\`\`

另外这里也有问题：

\`\`\`diff
-c
+d
\`\`\``
    const out = ensureFixSuggestionHeaders(input)
    const headerCount = (out.match(/🔧/g) ?? []).length
    // 第一个 🔧 修复建议保留，第二个新增 🔧 Suggested fix
    expect(headerCount).toBe(2)
    expect(out).toContain('🔧 修复建议')
    expect(out).toContain('🔧 Suggested fix')
  })
})

describe('ensureFixSuggestionHeaders — 不应误伤', () => {
  test('无 diff 块的纯文本评论原样返回', () => {
    const input = '这只是一段分析文字，没有任何代码块。'
    expect(ensureFixSuggestionHeaders(input)).toBe(input)
  })

  test('非 diff 代码块（```typescript）不动', () => {
    const input = `这里用到了：

\`\`\`typescript
const x: number = 1
\`\`\``
    expect(ensureFixSuggestionHeaders(input)).toBe(input)
  })

  test('非 diff 代码块（```bash）不动', () => {
    const input = '\`\`\`bash\nnpm install\n\`\`\`'
    expect(ensureFixSuggestionHeaders(input)).toBe(input)
  })

  test('空字符串原样返回', () => {
    expect(ensureFixSuggestionHeaders('')).toBe('')
  })

  test('🔧 emoji 出现但没"fix"关键词时仍判定为缺标头（防止误判）', () => {
    // 比如评论里恰好提到"使用 🔧 工具"但没有 Suggested fix 上下文
    const input = `这个模块在 🔧 工具栏里有快捷键。

\`\`\`diff
-old
+new
\`\`\``
    const out = ensureFixSuggestionHeaders(input)
    expect(out).toContain('**🔧 Suggested fix**')
  })
})

describe('ensureFixSuggestionHeaders — 格式细节', () => {
  test('注入的标头前后各有一行空行（让 markdown 渲染干净）', () => {
    const input = `分析文字直接接代码块
\`\`\`diff
-a
+b
\`\`\``
    const out = ensureFixSuggestionHeaders(input)
    // 标头应该独占一行，前后有空行分隔
    expect(out).toMatch(/\n\n\*\*🔧 Suggested fix\*\*\n\n```diff/)
  })

  test('如果前一行已是空行则不补额外空行', () => {
    const input = `分析文字

\`\`\`diff
-a
+b
\`\`\``
    const out = ensureFixSuggestionHeaders(input)
    // 不应该有连续 3 个 \n
    expect(out).not.toMatch(/\n\n\n\*\*🔧/)
  })
})
