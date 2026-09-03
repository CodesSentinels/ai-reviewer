/**
 * repo-tree-platform-contract.test.ts — 两平台文件树契约（§14.4 TEST-031）
 *
 * TEST-031 要求覆盖「分页、recursive、缓存、错误和大仓截断」。缓存那部分在
 * `repo-tree-cache-isolation.test.ts`；本文件补两个 adapter 侧还缺的维度。
 *
 * 已有覆盖（不重复）：
 *   git-platform.test.ts     全量/子树、truncated 透传、错误、子树路径补全
 *   gitlab-platform.test.ts  正常返回、空仓库 404、subgroup、目录探查
 *   gitlab-api-contract.test.ts  每个 list API 都带 perPage/maxPages
 *
 * 本文件补的是**截断判定的三条分支**——那是两平台差异最大、也最容易出错的地方：
 *
 *   GitHub  API 自己返回 `truncated` 布尔，adapter 原样透传
 *   GitLab  没有这个字段，要靠「取到的条目数是否达到 perPage × maxPages 上限」
 *           推断；正好卡在上限时还要再探一页拿事实，否则「恰好 5 万个文件的
 *           仓库」会被误报成截断
 *
 * 截断误报不是无害的：下游会以为文件树不完整而走 DEP-004 的按需回填，
 * 多花一堆 API 请求；漏报更糟——`resolveImportPath` 把「文件不在列表里」
 * 当成「不是仓库内导入」，跨文件依赖静默丢失。
 */
import {describe, expect, test, beforeEach, jest} from '@jest/globals'

// ─── GitHub 出口 ─────────────────────────────────────────────────────────────
const octokitState: any = {git: {getTree: jest.fn<any>()}}
jest.mock('../src/octokit', () => ({octokit: octokitState}))

// ─── GitLab 出口 ────────────────────────────────────────────────────────────
const gitbeaker: any = {
  Repositories: {allRepositoryTrees: jest.fn<any>()}
}
jest.mock('@gitbeaker/rest', () => ({Gitlab: jest.fn().mockImplementation(() => gitbeaker)}))
jest.mock('../src/platform/logger', () => ({
  getLogger: () => ({info: jest.fn(), warning: jest.fn(), error: jest.fn(), debug: jest.fn()})
}))

import {GitHubPlatform} from '../src/platform/github-platform'
import {GitLabPlatform} from '../src/platform/gitlab-platform'
import {TREE_PAGINATION_DEFAULTS} from '../src/platform/gitlab-client'

const github = new GitHubPlatform()
const gitlab = new GitLabPlatform({
  host: 'https://gitlab.example.com',
  credential: {type: 'pat', value: 'glpat-test'},
  timeoutMS: 30_000
})

const LIMIT = TREE_PAGINATION_DEFAULTS.perPage * TREE_PAGINATION_DEFAULTS.maxPages

/** 造 n 个 blob 条目 */
function blobs(n: number, prefix = 'f'): Array<{type: string; path: string}> {
  return Array.from({length: n}, (_, i) => ({type: 'blob', path: `${prefix}${i}.ts`}))
}

beforeEach(() => {
  jest.clearAllMocks()
})

// ═══════════════════ GitHub：recursive 与 truncated ═════════════════════════

describe('GitHub：全量树必须 recursive', () => {
  /**
   * 既有测试只断言了「传 path 时**不** recursive」。反方向没人守——
   * 全量树漏掉 `recursive: 'true'` 的话，只会拿到根目录一层，
   * 而返回结构完全正常，没有任何报错。
   */
  test('不传 path → recursive=true，tree_sha 就是 ref', async () => {
    octokitState.git.getTree.mockResolvedValue({data: {tree: blobs(3), truncated: false}})

    await github.listRepositoryTree('o', 'r', 'sha')

    const args = (octokitState.git.getTree.mock.calls as any[][])[0][0]
    expect(args.recursive).toBe('true')
    expect(args.tree_sha).toBe('sha')
  })

  test('truncated 由 API 决定，adapter 不自行推断', async () => {
    octokitState.git.getTree.mockResolvedValue({data: {tree: blobs(LIMIT + 10), truncated: false}})

    const result = await github.listRepositoryTree('o', 'r', 'sha')

    // 条目数远超 GitLab 的上限，但 GitHub 说没截断就是没截断
    expect(result.truncated).toBe(false)
    expect(result.entries).toHaveLength(LIMIT + 10)
  })
})

