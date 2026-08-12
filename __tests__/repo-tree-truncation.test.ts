/**
 * repo-tree-truncation.test.ts — DEP-004 文件树截断信号的端到端透传
 *
 * 回归目标：平台 API 截断文件树时，绝不能谎报完整。
 * 截断状态必须从 TreeFetcher → getRepoFileTree（含缓存）→ analyzeDependencies
 * → DependencyContext → PR 摘要区块 全程可见，否则「没找到跨文件引用」
 * 与「文件树不完整导致没找到」对用户是同一个结果，无法区分。
 */
import {describe, expect, test, jest} from '@jest/globals'

jest.mock('../src/platform/logger', () => ({
  getLogger: () => ({
    info: jest.fn(),
    warning: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }),
  setLogger: jest.fn()
}))

import {
  getRepoFileTree,
  importBasePaths,
  importProbeDirectories,
  type DirectoryLister,
  type RepoTreeProject,
  type TreeFetcher
} from '../src/repo-tree'
import {
  analyzeDependencies,
  formatDependencySummary,
  TREE_TRUNCATED_NOTICE,
  type DependencyContext,
  type FileContentFetcher
} from '../src/dependency-analyzer'
import {type Options} from '../src/options'

let counter = 0
function uniqueProject(): RepoTreeProject {
  counter++
  return {platform: 'github', owner: 'octo', repo: `trunc-${counter}`}
}

function makeFetcher(
  entries: Array<{type: string; path: string}>,
  truncated: boolean
): TreeFetcher {
  return {
    getTree: jest.fn<TreeFetcher['getTree']>().mockResolvedValue({entries, truncated})
  }
}

const FAKE_OPTIONS = {
  maxDependencyFiles: 50,
  pathFilters: {check: () => true}
} as unknown as Options
const NOOP_LIMIT = ((fn: any) => fn()) as any
const NO_CONTENT: FileContentFetcher = {
  getContent: jest.fn<FileContentFetcher['getContent']>().mockResolvedValue(null)
}

// ─── getRepoFileTree ──────────────────────────────────────────────────────

describe('getRepoFileTree：截断状态随结果返回', () => {
  test('truncated=true 时如实返回，files 仍是已拿到的部分', async () => {
    const fetcher = makeFetcher(
      [
        {type: 'blob', path: 'src/a.ts'},
        {type: 'blob', path: 'src/b.ts'}
      ],
      true
    )
    const result = await getRepoFileTree('sha', uniqueProject(), fetcher)
    expect(result.truncated).toBe(true)
    expect(result.files).toEqual(['src/a.ts', 'src/b.ts'])
  })

  test('truncated=false 时不误报', async () => {
    const fetcher = makeFetcher([{type: 'blob', path: 'src/a.ts'}], false)
    const result = await getRepoFileTree('sha', uniqueProject(), fetcher)
    expect(result.truncated).toBe(false)
  })

  test('缓存命中不会把截断的树当成完整树', async () => {
    const project = uniqueProject()
    const fetcher = makeFetcher([{type: 'blob', path: 'src/a.ts'}], true)

    const first = await getRepoFileTree('sha', project, fetcher)
    const second = await getRepoFileTree('sha', project, fetcher)

    expect(fetcher.getTree).toHaveBeenCalledTimes(1) // 确认走的是缓存分支
    expect(first.truncated).toBe(true)
    expect(second.truncated).toBe(true)
    expect(second.files).toEqual(first.files)
  })
})

// ─── analyzeDependencies ──────────────────────────────────────────────────

