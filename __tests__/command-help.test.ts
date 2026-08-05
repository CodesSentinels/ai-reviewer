/**
 * command-help.test.ts — help handler 消息生成测试
 */
import {describe, expect, test, jest} from '@jest/globals'

jest.mock('@actions/core', () => ({
  getInput: jest.fn().mockReturnValue(''),
  info: jest.fn(),
  warning: jest.fn(),
  error: jest.fn()
}))

import {buildHelpMessage} from '../src/commands/handlers/help'
import type {CommandHandler} from '../src/commands/types'

const mk = (name: string, overrides: Partial<CommandHandler> = {}): CommandHandler => ({
  name,
  description: `desc for ${name}`,
  usage: `@ai-reviewer ${name}`,
  async execute() {
    return {}
  },
  ...overrides
})

describe('buildHelpMessage', () => {
  test('包含命令名、描述、用法', () => {
    const msg = buildHelpMessage([mk('review'), mk('resolve')])
    expect(msg).toMatch(/review/)
    expect(msg).toMatch(/resolve/)
    expect(msg).toMatch(/desc for review/)
    expect(msg).toMatch(/desc for resolve/)
  })

  test('默认最低权限为 write', () => {
    const msg = buildHelpMessage([mk('review')])
    expect(msg).toMatch(/`write`/)
  })

  test('help 自身排在列表末尾', () => {
    const msg = buildHelpMessage([mk('help', {minPermission: 'read'}), mk('review'), mk('resolve')])
    const helpIdx = msg.indexOf('`@ai-reviewer help`')
    const reviewIdx = msg.indexOf('`@ai-reviewer review`')
    const resolveIdx = msg.indexOf('`@ai-reviewer resolve`')
    expect(helpIdx).toBeGreaterThan(reviewIdx)
    expect(helpIdx).toBeGreaterThan(resolveIdx)
  })

  test('别名段落出现', () => {
    const msg = buildHelpMessage([mk('review', {aliases: ['rv']})])
    expect(msg).toMatch(/别名/)
    expect(msg).toMatch(/`rv`/)
  })

  test('无别名时不输出别名段落', () => {
    const msg = buildHelpMessage([mk('review'), mk('resolve')])
    expect(msg).not.toMatch(/别名/)
  })

  test('输出提及 bot alias 的说明', () => {
    const msg = buildHelpMessage([mk('review')])
    expect(msg).toMatch(/@ai-reviewer/)
    expect(msg).toMatch(/@codesentinel/)
  })
})
