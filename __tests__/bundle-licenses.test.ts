/**
 * bundle-licenses.test.ts — BUILD-005 许可证与供应链检查
 *
 * ncc 的 license 插件漏收 @gitbeaker 家族（ESM-only 包），
 * 导致 GitLab bundle 打进了 26 个包但 licenses.txt 只列 1 个。
 * 这里把「已提交的 licenses.txt 必须覆盖 bundle 实际包含的包」钉死，
 * 防止升级依赖或改打包脚本后再次漏收。
 *
 * 依赖遍历直接复用 scripts/check-bundle-licenses.js 的实现——测试里重写一份
 * 会让同一个缺陷（例如漏遍历 optionalDependencies）在两处同时静默通过。
 */
import {describe, expect, test} from '@jest/globals'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const ROOT = path.resolve(__dirname, '..')
const LOCK = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'))
const STATS = path.join(ROOT, 'node_modules/.gitlab-bundle-stats.json')

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {collectSubtree, collectBundledPackages} = require('../scripts/check-bundle-licenses.js')

function listedPackages(licensePath: string): Set<string> {
  const content = fs.readFileSync(licensePath, 'utf8')
  return new Set(content.split('\n').map(l => l.trim()))
}

/** 造一个临时 node_modules，用来构造「装了 / 没装」两种状态 */
function withFakeNodeModules(installed: string[], fn: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-licenses-'))
  try {
    for (const name of installed) {
      fs.mkdirSync(path.join(dir, ...name.split('/')), {recursive: true})
    }
    fn(dir)
  } finally {
    fs.rmSync(dir, {recursive: true, force: true})
  }
}

describe('BUILD-005: bundle 许可证覆盖', () => {
  const gitlabLicenses = path.join(ROOT, 'dist/gitlab-trigger/licenses.txt')

  test('GitLab bundle 的 licenses.txt 存在', () => {
    expect(fs.existsSync(gitlabLicenses)).toBe(true)
  })

  test('覆盖 @gitbeaker/rest 及其全部传递依赖', () => {
    const required: string[] = collectSubtree(LOCK, ['@gitbeaker/rest'])
    // 子树规模用于兜底：依赖树被裁剪到只剩自己时，本用例不应变成空断言
    expect(required.length).toBeGreaterThan(5)

    const listed = listedPackages(gitlabLicenses)
    expect(required.filter(name => !listed.has(name))).toEqual([])
  })

  // stats 由 npm run package 生成；单跑 jest 时可能不存在，故条件执行
  const statsTest = fs.existsSync(STATS) ? test : test.skip
  statsTest('覆盖 webpack stats 里 bundle 实际包含的每个包（准绳）', () => {
    const bundled: string[] = collectBundledPackages(STATS)
    expect(bundled.length).toBeGreaterThan(5)

    const listed = listedPackages(gitlabLicenses)
    expect(bundled.filter(name => !listed.has(name))).toEqual([])
  })

  test('每个依赖都有可核验的 SPDX 标识（供应链检查）', () => {
    const required: string[] = collectSubtree(LOCK, ['@gitbeaker/rest'])
    const withoutLicense = required.filter(
      name => LOCK.packages[`node_modules/${name}`].license == null
    )
    expect(withoutLicense).toEqual([])
  })

  test('打包脚本同时产出 stats 并调用许可证检查（防止被顺手删掉）', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
    expect(pkg.scripts['package:gitlab']).toContain('--stats-out')
    expect(pkg.scripts['package:gitlab']).toContain('check-bundle-licenses.js')
  })
})

describe('BUILD-005: collectBundledPackages（webpack stats 准绳）', () => {
  test('从模块路径解析出包名，含 scoped 包，去重', () => {
    const statsFile = path.join(os.tmpdir(), `stats-${Date.now()}.json`)
    fs.writeFileSync(
      statsFile,
      JSON.stringify({
        modules: [
          {name: './node_modules/@gitbeaker/rest/dist/index.mjs'},
          {identifier: '/abs/path/node_modules/@gitbeaker/rest/dist/other.mjs'},
          {name: './node_modules/qs/lib/index.js'},
          {name: './lib/gitlab-trigger.js'},
          {name: './node_modules/qs/node_modules/side-channel/index.js'}
        ]
      })
    )
    try {
      expect(collectBundledPackages(statsFile)).toEqual(['@gitbeaker/rest', 'qs', 'side-channel'])
    } finally {
      fs.rmSync(statsFile, {force: true})
    }
  })
})

