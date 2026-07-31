/**
 * conversation-issue.test.ts — 主评论区（issue_comment）对话式追问测试
 *
 * 覆盖:
 * - composeIssueCommentChain 纯逻辑（时间序 / 截止当前评论 / 过滤空 body）
 * - handleIssueConversation 编排:
 *   - 非 PR 上的 issue_comment → 跳过
 *   - bot 自评论 → 跳过
 *   - 未 @bot → 跳过
 *   - 幂等标签命中（连续提问不重复）→ 跳过
 *   - 轮次上限 → 回上限提示、不调用模型
 *   - 正常回复 → create 一条含引用 + @提及 + 回复标签的评论
 */
import {describe, expect, test, beforeEach, jest} from '@jest/globals'

// --- 全局 mock（避免真实 IO 副作用）---
jest.mock('@actions/core', () => ({
  getInput: jest.fn().mockReturnValue(''),
  info: jest.fn(),
  warning: jest.fn()
}))

// conversation.ts 已改为消费调用方传入的 ExecutionContext（ARCH-005），
// 不再直接 import @actions/github；测试改为直接构造 execCtx 对象。
const mockExecCtx: any = {
  platform: 'github',
  eventKind: 'comment_created',
  projectPath: 'octo/demo',
  projectId: 'octo/demo',
  changeRequestId: 42,
  actor: {login: 'alice', isBot: false},
  baseSha: '',
  headSha: '',
  raw: {}
}

const octokitState: Record<string, any> = {
  getPull: jest.fn(),
  compareCommits: jest.fn()
}
jest.mock('../src/octokit', () => ({
  octokit: {
    pulls: {get: (...a: any[]) => octokitState.getPull(...a)},
    repos: {compareCommits: (...a: any[]) => octokitState.compareCommits(...a)}
  }
}))

// Commenter mock：只暴露 handler 用到的方法
const commenterState: Record<string, any> = {
  listComments: jest.fn(),
  create: jest.fn(),
  findCommentWithTag: jest.fn(),
  getShortSummary: jest.fn(),
  getDescription: jest.fn((s: string) => s)
}
jest.mock('../src/commenter', () => ({
  Commenter: class {
    listComments = (...a: any[]) => commenterState.listComments(...a)
    create = (...a: any[]) => commenterState.create(...a)
    findCommentWithTag = (...a: any[]) => commenterState.findCommentWithTag(...a)
    getShortSummary = (...a: any[]) => commenterState.getShortSummary(...a)
    getDescription = (...a: any[]) => commenterState.getDescription(...a)
  },
  getCommentGreeting: () => '🤖 AI Reviewer',
  initBotGreeting: jest.fn(),
  COMMENT_TAG: '<!-- BOT_COMMENT -->',
  COMMENT_REPLY_TAG: '<!-- BOT_REPLY -->',
  SUMMARIZE_TAG: '<!-- SUMMARY -->'
}))

jest.mock('../src/tokenizer', () => ({getTokenCount: () => 0}))

import {
  composeIssueCommentChain,
  handleIssueConversation,
  buildIssueConvReplyTag,
  MAX_CONVERSATION_TURNS
} from '../src/conversation'

const stubOptions: any = {heavyTokenLimits: {requestTokens: 1_000_000}}
const stubPrompts: any = {
  commentIssue: 'template with $file_diff placeholder',
  renderCommentIssue: () => 'rendered prompt'
}

function makeBot(reply = '这是模型给出的回答'): any {
  return {chat: jest.fn(async () => [reply, {}, []])}
}

function setPayload(commentBody: string, overrides: any = {}) {
  mockExecCtx.eventKind = 'comment_created'
  mockExecCtx.raw = {
    action: 'created',
    issue: {
      number: 42,
      pull_request: {},
      title: 'PR 标题',
      body: 'PR 描述'
    },
    pull_request: {title: 'PR 标题', body: 'PR 描述'},
    comment: {
      id: 2001,
      body: commentBody,
      user: {login: 'alice', type: 'User'}
    },
    ...overrides
  }
}

beforeEach(() => {
  for (const fn of Object.values(octokitState)) (fn as jest.Mock).mockReset()
  for (const fn of Object.values(commenterState)) (fn as jest.Mock).mockReset()
  commenterState.listComments.mockResolvedValue([])
  commenterState.create.mockResolvedValue(undefined)
  commenterState.findCommentWithTag.mockResolvedValue(null)
  commenterState.getDescription.mockImplementation((s: string) => s)
  octokitState.getPull.mockResolvedValue({
    data: {base: {sha: 'base'}, head: {sha: 'head'}}
  })
  octokitState.compareCommits.mockResolvedValue({data: {files: []}})
})

