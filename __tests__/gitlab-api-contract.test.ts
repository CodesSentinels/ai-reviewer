/**
 * gitlab-api-contract.test.ts — GitLab adapter 稳定性契约测试（TODO §7.5）
 *
 * GLAPI-024：所有 list API 走显式分页契约，超限时如实标记截断
 * GLAPI-027：写操作结合 marker，超时重试不产生重复内容
 * GLAPI-028：subgroup、URL 编码、Unicode 文件名、重命名文件
 * GLAPI-030/031：所有 API 家族经 @gitbeaker/rest 调用，adapter 不直接 fetch
 * GLAPI-032：snake_case 字段、分页、HTTP 状态、错误对象由适配层显式转换
 */
import {describe, expect, test, jest, beforeEach, afterEach} from '@jest/globals'
import * as fs from 'fs'
import * as path from 'path'
import {GitPlatformError} from '../src/platform/git-platform'
import {
  appendWriteMarker,
  buildWriteMarker,
  hasWriteMarker,
  newWriteOperationId,
  stripWriteMarkers
} from '../src/platform/gitlab-write-marker'

// ─── mock gitbeaker ──────────────────────────────────────────────────────────

const mockMergeRequests = {show: jest.fn<any>(), edit: jest.fn<any>(), allCommits: jest.fn<any>()}
const mockRepositories = {compare: jest.fn<any>(), allRepositoryTrees: jest.fn<any>()}
const mockRepositoryFiles = {show: jest.fn<any>()}
const mockMergeRequestNotes = {
  create: jest.fn<any>(),
  edit: jest.fn<any>(),
  remove: jest.fn<any>(),
  all: jest.fn<any>()
}
const mockMergeRequestDiscussions = {
  all: jest.fn<any>(),
  create: jest.fn<any>(),
  addNote: jest.fn<any>(),
  editNote: jest.fn<any>(),
  removeNote: jest.fn<any>(),
  resolve: jest.fn<any>()
}
const mockMergeRequestNoteAwardEmojis = {award: jest.fn<any>()}
const mockProjectMembers = {all: jest.fn<any>()}
const mockUsers = {all: jest.fn<any>(), showCurrentUser: jest.fn<any>()}

