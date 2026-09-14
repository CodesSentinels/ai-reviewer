/**
 * conversation-dual-platform.test.ts — §8.4 自然语言对话（REVIEW-015~018）
 *
 * 本章的实质是：**对话功能此前在 GitLab 上完全不可用**。
 * `conversation.ts` 直接解析 GitHub payload（`payload.action`、
 * `payload.issue.pull_request`、`comment.diff_hunk`），GitLab 的 note 事件在
 * 第一道校验就被拒。它也是 arch-guard 里唯一被允许读 `execCtx.raw` 的文件。
 *
 * 三件事一起做：坐标改读归一化字段（REVIEW-015/016）、补权限门禁
 * （REVIEW-017）、自评论过滤改按作者判定（REVIEW-018）。
 */
import {describe, expect, test, jest, beforeEach} from '@jest/globals'

jest.mock('../src/tokenizer', () => ({getTokenCount: () => 10}))

const BOT = 'ai-reviewer'

const platformState: any = {
  getChangeRequest: jest.fn<any>(),
  compareDiff: jest.fn<any>(),
  listComments: jest.fn<any>(),
  listReviewComments: jest.fn<any>(),
  createComment: jest.fn<any>(),
  updateComment: jest.fn<any>(),
  replyToReviewComment: jest.fn<any>(),
  getCollaboratorPermission: jest.fn<any>(),
  getAuthenticatedLogin: jest.fn<any>()
}
jest.mock('../src/platform/git-platform', () => ({getPlatform: () => platformState}))

const logs: string[] = []
jest.mock('../src/platform/logger', () => ({
  getLogger: () => ({
    info: (m: string) => logs.push(m),
    warning: (m: string) => logs.push(m),
    error: (m: string) => logs.push(m),
    debug: () => {}
  })
}))

import {handleConversation, handleIssueConversation} from '../src/conversation'
import {_resetPermissionCache} from '../src/commands/permission'
import {_resetBotIdentity, initBotGreeting} from '../src/commenter'
import {setExecCtx} from '../src/platform/run-context'
import {setStateNamespace} from '../src/platform/state-namespace'
import {stateMarker} from '../src/state-markers'
import type {ExecutionContext, Platform} from '../src/platform/execution-context'

function makeBot(): any {
  return {chat: jest.fn<any>(async () => ['这是回答', {}, []])}
}

const stubOptions: any = {
  heavyTokenLimits: {requestTokens: 100000, responseTokens: 1000, maxTokens: 101000},
  language: 'zh-CN',
  botIcon: '🤖',
  botName: 'bot',
  botLogin: BOT
}
const stubPrompts: any = {
  renderComment: () => 'p',
  renderCommentIssue: () => 'p'
}

/** GitLab MR note（顶层）的归一化上下文 */
function gitlabNoteCtx(over: Partial<ExecutionContext> = {}): ExecutionContext {
  setStateNamespace('gitlab')
  return {
    platform: 'gitlab',
    projectPath: 'group/subgroup/demo',
    projectId: '77',
    changeRequestId: 42,
    eventKind: 'comment_created',
    actor: {login: 'alice', isBot: false},
    baseSha: '',
    headSha: 'h'.repeat(40),
    comment: {kind: 'top_level', id: 9001, body: '@ai-reviewer 这段为什么这样写？'},
    raw: {},
    ...over
  } as ExecutionContext
}

/** GitLab diff discussion note（行级）的归一化上下文 */
function gitlabDiffNoteCtx(over: Partial<ExecutionContext> = {}): ExecutionContext {
  setStateNamespace('gitlab')
  return {
    platform: 'gitlab',
    projectPath: 'group/subgroup/demo',
    projectId: '77',
    changeRequestId: 42,
    eventKind: 'review_comment_created',
    actor: {login: 'alice', isBot: false},
    baseSha: '',
    headSha: 'h'.repeat(40),
    comment: {
      kind: 'review_thread',
      id: 9002,
      body: '@ai-reviewer 这行有问题吗？',
      path: 'src/a.ts',
      line: 12,
      threadId: 'disc-abc'
    },
    raw: {},
    ...over
  } as ExecutionContext
}

