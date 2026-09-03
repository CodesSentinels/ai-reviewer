/**
 * repo-tree-cache-isolation.test.ts — 文件树缓存隔离（§14.4 TEST-039）
 *
 * `repo-tree.ts` 的缓存是**模块级单例**：一个 `cachedTree` + 一个 `cachedTreeKey`。
 * 这类结构最容易出的问题不是"缓存没生效"，而是"不该命中的时候命中了"——
 * 而那种错误没有任何症状：下游 `resolveImportPath` 拿到另一个项目的文件列表，
 * 只会得出"这个 import 解析不了"的结论，看起来就像正常的分析失败。
 *
 * 既有测试绕开了缓存而不是测试它：`dep-tree-consistency.test.ts` 用
 * `uniqueProject()` 给每个用例换一个 repo 名，正是为了不撞缓存。所以缓存
 * 本身的行为一直没有被验证过。
 *
 * 本文件补三件事：
 *
 *   1. key 的四个维度（platform / owner / repo / ref）任一不同都不得命中
 *   2. 命中时返回的必须是**完整的**缓存对象，含截断状态
 *   3. 空仓库、截断响应、API 失败三个分支各自的缓存语义
 */
import {describe, expect, test, beforeEach, jest} from '@jest/globals'

jest.mock('../src/platform/logger', () => ({
  getLogger: () => ({info: jest.fn(), warning: jest.fn(), error: jest.fn(), debug: jest.fn()})
}))

import {
  getRepoFileTree,
  _resetTreeCache,
  _currentTreeCacheKey,
  type RepoTreeProject,
  type TreeFetcher,
  type TreeFetchResult
} from '../src/repo-tree'

/** 可控的 tree 获取替身：记录调用次数，便于区分「命中缓存」与「重新拉取」 */
function makeFetcher(result: TreeFetchResult | (() => Promise<TreeFetchResult>)): TreeFetcher & {
  calls: number
} {
  const f = {
    calls: 0,
    async getTree(): Promise<TreeFetchResult> {
      f.calls++
      return typeof result === 'function' ? await result() : result
    }
  }
  return f
}

const BASE_PROJECT: RepoTreeProject = {platform: 'github', owner: 'octo', repo: 'demo'}
const REF = 'a'.repeat(40)

function tree(...paths: string[]): TreeFetchResult {
  return {entries: paths.map(p => ({type: 'blob', path: p})), truncated: false}
}

beforeEach(() => {
  _resetTreeCache()
})

// ═══════════════════ 缓存命中的正向行为 ═════════════════════════════════════

describe('缓存命中', () => {
  test('同一 platform + project + ref 第二次不再调用 API', async () => {
    const fetcher = makeFetcher(tree('src/a.ts', 'src/b.ts'))

    const first = await getRepoFileTree(REF, BASE_PROJECT, fetcher)
    const second = await getRepoFileTree(REF, BASE_PROJECT, fetcher)

    expect(fetcher.calls).toBe(1)
    expect(second).toEqual(first)
    expect(_currentTreeCacheKey()).toBe(`github:octo/demo@${REF}`)
  })

  test('只保留 blob，目录条目被过滤掉', async () => {
    const fetcher = makeFetcher({
      entries: [
        {type: 'blob', path: 'src/a.ts'},
        {type: 'tree', path: 'src'},
        {type: 'blob', path: 'src/b.ts'},
        {type: 'commit', path: 'submodule'} // submodule 也不是文件
      ],
      truncated: false
    })

    const result = await getRepoFileTree(REF, BASE_PROJECT, fetcher)

    expect(result.files).toEqual(['src/a.ts', 'src/b.ts'])
  })
})

// ═══════════════════ TEST-039：四个维度的隔离 ═══════════════════════════════

