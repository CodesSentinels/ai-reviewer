/**
 * github-execution-context.test.ts — createGitHubExecutionContext() 单元测试（U1）
 *
 * 覆盖 4 类 GitHub 事件（PR 开启/更新/重开/元数据更新）+ 2 类评论事件
 * （issue_comment/pull_request_review_comment）+ 缺字段 fail-closed 场景。
 * 参考 docs/tasks/execution-context-design.md 第 9.2 节 U1。
 */
import {describe, expect, test, beforeEach, jest} from '@jest/globals'

const mockContext: any = {
  eventName: '',
  actor: 'octocat',
  payload: {},
  repo: {owner: 'octo', repo: 'demo'}
}
jest.mock('@actions/github', () => ({context: mockContext}))

import {createGitHubExecutionContext} from '../src/platform/github-execution-context'
import {ExecutionContextError} from '../src/platform/execution-context'

/** 捕获 fn 抛出的异常并返回，未抛出时让测试失败（避免依赖非标准全局 fail()） */
function getThrownError(fn: () => unknown): unknown {
  try {
    fn()
  } catch (e) {
    return e
  }
  throw new Error('Expected function to throw, but it did not')
}

function makePr(overrides: Record<string, any> = {}): any {
  return {
    number: 42,
    base: {sha: 'base-sha-0001'},
    head: {sha: 'head-sha-0001'},
    ...overrides
  }
}

