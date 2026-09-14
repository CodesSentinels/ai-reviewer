/**
 * gitlab-diff-position.test.ts — GitLab diff position 映射（§14.1 TEST-006）
 *
 * GitLab 的行级评论不像 GitHub 那样「给个 path + line 就行」：它要一个完整的
 * `position` 对象——base/head/start 三个 SHA，加上 old_path/new_path 与
 * old_line/new_line。这几个字段之间有约束（新增行不能带 old_line、删除行不能带
 * new_line、三个 SHA 必须齐全），填错的直接后果是 400，然后 adapter 降级成顶层
 * note（GLAPI-015）——评论还在，但丢了行号锚点，用户得自己去 diff 里找。
 *
 * 既有 `gitlab-platform.test.ts` 只覆盖了「普通修改文件」这一条 happy path。
 * 本文件按 TEST-006 的四个维度补齐：**新增、删除、重命名、旧 SHA**，并且每个
 * 维度都成对地测「位置怎么构造」和「构造不出来时怎么降级」——只测前者的话，
 * 一旦 GitLab 收紧校验，失败会静悄悄地变成一堆顶层 note 而没人发现。
 *
 * 不在本文件重复覆盖的相邻行为：
 *   review-input-handling.test.ts   删除文件不进入行级审查（REVIEW-005）
 *   state-idempotency-retry.test.ts HEAD 中途变化 → staleSkipped（STATE-011/012）
 *   gitlab-platform.test.ts         compareDiff 的 renamed/removed 状态映射
 */
import {describe, expect, test, jest, beforeEach, afterEach} from '@jest/globals'

// ─── mock gitbeaker ──────────────────────────────────────────────────────────

const mockMergeRequests = {
  show: jest.fn<any>(),
  edit: jest.fn<any>(),
  allCommits: jest.fn<any>()
}
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

jest.mock('@gitbeaker/rest', () => ({
  Gitlab: jest.fn().mockImplementation(() => ({
    MergeRequests: mockMergeRequests,
    MergeRequestNotes: mockMergeRequestNotes,
    MergeRequestDiscussions: mockMergeRequestDiscussions,
    Repositories: {},
    RepositoryFiles: {},
    MergeRequestNoteAwardEmojis: {},
    ProjectMembers: {},
    Users: {}
  }))
}))

