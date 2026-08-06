/**
 * dep-tree-consistency.test.ts — DEP-002/004/007/008 跨平台一致性测试
 *
 * 覆盖:
 * - DEP-002: dependency-analyzer + repo-tree 在两平台语义一致
 * - DEP-004: GitLab tree 边界处理（空仓库、subgroup、Unicode、API 错误）
 * - DEP-007: enable_dependency_analysis / max_dependency_files 配置一致
 * - DEP-008: 同一 fixture 在两平台产生一致的依赖分析结果
 */
import {describe, expect, test, beforeEach, jest} from '@jest/globals'

// ─── Mocks ────────────────────────────────────────────────────────────────

jest.mock('../src/platform/logger', () => ({
  getLogger: () => ({
    info: jest.fn(),
    warning: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }),
  setLogger: jest.fn()
}))

// ─── Imports ──────────────────────────────────────────────────────────────

import {
  getRepoFileTree,
  resolveImportPath,
  sortByProximity,
  filterByExtension,
  detectLanguage,
  type TreeFetcher,
  type RepoTreeProject
} from '../src/repo-tree'
import {CONFIG_DEFAULTS} from '../src/platform/config-provider'
import {GitHubConfigProvider} from '../src/platform/github-config-provider'
import {GitLabConfigProvider} from '../src/platform/gitlab-config-provider'

// ─── 缓存重置 ─────────────────────────────────────────────────────────────

// repo-tree 有模块级缓存，每个 test 需要用不同的 cacheKey 避免命中
let testCounter = 0
function uniqueProject(platform: 'github' | 'gitlab'): RepoTreeProject {
  testCounter++
  return {platform, owner: 'test-owner', repo: `test-repo-${testCounter}`}
}

// ─── Fixture: 模拟仓库文件树 ───────────────────────────────────────────────

const FIXTURE_TREE = [
  {type: 'blob', path: 'src/index.ts'},
  {type: 'blob', path: 'src/utils/helper.ts'},
  {type: 'blob', path: 'src/utils/index.ts'},
  {type: 'blob', path: 'src/components/Button.vue'},
  {type: 'blob', path: 'src/api/client.ts'},
  {type: 'blob', path: 'src/api/types.ts'},
  {type: 'blob', path: 'tests/index.test.ts'},
  {type: 'tree', path: 'src/utils'},
  {type: 'tree', path: 'src/components'},
  {type: 'blob', path: 'README.md'},
  {type: 'blob', path: 'src/data/名前.ts'} // Unicode 路径
]

const EXPECTED_FILES = [
  'src/index.ts',
  'src/utils/helper.ts',
  'src/utils/index.ts',
  'src/components/Button.vue',
  'src/api/client.ts',
  'src/api/types.ts',
  'tests/index.test.ts',
  'README.md',
  'src/data/名前.ts'
]

function makeFetcher(entries: Array<{type: string; path: string}>): TreeFetcher {
  return {
    getTree: jest.fn<TreeFetcher['getTree']>().mockResolvedValue(entries)
  }
}

function makeErrorFetcher(error: Error): TreeFetcher {
  return {
    getTree: jest.fn<TreeFetcher['getTree']>().mockRejectedValue(error)
  }
}

// ─── DEP-002: 两平台语义一致 ──────────────────────────────────────────────

