/**
 * git-platform.test.ts — IGitPlatform 接口与 GitHubPlatform adapter 测试
 *
 * ARCH-016/017/018/019/021/022 + DEP-001/003
 *
 * 测试策略：mock octokit 单例，验证 GitHubPlatform 方法正确调用 Octokit API
 * 并将结果/错误转换为平台无关类型。
 */
import {describe, expect, test, jest, beforeEach} from '@jest/globals'
import {
  GitPlatformError,
  type IGitPlatform,
  type ChangeRequestInfo,
  type PlatformComment,
  type ReviewComment,
  type ReviewThreadInfo
} from '../src/platform/git-platform'

// mock octokit
const mockOctokit = {
  pulls: {
    get: jest.fn<any>(),
    update: jest.fn<any>(),
    listCommits: jest.fn<any>(),
    listReviews: jest.fn<any>(),
    deletePendingReview: jest.fn<any>(),
    createReview: jest.fn<any>(),
    submitReview: jest.fn<any>(),
    createReviewComment: jest.fn<any>(),
    createReplyForReviewComment: jest.fn<any>(),
    updateReviewComment: jest.fn<any>(),
    deleteReviewComment: jest.fn<any>(),
    listReviewComments: jest.fn<any>()
  },
  issues: {
    createComment: jest.fn<any>(),
    updateComment: jest.fn<any>(),
    deleteComment: jest.fn<any>(),
    listComments: jest.fn<any>()
  },
  repos: {
    compareCommits: jest.fn<any>(),
    getContent: jest.fn<any>(),
    getCollaboratorPermissionLevel: jest.fn<any>()
  },
  reactions: {
    createForIssueComment: jest.fn<any>(),
    createForPullRequestReviewComment: jest.fn<any>()
  },
  users: {
    getAuthenticated: jest.fn<any>()
  },
  git: {
    getTree: jest.fn<any>()
  },
  graphql: jest.fn<any>()
}

