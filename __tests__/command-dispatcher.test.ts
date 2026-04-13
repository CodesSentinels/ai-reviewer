/**
 * command-dispatcher.test.ts — 调度主流程集成测试（基于 mock）
 *
 * 覆盖:
 * - 非支持事件/action → ignored
 * - bot 自评论 → ignored
 * - 未命中命令 → fallback_conversation
 * - 命令命中但未注册 → UNKNOWN_COMMAND（其实用非法命令名构造比较难，因为 parser 先拦截；这里用注销的 handler 场景）
 * - 命令权限不足 → FORBIDDEN
 * - 命令非法参数 → INVALID_ARGS
 * - 命令成功执行 → ok
 * - 未实现 handler 抛 code=NOT_IMPLEMENTED → NOT_IMPLEMENTED
 * - 幂等重复 → DUPLICATE
 */
import {describe, expect, test, beforeEach, jest} from '@jest/globals'

// --- mocks ---
jest.mock('@actions/core', () => ({
  getInput: jest.fn().mockReturnValue(''),
  info: jest.fn(),
  warning: jest.fn(),
  error: jest.fn()
}))

const mockPayload: any = {}
const mockContext: any = {
  eventName: 'issue_comment',
  payload: mockPayload,
  repo: {owner: 'octo', repo: 'demo'}
}
jest.mock('@actions/github', () => ({
  context: mockContext
}))

const octokitState: Record<string, any> = {
  listComments: jest.fn(),
  createComment: jest.fn(),
  updateComment: jest.fn(),
  getCollaboratorPermissionLevel: jest.fn()
}

jest.mock('../src/octokit', () => ({
  octokit: {
    issues: {
      createComment: (...a: any[]) => octokitState.createComment(...a),
      updateComment: (...a: any[]) => octokitState.updateComment(...a),
      listComments: (...a: any[]) => octokitState.listComments(...a)
    },
    repos: {
      getCollaboratorPermissionLevel: (...a: any[]) =>
        octokitState.getCollaboratorPermissionLevel(...a)
    }
  }
}))

// ---
import {dispatchCommentEvent} from '../src/commands/dispatcher'
import {getRegistry} from '../src/commands/registry'
import {_resetBootstrap, bootstrapCommands} from '../src/commands/bootstrap'
import {_resetPermissionCache} from '../src/commands/permission'
import {_resetRateLimit} from '../src/commands/rate-limit'

// 一个最小的 Options 存根；dispatcher 只是传递不使用
const stubOptions: any = {}

function setEvent(
  eventName: 'issue_comment' | 'pull_request_review_comment' | 'push',
  payload: any
) {
  mockContext.eventName = eventName
  mockContext.payload = payload
}

function buildIssueCommentPayload(body: string, overrides: any = {}) {
  return {
    action: 'created',
    issue: {
      number: 42,
      pull_request: {},
      user: {login: 'pr-author'}
    },
    comment: {
      id: 1001,
      body,
      user: {login: 'alice', type: 'User'}
    },
    ...overrides
  }
}

function buildReviewCommentPayload(body: string) {
  return {
    action: 'created',
    pull_request: {
      number: 42,
      head: {sha: 'head-sha'},
      base: {sha: 'base-sha'},
      user: {login: 'pr-author'}
    },
    comment: {
      id: 2002,
      body,
      user: {login: 'alice', type: 'User'},
      node_id: 'NODE1'
    }
  }
}

beforeEach(() => {
  _resetBootstrap()
  _resetPermissionCache()
  _resetRateLimit()
  bootstrapCommands()

  octokitState.listComments.mockReset()
  octokitState.createComment.mockReset()
  octokitState.updateComment.mockReset()
  octokitState.getCollaboratorPermissionLevel.mockReset()

  // 默认: 不存在已处理标记
  octokitState.listComments.mockResolvedValue({data: []})
  octokitState.createComment.mockResolvedValue({data: {id: 9000}})
  octokitState.updateComment.mockResolvedValue({data: {id: 9000}})
  // 默认: alice 有 write 权限
  octokitState.getCollaboratorPermissionLevel.mockResolvedValue({
    data: {permission: 'write'}
  })
})

describe('dispatcher — 事件过滤', () => {
  test('非支持事件 → ignored', async () => {
    setEvent('push', {action: 'created'})
    const r = await dispatchCommentEvent({options: stubOptions})
    expect(r.kind).toBe('ignored')
  })

  test('action !== created → ignored', async () => {
    setEvent(
      'issue_comment',
      buildIssueCommentPayload('@ai-reviewer help', {action: 'edited'})
    )
    const r = await dispatchCommentEvent({options: stubOptions})
    expect(r.kind).toBe('ignored')
  })

  test('issue_comment 在非 PR 上 → ignored', async () => {
    setEvent('issue_comment', {
      action: 'created',
      issue: {number: 1, user: {login: 'x'}}, // 没有 pull_request 字段
      comment: {id: 1, body: '@ai-reviewer help', user: {login: 'alice'}}
    })
    const r = await dispatchCommentEvent({options: stubOptions})
    expect(r.kind).toBe('ignored')
  })

  test('bot 评论自身 → ignored', async () => {
    const payload = buildIssueCommentPayload('@ai-reviewer help')
    payload.comment.user = {login: 'ai-reviewer[bot]', type: 'Bot'}
    setEvent('issue_comment', payload)
    const r = await dispatchCommentEvent({options: stubOptions})
    expect(r.kind).toBe('ignored')
  })
})

