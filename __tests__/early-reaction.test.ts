/**
 * early-reaction.test.ts — tryEarlyReaction subgroup 路径拆分回归测试
 */
import {describe, expect, test, jest, beforeEach} from '@jest/globals'

// 部分间接依赖（commenter.ts）读取 @actions/github context.repo
process.env.GITHUB_REPOSITORY = 'test-owner/test-repo'

// ─── mocks ───────────────────────────────────────────────────────────────────

const mockAddAckReaction = jest.fn<any>()
jest.mock('../src/commands/reaction', () => ({
  addAckReaction: (...args: any[]) => mockAddAckReaction(...args)
}))

jest.mock('@actions/core', () => ({
  info: jest.fn()
}))

import {tryEarlyReaction} from '../src/commands/early-reaction'
import type {ExecutionContext} from '../src/platform/execution-context'

function makeExecCtx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    platform: 'gitlab',
    projectPath: 'group/repo',
    changeRequestId: 42,
    eventKind: 'comment_created',
    actor: {login: 'alice', isBot: false},
    comment: {
      kind: 'top_level',
      id: 777,
      body: '@codesentinel help'
    },
    raw: {},
    ...overrides
  } as ExecutionContext
}

describe('tryEarlyReaction subgroup 路径拆分', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockAddAckReaction.mockResolvedValue(undefined)
  })

  test('二级路径 group/repo → owner=group, repo=repo', async () => {
    await tryEarlyReaction(makeExecCtx({projectPath: 'group/repo'}), {
      commandAckReaction: 'eyes',
      botLogin: ''
    } as any)
    expect(mockAddAckReaction).toHaveBeenCalledTimes(1)
    const params = mockAddAckReaction.mock.calls[0][0] as any
    expect(params.owner).toBe('group')
    expect(params.repo).toBe('repo')
    expect(params.changeRequestId).toBe(42)
  })

  test('三级路径 group/subgroup/repo → owner=group/subgroup, repo=repo', async () => {
    await tryEarlyReaction(makeExecCtx({projectPath: 'group/subgroup/repo'}), {
      commandAckReaction: 'eyes',
      botLogin: ''
    } as any)
    expect(mockAddAckReaction).toHaveBeenCalledTimes(1)
    const params = mockAddAckReaction.mock.calls[0][0] as any
    expect(params.owner).toBe('group/subgroup')
    expect(params.repo).toBe('repo')
    expect(params.changeRequestId).toBe(42)
  })

  test('四级路径 a/b/c/repo → owner=a/b/c, repo=repo', async () => {
    await tryEarlyReaction(makeExecCtx({projectPath: 'a/b/c/repo'}), {
      commandAckReaction: 'eyes',
      botLogin: ''
    } as any)
    const params = mockAddAckReaction.mock.calls[0][0] as any
    expect(params.owner).toBe('a/b/c')
    expect(params.repo).toBe('repo')
  })
})