jest.mock('@gitbeaker/rest', () => ({
  Gitlab: jest.fn().mockImplementation(() => ({
    MergeRequests: mockMergeRequests,
    Repositories: mockRepositories,
    RepositoryFiles: mockRepositoryFiles,
    MergeRequestNotes: mockMergeRequestNotes,
    MergeRequestDiscussions: mockMergeRequestDiscussions,
    MergeRequestNoteAwardEmojis: mockMergeRequestNoteAwardEmojis,
    ProjectMembers: mockProjectMembers,
    Users: mockUsers
  }))
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {GitLabPlatform} = require('../src/platform/gitlab-platform')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {PAGINATION_DEFAULTS, TREE_PAGINATION_DEFAULTS} = require('../src/platform/gitlab-client')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {configureGitLabRetry, resetGitLabRetryPolicy} = require('../src/platform/gitlab-retry')

const TEST_CLIENT_CONFIG = {
  host: 'https://gitlab.example.com',
  credential: {type: 'pat', value: 'glpat-test-token'},
  timeoutMS: 30_000
}

/** gitbeaker 请求错误的等价形态 */
function requestError(status: number, message = 'boom') {
  const err = new Error(message)
  err.name = 'GitbeakerRequestError'
  ;(err as any).cause = {response: {status, headers: {get: () => null}}}
  return err
}

function timeoutError(): Error {
  const err = new Error('Query timeout was reached')
  err.name = 'GitbeakerTimeoutError'
  return err
}

describe('GitLab adapter 稳定性契约', () => {
  let platform: InstanceType<typeof GitLabPlatform>

  beforeEach(() => {
    jest.clearAllMocks()
    configureGitLabRetry({sleep: async () => {}, random: () => 0})
    platform = new GitLabPlatform(TEST_CLIENT_CONFIG)
  })

  afterEach(() => {
    resetGitLabRetryPolicy()
  })

  // ─── GLAPI-024 分页 ───────────────────────────────────────────────────────

  describe('GLAPI-024 分页', () => {
    test('每个 list API 都带 perPage/maxPages 且不带 page', async () => {
      mockMergeRequests.allCommits.mockResolvedValue([])
      mockMergeRequestNotes.all.mockResolvedValue([])
      mockMergeRequestDiscussions.all.mockResolvedValue([])
      mockRepositories.allRepositoryTrees.mockResolvedValue([])
      // 成员列表也是 list API（GLAPI-021 改用列表查询后），必须一起纳入契约断言，
      // 所以这里让用户查询命中，否则 getCollaboratorPermission 会提前返回
      mockUsers.all.mockResolvedValue([{id: 1, username: 'alice'}])
      mockProjectMembers.all.mockResolvedValue([{id: 1, access_level: 30}])

      await platform.listChangeRequestCommits('g', 'r', 1)
      await platform.listComments('g', 'r', 1)
      await platform.listReviewComments('g', 'r', 1)
      await platform.listRepositoryTree('g', 'r', 'main')
      await platform.getCollaboratorPermission('g', 'r', 'alice')

      // 文件树用自己的分页契约（条目轻量、数量大），其余 list API 用通用契约
      const listCalls = [
        [mockMergeRequests.allCommits.mock.calls[0][2], PAGINATION_DEFAULTS],
        [mockMergeRequestNotes.all.mock.calls[0][2], PAGINATION_DEFAULTS],
        [mockMergeRequestDiscussions.all.mock.calls[0][2], PAGINATION_DEFAULTS],
        [mockRepositories.allRepositoryTrees.mock.calls[0][1], TREE_PAGINATION_DEFAULTS],
        [mockUsers.all.mock.calls[0][0], PAGINATION_DEFAULTS],
        [mockProjectMembers.all.mock.calls[0][1], PAGINATION_DEFAULTS]
      ] as const
      for (const [opts, contract] of listCalls) {
        expect(opts).toMatchObject({
          perPage: contract.perPage,
          maxPages: contract.maxPages
        })
        expect(opts).not.toHaveProperty('page')
      }
    })

    test('多页结果由 SDK 合并后完整返回（1 次调用拿到全部 250 条 note）', async () => {
      const notes = Array.from({length: 250}, (_, i) => ({
        id: i + 1,
        body: `note ${i + 1}`,
        author: {username: 'u'},
        created_at: 't',
        system: false
      }))
      mockMergeRequestNotes.all.mockResolvedValue(notes)

      const result = await platform.listComments('g', 'r', 1)
      expect(result).toHaveLength(250)
      expect(mockMergeRequestNotes.all).toHaveBeenCalledTimes(1)
    })

    test('文件树未到上限 → truncated=false，且不发探测请求', async () => {
      mockRepositories.allRepositoryTrees.mockResolvedValue(
        Array.from({length: 10}, (_, i) => ({type: 'blob', path: `f${i}.ts`}))
      )
      const result = await platform.listRepositoryTree('g', 'r', 'main')
      expect(result.truncated).toBe(false)
      expect(mockRepositories.allRepositoryTrees).toHaveBeenCalledTimes(1)
    })

    test('文件树用独立的分页上限，通用上限（5000 条）不再触发截断', async () => {
      expect(TREE_PAGINATION_DEFAULTS.perPage * TREE_PAGINATION_DEFAULTS.maxPages).toBeGreaterThan(
        PAGINATION_DEFAULTS.perPage * PAGINATION_DEFAULTS.maxPages
      )
      const oldLimit = PAGINATION_DEFAULTS.perPage * PAGINATION_DEFAULTS.maxPages
      mockRepositories.allRepositoryTrees.mockResolvedValue(
        Array.from({length: oldLimit}, (_, i) => ({type: 'blob', path: `f${i}.ts`}))
      )
      const result = await platform.listRepositoryTree('g', 'r', 'main')
      expect(result.entries).toHaveLength(oldLimit)
      expect(result.truncated).toBe(false)
    })

    test('文件树查询按 TREE_PAGINATION_DEFAULTS 传分页参数', async () => {
      mockRepositories.allRepositoryTrees.mockResolvedValue([])
      await platform.listRepositoryTree('g', 'r', 'main')
      const opts = mockRepositories.allRepositoryTrees.mock.calls[0][1] as any
      expect(opts.perPage).toBe(TREE_PAGINATION_DEFAULTS.perPage)
      expect(opts.maxPages).toBe(TREE_PAGINATION_DEFAULTS.maxPages)
    })

    test('条目数正好卡在上限 + 下一页还有内容 → truncated=true', async () => {
      const limit = TREE_PAGINATION_DEFAULTS.perPage * TREE_PAGINATION_DEFAULTS.maxPages
      mockRepositories.allRepositoryTrees
        .mockResolvedValueOnce(
          Array.from({length: limit}, (_, i) => ({type: 'blob', path: `f${i}.ts`}))
        )
        .mockResolvedValueOnce([{type: 'blob', path: 'overflow.ts'}])

      const result = await platform.listRepositoryTree('g', 'r', 'main')
      expect(result.truncated).toBe(true)
      // 探测请求显式指定下一页，perPage 与主查询一致才对得上位置
      const probeOpts = mockRepositories.allRepositoryTrees.mock.calls[1][1] as any
      expect(probeOpts.page).toBe(TREE_PAGINATION_DEFAULTS.maxPages + 1)
      expect(probeOpts.perPage).toBe(TREE_PAGINATION_DEFAULTS.perPage)
    })

    test('条目数正好卡在上限但下一页为空 → 不误报截断', async () => {
      const limit = TREE_PAGINATION_DEFAULTS.perPage * TREE_PAGINATION_DEFAULTS.maxPages
      mockRepositories.allRepositoryTrees
        .mockResolvedValueOnce(
          Array.from({length: limit}, (_, i) => ({type: 'blob', path: `f${i}.ts`}))
        )
        .mockResolvedValueOnce([])

      const result = await platform.listRepositoryTree('g', 'r', 'main')
      expect(result.truncated).toBe(false)
    })

    test('探测请求失败 → 保守标记 truncated（不谎报完整）', async () => {
      const limit = TREE_PAGINATION_DEFAULTS.perPage * TREE_PAGINATION_DEFAULTS.maxPages
      mockRepositories.allRepositoryTrees
        .mockResolvedValueOnce(
          Array.from({length: limit}, (_, i) => ({type: 'blob', path: `f${i}.ts`}))
        )
        .mockRejectedValue(requestError(500))

      const result = await platform.listRepositoryTree('g', 'r', 'main')
      expect(result.truncated).toBe(true)
      expect(result.entries).toHaveLength(limit)
    })
  })

  // ─── GLAPI-025/026 重试语义在 adapter 层生效 ─────────────────────────────

  describe('GLAPI-025/026 adapter 层重试', () => {
    test('list 遇到 500 时重试并最终成功', async () => {
      mockMergeRequestNotes.all
        .mockRejectedValueOnce(requestError(500))
        .mockResolvedValue([
          {id: 1, body: 'ok', author: {username: 'u'}, created_at: 't', system: false}
        ])

      const result = await platform.listComments('g', 'r', 1)
      expect(result).toHaveLength(1)
      expect(mockMergeRequestNotes.all).toHaveBeenCalledTimes(2)
    })

    test('403 不重试，错误带权限诊断', async () => {
      mockMergeRequestNotes.all.mockRejectedValue(requestError(403, '403 Forbidden'))

      await expect(platform.listComments('g', 'r', 1)).rejects.toThrow(/Not retrying/)
      expect(mockMergeRequestNotes.all).toHaveBeenCalledTimes(1)
    })

    test('权限查询 401 时抛错且不重试（GLAPI-021/026 + CMD-016）', async () => {
      mockUsers.all.mockRejectedValue(requestError(401))
      // 抛错而不是返回 'none'：401 是「不知道」，不是「确认无权限」。
      // 返回 'none' 会让 permission.ts 记成 queryFailed=false，
      // dispatcher 随后仍承认 PR 作者豁免 → 权限 API 故障期间 fail open。
      await expect(platform.getCollaboratorPermission('g', 'r', 'alice')).rejects.toThrow(
        GitPlatformError
      )
      expect(mockUsers.all).toHaveBeenCalledTimes(1)
    })
  })

  // ─── GLAPI-027 写幂等 ─────────────────────────────────────────────────────

  describe('GLAPI-027 写操作幂等 marker', () => {
    const markerInput = (over: Record<string, unknown> = {}): any => ({
      // marker 现在带平台命名空间（STATE-015：两平台共用同一套实现）
      platform: 'gitlab' as const,
      projectPath: 'g/r',
      changeRequestId: 5,
      op: 'note',
      operationId: 'op-fixed-id',
      body: 'hello',
      ...over
    })

    test('marker 工具函数：生成 / 追加 / 命中 / 剥离', () => {
      const marker = buildWriteMarker(markerInput())
      expect(marker).toMatch(/^<!-- ai-reviewer:gitlab:write:5:note:[0-9a-f]{16} -->$/)
      const marked = appendWriteMarker('hello', marker)
      expect(hasWriteMarker(marked, marker)).toBe(true)
      expect(stripWriteMarkers(marked)).toBe('hello')
      // 重复追加不叠加
      expect(appendWriteMarker(marked, marker)).toBe(marked)
    })

    test('同 operationId 幂等：相同输入生成相同 marker（重试可复用）', () => {
      expect(buildWriteMarker(markerInput())).toBe(buildWriteMarker(markerInput()))
    })

    test('operationId 不同 → marker 不同（不同逻辑写入互不命中）', () => {
      const a = buildWriteMarker(markerInput({operationId: 'op-a'}))
      const b = buildWriteMarker(markerInput({operationId: 'op-b'}))
      expect(a).not.toBe(b)
    })

    test('newWriteOperationId 每次生成不同 ID', () => {
      expect(newWriteOperationId()).not.toBe(newWriteOperationId())
    })

    test('同 MR 同正文不同用途 / 不同 MR 的 marker 不互相命中', () => {
      const base = markerInput({body: 'x'})
      const a = buildWriteMarker(base)
      const b = buildWriteMarker({...base, op: 'reply'})
      const c = buildWriteMarker({...base, changeRequestId: 6})
      const d = buildWriteMarker({...base, opDetail: 'src/a.ts:42'})
      expect(new Set([a, b, c, d]).size).toBe(4)
    })

    test('marker 带 gitlab 命名空间，不与 GitHub 状态混用（A4）', () => {
      const marker = buildWriteMarker(markerInput({body: 'x'}))
      expect(marker).toContain(':gitlab:')
      expect(marker).not.toContain('github')
    })

    test('外部内容（含 --> 的文件路径 / 正文）不会破坏 marker 文本格式', () => {
      const hostile = 'src/evil--> <script>.ts'
      const marker = buildWriteMarker(
        markerInput({op: 'discussion', opDetail: `${hostile}:1`, body: `x --> y > z`})
      )
      // 路径与正文只以摘要形式参与，marker 文本仍是受限字符集
      expect(marker).toMatch(/^<!-- ai-reviewer:gitlab:write:5:discussion:[0-9a-f]{16} -->$/)
      expect(marker).not.toContain(hostile)
      // 剥离正则仍能完整移除
      expect(stripWriteMarkers(appendWriteMarker('body text', marker))).toBe('body text')
    })

    test('非法 op 字符被规范化，不泄漏进 marker 文本', () => {
      const marker = buildWriteMarker(markerInput({op: 'discussion:src/a.ts --> x'}))
      // op 被规范化为 [a-z0-9-] slug，marker 整体仍是固定格式
      expect(marker).toMatch(/^<!-- ai-reviewer:gitlab:write:5:[a-z][a-z0-9-]*:[0-9a-f]{16} -->$/)
      expect(marker).not.toContain('src/a.ts')
      // 只有结尾一处 '-->'，注释不会被提前闭合
      expect(marker.match(/-->/g)).toHaveLength(1)
    })

    test('超时重试：上一次其实已写入 → 复用既有 note，不重复创建', async () => {
      // 模拟「GitLab 已写入但响应丢了」：记录服务端实际收到的正文
      let stored: string | null = null
      mockMergeRequestNotes.create.mockImplementation(async (...args: any[]) => {
        stored = args[2] as string
        throw timeoutError()
      })
      mockMergeRequestNotes.all.mockImplementation(async () =>
        stored == null
          ? []
          : [{id: 777, body: stored, author: {username: 'bot'}, created_at: 't', system: false}]
      )

      const result = await platform.createComment('g', 'r', 5, 'summary body')
      expect(result.id).toBe(777)
      // 只尝试创建了一次，第二次走探测复用
      expect(mockMergeRequestNotes.create).toHaveBeenCalledTimes(1)
      // 返回给核心的正文不含 marker
      expect(result.body).toBe('summary body')
    })

    test('同正文的历史评论不会被误判为本次写入（每次写入 operationId 唯一）', async () => {
      // 第一次合法写入：记录服务端存下的带 marker 正文
      let historical = ''
      mockMergeRequestNotes.create.mockImplementation(async (...args: any[]) => {
        historical = args[2] as string
        return {id: 100, body: historical, author: {username: 'bot'}, created_at: 't'}
      })
      const first = await platform.createComment('g', 'r', 5, 'pause 已生效')
      expect(first.id).toBe(100)

      // 第二次发布完全相同的正文，首次请求超时；历史评论仍在列表里
      mockMergeRequestNotes.all.mockResolvedValue([
        {id: 100, body: historical, author: {username: 'bot'}, created_at: 't', system: false}
      ])
      mockMergeRequestNotes.create
        .mockReset()
        .mockRejectedValueOnce(timeoutError())
        .mockResolvedValue({
          id: 101,
          body: 'pause 已生效',
          author: {username: 'bot'},
          created_at: 't'
        })

      const second = await platform.createComment('g', 'r', 5, 'pause 已生效')
      // 必须真的重建，而不是把历史评论当作本次结果
      expect(second.id).toBe(101)
      expect(mockMergeRequestNotes.create).toHaveBeenCalledTimes(2)
    })

    test('超时重试：探测未命中 → 正常重建', async () => {
      mockMergeRequestNotes.all.mockResolvedValue([])
      mockMergeRequestNotes.create.mockRejectedValueOnce(timeoutError()).mockResolvedValue({
        id: 888,
        body: 'retry body',
        author: {username: 'bot'},
        created_at: 't'
      })

      const result = await platform.createComment('g', 'r', 5, 'retry body')
      expect(result.id).toBe(888)
      expect(mockMergeRequestNotes.create).toHaveBeenCalledTimes(2)
    })

    test('行级评论重试：discussion 已存在 → 不重复创建', async () => {
      mockMergeRequests.show.mockResolvedValue({
        diff_refs: {base_sha: 'b', head_sha: 'h', start_sha: 's'}
      })
      let stored: string | null = null
      mockMergeRequestDiscussions.create.mockImplementation(async (...args: any[]) => {
        stored = args[2] as string
        throw timeoutError()
      })
      mockMergeRequestDiscussions.all.mockImplementation(async () =>
        stored == null
          ? []
          : [{id: 'disc-existing', notes: [{id: 9001, body: stored, type: 'DiffNote'}]}]
      )

      await platform.createReviewComment('g', 'r', 5, 'sha', {
        path: 'src/a.ts',
        body: 'fix this',
        line: 42
      })
      expect(mockMergeRequestDiscussions.create).toHaveBeenCalledTimes(1)
    })

    test('含 --> 的文件路径：marker 不出现在渲染正文里，且能被剥离', async () => {
      const hostilePath = 'src/we--> ird.ts'
      mockMergeRequests.show.mockResolvedValue({
        diff_refs: {base_sha: 'b', head_sha: 'h', start_sha: 's'}
      })
      let stored = ''
      mockMergeRequestDiscussions.create.mockImplementation(async (...args: any[]) => {
        stored = args[2] as string
        return {id: 'd1', notes: [{id: 1, body: stored}]}
      })

      await platform.createReviewComment('g', 'r', 5, 'sha', {
        path: hostilePath,
        body: 'fix this',
        line: 1
      })
      // marker 里不含原始路径，注释不会被提前闭合
      expect(stored).not.toContain(`${hostilePath}:1`)
      expect(stored.split('\n\n').pop()).toMatch(
        /^<!-- ai-reviewer:gitlab:write:5:discussion:[0-9a-f]{16} -->$/
      )
      // 读回时能完整剥离，不会把内部标记暴露给用户
      expect(stripWriteMarkers(stored)).toBe('fix this')
    })

    test('删除重试遇到 404 视为已达成目标', async () => {
      mockMergeRequestNotes.create.mockResolvedValue({
        id: 500,
        body: 'x',
        author: {username: 'bot'},
        created_at: 't'
      })
      await platform.createComment('g', 'r', 5, 'x')

      mockMergeRequestNotes.remove.mockRejectedValue(requestError(404, '404 Note Not Found'))
      await expect(platform.deleteComment('g', 'r', 500)).resolves.toBeUndefined()
    })

    test('listComments 返回的正文已剥离 marker', async () => {
      const marker = buildWriteMarker(markerInput({body: 'visible text'}))
      mockMergeRequestNotes.all.mockResolvedValue([
        {
          id: 1,
          body: appendWriteMarker('visible text', marker),
          author: {username: 'bot'},
          created_at: 't',
          system: false
        }
      ])

      const comments = await platform.listComments('g', 'r', 5)
      expect(comments[0].body).toBe('visible text')
      expect(comments[0].body).not.toContain('ai-reviewer:gitlab:write')
    })

    test('用户正文中的其他 HTML 注释不被剥离', () => {
      const body = 'text <!-- user comment --> more'
      expect(stripWriteMarkers(body)).toBe(body)
    })
  })

  // ─── GLAPI-023 + GLAPI-025：Award Emoji 幂等 ──────────────────────────────

  describe('addReaction 冲突语义', () => {
    test('重复 award 同一 emoji（409）视为已达成，不抛错也不重试', async () => {
      mockMergeRequestNoteAwardEmojis.award.mockRejectedValue(
        requestError(409, '409 Conflict: has already been taken')
      )
      await expect(
        platform.addReaction('g', 'r', 5, 100, '+1', 'issue_comment')
      ).resolves.toBeUndefined()
      expect(mockMergeRequestNoteAwardEmojis.award).toHaveBeenCalledTimes(1)
    })

    test('非冲突错误仍然抛出（403 不重试）', async () => {
      mockMergeRequestNoteAwardEmojis.award.mockRejectedValue(requestError(403))
      await expect(platform.addReaction('g', 'r', 5, 100, '+1', 'issue_comment')).rejects.toThrow(
        GitPlatformError
      )
      expect(mockMergeRequestNoteAwardEmojis.award).toHaveBeenCalledTimes(1)
    })

    test('5xx 先按退避重试，耗尽后抛出', async () => {
      mockMergeRequestNoteAwardEmojis.award.mockRejectedValue(requestError(500))
      await expect(platform.addReaction('g', 'r', 5, 100, '+1', 'issue_comment')).rejects.toThrow(
        GitPlatformError
      )
      expect(mockMergeRequestNoteAwardEmojis.award).toHaveBeenCalledTimes(3)
    })
  })

  // ─── GLAPI-028 subgroup / URL 编码 / Unicode / 重命名 ─────────────────────

  describe('GLAPI-028 路径与文件名边界', () => {
    test('subgroup（多层 group）项目路径原样拼接后交给 SDK 编码', async () => {
      mockMergeRequests.show.mockResolvedValue({
        iid: 3,
        title: 't',
        description: '',
        state: 'opened',
        diff_refs: {base_sha: 'b', head_sha: 'h'},
        target_branch: 'main',
        source_branch: 'f',
        author: {username: 'a'}
      })

      await platform.getChangeRequest('group/sub/subsub', 'repo', 3)
      expect(mockMergeRequests.show).toHaveBeenCalledWith('group/sub/subsub/repo', 3)
    })

    test('Unicode 文件名不做二次编码，原样传给 SDK', async () => {
      mockRepositoryFiles.show.mockResolvedValue({
        content: Buffer.from('内容', 'utf8').toString('base64')
      })

      const content = await platform.getFileContent('组', '项目', 'src/组件/按钮.vue', 'main')
      expect(content).toBe('内容')
      expect(mockRepositoryFiles.show).toHaveBeenCalledWith('组/项目', 'src/组件/按钮.vue', 'main')
    })

    test('含空格、#、% 等特殊字符的路径原样传给 SDK', async () => {
      mockRepositoryFiles.show.mockResolvedValue({
        content: Buffer.from('x', 'utf8').toString('base64')
      })

      await platform.getFileContent('g', 'r', 'docs/a b#c%d.md', 'feat/分支 名')
      expect(mockRepositoryFiles.show).toHaveBeenCalledWith(
        'g/r',
        'docs/a b#c%d.md',
        'feat/分支 名'
      )
    })

    test('Unicode 路径的文件内容按 UTF-8 解码（不是 latin1）', async () => {
      mockRepositoryFiles.show.mockResolvedValue({
        content: Buffer.from('const 变量 = "值" // emoji 🚀', 'utf8').toString('base64')
      })
      const content = await platform.getFileContent('g', 'r', '源码/文件.ts', 'main')
      expect(content).toBe('const 变量 = "值" // emoji 🚀')
    })

    test('重命名文件映射为 renamed + previousFilename', async () => {
      mockRepositories.compare.mockResolvedValue({
        diffs: [
          {
            old_path: 'src/旧名.ts',
            new_path: 'src/新名.ts',
            renamed_file: true,
            diff: '@@ -1 +1 @@'
          },
          {old_path: 'a.ts', new_path: 'a.ts', new_file: true, diff: '@@'},
          {old_path: 'b.ts', new_path: 'b.ts', deleted_file: true, diff: '@@'},
          {old_path: 'c.ts', new_path: 'c.ts', diff: '@@'}
        ],
        commits: [{id: 'sha1'}]
      })

      const result = await platform.compareDiff('g', 'r', 'base', 'head')
      expect(result.files[0]).toEqual({
        filename: 'src/新名.ts',
        status: 'renamed',
        patch: '@@ -1 +1 @@',
        previousFilename: 'src/旧名.ts'
      })
      expect(result.files[1].status).toBe('added')
      expect(result.files[2].status).toBe('removed')
      expect(result.files[3].status).toBe('modified')
      expect(result.files[3].previousFilename).toBeUndefined()
    })

    test('subgroup 项目的行级评论 discussion 落在正确的 projectPath', async () => {
      mockMergeRequests.show.mockResolvedValue({
        diff_refs: {base_sha: 'b', head_sha: 'h', start_sha: 's'}
      })
      mockMergeRequestDiscussions.create.mockResolvedValue({id: 'd1', notes: [{id: 1}]})

      await platform.createReviewComment('group/sub', 'repo', 7, 'sha', {
        path: 'src/组件.vue',
        body: 'x',
        line: 1
      })
      const [projectPath, iid, , opts] = mockMergeRequestDiscussions.create.mock.calls[0]
      expect(projectPath).toBe('group/sub/repo')
      expect(iid).toBe(7)
      expect((opts as any).position.newPath).toBe('src/组件.vue')
    })
  })

  // ─── GLAPI-032 snake_case / 状态 / 错误对象适配 ───────────────────────────

  describe('GLAPI-032 SDK 响应适配', () => {
    test('snake_case 响应字段转换为平台无关 camelCase', async () => {
      mockMergeRequests.show.mockResolvedValue({
        iid: 9,
        title: 't',
        description: 'd',
        state: 'opened',
        diff_refs: {base_sha: 'bbb', head_sha: 'hhh', start_sha: 'sss'},
        target_branch: 'main',
        source_branch: 'feat',
        author: {username: 'a'}
      })

      const info = await platform.getChangeRequest('g', 'r', 9)
      expect(info).toMatchObject({baseSha: 'bbb', headSha: 'hhh', baseRef: 'main', headRef: 'feat'})
    })

    test('SDK 错误对象转换为 GitPlatformError 而不是原样抛出', async () => {
      mockRepositoryFiles.show.mockRejectedValue(requestError(500))
      const error = await platform.getFileContent('g', 'r', 'a.ts', 'main').catch((e: any) => e)
      expect(error).toBeInstanceOf(GitPlatformError)
      expect(error.errorKind).toBe('server_error')
      expect(error.name).not.toBe('GitbeakerRequestError')
    })

    test('404 语义由适配层决定：文件缺失 → null，而不是抛错', async () => {
      mockRepositoryFiles.show.mockRejectedValue(requestError(404))
      await expect(platform.getFileContent('g', 'r', 'missing.ts', 'main')).resolves.toBeNull()
    })
  })

  // ─── GLAPI-030/031 客户端边界 ────────────────────────────────────────────

  describe('GLAPI-030/031 客户端边界（源码扫描）', () => {
    const SRC = path.resolve(__dirname, '../src')
    const adapterFiles = ['platform/gitlab-platform.ts', 'platform/gitlab-client.ts']

    test('GitLab adapter 不直接调用原生 fetch', () => {
      for (const file of adapterFiles) {
        const content = fs.readFileSync(path.join(SRC, file), 'utf8')
        expect(content).not.toMatch(/\bfetch\s*\(/)
      }
    })

    test('只有 gitlab-client.ts 构造 Gitlab 实例（唯一 client factory）', () => {
      const constructing = fs
        .readdirSync(path.join(SRC, 'platform'))
        .filter(f => f.endsWith('.ts'))
        .filter(f =>
          /new\s+Gitlab\s*\(/.test(fs.readFileSync(path.join(SRC, 'platform', f), 'utf8'))
        )
      expect(constructing).toEqual(['gitlab-client.ts'])
    })

    test('adapter 覆盖 Projects / MR / Files / Tree / Notes / Discussions / Members / Emoji 家族', () => {
      const content = fs.readFileSync(path.join(SRC, 'platform/gitlab-platform.ts'), 'utf8')
      for (const family of [
        'MergeRequests.',
        'MergeRequestNotes.',
        'MergeRequestDiscussions.',
        'MergeRequestNoteAwardEmojis',
        'RepositoryFiles.',
        'Repositories.',
        'ProjectMembers',
        'Users.'
      ]) {
        expect(content).toContain(family)
      }
    })
  })
})

/**
 * GitLab 没有批量 review：adapter 内部逐条创建 discussion，行级失败时降级为顶层
 * note。早先它只回一个「成功几条」的数字，调用方无从知道**哪几条**没发出去，
 * 于是会误删那些位置上被取代的 resolved 旧讨论（REVIEW-013），失败项也进不了
 * 统一的顶层降级（REVIEW-014）。这里钉住逐条汇报。
 */
describe('REVIEW-013/014: submitReviewComments 必须逐条汇报成败', () => {
  let platform: any

  beforeEach(() => {
    jest.clearAllMocks()
    platform = new GitLabPlatform(TEST_CLIENT_CONFIG)
    mockMergeRequests.show.mockResolvedValue({
      diff_refs: {base_sha: 'b', head_sha: 'h', start_sha: 's'}
    })
  })

  const drafts = [
    {path: 'a.ts', line: 1, body: 'A'},
    {path: 'b.ts', line: 2, body: 'B'},
    {path: 'c.ts', line: 3, body: 'C'}
  ]

  test('全部成功 → delivered 三条，failed 为空', async () => {
    mockMergeRequestDiscussions.create.mockResolvedValue({id: 'd1'})

    const r = await platform.submitReviewComments('g', 'p', 1, 'sha', drafts)

    expect(r.delivered.map((d: any) => d.path)).toEqual(['a.ts', 'b.ts', 'c.ts'])
    expect(r.failed).toEqual([])
  })

  test('行级失败但顶层降级成功 → 仍算 delivered', async () => {
    mockMergeRequestDiscussions.create.mockRejectedValue(new Error('400 position invalid'))
    mockMergeRequestNotes.create.mockResolvedValue({id: 9})

    const r = await platform.submitReviewComments('g', 'p', 1, 'sha', drafts)

    expect(r.delivered).toHaveLength(3)
    expect(r.failed).toEqual([])
  })

  test('部分条目两层都失败 → 精确出现在 failed 里', async () => {
    // 正文是第 3 个位置参数（不是 options.body），按它区分条目
    mockMergeRequestDiscussions.create.mockImplementation(async (_p: any, _i: any, body: any) => {
      if (String(body ?? '').includes('B')) throw new Error('400 position invalid')
      return {id: 'd1'}
    })
    mockMergeRequestNotes.create.mockRejectedValue(new Error('403 forbidden'))

    const r = await platform.submitReviewComments('g', 'p', 1, 'sha', drafts)

    expect(r.delivered.map((d: any) => d.path)).toEqual(['a.ts', 'c.ts'])
    expect(r.failed.map((d: any) => d.path)).toEqual(['b.ts'])
  })

  test('全部两层皆败 → failed 含全部条目，且不谎报成功', async () => {
    mockMergeRequestDiscussions.create.mockRejectedValue(new Error('400'))
    mockMergeRequestNotes.create.mockRejectedValue(new Error('403'))

    const r = await platform.submitReviewComments('g', 'p', 1, 'sha', drafts)

    expect(r.delivered).toEqual([])
    expect(r.failed).toHaveLength(3)
  })
})