describe('createGitHubExecutionContext()', () => {
  beforeEach(() => {
    delete process.env.GITHUB_EVENT_NAME
    mockContext.eventName = ''
    mockContext.actor = 'octocat'
    mockContext.payload = {}
    mockContext.repo = {owner: 'octo', repo: 'demo'}
  })

  test('GITHUB_EVENT_NAME 未设置 → ExecutionContextError(missing_payload)', () => {
    const e = getThrownError(() => createGitHubExecutionContext())
    expect(e).toBeInstanceOf(ExecutionContextError)
    expect((e as ExecutionContextError).platform).toBe('github')
    expect((e as ExecutionContextError).reason).toBe('missing_payload')
  })

  test('不支持的事件类型（如 push）→ ExecutionContextError(unknown_event)', () => {
    process.env.GITHUB_EVENT_NAME = 'push'
    const e = getThrownError(() => createGitHubExecutionContext())
    expect(e).toBeInstanceOf(ExecutionContextError)
    expect((e as ExecutionContextError).reason).toBe('unknown_event')
    expect((e as ExecutionContextError).message).toContain('push')
  })

  test('pull_request action=opened → eventKind=pr_opened，字段映射正确', () => {
    process.env.GITHUB_EVENT_NAME = 'pull_request'
    mockContext.payload = {action: 'opened', pull_request: makePr()}

    const execCtx = createGitHubExecutionContext()

    expect(execCtx.platform).toBe('github')
    expect(execCtx.eventKind).toBe('pr_opened')
    expect(execCtx.projectPath).toBe('octo/demo')
    expect(execCtx.projectId).toBe('octo/demo')
    expect(execCtx.changeRequestId).toBe(42)
    expect(execCtx.baseSha).toBe('base-sha-0001')
    expect(execCtx.headSha).toBe('head-sha-0001')
    expect(execCtx.actor).toEqual({login: 'octocat', isBot: false})
    expect(execCtx.comment).toBeUndefined()
    expect(execCtx.raw).toBe(mockContext.payload)
  })

  test('pull_request_target action=synchronize → eventKind=pr_synchronize', () => {
    process.env.GITHUB_EVENT_NAME = 'pull_request_target'
    mockContext.payload = {action: 'synchronize', pull_request: makePr()}

    const execCtx = createGitHubExecutionContext()
    expect(execCtx.eventKind).toBe('pr_synchronize')
  })

  test('pull_request action=reopened → eventKind=pr_reopened', () => {
    process.env.GITHUB_EVENT_NAME = 'pull_request'
    mockContext.payload = {action: 'reopened', pull_request: makePr()}

    const execCtx = createGitHubExecutionContext()
    expect(execCtx.eventKind).toBe('pr_reopened')
  })

  test('pull_request action=labeled（其它元数据更新）→ eventKind=metadata_updated', () => {
    process.env.GITHUB_EVENT_NAME = 'pull_request'
    mockContext.payload = {action: 'labeled', pull_request: makePr()}

    const execCtx = createGitHubExecutionContext()
    expect(execCtx.eventKind).toBe('metadata_updated')
  })

  test('pull_request 事件缺少 pull_request 字段 → ExecutionContextError(missing_required_field)', () => {
    process.env.GITHUB_EVENT_NAME = 'pull_request'
    mockContext.payload = {action: 'opened'}

    const e = getThrownError(() => createGitHubExecutionContext())
    expect(e).toBeInstanceOf(ExecutionContextError)
    expect((e as ExecutionContextError).reason).toBe('missing_required_field')
  })

  test('issue_comment → eventKind=comment_created，comment.kind=top_level', () => {
    process.env.GITHUB_EVENT_NAME = 'issue_comment'
    mockContext.payload = {
      action: 'created',
      issue: {number: 42},
      comment: {id: 9001, node_id: 'IC_xxx', user: {login: 'alice'}}
    }

    const execCtx = createGitHubExecutionContext()

    expect(execCtx.eventKind).toBe('comment_created')
    expect(execCtx.changeRequestId).toBe(42)
    expect(execCtx.baseSha).toBe('')
    expect(execCtx.headSha).toBe('')
    expect(execCtx.actor).toEqual({login: 'alice', isBot: false})
    expect(execCtx.comment).toEqual({
      kind: 'top_level',
      id: 9001,
      threadId: 'IC_xxx'
    })
  })

  test('pull_request_review_comment → eventKind=review_comment_created，comment.kind=review_thread', () => {
    process.env.GITHUB_EVENT_NAME = 'pull_request_review_comment'
    mockContext.payload = {
      action: 'created',
      pull_request: {number: 42},
      comment: {id: 9002, node_id: 'PRRC_xxx', user: {login: 'bob'}}
    }

    const execCtx = createGitHubExecutionContext()

    expect(execCtx.eventKind).toBe('review_comment_created')
    expect(execCtx.changeRequestId).toBe(42)
    expect(execCtx.comment).toEqual({
      kind: 'review_thread',
      id: 9002,
      threadId: 'PRRC_xxx'
    })
  })

  test('评论事件缺少 comment 字段 → ExecutionContextError(missing_required_field)', () => {
    process.env.GITHUB_EVENT_NAME = 'issue_comment'
    mockContext.payload = {action: 'created', issue: {number: 42}}

    const e = getThrownError(() => createGitHubExecutionContext())
    expect(e).toBeInstanceOf(ExecutionContextError)
    expect((e as ExecutionContextError).reason).toBe('missing_required_field')
  })

  test('评论事件缺少 PR number（issue/pull_request 均为空） → ExecutionContextError(missing_required_field)', () => {
    process.env.GITHUB_EVENT_NAME = 'issue_comment'
    mockContext.payload = {action: 'created', comment: {id: 1, user: {}}}

    const e = getThrownError(() => createGitHubExecutionContext())
    expect(e).toBeInstanceOf(ExecutionContextError)
    expect((e as ExecutionContextError).reason).toBe('missing_required_field')
  })

  test('bot 评论者 login 以 [bot] 结尾 → actor.isBot=true', () => {
    process.env.GITHUB_EVENT_NAME = 'issue_comment'
    mockContext.payload = {
      action: 'created',
      issue: {number: 42},
      comment: {id: 1, user: {login: 'github-actions[bot]'}}
    }

    const execCtx = createGitHubExecutionContext()
    expect(execCtx.actor).toEqual({login: 'github-actions[bot]', isBot: true})
  })

  test('pull_request* 事件的 actor 来自 context.actor（bot 后缀同样识别）', () => {
    process.env.GITHUB_EVENT_NAME = 'pull_request'
    mockContext.actor = 'dependabot[bot]'
    mockContext.payload = {action: 'opened', pull_request: makePr()}

    const execCtx = createGitHubExecutionContext()
    expect(execCtx.actor).toEqual({login: 'dependabot[bot]', isBot: true})
  })
})