describe('BUILD-005: collectSubtree 依赖遍历（兜底路径）', () => {
  const syntheticLock = {
    packages: {
      'node_modules/root-pkg': {
        version: '1.0.0',
        dependencies: {'normal-dep': '^1.0.0'},
        optionalDependencies: {'optional-dep': '^2.0.0'}
      },
      'node_modules/normal-dep': {version: '1.0.0', dependencies: {'nested-dep': '^1.0.0'}},
      'node_modules/optional-dep': {
        version: '2.0.0',
        dependencies: {'nested-optional-dep': '^1.0.0'}
      },
      'node_modules/nested-dep': {version: '1.0.0'},
      'node_modules/nested-optional-dep': {version: '1.0.0'}
    }
  }

  test('已安装的 optionalDependencies 及其子依赖纳入遍历', () => {
    withFakeNodeModules(['root-pkg', 'normal-dep', 'optional-dep', 'nested-dep'], dir => {
      expect(collectSubtree(syntheticLock, ['root-pkg'], undefined, dir)).toEqual([
        'nested-dep',
        'nested-optional-dep',
        'normal-dep',
        'optional-dep',
        'root-pkg'
      ])
    })
  })

  test('lock 里有条目但未安装的平台专属 optional 依赖跳过（os/cpu 不匹配的常见形态）', () => {
    const lock = {
      packages: {
        'node_modules/root-pkg': {optionalDependencies: {'darwin-only': '^1.0.0'}},
        // lockfile v3 会保留未安装的平台专属包及其条件
        'node_modules/darwin-only': {
          version: '1.0.0',
          optional: true,
          os: ['darwin'],
          cpu: ['arm64'],
          dependencies: {'darwin-only-child': '^1.0.0'}
        },
        'node_modules/darwin-only-child': {version: '1.0.0'}
      }
    }
    const errors: string[] = []
    // 只有 root-pkg 装在磁盘上 → darwin-only 及其子依赖都不该进清单
    withFakeNodeModules(['root-pkg'], dir => {
      expect(collectSubtree(lock, ['root-pkg'], (m: string) => errors.push(m), dir)).toEqual([
        'root-pkg'
      ])
    })
    expect(errors).toEqual([])
  })

  test('lock 里完全没有条目的 optional 依赖同样跳过', () => {
    const lock = {packages: {'node_modules/root-pkg': {optionalDependencies: {absent: '^1.0.0'}}}}
    const errors: string[] = []
    withFakeNodeModules(['root-pkg'], dir => {
      expect(collectSubtree(lock, ['root-pkg'], (m: string) => errors.push(m), dir)).toEqual([
        'root-pkg'
      ])
    })
    expect(errors).toEqual([])
  })

  test('peerDependencies 不纳入兜底遍历（是否被 inline 以 stats 为准）', () => {
    const lock = {
      packages: {
        'node_modules/root-pkg': {peerDependencies: {'peer-dep': '^1.0.0'}},
        'node_modules/peer-dep': {version: '1.0.0'}
      }
    }
    expect(collectSubtree(lock, ['root-pkg'])).toEqual(['root-pkg'])
  })

  test('必装依赖缺 lock 条目 → 报错（lock 与 package.json 不同步）', () => {
    const lock = {packages: {'node_modules/root-pkg': {dependencies: {'missing-dep': '^1.0.0'}}}}
    const errors: string[] = []
    collectSubtree(lock, ['root-pkg'], (m: string) => errors.push(m))
    expect(errors).toEqual(['missing-dep not found in package-lock.json'])
  })

  test('循环依赖不会无限递归', () => {
    const lock = {
      packages: {
        'node_modules/a': {dependencies: {b: '^1.0.0'}},
        'node_modules/b': {dependencies: {a: '^1.0.0'}}
      }
    }
    expect(collectSubtree(lock, ['a'])).toEqual(['a', 'b'])
  })
})