describe('TEST-039：key 的每个维度都必须参与隔离', () => {
  /**
   * 逐维验证：先用基准填满缓存，再只改一维，必须重新拉取。
   *
   * 「只改一维」很重要——同时改两维的话，漏掉其中任一维都测不出来
   * （这个坑在 §14.2 的双平台等价用例上踩过）。
   */
  const dimensions: Array<[string, RepoTreeProject, string]> = [
    ['platform', {...BASE_PROJECT, platform: 'gitlab'}, REF],
    ['owner', {...BASE_PROJECT, owner: 'another-org'}, REF],
    ['repo', {...BASE_PROJECT, repo: 'another-repo'}, REF],
    ['ref', BASE_PROJECT, 'b'.repeat(40)]
  ]

  test.each(dimensions)('只改 %s → 不命中缓存，重新拉取', async (_label, project, ref) => {
    const fetcher = makeFetcher(tree('src/a.ts'))

    await getRepoFileTree(REF, BASE_PROJECT, fetcher)
    expect(fetcher.calls).toBe(1)

    await getRepoFileTree(ref, project, fetcher)

    expect(fetcher.calls).toBe(2)
  })

  test('对照组：四维全同确实命中（证明上面不是「永远不命中」）', async () => {
    const fetcher = makeFetcher(tree('src/a.ts'))

    await getRepoFileTree(REF, BASE_PROJECT, fetcher)
    await getRepoFileTree(REF, {...BASE_PROJECT}, fetcher) // 换个对象，值相同

    expect(fetcher.calls).toBe(1)
  })

  /**
   * 不同项目的内容不能互相污染。
   *
   * 只断言「重新拉取」是不够的——万一实现拉了新数据却返回了旧缓存对象，
   * 调用次数照样是 2，内容却是错的。这里比对**内容**。
   */
  test('两个项目交替访问，各自拿到自己的文件列表', async () => {
    const a = makeFetcher(tree('a-only.ts'))
    const b = makeFetcher(tree('b-only.ts'))

    const first = await getRepoFileTree(REF, {platform: 'github', owner: 'o', repo: 'A'}, a)
    const second = await getRepoFileTree(REF, {platform: 'github', owner: 'o', repo: 'B'}, b)
    const third = await getRepoFileTree(REF, {platform: 'github', owner: 'o', repo: 'A'}, a)

    expect(first.files).toEqual(['a-only.ts'])
    expect(second.files).toEqual(['b-only.ts'])
    // A 被 B 挤掉后重新拉取，内容仍是 A 的
    expect(third.files).toEqual(['a-only.ts'])
  })

  /**
   * `platform` 是可选字段，缺省时代码按 `?? 'github'` 处理。
   * 这意味着「未标注 platform」与「显式 github」是同一个缓存域——
   * 是有意的向后兼容，但必须钉住，否则哪天默认值改了会静默串域。
   */
  test('platform 缺省等同于 github（有意的向后兼容）', async () => {
    const fetcher = makeFetcher(tree('src/a.ts'))

    await getRepoFileTree(REF, {owner: 'octo', repo: 'demo'}, fetcher)
    await getRepoFileTree(REF, {platform: 'github', owner: 'octo', repo: 'demo'}, fetcher)

    expect(fetcher.calls).toBe(1)
    expect(_currentTreeCacheKey()).toBe(`github:octo/demo@${REF}`)
  })

  test('缺省 platform 与显式 gitlab 不是同一个域', async () => {
    const fetcher = makeFetcher(tree('src/a.ts'))

    await getRepoFileTree(REF, {owner: 'octo', repo: 'demo'}, fetcher)
    await getRepoFileTree(REF, {platform: 'gitlab', owner: 'octo', repo: 'demo'}, fetcher)

    expect(fetcher.calls).toBe(2)
  })
})

// ═══════════════════ TEST-031/039：三个边界分支 ═════════════════════════════

