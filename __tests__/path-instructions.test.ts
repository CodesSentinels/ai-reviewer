/**
 * path-instructions.test.ts — path_instructions：按路径追加审查指令
 *
 * 覆盖三层：规则解析/匹配（PathInstructions）、提示词渲染（renderReviewFileDiff）、
 * 以及两个平台的配置读取。
 */
import {describe, expect, test} from '@jest/globals'
import {Inputs} from '../src/inputs'
import {PathInstructions} from '../src/options'
import {Prompts} from '../src/prompts'

describe('PathInstructions 解析与匹配', () => {
  test('没有配置时什么都不命中', () => {
    expect(new PathInstructions().match('src/a.ts')).toEqual([])
    expect(new PathInstructions([]).match('src/a.ts')).toEqual([])
  })

  test('按 glob 命中，未命中的路径不带指令', () => {
    const pi = new PathInstructions(['src/api/**: 校验入参', '__tests__/**: 关注断言'])
    expect(pi.match('src/api/user.ts')).toEqual(['校验入参'])
    expect(pi.match('__tests__/a.test.ts')).toEqual(['关注断言'])
    expect(pi.match('src/other/a.ts')).toEqual([])
  })

  test('同一文件命中多条规则时按配置顺序全部返回', () => {
    const pi = new PathInstructions(['src/**: 第一条', 'src/api/**: 第二条', 'docs/**: 不相关'])
    expect(pi.match('src/api/user.ts')).toEqual(['第一条', '第二条'])
  })

  test('只在第一个 ": " 处切分，指令里可以带冒号', () => {
    const pi = new PathInstructions(['src/**: 注意：金额必须用 Decimal'])
    expect(pi.match('src/a.ts')).toEqual(['注意：金额必须用 Decimal'])
  })

  test('注释行与空行被忽略，格式错误的行被丢弃而不抛异常', () => {
    const pi = new PathInstructions([
      '# 这是注释',
      '',
      '   ',
      'no-separator-here',
      'src/**:没有空格',
      ': 缺少 glob',
      'src/**: ',
      'src/**: 有效'
    ])
    expect(pi.match('src/a.ts')).toEqual(['有效'])
  })

  test('单个文件的指令总长度超过上限时截断后续规则', () => {
    const big = 'x'.repeat(PathInstructions.MAX_CHARS_PER_FILE - 2)
    const pi = new PathInstructions([`src/**: ${big}`, 'src/**: 这条放不下'])
    expect(pi.match('src/a.ts')).toEqual([big])
  })

  test('toString 只列 glob，不输出指令原文', () => {
    expect(new PathInstructions().toString()).toBe('(none)')
    const s = new PathInstructions(['src/**: 机密指令文本']).toString()
    expect(s).toContain('1 rule(s)')
    expect(s).toContain('src/**')
    expect(s).not.toContain('机密')
  })
})

describe('renderReviewFileDiff 的 path_instructions 段', () => {
  const prompts = new Prompts()
  const base = () => {
    const ins = new Inputs()
    ins.filename = 'src/api/user.ts'
    ins.patches = 'PATCH'
    return ins
  }

  test('有指令时渲染进提示词', () => {
    const ins = base()
    ins.pathInstructions = '- 校验入参\n- 检查鉴权'
    const out = prompts.renderReviewFileDiff(ins)
    expect(out).toContain('Project-specific review instructions')
    expect(out).toContain('- 校验入参\n- 检查鉴权')
    expect(out).not.toContain('$path_instructions_section')
  })

  test('没有指令时整段不出现，占位符也不残留', () => {
    const out = prompts.renderReviewFileDiff(base())
    expect(out).not.toContain('Project-specific review instructions')
    expect(out).not.toContain('$path_instructions_section')
  })

  test('指令里的 $& 等字符按字面输出', () => {
    const ins = base()
    ins.pathInstructions = "- 价格用 `$&` 和 $' 表示"
    expect(prompts.renderReviewFileDiff(ins)).toContain("- 价格用 `$&` 和 $' 表示")
  })

  test('clone 保留 pathInstructions', () => {
    const ins = base()
    ins.pathInstructions = '- a'
    expect(ins.clone().pathInstructions).toBe('- a')
  })
})
