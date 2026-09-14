/**
 * dep-analysis-platform-parity.test.ts — 跨文件依赖分析的两平台一致性（§14.1 TEST-032）
 *
 * TEST-032 要的是「候选、路径解析、排序和 `max_dependency_files` 在两平台一致」。
 * 既有 `dep-tree-consistency.test.ts` 覆盖的是这件事的**下半段**：它给两个平台喂
 * 同一份**已归一化**的 `{type, path}` 数组，再断言结果相同——那证明的是
 * `getRepoFileTree` 是确定性函数，而不是两个 adapter 归一化出了同一个东西。
 * 真正会发散的上半段（各自的原生 API 形态怎么变成那份数组）从来没被验过。
 *
 * 本文件补上半段，并把链路走到底：
 *
 *   GitHub  octokit.git.getTree → {data: {tree: [...], truncated}}
 *           条目带 mode/sha/size/url 噪声；子树查询返回的 path 是**相对该目录的**
 *   GitLab  Repositories.allRepositoryTrees → [...]（裸数组，无 truncated）
 *           条目带 id/name/mode；path 本来就是仓库根相对
 *
 * 同一个逻辑仓库分别按两种原生形态喂进**真实 adapter**，再跑真实的
 * `analyzeDependencies`，逐维度比对：候选集、路径解析、扫描顺序、截断结果。
 *
 * 关键前提：**两个平台返回条目的顺序不必相同**。各自 API 的遍历/排序规则不在
 * 我们的契约里（git 的树序把目录和文件按名字混排，GitLab 则是自己的排序），
 * 所以候选顺序必须由我们自己定死。否则 `max_dependency_files` 一截断，两个平台
 * 分析的就是**不同的文件集**——同一个 PR 在 GitHub 和 GitLab 上得到不同的审查
 * 结论，而且没有任何报错。所以下面的用例一律用**打乱过的**条目顺序。
 *
 * 不在本文件重复覆盖：
 *   dep-tree-consistency.test.ts   配置默认值一致（DEP-007）、纯函数行为
 *   repo-tree-platform-contract.test.ts  截断判定与空仓归一化（TEST-031）
 *   repo-tree-truncation.test.ts   截断状态透传与按需回填（DEP-004）
 */
import {describe, expect, test, beforeEach, jest} from '@jest/globals'

// ─── GitHub 出口 ─────────────────────────────────────────────────────────────
const octokitState: any = {git: {getTree: jest.fn<any>()}}
jest.mock('../src/octokit', () => ({octokit: octokitState}))

// ─── GitLab 出口 ────────────────────────────────────────────────────────────
const gitbeaker: any = {Repositories: {allRepositoryTrees: jest.fn<any>()}}
jest.mock('@gitbeaker/rest', () => ({Gitlab: jest.fn().mockImplementation(() => gitbeaker)}))

jest.mock('../src/platform/logger', () => ({
  getLogger: () => ({info: jest.fn(), warning: jest.fn(), error: jest.fn(), debug: jest.fn()}),
  setLogger: jest.fn()
}))

import {GitHubPlatform} from '../src/platform/github-platform'
import {GitLabPlatform} from '../src/platform/gitlab-platform'
import {
  getRepoFileTree,
  _resetTreeCache,
  type DirectoryLister,
  type TreeFetcher
} from '../src/repo-tree'
import {analyzeDependencies, type FileContentFetcher} from '../src/dependency-analyzer'
import {type Options} from '../src/options'
import {type IGitPlatform} from '../src/platform/git-platform'

const GITLAB_CONFIG = {
  host: 'https://gitlab.example.com',
  credential: {type: 'pat' as const, value: 'glpat-x'},
  timeoutMS: 30_000
}

// ─── 一个逻辑仓库 ───────────────────────────────────────────────────────────

/** PR 改的文件：导出了一个被多处引用的函数 */
const MODIFIED = 'src/utils/hash.ts'

/** 目录（两个平台都会把 tree 条目一起返回，必须都被过滤掉） */
const DIRS = ['src', 'src/api', 'src/utils', 'lib', 'src/数据']

/** blob：故意混入测试文件、非源码文件和 Unicode 路径 */
const BLOBS = [
  'src/api/login.ts',
  'src/api/logout.ts',
  'src/api/types.ts',
  'src/auth.ts',
  'src/auth.test.ts', // 测试文件，候选里必须被排除
  'src/utils/hash.ts',
  'src/utils/index.ts',
  'lib/legacy.js',
  'src/数据/模型.ts',
  'README.md' // 非源码，扩展名过滤掉
]