// ═══════════════════ GitLab：截断判定的三条分支 ═════════════════════════════

describe('GitLab：截断只能靠条目数推断，三条分支各不相同', () => {
  test('未达上限 → 翻页自然结束，一定完整', async () => {
    gitbeaker.Repositories.allRepositoryTrees.mockResolvedValue(blobs(LIMIT - 1))

    const result = await gitlab.listRepositoryTree('g', 'r', 'main')

    expect(result.truncated).toBe(false)
    // 未达上限时不该再发探测请求
    expect(gitbeaker.Repositories.allRepositoryTrees).toHaveBeenCalledTimes(1)
  })

  /**
   * 正好卡在上限是最容易出错的一档：既可能是「刚好取完」，也可能是
   * 「还有下一页」。实现会再探一页拿事实，而不是一律判成截断——
   * 否则恰好 50000 个文件的仓库会被永久误报。
   */
  test('正好卡在上限且探测到下一页有内容 → truncated=true', async () => {
    gitbeaker.Repositories.allRepositoryTrees
      .mockResolvedValueOnce(blobs(LIMIT))
      .mockResolvedValueOnce(blobs(1, 'next')) // 探测页非空

    const result = await gitlab.listRepositoryTree('g', 'r', 'main')

    expect(result.truncated).toBe(true)
    expect(gitbeaker.Repositories.allRepositoryTrees).toHaveBeenCalledTimes(2)
  })

  test('正好卡在上限但下一页为空 → truncated=false（不误报）', async () => {
    gitbeaker.Repositories.allRepositoryTrees
      .mockResolvedValueOnce(blobs(LIMIT))
      .mockResolvedValueOnce([]) // 探测页为空 = 刚好取完

    const result = await gitlab.listRepositoryTree('g', 'r', 'main')

    expect(result.truncated).toBe(false)
    expect(result.entries).toHaveLength(LIMIT)
  })

  test('探测请求本身失败 → 保守判为截断（宁可提示不完整）', async () => {
    gitbeaker.Repositories.allRepositoryTrees
      .mockResolvedValueOnce(blobs(LIMIT))
      .mockRejectedValueOnce(new Error('503'))

    const result = await gitlab.listRepositoryTree('g', 'r', 'main')

    expect(result.truncated).toBe(true)
  })

  test('探测请求与主查询的 perPage 一致（否则页码换算不到同一位置）', async () => {
    gitbeaker.Repositories.allRepositoryTrees
      .mockResolvedValueOnce(blobs(LIMIT))
      .mockResolvedValueOnce([])

    await gitlab.listRepositoryTree('g', 'r', 'main')

    const calls = gitbeaker.Repositories.allRepositoryTrees.mock.calls as any[][]
    const probeOpts = calls[1][1]
    expect(probeOpts.perPage).toBe(TREE_PAGINATION_DEFAULTS.perPage)
    // 显式传 page 让 gitbeaker 退化为单页请求
    expect(probeOpts.page).toBeGreaterThan(0)
  })

  /**
   * 目录探查**同样**可能被截断。
   *
   * 初版把「传了 path 就 truncated=false」固化成了测试，那是在给一个错误行为
   * 上锁：`recursive: false` 只说明查一层，不保证这一层少于
   * perPage × maxPages。一个有五万个直接子项的目录照样会被截断。
   *
   * 这对 DEP-004 的按需回填尤其要命——主树截断后正是靠逐目录回填来补，
   * 若回填结果也被谎报完整，下游会把「缺失路径」当成「文件不存在」。
   */
  test('目录探查未达上限 → 完整，且不发探测请求', async () => {
    gitbeaker.Repositories.allRepositoryTrees.mockResolvedValue(blobs(3))

    const result = await gitlab.listRepositoryTree('g', 'r', 'main', 'src/utils')

    expect(result.truncated).toBe(false)
    expect(gitbeaker.Repositories.allRepositoryTrees).toHaveBeenCalledTimes(1)
  })

  test('目录探查卡在上限 → 同样要探测，不能谎报完整', async () => {
    gitbeaker.Repositories.allRepositoryTrees
      .mockResolvedValueOnce(blobs(LIMIT))
      .mockResolvedValueOnce(blobs(1, 'next'))

    const result = await gitlab.listRepositoryTree('g', 'r', 'main', 'src/utils')

    expect(result.truncated).toBe(true)
    expect(gitbeaker.Repositories.allRepositoryTrees).toHaveBeenCalledTimes(2)
  })

  test('目录探查的探测请求必须与主查询同形（带 path 且 recursive=false）', async () => {
    gitbeaker.Repositories.allRepositoryTrees
      .mockResolvedValueOnce(blobs(LIMIT))
      .mockResolvedValueOnce([])

    await gitlab.listRepositoryTree('g', 'r', 'main', 'src/utils')

    const probeOpts = (gitbeaker.Repositories.allRepositoryTrees.mock.calls as any[][])[1][1]
    // 探的必须是同一个集合，否则拿到的「下一页」根本不是这个目录的
    expect(probeOpts.path).toBe('src/utils')
    expect(probeOpts.recursive).toBe(false)
    expect(probeOpts.perPage).toBe(TREE_PAGINATION_DEFAULTS.perPage)
  })
})

