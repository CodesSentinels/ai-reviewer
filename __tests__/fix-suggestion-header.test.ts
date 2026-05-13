/**
 * fix-suggestion-header.test.ts — 测试 `diff` 块的 `<details>` 折叠包装
 *
 * 与早期版本（粗体标头）的区别：现在统一用 `<details><summary>🔧 Suggested fix</summary>`
 * 折叠交互，跟既有的 "🧩 Analysis chain" 风格保持一致。
 *
 * 覆盖：
 *   - 裸 ```diff 块自动被 <details> 包裹
 *   - 已有 <details>+🔧 标记的 diff 块不被重复包
 *   - 非 diff 块（typescript / bash 等）不被动
 *   - 一条评论中多个 diff 块各自获得独立 <details>
 *   - 中文 / 韩文等本地化标头也认（不重复）
 *   - GFM 渲染必需的空行结构正确（summary↔代码块、代码块↔/details）
 */

import {describe, expect, jest, test} from '@jest/globals'

jest.mock('@actions/core', () => ({
  info: jest.fn(),
  warning: jest.fn()
}))

import {ensureFixSuggestionHeaders} from '../src/fix-suggestion-header'

describe('ensureFixSuggestionHeaders — <details> 包装主路径', () => {
  test('裸 diff 块被包进 <details>，summary 含 🔧 Suggested fix', () => {
    const input = `这里有个错误。

\`\`\`diff
-const x = 1
+const x = 2
\`\`\``
    const out = ensureFixSuggestionHeaders(input)

    expect(out).toContain('<details>')
    expect(out).toContain('<summary>🔧 Suggested fix</summary>')
    expect(out).toContain('</details>')
    // <details> 必须在 diff 块之前
    expect(out.indexOf('<details>')).toBeLessThan(out.indexOf('```diff'))
    // </details> 必须在 diff 闭合后
    const lastDiffEnd = out.lastIndexOf('```')
    expect(out.indexOf('</details>')).toBeGreaterThan(lastDiffEnd)
  })

  test('GFM 渲染要求：summary 与 ```diff 之间有空行', () => {
    const input = `分析。

\`\`\`diff
-a
+b
\`\`\``
    const out = ensureFixSuggestionHeaders(input)
    expect(out).toMatch(
      /<summary>🔧 Suggested fix<\/summary>\n\n```diff/
    )
  })

  test('GFM 渲染要求：```diff 闭合与 </details> 之间有空行', () => {
    const input = '\`\`\`diff\n-a\n+b\n\`\`\`'
    const out = ensureFixSuggestionHeaders(input)
    expect(out).toMatch(/```\n\n<\/details>/)
  })

  test('已包过 <details>+🔧 时不重复包', () => {
    const input = `<details>
<summary>🔧 Suggested fix</summary>

\`\`\`diff
-a
+b
\`\`\`

</details>`
    const out = ensureFixSuggestionHeaders(input)
    // 只应出现一次 <details>
    expect((out.match(/<details>/g) ?? []).length).toBe(1)
    expect((out.match(/<\/details>/g) ?? []).length).toBe(1)
  })

  test('已包过 <details>+🔧 修复建议（中文本地化）也不重复包', () => {
    const input = `<details>
<summary>🔧 修复建议</summary>

\`\`\`diff
-a
+b
\`\`\`

</details>`
    const out = ensureFixSuggestionHeaders(input)
    expect((out.match(/<details>/g) ?? []).length).toBe(1)
    expect(out).toContain('🔧 修复建议') // 用户的本地化文字保留
  })

  test('一条评论中 2 个 diff 块各自获得独立 <details>', () => {
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
    expect((out.match(/<details>/g) ?? []).length).toBe(2)
    expect((out.match(/<\/details>/g) ?? []).length).toBe(2)
    expect((out.match(/🔧 Suggested fix/g) ?? []).length).toBe(2)
  })

  test('混合：第一个 diff 已有 details，第二个裸 → 只包第二个', () => {
    const input = `<details>
<summary>🔧 修复建议</summary>

\`\`\`diff
-a
+b
\`\`\`

</details>

另一处：

\`\`\`diff
-c
+d
\`\`\``
    const out = ensureFixSuggestionHeaders(input)
    expect((out.match(/<details>/g) ?? []).length).toBe(2)
    expect(out).toContain('🔧 修复建议') // 旧的本地化保留
    expect(out).toContain('🔧 Suggested fix') // 新包的英文标头
  })
})

describe('ensureFixSuggestionHeaders — 不应误伤', () => {
  test('无 diff 块的纯文本评论原样返回', () => {
    const input = '这只是一段分析文字，没有任何代码块。'
    expect(ensureFixSuggestionHeaders(input)).toBe(input)
  })

  test('非 diff 代码块（```typescript）不动', () => {
    const input = `示例：

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

  test('🔧 emoji 单独出现但不在 <details> 里 → diff 块仍会被包', () => {
    // 比如评论里恰好提到"使用 🔧 工具"但没有 fix 上下文
    const input = `这个模块在 🔧 工具栏里有快捷键。

\`\`\`diff
-old
+new
\`\`\``
    const out = ensureFixSuggestionHeaders(input)
    expect(out).toContain('<details>')
    expect(out).toContain('🔧 Suggested fix')
  })

  test('未闭合的 ```diff 块（异常输入）不被包，原样返回', () => {
    const input = `分析。

\`\`\`diff
-a
+b
（漏写了闭合 fence）`
    const out = ensureFixSuggestionHeaders(input)
    expect(out).not.toContain('<details>')
    expect(out).toBe(input)
  })
})

describe('ensureFixSuggestionHeaders — 与既有 Analysis chain 风格一致', () => {
  test('生成的 markdown 与 Analysis chain 同款（详见 review.ts::formatAnalysisChain）', () => {
    const input = '\`\`\`diff\n-a\n+b\n\`\`\`'
    const out = ensureFixSuggestionHeaders(input)
    // 结构应该是：
    // <details>
    // <summary>...</summary>
    // <blank>
    // ```diff ... ```
    // <blank>
    // </details>
    expect(out).toMatch(
      /^<details>\n<summary>🔧 Suggested fix<\/summary>\n\n```diff\n[\s\S]*?\n```\n\n<\/details>$/
    )
  })
})
