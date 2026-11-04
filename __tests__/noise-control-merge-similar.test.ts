/**
 * noise-control-merge-similar.test.ts — 同一文件内正文几乎相同的发现合并
 *
 * 回归（FT-093 / FT-094）：一个文件里 10 处 `eval(input)`，每处各发一条逐字相同的评论，
 * 占满评论上限（默认 20），同一文件里另外 20 处 `==` 与除零缺陷一条都没发出来。
 */
import {describe, expect, test} from '@jest/globals'
import {
  mergeSimilarFindings,
  prepareFindings,
  severityBadge,
  type Finding
} from '../src/noise-control'

const EVAL_TEXT =
  '`eval(input)` 直接执行调用方传入的字符串，会把这个导出变成任意代码执行入口。即使这是测试/示例模块，这种实现也会在被复用或误接入时造成高风险安全问题。'
const EQ_TEXT =
  '`a == b` 使用宽松相等，会触发类型转换，应该改成严格相等 `===`，避免把不同类型的值当成相等。'
const DIV_TEXT =
  '`a / b` 没有校验除数是否为 0，`b` 为 0 时会得到 Infinity 或 NaN 并继续传播，应当显式拒绝。'

function finding(
  path: string,
  start: number,
  text: string,
  severity: Finding['severity']
): Finding {
  const body = `${severityBadge(
    severity
  )}\n\n${text}\n\n<details>\n<summary>🔧 修复建议</summary>\n\n\`\`\`diff\n-  return eval(input);\n+  throw new Error('no');\n\`\`\`\n\n</details>`
  return {path, startLine: start, endLine: start + 1, severity, body}
}

describe('mergeSimilarFindings', () => {
  test('同一文件 10 处正文相同的发现 → 合并成 1 条，列出其余 9 个位置', () => {
    const fs = Array.from({length: 10}, (_, i) =>
      finding('noise/many.ts', 3 + i * 12, EVAL_TEXT, 'critical')
    )
    const out = mergeSimilarFindings(fs)
    expect(out).toHaveLength(1)
    expect(out[0].startLine).toBe(3)
    expect(out[0].body).toContain('同一文件另有 9 处同类问题')
    expect(out[0].body).toContain('L15-16')
    expect(out[0].body).toContain('L111-112')
  })

  test('回归场景：30 个缺陷（10 eval + 10 == + 10 除零）在上限 20 内，三类都至少保留一条', () => {
    const fs: Finding[] = []
    for (let i = 0; i < 10; i++) {
      fs.push(finding('noise/many.ts', 3 + i * 12, EVAL_TEXT, 'critical'))
      fs.push(finding('noise/many.ts', 6 + i * 12, EQ_TEXT, 'major'))
      fs.push(finding('noise/many.ts', 9 + i * 12, DIV_TEXT, 'major'))
    }
    // 其他文件另有 15 条各不相同的发现，把上限逼紧
    const others = Array.from({length: 15}, (_, i) =>
      finding(
        `other/f${i}.ts`,
        1,
        `问题编号 ${i}：函数 \`fn${i}\` 的边界处理有误，会在输入为空时返回错误结果并影响调用方。`,
        'major'
      )
    )
    const merged = mergeSimilarFindings([...fs, ...others])
    expect(merged).toHaveLength(3 + 15)
    const {kept, truncated} = prepareFindings(merged, {dedupe: false, maxComments: 20})
    expect(truncated).toBe(0)
    const texts = kept.filter(k => k.path === 'noise/many.ts').map(k => k.body)
    expect(texts.some(b => b.includes('eval(input)'))).toBe(true)
    expect(texts.some(b => b.includes('a == b'))).toBe(true)
    expect(texts.some(b => b.includes('a / b'))).toBe(true)
  })

  test('不同文件的相同正文不合并（各文件各留一条）', () => {
    const out = mergeSimilarFindings([
      finding('a.ts', 1, EVAL_TEXT, 'critical'),
      finding('b.ts', 1, EVAL_TEXT, 'critical')
    ])
    expect(out).toHaveLength(2)
    expect(out[0].body).not.toContain('另有')
  })

  test('正文不相似的发现不合并', () => {
    const out = mergeSimilarFindings([
      finding('a.ts', 1, EVAL_TEXT, 'critical'),
      finding('a.ts', 20, EQ_TEXT, 'major')
    ])
    expect(out).toHaveLength(2)
  })

  test('只差个别词（如行号、变量名）的近似正文也合并，严重级别取最高', () => {
    const a = finding('a.ts', 1, `${EVAL_TEXT} 位置一。`, 'minor')
    const b = finding('a.ts', 30, `${EVAL_TEXT} 位置二。`, 'critical')
    const out = mergeSimilarFindings([a, b])
    expect(out).toHaveLength(1)
    expect(out[0].severity).toBe('critical')
  })

  test('保持原有顺序；没有可合并项时原样返回', () => {
    const fs = [
      finding('a.ts', 1, EVAL_TEXT, 'critical'),
      finding('b.ts', 1, EQ_TEXT, 'major'),
      finding('c.ts', 1, DIV_TEXT, 'major')
    ]
    expect(mergeSimilarFindings(fs).map(f => f.path)).toEqual(['a.ts', 'b.ts', 'c.ts'])
  })

  test('正文几乎没有文字时不合并（保守）', () => {
    const out = mergeSimilarFindings([
      finding('a.ts', 1, 'ok', 'minor'),
      finding('a.ts', 5, 'ok', 'minor')
    ])
    expect(out).toHaveLength(2)
  })

  test('空输入', () => {
    expect(mergeSimilarFindings([])).toEqual([])
  })
})