jest.mock('../src/octokit', () => ({octokit: mockOctokit}))
jest.mock('../src/platform/logger', () => ({
  getLogger: () => ({
    info: jest.fn(),
    warning: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {GitHubPlatform} = require('../src/platform/github-platform')

describe('GitHubPlatform', () => {
  let platform: IGitPlatform

  beforeEach(() => {
    jest.clearAllMocks()
    platform = new GitHubPlatform()
  })

  // ─── 1. PR 信息 ─────────────────────────────────────────────────────────

  describe('getChangeRequest', () => {
    test('正常返回 PR 信息', async () => {
      mockOctokit.pulls.get.mockResolvedValue({
        data: {
          number: 42,
          title: 'Fix bug',
          body: 'some body',
          state: 'open',
          merged: false,
          base: {sha: 'base123', ref: 'main'},
          head: {sha: 'head456', ref: 'feature'},
          user: {login: 'alice'}
        }
      })

      const result: ChangeRequestInfo = await platform.getChangeRequest(
        'owner',
        'repo',
        42
      )
      expect(result.number).toBe(42)
      expect(result.title).toBe('Fix bug')
      expect(result.baseSha).toBe('base123')
      expect(result.headSha).toBe('head456')
      expect(result.author).toBe('alice')
    })

    test('merged PR 返回 merged 状态', async () => {
      mockOctokit.pulls.get.mockResolvedValue({
        data: {
          number: 1,
          title: '',
          body: null,
          state: 'closed',
          merged: true,
          base: {sha: 'b', ref: 'main'},
          head: {sha: 'h', ref: 'f'},
          user: null
        }
      })

      const result = await platform.getChangeRequest('o', 'r', 1)
      expect(result.state).toBe('merged')
      expect(result.body).toBe('')
      expect(result.author).toBe('')
    })

    test('API 404 → GitPlatformError not_found', async () => {
      const err: any = new Error('Not Found')
      err.status = 404
      mockOctokit.pulls.get.mockRejectedValue(err)

      await expect(platform.getChangeRequest('o', 'r', 1)).rejects.toThrow(
        GitPlatformError
      )
      try {
        await platform.getChangeRequest('o', 'r', 1)
      } catch (e: any) {
        expect(e.errorKind).toBe('not_found')
        expect(e.statusCode).toBe(404)
      }
    })
  })

  describe('updateChangeRequestBody', () => {
    test('正常调用 pulls.update', async () => {
      mockOctokit.pulls.update.mockResolvedValue({})
      await platform.updateChangeRequestBody('o', 'r', 1, 'new body')
      expect(mockOctokit.pulls.update).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: 'o',
          repo: 'r',
          pull_number: 1,
          body: 'new body'
        })
      )
    })
  })

  describe('listChangeRequestCommits', () => {
    test('分页获取全部 commit SHA', async () => {
      mockOctokit.pulls.listCommits
        .mockResolvedValueOnce({data: [{sha: 'a'}, {sha: 'b'}]})
        .mockResolvedValueOnce({data: []})

      const result = await platform.listChangeRequestCommits('o', 'r', 1)
      expect(result).toEqual(['a', 'b'])
    })
  })

  // ─── 2. Diff ────────────────────────────────────────────────────────────

  describe('compareDiff', () => {
    test('返回归一化的 DiffResult', async () => {
      mockOctokit.repos.compareCommits.mockResolvedValue({
        data: {
          files: [
            {filename: 'a.ts', status: 'added', patch: '+line'},
            {filename: 'b.ts', status: 'modified', patch: '-old\n+new'},
            {filename: 'c.ts', status: 'removed'},
            {filename: 'd.ts', status: 'renamed', previous_filename: 'old.ts'}
          ],
          commits: [{sha: 'c1'}, {sha: 'c2'}]
        }
      })

      const result = await platform.compareDiff('o', 'r', 'base', 'head')
      expect(result.files).toHaveLength(4)
      expect(result.files[0].status).toBe('added')
      expect(result.files[1].status).toBe('modified')
      expect(result.files[2].status).toBe('removed')
      expect(result.files[3].previousFilename).toBe('old.ts')
      expect(result.commits).toEqual([{sha: 'c1'}, {sha: 'c2'}])
    })
  })

  // ─── 3. 文件内容 ──────────────────────────────────────────────────────

  describe('getFileContent', () => {
    test('base64 解码返回字符串', async () => {
      mockOctokit.repos.getContent.mockResolvedValue({
        data: {
          content: Buffer.from('hello world').toString('base64'),
          encoding: 'base64'
        }
      })

      const result = await platform.getFileContent('o', 'r', 'f.ts', 'sha')
      expect(result).toBe('hello world')
    })

    test('API 失败返回 null', async () => {
      mockOctokit.repos.getContent.mockRejectedValue(new Error('404'))
      const result = await platform.getFileContent('o', 'r', 'f.ts', 'sha')
      expect(result).toBeNull()
    })
  })

  // ─── 4. 顶层评论 ────────────────────────────────────────────────────

  describe('createComment', () => {
    test('返回 PlatformComment', async () => {
      mockOctokit.issues.createComment.mockResolvedValue({
        data: {
          id: 100,
          body: 'hello',
          user: {login: 'bot'},
          node_id: 'MDk',
          created_at: '2026-01-01T00:00:00Z'
        }
      })

      const result: PlatformComment = await platform.createComment(
        'o',
        'r',
        1,
        'hello'
      )
      expect(result.id).toBe(100)
      expect(result.author).toBe('bot')
    })
  })

  describe('listComments', () => {
    test('分页获取全部评论', async () => {
      mockOctokit.issues.listComments.mockResolvedValueOnce({
        data: [
          {
            id: 1,
            body: 'a',
            user: {login: 'u'},
            node_id: 'n1',
            created_at: 't1'
          }
        ]
      })

      const result = await platform.listComments('o', 'r', 1)
      expect(result).toHaveLength(1)
      expect(result[0].body).toBe('a')
    })
  })

  // ─── 5. 行级评论 ────────────────────────────────────────────────────

  describe('listReviewComments', () => {
    test('返回归一化的 ReviewComment 列表', async () => {
      mockOctokit.pulls.listReviewComments.mockResolvedValueOnce({
        data: [
          {
            id: 200,
            body: 'review',
            path: 'src/a.ts',
            line: 10,
            start_line: 8,
            user: {login: 'reviewer'},
            in_reply_to_id: undefined,
            node_id: 'n',
            created_at: 't'
          }
        ]
      })

      const result: ReviewComment[] = await platform.listReviewComments(
        'o',
        'r',
        1
      )
      expect(result).toHaveLength(1)
      expect(result[0].path).toBe('src/a.ts')
      expect(result[0].startLine).toBe(8)
    })
  })

  describe('submitReviewComments', () => {
    test('空评论列表直接返回 0', async () => {
      const count = await platform.submitReviewComments('o', 'r', 1, 'sha', [])
      expect(count).toBe(0)
      expect(mockOctokit.pulls.createReview).not.toHaveBeenCalled()
    })

    test('批量提交评论', async () => {
      mockOctokit.pulls.createReview.mockResolvedValue({data: {id: 999}})
      mockOctokit.pulls.submitReview.mockResolvedValue({})

      const count = await platform.submitReviewComments('o', 'r', 1, 'sha', [
        {path: 'a.ts', body: 'fix', line: 5}
      ])
      expect(count).toBe(1)
      expect(mockOctokit.pulls.submitReview).toHaveBeenCalledWith(
        expect.objectContaining({review_id: 999, event: 'COMMENT'})
      )
    })
  })

  describe('replyToReviewComment', () => {
    test('回复行级评论', async () => {
      mockOctokit.pulls.createReplyForReviewComment.mockResolvedValue({
        data: {
          id: 300,
          body: 're',
          user: {login: 'bot'},
          node_id: 'n',
          created_at: 't'
        }
      })

      const result = await platform.replyToReviewComment('o', 'r', 1, 200, 're')
      expect(result.id).toBe(300)
    })
  })

  // ─── 6. Review thread ──────────────────────────────────────────────

  describe('fetchThreadStatusMap', () => {
    test('正常解析 GraphQL 响应', async () => {
      mockOctokit.graphql.mockResolvedValue({
        repository: {
          pullRequest: {
            reviewThreads: {
              pageInfo: {hasNextPage: false, endCursor: null},
              nodes: [
                {
                  id: 't1',
                  isResolved: true,
                  path: 'a.ts',
                  line: 10,
                  comments: {nodes: []}
                },
                {
                  id: 't2',
                  isResolved: false,
                  path: 'b.ts',
                  line: 20,
                  comments: {nodes: []}
                }
              ]
            }
          }
        }
      })

      const map = await platform.fetchThreadStatusMap('o', 'r', 1)
      expect(map.get('a.ts:10')).toBe(true)
      expect(map.get('b.ts:20')).toBe(false)
    })
  })

  describe('fetchUnresolvedBotThreads', () => {
    test('过滤出 bot 的未 resolved thread', async () => {
      mockOctokit.graphql.mockResolvedValue({
        repository: {
          pullRequest: {
            reviewThreads: {
              pageInfo: {hasNextPage: false, endCursor: null},
              nodes: [
                {
                  id: 't1',
                  isResolved: false,
                  path: 'a.ts',
                  line: 10,
                  comments: {
                    nodes: [
                      {author: {login: 'github-actions[bot]'}, body: 'fix this'}
                    ]
                  }
                },
                {
                  id: 't2',
                  isResolved: false,
                  path: 'b.ts',
                  line: 20,
                  comments: {
                    nodes: [{author: {login: 'human'}, body: 'looks ok'}]
                  }
                },
                {
                  id: 't3',
                  isResolved: true,
                  path: 'c.ts',
                  line: 30,
                  comments: {
                    nodes: [{author: {login: 'github-actions'}, body: 'done'}]
                  }
                }
              ]
            }
          }
        }
      })

      const result: ReviewThreadInfo[] =
        await platform.fetchUnresolvedBotThreads('o', 'r', 1, 'github-actions')
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('t1')
      expect(result[0].firstCommentBody).toBe('fix this')
    })
  })

  describe('resolveThreads', () => {
    test('批量 resolve', async () => {
      mockOctokit.graphql.mockResolvedValue({
        resolveReviewThread: {thread: {isResolved: true}}
      })

      const result = await platform.resolveThreads(['t1', 't2'])
      expect(result.ok).toBe(2)
      expect(result.failed).toBe(0)
    })

    test('部分失败', async () => {
      mockOctokit.graphql
        .mockResolvedValueOnce({
          resolveReviewThread: {thread: {isResolved: true}}
        })
        .mockRejectedValueOnce(new Error('not found'))

      const result = await platform.resolveThreads(['t1', 't2'])
      expect(result.ok).toBe(1)
      expect(result.failed).toBe(1)
    })
  })

  // ─── 7. Reaction ────────────────────────────────────────────────────

  describe('addReaction', () => {
    test('issue_comment 使用 createForIssueComment', async () => {
      mockOctokit.reactions.createForIssueComment.mockResolvedValue({})
      await platform.addReaction('o', 'r', 100, 'eyes', 'issue_comment')
      expect(mockOctokit.reactions.createForIssueComment).toHaveBeenCalled()
    })

    test('review_comment 使用 createForPullRequestReviewComment', async () => {
      mockOctokit.reactions.createForPullRequestReviewComment.mockResolvedValue(
        {}
      )
      await platform.addReaction('o', 'r', 200, 'rocket', 'review_comment')
      expect(
        mockOctokit.reactions.createForPullRequestReviewComment
      ).toHaveBeenCalled()
    })
  })

  // ─── 8. 权限 ────────────────────────────────────────────────────────

  describe('getCollaboratorPermission', () => {
    test('返回权限等级', async () => {
      mockOctokit.repos.getCollaboratorPermissionLevel.mockResolvedValue({
        data: {permission: 'write'}
      })

      const perm = await platform.getCollaboratorPermission('o', 'r', 'user')
      expect(perm).toBe('write')
    })

    test('API 403 → GitPlatformError forbidden', async () => {
      const err: any = new Error('Forbidden')
      err.status = 403
      mockOctokit.repos.getCollaboratorPermissionLevel.mockRejectedValue(err)

      await expect(
        platform.getCollaboratorPermission('o', 'r', 'user')
      ).rejects.toThrow(GitPlatformError)
    })
  })

  // ─── 9. 用户身份 ────────────────────────────────────────────────────

  describe('getAuthenticatedLogin', () => {
    test('正常返回 login', async () => {
      mockOctokit.users.getAuthenticated.mockResolvedValue({
        data: {login: 'my-bot'}
      })
      const login = await platform.getAuthenticatedLogin()
      expect(login).toBe('my-bot')
    })

    test('失败时回退为 github-actions', async () => {
      mockOctokit.users.getAuthenticated.mockRejectedValue(
        new Error('no scope')
      )
      const login = await platform.getAuthenticatedLogin()
      expect(login).toBe('github-actions')
    })
  })

  // ─── 10. 仓库文件树 ─────────────────────────────────────────────────

  describe('listRepositoryTree (DEP-001/003)', () => {
    test('返回 tree entries', async () => {
      mockOctokit.git.getTree.mockResolvedValue({
        data: {
          tree: [
            {type: 'blob', path: 'src/a.ts'},
            {type: 'tree', path: 'src'},
            {type: 'blob', path: 'README.md'}
          ]
        }
      })

      const entries = await platform.listRepositoryTree('o', 'r', 'sha')
      expect(entries).toHaveLength(3)
      expect(entries[0]).toEqual({type: 'blob', path: 'src/a.ts'})
    })

    test('API 失败抛出 GitPlatformError', async () => {
      const err: any = new Error('Internal')
      err.status = 500
      mockOctokit.git.getTree.mockRejectedValue(err)

      await expect(
        platform.listRepositoryTree('o', 'r', 'sha')
      ).rejects.toThrow(GitPlatformError)
    })
  })

  // ─── ARCH-022: 错误语义转换 ────────────────────────────────────────

  describe('GitPlatformError 错误语义', () => {
    test('429 → rate_limited', async () => {
      const err: any = new Error('Too Many')
      err.status = 429
      mockOctokit.pulls.get.mockRejectedValue(err)

      try {
        await platform.getChangeRequest('o', 'r', 1)
      } catch (e: any) {
        expect(e).toBeInstanceOf(GitPlatformError)
        expect(e.errorKind).toBe('rate_limited')
      }
    })

    test('5xx → server_error', async () => {
      const err: any = new Error('Bad Gateway')
      err.status = 502
      mockOctokit.pulls.get.mockRejectedValue(err)

      try {
        await platform.getChangeRequest('o', 'r', 1)
      } catch (e: any) {
        expect(e.errorKind).toBe('server_error')
      }
    })

    test('ECONNRESET → timeout', async () => {
      mockOctokit.pulls.get.mockRejectedValue(new Error('read ECONNRESET'))

      try {
        await platform.getChangeRequest('o', 'r', 1)
      } catch (e: any) {
        expect(e.errorKind).toBe('timeout')
      }
    })
  })
})
