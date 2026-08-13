/**
 * gitlab-permission-failclosed.test.ts — GitLab 权限链路端到端 fail closed（CMD-016 / GLAPI-021）
 *
 * 既有测试各测各的：gitlab-platform.test.ts 只看 adapter 返回值，
 * command-dispatcher.test.ts 用的是 mock 平台。中间那段
 * 「adapter 的异常语义 → permission.ts 的 queryFailed → dispatcher 的作者豁免」
 * 从来没有被端到端钉住，于是 GitLab adapter 把 401/超时/5xx 折叠成 'none' 时
 * 没有任何测试报警——permission.ts 记成 queryFailed=false，dispatcher 照常承认
 * PR 作者豁免，权限 API 故障期间任何作者都能触发 review/summary（fail open）。
 *
 * 本文件用**真实的 GitLabPlatform**（只 mock 掉 gitbeaker HTTP 层）跑完整条链，
 * 钉住两件相反的事：
 *   1. 查询失败（401/403/超时/5xx）→ 连 PR 作者都必须被拒
 *   2. 查询成功且确认不是成员 → 外部贡献者在自己 MR 上的作者豁免仍然有效
 */
import {describe, expect, test, afterEach, beforeEach, jest} from '@jest/globals'

// ─── Mocks ────────────────────────────────────────────────────────────────

const mockUsers = {all: jest.fn<any>(), showCurrentUser: jest.fn<any>()}
const mockProjectMembers = {all: jest.fn<any>()}
jest.mock('@gitbeaker/rest', () => ({
  Gitlab: jest.fn().mockImplementation(() => ({
    Users: mockUsers,
    ProjectMembers: mockProjectMembers
  }))
}))

const mockContext: any = {
  eventName: 'issue_comment',
  payload: {},
  repo: {owner: 'group', repo: 'demo'}
}
jest.mock('@actions/github', () => ({context: mockContext}))

jest.mock('../src/platform/logger', () => ({
  getLogger: () => ({info: jest.fn(), warning: jest.fn(), error: jest.fn(), debug: jest.fn()}),
  setLogger: jest.fn()
}))

/**
 * 平台单例替换成真实的 GitLabPlatform 实例。
 * 必须保留模块其余导出（GitPlatformError 等），否则 adapter 内部的
 * instanceof / 构造会拿到 undefined。
 */
const platformHolder: {instance: any; comments: any[]} = {instance: null, comments: []}
jest.mock('../src/platform/git-platform', () => {
  const actual = jest.requireActual('../src/platform/git-platform') as any
  return {
    ...actual,
    getPlatform: () => platformHolder.instance
  }
})

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {GitLabPlatform} = require('../src/platform/gitlab-platform')

import {dispatchCommentEvent} from '../src/commands/dispatcher'
import {_resetBootstrap, bootstrapCommands} from '../src/commands/bootstrap'
import {_resetPermissionCache, getPermissionResult} from '../src/commands/permission'
import {_resetRateLimit} from '../src/commands/rate-limit'
import {configureGitLabRetry, resetGitLabRetryPolicy} from '../src/platform/gitlab-retry'

const TEST_CLIENT_CONFIG = {
  host: 'https://gitlab.example.com',
  credential: {type: 'pat', value: 'glpat-test'},
  timeoutMS: 30_000
}

const stubOptions: any = {commandAckReaction: 'eyes'}

/** 评论 / MR 相关的平台能力不是本文件的关注点，用最小存根盖住 */
function stubNonPermissionApis(platform: any): void {
  platform.listComments = jest.fn<any>(async () => [])
  platform.createComment = jest.fn<any>(async (_o: any, _r: any, _n: any, body: string) => {
    platformHolder.comments.push(body)
    return {id: 9000, body, author: 'bot'}
  })
  platform.updateComment = jest.fn<any>(async () => undefined)
  platform.addReaction = jest.fn<any>(async () => undefined)
  platform.updateChangeRequestBody = jest.fn<any>(async () => undefined)
  platform.getChangeRequest = jest.fn<any>(async () => ({
    number: 42,
    title: '',
    body: 'MR body',
    state: 'open',
    baseSha: 'base-sha',
    headSha: 'head-sha',
    baseRef: 'main',
    headRef: 'feature',
    author: 'mr-author'
  }))
}

/** MR 作者本人发的命令评论 */
function authorComment(body: string): any {
  return {
    action: 'created',
    issue: {number: 42, pull_request: {}, user: {login: 'mr-author'}},
    comment: {id: 1001, body, user: {login: 'mr-author', type: 'User'}}
  }
}

function apiError(status: number, message = 'boom'): Error {
  return Object.assign(new Error(message), {response: {status}})
}