describe('analyzeDependencies：截断状态进入 DependencyContext', () => {
  test('空文件树早退路径仍透传 treeTruncated', async () => {
    const ctx = await analyzeDependencies(
      [['src/a.ts', 'export const a = 1', '@@ -0,0 +1 @@\n+export const a = 1', []]],
      [],
      FAKE_OPTIONS,
      NOOP_LIMIT,
      {owner: 'octo', repo: 'demo'},
      'sha',
      NO_CONTENT,
      undefined,
      {truncated: true}
    )
    expect(ctx.treeTruncated).toBe(true)
  })

  test('无修改导出符号的早退路径仍透传 treeTruncated', async () => {
    const ctx = await analyzeDependencies(
      [['src/a.ts', 'const a = 1', '@@ -1 +1 @@\n+const a = 1', []]],
      ['src/a.ts', 'src/b.ts'],
      FAKE_OPTIONS,
      NOOP_LIMIT,
      {owner: 'octo', repo: 'demo'},
      'sha',
      NO_CONTENT,
      undefined,
      {truncated: true}
    )
    expect(ctx.treeTruncated).toBe(true)
  })

  test('默认不截断（省略参数时为 false）', async () => {
    const ctx = await analyzeDependencies(
      [['src/a.ts', 'const a = 1', '@@ -1 +1 @@\n+const a = 1', []]],
      [],
      FAKE_OPTIONS,
      NOOP_LIMIT,
      {owner: 'octo', repo: 'demo'},
      'sha',
      NO_CONTENT
    )
    expect(ctx.treeTruncated).toBe(false)
  })
})

// ─── formatDependencySummary ──────────────────────────────────────────────

describe('formatDependencySummary：截断提示对用户可见', () => {
  test('截断 + 没有任何分析结果 → 仍输出降级提示', () => {
    const ctx: DependencyContext = {fileAnalyses: new Map(), treeTruncated: true}
    expect(formatDependencySummary(ctx)).toContain(TREE_TRUNCATED_NOTICE)
  })

  test('截断 + 有分析结果但零引用 → 仍输出降级提示（最需要提示的场景）', () => {
    const ctx: DependencyContext = {
      fileAnalyses: new Map([
        [
          'src/a.ts',
          {
            filename: 'src/a.ts',
            modifiedSymbols: [
              {name: 'a', type: 'function' as const, isExported: true, filename: 'src/a.ts'}
            ],
            dependentFiles: [],
            references: []
          }
        ]
      ]),
      treeTruncated: true
    }
    expect(formatDependencySummary(ctx)).toContain(TREE_TRUNCATED_NOTICE)
  })

  test('截断 + 有引用 → 提示与依赖区块同时输出', () => {
    const ctx: DependencyContext = {
      fileAnalyses: new Map([
        [
          'src/a.ts',
          {
            filename: 'src/a.ts',
            modifiedSymbols: [
              {name: 'a', type: 'function' as const, isExported: true, filename: 'src/a.ts'}
            ],
            dependentFiles: ['src/b.ts'],
            references: [
              {
                filename: 'src/b.ts',
                symbolName: 'a',
                lineNumber: 3,
                lineContent: 'a()'
              }
            ]
          }
        ]
      ]),
      treeTruncated: true
    }
    const out = formatDependencySummary(ctx)
    expect(out).toContain(TREE_TRUNCATED_NOTICE)
    expect(out).toContain('Cross-file dependency analysis')
  })

  test('未截断且无引用 → 保持原样输出空字符串（不新增噪音）', () => {
    const ctx: DependencyContext = {fileAnalyses: new Map(), treeTruncated: false}
    expect(formatDependencySummary(ctx)).toBe('')
  })
})

// ─── 第三层：截断后按需回填 ────────────────────────────────────────────────

describe('importBasePaths / importProbeDirectories：纯路径推导', () => {
  test('相对路径推出唯一基础路径', () => {
    expect(importBasePaths('src/api/login.ts', '../utils/hash')).toEqual(['src/utils/hash'])
  })

  test('别名路径推出全部候选基础路径', () => {
    expect(importBasePaths('src/a.ts', '@/utils/hash')).toEqual([
      'src/utils/hash',
      'app/utils/hash',
      'lib/utils/hash',
      'utils/hash'
    ])
  })

  test('npm 包不推导（不为第三方依赖浪费 API 预算）', () => {
    expect(importBasePaths('src/a.ts', 'lodash')).toEqual([])
    expect(importProbeDirectories('src/a.ts', 'lodash')).toEqual([])
  })

  test('每个基础路径给出两个目录：父目录（补扩展名）+ 自身（补 index）', () => {
    expect(importProbeDirectories('src/api/login.ts', '../utils/hash')).toEqual([
      'src/utils',
      'src/utils/hash'
    ])
  })
})