describe('composeIssueCommentChain', () => {
  test('按时间序组装 login: body，\\n---\\n 分隔', () => {
    const chain = composeIssueCommentChain(
      [
        {id: 1, body: 'a', user: {login: 'u1'}},
        {id: 2, body: 'b', user: {login: 'u2'}}
      ],
      2
    )
    expect(chain).toBe('u1: a\n---\nu2: b')
  })

  test('截止到当前触发评论（忽略其后评论）', () => {
    const chain = composeIssueCommentChain(
      [
        {id: 1, body: 'a', user: {login: 'u1'}},
        {id: 2, body: 'b', user: {login: 'u2'}},
        {id: 3, body: 'c', user: {login: 'u3'}}
      ],
      2
    )
    expect(chain).toBe('u1: a\n---\nu2: b')
    expect(chain).not.toContain('u3')
  })

  test('过滤空 body', () => {
    const chain = composeIssueCommentChain(
      [
        {id: 1, body: '   ', user: {login: 'u1'}},
        {id: 2, body: 'b', user: {login: 'u2'}}
      ],
      2
    )
    expect(chain).toBe('u2: b')
  })
})

describe('handleIssueConversation — 编排', () => {
  test('非 PR 上的 issue_comment → 跳过', async () => {
    setPayload('@ai-reviewer 这个改动为啥这样写', {
      issue: {number: 42, title: 't'} // 无 pull_request 字段
    })
    await handleIssueConversation(mockExecCtx, makeBot(), stubOptions, stubPrompts)
    expect(commenterState.create).not.toHaveBeenCalled()
  })

  test('bot 自评论 → 跳过', async () => {
    setPayload('@ai-reviewer 问题', {
      comment: {
        id: 2001,
        body: '@ai-reviewer 问题',
        user: {login: 'ai-reviewer[bot]', type: 'Bot'}
      }
    })
    await handleIssueConversation(mockExecCtx, makeBot(), stubOptions, stubPrompts)
    expect(commenterState.create).not.toHaveBeenCalled()
  })

  test('未 @bot → 跳过', async () => {
    setPayload('这是一条普通评论，没有提及机器人')
    await handleIssueConversation(mockExecCtx, makeBot(), stubOptions, stubPrompts)
    expect(commenterState.create).not.toHaveBeenCalled()
  })

  test('幂等标签命中 → 跳过（连续提问不重复）', async () => {
    setPayload('@ai-reviewer 这个问题好改吗')
    commenterState.listComments.mockResolvedValue([
      {id: 3001, body: `已回复 ${buildIssueConvReplyTag(2001)}`}
    ])
    const bot = makeBot()
    await handleIssueConversation(mockExecCtx, bot, stubOptions, stubPrompts)
    expect(bot.chat).not.toHaveBeenCalled()
    expect(commenterState.create).not.toHaveBeenCalled()
  })

  test('轮次上限 → 回上限提示、不调用模型', async () => {
    setPayload('@ai-reviewer 继续追问')
    // 构造超过上限的 bot 回复链
    const history = Array.from({length: MAX_CONVERSATION_TURNS}, (_, i) => ({
      id: 100 + i,
      body: `回复 ${i} <!-- BOT_REPLY -->`,
      user: {login: 'ai-reviewer[bot]'}
    }))
    history.push({
      id: 2001,
      body: '@ai-reviewer 继续追问',
      user: {login: 'alice'}
    } as any)
    commenterState.listComments.mockResolvedValue(history)
    const bot = makeBot()
    await handleIssueConversation(mockExecCtx, bot, stubOptions, stubPrompts)
    expect(bot.chat).not.toHaveBeenCalled()
    expect(commenterState.create).toHaveBeenCalledTimes(1)
    expect(commenterState.create.mock.calls[0][0]).toContain('上限')
  })

  test('正常回复 → create 含引用 + @提及 + 回复标签', async () => {
    setPayload('@ai-reviewer 这个改动为什么这样写？')
    commenterState.listComments.mockResolvedValue([
      {id: 2001, body: '@ai-reviewer 这个改动为什么这样写？', user: {login: 'alice'}}
    ])
    const bot = makeBot('因为需要修复连续提问丢失的问题。')
    await handleIssueConversation(mockExecCtx, bot, stubOptions, stubPrompts)

    expect(bot.chat).toHaveBeenCalledTimes(1)
    expect(commenterState.create).toHaveBeenCalledTimes(1)
    const [body, target] = commenterState.create.mock.calls[0]
    expect(target).toBe(42)
    expect(body).toContain('🤖 AI Reviewer')
    // 引用用户原问题
    expect(body).toContain('> @ai-reviewer 这个改动为什么这样写？')
    // @提及真实用户
    expect(body).toContain('@alice ')
    // 模型答案
    expect(body).toContain('因为需要修复连续提问丢失的问题。')
    // 幂等标签
    expect(body).toContain(buildIssueConvReplyTag(2001))
  })

  test('模型残留开头 @user 被清理', async () => {
    setPayload('@ai-reviewer 解释一下')
    commenterState.listComments.mockResolvedValue([
      {id: 2001, body: '@ai-reviewer 解释一下', user: {login: 'alice'}}
    ])
    const bot = makeBot('@user 这里是解释。')
    await handleIssueConversation(mockExecCtx, bot, stubOptions, stubPrompts)
    const [body] = commenterState.create.mock.calls[0]
    expect(body).toContain('@alice 这里是解释。')
    expect(body).not.toContain('@user')
  })
})