beforeEach(() => {
  jest.clearAllMocks()
  logs.length = 0
  _resetPermissionCache()
  _resetBotIdentity()
  initBotGreeting('🤖', 'bot', BOT)
  platformState.getChangeRequest.mockResolvedValue({
    number: 42,
    title: 'MR 标题',
    body: 'MR 描述',
    state: 'open',
    baseSha: 'b'.repeat(40),
    headSha: 'h'.repeat(40),
    baseRef: 'main',
    headRef: 'feature',
    author: 'mr-author'
  })
  platformState.compareDiff.mockResolvedValue({files: [], commits: []})
  platformState.listComments.mockResolvedValue([])
  platformState.listReviewComments.mockResolvedValue([])
  platformState.createComment.mockResolvedValue({id: 1, body: '', author: BOT})
  platformState.updateComment.mockResolvedValue(undefined)
  platformState.replyToReviewComment.mockResolvedValue({id: 2, body: '', author: BOT})
  platformState.getCollaboratorPermission.mockResolvedValue('write')
  platformState.getAuthenticatedLogin.mockResolvedValue(BOT)
})

function replied(): boolean {
  return (
    platformState.createComment.mock.calls.length > 0 ||
    platformState.replyToReviewComment.mock.calls.length > 0
  )
}

describe('REVIEW-016：GitLab MR note 能进入对话（此前完全不可用）', () => {
  test('顶层 note → 走完流程并回复', async () => {
    setExecCtx(gitlabNoteCtx())
    await handleIssueConversation(gitlabNoteCtx(), makeBot(), stubOptions, stubPrompts)

    expect(replied()).toBe(true)
    // 迁移前这里会停在「skip (missing payload or action != created)」
    expect(logs.join('\n')).not.toContain('missing payload')
  })

  test('子组项目路径按最后一个斜杠切分（group/subgroup/demo）', async () => {
    setExecCtx(gitlabNoteCtx())
    await handleIssueConversation(gitlabNoteCtx(), makeBot(), stubOptions, stubPrompts)

    const [owner, repo] = platformState.getChangeRequest.mock.calls[0]
    expect(owner).toBe('group/subgroup')
    expect(repo).toBe('demo')
  })

  test('PR 标题与描述来自现查，不是 payload', async () => {
    setExecCtx(gitlabNoteCtx())
    await handleIssueConversation(gitlabNoteCtx(), makeBot(), stubOptions, stubPrompts)

    expect(platformState.getChangeRequest).toHaveBeenCalled()
  })
})

describe('REVIEW-015：行级对话的坐标来自归一化字段', () => {
  test('GitLab diff note 携带 path/line → 进入行级对话', async () => {
    const ctx = gitlabDiffNoteCtx()
    setExecCtx(ctx)
    await handleConversation(ctx, makeBot(), stubOptions, stubPrompts)

    expect(logs.join('\n')).not.toContain('missing payload')
    expect(logs.join('\n')).not.toContain('missing pull_request')
  })

  test('缺评论正文 → 跳过', async () => {
    const ctx = gitlabDiffNoteCtx({comment: undefined})
    setExecCtx(ctx)
    await handleConversation(ctx, makeBot(), stubOptions, stubPrompts)

    expect(replied()).toBe(false)
    expect(logs.join('\n')).toContain('missing comment body')
  })
})

