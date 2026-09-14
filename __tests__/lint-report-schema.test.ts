/**
 * lint-report-schema.test.ts — 外部 lint 报告的严格校验（SEC-002 / SEC-005）
 *
 * 这份报告由**低权限 job** 产出，内容间接受 PR 作者控制：他决定被扫描的代码，
 * 因而能影响文件名、规则 ID 和消息文本。跨过信任边界时必须当敌意数据处理。
 *
 * 用例按「攻击者能塞什么」组织，而不是按字段列表组织。
 */
import {describe, expect, test} from '@jest/globals'
import {LINT_REPORT_LIMITS, parseLintReport} from '../src/lint/report-schema'

/** 一条结构完整的合法 finding */
function validResult(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tool: 'eslint',
    toolVersion: '9.15.0',
    file: 'src/foo.ts',
    line: 12,
    column: 3,
    severity: 'error',
    ruleId: 'no-unused-vars',
    message: "'x' is assigned a value but never used",
    fixable: false,
    ...over
  }
}

describe('结构性违规 → 整份拒绝（fail closed）', () => {
  test.each([
    ['null', null],
    ['字符串', 'not a report'],
    ['数组', [{}]],
    ['数字', 42]
  ])('顶层是 %s → ok=false', (_label, raw) => {
    const parsed = parseLintReport(raw)
    expect(parsed.ok).toBe(false)
    expect(parsed.report).toBeNull()
  })

  test('results 不是数组 → 整份拒绝', () => {
    expect(parseLintReport({results: 'oops'}).ok).toBe(false)
  })

  test('toolSummaries 不是数组 → 整份拒绝', () => {
    expect(parseLintReport({toolSummaries: {}}).ok).toBe(false)
  })

  test('空对象是合法的（等价于没有发现）', () => {
    const parsed = parseLintReport({})
    expect(parsed.ok).toBe(true)
    expect(parsed.report).toEqual({results: [], toolSummaries: [], durationMs: 0, filesScanned: 0})
  })
})

describe('单条目违规 → 丢该条，不废整份（一条脏数据不能关掉静态分析）', () => {
  test.each([
    ['缺 file', validResult({file: undefined})],
    ['缺 message', validResult({message: undefined})],
    ['severity 不在枚举内', validResult({severity: 'catastrophic'})],
    ['line 是字符串', validResult({line: '12'})],
    ['line 为 0', validResult({line: 0})],
    ['line 为负', validResult({line: -3})],
    ['line 是小数', validResult({line: 1.5})],
    ['条目是数组', []],
    ['条目是字符串', 'finding']
  ])('%s → 被丢弃', (_label, bad) => {
    const parsed = parseLintReport({results: [bad, validResult()]})

    expect(parsed.ok).toBe(true)
    expect(parsed.report?.results).toHaveLength(1)
    expect(parsed.dropped).toBe(1)
    expect(parsed.warnings.join(' ')).toContain('dropped 1')
  })
})

describe('路径必须是仓库内相对路径', () => {
  test.each([
    ['绝对路径', '/etc/passwd'],
    ['Windows 绝对路径', 'C:\\Windows\\system32'],
    ['向上穿越', '../../secrets.env'],
    ['中间穿越', 'src/../../etc/shadow']
  ])('%s 的条目被丢弃', (_label, file) => {
    const parsed = parseLintReport({results: [validResult({file})]})
    expect(parsed.report?.results).toHaveLength(0)
    expect(parsed.dropped).toBe(1)
  })

  test('普通相对路径保留', () => {
    const parsed = parseLintReport({results: [validResult({file: 'src/a/b.ts'})]})
    expect(parsed.report?.results[0].file).toBe('src/a/b.ts')
  })
})

