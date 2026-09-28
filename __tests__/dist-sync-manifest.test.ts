/**
 * dist-sync-manifest.test.ts — 私有云产物仓库 SHA256SUMS 清单与同步计划
 */
import {describe, expect, test, beforeEach, afterEach} from '@jest/globals'
import {execFileSync} from 'child_process'
import {mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync} from 'fs'
import {tmpdir} from 'os'
import * as path from 'path'
import {
  SUMS_FILE,
  ManifestError,
  checkAgainstManifest,
  formatSums,
  hashFiles,
  isClean,
  isSafeRelPath,
  listFsFiles,
  listGitFiles,
  parseDistVersion,
  parseSums,
  planSync
} from '../src/dist-sync/manifest'

const H1 = 'a'.repeat(64)
const H2 = 'b'.repeat(64)
const H3 = 'c'.repeat(64)

describe('isSafeRelPath', () => {
  test.each(['a.js', 'dist/gitlab-trigger/index.js', '.gitlab-ci.yml'])('接受 %s', p => {
    expect(isSafeRelPath(p)).toBe(true)
  })

  test.each(['', '/etc/passwd', '../x', 'a/../b', 'a//b', './a', 'a\\b', '.git/config', 'a/'])(
    '拒绝 %s',
    p => {
      expect(isSafeRelPath(p)).toBe(false)
    }
  )
})

describe('parseSums / formatSums', () => {
  test('往返一致，且按字节序排序', () => {
    const map = new Map([
      ['dist/b.js', H2],
      ['.gitlab-ci.yml', H1],
      ['VERSION.json', H3]
    ])
    const text = formatSums(map)
    expect(text).toBe(`${H1}  .gitlab-ci.yml\n${H3}  VERSION.json\n${H2}  dist/b.js\n`)
    expect(parseSums(text)).toEqual(map)
  })

  test.each([
    ['格式错误', `${H1} a.js\n`],
    ['hash 大写', `${H1.toUpperCase()}  a.js\n`],
    ['路径穿越', `${H1}  ../a.js\n`],
    ['登记自身', `${H1}  ${SUMS_FILE}\n`],
    ['重复路径', `${H1}  a.js\n${H2}  a.js\n`],
    ['空清单', ''],
    ['中间空行', `${H1}  a.js\n\n${H2}  b.js\n`]
  ])('%s → 抛错', (_label, text) => {
    expect(() => parseSums(text)).toThrow(ManifestError)
  })
})

describe('planSync', () => {
  test('新增 / 修改 / 删除 / 不变', () => {
    const current = new Map([
      ['keep', H1],
      ['change', H1],
      ['remove', H1]
    ])
    const incoming = new Map([
      ['keep', H1],
      ['change', H2],
      ['add', H3]
    ])
    expect(planSync(current, incoming)).toEqual([
      {action: 'create', path: 'add'},
      {action: 'update', path: 'change'},
      {action: 'delete', path: 'remove'}
    ])
  })

  test('内容完全一致时没有动作', () => {
    const m = new Map([['a', H1]])
    expect(planSync(m, new Map(m))).toEqual([])
  })
})

describe('parseDistVersion', () => {
  const ok = {tag: 'v1.2.3', revision: 'f'.repeat(40)}

  test('合法', () => {
    expect(parseDistVersion(JSON.stringify(ok))).toEqual(ok)
    expect(parseDistVersion(JSON.stringify({...ok, tag: 'v1.2.3-rc.1'})).tag).toBe('v1.2.3-rc.1')
  })

  test.each([
    ['非 JSON', 'nope'],
    ['tag 不是 semver', JSON.stringify({...ok, tag: 'latest'})],
    ['revision 不是 40 位', JSON.stringify({...ok, revision: 'HEAD'})],
    ['缺 revision', JSON.stringify({tag: ok.tag})]
  ])('%s → 抛错', (_label, text) => {
    expect(() => parseDistVersion(text)).toThrow(ManifestError)
  })
})

describe('checkAgainstManifest / listGitFiles（真实 git 仓库）', () => {
  let dir: string

  const git = (...args: string[]): string =>
    execFileSync('git', ['-C', dir, ...args], {encoding: 'utf8'})

  function write(rel: string, content: string): void {
    mkdirSync(path.dirname(path.join(dir, rel)), {recursive: true})
    writeFileSync(path.join(dir, rel), content)
  }

  function writeSums(): void {
    const files = listFsFiles(dir).filter(f => f !== SUMS_FILE)
    writeFileSync(path.join(dir, SUMS_FILE), formatSums(hashFiles(dir, files)))
  }

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'dist-sync-test-'))
    git('init', '-q')
    write('.gitlab-ci.yml', 'stages: []\n')
    write('dist/gitlab-trigger/index.js', 'console.log(1)\n')
    writeSums()
    git('add', '-A')
  })

  afterEach(() => {
    rmSync(dir, {recursive: true, force: true})
  })

  test('与清单一致 → clean', () => {
    const check = checkAgainstManifest(dir, listGitFiles(dir))
    expect(isClean(check)).toBe(true)
  })

  test('文件被改 → modified', () => {
    write('dist/gitlab-trigger/index.js', 'console.log(2)\n')
    const check = checkAgainstManifest(dir, listGitFiles(dir))
    expect(check.modified).toEqual(['dist/gitlab-trigger/index.js'])
    expect(isClean(check)).toBe(false)
  })

  test('清单外多出文件 → extra', () => {
    write('hack.sh', 'echo\n')
    git('add', 'hack.sh')
    const check = checkAgainstManifest(dir, listGitFiles(dir))
    expect(check.extra).toEqual(['hack.sh'])
  })

  test('文件被删 → missing', () => {
    git('rm', '-q', '--cached', '.gitlab-ci.yml')
    const check = checkAgainstManifest(dir, listGitFiles(dir))
    expect(check.missing).toEqual(['.gitlab-ci.yml'])
  })

  test('没有 SHA256SUMS → bootstrap', () => {
    git('rm', '-q', '--cached', SUMS_FILE)
    const check = checkAgainstManifest(dir, listGitFiles(dir))
    expect(check.bootstrap).toBe(true)
    expect(isClean(check)).toBe(false)
  })

  test('符号链接 → listGitFiles 拒绝', () => {
    symlinkSync('/etc/passwd', path.join(dir, 'link'))
    git('add', 'link')
    expect(() => listGitFiles(dir)).toThrow(/unsupported file mode 120000/)
  })

  test('可执行位 → listGitFiles 拒绝', () => {
    git('update-index', '--chmod=+x', '.gitlab-ci.yml')
    expect(() => listGitFiles(dir)).toThrow(/unsupported file mode 100755/)
  })
})