describe('REVIEW-017：追问需要权限，查询失败 fail closed', () => {
  test('write 权限 → 放行', async () => {
    platformState.getCollaboratorPermission.mockResolvedValue('write')
    setExecCtx(gitlabNoteCtx())
    await handleIssueConversation(gitlabNoteCtx(), makeBot(), stubOptions, stubPrompts)

    expect(replied()).toBe(true)
  })

  test('read 权限且非作者 → 拒绝，不调用模型', async () => {
    platformState.getCollaboratorPermission.mockResolvedValue('read')
    const bot = makeBot()
    setExecCtx(gitlabNoteCtx())
    await handleIssueConversation(gitlabNoteCtx(), bot, stubOptions, stubPrompts)

    expect(replied()).toBe(false)
    expect(bot.chat).not.toHaveBeenCalled()
    expect(logs.join('\n')).toContain('权限不足')
  })

  test('read 权限但本人是 MR 作者 → 放行（对自己的变更提问是主要场景）', async () => {
    platformState.getCollaboratorPermission.mockResolvedValue('read')
    const ctx = gitlabNoteCtx({actor: {login: 'mr-author', isBot: false}})
    setExecCtx(ctx)
    await handleIssueConversation(ctx, makeBot(), stubOptions, stubPrompts)

    expect(replied()).toBe(true)
  })

  test('权限查询失败 → 拒绝，即使看起来是作者（fail closed，同 CMD-016）', async () => {
    platformState.getCollaboratorPermission.mockRejectedValue(new Error('403'))
    const ctx = gitlabNoteCtx({actor: {login: 'mr-author', isBot: false}})
    const bot = makeBot()
    setExecCtx(ctx)
    await handleIssueConversation(ctx, bot, stubOptions, stubPrompts)

    expect(replied()).toBe(false)
    expect(bot.chat).not.toHaveBeenCalled()
    expect(logs.join('\n')).toContain('权限查询失败')
  })

  test('行级对话同样受权限管辖', async () => {
    platformState.getCollaboratorPermission.mockResolvedValue('read')
    const ctx = gitlabDiffNoteCtx()
    const bot = makeBot()
    setExecCtx(ctx)
    await handleConversation(ctx, bot, stubOptions, stubPrompts)

    expect(bot.chat).not.toHaveBeenCalled()
  })
})

describe('REVIEW-018：reviewer 自身回复不触发新对话', () => {
  test('构造阶段判定的 bot → 跳过', async () => {
    const ctx = gitlabNoteCtx({actor: {login: 'project_1_bot_x', isBot: true}})
    setExecCtx(ctx)
    await handleIssueConversation(ctx, makeBot(), stubOptions, stubPrompts)

    expect(replied()).toBe(false)
  })

  test('作者等于本 reviewer → 跳过（GitLab 以个人 PAT 身份发言的常见形态）', async () => {
    const ctx = gitlabNoteCtx({actor: {login: BOT, isBot: false}})
    setExecCtx(ctx)
    await handleIssueConversation(ctx, makeBot(), stubOptions, stubPrompts)

    expect(replied()).toBe(false)
  })

  /**
   * §8.3 留下的尾巴：只按 marker 判定时，用户「引用回复」会把 marker 一起复制
   * 过去，于是他带着引用提问就永远得不到回复。
   */
  test('真人引用了带 marker 的正文 → 仍然回复（不再误判为 bot）', async () => {
    const ctx = gitlabNoteCtx({
      actor: {login: 'alice', isBot: false},
      comment: {
        kind: 'top_level',
        id: 9003,
        body: `> ${stateMarker('comment')}\n@ai-reviewer 这条我没看懂`
      }
    })
    setExecCtx(ctx)
    await handleIssueConversation(ctx, makeBot(), stubOptions, stubPrompts)

    expect(replied()).toBe(true)
  })

  test('身份判不出时退回 marker 兜底 → 跳过（宁可少答，也不形成反馈循环）', async () => {
    _resetBotIdentity()
    initBotGreeting('🤖', 'bot', '')
    platformState.getAuthenticatedLogin.mockRejectedValue(new Error('401'))
    const ctx = gitlabNoteCtx({
      actor: {login: 'unknown-user', isBot: false},
      comment: {
        kind: 'top_level',
        id: 9004,
        body: `> ${stateMarker('comment')}\n@ai-reviewer 追问`
      }
    })
    setExecCtx(ctx)
    await handleIssueConversation(ctx, makeBot(), {...stubOptions, botLogin: ''}, stubPrompts)

    expect(replied()).toBe(false)
  })
})

describe('两个平台共用同一条对话路径', () => {
  test.each<[Platform, string]>([
    ['github', 'octo/demo'],
    ['gitlab', 'group/subgroup/demo']
  ])('%s：@bot 顶层提问都能得到回复', async (platform, projectPath) => {
    setStateNamespace(platform)
    const ctx = {...gitlabNoteCtx(), platform, projectPath} as ExecutionContext
    setExecCtx(ctx)
    await handleIssueConversation(ctx, makeBot(), stubOptions, stubPrompts)

    expect(replied()).toBe(true)
  })
})