beforeEach(() => {
  jest.clearAllMocks()
  // 重试的真实 sleep 会让 5xx/超时用例慢上几百毫秒，这里只关心语义
  configureGitLabRetry({sleep: async () => {}, random: () => 0})
  _resetBootstrap()
  _resetPermissionCache()
  _resetRateLimit()
  bootstrapCommands()

  platformHolder.comments = []
  platformHolder.instance = new GitLabPlatform(TEST_CLIENT_CONFIG)
  stubNonPermissionApis(platformHolder.instance)

  mockContext.eventName = 'issue_comment'
  mockContext.payload = {}
})

afterEach(() => {
  resetGitLabRetryPolicy()
})

// ─── adapter → permission ─────────────────────────────────────────────────

describe('GitLabPlatform → permission.ts', () => {
  test.each([
    ['401 Unauthorized', 401],
    ['403 Forbidden', 403],
    ['500 Internal Server Error', 500]
  ])('成员查询 %s → queryFailed=true', async (msg, status) => {
    mockUsers.all.mockRejectedValue(apiError(status, msg))

    const result = await getPermissionResult({
      owner: 'group',
      repo: 'demo',
      username: 'mr-author'
    })

    expect(result.queryFailed).toBe(true)
    expect(result.level).toBe('none')
  })

  test('确认不是项目成员（成员列表为空）→ queryFailed=false（这是答案，不是故障）', async () => {
    mockUsers.all.mockResolvedValue([{id: 7, username: 'mr-author'}])
    mockProjectMembers.all.mockResolvedValue([])

    const result = await getPermissionResult({
      owner: 'group',
      repo: 'demo',
      username: 'mr-author'
    })

    expect(result.queryFailed).toBe(false)
    expect(result.level).toBe('none')
  })

  test('DEVELOPER → write 且 queryFailed=false', async () => {
    mockUsers.all.mockResolvedValue([{id: 7, username: 'mr-author'}])
    mockProjectMembers.all.mockResolvedValue([{id: 7, access_level: 30}])

    const result = await getPermissionResult({
      owner: 'group',
      repo: 'demo',
      username: 'mr-author'
    })

    expect(result).toEqual({level: 'write', queryFailed: false})
  })
})

// ─── adapter → permission → dispatcher ────────────────────────────────────

describe('GitLabPlatform → permission → dispatcher（作者豁免的安全边界）', () => {
  test.each([
    ['401 Unauthorized', 401],
    ['403 Forbidden', 403],
    ['500 Internal Server Error', 500]
  ])('权限 API %s → 连 MR 作者的 review 也被拒（CMD-016）', async (msg, status) => {
    mockUsers.all.mockRejectedValue(apiError(status, msg))
    mockContext.payload = authorComment('@ai-reviewer review')

    const r = await dispatchCommentEvent({options: stubOptions})

    expect(r.kind).toBe('executed')
    if (r.kind === 'executed') {
      expect(r.error).toBe('FORBIDDEN')
    }
    // 回帖必须说明是「查询失败」而不是「你没权限」，否则运维无从排查
    expect(platformHolder.comments.join('\n')).toContain('查询失败')
  })

  test('网络错误同样拒绝（不只有 HTTP 状态码算失败）', async () => {
    mockUsers.all.mockRejectedValue(new Error('ETIMEDOUT'))
    mockContext.payload = authorComment('@ai-reviewer summary')

    const r = await dispatchCommentEvent({options: stubOptions})

    expect(r.kind).toBe('executed')
    if (r.kind === 'executed') {
      expect(r.error).toBe('FORBIDDEN')
    }
  })

  test('对照组：确认不是成员的外部贡献者，在自己 MR 上仍可用作者豁免', async () => {
    // 这条是上面 fail closed 的边界——不能因为要拦住故障就把正常路径一起拦死
    mockUsers.all.mockResolvedValue([{id: 7, username: 'mr-author'}])
    mockProjectMembers.all.mockResolvedValue([])
    mockContext.payload = authorComment('@ai-reviewer help')

    const r = await dispatchCommentEvent({options: stubOptions})

    expect(r.kind).toBe('executed')
    if (r.kind === 'executed') {
      expect(r.error).toBeUndefined()
    }
  })

  test('对照组：非作者且权限查询失败 → 同样拒绝', async () => {
    mockUsers.all.mockRejectedValue(apiError(401, '401 Unauthorized'))
    mockContext.payload = {
      action: 'created',
      issue: {number: 42, pull_request: {}, user: {login: 'mr-author'}},
      comment: {id: 1002, body: '@ai-reviewer review', user: {login: 'someone-else', type: 'User'}}
    }

    const r = await dispatchCommentEvent({options: stubOptions})

    expect(r.kind).toBe('executed')
    if (r.kind === 'executed') {
      expect(r.error).toBe('FORBIDDEN')
    }
  })
})
