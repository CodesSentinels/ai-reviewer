/**
 * check-dist-fresh.test.ts — dist 新鲜度检查（ai-reviewer#168）
 *
 * 在临时 git 仓库里模拟各种状态：新鲜、落后、重新打包之后、SOURCE_SHA 异常。
 */
import {describe, expect, test, afterEach} from '@jest/globals'
import {execFileSync} from 'child_process'
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'fs'
import {tmpdir} from 'os'
import * as path from 'path'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {checkDistFresh} = require('../scripts/check-dist-fresh.js')

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true})
})

function git(root: string, ...args: string[]): string {
  return execFileSync('git', args, {cwd: root, encoding: 'utf8'}).trim()
}

function write(root: string, rel: string, content: string): void {
  mkdirSync(path.dirname(path.join(root, rel)), {recursive: true})
  writeFileSync(path.join(root, rel), content)
}

/** 建一个仓库：先提交源码，再“打包”并提交 dist（SOURCE_SHA 记录源码提交） */
function makeRepo(): {root: string; sourceSha: string} {
  const root = mkdtempSync(path.join(tmpdir(), 'dist-fresh-'))
  dirs.push(root)
  git(root, 'init', '-q')
  git(root, 'config', 'user.email', 't@example.com')
  git(root, 'config', 'user.name', 't')
  write(root, 'src/a.ts', 'export const a = 1\n')
  write(root, 'package-lock.json', '{}\n')
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '-m', 'src')
  const sourceSha = git(root, 'rev-parse', 'HEAD')
  for (const b of ['dist', 'dist/gitlab-trigger', 'dist/lint-report']) {
    write(root, `${b}/SOURCE_SHA`, `${sourceSha}\n`)
    write(root, `${b}/index.js`, '// bundle\n')
  }
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '-m', 'chore: 重新打包 dist')
  return {root, sourceSha}
}

describe('checkDistFresh', () => {
  test('刚重新打包（dist 提交紧跟源码提交）→ 新鲜，退出码 0', () => {
    const {root} = makeRepo()
    const r = checkDistFresh(root)
    expect(r.code).toBe(0)
    expect(r.ok).toBe(true)
  })

  test('重新打包之后又改了与打包无关的文件（文档、测试）→ 仍然新鲜', () => {
    const {root} = makeRepo()
    write(root, 'README.md', 'docs\n')
    write(root, '__tests__/x.test.ts', 'export {}\n')
    git(root, 'add', '-A')
    git(root, 'commit', '-q', '-m', 'docs')
    expect(checkDistFresh(root).code).toBe(0)
  })

  test('重新打包之后 src 又变了 → 落后，退出码 1，并列出变化的文件', () => {
    const {root} = makeRepo()
    write(root, 'src/a.ts', 'export const a = 2\n')
    git(root, 'add', '-A')
    git(root, 'commit', '-q', '-m', 'feat: change src')
    const r = checkDistFresh(root)
    expect(r.code).toBe(1)
    expect(r.messages.join('\n')).toContain('src/a.ts')
    expect(r.messages.join('\n')).toContain('落后于源码')
  })

  test('package.json 里无关打包的改动（如新增 npm script）不算落后', () => {
    const {root} = makeRepo()
    write(root, 'package.json', '{"scripts":{"check:dist":"x"}}\n')
    git(root, 'add', '-A')
    git(root, 'commit', '-q', '-m', 'scripts')
    expect(checkDistFresh(root).code).toBe(0)
  })

  test('依赖锁文件变了也算落后', () => {
    const {root} = makeRepo()
    write(root, 'package-lock.json', '{"a":1}\n')
    git(root, 'add', '-A')
    git(root, 'commit', '-q', '-m', 'deps')
    expect(checkDistFresh(root).code).toBe(1)
  })

  test('落后后重新打包并提交 → 恢复新鲜', () => {
    const {root} = makeRepo()
    write(root, 'src/a.ts', 'export const a = 2\n')
    git(root, 'add', '-A')
    git(root, 'commit', '-q', '-m', 'feat')
    const src2 = git(root, 'rev-parse', 'HEAD')
    for (const b of ['dist', 'dist/gitlab-trigger', 'dist/lint-report']) {
      write(root, `${b}/SOURCE_SHA`, `${src2}\n`)
    }
    git(root, 'add', '-A')
    git(root, 'commit', '-q', '-m', 'chore: 重新打包 dist')
    expect(checkDistFresh(root).code).toBe(0)
  })

  test('只有一个 bundle 落后也要失败（三个 bundle 各自检查）', () => {
    const {root} = makeRepo()
    write(root, 'src/a.ts', 'export const a = 2\n')
    git(root, 'add', '-A')
    git(root, 'commit', '-q', '-m', 'feat')
    const src2 = git(root, 'rev-parse', 'HEAD')
    write(root, 'dist/SOURCE_SHA', `${src2}\n`)
    write(root, 'dist/gitlab-trigger/SOURCE_SHA', `${src2}\n`)
    git(root, 'add', '-A')
    git(root, 'commit', '-q', '-m', 'partial repack')
    const r = checkDistFresh(root)
    expect(r.code).toBe(1)
    expect(r.messages.join('\n')).toContain('dist/lint-report 落后于源码')
  })

  test('SOURCE_SHA 写成 HEAD（想绕过校验）→ 无法判断，退出码 2', () => {
    const {root} = makeRepo()
    write(root, 'dist/SOURCE_SHA', 'HEAD\n')
    expect(checkDistFresh(root).code).toBe(2)
  })

  test('SOURCE_SHA 缺失 → 退出码 2', () => {
    const {root} = makeRepo()
    rmSync(path.join(root, 'dist/lint-report/SOURCE_SHA'))
    const r = checkDistFresh(root)
    expect(r.code).toBe(2)
    expect(r.messages.join('\n')).toContain('不存在')
  })

  test('SOURCE_SHA 不是本仓库历史里的提交 → 退出码 2', () => {
    const {root} = makeRepo()
    write(root, 'dist/SOURCE_SHA', `${'a'.repeat(40)}\n`)
    expect(checkDistFresh(root).code).toBe(2)
  })

  test('SOURCE_SHA 不是当前提交的祖先（来自别的分支）→ 退出码 2', () => {
    const {root} = makeRepo()
    git(root, 'checkout', '-q', '-b', 'other', 'HEAD~1')
    write(root, 'src/b.ts', 'export const b = 1\n')
    git(root, 'add', '-A')
    git(root, 'commit', '-q', '-m', 'other')
    const other = git(root, 'rev-parse', 'HEAD')
    git(root, 'checkout', '-q', '-')
    write(root, 'dist/SOURCE_SHA', `${other}\n`)
    expect(checkDistFresh(root).code).toBe(2)
  })
})
