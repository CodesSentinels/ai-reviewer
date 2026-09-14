/**
 * command-rate-limit-dispatch.test.ts — 限流在调度链路上的行为（CMD-028/029/030）
 *
 * `command-rate-limit.test.ts` 测的是纯函数，证明不了**接线**：dispatcher 到底
 * 有没有把四个维度都传进去。这层区别很实际——只要 dispatcher 少传一维，纯函数
 * 用例照样全绿，串桶却已经发生了。
 *
 * 所以这里从 `dispatchCommentEvent` 入口进，用真实的 ExecutionContext 驱动，
 * 断言的是可观测结果：命令到底执行了没有、是不是回了 RATE_LIMITED。
 */
import {describe, expect, test, beforeEach, jest} from '@jest/globals'

import type {ExecutionContext, Platform} from '../src/platform/execution-context'
import {setExecCtx} from '../src/platform/run-context'

jest.mock('../src/platform/logger', () => ({
  getLogger: () => ({info: jest.fn(), warning: jest.fn(), error: jest.fn(), debug: jest.fn()})
}))

const platformState: Record<string, any> = {
  listComments: jest.fn<any>(),
  createComment: jest.fn<any>(),
  updateComment: jest.fn<any>(),
  getCollaboratorPermission: jest.fn<any>(),
  getChangeRequest: jest.fn<any>(),
  updateChangeRequestBody: jest.fn<any>(),
  replyToReviewComment: jest.fn<any>(),
  addReaction: jest.fn<any>(),
  getAuthenticatedLogin: jest.fn<any>()
}
jest.mock('../src/platform/git-platform', () => ({getPlatform: () => platformState}))

import {dispatchCommentEvent} from '../src/commands/dispatcher'
import {_resetBootstrap, bootstrapCommands} from '../src/commands/bootstrap'
import {_resetPermissionCache} from '../src/commands/permission'
import {_resetRateLimit, _RATE_LIMIT_CONSTANTS} from '../src/commands/rate-limit'
import {setStateNamespace} from '../src/platform/state-namespace'

const {MAX_PER_WINDOW} = _RATE_LIMIT_CONSTANTS
const stubOptions: any = {commandAckReaction: 'eyes'}

interface EventShape {
  platform?: Platform
  projectPath?: string
  changeRequestId?: number
  actor?: string
  commentId?: number
}

function makeCtx(over: EventShape = {}): ExecutionContext {
  const platform = over.platform ?? 'github'
  setStateNamespace(platform)
  const ctx = {
    platform,
    projectPath: over.projectPath ?? 'octo/demo',
    projectId: over.projectPath ?? 'octo/demo',
    changeRequestId: over.changeRequestId ?? 42,
    eventKind: 'comment_created',
    actor: {login: over.actor ?? 'alice', isBot: false},
    baseSha: '',
    headSha: '',
    comment: {kind: 'top_level', id: over.commentId ?? 1001, body: '@ai-reviewer help'},
    raw: {}
  } as ExecutionContext
  setExecCtx(ctx)
  return ctx
}

/** 跑一次调度，返回是否被限流拒绝 */
async function dispatch(over: EventShape = {}): Promise<{rateLimited: boolean; error?: string}> {
  const execCtx = makeCtx(over)
  const r = await dispatchCommentEvent({execCtx, options: stubOptions})
  const error = r.kind === 'executed' ? r.error : undefined
  return {rateLimited: error === 'RATE_LIMITED', error}
}

/**
 * 把某个事件形状打满配额。
 *
 * 每次换一个 commentId——同一个 commentId 会先撞上幂等检查（DUPLICATE）而根本
 * 走不到限流，那样「打满」是假的，后续断言全部失效。
 */
async function saturate(over: EventShape = {}): Promise<void> {
  for (let i = 0; i < MAX_PER_WINDOW; i++) {
    const {rateLimited, error} = await dispatch({...over, commentId: 5000 + i})
    expect(rateLimited).toBe(false)
    expect(error).toBeUndefined()
  }
}

beforeEach(() => {
  _resetBootstrap()
  _resetPermissionCache()
  _resetRateLimit()
  bootstrapCommands()

  for (const key of Object.keys(platformState)) platformState[key].mockReset()

  platformState.listComments.mockResolvedValue([])
  platformState.createComment.mockResolvedValue({id: 9000, body: '', author: 'bot'})
  platformState.updateComment.mockResolvedValue(undefined)
  platformState.addReaction.mockResolvedValue(undefined)
  platformState.getAuthenticatedLogin.mockResolvedValue('bot')
  platformState.updateChangeRequestBody.mockResolvedValue(undefined)
  platformState.getCollaboratorPermission.mockResolvedValue('write')
  platformState.getChangeRequest.mockResolvedValue({
    number: 42,
    title: '',
    body: 'body',
    state: 'open',
    baseSha: 'base-sha',
    headSha: 'head-sha',
    baseRef: 'main',
    headRef: 'feature',
    author: 'pr-author'
  })
})

