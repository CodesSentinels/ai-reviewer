/**
 * command-parser.test.ts — 命令解析器单元测试
 *
 * 覆盖:
 * - bot mention 识别（两个别名、大小写、前缀边界）
 * - 命令命中（单词、复合命令 full review、最长前缀）
 * - 参数解析（位置参数、kv、空参数）
 * - 非法字符拦截（shell 元字符、字符集外）
 * - 长度上限（命令行、arg 长度、arg 数量）
 * - 对话 fallback（@bot 但无命中命令）
 * - 换行后的 rawAfter 行为
 * - 无 @bot 直接返回 none
 */
import {describe, expect, test} from '@jest/globals'

// 不需要 mock @actions/core — parser 是纯函数不引用 runtime 依赖
import {parse, type ParserOptions} from '../src/commands/parser'

const REGISTERED = new Set([
  'help',
  'review',
  'full review',
  'resolve',
  'summary',
  'pause',
  'resume',
  'configuration'
])

const opts: ParserOptions = {registeredCommands: REGISTERED}

describe('parse — bot mention 识别', () => {
  test('空字符串返回 none', () => {
    expect(parse('', opts).kind).toBe('none')
  })

  test('没有 @bot 返回 none', () => {
    expect(parse('hello world', opts).kind).toBe('none')
    expect(parse('please resolve this', opts).kind).toBe('none')
  })

  test('默认支持 @ai-reviewer', () => {
    const r = parse('@ai-reviewer help', opts)
    expect(r.kind).toBe('command')
    expect(r.command?.name).toBe('help')
  })

  test('默认支持 @codesentinel', () => {
    const r = parse('@codesentinel help', opts)
    expect(r.kind).toBe('command')
    expect(r.command?.name).toBe('help')
  })


  test('bot mention 忽略大小写', () => {
    expect(parse('@AI-Reviewer help', opts).command?.name).toBe('help')
    expect(parse('@CodeSentinel help', opts).command?.name).toBe('help')
  })

  test('前缀边界: foo@ai-reviewer 不触发', () => {
    const r = parse('abc@ai-reviewer help', opts)
    expect(r.kind).toBe('none')
  })

  test('前导标点之后允许: hi, @ai-reviewer help', () => {
    const r = parse('hi, @ai-reviewer help', opts)
    expect(r.command?.name).toBe('help')
  })

  test('行首 @ai-reviewer 允许', () => {
    const r = parse('@ai-reviewer help', opts)
    expect(r.command?.name).toBe('help')
  })
})

describe('parse — 命令命中', () => {
  test('review 命中', () => {
    expect(parse('@ai-reviewer review', opts).command?.name).toBe('review')
  })

  test('full review 作为复合命令优先匹配（不是 full）', () => {
    const r = parse('@ai-reviewer full review', opts)
    expect(r.command?.name).toBe('full review')
    expect(r.command?.args).toEqual([])
  })

  test('full 单独不在白名单时不匹配', () => {
    // 未注册 'full'，应走 conversation fallback
    const r = parse('@ai-reviewer full', opts)
    expect(r.kind).toBe('conversation')
  })

  test('命令名不区分大小写', () => {
    expect(parse('@ai-reviewer REVIEW', opts).command?.name).toBe('review')
    expect(parse('@ai-reviewer Full Review', opts).command?.name).toBe(
      'full review'
    )
  })

  test('mention 后紧跟标点: @ai-reviewer: help', () => {
    const r = parse('@ai-reviewer: help', opts)
    expect(r.command?.name).toBe('help')
  })
})

describe('parse — 参数解析', () => {
  test('位置参数', () => {
    const r = parse('@ai-reviewer review foo bar', opts)
    expect(r.command?.args).toEqual(['foo', 'bar'])
  })

  test('kv 参数', () => {
    const r = parse('@ai-reviewer review files=src/foo.ts', opts)
    expect(r.command?.args).toEqual(['files=src/foo.ts'])
    expect(r.command?.kv).toEqual({files: 'src/foo.ts'})
  })

  test('混合位置和 kv', () => {
    const r = parse('@ai-reviewer review all files=a.ts', opts)
    expect(r.command?.args).toEqual(['all', 'files=a.ts'])
    expect(r.command?.kv).toEqual({files: 'a.ts'})
  })

  test('无参数', () => {
    const r = parse('@ai-reviewer resolve', opts)
    expect(r.command?.args).toEqual([])
    expect(r.command?.kv).toEqual({})
  })
})

describe('parse — 非法参数拦截', () => {
  test('shell 元字符: $() 拒绝', () => {
    const r = parse('@ai-reviewer review $(whoami)', opts)
    expect(r.kind).toBe('command')
    expect(r.error?.code).toBe('INVALID_ARGS')
  })

  test('shell 元字符: 反引号拒绝', () => {
    const r = parse('@ai-reviewer review `ls`', opts)
    expect(r.error?.code).toBe('INVALID_ARGS')
  })

  test('shell 元字符: 管道符拒绝', () => {
    const r = parse('@ai-reviewer review foo|bar', opts)
    expect(r.error?.code).toBe('INVALID_ARGS')
  })

  test('字符集外: 中文拒绝', () => {
    const r = parse('@ai-reviewer review 你好', opts)
    expect(r.error?.code).toBe('INVALID_ARGS')
  })

  test('单 arg 超长拒绝', () => {
    const longArg = 'a'.repeat(200)
    const r = parse(`@ai-reviewer review ${longArg}`, opts)
    expect(r.error?.code).toBe('INVALID_ARGS')
  })

  test('arg 数量超上限拒绝', () => {
    const args = Array(20).fill('ok').join(' ')
    const r = parse(`@ai-reviewer review ${args}`, opts)
    expect(r.error?.code).toBe('INVALID_ARGS')
  })

  test('命令行超长拒绝', () => {
    const long = 'a'.repeat(600)
    const r = parse(`@ai-reviewer review ${long}`, opts)
    expect(r.error?.code).toBe('INVALID_ARGS')
  })
})

describe('parse — 对话 fallback', () => {
  test('@bot 但命令未命中 → conversation', () => {
    const r = parse('@ai-reviewer 为什么这里用 forEach？', opts)
    expect(r.kind).toBe('conversation')
  })

  test('@bot 单独出现 → conversation', () => {
    const r = parse('@ai-reviewer', opts)
    expect(r.kind).toBe('conversation')
  })

  test('@bot 后跟未知单词 → conversation', () => {
    const r = parse('@ai-reviewer foobar', opts)
    expect(r.kind).toBe('conversation')
  })
})

describe('parse — 多行与 rawAfter', () => {
  test('换行后的内容进入 rawAfter', () => {
    const body = '@ai-reviewer review\n请仔细看看这个 PR'
    const r = parse(body, opts)
    expect(r.command?.name).toBe('review')
    expect(r.command?.rawAfter).toBe('请仔细看看这个 PR')
  })

  test('命令行在正文中间也能识别（第一行起作用）', () => {
    const body = 'Hey @ai-reviewer help\n\nsee below'
    const r = parse(body, opts)
    expect(r.command?.name).toBe('help')
  })
})

describe('parse — 单条评论多命令仅取第一个', () => {
  test('第二个命令作为参数被校验（位置参数合法即透传）', () => {
    // @ai-reviewer resolve review 里 review 是位置参数
    const r = parse('@ai-reviewer resolve review', opts)
    expect(r.command?.name).toBe('resolve')
    expect(r.command?.args).toEqual(['review'])
  })
})