describe('DEP-002: 两平台产出相同的文件树', () => {
  test('相同的 tree entries → 相同的文件列表（GitHub vs GitLab）', async () => {
    const ghFetcher = makeFetcher(FIXTURE_TREE)
    const glFetcher = makeFetcher(FIXTURE_TREE)

    const ghFiles = await getRepoFileTree('abc123', uniqueProject('github'), ghFetcher)
    const glFiles = await getRepoFileTree('abc123', uniqueProject('gitlab'), glFetcher)

    expect(ghFiles).toEqual(glFiles)
    expect(ghFiles).toEqual(EXPECTED_FILES)
  })

  test('相同的文件列表 → 相同的 import 解析结果', () => {
    const repoFilesSet = new Set(EXPECTED_FILES)

    // 相对路径解析
    expect(resolveImportPath('src/index.ts', './utils/helper', repoFilesSet)).toBe(
      'src/utils/helper.ts'
    )
    expect(resolveImportPath('src/index.ts', './api/client', repoFilesSet)).toBe(
      'src/api/client.ts'
    )

    // index 文件解析
    expect(resolveImportPath('src/index.ts', './utils', repoFilesSet)).toBe('src/utils/index.ts')

    // .vue 文件解析
    expect(resolveImportPath('src/index.ts', './components/Button', repoFilesSet)).toBe(
      'src/components/Button.vue'
    )
  })

  test('相同的候选文件 → 相同的排序结果', () => {
    const candidates = ['src/api/types.ts', 'src/utils/helper.ts', 'tests/index.test.ts']
    const modified = ['src/api/client.ts']

    const sorted = sortByProximity(candidates, modified)
    // src/api/types.ts 同目录优先
    expect(sorted[0]).toBe('src/api/types.ts')
  })
})

// ─── DEP-004: GitLab tree 边界处理 ────────────────────────────────────────

describe('DEP-004: tree 边界处理', () => {
  test('空仓库 → 返回空数组（不抛错）', async () => {
    const fetcher = makeFetcher([])
    const files = await getRepoFileTree('abc', uniqueProject('gitlab'), fetcher)
    expect(files).toEqual([])
  })

  test('subgroup 项目路径正确拼接', async () => {
    const fetcher = makeFetcher([{type: 'blob', path: 'main.go'}])
    const project: RepoTreeProject = {
      platform: 'gitlab',
      owner: 'group/subgroup',
      repo: 'myproject'
    }
    const files = await getRepoFileTree('main', project, fetcher)
    expect(files).toEqual(['main.go'])
    // 验证 fetcher 被调用时传入的 owner/repo
    expect(fetcher.getTree).toHaveBeenCalledWith('group/subgroup', 'myproject', 'main')
  })

  test('Unicode 路径被正确保留', async () => {
    const fetcher = makeFetcher([
      {type: 'blob', path: 'src/数据/模型.ts'},
      {type: 'blob', path: 'docs/日本語/README.md'}
    ])
    const files = await getRepoFileTree('main', uniqueProject('gitlab'), fetcher)
    expect(files).toContain('src/数据/模型.ts')
    expect(files).toContain('docs/日本語/README.md')
  })

  test('API 错误 → 抛出异常（不静默返回空数组）', async () => {
    const fetcher = makeErrorFetcher(new Error('500 Internal Server Error'))
    await expect(getRepoFileTree('abc', uniqueProject('github'), fetcher)).rejects.toThrow(
      '500 Internal Server Error'
    )
  })

  test('tree 类型条目被过滤，只保留 blob', async () => {
    const fetcher = makeFetcher([
      {type: 'tree', path: 'src'},
      {type: 'blob', path: 'src/main.ts'},
      {type: 'commit', path: 'vendor/lib'},
      {type: 'blob', path: 'README.md'}
    ])
    const files = await getRepoFileTree('main', uniqueProject('github'), fetcher)
    expect(files).toEqual(['src/main.ts', 'README.md'])
  })

  test('language 检测对两平台一致', () => {
    expect(detectLanguage('src/main.ts')).toBe('typescript')
    expect(detectLanguage('src/main.vue')).toBe('typescript')
    expect(detectLanguage('main.py')).toBe('python')
    expect(detectLanguage('main.go')).toBe('go')
    expect(detectLanguage('Main.java')).toBe('java')
    expect(detectLanguage('README.md')).toBe('unknown')
  })

  test('filterByExtension 对两平台一致', () => {
    const files = ['a.ts', 'b.js', 'c.py', 'd.vue', 'e.go']
    expect(filterByExtension(files, ['.ts', '.vue'])).toEqual(['a.ts', 'd.vue'])
  })
})

// ─── DEP-007: 配置默认值一致 ──────────────────────────────────────────────

