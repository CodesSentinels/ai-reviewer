/**
 * command-explain.test.ts — explain 命令处理器单元测试
 *
 * 覆盖:
 * - 正常流程：拉取 diff → 调用 heavyBot → 返回 Mermaid 响应
 * - 空 diff：直接返回提示信息，不调用 AI
 * - diff 超过 80k：自动截断后再调用 AI
 * - Bot 初始化失败：返回错误提示，不抛出
 * - AI 返回空内容：返回重试提示
 * - explainHandler 元信息正确（name / minPermission / needsAck）
 */
import {describe, expect, test, jest, beforeEach} from '@jest/globals'

// ─── Stub @actions/core ───────────────────────────────────────────────────
jest.mock('@actions/core', () => ({
  info: jest.fn(),
  warning: jest.fn(),
  error: jest.fn(),
  getInput: jest.fn(() => '')
}))

// ─── Stub @actions/github ─────────────────────────────────────────────────
jest.mock('@actions/github', () => ({
  context: {
    repo: {owner: 'owner', repo: 'repo'},
    payload: {}
  }
}))

// ─── Stub octokit ─────────────────────────────────────────────────────────
type PullsGetResult = {data: {title: string; body: string | null}}
type CompareResult = {data: {files: Array<{filename: string; patch?: string}>}}
const mockPullsGet = jest.fn<() => Promise<PullsGetResult>>()
const mockCompareCommits = jest.fn<() => Promise<CompareResult>>()
jest.mock('../src/octokit', () => ({
  octokit: {
    pulls: {get: mockPullsGet},
    repos: {compareCommits: mockCompareCommits}
  }
}))

// ─── Stub Bot ─────────────────────────────────────────────────────────────
type ChatResult = [string, Record<string, unknown>, unknown[]]
const mockChat = jest.fn<() => Promise<ChatResult>>()
jest.mock('../src/bot', () => ({
  Bot: jest.fn().mockImplementation(() => ({chat: mockChat}))
}))

// ─── Stub options ──────────────────────────────────────────────────────────
jest.mock('../src/options', () => ({
  OpenAIOptions: jest.fn().mockImplementation(() => ({}))
}))

import {explainHandler} from '../src/commands/handlers/explain'
import type {CommandContext} from '../src/commands/types'

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeCtx(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    command: {name: 'explain', raw: 'explain', args: [], kv: {}, rawAfter: ''},
    eventName: 'issue_comment',
    action: 'created',
    owner: 'owner',
    repo: 'repo',
    prNumber: 1,
    headSha: 'head-sha',
    baseSha: 'base-sha',
    actor: {login: 'user', permission: 'write', isPrAuthor: false, isBot: false},
    commentId: 1,
    commentBody: '@codesentinel explain',
    reply: {
      ack: jest.fn<() => Promise<number>>().mockResolvedValue(1),
      success: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      error: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      progress: jest.fn<() => Promise<void>>().mockResolvedValue(undefined)
    },
    options: {
      openaiHeavyModel: 'gpt-4o',
      heavyTokenLimits: {},
      enableWebSearch: false,
      enableShell: false
    } as never,
    ...overrides
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('explainHandler — metadata', () => {
  test('name is "explain"', () => {
    expect(explainHandler.name).toBe('explain')
  })

  test('minPermission is "read"', () => {
    expect(explainHandler.minPermission).toBe('read')
  })

  test('needsAck is true', () => {
    expect(explainHandler.needsAck).toBe(true)
  })
})

describe('explainHandler.execute', () => {
  beforeEach(() => {
    jest.clearAllMocks()

    mockPullsGet.mockResolvedValue({
      data: {title: 'Test PR', body: 'Some description'}
    })

    mockCompareCommits.mockResolvedValue({
      data: {
        files: [
          {
            filename: 'src/order.ts',
            patch: '@@ -1,3 +1,5 @@\n+export function createOrder() {}\n'
          }
        ]
      }
    })

    mockChat.mockResolvedValue([
      '## 业务逻辑说明\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\n- 关键设计点',
      {},
      []
    ])
  })

  test('正常流程：返回 AI 生成的 Mermaid 内容', async () => {
    const result = await explainHandler.execute(makeCtx())
    expect(mockChat).toHaveBeenCalledTimes(1)
    expect(result.message).toContain('mermaid')
  })

  test('调用 heavyBot 时 prompt 包含 PR 标题和 diff', async () => {
    await explainHandler.execute(makeCtx())
    const [prompt] = mockChat.mock.calls[0] as unknown as [string, unknown]
    expect(prompt).toContain('Test PR')
    expect(prompt).toContain('createOrder')
  })

  test('diff 为空时不调用 AI，返回提示信息', async () => {
    mockCompareCommits.mockResolvedValue({data: {files: []}})
    const result = await explainHandler.execute(makeCtx())
    expect(mockChat).not.toHaveBeenCalled()
    expect(result.message).toMatch(/没有可分析/)
  })

  test('diff 超过 80k 字符时自动截断', async () => {
    const hugePatch = 'x'.repeat(90000)
    mockCompareCommits.mockResolvedValue({
      data: {
        files: [{filename: 'big.ts', patch: hugePatch}]
      }
    })
    await explainHandler.execute(makeCtx())
    const [prompt] = mockChat.mock.calls[0] as unknown as [string, unknown]
    expect(prompt).toContain('truncated')
    // prompt 中的 diff 部分不应超过合理长度
    expect(prompt.length).toBeLessThan(120000)
  })

  test('AI 返回空内容时返回重试提示', async () => {
    mockChat.mockResolvedValue(['', {}, []])
    const result = await explainHandler.execute(makeCtx())
    expect(result.message).toMatch(/重试/)
  })

  test('Bot 初始化失败时返回错误提示，不抛出', async () => {
    const {Bot} = jest.requireMock('../src/bot') as {Bot: jest.Mock}
    Bot.mockImplementationOnce(() => {
      throw new Error('no api key')
    })
    const result = await explainHandler.execute(makeCtx())
    expect(result.message).toMatch(/无法初始化/)
    expect(mockChat).not.toHaveBeenCalled()
  })

  test('PR body 为 null 时用空字符串代替', async () => {
    mockPullsGet.mockResolvedValue({data: {title: 'No Body PR', body: null}})
    await explainHandler.execute(makeCtx())
    // 不应抛出，正常调用 AI
    expect(mockChat).toHaveBeenCalledTimes(1)
  })
})
