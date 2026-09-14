/**
 * lint-report-cli.integration.test.ts — lint-only 执行器的成功路径（LINT-004）
 *
 * 单元测试只覆盖了参数校验、diff 切分和 workflow 结构；那些都绕过了「CLI 在真实
 * 仓库上跑一遍并产出非空 finding」这条主路径。功能是否真的恢复，取决于这条路径。
 *
 * 这里建真实临时 git 仓库、造两个 commit，跑 `run()`：
 * - orchestrator 被替换成确定性桩，捕获它实际收到的 filesAndChanges；
 *   真实工具的可用性依赖机器环境（npm、网络），不适合作为断言基础
 * - git 本身不打桩——`base...head` 的三点语义、fork 落后/分叉场景正是要验证的部分
 */
import {describe, expect, test, jest, beforeEach, afterAll} from '@jest/globals'
import {execFileSync} from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

/** 捕获 orchestrator 的真实入参，并返回一份确定性报告 */
const lintState = {
  received: [] as any[],
  report: {
    results: [] as any[],
    toolSummaries: [] as any[],
    durationMs: 7,
    filesScanned: 0
  }
}
jest.mock('../src/lint', () => ({
  runLintTools: async (options: any) => {
    lintState.received.push(options)
    return {...lintState.report, filesScanned: options.filesAndChanges.length}
  }
}))

jest.mock('../src/platform/logger', () => ({
  getLogger: () => ({info: jest.fn(), warning: jest.fn(), error: jest.fn(), debug: jest.fn()})
}))

import {hasMergeBase, run} from '../src/lint-report-cli'

const tmpDirs: string[] = []

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], {encoding: 'utf8'})
}

/** 建一个带初始提交的临时仓库 */
function makeRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-cli-'))
  tmpDirs.push(dir)
  // 显式指定初始分支：git 的默认值随版本/配置变化（master vs main），
  // 硬编码任一个都会让测试在别人机器上挂掉
  git(dir, ['init', '-q', '--initial-branch=main', '.'])
  git(dir, ['config', 'user.email', 'test@example.com'])
  git(dir, ['config', 'user.name', 'test'])
  git(dir, ['config', 'commit.gpgsign', 'false'])
  return dir
}

function commit(dir: string, files: Record<string, string>, message: string): string {
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(dir, name)
    fs.mkdirSync(path.dirname(target), {recursive: true})
    fs.writeFileSync(target, content, 'utf8')
  }
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-q', '-m', message])
  return git(dir, ['rev-parse', 'HEAD']).trim()
}

function readReport(file: string): any {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

beforeEach(() => {
  lintState.received = []
  lintState.report = {results: [], toolSummaries: [], durationMs: 7, filesScanned: 0}
})

afterAll(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, {recursive: true, force: true})
})

describe('成功路径：真实仓库 → 变更文件 → 非空报告', () => {
  test('把 base...head 的变更文件与 hunk 交给 orchestrator，并写出非空 finding', async () => {
    const repo = makeRepo()
    const base = commit(repo, {'src/a.ts': 'const a = 1\n', 'src/keep.ts': 'const k = 1\n'}, 'base')
    const head = commit(
      repo,
      {'src/a.ts': 'const a = 1\nconst added = 2\n', 'docs/new.md': '# new\n'},
      'head'
    )

    lintState.report.results = [
      {
        tool: 'eslint',
        toolVersion: '9.15.0',
        file: 'src/a.ts',
        line: 2,
        column: 7,
        severity: 'error',
        ruleId: 'no-unused-vars',
        message: "'added' is assigned a value but never used",
        fixable: false
      }
    ]

    const out = path.join(repo, 'report.json')
    await run(['--repo-root', repo, '--base-sha', base, '--head-sha', head, '--out', out])

    // 1) orchestrator 收到的是变更文件，且未变更的文件不在其中
    expect(lintState.received).toHaveLength(1)
    const files = lintState.received[0].filesAndChanges.map((f: any[]) => f[0]).sort()
    expect(files).toEqual(['docs/new.md', 'src/a.ts'])
    expect(files).not.toContain('src/keep.ts')

    // 2) hunk 内容确实传下去了（lint 的变更行过滤依赖它）
    const aDiff = lintState.received[0].filesAndChanges.find((f: any[]) => f[0] === 'src/a.ts')[2]
    expect(aDiff.startsWith('@@')).toBe(true)
    expect(aDiff).toContain('+const added = 2')

    // 3) repoRoot 指向被扫描仓库，而不是可信 checkout
    //（macOS 上 /tmp 是 /private/tmp 的符号链接，比较末段即可）
    expect(lintState.received[0].repoRoot).toContain(path.basename(repo))

    // 4) 报告落盘且非空
    const report = readReport(out)
    expect(report.results).toHaveLength(1)
    expect(report.results[0].file).toBe('src/a.ts')
    expect(report.filesScanned).toBe(2)
  })

  test('--tools 显式指定时透传为 enable override', async () => {
    const repo = makeRepo()
    const base = commit(repo, {'a.ts': 'const a = 1\n'}, 'base')
    const head = commit(repo, {'a.ts': 'const a = 2\n'}, 'head')

    const out = path.join(repo, 'report.json')
    await run([
      '--repo-root',
      repo,
      '--base-sha',
      base,
      '--head-sha',
      head,
      '--out',
      out,
      '--tools',
      'eslint, tsc'
    ])

    expect(lintState.received[0].toolEnableOverrides).toEqual({eslint: true, tsc: true})
  })
})

