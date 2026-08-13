/**
 * command-reply-idempotency.test.ts — 命令回复幂等键（GH-014）
 *
 * `hasBeenProcessed()` 是 dispatcher 的幂等闸门：命中即跳过整条命令。
 * 命名空间化之后必须同时认得历史格式，否则升级当天在途 PR 上已处理过的命令
 * 会被重新执行一遍（重复调用模型、重复回帖）。
 */
import {describe, expect, test, jest, beforeEach, afterEach} from '@jest/globals'

// reply.ts → commenter.ts 会在模块加载时读 context.repo
jest.mock('@actions/github', () => ({
  context: {repo: {owner: 'o', repo: 'r'}, payload: {}}
}))

const logs = {info: jest.fn(), warning: jest.fn(), error: jest.fn(), debug: jest.fn()}
jest.mock('../src/platform/logger', () => ({getLogger: () => logs}))

const listComments = jest.fn<any>()
jest.mock('../src/platform/git-platform', () => ({
  getPlatform: () => ({listComments})
}))

import {
  buildCmdReplyTag,
  cmdReplyTagVariants,
  hasBeenProcessed,
  legacyCmdReplyTag
} from '../src/commands/reply'
import {resetStateNamespace, setStateNamespace} from '../src/platform/state-namespace'

beforeEach(() => {
  jest.clearAllMocks()
  listComments.mockResolvedValue([])
})

afterEach(() => {
  resetStateNamespace()
})

describe('GH-014: 命令回复幂等键带平台命名空间', () => {
  test('写入格式带 github: 命名空间', () => {
    expect(buildCmdReplyTag(12345, 'help')).toBe('<!-- ai-reviewer:github:cmd-reply:12345:help -->')
  })

  test('GitLab 运行时写入 gitlab: 命名空间', () => {
    setStateNamespace('gitlab')
    expect(buildCmdReplyTag(12345, 'help')).toBe('<!-- ai-reviewer:gitlab:cmd-reply:12345:help -->')
  })

  test('匹配形态 = 新格式 + 历史格式', () => {
    expect(cmdReplyTagVariants(12345, 'help')).toEqual([
      buildCmdReplyTag(12345, 'help'),
      legacyCmdReplyTag(12345, 'help')
    ])
  })
})

describe('GH-014: hasBeenProcessed 写新读旧', () => {
  test('命中新格式 → 判定为已处理', async () => {
    listComments.mockResolvedValue([{body: `回复内容 ${buildCmdReplyTag(12345, 'help')}`}])

    await expect(hasBeenProcessed('o', 'r', 7, 12345, 'help')).resolves.toBe(true)
  })

  test('命中历史格式 → 判定为已处理（在途 PR 不重复执行命令）', async () => {
    listComments.mockResolvedValue([{body: `回复内容 ${legacyCmdReplyTag(12345, 'help')}`}])

    await expect(hasBeenProcessed('o', 'r', 7, 12345, 'help')).resolves.toBe(true)
  })

  test('不同评论 ID / 不同命令 → 不误命中', async () => {
    listComments.mockResolvedValue([
      {body: buildCmdReplyTag(999, 'help')},
      {body: legacyCmdReplyTag(12345, 'resolve')}
    ])

    await expect(hasBeenProcessed('o', 'r', 7, 12345, 'help')).resolves.toBe(false)
  })

  test('GitLab 命名空间下不命中 GitHub 写的键（GH-015）', async () => {
    setStateNamespace('github')
    const githubTag = buildCmdReplyTag(12345, 'help')
    listComments.mockResolvedValue([{body: githubTag}])

    setStateNamespace('gitlab')
    await expect(hasBeenProcessed('o', 'r', 7, 12345, 'help')).resolves.toBe(false)
  })

  test('无匹配评论 → 未处理', async () => {
    listComments.mockResolvedValue([{body: '无关评论'}, {body: null}])

    await expect(hasBeenProcessed('o', 'r', 7, 12345, 'help')).resolves.toBe(false)
  })

  test('列表查询失败 → 视为未处理并 warning（宁可重跑也不吞命令）', async () => {
    listComments.mockRejectedValue(new Error('500'))

    await expect(hasBeenProcessed('o', 'r', 7, 12345, 'help')).resolves.toBe(false)
    expect(logs.warning).toHaveBeenCalledWith(expect.stringContaining('hasBeenProcessed failed'))
  })
})
