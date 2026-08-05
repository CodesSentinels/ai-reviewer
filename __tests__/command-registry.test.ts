/**
 * command-registry.test.ts — CommandRegistry 单元测试
 */
import {describe, expect, test, beforeEach, jest} from '@jest/globals'

jest.mock('@actions/core', () => ({
  getInput: jest.fn().mockReturnValue(''),
  info: jest.fn(),
  warning: jest.fn(),
  error: jest.fn()
}))

import {CommandRegistry} from '../src/commands/registry'
import type {CommandHandler} from '../src/commands/types'

function fakeHandler(name: string, overrides: Partial<CommandHandler> = {}): CommandHandler {
  return {
    name,
    description: `desc ${name}`,
    async execute() {
      return {message: `ok ${name}`}
    },
    ...overrides
  }
}

describe('CommandRegistry', () => {
  let reg: CommandRegistry

  beforeEach(() => {
    reg = new CommandRegistry()
  })

  test('register + get by name', () => {
    reg.register(fakeHandler('help'))
    expect(reg.get('help')?.name).toBe('help')
    expect(reg.has('help')).toBe(true)
    expect(reg.has('HELP')).toBe(true) // 大小写不敏感
  })

  test('register with aliases', () => {
    reg.register(fakeHandler('review', {aliases: ['rv', 're']}))
    expect(reg.get('rv')?.name).toBe('review')
    expect(reg.get('re')?.name).toBe('review')
  })

  test('duplicate main name throws', () => {
    reg.register(fakeHandler('help'))
    expect(() => reg.register(fakeHandler('help'))).toThrow(/already/i)
  })

  test('alias colliding with existing name throws', () => {
    reg.register(fakeHandler('help'))
    expect(() => reg.register(fakeHandler('other', {aliases: ['help']}))).toThrow(/collid/i)
  })

  test('getRegisteredNames returns main + aliases', () => {
    reg.register(fakeHandler('review', {aliases: ['rv']}))
    reg.register(fakeHandler('full review'))
    const names = reg.getRegisteredNames()
    expect(names.has('review')).toBe(true)
    expect(names.has('rv')).toBe(true)
    expect(names.has('full review')).toBe(true)
  })

  test('listCommands preserves registration order and excludes aliases', () => {
    reg.register(fakeHandler('review', {aliases: ['rv']}))
    reg.register(fakeHandler('help'))
    reg.register(fakeHandler('resolve'))
    const names = reg.listCommands().map(c => c.name)
    expect(names).toEqual(['review', 'help', 'resolve'])
  })

  test('_reset clears state', () => {
    reg.register(fakeHandler('help'))
    reg._reset()
    expect(reg.has('help')).toBe(false)
    expect(reg.listCommands()).toEqual([])
  })
})
