/**
 * assemble-gitlab-dist.test.ts — scripts/assemble-gitlab-dist.mjs 的产物必须能
 * 被 src/dist-sync/manifest.ts（即发布器）原样接受。两边分别实现了 SHA256SUMS
 * 的生成与校验，这里用真实运行把两者钉在一起；同时守住「交付物不含源码仓库标识」。
 */
import {describe, expect, test, beforeAll, afterAll} from '@jest/globals'
import {execFileSync, spawnSync} from 'child_process'
import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'fs'
import {tmpdir} from 'os'
import * as path from 'path'
import {
  REQUIRED_DIST_FILES,
  checkAgainstManifest,
  isClean,
  listFsFiles,
  parseDistVersion
} from '../src/dist-sync/manifest'

const REPO = path.resolve(__dirname, '..')
const SCRIPT = path.join(REPO, 'scripts/assemble-gitlab-dist.mjs')

let root: string
let bundle: string
let out: string
let head: string

function assemble(...args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync('node', [SCRIPT, '--root', root, '--out', out, '--bundle', bundle, ...args], {
    encoding: 'utf8'
  })
}

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'assemble-root-'))
  const outParent = mkdtempSync(path.join(tmpdir(), 'assemble-out-'))
  out = path.join(outParent, 'dist')
  bundle = path.join(outParent, 'bundle')
  const git = (...a: string[]): string =>
    execFileSync('git', ['-C', root, ...a], {encoding: 'utf8'})
  git('init', '-q')
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init')
  head = git('rev-parse', 'HEAD').trim()

  mkdirSync(path.join(root, 'deploy/private-gitlab'), {recursive: true})
  for (const f of ['gitlab-ci.yml', 'README.md']) {
    copyFileSync(
      path.join(REPO, 'deploy/private-gitlab', f),
      path.join(root, 'deploy/private-gitlab', f)
    )
  }
  mkdirSync(bundle)
  writeFileSync(path.join(bundle, 'index.js'), '// trigger\n')
  writeFileSync(path.join(bundle, 'SOURCE_SHA'), `${head}\n`)
  writeFileSync(path.join(bundle, 'tiktoken_bg.wasm'), Buffer.from([0, 97, 115, 109]))
})

afterAll(() => {
  rmSync(root, {recursive: true, force: true})
  rmSync(path.dirname(out), {recursive: true, force: true})
})

describe('assemble-gitlab-dist.mjs', () => {
  test('产物通过发布器的完整性校验，且只含审查所需文件', () => {
    const res = assemble('--tag', 'v1.2.3')
    expect(res.status).toBe(0)

    const files = listFsFiles(out)
    expect(isClean(checkAgainstManifest(out, files))).toBe(true)
    for (const f of REQUIRED_DIST_FILES) expect(files).toContain(f)
    expect(files).toEqual([
      '.gitlab-ci.yml',
      'README.md',
      'SHA256SUMS',
      'VERSION.json',
      'dist/gitlab-trigger/SOURCE_SHA',
      'dist/gitlab-trigger/index.js',
      'dist/gitlab-trigger/tiktoken_bg.wasm'
    ])

    const version = parseDistVersion(readFileSync(path.join(out, 'VERSION.json'), 'utf8'))
    expect(version).toEqual({tag: 'v1.2.3', revision: head})
  })

  test('同一输入重复组装，结果逐字节一致（重复发布不会产生空提交）', () => {
    expect(assemble('--tag', 'v1.2.3').status).toBe(0)
    const first = readFileSync(path.join(out, 'SHA256SUMS'), 'utf8')
    expect(assemble('--tag', 'v1.2.3').status).toBe(0)
    expect(readFileSync(path.join(out, 'SHA256SUMS'), 'utf8')).toBe(first)
  })

  test.each(['latest', 'v1', '1.2.3', 'v1.2.3;rm'])('拒绝非 vX.Y.Z tag：%s', tag => {
    const res = assemble('--tag', tag)
    expect(res.status).not.toBe(0)
    expect(res.stderr).toMatch(/tag must look like/)
  })

  test('bundle 的 SOURCE_SHA 与 HEAD 不一致 → 拒绝（防止发布陈旧 bundle）', () => {
    const shaFile = path.join(bundle, 'SOURCE_SHA')
    writeFileSync(shaFile, `${'0'.repeat(40)}\n`)
    try {
      const res = assemble('--tag', 'v1.2.3')
      expect(res.status).not.toBe(0)
      expect(res.stderr).toMatch(/SOURCE_SHA .* != HEAD/)
    } finally {
      writeFileSync(shaFile, `${head}\n`)
    }
  })

  test.each([['CodesSentinels'], ['https://github.com/x/ai-reviewer.git']])(
    '交付物含源码仓库标识「%s」→ 拒绝组装',
    marker => {
      const index = path.join(bundle, 'index.js')
      const original = readFileSync(index)
      appendFileSync(index, `// ${marker}\n`)
      try {
        const res = assemble('--tag', 'v1.2.3')
        expect(res.status).not.toBe(0)
        expect(res.stderr).toMatch(/forbidden identifier/)
      } finally {
        writeFileSync(index, original)
      }
    }
  )

  test('拒绝发布 source map（会带出源码与注释）', () => {
    const map = path.join(bundle, 'index.js.map')
    writeFileSync(map, '{}')
    try {
      const res = assemble('--tag', 'v1.2.3')
      expect(res.status).not.toBe(0)
      expect(res.stderr).toMatch(/source map/)
    } finally {
      rmSync(map)
    }
  })
})