/** 每个文件的内容：谁 import 了 hash.ts 决定了依赖图长什么样 */
const CONTENTS: Record<string, string> = {
  [MODIFIED]: 'export function hashPassword(p: string): string {\n  return p\n}\n',
  'src/api/login.ts': "import {hashPassword} from '../utils/hash'\nhashPassword('a')\n",
  'src/api/logout.ts': "import {hashPassword} from '../utils/hash'\nhashPassword('b')\n",
  'src/api/types.ts': 'export type T = string\n',
  'src/auth.ts': "import {hashPassword} from './utils/hash'\nhashPassword('c')\n",
  'src/auth.test.ts': "import {hashPassword} from './utils/hash'\n",
  'src/utils/index.ts': "export * from './hash'\n",
  'lib/legacy.js': "const {hashPassword} = require('../src/utils/hash')\nhashPassword('d')\n",
  'src/数据/模型.ts': "import {hashPassword} from '../utils/hash'\nhashPassword('e')\n"
}

const PR_PATCH = '@@ -1 +1,3 @@\n+export function hashPassword(p: string): string {'
const FILES_AND_CHANGES: Array<[string, string, string, Array<[number, number, string]>]> = [
  [MODIFIED, CONTENTS[MODIFIED], PR_PATCH, []]
]

/**
 * 打乱过的条目顺序：两个平台故意不同。
 *
 * 这不是为了刁难实现——git 的树序和 GitLab 的排序本来就不保证一致，而我们的
 * 契约里从没规定过条目顺序。任何依赖「平台按什么顺序还给我」的下游行为都是
 * 在赌运气。
 */
const GITHUB_ORDER = [...DIRS, ...BLOBS]
const GITLAB_ORDER = [...BLOBS].reverse().concat([...DIRS].reverse())

/** GitHub Git Tree API 的原生返回：条目带一堆我们用不上的字段 */
function githubTreePayload(paths: string[], truncated = false): any {
  return {
    data: {
      tree: paths.map((p, i) => ({
        path: p,
        mode: DIRS.includes(p) ? '040000' : '100644',
        type: DIRS.includes(p) ? 'tree' : 'blob',
        sha: `sha-${i}`,
        size: DIRS.includes(p) ? undefined : 100 + i,
        url: `https://api.github.com/repos/o/r/git/blobs/sha-${i}`
      })),
      truncated
    }
  }
}

/** GitLab Repository Tree API 的原生返回：裸数组，没有 truncated 字段 */
function gitlabTreePayload(paths: string[]): any[] {
  return paths.map((p, i) => ({
    id: `id-${i}`,
    name: p.substring(p.lastIndexOf('/') + 1),
    type: DIRS.includes(p) ? 'tree' : 'blob',
    path: p,
    mode: DIRS.includes(p) ? '040000' : '100644'
  }))
}

/** 把 adapter 包成 repo-tree 要的 TreeFetcher（与 review.ts 的做法一致） */
function treeFetcherOf(platform: IGitPlatform): TreeFetcher {
  return {
    async getTree(owner, repo, ref) {
      return platform.listRepositoryTree(owner, repo, ref)
    }
  }
}

/** 记录取内容顺序的 fetcher——排序结果最终就体现在这个顺序上 */
function recordingContentFetcher(): FileContentFetcher & {order: string[]} {
  const order: string[] = []
  return {
    order,
    async getContent(_o: string, _r: string, path: string) {
      order.push(path)
      return CONTENTS[path] ?? null
    }
  } as FileContentFetcher & {order: string[]}
}

const NOOP_LIMIT = ((fn: any) => fn()) as any

function optionsWith(maxDependencyFiles: number): Options {
  return {maxDependencyFiles, pathFilters: {check: () => true}} as unknown as Options
}

/** 跑完整链路：真 adapter → getRepoFileTree → analyzeDependencies */
async function runPipeline(
  which: 'github' | 'gitlab',
  maxDependencyFiles = 50
): Promise<{files: string[]; scanned: string[]; dependents: string[]}> {
  _resetTreeCache()
  const platform: IGitPlatform =
    which === 'github' ? new GitHubPlatform() : new GitLabPlatform(GITLAB_CONFIG)

  const {files, truncated} = await getRepoFileTree(
    'head-sha',
    {platform: which, owner: 'octo', repo: 'demo'},
    treeFetcherOf(platform)
  )

  const content = recordingContentFetcher()
  const ctx = await analyzeDependencies(
    FILES_AND_CHANGES,
    files,
    optionsWith(maxDependencyFiles),
    NOOP_LIMIT,
    {owner: 'octo', repo: 'demo'},
    'head-sha',
    content,
    undefined,
    {truncated}
  )

  return {
    files,
    scanned: content.order,
    dependents: ctx.fileAnalyses.get(MODIFIED)?.dependentFiles ?? []
  }
}