describe('fork 落后 / 分叉于最新 base', () => {
  test('base 在 fork 之后继续前进时，只报告 PR 自己的改动（三点 diff 语义）', async () => {
    const repo = makeRepo()
    const forkPoint = commit(repo, {'shared.ts': 'const s = 1\n'}, 'fork point')

    // PR 分支：只改 pr.ts
    git(repo, ['checkout', '-q', '-b', 'pr-branch'])
    const head = commit(repo, {'pr.ts': 'const p = 1\n'}, 'pr change')

    // base 分支在 fork 之后又前进了：改 base-only.ts
    git(repo, ['checkout', '-q', 'main'])
    const baseAdvanced = commit(repo, {'base-only.ts': 'const b = 1\n'}, 'base moved on')
    expect(baseAdvanced).not.toBe(forkPoint)

    const out = path.join(repo, 'report.json')
    await run(['--repo-root', repo, '--base-sha', baseAdvanced, '--head-sha', head, '--out', out])

    const files = lintState.received[0].filesAndChanges.map((f: any[]) => f[0])
    // base 上的新文件不属于本 PR 的改动，不该被扫
    expect(files).toEqual(['pr.ts'])
    expect(files).not.toContain('base-only.ts')
  })

  test('head 与 base 相同 → 空报告，不调用 orchestrator', async () => {
    const repo = makeRepo()
    const sha = commit(repo, {'a.ts': 'const a = 1\n'}, 'only')

    const out = path.join(repo, 'report.json')
    await run(['--repo-root', repo, '--base-sha', sha, '--head-sha', sha, '--out', out])

    expect(lintState.received).toHaveLength(0)
    expect(readReport(out)).toEqual({
      results: [],
      toolSummaries: [],
      durationMs: 0,
      filesScanned: 0
    })
  })
})

