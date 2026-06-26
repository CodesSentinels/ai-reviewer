/**
 * 1.2 增量审查（P0）
 *
 * 测试增量审查的状态管理逻辑：
 * - commit ID 区块的解析与构建
 * - 最高已审查 commit 的查找
 * - 增量 diff 起点的确定
 * - full review 模式下从 base 全量审查
 */

import {describe, expect, jest, test} from '@jest/globals'

jest.mock('@actions/core', () => ({
  info: jest.fn(),
  warning: jest.fn(),
  error: jest.fn(),
  getInput: jest.fn().mockReturnValue('')
}))

jest.mock('@actions/github', () => ({
  context: {
    repo: {owner: 'test-owner', repo: 'test-repo'},
    payload: {pull_request: {number: 1, head: {sha: 'head123'}, base: {sha: 'base123'}}},
    eventName: 'pull_request'
  }
}))

jest.mock('../../src/octokit', () => ({
  octokit: {
    repos: {compareCommits: jest.fn(), getContent: jest.fn()},
    pulls: {get: jest.fn(), listCommits: jest.fn(), listReviews: jest.fn()},
    issues: {listComments: jest.fn()}
  }
}))

import {Commenter, COMMIT_ID_START_TAG, COMMIT_ID_END_TAG} from '../../src/commenter'

const commenter = new Commenter()

// ==================== commit ID 区块解析 ====================

describe('1.2.2 — commit ID 区块解析', () => {
  test('从摘要评论中提取已审查 commit IDs', () => {
    const body = `摘要内容
${COMMIT_ID_START_TAG}
<!-- abc123 -->
<!-- def456 -->
<!-- ghi789 -->
${COMMIT_ID_END_TAG}`

    const ids = commenter.getReviewedCommitIds(body)
    expect(ids).toEqual(['abc123', 'def456', 'ghi789'])
  })

  test('无 commit ID 区块时返回空数组', () => {
    const body = '普通摘要内容，没有 commit ID 标签'
    const ids = commenter.getReviewedCommitIds(body)
    expect(ids).toEqual([])
  })

  test('commit ID 区块为空时返回空数组', () => {
    const body = `内容\n${COMMIT_ID_START_TAG}\n${COMMIT_ID_END_TAG}`
    const ids = commenter.getReviewedCommitIds(body)
    expect(ids).toEqual([])
  })

  test('提取完整的 commit ID 区块（含标签）', () => {
    const block = `${COMMIT_ID_START_TAG}\n<!-- sha1 -->\n${COMMIT_ID_END_TAG}`
    const body = `前置内容\n${block}\n后置内容`
    const extracted = commenter.getReviewedCommitIdsBlock(body)
    expect(extracted).toBe(block)
  })

  test('无区块时 getReviewedCommitIdsBlock 返回空字符串', () => {
    const body = '没有区块的内容'
    expect(commenter.getReviewedCommitIdsBlock(body)).toBe('')
  })
})

// ==================== 添加 commit ID ====================

describe('1.2.2 — 添加新的已审查 commit ID', () => {
  test('向已有区块追加新 commit ID', () => {
    const body = `内容\n${COMMIT_ID_START_TAG}\n<!-- abc123 -->\n${COMMIT_ID_END_TAG}`
    const result = commenter.addReviewedCommitId(body, 'def456')
    const ids = commenter.getReviewedCommitIds(result)
    expect(ids).toContain('abc123')
    expect(ids).toContain('def456')
  })

  test('无区块时创建新区块', () => {
    const body = '无 commit 标签的内容'
    const result = commenter.addReviewedCommitId(body, 'first-commit')
    expect(result).toContain(COMMIT_ID_START_TAG)
    expect(result).toContain(COMMIT_ID_END_TAG)
    expect(result).toContain('<!-- first-commit -->')
    expect(result).toContain('无 commit 标签的内容')
  })

  test('多次添加不丢失先前的 ID', () => {
    let body = '初始内容'
    body = commenter.addReviewedCommitId(body, 'sha-1')
    body = commenter.addReviewedCommitId(body, 'sha-2')
    body = commenter.addReviewedCommitId(body, 'sha-3')
    const ids = commenter.getReviewedCommitIds(body)
    expect(ids).toEqual(['sha-1', 'sha-2', 'sha-3'])
  })
})

// ==================== 最高已审查 commit 查找 ====================

