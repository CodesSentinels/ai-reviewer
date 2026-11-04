/**
 * release-private-gitlab.test.ts — scripts/release-private-gitlab.mjs（#226）
 *
 * 一条命令的私有云发布：打 tag → 预演 → 停下确认 → 推送 tag → 发布 → 切回原分支。
 * 这里用临时的「裸 origin + 工作仓库」跑真实流程，发布脚本换成一个只记录参数的假脚本，
 * 守住最重要的几条：确认之前没有对外副作用、各类前置条件会拒绝、失败时仍切回原分支。
 */
import {describe, expect, test, beforeEach, afterEach} from '@jest/globals'
import {execFileSync, spawnSync} from 'child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'fs'
import {tmpdir} from 'os'
import * as path from 'path'

const REPO = path.resolve(__dirname, '..')
const RELEASE_SCRIPT = path.join(REPO, 'scripts/release-private-gitlab.mjs')

let base: string
let origin: string
let work: string
let stubLog: string

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {cwd, encoding: 'utf8'}).trim()
}

/** 假的发布脚本：把收到的参数追加到日志；STUB_EXIT 控制退出码 */
const STUB = `import {appendFileSync} from 'node:fs'
appendFileSync(process.env.STUB_LOG, JSON.stringify(process.argv.slice(2)) + '\\n')
process.exit(Number(process.env.STUB_EXIT ?? 0))
`

function commitFile(name: string, content: string, message: string): string {
  writeFileSync(path.join(work, name), content)
  git(work, 'add', '-A')
  git(work, 'commit', '-q', '-m', message)
  return git(work, 'rev-parse', 'HEAD')
}

beforeEach(() => {
  base = mkdtempSync(path.join(tmpdir(), 'release-private-'))
  origin = path.join(base, 'origin.git')
  work = path.join(base, 'work')
  stubLog = path.join(base, 'stub.log')
  execFileSync('git', ['init', '-q', '--bare', origin])
  execFileSync('git', ['init', '-q', '-b', 'develop', work])
  // 隔离本机的全局 hook / 签名配置，测试不依赖也不触发它们
  for (const [k, v] of [
    ['user.name', 'test'],
    ['user.email', 'test@example.com'],
    ['core.hooksPath', '/dev/null'],
    ['commit.gpgsign', 'false'],
    ['tag.gpgsign', 'false']
  ]) {
    git(work, 'config', k, v)
  }
  mkdirSync(path.join(work, 'scripts'))
  copyFileSync(RELEASE_SCRIPT, path.join(work, 'scripts/release-private-gitlab.mjs'))
  writeFileSync(path.join(work, 'scripts/publish-private-gitlab.mjs'), STUB)
  git(work, 'add', '-A')
  git(work, 'commit', '-q', '-m', 'init')
  git(work, 'remote', 'add', 'origin', origin)
  git(work, 'push', '-q', 'origin', 'develop')
})

afterEach(() => {
  rmSync(base, {recursive: true, force: true})
})

function release(
  args: string[],
  env: Record<string, string> = {},
  input = ''
): ReturnType<typeof spawnSync> {
  return spawnSync('node', ['scripts/release-private-gitlab.mjs', ...args], {
    cwd: work,
    encoding: 'utf8',
    // input 模拟用户在确认提示处的输入；默认空 = 输入流直接结束
    input,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      PRIVATE_GITLAB_TOKEN: 'test-token',
      STUB_LOG: stubLog,
      ...env
    }
  })
}

function stubCalls(): string[][] {
  if (!existsSync(stubLog)) return []
  return readFileSync(stubLog, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l))
}

const remoteTags = (): string => git(origin, 'tag', '--list')