describe('跨文件依赖分析的两平台一致性（TEST-032）', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    _resetTreeCache()
    octokitState.git.getTree.mockResolvedValue(githubTreePayload(GITHUB_ORDER))
    gitbeaker.Repositories.allRepositoryTrees.mockResolvedValue(gitlabTreePayload(GITLAB_ORDER))
  })

  // ─── 1. 原生形态 → 同一份文件列表 ─────────────────────────────────────────

  describe('归一化：两种原生 API 形态收敛到同一个文件集合', () => {
    test('两平台得到同一批文件（tree 条目和噪声字段都被剥掉）', async () => {
      const gh = await runPipeline('github')
      const gl = await runPipeline('gitlab')

      // 顺序此刻不比——那是下一组用例的事；这里先确认集合本身一致
      expect(new Set(gh.files)).toEqual(new Set(gl.files))
      expect(new Set(gh.files)).toEqual(new Set(BLOBS))
      for (const dir of DIRS) {
        expect(gh.files).not.toContain(dir)
        expect(gl.files).not.toContain(dir)
      }
    })

    test('Unicode 路径两平台都原样保留', async () => {
      const gh = await runPipeline('github')
      const gl = await runPipeline('gitlab')

      expect(gh.files).toContain('src/数据/模型.ts')
      expect(gl.files).toContain('src/数据/模型.ts')
    })
  })

  // ─── 2. 候选集 ──────────────────────────────────────────────────────────────

  describe('候选集：同一逻辑仓库产生同一批依赖', () => {
    test('两平台解析出完全相同的依赖文件（含顺序）', async () => {
      const gh = await runPipeline('github')
      const gl = await runPipeline('gitlab')

      expect(gh.dependents).toEqual(gl.dependents)
      // 不是空跑：hash.ts 确实被这些文件引用到了
      expect(gh.dependents).toEqual(
        expect.arrayContaining(['src/api/login.ts', 'src/auth.ts', 'lib/legacy.js'])
      )
    })

    test('测试文件与非源码文件在两平台都被排除', async () => {
      const gh = await runPipeline('github')
      const gl = await runPipeline('gitlab')

      for (const r of [gh, gl]) {
        expect(r.scanned).not.toContain('src/auth.test.ts')
        expect(r.scanned).not.toContain('README.md')
        // PR 自己改的文件不重复进候选
        expect(r.scanned).not.toContain(MODIFIED)
      }
    })
  })

  // ─── 3. 路径解析 ────────────────────────────────────────────────────────────

  describe('路径解析：各种 import 形态在两平台解析到同一文件', () => {
    test('../ 相对路径、同级路径、require 都能解析到 hash.ts', async () => {
      const gh = await runPipeline('github')
      const gl = await runPipeline('gitlab')

      // src/api/login.ts 用 '../utils/hash'；src/auth.ts 用 './utils/hash'；
      // lib/legacy.js 用 require('../src/utils/hash')——三种形态都要落到同一个文件
      for (const dep of ['src/api/login.ts', 'src/auth.ts', 'lib/legacy.js']) {
        expect(gh.dependents).toContain(dep)
        expect(gl.dependents).toContain(dep)
      }
    })

    test('Unicode 目录下的文件也能解析出依赖，两平台一致', async () => {
      const gh = await runPipeline('github')
      const gl = await runPipeline('gitlab')

      expect(gh.dependents).toContain('src/数据/模型.ts')
      expect(gl.dependents).toContain('src/数据/模型.ts')
    })
  })

  // ─── 4. 排序 ────────────────────────────────────────────────────────────────

  describe('排序：候选扫描顺序不得随平台的条目顺序漂移', () => {
    /**
     * 这是本文件的核心。`sortByProximity` 只按「同目录 / 同父目录 / 其他」打三档
     * 分，同档内靠 `Array#sort` 的稳定性保持**输入顺序**——而输入顺序就是平台
     * 还回来的条目顺序。两个平台顺序不同，同分的候选就会排出不同的次序。
     *
     * 不截断时这只是「扫描顺序不同」，结果还一样；一旦
     * `max_dependency_files` 生效（见下一组），差异就落到了「分析了哪些文件」上。
     */
    test('两平台的候选扫描顺序完全一致', async () => {
      const gh = await runPipeline('github')
      const gl = await runPipeline('gitlab')

      expect(gh.scanned).toEqual(gl.scanned)
    })

    test('同目录优先仍然成立（排序规则本身没被削弱）', async () => {
      const gh = await runPipeline('github')

      // 修改的是 src/utils/hash.ts，同目录的 src/utils/index.ts 必须排在最前
      expect(gh.scanned[0]).toBe('src/utils/index.ts')
    })
  })

  // ─── 5. max_dependency_files ────────────────────────────────────────────────

  describe('max_dependency_files：截断到同一批文件，而不只是同样的数量', () => {
    test('上限为 2 时，两平台分析的是同一批文件', async () => {
      const gh = await runPipeline('github', 2)
      const gl = await runPipeline('gitlab', 2)

      expect(gh.scanned).toHaveLength(2)
      // 只比数量是不够的：数量相同、内容不同，正是最难发现的那种发散——
      // 同一个 PR 在两个平台上得到不同的审查结论，且不报任何错
      expect(gh.scanned).toEqual(gl.scanned)
    })

    test('上限为 1 时同样一致（最容易暴露排序分歧的边界）', async () => {
      const gh = await runPipeline('github', 1)
      const gl = await runPipeline('gitlab', 1)

      expect(gh.scanned).toEqual(gl.scanned)
      expect(gh.scanned).toHaveLength(1)
    })

    test('上限大于候选数时不截断，两平台仍一致', async () => {
      const gh = await runPipeline('github', 999)
      const gl = await runPipeline('gitlab', 999)

      expect(gh.scanned).toEqual(gl.scanned)
      expect(gh.scanned.length).toBeGreaterThan(2)
    })

    test('截断后的依赖结论也一致（不是只有扫描列表一致）', async () => {
      const gh = await runPipeline('github', 2)
      const gl = await runPipeline('gitlab', 2)

      expect(gh.dependents).toEqual(gl.dependents)
    })
  })

  // ─── 6. 目录回填的路径归一化 ────────────────────────────────────────────────

  describe('按需回填：子树路径的归一化差异不得漏到候选里', () => {
    /**
     * 这是两平台形态差异最大的一处：GitHub 的子树查询返回**相对该目录**的 path
     * （`hash.ts`），GitLab 返回的是根相对 path（`src/utils/hash.ts`）。
     * GitHub adapter 负责把前缀补回来——补漏了的话，回填出来的候选路径与全量树
     * 的路径对不上，`resolveImportPath` 会把它们当成「仓库里没有这个文件」。
     */
    test('两平台的目录回填结果是同一批根相对路径', async () => {
      const gh = new GitHubPlatform()
      const gl = new GitLabPlatform(GITLAB_CONFIG)

      // GitHub 子树：path 相对 src/utils
      octokitState.git.getTree.mockResolvedValue({
        data: {
          tree: [
            {type: 'blob', path: 'hash.ts'},
            {type: 'blob', path: 'index.ts'},
            {type: 'tree', path: 'nested'}
          ],
          truncated: false
        }
      })
      // GitLab 子树：path 本来就是根相对
      gitbeaker.Repositories.allRepositoryTrees.mockResolvedValue([
        {type: 'blob', path: 'src/utils/hash.ts'},
        {type: 'blob', path: 'src/utils/index.ts'},
        {type: 'tree', path: 'src/utils/nested'}
      ])

      const listerOf = (p: IGitPlatform): DirectoryLister => ({
        async listDirectory(dirPath) {
          const r = await p.listRepositoryTree('octo', 'demo', 'head-sha', dirPath)
          return {
            files: r.entries
              .filter(e => e.type === 'blob' && e.path != null)
              .map(e => e.path as string),
            truncated: r.truncated
          }
        }
      })

      const ghListing = await listerOf(gh).listDirectory('src/utils')
      const glListing = await listerOf(gl).listDirectory('src/utils')

      expect(ghListing.files).toEqual(glListing.files)
      expect(ghListing.files).toEqual(['src/utils/hash.ts', 'src/utils/index.ts'])
    })
  })
})
