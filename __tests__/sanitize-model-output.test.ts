/**
 * sanitize-model-output.test.ts — LLM 引用标记剥离测试
 *
 * 复现用户反馈："评论区出现了乱码 ... citeturn0search0"。验证修复后这类标记
 * 不再泄漏到最终 PR 评论。
 *
 * 覆盖：
 *   - 裸文本形式（分隔符被复制粘贴吞掉的常见情况）
 *   - PUA 字符包裹（早期 OpenAI 输出，U+E200/U+E201）
 *   - Block Element 字符包裹（新版 OpenAI 输出，U+258C `▌`） — 用户实际报错的形态
 *   - 多种来源后缀（search / file / sg / news 等）
 *   - 一段文本中多处出现
 *   - 与正常代码块 / 反引号文本共存（不能误伤）
 *   - 空字符串 / 不含标记的文本（不能改变内容）
 *
 * 测试源代码里**不**直接写不可见的 PUA / Block 字符，用 `String.fromCharCode`
 * 构造，避免编辑器乱码。
 */

import {describe, expect, jest, test} from '@jest/globals'

jest.mock('@actions/core', () => ({
  info: jest.fn(),
  warning: jest.fn()
}))

import {sanitizeModelOutput} from '../src/sanitize-model-output'

/** 构造 PUA 包裹的引用标记：`<E200>cite<E200>turn0search0<E201>` */
const PUA_START = String.fromCharCode(0xe200)
const PUA_END = String.fromCharCode(0xe201)
const ZWSP = String.fromCharCode(0x200b)

/** 构造 Block Element 包裹的引用标记：`▌cite▌turn0search0▌`（用户实际遇到的） */
const HALF_BLOCK = String.fromCharCode(0x258c) // ▌

describe('sanitizeModelOutput — 裸文本引用标记', () => {
  test('剥离用户实际遇到的乱码（citeturn0search0）', () => {
    const input = 'TS2339 指出的不是"类型小问题"，而是这里会在编译阶段直接失败。citeturn0search0'
    const out = sanitizeModelOutput(input)
    expect(out).not.toMatch(/cite[a-z]*turn/i)
    expect(out).toContain('TS2339')
    expect(out.endsWith('citeturn0search0')).toBe(false)
  })

  test('剥离一段文本中的多个标记', () => {
    const input = 'A说citeturn0search0，B说citeturn1search3，C 没说citeturn2file2。'
    const out = sanitizeModelOutput(input)
    expect(out).not.toMatch(/cite[a-z]*turn/i)
    expect(out).toContain('A说')
    expect(out).toContain('B说')
    expect(out).toContain('C 没说')
  })

  test('支持非 search 后缀（file / sg / news / video / image / web / browser）', () => {
    const cases = [
      'foociteturn0file0bar',
      'foociteturn1sg2bar',
      'foociteturn0tab0bar',
      'foociteturn0news5bar',
      'foociteturn0video0bar',
      'foociteturn0image0bar',
      'foociteturn0web0bar',
      'foociteturn0browser0bar'
    ]
    for (const c of cases) {
      const out = sanitizeModelOutput(c)
      expect(out).toBe('foobar')
    }
  })

  test('支持 cite 与 turn 之间出现的字母前缀（如 citenavturn0search0）', () => {
    const input = 'foo citenavturn0search0 bar citeturn0search0 baz'
    const out = sanitizeModelOutput(input)
    expect(out).toBe('foo bar baz')
  })
})