describe('浅历史：按 workflow 真实形态模拟独立 fork checkout', () => {
  /**
   * 复刻 workflow 的实际拓扑：
   *   upstream 仓库  ← base 在 fork 点之后继续前进
   *   fork clone     ← PR head 所在，base 需要单独 fetch 回来
   *
   * 早先 workflow 用 `git fetch --depth=1 <upstream> <base>` 把 base 取回来，
   * 那会把仓库标成浅的，`git diff base...head` 直接报 no merge base，
   * CLI 降级为空报告——lint 静默失效。上面那个「单仓库完整历史」的用例
   * 覆盖不到这个形态，所以单独建一组。
   */
  /** 本地路径 clone/fetch 会绕过传输协议直接硬链对象库，必须用 file:// */
  function upstreamUrl(dir: string): string {
    return `file://${fs.realpathSync(dir)}`
  }

  function makeUpstreamAndFork(): {
    upstream: string
    fork: string
    baseSha: string
    headSha: string
  } {
    const upstream = makeRepo()
    commit(upstream, {'shared.ts': 'const s = 1\n'}, 'fork point')

    // PR 分支：只改 pr.ts
    git(upstream, ['checkout', '-q', '-b', 'pr-branch'])
    const headSha = commit(upstream, {'pr.ts': 'const p = 1\n'}, 'pr change')

    // base 继续前进
    git(upstream, ['checkout', '-q', 'main'])
    const baseSha = commit(upstream, {'base-only.ts': 'const b = 1\n'}, 'base moved on')

    // fork：**只**克隆 PR 分支。必须带 --single-branch——默认 clone 会把
    // upstream 所有分支的对象一起拿来，base 就已经在历史里了，那样这一组
    // 用例全都变成假通过（merge-base 本来就成立，根本没验证到 fetch 逻辑）
    const fork = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-fork-'))
    tmpDirs.push(fork)
    // 用 file:// 而非本地路径：本地路径 clone 会直接硬链整个对象库，
    // base 的对象照样在，--single-branch 形同虚设；file:// 才走真实传输协议
    execFileSync('git', [
      'clone',
      '-q',
      '--single-branch',
      '--branch',
      'pr-branch',
      upstreamUrl(upstream),
      fork
    ])
    git(fork, ['config', 'user.email', 'test@example.com'])
    git(fork, ['config', 'user.name', 'test'])

    return {upstream, fork, baseSha, headSha}
  }

  test('浅 fetch（--depth=1）取回 base → 报告为空，且降级原因点名 merge base', async () => {
    const {upstream, fork, baseSha, headSha} = makeUpstreamAndFork()
    git(fork, ['fetch', '-q', '--no-tags', '--depth=1', upstreamUrl(upstream), baseSha])

    const out = path.join(fork, 'report.json')
    await run(['--repo-root', fork, '--base-sha', baseSha, '--head-sha', headSha, '--out', out])

    // 这是「静默失效」的形态：结构合法但内容为空
    expect(readReport(out).results).toEqual([])
    expect(lintState.received).toHaveLength(0)
    // 关键：CLI 必须能识别出这是 merge base 缺失，而不是笼统的 git 失败
    expect(hasMergeBase(fork, baseSha, headSha)).toBe(false)
  })

  test('完整 fetch 取回 base → merge base 成立，只扫 PR 自己的改动', async () => {
    const {upstream, fork, baseSha, headSha} = makeUpstreamAndFork()
    // 对应修复后的 workflow：不带 --depth
    git(fork, ['fetch', '-q', '--no-tags', upstreamUrl(upstream), baseSha])

    expect(hasMergeBase(fork, baseSha, headSha)).toBe(true)

    const out = path.join(fork, 'report.json')
    await run(['--repo-root', fork, '--base-sha', baseSha, '--head-sha', headSha, '--out', out])

    const files = lintState.received[0].filesAndChanges.map((f: any[]) => f[0])
    expect(files).toEqual(['pr.ts'])
    expect(files).not.toContain('base-only.ts')
  })

  test('浅仓库经 deepen 后恢复（workflow 的兜底路径）', async () => {
    const {upstream, fork, baseSha, headSha} = makeUpstreamAndFork()
    git(fork, ['fetch', '-q', '--no-tags', '--depth=1', upstreamUrl(upstream), baseSha])
    expect(hasMergeBase(fork, baseSha, headSha)).toBe(false)

    // workflow 在 merge-base 失败后会先 unshallow 再逐步 deepen
    if (git(fork, ['rev-parse', '--is-shallow-repository']).trim() === 'true') {
      git(fork, ['fetch', '-q', '--unshallow', upstreamUrl(upstream)])
    }
    git(fork, ['fetch', '-q', '--no-tags', upstreamUrl(upstream), baseSha])

    expect(hasMergeBase(fork, baseSha, headSha)).toBe(true)
  })

  test('同仓库 PR：base 已在历史里，无需 fetch 即可 diff（私有仓库同样成立）', async () => {
    // 非 fork 的 PR，base 与 head 在同一个仓库里——这条路径不依赖任何网络访问，
    // 因此不受仓库可见性影响
    const repo = makeRepo()
    commit(repo, {'shared.ts': 'const s = 1\n'}, 'fork point')
    git(repo, ['checkout', '-q', '-b', 'pr-branch'])
    const headSha = commit(repo, {'pr.ts': 'const p = 1\n'}, 'pr change')
    git(repo, ['checkout', '-q', 'main'])
    const baseSha = commit(repo, {'base-only.ts': 'const b = 1\n'}, 'base moved on')

    expect(hasMergeBase(repo, baseSha, headSha)).toBe(true)

    const out = path.join(repo, 'report.json')
    await run(['--repo-root', repo, '--base-sha', baseSha, '--head-sha', headSha, '--out', out])

    expect(lintState.received[0].filesAndChanges.map((f: any[]) => f[0])).toEqual(['pr.ts'])
  })

  test('私有仓库 fork：匿名取不到 base → 报告为空，降级原因可定位', async () => {
    // 完全不 fetch，等价于「匿名访问被拒、base 始终取不到」
    const {fork, baseSha, headSha} = makeUpstreamAndFork()

    expect(hasMergeBase(fork, baseSha, headSha)).toBe(false)

    const out = path.join(fork, 'report.json')
    await run(['--repo-root', fork, '--base-sha', baseSha, '--head-sha', headSha, '--out', out])

    expect(readReport(out).results).toEqual([])
    expect(lintState.received).toHaveLength(0)
  })

  test('私有仓库跨 fork：base fetch 带认证，且不落到工作区', () => {
    const wf = fs.readFileSync(
      path.resolve(__dirname, '../.github/workflows/openai-review.yml'),
      'utf8'
    )
    // 匿名 fetch 对私有仓库取不到 base，必须带只读 token
    expect(wf).toContain('http.extraheader')
    expect(wf).toContain('x-access-token')
    // -c 内联传头，不写进 .git/config
    expect(wf).toContain('git -c http.extraheader=')
    expect(wf).not.toMatch(/git config .*extraheader/)
    // 同仓库 PR 的短路分支必须在 fetch 之前
    const shortCircuit = wf.indexOf('merge base already reachable')
    const authFetch = wf.indexOf('git -c http.extraheader=')
    expect(shortCircuit).toBeGreaterThan(-1)
    expect(shortCircuit).toBeLessThan(authFetch)
  })

  test('workflow 不再使用 --depth=1 取 base，且带 merge-base 校验', () => {
    const wf = fs.readFileSync(
      path.resolve(__dirname, '../.github/workflows/openai-review.yml'),
      'utf8'
    )
    const code = wf
      .split('\n')
      .filter(line => !line.trim().startsWith('#'))
      .join('\n')

    expect(code).not.toContain('--depth=1')
    expect(code).toContain('git merge-base')
    expect(code).toContain('--unshallow')
    expect(code).toContain('--deepen')
  })
})