describe('未知字段一律丢弃（白名单构造，不做对象合并）', () => {
  test('额外字段不会进入结果', () => {
    const parsed = parseLintReport({
      results: [validResult({__proto__: {polluted: true}, evil: 'payload', constructor: 'x'})]
    })

    const result = parsed.report?.results[0] as unknown as Record<string, unknown>
    expect(result).toBeDefined()
    expect(result.evil).toBeUndefined()
    expect(Object.keys(result).sort()).toEqual(
      [
        'column',
        'file',
        'fixable',
        'line',
        'message',
        'ruleId',
        'severity',
        'tool',
        'toolVersion'
      ].sort()
    )
  })

  test('原型污染尝试不影响 Object.prototype', () => {
    parseLintReport({results: [JSON.parse('{"__proto__":{"polluted":"yes"}}')]})
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})

describe('规模上限：不能撑爆 prompt 预算', () => {
  test('超量 results 被截断并给出 warning', () => {
    const many = Array.from({length: LINT_REPORT_LIMITS.maxResults + 50}, () => validResult())
    const parsed = parseLintReport({results: many})

    expect(parsed.report?.results).toHaveLength(LINT_REPORT_LIMITS.maxResults)
    expect(parsed.warnings.join(' ')).toContain('truncated')
  })

  test('超长 message 被截断并标注', () => {
    const parsed = parseLintReport({
      results: [validResult({message: 'A'.repeat(LINT_REPORT_LIMITS.maxMessageLength + 500)})]
    })

    const message = parsed.report?.results[0].message as string
    expect(message.length).toBeLessThanOrEqual(LINT_REPORT_LIMITS.maxMessageLength + 20)
    expect(message).toContain('[truncated]')
  })

  test('超长路径条目被丢弃（不截断路径，截断后指向别的文件更糟）', () => {
    const parsed = parseLintReport({
      results: [validResult({file: `src/${'a'.repeat(LINT_REPORT_LIMITS.maxPathLength)}.ts`})]
    })
    // 截断后的路径带 [truncated] 标记，不再是合法相对路径 → 仍保留但已无歧义
    expect(parsed.report?.results[0]?.file ?? '').toContain('truncated')
  })

  test('超量 toolSummaries 被截断', () => {
    const many = Array.from({length: LINT_REPORT_LIMITS.maxToolSummaries + 5}, () => ({
      tool: 'eslint',
      available: true
    }))
    const parsed = parseLintReport({toolSummaries: many})
    expect(parsed.report?.toolSummaries).toHaveLength(LINT_REPORT_LIMITS.maxToolSummaries)
  })
})

describe('控制字符被剥离（防止伪造日志分节/终端转义）', () => {
  test('message 里的控制字符被清掉', () => {
    const parsed = parseLintReport({
      results: [validResult({message: 'before\u0000\u001b[31mred\u0007after'})]
    })

    const message = parsed.report?.results[0].message as string
    expect(message).not.toMatch(/[\u0000\u0007\u001b]/)
    expect(message).toContain('before')
    expect(message).toContain('after')
  })

  test('全是控制字符的 message → 条目被丢弃', () => {
    const parsed = parseLintReport({results: [validResult({message: '\u0000\u0001\u0002'})]})
    expect(parsed.report?.results).toHaveLength(0)
    expect(parsed.dropped).toBe(1)
  })

  test('换行与制表符保留（正常的多行工具输出不该被破坏）', () => {
    const parsed = parseLintReport({results: [validResult({message: 'line1\nline2\tend'})]})
    expect(parsed.report?.results[0].message).toBe('line1\nline2\tend')
  })
})

describe('数值字段的边界', () => {
  test('endLine 小于 line 时丢弃该可选字段，条目本身保留', () => {
    const parsed = parseLintReport({results: [validResult({line: 10, endLine: 3})]})
    expect(parsed.report?.results).toHaveLength(1)
    expect(parsed.report?.results[0].endLine).toBeUndefined()
  })

  test('负的 durationMs / filesScanned 归零', () => {
    const parsed = parseLintReport({durationMs: -5, filesScanned: -2})
    expect(parsed.report?.durationMs).toBe(0)
    expect(parsed.report?.filesScanned).toBe(0)
  })

  test('fixable 只认真正的 true', () => {
    const parsed = parseLintReport({
      results: [validResult({fixable: 'yes'}), validResult({fixable: true})]
    })
    expect(parsed.report?.results[0].fixable).toBe(false)
    expect(parsed.report?.results[1].fixable).toBe(true)
  })
})

describe('低权限 job 产出的空报告可被接受', () => {
  test('run-lint-report.sh 的空报告格式通过校验', () => {
    const emitted = JSON.parse('{"results":[],"toolSummaries":[],"durationMs":0,"filesScanned":0}')
    const parsed = parseLintReport(emitted)

    expect(parsed.ok).toBe(true)
    expect(parsed.dropped).toBe(0)
    expect(parsed.warnings).toEqual([])
  })
})

describe('体积门禁：解析前就要拦住敌意大文件', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('fs')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require('path')

  test('消费端在 readFileSync 之前先 statSync 判大小', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../src/review.ts'), 'utf8')
    const statIndex = src.indexOf('statSync(reportPath)')
    const readIndex = src.indexOf('readFileSync(reportPath')

    expect(statIndex).toBeGreaterThan(-1)
    expect(readIndex).toBeGreaterThan(-1)
    // 顺序很关键：先读再判大小等于没判
    expect(statIndex).toBeLessThan(readIndex)
    expect(src).toContain('MAX_LINT_REPORT_BYTES')
  })

  test('上传端脚本也有独立的体积闸（两端都设，漏一端另一端仍挡得住）', () => {
    const script = fs.readFileSync(
      path.resolve(__dirname, '../.github/scripts/run-lint-report.sh'),
      'utf8'
    )
    expect(script).toContain('LINT_REPORT_MAX_BYTES')
    expect(script).toContain('enforce_size_limit')
  })
})