describe('CMD-028：两个平台共用限流接口，key 来自各自的规范化上下文', () => {
  /**
   * 每条用例**只改一个维度**。
   *
   * 第一版这里的跨平台用例同时换了 platform 和 projectPath（github+octo/demo
   * vs gitlab+group/demo），于是 dispatcher 漏传 platform 时 projectPath 仍不
   * 同、漏传 projectPath 时 platform 仍不同，两种接线缺陷都测不出来——注入验证
   * 时才发现三个维度里只有一个真的被覆盖。
   */
  test('platform 单独变化：GitHub 打满后，同一人同一项目路径在 GitLab 上仍可执行', async () => {
    await saturate({platform: 'github', projectPath: 'octo/demo'})
    expect(
      (await dispatch({platform: 'github', projectPath: 'octo/demo', commentId: 7001})).rateLimited
    ).toBe(true)

    expect(
      (await dispatch({platform: 'gitlab', projectPath: 'octo/demo', commentId: 7002})).rateLimited
    ).toBe(false)
  })

  test('platform 单独变化（反向）：GitLab 打满后 GitHub 仍可执行', async () => {
    await saturate({platform: 'gitlab', projectPath: 'octo/demo'})
    expect(
      (await dispatch({platform: 'gitlab', projectPath: 'octo/demo', commentId: 7003})).rateLimited
    ).toBe(true)

    expect(
      (await dispatch({platform: 'github', projectPath: 'octo/demo', commentId: 7004})).rateLimited
    ).toBe(false)
  })

  test('projectPath 单独变化：同平台的另一个项目不受影响', async () => {
    await saturate({platform: 'gitlab', projectPath: 'group/demo'})
    expect(
      (await dispatch({platform: 'gitlab', projectPath: 'group/demo', commentId: 7010})).rateLimited
    ).toBe(true)

    expect(
      (await dispatch({platform: 'gitlab', projectPath: 'group/other', commentId: 7011}))
        .rateLimited
    ).toBe(false)
  })

  test('changeRequestId 单独变化：同一项目的另一个 MR 不受影响', async () => {
    await saturate({platform: 'gitlab', projectPath: 'group/demo', changeRequestId: 42})
    expect(
      (
        await dispatch({
          platform: 'gitlab',
          projectPath: 'group/demo',
          changeRequestId: 42,
          commentId: 7005
        })
      ).rateLimited
    ).toBe(true)

    expect(
      (
        await dispatch({
          platform: 'gitlab',
          projectPath: 'group/demo',
          changeRequestId: 43,
          commentId: 7006
        })
      ).rateLimited
    ).toBe(false)
  })

  test('actor 单独变化：同一 MR 上的另一个人不受影响', async () => {
    await saturate({actor: 'alice'})

    expect((await dispatch({actor: 'alice', commentId: 7007})).rateLimited).toBe(true)
    expect((await dispatch({actor: 'bob', commentId: 7008})).rateLimited).toBe(false)
  })

  test('对照组：四维全同确实会被限（证明上面的放行不是因为限流没接上）', async () => {
    await saturate()
    expect((await dispatch({commentId: 7009})).rateLimited).toBe(true)
  })
})

describe('CMD-030：重复投递靠幂等挡，不靠限流，也不消耗配额', () => {
  /**
   * GitLab Note Hook 会重复投递。若靠限流去挡，10 次之后才拦得住，而且会把正常
   * 用户的配额吃光。dispatcher 里幂等检查排在限流之前，正是为此。
   */
  test('同一条 note 重复投递 → DUPLICATE，而不是 RATE_LIMITED', async () => {
    // 第一次正常执行，并在评论区留下幂等 marker
    const first = await dispatch({commentId: 8001})
    expect(first.error).toBeUndefined()

    // 让下一次调度「看到」上一次的回复
    const posted = platformState.createComment.mock.calls.map((c: any[]) => c[3] ?? c[2]).join('\n')
    platformState.listComments.mockResolvedValue([{id: 1, body: posted, author: 'bot'}])

    const again = await dispatch({commentId: 8001})
    expect(again.error).toBe('DUPLICATE')
    expect(again.rateLimited).toBe(false)
  })

  test('重复投递不消耗配额：挡掉 N 次后，正常命令仍能执行', async () => {
    const first = await dispatch({commentId: 8002})
    expect(first.error).toBeUndefined()

    const posted = platformState.createComment.mock.calls.map((c: any[]) => c[3] ?? c[2]).join('\n')
    platformState.listComments.mockResolvedValue([{id: 1, body: posted, author: 'bot'}])

    // 同一条 note 再投递 MAX_PER_WINDOW 次——若这些也计入配额，桶早就满了
    for (let i = 0; i < MAX_PER_WINDOW; i++) {
      expect((await dispatch({commentId: 8002})).error).toBe('DUPLICATE')
    }

    platformState.listComments.mockResolvedValue([]) // 换一条新 note
    const fresh = await dispatch({commentId: 8003})
    expect(fresh.rateLimited).toBe(false)
    expect(fresh.error).toBeUndefined()
  })
})