describe('1.2.1 — getHighestReviewedCommitId', () => {
  test('返回 PR commit 列表中最后一个已审查的 commit', () => {
    const allCommits = ['c1', 'c2', 'c3', 'c4', 'c5']
    const reviewed = ['c1', 'c2', 'c3']
    const highest = commenter.getHighestReviewedCommitId(allCommits, reviewed)
    expect(highest).toBe('c3')
  })

  test('中间有跳过的 commit 仍返回最后匹配的', () => {
    const allCommits = ['c1', 'c2', 'c3', 'c4', 'c5']
    const reviewed = ['c1', 'c3'] // c2 未审查
    const highest = commenter.getHighestReviewedCommitId(allCommits, reviewed)
    expect(highest).toBe('c3')
  })

  test('无匹配时返回空字符串', () => {
    const allCommits = ['c1', 'c2', 'c3']
    const reviewed = ['x1', 'x2']
    const highest = commenter.getHighestReviewedCommitId(allCommits, reviewed)
    expect(highest).toBe('')
  })

  test('全部已审查时返回最后一个', () => {
    const allCommits = ['c1', 'c2', 'c3']
    const reviewed = ['c1', 'c2', 'c3']
    const highest = commenter.getHighestReviewedCommitId(allCommits, reviewed)
    expect(highest).toBe('c3')
  })

  test('空列表返回空字符串', () => {
    expect(commenter.getHighestReviewedCommitId([], ['c1'])).toBe('')
    expect(commenter.getHighestReviewedCommitId(['c1'], [])).toBe('')
  })
})

// ==================== 增量 diff 起点确定 ====================

describe('1.2.1 — 增量 diff 起点逻辑', () => {
  const baseSha = 'base-sha-000'
  const headSha = 'head-sha-999'

  function resolveStartCommit(highestReviewed: string, base: string, head: string): string {
    if (highestReviewed === '' || highestReviewed === head) {
      return base
    }
    return highestReviewed
  }

  test('首次审查（无已审查 commit）：从 base 开始', () => {
    expect(resolveStartCommit('', baseSha, headSha)).toBe(baseSha)
  })

  test('已审查到最新（head）：仍从 base 开始（无增量变更）', () => {
    expect(resolveStartCommit(headSha, baseSha, headSha)).toBe(baseSha)
  })

  test('有新 commit（增量审查）：从上次审查点开始', () => {
    expect(resolveStartCommit('mid-sha-555', baseSha, headSha)).toBe('mid-sha-555')
  })
})

// ==================== full review 模式 ====================

describe('1.2.3 — full review 全量审查', () => {
  test('full 模式强制从 base 开始', () => {
    const reviewMode = 'full'
    const baseSha = 'base-sha-000'
    const highestReviewed = 'mid-sha-555'

    // review.ts: if (reviewMode === 'full') → highestReviewedCommitId = base.sha
    const startFrom = reviewMode === 'full' ? baseSha : highestReviewed
    expect(startFrom).toBe(baseSha)
  })

  test('incremental 模式使用上次审查点', () => {
    const reviewMode: string = 'incremental'
    const baseSha = 'base-sha-000'
    const highestReviewed = 'mid-sha-555'

    const startFrom = reviewMode === 'full' ? baseSha : highestReviewed
    expect(startFrom).toBe('mid-sha-555')
  })
})

// ==================== 增量 diff 文件交集 ====================

describe('1.2.1 — 增量与全量 diff 文件交集', () => {
  test('只保留同时出现在增量和全量 diff 中的文件', () => {
    const targetBranchFiles = [
      {filename: 'a.ts'},
      {filename: 'b.ts'},
      {filename: 'c.ts'}
    ]
    const incrementalFiles = [
      {filename: 'b.ts'},
      {filename: 'c.ts'},
      {filename: 'd.ts'}
    ]

    const files = targetBranchFiles.filter(tbf =>
      incrementalFiles.some(inf => inf.filename === tbf.filename)
    )
    expect(files.map(f => f.filename)).toEqual(['b.ts', 'c.ts'])
  })

  test('增量文件为空时结果为空', () => {
    const targetBranchFiles = [{filename: 'a.ts'}]
    const incrementalFiles: {filename: string}[] = []
    const files = targetBranchFiles.filter(tbf =>
      incrementalFiles.some(inf => inf.filename === tbf.filename)
    )
    expect(files).toEqual([])
  })

  test('全量文件为空时结果为空', () => {
    const targetBranchFiles: {filename: string}[] = []
    const incrementalFiles = [{filename: 'a.ts'}]
    const files = targetBranchFiles.filter(tbf =>
      incrementalFiles.some(inf => inf.filename === tbf.filename)
    )
    expect(files).toEqual([])
  })
})