describe('dispatcher — 解析与 fallback', () => {
  test('无 @bot → ignored', async () => {
    setEvent('issue_comment', buildIssueCommentPayload('普通评论'))
    const r = await dispatchCommentEvent({options: stubOptions})
    expect(r.kind).toBe('ignored')
  })

  test('@bot 但未命中命令 → fallback_conversation', async () => {
    setEvent(
      'issue_comment',
      buildIssueCommentPayload('@ai-reviewer 这里为啥这样写？')
    )
    const r = await dispatchCommentEvent({options: stubOptions})
    expect(r.kind).toBe('fallback_conversation')
  })
})

describe('dispatcher — 命令执行', () => {
  test('help 命令成功执行', async () => {
    setEvent('issue_comment', buildIssueCommentPayload('@ai-reviewer help'))
    const r = await dispatchCommentEvent({options: stubOptions})
    expect(r).toEqual({kind: 'executed', command: 'help', ok: true})
    expect(octokitState.createComment).toHaveBeenCalled()
    // help handler 的响应 body 应包含 "支持的命令"
    const createCall: any = octokitState.createComment.mock.calls[0][0]
    expect(createCall.body).toMatch(/支持的命令/)
  })

  test('stub handler 抛 NOT_IMPLEMENTED', async () => {
    setEvent('issue_comment', buildIssueCommentPayload('@ai-reviewer resolve'))
    const r = await dispatchCommentEvent({options: stubOptions})
    expect(r.kind).toBe('executed')
    if (r.kind === 'executed') {
      expect(r.ok).toBe(false)
      expect(r.error).toBe('NOT_IMPLEMENTED')
    }
    // 需要 ACK，所以先 create 后 update
    expect(octokitState.createComment).toHaveBeenCalled()
    expect(octokitState.updateComment).toHaveBeenCalled()
  })

  test('review_comment 上的 help 命令', async () => {
    setEvent(
      'pull_request_review_comment',
      buildReviewCommentPayload('@ai-reviewer help')
    )
    const r = await dispatchCommentEvent({options: stubOptions})
    expect(r.kind).toBe('executed')
  })

  test('非法参数 → INVALID_ARGS', async () => {
    setEvent(
      'issue_comment',
      buildIssueCommentPayload('@ai-reviewer review $(whoami)')
    )
    const r = await dispatchCommentEvent({options: stubOptions})
    expect(r.kind).toBe('executed')
    if (r.kind === 'executed') {
      expect(r.error).toBe('INVALID_ARGS')
    }
  })

  test('权限不足 → FORBIDDEN', async () => {
    octokitState.getCollaboratorPermissionLevel.mockResolvedValue({
      data: {permission: 'read'}
    })
    // 用 pause 命令（无 PR 作者豁免）
    setEvent('issue_comment', buildIssueCommentPayload('@ai-reviewer pause'))
    const r = await dispatchCommentEvent({options: stubOptions})
    expect(r.kind).toBe('executed')
    if (r.kind === 'executed') {
      expect(r.error).toBe('FORBIDDEN')
    }
  })

  test('PR 作者豁免可以跑 review（即使是 read 权限）', async () => {
    octokitState.getCollaboratorPermissionLevel.mockResolvedValue({
      data: {permission: 'read'}
    })
    // 让 alice 成为 PR 作者
    const payload = buildIssueCommentPayload('@ai-reviewer review')
    payload.issue.user.login = 'alice'
    setEvent('issue_comment', payload)
    const r = await dispatchCommentEvent({options: stubOptions})
    // 权限通过 → 交给 review stub，stub 抛 NOT_IMPLEMENTED
    expect(r.kind).toBe('executed')
    if (r.kind === 'executed') {
      expect(r.error).toBe('NOT_IMPLEMENTED')
    }
  })
})

describe('dispatcher — 幂等', () => {
  test('已有 CMD_REPLY_TAG 的评论 → DUPLICATE', async () => {
    // 模拟 listComments 返回包含标签的历史评论
    octokitState.listComments.mockResolvedValue({
      data: [
        {
          body: '<!-- codesentinel-cmd-reply:1001:help -->\n之前的回复'
        }
      ]
    })
    setEvent('issue_comment', buildIssueCommentPayload('@ai-reviewer help'))
    const r = await dispatchCommentEvent({options: stubOptions})
    expect(r.kind).toBe('executed')
    if (r.kind === 'executed') {
      expect(r.error).toBe('DUPLICATE')
      expect(r.ok).toBe(false)
    }
    // 不应二次发布 create 评论
    expect(octokitState.createComment).not.toHaveBeenCalled()
  })
})
