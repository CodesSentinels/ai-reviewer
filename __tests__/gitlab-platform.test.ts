/**
 * gitlab-platform.test.ts — GitLabPlatform adapter 单元测试
 *
 * GLAPI-001~012 + DEP-001/004
 *
 * 测试策略：mock @gitbeaker/rest 的 Gitlab 构造函数，验证 GitLabPlatform
 * 方法正确调用 gitbeaker API 并将结果/错误转换为平台无关类型。
 */
import {describe, expect, test, jest, beforeEach} from '@jest/globals'
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

jest.mock('@gitbeaker/rest', () => ({
  Gitlab: jest.fn().mockImplementation(() => ({
    MergeRequests: mockMergeRequests,
    Repositories: mockRepositories,
    RepositoryFiles: mockRepositoryFiles,
    MergeRequestNotes: mockMergeRequestNotes
  }))
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {GitLabPlatform} = require('../src/platform/gitlab-platform')

describe('GitLabPlatform', () => {
  let platform: InstanceType<typeof GitLabPlatform>

  beforeEach(() => {
    jest.clearAllMocks()
    platform = new GitLabPlatform({type: 'pat', value: 'test-token'})
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
      expect(mockMergeRequests.allCommits).toHaveBeenCalledWith('g/r', 10)
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

      await expect(platform.compareDiff('g', 'r', 'base', 'head')).rejects.toThrow(
        GitPlatformError
      )
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
        recursive: true
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

      await expect(platform.listRepositoryTree('g', 'r', 'main')).rejects.toThrow(
        GitPlatformError
      )
    })

    test('subgroup 项目 owner 含 / 时正确拼接 projectPath', async () => {
      mockRepositories.allRepositoryTrees.mockResolvedValue([])

      await platform.listRepositoryTree('group/subgroup', 'repo', 'main')
      expect(mockRepositories.allRepositoryTrees).toHaveBeenCalledWith('group/subgroup/repo', {
        ref: 'main',
        recursive: true
      })
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
      expect(mockMergeRequestNotes.create).toHaveBeenCalledWith('g/r', 5, 'hello')
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
        {id: 300, body: 'existing', author: {username: 'bot'}, created_at: '2026-08-07', system: false}
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
        {id: 1, body: 'user note', author: {username: 'alice'}, created_at: '2026-08-07', system: false},
        {id: 2, body: 'Merged', author: {username: 'system'}, created_at: '2026-08-07', system: true},
        {id: 3, body: 'another note', author: {username: 'bob'}, created_at: '2026-08-07', system: false}
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
        orderBy: 'created_at'
      })
    })

    test('空列表 → 返回空数组', async () => {
      mockMergeRequestNotes.all.mockResolvedValue([])

      const result = await platform.listComments('g', 'r', 5)
      expect(result).toEqual([])
    })

    test('全部是 system note → 返回空数组', async () => {
      mockMergeRequestNotes.all.mockResolvedValue([
        {id: 10, body: 'assigned', author: {username: 'sys'}, created_at: '2026-08-07', system: true}
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
})
