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

import {getRepoFileTree, type RepoTreeProject, type TreeFetcher} from '../src/repo-tree'
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

const FAKE_OPTIONS = {maxDependencyFiles: 50} as Options
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
      true
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
      true
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
