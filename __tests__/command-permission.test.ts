/**
 * command-permission.test.ts — 权限校验单元测试
 */
import {describe, expect, test, beforeEach, jest} from '@jest/globals'

jest.mock('@actions/core', () => ({
  getInput: jest.fn().mockReturnValue(''),
  info: jest.fn(),
  warning: jest.fn(),
  error: jest.fn()
}))

const getCollaboratorPermissionLevel = jest.fn()
jest.mock('../src/octokit', () => ({
  octokit: {
    repos: {
      getCollaboratorPermissionLevel
    }
  }
}))

import {
  getPermission,
  canExecute,
  _resetPermissionCache
} from '../src/commands/permission'
import type {CommandHandler} from '../src/commands/types'

const mockResolve = (permission: string) =>
  (getCollaboratorPermissionLevel as jest.Mock).mockResolvedValue({
    data: {permission}
  } as never)

const mockReject = (err: Error) =>
  (getCollaboratorPermissionLevel as jest.Mock).mockRejectedValue(err as never)

describe('getPermission', () => {
  beforeEach(() => {
    _resetPermissionCache()
    getCollaboratorPermissionLevel.mockReset()
  })

  test('returns API value', async () => {
    mockResolve('write')
    const p = await getPermission({
      owner: 'o',
      repo: 'r',
      username: 'alice'
    })
    expect(p).toBe('write')
  })

  test('caches by (owner, repo, username)', async () => {
    mockResolve('admin')
    await getPermission({owner: 'o', repo: 'r', username: 'alice'})
    await getPermission({owner: 'o', repo: 'r', username: 'alice'})
    expect(getCollaboratorPermissionLevel).toHaveBeenCalledTimes(1)
  })

  test('different users are cached independently', async () => {
    mockResolve('write')
    await getPermission({owner: 'o', repo: 'r', username: 'alice'})
    await getPermission({owner: 'o', repo: 'r', username: 'bob'})
    expect(getCollaboratorPermissionLevel).toHaveBeenCalledTimes(2)
  })

  test('API failure returns none and does not throw', async () => {
    mockReject(new Error('boom'))
    const p = await getPermission({owner: 'o', repo: 'r', username: 'x'})
    expect(p).toBe('none')
  })
})

describe('canExecute', () => {
  const writeCmd: CommandHandler = {
    name: 'review',
    description: '',
    minPermission: 'write',
    async execute() {
      return {}
    }
  }
  const readCmd: CommandHandler = {
    name: 'help',
    description: '',
    minPermission: 'read',
    async execute() {
      return {}
    }
  }

  test('admin can run write command', () => {
    expect(canExecute(writeCmd, 'admin', false)).toBe(true)
  })

  test('read cannot run write command', () => {
    expect(canExecute(writeCmd, 'read', false)).toBe(false)
  })

  test('triage cannot run write command', () => {
    expect(canExecute(writeCmd, 'triage', false)).toBe(false)
  })

  test('PR author with read permission CAN run review', () => {
    expect(canExecute(writeCmd, 'read', true)).toBe(true)
  })

  test('PR author with read permission CANNOT run pause', () => {
    const pauseCmd: CommandHandler = {
      name: 'pause',
      description: '',
      minPermission: 'write',
      async execute() {
        return {}
      }
    }
    expect(canExecute(pauseCmd, 'read', true)).toBe(false)
  })

  test('read can run help (min=read)', () => {
    expect(canExecute(readCmd, 'read', false)).toBe(true)
  })

  test('none cannot run help when min=read', () => {
    expect(canExecute(readCmd, 'none', false)).toBe(false)
  })

  test('default minPermission is write', () => {
    const defaultCmd: CommandHandler = {
      name: 'x',
      description: '',
      async execute() {
        return {}
      }
    }
    expect(canExecute(defaultCmd, 'write', false)).toBe(true)
    expect(canExecute(defaultCmd, 'triage', false)).toBe(false)
  })
})