// ═══════════════════ 分页与 recursive 的调用契约 ═════════════════════════════

describe('GitLab：分页与 recursive 参数', () => {
  test('全量树 recursive=true，并带 tree 专用分页上限', async () => {
    gitbeaker.Repositories.allRepositoryTrees.mockResolvedValue(blobs(3))

    await gitlab.listRepositoryTree('g', 'r', 'main')

    const opts = (gitbeaker.Repositories.allRepositoryTrees.mock.calls as any[][])[0][1]
    expect(opts.recursive).toBe(true)
    expect(opts.ref).toBe('main')
    expect(opts.perPage).toBe(TREE_PAGINATION_DEFAULTS.perPage)
    expect(opts.maxPages).toBe(TREE_PAGINATION_DEFAULTS.maxPages)
  })

  test('目录探查 recursive=false 且带 path', async () => {
    gitbeaker.Repositories.allRepositoryTrees.mockResolvedValue(blobs(1))

    await gitlab.listRepositoryTree('g', 'r', 'main', 'src/utils')

    const opts = (gitbeaker.Repositories.allRepositoryTrees.mock.calls as any[][])[0][1]
    expect(opts.recursive).toBe(false)
    expect(opts.path).toBe('src/utils')
  })

  /**
   * tree 的分页上限必须比通用上限宽——大仓的文件数远超评论、commit 这类列表。
   * 这条在 gitlab-api-contract 里有，这里不重复断言具体数值，
   * 只确认 adapter 用的是 tree 专用那套而不是通用那套。
   */
  test('用的是 TREE_PAGINATION_DEFAULTS 而不是通用分页', async () => {
    gitbeaker.Repositories.allRepositoryTrees.mockResolvedValue(blobs(3))

    await gitlab.listRepositoryTree('g', 'r', 'main')

    const opts = (gitbeaker.Repositories.allRepositoryTrees.mock.calls as any[][])[0][1]
    expect(opts.maxPages).toBe(TREE_PAGINATION_DEFAULTS.maxPages)
  })
})

// ═══════════════════ 两平台输出形状一致 ═════════════════════════════════════