describe('失败路径：始终产出合法报告并成功返回', () => {
  test('commit 在 checkout 后不存在 → 空报告，不调用 orchestrator', async () => {
    const repo = makeRepo()
    const head = commit(repo, {'a.ts': 'x\n'}, 'only')
    const missing = '0'.repeat(40)

    const out = path.join(repo, 'report.json')
    await run(['--repo-root', repo, '--base-sha', missing, '--head-sha', head, '--out', out])

    expect(lintState.received).toHaveLength(0)
    expect(readReport(out).results).toEqual([])
  })

  test('repo-root 不存在 → 空报告', async () => {
    const repo = makeRepo()
    const out = path.join(repo, 'report.json')
    await run([
      '--repo-root',
      path.join(repo, 'nope'),
      '--base-sha',
      '0'.repeat(40),
      '--head-sha',
      '1'.repeat(40),
      '--out',
      out
    ])

    expect(readReport(out).results).toEqual([])
  })

  test('orchestrator 抛错 → 空报告而不是崩掉', async () => {
    const repo = makeRepo()
    const base = commit(repo, {'a.ts': 'const a = 1\n'}, 'base')
    const head = commit(repo, {'a.ts': 'const a = 2\n'}, 'head')

    const {runLintTools} = require('../src/lint')
    const original = runLintTools
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('../src/lint').runLintTools = async () => {
      throw new Error('adapter exploded')
    }

    const out = path.join(repo, 'report.json')
    try {
      await run(['--repo-root', repo, '--base-sha', base, '--head-sha', head, '--out', out])
      expect(readReport(out).results).toEqual([])
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('../src/lint').runLintTools = original
    }
  })

  test('参数缺 --out 时不写任何文件（早先会写到 argv[0] 指向的路径）', async () => {
    const repo = makeRepo()
    const before = fs.readdirSync(repo).sort()

    await run(['--repo-root', repo, '--base-sha', '0'.repeat(40)])

    expect(fs.readdirSync(repo).sort()).toEqual(before)
  })

  test('--out 后面跟着另一个 flag 时也不写文件', async () => {
    const repo = makeRepo()
    const before = fs.readdirSync(repo).sort()

    await run(['--out', '--repo-root', '--base-sha', 'main'])

    expect(fs.readdirSync(repo).sort()).toEqual(before)
  })
})

describe('导入本模块不产生副作用（早先 jest 一导入就跑了 run）', () => {
  test('模块源码里没有自执行块', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../src/lint-report-cli.ts'), 'utf8')
    expect(src).not.toContain('process.argv')
    expect(src).not.toMatch(/^\s*void \(async/m)
  })

  test('可执行入口是独立文件，且无条件调用 run', () => {
    const entry = fs.readFileSync(path.resolve(__dirname, '../src/lint-report-entry.ts'), 'utf8')
    expect(entry).toContain('run(process.argv.slice(2))')
    expect(entry).not.toContain('invokedAsCli')
  })
})