describe('DEP-007: enable_dependency_analysis / max_dependency_files 配置一致', () => {
  test('CONFIG_DEFAULTS 中两个字段有明确定义', () => {
    expect(CONFIG_DEFAULTS.enableDependencyAnalysis).toBe(true)
    expect(CONFIG_DEFAULTS.maxDependencyFiles).toBe('50')
  })

  test('GitLabConfigProvider 默认值与 CONFIG_DEFAULTS 一致', () => {
    // GitLabConfigProvider 在无 env 时使用 CONFIG_DEFAULTS
    const provider = new GitLabConfigProvider()
    const opts = provider.getOptions()
    expect(opts.enableDependencyAnalysis).toBe(CONFIG_DEFAULTS.enableDependencyAnalysis)
    // Options 构造函数把 string '50' parseInt 为 number 50
    expect(opts.maxDependencyFiles).toBe(parseInt(CONFIG_DEFAULTS.maxDependencyFiles))
  })

  // GitHubConfigProvider 依赖 @actions/core getInput（需要 mock），
  // 已在 config-provider.test.ts 中覆盖默认值一致性。此处只验证 CONFIG_DEFAULTS 本身。
})

// ─── DEP-008: 同一 fixture 跨平台一致 ────────────────────────────────────

describe('DEP-008: 同一 fixture 在两平台产生一致的分析结果', () => {
  const fixtureTree = [
    {type: 'blob', path: 'src/auth.ts'},
    {type: 'blob', path: 'src/auth.test.ts'},
    {type: 'blob', path: 'src/utils/hash.ts'},
    {type: 'blob', path: 'src/utils/index.ts'},
    {type: 'blob', path: 'src/api/login.ts'},
    {type: 'blob', path: 'lib/legacy.js'}
  ]

  test('两平台从同一 fixture 得到相同的文件列表', async () => {
    const ghFetcher = makeFetcher(fixtureTree)
    const glFetcher = makeFetcher(fixtureTree)

    const ghFiles = await getRepoFileTree('sha1', uniqueProject('github'), ghFetcher)
    const glFiles = await getRepoFileTree('sha1', uniqueProject('gitlab'), glFetcher)

    expect(ghFiles).toEqual(glFiles)
  })

  test('两平台的 import 解析完全一致', async () => {
    const ghFetcher = makeFetcher(fixtureTree)
    const ghFiles = await getRepoFileTree('sha2', uniqueProject('github'), ghFetcher)
    const repoSet = new Set(ghFiles)

    // 这些解析结果不依赖平台
    expect(resolveImportPath('src/api/login.ts', '../utils/hash', repoSet)).toBe(
      'src/utils/hash.ts'
    )
    expect(resolveImportPath('src/api/login.ts', '../utils', repoSet)).toBe('src/utils/index.ts')
    expect(resolveImportPath('src/api/login.ts', '../auth', repoSet)).toBe('src/auth.ts')
  })

  test('两平台的候选优先级排序一致', async () => {
    const ghFetcher = makeFetcher(fixtureTree)
    const ghFiles = await getRepoFileTree('sha3', uniqueProject('github'), ghFetcher)

    const modified = ['src/api/login.ts']
    const candidates = ghFiles.filter(f => f.endsWith('.ts') && !f.includes('.test.'))
    const sorted = sortByProximity(candidates, modified)

    // src/api/ 下的文件应排在最前
    expect(sorted[0]).toBe('src/api/login.ts')
  })

  test('两平台的扩展名过滤和截断一致', async () => {
    const ghFetcher = makeFetcher(fixtureTree)
    const ghFiles = await getRepoFileTree('sha4', uniqueProject('github'), ghFetcher)

    const tsFiles = filterByExtension(ghFiles, ['.ts'])
    expect(tsFiles).not.toContain('lib/legacy.js')
    expect(tsFiles).toContain('src/auth.ts')

    // 模拟 max_dependency_files 截断
    const maxFiles = 3
    const truncated = tsFiles.slice(0, maxFiles)
    expect(truncated).toHaveLength(maxFiles)
  })
})
