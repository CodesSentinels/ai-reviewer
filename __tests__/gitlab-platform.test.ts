/**
 * gitlab-platform.test.ts — GitLabPlatform adapter 单元测试
 *
 * GLAPI-001~012 + DEP-001/004
 *
 * 测试策略：mock @gitbeaker/rest 的 Gitlab 构造函数，验证 GitLabPlatform
 * 方法正确调用 gitbeaker API 并将结果/错误转换为平台无关类型。
 */
import {describe, expect, test, jest, beforeEach, afterEach} from '@jest/globals'
import {GitPlatformError} from '../src/platform/git-platform'

// ─── mock gitbeaker ──────────────────────────────────────────────────────────

const mockMergeRequests = {
  show: jest.fn<any>(),
  edit: jest.fn<any>(),
  allCommits: jest.fn<any>()
}
const mockRepositories = {
  compare: jest.fn<any>(),
  allRepositoryTrees: jest.fn<any>()
}
const mockRepositoryFiles = {
  show: jest.fn<any>()
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
const mockMergeRequestNoteAwardEmojis = {
  award: jest.fn<any>()
}
const mockProjectMembers = {
  all: jest.fn<any>()
}
const mockUsers = {
  all: jest.fn<any>(),
  showCurrentUser: jest.fn<any>()
}

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
const {GitLabPlatform, FALLBACK_BOT_LOGIN} = require('../src/platform/gitlab-platform')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {PAGINATION_DEFAULTS, TREE_PAGINATION_DEFAULTS} = require('../src/platform/gitlab-client')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {configureGitLabRetry, resetGitLabRetryPolicy} = require('../src/platform/gitlab-retry')

/** GLAPI-029：adapter 只接受受信任配置构造 */
const TEST_CLIENT_CONFIG = {
  host: 'https://gitlab.example.com',
  credential: {type: 'pat', value: 'glpat-test-token'},
  timeoutMS: 30_000
}

/** GLAPI-024：所有 list API 都带显式分页参数 */
const PAGINATION_ARGS = {
  perPage: PAGINATION_DEFAULTS.perPage,
  maxPages: PAGINATION_DEFAULTS.maxPages
}

/** 文件树有自己的分页契约（DEP-004），上限比通用 list 高 */
const TREE_PAGINATION_ARGS = {
  perPage: TREE_PAGINATION_DEFAULTS.perPage,
  maxPages: TREE_PAGINATION_DEFAULTS.maxPages
}

describe('GitLabPlatform', () => {
  let platform: InstanceType<typeof GitLabPlatform>

  beforeEach(() => {
    jest.clearAllMocks()
    // 重试逻辑照常执行，只是不真的等待（GLAPI-025）
    configureGitLabRetry({sleep: async () => {}})
    platform = new GitLabPlatform(TEST_CLIENT_CONFIG)
  })

  afterEach(() => {
    resetGitLabRetryPolicy()
  })

  // ─── getChangeRequest（GLAPI-001/002/006）──────────────────────────────────

  describe('getChangeRequest', () => {
    test('正常返回 MR 信息，state opened→open', async () => {
      mockMergeRequests.show.mockResolvedValue({
        iid: 10,
        title: 'Fix bug',
        description: 'some body',
        state: 'opened',
        diff_refs: {base_sha: 'aaa111', head_sha: 'bbb222', start_sha: 'ccc333'},
        target_branch: 'main',
        source_branch: 'feat/x',
        author: {username: 'alice'}
      })

      const result = await platform.getChangeRequest('group', 'repo', 10)
      expect(result).toEqual({
        number: 10,
        title: 'Fix bug',
        body: 'some body',
        state: 'open',
        baseSha: 'aaa111',
        headSha: 'bbb222',
        baseRef: 'main',
        headRef: 'feat/x',
        author: 'alice'
      })
      expect(mockMergeRequests.show).toHaveBeenCalledWith('group/repo', 10)
    })

    test('state merged 正确映射', async () => {
      mockMergeRequests.show.mockResolvedValue({
        iid: 11,
        title: 'Merged MR',
        description: '',
        state: 'merged',
        diff_refs: {base_sha: 'a', head_sha: 'b'},
        target_branch: 'main',
        source_branch: 'feat/y',
        author: {username: 'bob'}
      })

      const result = await platform.getChangeRequest('g', 'r', 11)
      expect(result.state).toBe('merged')
    })

    test('state closed 正确映射', async () => {
      mockMergeRequests.show.mockResolvedValue({
        iid: 12,
        title: 'Closed MR',
        description: null,
        state: 'closed',
        diff_refs: {base_sha: 'a', head_sha: 'b'},
        target_branch: 'main',
        source_branch: 'feat/z',
        author: {username: 'carol'}
      })

      const result = await platform.getChangeRequest('g', 'r', 12)
      expect(result.state).toBe('closed')
      expect(result.body).toBe('')
    })

    test('diff_refs 为空时抛 conflict 错误', async () => {
      mockMergeRequests.show.mockResolvedValue({
        iid: 13,
        title: 'New MR',
        description: '',
        state: 'opened',
        diff_refs: null,
        target_branch: 'main',
        source_branch: 'feat/new',
        author: {username: 'dave'}
      })

      await expect(platform.getChangeRequest('g', 'r', 13)).rejects.toThrow(GitPlatformError)
      try {
        await platform.getChangeRequest('g', 'r', 13)
      } catch (e: any) {
        expect(e.errorKind).toBe('conflict')
        expect(e.message).toMatch(/diff_refs not yet available/)
      }
    })

    test('diff_refs.head_sha 缺失时抛 conflict 错误', async () => {
      mockMergeRequests.show.mockResolvedValue({
        iid: 14,
        title: 'Partial MR',
        description: '',
        state: 'opened',
        diff_refs: {base_sha: 'aaa', head_sha: ''},
        target_branch: 'main',
        source_branch: 'feat/partial',
        author: {username: 'eve'}
      })

      await expect(platform.getChangeRequest('g', 'r', 14)).rejects.toThrow(GitPlatformError)
    })

    test('API 404 → GitPlatformError not_found', async () => {
      const err = new Error('404 Not Found')
      ;(err as any).response = {status: 404}
      mockMergeRequests.show.mockRejectedValue(err)

      await expect(platform.getChangeRequest('g', 'r', 99)).rejects.toThrow(GitPlatformError)
      try {
        await platform.getChangeRequest('g', 'r', 99)
      } catch (e: any) {
        expect(e.errorKind).toBe('not_found')
      }
    })
  })

  // ─── updateChangeRequestBody ───────────────────────────────────────────────

  describe('updateChangeRequestBody', () => {
    test('调用 MergeRequests.edit 更新 description', async () => {
      mockMergeRequests.edit.mockResolvedValue({})

      await platform.updateChangeRequestBody('g', 'r', 10, 'new body')
      expect(mockMergeRequests.edit).toHaveBeenCalledWith('g/r', 10, {description: 'new body'})
    })
  })

  // ─── listChangeRequestCommits ──────────────────────────────────────────────

  describe('listChangeRequestCommits', () => {
    test('返回 commit SHA 列表', async () => {
      mockMergeRequests.allCommits.mockResolvedValue([
        {id: 'sha1', message: 'first'},
        {id: 'sha2', message: 'second'}
      ])

      const result = await platform.listChangeRequestCommits('g', 'r', 10)
      expect(result).toEqual(['sha1', 'sha2'])
      expect(mockMergeRequests.allCommits).toHaveBeenCalledWith('g/r', 10, PAGINATION_ARGS)
    })
  })

  // ─── compareDiff（GLAPI-003/004）───────────────────────────────────────────

  describe('compareDiff', () => {
    test('正常返回 diff 文件列表和 commits', async () => {
      mockRepositories.compare.mockResolvedValue({
        diffs: [
          {
            new_path: 'src/a.ts',
            old_path: 'src/a.ts',
            new_file: false,
            deleted_file: false,
            renamed_file: false,
            diff: '@@ -1,3 +1,4 @@\n+added line'
          },
          {
            new_path: 'src/b.ts',
            old_path: 'src/b.ts',
            new_file: true,
            deleted_file: false,
            renamed_file: false,
            diff: '@@ -0,0 +1 @@\n+new file'
          }
        ],
        commits: [{id: 'c1'}, {id: 'c2'}]
      })

      const result = await platform.compareDiff('g', 'r', 'base-sha', 'head-sha')
      expect(result.files).toHaveLength(2)
      expect(result.files[0].filename).toBe('src/a.ts')
      expect(result.files[0].status).toBe('modified')
      expect(result.files[0].patch).toContain('+added line')
      expect(result.files[1].status).toBe('added')
      expect(result.commits).toEqual([{sha: 'c1'}, {sha: 'c2'}])
      expect(mockRepositories.compare).toHaveBeenCalledWith('g/r', 'base-sha', 'head-sha')
    })

    test('deleted_file 映射为 removed', async () => {
      mockRepositories.compare.mockResolvedValue({
        diffs: [{new_path: 'old.ts', old_path: 'old.ts', deleted_file: true, diff: ''}],
        commits: []
      })

      const result = await platform.compareDiff('g', 'r', 'a', 'b')
      expect(result.files[0].status).toBe('removed')
    })

    test('renamed_file 映射为 renamed，previousFilename 填充', async () => {
      mockRepositories.compare.mockResolvedValue({
        diffs: [
          {
            new_path: 'new-name.ts',
            old_path: 'old-name.ts',
            renamed_file: true,
            diff: ''
          }
        ],
        commits: []
      })

      const result = await platform.compareDiff('g', 'r', 'a', 'b')
      expect(result.files[0].status).toBe('renamed')
      expect(result.files[0].previousFilename).toBe('old-name.ts')
    })

    test('同名文件 previousFilename 为 undefined', async () => {
      mockRepositories.compare.mockResolvedValue({
        diffs: [{new_path: 'a.ts', old_path: 'a.ts', diff: 'patch'}],
        commits: []
      })

      const result = await platform.compareDiff('g', 'r', 'a', 'b')
      expect(result.files[0].previousFilename).toBeUndefined()
    })

    test('compare_timeout=true 时抛 timeout 错误', async () => {
      mockRepositories.compare.mockResolvedValue({
        compare_timeout: true,
        diffs: [],
        commits: []
      })

      await expect(platform.compareDiff('g', 'r', 'base', 'head')).rejects.toThrow(GitPlatformError)
      try {
        await platform.compareDiff('g', 'r', 'base', 'head')
      } catch (e: any) {
        expect(e.errorKind).toBe('timeout')
        expect(e.message).toMatch(/compare timed out/)
      }
    })

    test('diffs 为空时返回空文件列表', async () => {
      mockRepositories.compare.mockResolvedValue({diffs: [], commits: []})

      const result = await platform.compareDiff('g', 'r', 'a', 'b')
      expect(result.files).toEqual([])
      expect(result.commits).toEqual([])
    })
  })

  // ─── getFileContent（GLAPI-005）────────────────────────────────────────────

  describe('getFileContent', () => {
    test('正常返回 base64 解码后的文件内容', async () => {
      mockRepositoryFiles.show.mockResolvedValue({
        content: Buffer.from('hello world').toString('base64')
      })

      const result = await platform.getFileContent('g', 'r', 'src/a.ts', 'main')
      expect(result).toBe('hello world')
      expect(mockRepositoryFiles.show).toHaveBeenCalledWith('g/r', 'src/a.ts', 'main')
    })

    test('404 → 返回 null', async () => {
      const err = new Error('404')
      ;(err as any).response = {status: 404}
      mockRepositoryFiles.show.mockRejectedValue(err)

      const result = await platform.getFileContent('g', 'r', 'missing.ts', 'main')
      expect(result).toBeNull()
    })

    test('非 404 错误 → 抛 GitPlatformError', async () => {
      const err = new Error('500')
      ;(err as any).response = {status: 500}
      mockRepositoryFiles.show.mockRejectedValue(err)

      await expect(platform.getFileContent('g', 'r', 'a.ts', 'main')).rejects.toThrow(
        GitPlatformError
      )
    })
  })

  // ─── listRepositoryTree（DEP-001/004）──────────────────────────────────────

  describe('listRepositoryTree', () => {
    test('正常返回 TreeResult', async () => {
      mockRepositories.allRepositoryTrees.mockResolvedValue([
        {type: 'blob', path: 'src/a.ts'},
        {type: 'tree', path: 'src/lib'}
      ])

      const result = await platform.listRepositoryTree('g', 'r', 'main')
      expect(result).toEqual({
        entries: [
          {type: 'blob', path: 'src/a.ts'},
          {type: 'tree', path: 'src/lib'}
        ],
        truncated: false
      })
      expect(mockRepositories.allRepositoryTrees).toHaveBeenCalledWith('g/r', {
        ref: 'main',
        recursive: true,
        ...TREE_PAGINATION_ARGS
      })
    })

    test('空仓库 404 Tree Not Found → 返回空数组', async () => {
      const err = new Error('404 Tree Not Found')
      ;(err as any).response = {status: 404}
      mockRepositories.allRepositoryTrees.mockRejectedValue(err)

      const result = await platform.listRepositoryTree('g', 'r', 'main')
      expect(result).toEqual({entries: [], truncated: false})
    })

    test('非 Tree Not Found 的 404 → 抛 GitPlatformError', async () => {
      const err = new Error('404 Project Not Found')
      ;(err as any).response = {status: 404}
      mockRepositories.allRepositoryTrees.mockRejectedValue(err)

      await expect(platform.listRepositoryTree('g', 'r', 'main')).rejects.toThrow(GitPlatformError)
    })

    test('subgroup 项目 owner 含 / 时正确拼接 projectPath', async () => {
      mockRepositories.allRepositoryTrees.mockResolvedValue([])

      await platform.listRepositoryTree('group/subgroup', 'repo', 'main')
      expect(mockRepositories.allRepositoryTrees).toHaveBeenCalledWith('group/subgroup/repo', {
        ref: 'main',
        recursive: true,
        ...TREE_PAGINATION_ARGS
      })
    })

    // DEP-004：截断后按需回填只列举单个目录
    test('传 path → 非递归列举该目录', async () => {
      mockRepositories.allRepositoryTrees.mockResolvedValue([
        {type: 'blob', path: 'src/utils/hash.ts'}
      ])

      const result = await platform.listRepositoryTree('g', 'r', 'main', 'src/utils')
      expect(mockRepositories.allRepositoryTrees).toHaveBeenCalledWith('g/r', {
        ref: 'main',
        recursive: false,
        path: 'src/utils',
        ...TREE_PAGINATION_ARGS
      })
      // GitLab 的 path 本身就是根相对路径，不需要再拼前缀
      expect(result.entries).toEqual([{type: 'blob', path: 'src/utils/hash.ts'}])
      expect(result.truncated).toBe(false)
    })

    test('目录探查打到不存在的路径 → 返回空树而不是抛错', async () => {
      const err = new Error('404 Not Found')
      ;(err as any).response = {status: 404}
      mockRepositories.allRepositoryTrees.mockRejectedValue(err)

      const result = await platform.listRepositoryTree('g', 'r', 'main', 'src/nope')
      expect(result).toEqual({entries: [], truncated: false})
    })
  })

  // ─── toGitPlatformError 透传 ──────────────────────────────────────────────

  describe('toGitPlatformError 透传已有 GitPlatformError', () => {
    test('diff_refs 缺失抛出的 conflict 错误 kind 不被重包装', async () => {
      mockMergeRequests.show.mockResolvedValue({
        iid: 20,
        title: 'Test',
        description: '',
        state: 'opened',
        diff_refs: null,
        target_branch: 'main',
        source_branch: 'feat',
        author: {username: 'test'}
      })

      try {
        await platform.getChangeRequest('g', 'r', 20)
        expect('should have thrown').toBe('but did not')
      } catch (e: any) {
        expect(e).toBeInstanceOf(GitPlatformError)
        expect(e.errorKind).toBe('conflict')
      }
    })

    test('compare_timeout 抛出的 timeout 错误 kind 不被重包装', async () => {
      mockRepositories.compare.mockResolvedValue({
        compare_timeout: true,
        diffs: [],
        commits: []
      })

      try {
        await platform.compareDiff('g', 'r', 'a', 'b')
        expect('should have thrown').toBe('but did not')
      } catch (e: any) {
        expect(e).toBeInstanceOf(GitPlatformError)
        expect(e.errorKind).toBe('timeout')
      }
    })
  })

  // ─── createComment（GLAPI-007/010）─────────────────────────────────────────

  describe('createComment', () => {
    test('正常创建 MR note', async () => {
      mockMergeRequestNotes.create.mockResolvedValue({
        id: 100,
        body: 'hello',
        author: {username: 'bot'},
        created_at: '2026-08-07T00:00:00Z',
        system: false
      })

      const result = await platform.createComment('g', 'r', 5, 'hello')
      expect(result).toEqual({
        id: 100,
        body: 'hello',
        author: 'bot',
        createdAt: '2026-08-07T00:00:00Z'
      })
      expect(mockMergeRequestNotes.create).toHaveBeenCalledWith(
        'g/r',
        5,
        expect.stringContaining('hello')
      )
    })

    test('API 错误 → GitPlatformError', async () => {
      const err = new Error('403 Forbidden')
      ;(err as any).response = {status: 403}
      mockMergeRequestNotes.create.mockRejectedValue(err)

      await expect(platform.createComment('g', 'r', 5, 'body')).rejects.toThrow(GitPlatformError)
    })
  })

  // ─── updateComment（GLAPI-009/011）─────────────────────────────────────────

  describe('updateComment', () => {
    test('更新已知 note（通过 createComment 缓存 mrIid）', async () => {
      // 先 create 缓存映射
      mockMergeRequestNotes.create.mockResolvedValue({
        id: 200,
        body: 'old',
        author: {username: 'bot'},
        created_at: '2026-08-07T00:00:00Z'
      })
      await platform.createComment('g', 'r', 5, 'old')

      mockMergeRequestNotes.edit.mockResolvedValue({})
      await platform.updateComment('g', 'r', 200, 'new body')
      expect(mockMergeRequestNotes.edit).toHaveBeenCalledWith('g/r', 5, 200, {body: 'new body'})
    })

    test('更新已知 note（通过 listComments 缓存 mrIid）', async () => {
      // 先 list 缓存映射
      mockMergeRequestNotes.all.mockResolvedValue([
        {
          id: 300,
          body: 'existing',
          author: {username: 'bot'},
          created_at: '2026-08-07',
          system: false
        }
      ])
      await platform.listComments('g', 'r', 10)

      mockMergeRequestNotes.edit.mockResolvedValue({})
      await platform.updateComment('g', 'r', 300, 'updated')
      expect(mockMergeRequestNotes.edit).toHaveBeenCalledWith('g/r', 10, 300, {body: 'updated'})
    })

    test('未知 noteId → 抛 not_found 错误', async () => {
      await expect(platform.updateComment('g', 'r', 999, 'body')).rejects.toThrow(GitPlatformError)
      try {
        await platform.updateComment('g', 'r', 999, 'body')
      } catch (e: any) {
        expect(e.errorKind).toBe('not_found')
        expect(e.message).toMatch(/MR IID unknown/)
      }
    })
  })

  // ─── deleteComment（GLAPI-011）─────────────────────────────────────────────

  describe('deleteComment', () => {
    test('删除已知 note', async () => {
      // 先 create 缓存映射
      mockMergeRequestNotes.create.mockResolvedValue({
        id: 400,
        body: 'to delete',
        author: {username: 'bot'},
        created_at: '2026-08-07'
      })
      await platform.createComment('g', 'r', 5, 'to delete')

      mockMergeRequestNotes.remove.mockResolvedValue(undefined)
      await platform.deleteComment('g', 'r', 400)
      expect(mockMergeRequestNotes.remove).toHaveBeenCalledWith('g/r', 5, 400)
    })

    test('未知 noteId → 抛 not_found 错误', async () => {
      await expect(platform.deleteComment('g', 'r', 888)).rejects.toThrow(GitPlatformError)
    })

    test('删除后缓存清除，再次删除抛 not_found', async () => {
      mockMergeRequestNotes.create.mockResolvedValue({
        id: 401,
        body: 'x',
        author: {username: 'bot'},
        created_at: '2026-08-07'
      })
      await platform.createComment('g', 'r', 5, 'x')

      mockMergeRequestNotes.remove.mockResolvedValue(undefined)
      await platform.deleteComment('g', 'r', 401)

      // 删除后缓存已清除
      await expect(platform.deleteComment('g', 'r', 401)).rejects.toThrow(GitPlatformError)
    })
  })

  // ─── listComments（GLAPI-008/012）──────────────────────────────────────────

  describe('listComments', () => {
    test('正常返回用户 note，过滤 system note', async () => {
      mockMergeRequestNotes.all.mockResolvedValue([
        {
          id: 1,
          body: 'user note',
          author: {username: 'alice'},
          created_at: '2026-08-07',
          system: false
        },
        {
          id: 2,
          body: 'Merged',
          author: {username: 'system'},
          created_at: '2026-08-07',
          system: true
        },
        {
          id: 3,
          body: 'another note',
          author: {username: 'bob'},
          created_at: '2026-08-07',
          system: false
        }
      ])

      const result = await platform.listComments('g', 'r', 5)
      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        id: 1,
        body: 'user note',
        author: 'alice',
        createdAt: '2026-08-07'
      })
      expect(result[1].author).toBe('bob')
    })

    test('调用参数正确（sort + orderBy）', async () => {
      mockMergeRequestNotes.all.mockResolvedValue([])

      await platform.listComments('g', 'r', 5)
      expect(mockMergeRequestNotes.all).toHaveBeenCalledWith('g/r', 5, {
        sort: 'asc',
        orderBy: 'created_at',
        ...PAGINATION_ARGS
      })
    })

    test('空列表 → 返回空数组', async () => {
      mockMergeRequestNotes.all.mockResolvedValue([])

      const result = await platform.listComments('g', 'r', 5)
      expect(result).toEqual([])
    })

    test('全部是 system note → 返回空数组', async () => {
      mockMergeRequestNotes.all.mockResolvedValue([
        {
          id: 10,
          body: 'assigned',
          author: {username: 'sys'},
          created_at: '2026-08-07',
          system: true
        }
      ])

      const result = await platform.listComments('g', 'r', 5)
      expect(result).toEqual([])
    })

    test('API 错误 → GitPlatformError', async () => {
      const err = new Error('500')
      ;(err as any).response = {status: 500}
      mockMergeRequestNotes.all.mockRejectedValue(err)

      await expect(platform.listComments('g', 'r', 5)).rejects.toThrow(GitPlatformError)
    })
  })

  // ─── listReviewComments（GLAPI-017）────────────────────────────────────────

  describe('listReviewComments', () => {
    const diffDiscussion = {
      id: 'disc-1',
      individual_note: false,
      notes: [
        {
          id: 1001,
          type: 'DiffNote',
          body: 'review comment',
          system: false,
          author: {username: 'reviewer'},
          created_at: '2026-08-10',
          position: {new_path: 'src/a.ts', old_path: 'src/a.ts', new_line: '10', old_line: null},
          resolvable: true,
          resolved: false
        }
      ]
    }

    test('提取 DiffNote 作为 ReviewComment', async () => {
      mockMergeRequestDiscussions.all.mockResolvedValue([diffDiscussion])

      const result = await platform.listReviewComments('g', 'r', 5)
      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        id: 1001,
        body: 'review comment',
        path: 'src/a.ts',
        line: 10,
        startLine: null,
        originalLine: null,
        author: 'reviewer',
        in_reply_to_id: undefined,
        createdAt: '2026-08-10'
      })
    })

    test('跳过非 DiffNote 和 system note', async () => {
      mockMergeRequestDiscussions.all.mockResolvedValue([
        {
          id: 'disc-2',
          notes: [
            {
              id: 2001,
              type: 'DiscussionNote',
              body: 'plain',
              system: false,
              author: {username: 'a'},
              position: null
            },
            {
              id: 2002,
              type: 'DiffNote',
              body: 'system',
              system: true,
              author: {username: 'b'},
              position: {}
            }
          ]
        }
      ])

      const result = await platform.listReviewComments('g', 'r', 5)
      expect(result).toEqual([])
    })

    test('reply note 的 in_reply_to_id 指向第一条 note', async () => {
      mockMergeRequestDiscussions.all.mockResolvedValue([
        {
          id: 'disc-3',
          notes: [
            {
              id: 3001,
              type: 'DiffNote',
              body: 'first',
              system: false,
              author: {username: 'a'},
              created_at: 't1',
              position: {new_path: 'f.ts', new_line: '5'},
              resolvable: true
            },
            {
              id: 3002,
              type: 'DiffNote',
              body: 'reply',
              system: false,
              author: {username: 'b'},
              created_at: 't2',
              position: {new_path: 'f.ts', new_line: '5'},
              resolvable: true
            }
          ]
        }
      ])

      const result = await platform.listReviewComments('g', 'r', 5)
      expect(result[0].in_reply_to_id).toBeUndefined()
      expect(result[1].in_reply_to_id).toBe(3001)
    })
  })

  // ─── createReviewComment（GLAPI-013/014）───────────────────────────────────

  describe('createReviewComment', () => {
    test('创建行级 discussion，传递正确的 position', async () => {
      mockMergeRequests.show.mockResolvedValue({
        diff_refs: {base_sha: 'base', head_sha: 'head', start_sha: 'start'}
      })
      mockMergeRequestDiscussions.create.mockResolvedValue({
        id: 'new-disc',
        notes: [{id: 5001, body: 'comment', author: {username: 'bot'}}]
      })

      await platform.createReviewComment('g', 'r', 5, 'commit-sha', {
        path: 'src/a.ts',
        body: 'fix this',
        line: 42
      })

      expect(mockMergeRequestDiscussions.create).toHaveBeenCalledWith(
        'g/r',
        5,
        expect.stringContaining('fix this'),
        {
          commitId: 'commit-sha',
          position: {
            baseSha: 'base',
            headSha: 'head',
            startSha: 'start',
            positionType: 'text',
            newPath: 'src/a.ts',
            oldPath: 'src/a.ts',
            newLine: '42'
          }
        }
      )
    })
  })

  // ─── submitReviewComments（GLAPI-013/015）──────────────────────────────────

  describe('submitReviewComments', () => {
    test('逐条创建 discussion', async () => {
      mockMergeRequests.show.mockResolvedValue({
        diff_refs: {base_sha: 'b', head_sha: 'h', start_sha: 's'}
      })
      mockMergeRequestDiscussions.create.mockResolvedValue({
        id: 'disc',
        notes: [{id: 6001}]
      })

      const count = await platform.submitReviewComments('g', 'r', 5, 'sha', [
        {path: 'a.ts', body: 'c1', line: 1},
        {path: 'b.ts', body: 'c2', line: 2}
      ])
      expect(count).toBe(2)
      expect(mockMergeRequestDiscussions.create).toHaveBeenCalledTimes(2)
    })

    test('行级创建失败时降级为顶层 note（GLAPI-015）', async () => {
      mockMergeRequests.show.mockRejectedValue(new Error('diff_refs fail'))
      mockMergeRequestNotes.create.mockResolvedValue({
        id: 7001,
        body: '',
        author: {username: 'bot'}
      })

      const count = await platform.submitReviewComments('g', 'r', 5, 'sha', [
        {path: 'x.ts', body: 'comment', line: 10}
      ])
      expect(count).toBe(1)
      expect(mockMergeRequestNotes.create).toHaveBeenCalledWith(
        'g/r',
        5,
        expect.stringContaining('**x.ts** (line 10)\n\ncomment')
      )
    })
  })

  // ─── replyToReviewComment（GLAPI-016）──────────────────────────────────────

  describe('replyToReviewComment', () => {
    test('回复已知 discussion', async () => {
      // 先 list 缓存 discussion 映射
      mockMergeRequestDiscussions.all.mockResolvedValue([
        {
          id: 'disc-reply',
          notes: [
            {
              id: 8001,
              type: 'DiffNote',
              body: 'orig',
              system: false,
              author: {username: 'a'},
              created_at: 't',
              position: {new_path: 'f.ts', new_line: '1'},
              resolvable: true
            }
          ]
        }
      ])
      await platform.listReviewComments('g', 'r', 5)

      mockMergeRequestDiscussions.addNote.mockResolvedValue({
        id: 8002,
        body: 'reply text',
        author: {username: 'bot'},
        created_at: '2026-08-10'
      })

      const result = await platform.replyToReviewComment('g', 'r', 5, 8001, 'reply text')
      expect(result.body).toBe('reply text')
      expect(mockMergeRequestDiscussions.addNote).toHaveBeenCalledWith(
        'g/r',
        5,
        'disc-reply',
        expect.stringContaining('reply text')
      )
    })

    test('cache miss 时自动 fetch discussions 补缓存再回复', async () => {
      // 不先调用 listReviewComments，模拟 webhook 触发路径
      mockMergeRequestDiscussions.all.mockResolvedValue([
        {
          id: 'disc-webhook',
          notes: [
            {
              id: 8888,
              type: 'DiffNote',
              body: 'trigger',
              system: false,
              author: {username: 'user'},
              created_at: 't',
              position: {new_path: 'f.ts', new_line: '1'},
              resolvable: true
            }
          ]
        }
      ])
      mockMergeRequestDiscussions.addNote.mockResolvedValue({
        id: 8889,
        body: 'reply',
        author: {username: 'bot'},
        created_at: '2026-08-10'
      })

      const result = await platform.replyToReviewComment('g', 'r', 5, 8888, 'reply')
      expect(result.body).toBe('reply')
      // 应先 fetch all discussions 补缓存，再 addNote
      expect(mockMergeRequestDiscussions.all).toHaveBeenCalledWith('g/r', 5, PAGINATION_ARGS)
      expect(mockMergeRequestDiscussions.addNote).toHaveBeenCalledWith(
        'g/r',
        5,
        'disc-webhook',
        expect.stringContaining('reply')
      )
    })

    test('fetch 后仍找不到 noteId → 抛 not_found', async () => {
      mockMergeRequestDiscussions.all.mockResolvedValue([])
      await expect(platform.replyToReviewComment('g', 'r', 5, 9999, 'body')).rejects.toThrow(
        GitPlatformError
      )
    })

    test('cache miss 补缓存时 API 失败 → 统一转 GitPlatformError', async () => {
      mockMergeRequestDiscussions.all.mockRejectedValue(
        Object.assign(new Error('Network Error'), {response: {status: 500}})
      )
      try {
        await platform.replyToReviewComment('g', 'r', 5, 7777, 'body')
        expect('should have thrown').toBe('but did not')
      } catch (e) {
        expect(e).toBeInstanceOf(GitPlatformError)
        expect((e as GitPlatformError).errorKind).toBe('server_error')
      }
    })
  })

  // ─── updateReviewComment / deleteReviewComment ─────────────────────────────

  describe('updateReviewComment', () => {
    test('更新已知 discussion note', async () => {
      mockMergeRequestDiscussions.all.mockResolvedValue([
        {
          id: 'disc-upd',
          notes: [
            {
              id: 9001,
              type: 'DiffNote',
              body: 'old',
              system: false,
              author: {username: 'a'},
              created_at: 't',
              position: {new_path: 'f.ts', new_line: '1'},
              resolvable: true
            }
          ]
        }
      ])
      await platform.listReviewComments('g', 'r', 5)

      mockMergeRequestDiscussions.editNote.mockResolvedValue({})
      await platform.updateReviewComment('g', 'r', 9001, 'new body')
      expect(mockMergeRequestDiscussions.editNote).toHaveBeenCalledWith(
        'g/r',
        5,
        'disc-upd',
        9001,
        {body: 'new body'}
      )
    })
  })

  describe('deleteReviewComment', () => {
    test('删除已知 discussion note + 清除缓存', async () => {
      mockMergeRequestDiscussions.all.mockResolvedValue([
        {
          id: 'disc-del',
          notes: [
            {
              id: 9101,
              type: 'DiffNote',
              body: 'x',
              system: false,
              author: {username: 'a'},
              created_at: 't',
              position: {new_path: 'f.ts', new_line: '1'},
              resolvable: true
            }
          ]
        }
      ])
      await platform.listReviewComments('g', 'r', 5)

      mockMergeRequestDiscussions.removeNote.mockResolvedValue(undefined)
      await platform.deleteReviewComment('g', 'r', 9101)
      expect(mockMergeRequestDiscussions.removeNote).toHaveBeenCalledWith(
        'g/r',
        5,
        'disc-del',
        9101
      )

      // 缓存已清除
      await expect(platform.deleteReviewComment('g', 'r', 9101)).rejects.toThrow(GitPlatformError)
    })
  })

  // ─── fetchThreadStatusMap（GLAPI-017）──────────────────────────────────────

  describe('fetchThreadStatusMap', () => {
    test('DiffNote discussion 映射为 path:line → resolved', async () => {
      mockMergeRequestDiscussions.all.mockResolvedValue([
        {
          id: 'disc-a',
          notes: [
            {
              id: 1,
              type: 'DiffNote',
              system: false,
              author: {username: 'a'},
              position: {new_path: 'a.ts', new_line: '10'},
              resolvable: true,
              resolved: true
            }
          ]
        },
        {
          id: 'disc-b',
          notes: [
            {
              id: 2,
              type: 'DiffNote',
              system: false,
              author: {username: 'b'},
              position: {new_path: 'b.ts', new_line: '20'},
              resolvable: true,
              resolved: false
            }
          ]
        }
      ])

      const map = await platform.fetchThreadStatusMap('g', 'r', 5)
      expect(map.get('a.ts:10')).toBe(true)
      expect(map.get('b.ts:20')).toBe(false)
    })

    test('同位置有未 resolved 的优先标记为 false', async () => {
      mockMergeRequestDiscussions.all.mockResolvedValue([
        {
          id: 'd1',
          notes: [
            {
              id: 1,
              type: 'DiffNote',
              system: false,
              author: {username: 'a'},
              position: {new_path: 'x.ts', new_line: '5'},
              resolvable: true,
              resolved: true
            }
          ]
        },
        {
          id: 'd2',
          notes: [
            {
              id: 2,
              type: 'DiffNote',
              system: false,
              author: {username: 'b'},
              position: {new_path: 'x.ts', new_line: '5'},
              resolvable: true,
              resolved: false
            }
          ]
        }
      ])

      const map = await platform.fetchThreadStatusMap('g', 'r', 5)
      expect(map.get('x.ts:5')).toBe(false)
    })
  })

  // ─── fetchUnresolvedBotThreads（GLAPI-017）─────────────────────────────────

  describe('fetchUnresolvedBotThreads', () => {
    test('只返回 bot 发起的未 resolved discussion', async () => {
      mockMergeRequestDiscussions.all.mockResolvedValue([
        {
          id: 'disc-bot',
          notes: [
            {
              id: 1,
              type: 'DiffNote',
              system: false,
              author: {username: 'code-bot'},
              body: 'fix this',
              position: {new_path: 'a.ts', new_line: '10'},
              resolvable: true,
              resolved: false
            }
          ]
        },
        {
          id: 'disc-human',
          notes: [
            {
              id: 2,
              type: 'DiffNote',
              system: false,
              author: {username: 'alice'},
              body: 'nit',
              position: {new_path: 'b.ts', new_line: '20'},
              resolvable: true,
              resolved: false
            }
          ]
        },
        {
          id: 'disc-resolved',
          notes: [
            {
              id: 3,
              type: 'DiffNote',
              system: false,
              author: {username: 'code-bot'},
              body: 'done',
              position: {new_path: 'c.ts', new_line: '30'},
              resolvable: true,
              resolved: true
            }
          ]
        }
      ])

      const result = await platform.fetchUnresolvedBotThreads('g', 'r', 5, 'code-bot')
      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        id: 'disc-bot',
        isResolved: false,
        path: 'a.ts',
        line: 10,
        firstCommentAuthorLogin: 'code-bot',
        firstCommentBody: 'fix this'
      })
    })

    test('botLogin 大小写不敏感', async () => {
      mockMergeRequestDiscussions.all.mockResolvedValue([
        {
          id: 'disc',
          notes: [
            {
              id: 1,
              type: 'DiffNote',
              system: false,
              author: {username: 'Code-Bot'},
              body: 'x',
              position: {new_path: 'a.ts', new_line: '1'},
              resolvable: true,
              resolved: false
            }
          ]
        }
      ])

      const result = await platform.fetchUnresolvedBotThreads('g', 'r', 5, 'code-bot')
      expect(result).toHaveLength(1)
    })
  })

  // ─── resolveThreads（GLAPI-018/019）────────────────────────────────────────

  describe('resolveThreads', () => {
    test('批量 resolve discussion', async () => {
      // 先 fetchUnresolvedBotThreads 填充缓存
      mockMergeRequestDiscussions.all.mockResolvedValue([
        {
          id: 'disc-r1',
          notes: [
            {
              id: 1,
              type: 'DiffNote',
              system: false,
              author: {username: 'bot'},
              body: 'x',
              position: {new_path: 'a.ts', new_line: '1'},
              resolvable: true,
              resolved: false
            }
          ]
        }
      ])
      await platform.fetchUnresolvedBotThreads('g', 'r', 5, 'bot')

      mockMergeRequestDiscussions.resolve.mockResolvedValue({})
      const result = await platform.resolveThreads(['disc-r1'])
      expect(result).toEqual({ok: 1, failed: 0, errors: []})
      expect(mockMergeRequestDiscussions.resolve).toHaveBeenCalledWith('g/r', 5, 'disc-r1', true)
    })

    test('未缓存的 discussionId 标记失败', async () => {
      mockMergeRequestDiscussions.all.mockResolvedValue([
        {
          id: 'disc-ok',
          notes: [
            {
              id: 1,
              type: 'DiffNote',
              system: false,
              author: {username: 'bot'},
              body: 'x',
              position: {new_path: 'a.ts', new_line: '1'},
              resolvable: true,
              resolved: false
            }
          ]
        }
      ])
      await platform.fetchUnresolvedBotThreads('g', 'r', 5, 'bot')

      mockMergeRequestDiscussions.resolve.mockResolvedValue({})

      const result = await platform.resolveThreads(['disc-ok', 'disc-missing'])
      expect(result.ok).toBe(1)
      expect(result.failed).toBe(1)
      expect(result.errors[0].message).toMatch(/No cached context/)
    })

    test('API 调用失败计入 errors', async () => {
      mockMergeRequestDiscussions.all.mockResolvedValue([
        {
          id: 'disc-fail',
          notes: [
            {
              id: 1,
              type: 'DiffNote',
              system: false,
              author: {username: 'bot'},
              body: 'x',
              position: {new_path: 'a.ts', new_line: '1'},
              resolvable: true,
              resolved: false
            }
          ]
        }
      ])
      await platform.fetchUnresolvedBotThreads('g', 'r', 5, 'bot')

      mockMergeRequestDiscussions.resolve.mockRejectedValue(new Error('403'))

      const result = await platform.resolveThreads(['disc-fail'])
      expect(result.ok).toBe(0)
      expect(result.failed).toBe(1)
    })

    test('无缓存时全部标记失败', async () => {
      // 新建 platform 实例，无缓存
      const freshPlatform = new GitLabPlatform(TEST_CLIENT_CONFIG)
      const result = await freshPlatform.resolveThreads(['disc-x'])
      expect(result.ok).toBe(0)
      expect(result.failed).toBe(1)
    })
  })

  // ─── addReaction（GLAPI-023）─────────────────────────────────────────────

  describe('addReaction', () => {
    test('正常添加 emoji reaction（+1 → thumbsup），无需预热缓存', async () => {
      mockMergeRequestNoteAwardEmojis.award.mockResolvedValue({id: 1, name: 'thumbsup'})
      await platform.addReaction('g', 'r', 5, 100, '+1', 'issue_comment')
      expect(mockMergeRequestNoteAwardEmojis.award).toHaveBeenCalledWith('g/r', 5, 100, 'thumbsup')
    })

    test('eyes → eyes 映射', async () => {
      mockMergeRequestNoteAwardEmojis.award.mockResolvedValue({id: 2, name: 'eyes'})
      await platform.addReaction('g', 'r', 5, 101, 'eyes', 'review_comment')
      expect(mockMergeRequestNoteAwardEmojis.award).toHaveBeenCalledWith('g/r', 5, 101, 'eyes')
    })

    test('hooray → tada 映射', async () => {
      mockMergeRequestNoteAwardEmojis.award.mockResolvedValue({id: 3, name: 'tada'})
      await platform.addReaction('g', 'r', 5, 102, 'hooray', 'issue_comment')
      expect(mockMergeRequestNoteAwardEmojis.award).toHaveBeenCalledWith('g/r', 5, 102, 'tada')
    })

    test('laugh → laughing 映射', async () => {
      mockMergeRequestNoteAwardEmojis.award.mockResolvedValue({id: 4, name: 'laughing'})
      await platform.addReaction('g', 'r', 5, 103, 'laugh', 'issue_comment')
      expect(mockMergeRequestNoteAwardEmojis.award).toHaveBeenCalledWith('g/r', 5, 103, 'laughing')
    })

    test('-1 → thumbsdown 映射', async () => {
      mockMergeRequestNoteAwardEmojis.award.mockResolvedValue({id: 5, name: 'thumbsdown'})
      await platform.addReaction('g', 'r', 5, 104, '-1', 'issue_comment')
      expect(mockMergeRequestNoteAwardEmojis.award).toHaveBeenCalledWith(
        'g/r',
        5,
        104,
        'thumbsdown'
      )
    })

    test('API 失败 → GitPlatformError', async () => {
      mockMergeRequestNoteAwardEmojis.award.mockRejectedValue(
        Object.assign(new Error('422'), {response: {status: 422}})
      )
      await expect(platform.addReaction('g', 'r', 5, 103, '+1', 'issue_comment')).rejects.toThrow(
        GitPlatformError
      )
    })
  })

  // ─── getCollaboratorPermission（GLAPI-020/021）────────────────────────────

  describe('getCollaboratorPermission', () => {
    test('OWNER (50) → admin', async () => {
      mockUsers.all.mockResolvedValue([{id: 42, username: 'alice'}])
      mockProjectMembers.all.mockResolvedValue([{id: 42, access_level: 50}])
      const perm = await platform.getCollaboratorPermission('g', 'r', 'alice')
      expect(perm).toBe('admin')
      expect(mockProjectMembers.all).toHaveBeenCalledWith(
        'g/r',
        expect.objectContaining({includeInherited: true, userIds: [42]})
      )
    })

    test('MAINTAINER (40) → maintain', async () => {
      mockUsers.all.mockResolvedValue([{id: 43, username: 'bob'}])
      mockProjectMembers.all.mockResolvedValue([{id: 43, access_level: 40}])
      expect(await platform.getCollaboratorPermission('g', 'r', 'bob')).toBe('maintain')
    })

    test('DEVELOPER (30) → write', async () => {
      mockUsers.all.mockResolvedValue([{id: 44, username: 'carol'}])
      mockProjectMembers.all.mockResolvedValue([{id: 44, access_level: 30}])
      expect(await platform.getCollaboratorPermission('g', 'r', 'carol')).toBe('write')
    })

    test('REPORTER (20) → triage', async () => {
      mockUsers.all.mockResolvedValue([{id: 45, username: 'dave'}])
      mockProjectMembers.all.mockResolvedValue([{id: 45, access_level: 20}])
      expect(await platform.getCollaboratorPermission('g', 'r', 'dave')).toBe('triage')
    })

    test('GUEST (10) → read', async () => {
      mockUsers.all.mockResolvedValue([{id: 46, username: 'eve'}])
      mockProjectMembers.all.mockResolvedValue([{id: 46, access_level: 10}])
      expect(await platform.getCollaboratorPermission('g', 'r', 'eve')).toBe('read')
    })

    test('NO_ACCESS (0) → none', async () => {
      mockUsers.all.mockResolvedValue([{id: 47, username: 'frank'}])
      mockProjectMembers.all.mockResolvedValue([{id: 47, access_level: 0}])
      expect(await platform.getCollaboratorPermission('g', 'r', 'frank')).toBe('none')
    })

    // 这两级过去落在 `>=` 阶梯的缝里，映射从未被显式确定过
    test('MINIMAL_ACCESS (5) → none（够不到 Guest，连读都不假设）', async () => {
      mockUsers.all.mockResolvedValue([{id: 60, username: 'minimal'}])
      mockProjectMembers.all.mockResolvedValue([{id: 60, access_level: 5}])
      expect(await platform.getCollaboratorPermission('g', 'r', 'minimal')).toBe('none')
    })

    test('PLANNER (15) → read（在 Reporter 之下，够不到 triage 门槛）', async () => {
      mockUsers.all.mockResolvedValue([{id: 61, username: 'planner'}])
      mockProjectMembers.all.mockResolvedValue([{id: 61, access_level: 15}])
      expect(await platform.getCollaboratorPermission('g', 'r', 'planner')).toBe('read')
    })

    // 未知等级过去会被 `>= 50` 的阶梯提升成 admin —— 响应越异常权限越高
    test.each([[60], [51], [999], [-1], [7]])(
      '未知 access_level %s → 抛错，绝不提升为 admin',
      async level => {
        mockUsers.all.mockResolvedValue([{id: 62, username: 'weird'}])
        mockProjectMembers.all.mockResolvedValue([{id: 62, access_level: level}])
        await expect(platform.getCollaboratorPermission('g', 'r', 'weird')).rejects.toThrow(
          GitPlatformError
        )
      }
    )

    test('未知等级的报错信息列出已知等级，便于排查', async () => {
      mockUsers.all.mockResolvedValue([{id: 62, username: 'weird'}])
      mockProjectMembers.all.mockResolvedValue([{id: 62, access_level: 60}])
      await expect(platform.getCollaboratorPermission('g', 'r', 'weird')).rejects.toThrow(
        /unknown access_level: 60/
      )
    })

    test('用户名不存在 → none', async () => {
      mockUsers.all.mockResolvedValue([])
      expect(await platform.getCollaboratorPermission('g', 'r', 'ghost')).toBe('none')
    })

    test('用户名大小写不敏感', async () => {
      mockUsers.all.mockResolvedValue([{id: 48, username: 'Alice'}])
      mockProjectMembers.all.mockResolvedValue([{id: 48, access_level: 30}])
      expect(await platform.getCollaboratorPermission('g', 'r', 'alice')).toBe('write')
    })

    test('Users.all 返回多个用户时精确匹配', async () => {
      mockUsers.all.mockResolvedValue([
        {id: 50, username: 'alice-dev'},
        {id: 51, username: 'alice'}
      ])
      mockProjectMembers.all.mockResolvedValue([{id: 51, access_level: 40}])
      await platform.getCollaboratorPermission('g', 'r', 'alice')
      expect(mockProjectMembers.all).toHaveBeenCalledWith(
        'g/r',
        expect.objectContaining({userIds: [51]})
      )
    })

    // CMD-016：'none'（确认无权限）与抛错（查询失败）必须分开——
    // 折叠成 'none' 会让 dispatcher 仍然承认 PR 作者豁免，等于 fail open
    test('成员列表为空（不是项目成员）→ 明确的 none，不抛错', async () => {
      mockUsers.all.mockResolvedValue([{id: 42, username: 'alice'}])
      mockProjectMembers.all.mockResolvedValue([])
      // 外部贡献者走的就是这条路，必须能拿到确定答案，否则自己 MR 上的作者豁免会被误杀
      expect(await platform.getCollaboratorPermission('g', 'r', 'alice')).toBe('none')
    })

    test('成员列表非空但没有该用户 id → none（服务端忽略 userIds 过滤时也不误取他人等级）', async () => {
      mockUsers.all.mockResolvedValue([{id: 42, username: 'alice'}])
      mockProjectMembers.all.mockResolvedValue([{id: 99, access_level: 50}])
      expect(await platform.getCollaboratorPermission('g', 'r', 'alice')).toBe('none')
    })

    // 成员接口的 404 语义含混：不是成员、项目不存在、项目不可见、隐藏的授权失败
    // 都是 404。当成「确定不是成员」会在凭据失效/可见性变化时放开作者豁免。
    test('成员接口 404 → 抛错而不是当成「确定不是成员」', async () => {
      mockUsers.all.mockResolvedValue([{id: 42, username: 'alice'}])
      mockProjectMembers.all.mockRejectedValue(
        Object.assign(new Error('404 Project Not Found'), {response: {status: 404}})
      )
      await expect(platform.getCollaboratorPermission('g', 'r', 'alice')).rejects.toThrow(
        GitPlatformError
      )
    })

    // access_level 异常不是「等级 0」，是「响应不可信」
    test.each([
      ['缺字段', {}],
      ['null', {access_level: null}],
      ['字符串', {access_level: '30'}],
      ['NaN', {access_level: Number.NaN}],
      ['小数', {access_level: 30.5}]
    ])('access_level 格式非法（%s）→ 抛错而不是折叠成 none', async (_label, member) => {
      mockUsers.all.mockResolvedValue([{id: 42, username: 'alice'}])
      mockProjectMembers.all.mockResolvedValue([{id: 42, ...(member as object)}])
      await expect(platform.getCollaboratorPermission('g', 'r', 'alice')).rejects.toThrow(
        GitPlatformError
      )
    })

    test('access_level 0 是合法值（NO_ACCESS），不能一并拒掉', async () => {
      mockUsers.all.mockResolvedValue([{id: 42, username: 'alice'}])
      mockProjectMembers.all.mockResolvedValue([{id: 42, access_level: 0}])
      expect(await platform.getCollaboratorPermission('g', 'r', 'alice')).toBe('none')
    })

    test('成员响应不是数组 → 抛错', async () => {
      mockUsers.all.mockResolvedValue([{id: 42, username: 'alice'}])
      mockProjectMembers.all.mockResolvedValue({access_level: 30} as any)
      await expect(platform.getCollaboratorPermission('g', 'r', 'alice')).rejects.toThrow(
        GitPlatformError
      )
    })

    test('用户条目缺 username → 不参与匹配（不会 TypeError 逃逸）', async () => {
      mockUsers.all.mockResolvedValue([{id: 1}, {id: 42, username: 'alice'}])
      mockProjectMembers.all.mockResolvedValue([{id: 42, access_level: 30}])
      expect(await platform.getCollaboratorPermission('g', 'r', 'alice')).toBe('write')
    })

    test('用户 id 非整数 → 抛错（不拿脏 id 去查成员）', async () => {
      mockUsers.all.mockResolvedValue([{id: 'x42', username: 'alice'}])
      await expect(platform.getCollaboratorPermission('g', 'r', 'alice')).rejects.toThrow(
        GitPlatformError
      )
      expect(mockProjectMembers.all).not.toHaveBeenCalled()
    })

    test.each([
      ['401 Unauthorized', 401],
      ['403 Forbidden', 403],
      ['500 Internal Server Error', 500]
    ])('Users.all %s → 抛 GitPlatformError（不确定，不是「无权限」）', async (msg, status) => {
      mockUsers.all.mockRejectedValue(Object.assign(new Error(msg), {response: {status}}))
      await expect(platform.getCollaboratorPermission('g', 'r', 'alice')).rejects.toThrow(
        GitPlatformError
      )
    })

    test('Users.all 网络错误 → 抛 GitPlatformError', async () => {
      mockUsers.all.mockRejectedValue(new Error('Network Error'))
      await expect(platform.getCollaboratorPermission('g', 'r', 'alice')).rejects.toThrow(
        GitPlatformError
      )
    })

    test.each([
      ['401 Unauthorized', 401],
      ['403 Forbidden', 403],
      ['500 Internal Server Error', 500]
    ])('成员列表查询 %s → 抛 GitPlatformError（不确定，不是「无权限」）', async (msg, status) => {
      mockUsers.all.mockResolvedValue([{id: 42, username: 'alice'}])
      mockProjectMembers.all.mockRejectedValue(Object.assign(new Error(msg), {response: {status}}))
      await expect(platform.getCollaboratorPermission('g', 'r', 'alice')).rejects.toThrow(
        GitPlatformError
      )
    })

    test('抛错前打诊断日志（fail closed 不能变成无法排查的静默拒绝，GLAPI-026）', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
      mockUsers.all.mockRejectedValue(
        Object.assign(new Error('401 Unauthorized'), {response: {status: 401}})
      )

      await expect(platform.getCollaboratorPermission('g', 'r', 'alice')).rejects.toThrow()
      const warned = warnSpy.mock.calls.map(c => String(c[0])).join('\n')
      warnSpy.mockRestore()

      expect(warned).toContain('Permission lookup failed')
      expect(warned).toContain('indeterminate')
    })

    test('与 GitHub adapter 语义一致：两边都对不确定失败抛错', async () => {
      // 语义漂移会让同一份 dispatcher 代码在两个平台上得到相反的安全结论
      mockUsers.all.mockRejectedValue(Object.assign(new Error('403'), {response: {status: 403}}))
      await expect(platform.getCollaboratorPermission('g', 'r', 'alice')).rejects.toThrow(
        GitPlatformError
      )
    })
  })

  // ─── getAuthenticatedLogin（GLAPI-022）────────────────────────────────────

  describe('getAuthenticatedLogin', () => {
    test('正常返回 PAT 对应的 username', async () => {
      mockUsers.showCurrentUser.mockResolvedValue({username: 'review-bot'})
      expect(await platform.getAuthenticatedLogin()).toBe('review-bot')
    })

    test('API 失败 → 返回默认 gitlab-bot', async () => {
      mockUsers.showCurrentUser.mockRejectedValue(new Error('401'))
      expect(await platform.getAuthenticatedLogin()).toBe(FALLBACK_BOT_LOGIN)
    })

    test('API 失败时的 warning 必须说清后果和补救手段（不能只说「失败了」）', async () => {
      mockUsers.showCurrentUser.mockRejectedValue(new Error('401'))
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

      await platform.getAuthenticatedLogin()

      const joined = warnSpy.mock.calls.map(c => String(c[0])).join('\n')
      warnSpy.mockRestore()
      expect(joined).toContain('will not be recognized')
      expect(joined).toContain('AI_REVIEWER_BOT_GITLAB_LOGIN')
    })

    test('成功结果被缓存，重复调用不再打 API', async () => {
      mockUsers.showCurrentUser.mockResolvedValue({username: 'review-bot'})

      await platform.getAuthenticatedLogin()
      await platform.getAuthenticatedLogin()

      expect(mockUsers.showCurrentUser).toHaveBeenCalledTimes(1)
    })
  })

  // ─── verifyCredential（GLAPI-022/029）────────────────────────────────────

  describe('verifyCredential', () => {
    test('成功返回真实用户名', async () => {
      mockUsers.showCurrentUser.mockResolvedValue({username: 'review-bot'})
      expect(await platform.verifyCredential()).toBe('review-bot')
    })

    test('失败时抛错而不是伪装成功（与 getAuthenticatedLogin 的区别）', async () => {
      mockUsers.showCurrentUser.mockRejectedValue(new Error('401 Unauthorized'))
      await expect(platform.verifyCredential()).rejects.toThrow(GitPlatformError)
    })

    test('自检结果被 getAuthenticatedLogin 复用，不重复打 API', async () => {
      mockUsers.showCurrentUser.mockResolvedValue({username: 'review-bot'})

      await platform.verifyCredential()
      expect(await platform.getAuthenticatedLogin()).toBe('review-bot')
      expect(mockUsers.showCurrentUser).toHaveBeenCalledTimes(1)
    })
  })
})