describe('前置条件：拒绝，且不改动任何东西', () => {
  test('缺少 PRIVATE_GITLAB_TOKEN（只认环境变量）', () => {
    const res = release(['v0.1.0-rc.1', '--yes'], {PRIVATE_GITLAB_TOKEN: ''})
    expect(res.status).toBe(1)
    expect(String(res.stderr)).toContain('PRIVATE_GITLAB_TOKEN')
    expect(stubCalls()).toEqual([])
    expect(remoteTags()).toBe('')
  })

  test('tag 格式错误 / 缺失', () => {
    expect(release(['0.1.0', '--yes']).status).toBe(1)
    expect(release(['--yes']).status).toBe(1)
    expect(stubCalls()).toEqual([])
  })

  test('未知选项被拒绝', () => {
    const res = release(['v0.1.0-rc.1', '--force'])
    expect(res.status).toBe(1)
    expect(String(res.stderr)).toContain('unknown option')
  })

  test('工作区不干净', () => {
    writeFileSync(path.join(work, 'dirty.txt'), 'x')
    const res = release(['v0.1.0-rc.1', '--yes'])
    expect(res.status).toBe(1)
    expect(String(res.stderr)).toContain('not clean')
    expect(stubCalls()).toEqual([])
  })

  test('要发布的提交不在 origin/develop 上', () => {
    git(work, 'checkout', '-q', '-b', 'feature/x')
    const sha = commitFile('f.txt', 'x', 'feature only')
    const res = release(['v0.1.0-rc.1', '--yes', '--ref', sha])
    expect(res.status).toBe(1)
    expect(String(res.stderr)).toContain('not on origin/develop')
    expect(stubCalls()).toEqual([])
    expect(remoteTags()).toBe('')
    expect(git(work, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('feature/x')
    expect(git(work, 'tag', '--list')).toBe('')
  })

  test('远端已有同名 tag 但指向别的提交', () => {
    const first = git(work, 'rev-parse', 'HEAD')
    git(work, 'tag', 'v0.1.0-rc.1', first)
    git(work, 'push', '-q', 'origin', 'refs/tags/v0.1.0-rc.1:refs/tags/v0.1.0-rc.1')
    commitFile('a.txt', 'a', 'second')
    git(work, 'push', '-q', 'origin', 'develop')
    git(work, 'tag', '-f', 'v0.1.0-rc.1', 'HEAD')
    const res = release(['v0.1.0-rc.1', '--yes'])
    expect(res.status).toBe(1)
    expect(String(res.stderr)).toContain('points to')
    expect(stubCalls()).toEqual([])
  })
})

describe('正常流程', () => {
  test('--yes：新建 tag → 预演 → 推送 tag → 发布 → 切回原分支', () => {
    const head = git(work, 'rev-parse', 'HEAD')
    const res = release(['v0.1.0-rc.1', '--yes'])
    expect(res.status).toBe(0)
    // 先预演（带 --dry-run），再正式发布（不带 --dry-run，且跳过已跑过的测试）
    expect(stubCalls()).toEqual([
      ['--tag', 'v0.1.0-rc.1', '--dry-run'],
      ['--tag', 'v0.1.0-rc.1', '--skip-tests']
    ])
    expect(remoteTags()).toBe('v0.1.0-rc.1')
    expect(git(origin, 'rev-parse', 'refs/tags/v0.1.0-rc.1')).toBe(head)
    expect(git(work, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('develop')
    expect(git(work, 'status', '--porcelain')).toBe('')
  })

  test('--skip-tests 只作用于预演；--allow-overwrite 只透传给正式发布', () => {
    const res = release(['v0.1.0-rc.1', '--yes', '--skip-tests', '--allow-overwrite'])
    expect(res.status).toBe(0)
    expect(stubCalls()).toEqual([
      ['--tag', 'v0.1.0-rc.1', '--dry-run', '--skip-tests'],
      ['--tag', 'v0.1.0-rc.1', '--skip-tests', '--allow-overwrite']
    ])
  })

  test('--ref 指定 develop 上更早的提交', () => {
    const earlier = git(work, 'rev-parse', 'HEAD')
    commitFile('a.txt', 'a', 'later')
    git(work, 'push', '-q', 'origin', 'develop')
    const res = release(['v0.1.0-rc.2', '--yes', '--ref', earlier])
    expect(res.status).toBe(0)
    expect(git(origin, 'rev-parse', 'refs/tags/v0.1.0-rc.2')).toBe(earlier)
  })

  test('tag 已在远端且一致：不重复推送，直接发布', () => {
    const head = git(work, 'rev-parse', 'HEAD')
    git(work, 'tag', 'v0.1.0-rc.1', head)
    git(work, 'push', '-q', 'origin', 'refs/tags/v0.1.0-rc.1:refs/tags/v0.1.0-rc.1')
    const res = release(['v0.1.0-rc.1', '--yes'])
    expect(res.status).toBe(0)
    expect(stubCalls()).toHaveLength(2)
    expect(String(res.stdout)).not.toContain('push tag')
  })

  test('从别的分支运行，结束后回到原来的分支', () => {
    git(work, 'checkout', '-q', '-b', 'feature/y')
    const res = release(['v0.1.0-rc.1', '--yes'])
    expect(res.status).toBe(0)
    expect(git(work, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('feature/y')
  })
})

describe('发布前停下确认', () => {
  test('输入 yes 才继续：预演 → 确认 → 推送 tag → 发布', () => {
    const res = release(['v0.1.0-rc.1'], {}, 'yes\n')
    expect(res.status).toBe(0)
    expect(String(res.stdout)).toContain('输入 yes 确认发布')
    expect(stubCalls()).toHaveLength(2)
    expect(remoteTags()).toBe('v0.1.0-rc.1')
  })

  test.each([
    ['输入 no', 'no\n'],
    ['直接回车', '\n'],
    ['输入 y（必须完整写 yes）', 'y\n'],
    ['输入流为空（无人值守）', '']
  ])('%s：中止，只预演过；不推送 tag，清理本地 tag，回到原分支', (_name, input) => {
    const res = release(['v0.1.0-rc.1'], {}, input)
    expect(res.status).toBe(1)
    expect(String(res.stderr)).toContain('aborted before publishing')
    expect(stubCalls()).toEqual([['--tag', 'v0.1.0-rc.1', '--dry-run']])
    expect(remoteTags()).toBe('')
    expect(git(work, 'tag', '--list')).toBe('')
    expect(git(work, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('develop')
  })

  test('--yes 不提问', () => {
    const res = release(['v0.1.0-rc.1', '--yes'])
    expect(res.status).toBe(0)
    expect(String(res.stdout)).not.toContain('输入 yes 确认发布')
  })
})

describe('失败与中止', () => {
  test('预演失败：不推送 tag，清理本次新建的本地 tag，回到原分支', () => {
    const res = release(['v0.1.0-rc.1', '--yes'], {STUB_EXIT: '1'})
    expect(res.status).toBe(1)
    expect(stubCalls()).toEqual([['--tag', 'v0.1.0-rc.1', '--dry-run']])
    expect(remoteTags()).toBe('')
    expect(git(work, 'tag', '--list')).toBe('')
    expect(git(work, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('develop')
  })

  test('预演通过但正式发布失败：tag 已推送（可重试），仍回到原分支，退出码非 0', () => {
    // 假脚本在第二次调用（不带 --dry-run）时失败
    writeFileSync(
      path.join(work, 'scripts/publish-private-gitlab.mjs'),
      `import {appendFileSync} from 'node:fs'
const args = process.argv.slice(2)
appendFileSync(process.env.STUB_LOG, JSON.stringify(args) + '\\n')
process.exit(args.includes('--dry-run') ? 0 : 1)
`
    )
    git(work, 'add', '-A')
    git(work, 'commit', '-q', '-m', 'stub fails on real publish')
    git(work, 'push', '-q', 'origin', 'develop')
    const res = release(['v0.1.0-rc.1', '--yes'])
    expect(res.status).toBe(1)
    expect(stubCalls()).toHaveLength(2)
    expect(remoteTags()).toBe('v0.1.0-rc.1')
    expect(git(work, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('develop')
  })
})