const logs: string[] = []
jest.mock('../src/platform/logger', () => ({
  getLogger: () => ({
    info: (m: string) => logs.push(m),
    warning: (m: string) => logs.push(m),
    error: (m: string) => logs.push(m),
    debug: () => {}
  }),
  setLogger: jest.fn()
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {GitLabPlatform} = require('../src/platform/gitlab-platform')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {configureGitLabRetry, resetGitLabRetryPolicy} = require('../src/platform/gitlab-retry')

const TEST_CLIENT_CONFIG = {
  host: 'https://gitlab.example.com',
  credential: {type: 'pat', value: 'glpat-test-token'},
  timeoutMS: 30_000
}

/** MR 当前 diff 的三个锚点 SHA，position 必须原样带上 */
const DIFF_REFS = {base_sha: 'base111', head_sha: 'head222', start_sha: 'start333'}

/** GitLab 拒绝非法 position 时的真实形态：400 + 明确文案 */
function invalidPositionError(): Error {
  const e: any = new Error('400 Bad Request - Note position is invalid')
  e.status = 400
  return e
}

describe('GitLab diff position 映射（TEST-006）', () => {
  let platform: InstanceType<typeof GitLabPlatform>

  beforeEach(() => {
    jest.clearAllMocks()
    logs.length = 0
    // 重试逻辑照常执行，只是不真的等待
    configureGitLabRetry({sleep: async () => {}})
    platform = new GitLabPlatform(TEST_CLIENT_CONFIG)
    mockMergeRequests.show.mockResolvedValue({diff_refs: DIFF_REFS})
    mockMergeRequestDiscussions.create.mockResolvedValue({
      id: 'disc-1',
      notes: [{id: 9001, body: 'x', author: {username: 'bot'}}]
    })
    mockMergeRequestNotes.create.mockResolvedValue({
      id: 9002,
      body: 'x',
      author: {username: 'bot'},
      created_at: '2026-09-03'
    })
  })

  afterEach(() => {
    resetGitLabRetryPolicy()
  })

  /** 取最近一次 discussion 创建时传的 position */
  function lastPosition(): any {
    const calls = mockMergeRequestDiscussions.create.mock.calls
    return (calls[calls.length - 1] as any[])[3].position
  }

  // ─── 1. 新增文件 ────────────────────────────────────────────────────────────

  describe('新增文件：只能落在 new 侧', () => {
    test('position 带 new_line，且**不带** old_line', async () => {
      await platform.createReviewComment('g', 'r', 5, 'commit-sha', {
        path: 'src/brand-new.ts',
        body: '这个新文件有问题',
        line: 12
      })

      const pos = lastPosition()
      expect(pos.newPath).toBe('src/brand-new.ts')
      expect(pos.newLine).toBe('12')
      // 新增行在旧版本里不存在，带上 old_line 会被 GitLab 当成「上下文行」去
      // 匹配旧文件，位置直接对不上。缺席和显式 null 都可以，有值就是错的。
      expect(pos.oldLine ?? null).toBeNull()
    })

    test('new_line 是字符串——GitLab 的 position 字段按字符串比对', async () => {
      await platform.createReviewComment('g', 'r', 5, 'commit-sha', {
        path: 'src/brand-new.ts',
        body: 'x',
        line: 12
      })

      expect(typeof lastPosition().newLine).toBe('string')
    })

    test('position_type 固定为 text（不是 image/file）', async () => {
      await platform.createReviewComment('g', 'r', 5, 'commit-sha', {
        path: 'src/brand-new.ts',
        body: 'x',
        line: 1
      })

      expect(lastPosition().positionType).toBe('text')
    })
  })

  // ─── 2. 删除文件 ────────────────────────────────────────────────────────────

  describe('删除文件：位置注定映射不出来，必须降级而不是丢评论', () => {
    /**
     * 正常链路上这种评论根本不会产生——review.ts 的 REVIEW-005 把已删除文件挡在
     * 行级审查之外（见 review-input-handling.test.ts）。但那是**上游**的保证，
     * adapter 不能假设上游永远正确：命令路径、重放的旧 payload 都可能绕过它。
     * 这里验的是最后一道兜底。
     */
    test('GitLab 拒绝位置 → 降级为顶层 note，评论内容不丢', async () => {
      mockMergeRequestDiscussions.create.mockRejectedValue(invalidPositionError())

      const result = await platform.submitReviewComments('g', 'r', 5, 'commit-sha', [
        {path: 'src/gone.ts', body: '这个删掉的文件有问题', line: 7}
      ])

      expect(result.delivered).toHaveLength(1)
      expect(result.failed).toEqual([])
      // 降级后的正文必须自己带上位置，否则读的人无从知道说的是哪一行
      expect(mockMergeRequestNotes.create).toHaveBeenCalledWith(
        'g/r',
        5,
        expect.stringContaining('**src/gone.ts** (line 7)')
      )
      expect(mockMergeRequestNotes.create).toHaveBeenCalledWith(
        'g/r',
        5,
        expect.stringContaining('这个删掉的文件有问题')
      )
    })

    test('400 不重试——非法位置重试多少次都还是非法', async () => {
      mockMergeRequestDiscussions.create.mockRejectedValue(invalidPositionError())

      await platform.submitReviewComments('g', 'r', 5, 'commit-sha', [
        {path: 'src/gone.ts', body: 'x', line: 7}
      ])

      expect(mockMergeRequestDiscussions.create).toHaveBeenCalledTimes(1)
    })

    test('行级与顶层都失败 → 进 failed，不谎报已投递', async () => {
      mockMergeRequestDiscussions.create.mockRejectedValue(invalidPositionError())
      mockMergeRequestNotes.create.mockRejectedValue(new Error('500 boom'))

      const result = await platform.submitReviewComments('g', 'r', 5, 'commit-sha', [
        {path: 'src/gone.ts', body: 'x', line: 7}
      ])

      expect(result.delivered).toEqual([])
      expect(result.failed).toHaveLength(1)
      expect(result.failed[0].path).toBe('src/gone.ts')
    })
  })

  // ─── 3. 重命名文件 ──────────────────────────────────────────────────────────

  describe('重命名文件：old_path 与 new_path 分属两侧', () => {
    /**
     * 已知简化（GLAPI-014 记录在案）：`ReviewCommentDraft` 只有一个 `path`
     * 字段——共享核心不区分「改名前/改名后」，于是 adapter 只能把 old_path 填成
     * 与 new_path 相同的值。对改名文件这与 GitLab 的语义不符（正确值是改名前的
     * 路径）。
     *
     * 这里不去猜 GitLab 会不会接受，而是钉住两件此刻确定的事：
     *   1. 当前确实是「两侧同值」——将来要修时这条会红，提醒同步改文档与实现
     *   2. 不管 GitLab 接不接受，评论都不会丢（降级路径可用）
     */
    test('当前映射：old_path 与 new_path 同值（已知简化）', async () => {
      await platform.createReviewComment('g', 'r', 5, 'commit-sha', {
        path: 'src/renamed-to.ts',
        body: 'x',
        line: 3
      })

      const pos = lastPosition()
      expect(pos.newPath).toBe('src/renamed-to.ts')
      expect(pos.oldPath).toBe('src/renamed-to.ts')
    })

    test('GitLab 若因 old_path 不符拒绝 → 降级为顶层 note，用新路径标位置', async () => {
      mockMergeRequestDiscussions.create.mockRejectedValue(invalidPositionError())

      const result = await platform.submitReviewComments('g', 'r', 5, 'commit-sha', [
        {path: 'src/renamed-to.ts', body: '改名后的文件有问题', line: 3}
      ])

      expect(result.delivered).toHaveLength(1)
      expect(mockMergeRequestNotes.create).toHaveBeenCalledWith(
        'g/r',
        5,
        expect.stringContaining('**src/renamed-to.ts** (line 3)')
      )
    })

    test('读方向：note 的 old_path/new_path 不同时，取 new_path 作为文件名', async () => {
      mockMergeRequestDiscussions.all.mockResolvedValue([
        {
          id: 'disc-renamed',
          notes: [
            {
              id: 4001,
              type: 'DiffNote',
              system: false,
              body: 'note on renamed file',
              author: {username: 'bot'},
              created_at: '2026-09-03',
              position: {
                old_path: 'src/renamed-from.ts',
                new_path: 'src/renamed-to.ts',
                old_line: null,
                new_line: '3'
              }
            }
          ]
        }
      ])

      const comments = await platform.listReviewComments('g', 'r', 5)
      // 下游按「当前树里的路径」定位，改名前的路径在当前树里已经不存在了
      expect(comments[0].path).toBe('src/renamed-to.ts')
      expect(comments[0].line).toBe(3)
    })

    test('读方向：new_path 缺席（纯删除侧）时回退到 old_path，而不是空串', async () => {
      mockMergeRequestDiscussions.all.mockResolvedValue([
        {
          id: 'disc-deleted',
          notes: [
            {
              id: 4002,
              type: 'DiffNote',
              system: false,
              body: 'note on deleted file',
              author: {username: 'bot'},
              created_at: '2026-09-03',
              position: {
                old_path: 'src/gone.ts',
                new_path: null,
                old_line: '9',
                new_line: null
              }
            }
          ]
        }
      ])

      const comments = await platform.listReviewComments('g', 'r', 5)
      expect(comments[0].path).toBe('src/gone.ts')
      // 删除侧没有新行号，line 必须是 null 而不是 0/NaN——下游用 `line != null`
      // 判断能不能定位，0 会被当成合法行号
      expect(comments[0].line).toBeNull()
      expect(comments[0].originalLine).toBe(9)
    })
  })

  // ─── 4. 旧 SHA / diff_refs ──────────────────────────────────────────────────

  describe('旧 SHA：position 锚点必须来自当前 diff version', () => {
    test('三个 SHA 取自 MergeRequests.show 的 diff_refs，不是传入的 commitSha', async () => {
      await platform.createReviewComment('g', 'r', 5, 'reviewed-sha', {
        path: 'a.ts',
        body: 'x',
        line: 1
      })

      const pos = lastPosition()
      expect(pos.baseSha).toBe('base111')
      expect(pos.headSha).toBe('head222')
      expect(pos.startSha).toBe('start333')
      // commitId 是另一回事：它标记「这条评论基于哪次提交做出的判断」
      const call = mockMergeRequestDiscussions.create.mock.calls[0] as any[]
      expect(call[3].commitId).toBe('reviewed-sha')
    })

    test('每条评论都现取 diff_refs，不复用上一条的旧值（GLAPI-013）', async () => {
      await platform.submitReviewComments('g', 'r', 5, 'sha', [
        {path: 'a.ts', body: 'c1', line: 1},
        {path: 'b.ts', body: 'c2', line: 2}
      ])

      expect(mockMergeRequests.show).toHaveBeenCalledTimes(2)
    })

    test('MR 期间被推了新 commit（head_sha ≠ commitSha）→ 位置用新 diff 的锚点', async () => {
      // 这是有意为之：position 必须与**当前** diff version 对齐，否则 GitLab
      // 找不到对应的 diff file。至于「结论是不是基于旧 HEAD 得出的」，由
      // STATE-011/012 的 ensureFresh 在批次层拦截（见 state-idempotency-retry）。
      mockMergeRequests.show.mockResolvedValue({
        diff_refs: {...DIFF_REFS, head_sha: 'head-NEW'}
      })

      await platform.createReviewComment('g', 'r', 5, 'head-OLD', {
        path: 'a.ts',
        body: 'x',
        line: 1
      })

      const call = mockMergeRequestDiscussions.create.mock.calls[0] as any[]
      expect(lastPosition().headSha).toBe('head-NEW')
      expect(call[3].commitId).toBe('head-OLD')
    })

    test('diff_refs 整体缺失 → 不发注定被拒的请求，直接降级', async () => {
      mockMergeRequests.show.mockResolvedValue({iid: 5}) // 没有 diff_refs

      const result = await platform.submitReviewComments('g', 'r', 5, 'sha', [
        {path: 'a.ts', body: 'x', line: 1}
      ])

      expect(mockMergeRequestDiscussions.create).not.toHaveBeenCalled()
      expect(result.delivered).toHaveLength(1)
      expect(mockMergeRequestNotes.create).toHaveBeenCalled()
    })

    test('diff_refs 缺 start_sha → 同样直接降级，不拼半个 position', async () => {
      // 三个 SHA 少一个，position 就是非法的。把 `startSha: undefined` 发出去只是
      // 多换一个 400 回来，还白花一次 API 配额。
      mockMergeRequests.show.mockResolvedValue({
        diff_refs: {base_sha: 'b', head_sha: 'h', start_sha: null}
      })

      const result = await platform.submitReviewComments('g', 'r', 5, 'sha', [
        {path: 'a.ts', body: 'x', line: 1}
      ])

      expect(mockMergeRequestDiscussions.create).not.toHaveBeenCalled()
      expect(result.delivered).toHaveLength(1)
    })

    test('diff_refs 不完整时留下可定位的日志', async () => {
      mockMergeRequests.show.mockResolvedValue({diff_refs: {base_sha: 'b'}})

      await platform.submitReviewComments('g', 'r', 5, 'sha', [{path: 'a.ts', body: 'x', line: 1}])

      const joined = logs.join('\n')
      expect(joined).toMatch(/diff_refs/)
      expect(joined).toContain('a.ts')
    })
  })

  // ─── 5. 多行评论降级 ────────────────────────────────────────────────────────

  describe('多行评论：GitLab text position 只认单行', () => {
    test('带 startLine 的评论落在 line（结束行）上，不产生非法的多行 position', async () => {
      await platform.createReviewComment('g', 'r', 5, 'sha', {
        path: 'a.ts',
        body: 'x',
        line: 20,
        startLine: 15,
        startSide: 'RIGHT'
      })

      const pos = lastPosition()
      expect(pos.newLine).toBe('20')
      // GitLab 的 text position 没有「范围」概念，多塞字段只会被拒
      expect(pos).not.toHaveProperty('lineRange')
      expect(pos).not.toHaveProperty('startLine')
    })
  })
})