describe('同一逻辑文件树，两平台归一化后形状一致', () => {
  test('entries 都是 {type, path}，truncated 都是布尔', async () => {
    octokitState.git.getTree.mockResolvedValue({
      data: {
        tree: [
          {type: 'blob', path: 'src/a.ts', mode: '100644', sha: 'x'},
          {type: 'tree', path: 'src', mode: '040000', sha: 'y'}
        ],
        truncated: false
      }
    })
    gitbeaker.Repositories.allRepositoryTrees.mockResolvedValue([
      {type: 'blob', path: 'src/a.ts', id: 'x', mode: '100644', name: 'a.ts'},
      {type: 'tree', path: 'src', id: 'y', mode: '040000', name: 'src'}
    ])

    const gh = await github.listRepositoryTree('o', 'r', 'sha')
    const gl = await gitlab.listRepositoryTree('g', 'r', 'main')

    // GitLab adapter 只取 type/path；GitHub 侧保留原始字段但下游只读这两个。
    // 比较的是**下游会用到的那部分**是否一致。
    const shape = (r: any): unknown =>
      r.entries.map((e: any) => ({type: e.type, path: e.path})).concat([{truncated: r.truncated}])

    expect(shape(gh)).toEqual(shape(gl))
  })
})

// ═══════════════════ 空仓库：两平台各自的原生错误形态 ═══════════════════════

/**
 * 「空仓库」在两个平台是**不同的错误响应**，不是同一个空数组。
 *
 * 只让替身返回 `[]` 只能证明「已经拿到空树之后能正常处理」，证明不了 adapter
 * 会把真实的空仓 API 响应归一化成空树。而这两条归一化路径此前是不对称的：
 * GitLab 认 `404 Tree Not Found`，GitHub 对全量树的任何错误都直接抛。
 */
describe('空仓库归一化', () => {
  test('GitHub：409 "Git Repository is empty." → 空树而不是抛错', async () => {
    octokitState.git.getTree.mockRejectedValue(
      Object.assign(new Error('Git Repository is empty.'), {status: 409})
    )

    const result = await github.listRepositoryTree('o', 'r', 'sha')

    expect(result).toEqual({entries: [], truncated: false})
  })

  test('GitLab：404 "Tree Not Found" → 空树而不是抛错', async () => {
    gitbeaker.Repositories.allRepositoryTrees.mockRejectedValue(
      Object.assign(new Error('404 Tree Not Found'), {cause: {response: {status: 404}}})
    )

    const result = await gitlab.listRepositoryTree('g', 'r', 'main')

    expect(result).toEqual({entries: [], truncated: false})
  })

  /**
   * 反向：真实故障不能被误吞成空仓。这比「空仓能识别」更重要——
   * 把 403 当成空树，整个依赖分析会静默降级，而日志里什么都看不出来。
   */
  test('GitHub：409 但不是空仓文案 → 仍然抛错', async () => {
    octokitState.git.getTree.mockRejectedValue(
      Object.assign(new Error('Conflict: reference update failed'), {status: 409})
    )

    await expect(github.listRepositoryTree('o', 'r', 'sha')).rejects.toThrow()
  })

  test('GitHub：全量树的 404 / 403 仍然抛错', async () => {
    for (const status of [404, 403]) {
      octokitState.git.getTree.mockRejectedValue(
        Object.assign(new Error(`HTTP ${status}`), {status})
      )
      await expect(github.listRepositoryTree('o', 'r', 'sha')).rejects.toThrow()
    }
  })

  test('GitLab：非 Tree Not Found 的 404 仍然抛错', async () => {
    gitbeaker.Repositories.allRepositoryTrees.mockRejectedValue(
      Object.assign(new Error('404 Project Not Found'), {cause: {response: {status: 404}}})
    )

    await expect(gitlab.listRepositoryTree('g', 'r', 'main')).rejects.toThrow()
  })

  test('两平台的空仓结果形状一致', async () => {
    octokitState.git.getTree.mockRejectedValue(
      Object.assign(new Error('Git Repository is empty.'), {status: 409})
    )
    gitbeaker.Repositories.allRepositoryTrees.mockRejectedValue(
      Object.assign(new Error('404 Tree Not Found'), {cause: {response: {status: 404}}})
    )

    const gh = await github.listRepositoryTree('o', 'r', 'sha')
    const gl = await gitlab.listRepositoryTree('g', 'r', 'main')

    expect(gh).toEqual(gl)
  })
})