describe('sanitizeModelOutput — 分隔符包裹形式（PUA / Block Elements）', () => {
  test('PUA 字符（U+E200/E201）完整包裹的引用被剥离', () => {
    const input = `前缀 ${PUA_START}cite${ZWSP}turn0search0${PUA_END} 后缀`
    const out = sanitizeModelOutput(input)
    expect(out).not.toContain(PUA_START)
    expect(out).not.toContain(PUA_END)
    expect(out).not.toContain('cite')
    expect(out).toContain('前缀')
    expect(out).toContain('后缀')
  })

  test('Block Element（U+258C ▌）完整包裹的引用被剥离 — 用户实际遇到的形态', () => {
    // 复现第二张截图：`▌cite▌turn0search0▌`
    const marker = `${HALF_BLOCK}cite${HALF_BLOCK}turn0search0${HALF_BLOCK}`
    const input = `...避免污染正常模块的编译结果。${marker}`
    const out = sanitizeModelOutput(input)
    expect(out).not.toContain(HALF_BLOCK)
    expect(out).not.toContain('cite')
    expect(out).not.toContain('turn0search0')
    expect(out).toContain('避免污染正常模块的编译结果。')
  })

  test('混合分隔符（一头 PUA、一头 Block）也能识别', () => {
    const input = `prefix ${PUA_START}cite${HALF_BLOCK}turn0search0${HALF_BLOCK} suffix`
    const out = sanitizeModelOutput(input)
    expect(out).not.toMatch(/cite/)
    expect(out).toContain('prefix')
    expect(out).toContain('suffix')
  })

  test('剥离孤立分隔符字符（包裹不完整时的兜底）', () => {
    const input = `hello ${PUA_START} stray ${HALF_BLOCK} world ${PUA_END} lone`
    const out = sanitizeModelOutput(input)
    expect(out).not.toContain(PUA_START)
    expect(out).not.toContain(PUA_END)
    expect(out).not.toContain(HALF_BLOCK)
    expect(out).toContain('hello')
    expect(out).toContain('world')
  })
})

describe('sanitizeModelOutput — 不应误伤正常文本', () => {
  test('正常文本一字不改（无标记）', () => {
    const input = `## 函数 calculateTotal

这个函数有两个 bug：
1. \`items.map()\` 缺少 return
2. 累加 quantity 而非 quantity * price

修复：
\`\`\`diff
-    total += item.quantity
+    total += item.quantity * item.price
\`\`\``
    expect(sanitizeModelOutput(input)).toBe(input)
  })

  test('代码块中类似但不完全相同的字符串不被剥离', () => {
    const input = 'function cite() { return 1; }\nconst x = citation'
    const out = sanitizeModelOutput(input)
    expect(out).toContain('function cite()')
    expect(out).toContain('citation')
  })

  test('空字符串原样返回', () => {
    expect(sanitizeModelOutput('')).toBe('')
  })

  test('仅空白文本原样返回', () => {
    expect(sanitizeModelOutput('   \n   ')).toBe('   \n   ')
  })

  test('包含合法标点和换行的常见 AI 评论原样保留', () => {
    const input = `## ⚠️ Potential issue | 🔴 Critical

This map callback doesn't return a value.

\`\`\`diff
-    total += item.quantity
+    return total + item.quantity * item.price
\`\`\`

🧰 Tools
🪛 ESLint (9.15.0)
[error] 29-29: Expected to return a value in callback of array method.
(array-callback-return)`
    expect(sanitizeModelOutput(input)).toBe(input)
  })
})

describe('sanitizeModelOutput — 收尾整理（标记紧贴的空白连同删除）', () => {
  test('标记前后都有空格时整体替换为单空格（不会留双空格）', () => {
    const input = 'before citeturn0search0 after'
    expect(sanitizeModelOutput(input)).toBe('before after')
  })

  test('标记紧贴标点时，前导空格连同标记一起删，标点紧贴前一个词', () => {
    const input = 'sentence citeturn0search0.'
    expect(sanitizeModelOutput(input)).toBe('sentence.')
  })

  test('标记在字符串开头时，标记 + 紧贴的尾随空格一起删', () => {
    const input = 'citeturn0search0 leading marker text'
    expect(sanitizeModelOutput(input)).toBe('leading marker text')
  })

  test('**不**做全局空白折叠：连续多换行 / 多空格被原样保留', () => {
    const input = 'para1\n\n\n\npara2'
    expect(sanitizeModelOutput(input)).toBe(input)

    const indented = 'function foo() {\n    return 1;\n}'
    expect(sanitizeModelOutput(indented)).toBe(indented)
  })
})