describe('analyzeDependencies：截断时按需回填不可见文件', () => {
  // 场景：截断的文件树里只看得见 src/api/login.ts。
  // 被修改的 src/utils/hash.ts 和真正引用它的 src/legacy/helper.ts 都不可见。
  const MODIFIED = 'src/utils/hash.ts'
  const PR_FILE = 'src/api/login.ts'
  const HIDDEN_DEP = 'src/legacy/helper.ts'

  const filesAndChanges: Array<[string, string, string, Array<[number, number, string]>]> = [
    [
      MODIFIED,
      'export function hashPassword(p: string): string {\n  return p\n}\n',
      '@@ -1,2 +1,3 @@\n+export function hashPassword(p: string): string {\n+  return p\n+}',
      []
    ],
    [PR_FILE, 'const x = 1\n', '@@ -1 +1,2 @@\n+const x = 1', []]
  ]

  const CONTENTS: Record<string, string> = {
    // PR 内文件 import 了不可见目录里的模块 → 触发目录探查
    [PR_FILE]: "import {legacyHelper} from '@/legacy/helper'\nlegacyHelper()\n",
    // 探查回来的文件，才是真正引用被修改导出的地方
    [HIDDEN_DEP]:
      "import {hashPassword} from '../utils/hash'\nexport function legacyHelper(): string {\n  return hashPassword('x')\n}\n"
  }

  const makeContentFetcher = (): FileContentFetcher => ({
    getContent: jest
      .fn<FileContentFetcher['getContent']>()
      .mockImplementation(async (_o, _r, path) => CONTENTS[path as string] ?? null)
  })

  const makeLister = (): DirectoryLister => ({
    listDirectory: jest.fn<DirectoryLister['listDirectory']>().mockImplementation(async dir => {
      if (dir === 'src/legacy') return [HIDDEN_DEP]
      return []
    })
  })

  const run = async (recovery: any): Promise<any> =>
    analyzeDependencies(
      filesAndChanges,
      [PR_FILE], // 截断后的可见文件树
      FAKE_OPTIONS,
      NOOP_LIMIT,
      {owner: 'octo', repo: 'demo'},
      'sha',
      makeContentFetcher(),
      undefined,
      recovery
    )

  test('对照组：没有回填器时，不可见文件的引用彻底丢失', async () => {
    const ctx = await run({truncated: true})
    expect(ctx.fileAnalyses.get(MODIFIED)?.dependentFiles ?? []).not.toContain(HIDDEN_DEP)
  })

  test('接上回填器后，探查目录 → 文件进入候选 → 引用被找回', async () => {
    const lister = makeLister()
    const ctx = await run({truncated: true, dirLister: lister})

    const probed = (lister.listDirectory as any).mock.calls.map((c: any[]) => c[0])
    expect(probed).toContain('src/legacy')

    const analysis = ctx.fileAnalyses.get(MODIFIED)
    expect(analysis?.dependentFiles).toContain(HIDDEN_DEP)
    expect(analysis?.references.some((r: any) => r.symbolName === 'hashPassword')).toBe(true)
  })

  test('被修改文件本身不在截断树里时，靠 PR 文件补种而不是靠额外 API', async () => {
    const lister = makeLister()
    await run({truncated: true, dirLister: lister})
    // src/utils/hash.ts 是 PR 文件，零成本补种，不该为它单独探目录
    const probed = (lister.listDirectory as any).mock.calls.map((c: any[]) => c[0])
    expect(probed).not.toContain('src/utils')
  })

  test('目录预算用完后不再发探查请求', async () => {
    const lister = makeLister()
    await run({truncated: true, dirLister: lister, maxDirFetches: 1})
    expect((lister.listDirectory as any).mock.calls).toHaveLength(1)
  })

  test('探查失败不影响主流程（降级为解析不到，不抛错）', async () => {
    const lister: DirectoryLister = {
      listDirectory: jest
        .fn<DirectoryLister['listDirectory']>()
        .mockRejectedValue(new Error('403 Forbidden'))
    }
    const ctx = await run({truncated: true, dirLister: lister})
    expect(ctx.treeTruncated).toBe(true)
    expect(ctx.fileAnalyses.get(MODIFIED)?.dependentFiles ?? []).not.toContain(HIDDEN_DEP)
  })

  test('未截断时不做任何探查', async () => {
    const lister = makeLister()
    await run({truncated: false, dirLister: lister})
    expect((lister.listDirectory as any).mock.calls).toHaveLength(0)
  })
})