describe('空仓库', () => {
  test('空树 → 空列表，且仍然被缓存（不会每次重拉）', async () => {
    const fetcher = makeFetcher({entries: [], truncated: false})

    const first = await getRepoFileTree(REF, BASE_PROJECT, fetcher)
    const second = await getRepoFileTree(REF, BASE_PROJECT, fetcher)

    expect(first.files).toEqual([])
    expect(first.truncated).toBe(false)
    expect(fetcher.calls).toBe(1) // 空结果不是「没缓存」
    expect(second.files).toEqual([])
  })
})

describe('截断响应', () => {
  test('截断状态随结果缓存，命中时不会退化成「完整」', async () => {
    const fetcher = makeFetcher({
      entries: [{type: 'blob', path: 'src/a.ts'}],
      truncated: true
    })

    const first = await getRepoFileTree(REF, BASE_PROJECT, fetcher)
    const second = await getRepoFileTree(REF, BASE_PROJECT, fetcher)

    expect(first.truncated).toBe(true)
    expect(second.truncated).toBe(true) // 关键：命中缓存也必须带着截断标记
    expect(fetcher.calls).toBe(1)
  })

  /**
   * 截断的树被当成完整树，后果是 `resolveImportPath` 把「文件不在列表里」
   * 误判成「不是仓库内导入」——跨文件依赖静默丢失，没有任何报错。
   */
  test('截断的树不因缓存而丢失警示信息', async () => {
    const fetcher = makeFetcher({
      entries: [{type: 'blob', path: 'src/a.ts'}],
      truncated: true
    })

    await getRepoFileTree(REF, BASE_PROJECT, fetcher)
    const cached = await getRepoFileTree(REF, BASE_PROJECT, fetcher)

    expect(cached).toEqual({files: ['src/a.ts'], truncated: true})
  })
})

describe('API 失败', () => {
  test('抛错时不写缓存，下次调用会重试', async () => {
    let attempt = 0
    const fetcher = makeFetcher(async () => {
      attempt++
      if (attempt === 1) throw new Error('502 Bad Gateway')
      return tree('src/a.ts')
    })

    await expect(getRepoFileTree(REF, BASE_PROJECT, fetcher)).rejects.toThrow('502')
    // 失败没有污染缓存
    expect(_currentTreeCacheKey()).toBeNull()

    const retry = await getRepoFileTree(REF, BASE_PROJECT, fetcher)

    expect(retry.files).toEqual(['src/a.ts'])
    expect(fetcher.calls).toBe(2)
  })

  /**
   * 更隐蔽的一种：先成功缓存了 A，随后 B 的请求失败。
   * 失败不能把 A 的缓存清掉，也不能让 B 拿到 A 的内容。
   */
  test('后续请求失败不破坏已有缓存，也不返回别人的数据', async () => {
    const ok = makeFetcher(tree('a-only.ts'))
    const bad = makeFetcher(async () => {
      throw new Error('403 Forbidden')
    })

    const a = await getRepoFileTree(REF, {platform: 'github', owner: 'o', repo: 'A'}, ok)
    expect(a.files).toEqual(['a-only.ts'])

    await expect(
      getRepoFileTree(REF, {platform: 'github', owner: 'o', repo: 'B'}, bad)
    ).rejects.toThrow('403')

    // A 的缓存键仍在，内容也没被 B 覆盖
    expect(_currentTreeCacheKey()).toBe(`github:o/A@${REF}`)
    const again = await getRepoFileTree(REF, {platform: 'github', owner: 'o', repo: 'A'}, ok)
    expect(again.files).toEqual(['a-only.ts'])
    expect(ok.calls).toBe(1) // 仍是缓存命中
  })
})

describe('_resetTreeCache', () => {
  test('重置后不再命中（模拟新进程）', async () => {
    const fetcher = makeFetcher(tree('src/a.ts'))

    await getRepoFileTree(REF, BASE_PROJECT, fetcher)
    _resetTreeCache()
    await getRepoFileTree(REF, BASE_PROJECT, fetcher)

    expect(fetcher.calls).toBe(2)
    expect(_currentTreeCacheKey()).toBe(`github:octo/demo@${REF}`)
  })
})
