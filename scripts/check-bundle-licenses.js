#!/usr/bin/env node
/**
 * BUILD-005：bundle 许可证与供应链检查。
 *
 * ncc 的 license 插件不会收录 @gitbeaker 家族（ESM-only 包），导致
 * dist/gitlab-trigger/licenses.txt 只有 rate-limiter-flexible 一条，
 * 而 bundle 里实际打进了 @gitbeaker/rest 及其传递依赖。
 *
 * 判定「哪些包必须出现在 licenses.txt」有两个来源，优先用前者：
 *
 * 1. **webpack stats（准绳）**：`ncc build --stats-out` 输出的模块清单就是
 *    bundle 的真实构成。逻辑依赖树推不出来的情况它都覆盖——被 inline 的
 *    peerDependency、ncc 自己注入的 shim、条件 require 等。
 * 2. **package-lock 依赖子树（兜底）**：没有 stats 时（如未重新构建就跑
 *    `--check`）退化为遍历指定入口包的传递依赖。此路径只遍历实际装在
 *    node_modules 里的包——平台专属的 optional 依赖常常仍留在 lockfile 里
 *    （带 os/cpu 条件）但并未安装，它们不会进 bundle，也就不该要求许可证。
 *
 * 任一依赖既没有许可证文件、lock 里也没有 license 字段时一律失败——
 * 供应链检查不能因为「找不到」就放行。
 *
 * 同时支持 npm 与 pnpm 的 node_modules 布局。pnpm 下模块路径形如
 * `node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>/...`：`.pnpm` 是存储目录而不是包，
 * 且传递依赖只存在于 `.pnpm` 下（顶层 `node_modules/<name>` 只链接直接依赖），
 * 所以包的磁盘目录要从模块路径本身解析，不能假定在 `node_modules/<name>`。
 *
 * 用法：
 *   node scripts/check-bundle-licenses.js <bundleDir> [--stats <file>]
 *                                         [--roots <pkg,...>] [--check]
 */

const fs = require('fs')
const path = require('path')

const LICENSE_FILE_PATTERN = /^(LICEN[CS]E|COPYING|NOTICE)(\.[A-Za-z]+)?$/i
const NODE_MODULES_PATTERN = /node_modules[/\\]((?:@[^/\\]+[/\\])?[^/\\]+)/g

function fail(msg) {
  console.error(`FAIL: ${msg}`)
  process.exit(1)
}

/** 包是否真的装在 node_modules 里（ncc 只可能打包磁盘上存在的东西） */
function isInstalled(name, nodeModulesDir = 'node_modules') {
  return fs.existsSync(path.join(nodeModulesDir, ...name.split('/')))
}

/**
 * 解析一个模块路径途经的全部包及其磁盘目录。
 *
 * 以 `.` 开头的段（pnpm 的 `.pnpm` 存储目录等）不是包——合法的 npm 包名不能以 `.` 开头。
 * 目录取到包名那一段为止，npm 嵌套依赖与 pnpm 存储目录都能据此定位到真实位置。
 */
function packagesInPath(modulePath) {
  const out = []
  for (const m of modulePath.matchAll(NODE_MODULES_PATTERN)) {
    const name = m[1].replace(/\\/g, '/')
    if (name.startsWith('.')) continue
    out.push({name, dir: modulePath.slice(0, m.index + m[0].length)})
  }
  return out
}

/**
 * 准绳：从 webpack stats 里读出 bundle 实际包含的包，以及每个包的磁盘目录。
 *
 * 覆盖依赖树推不出来的情形：被 inline 的 peerDependency、ncc 注入的 shim、
 * 条件 require 等。目录优先取自 `name`（相对仓库根的路径），`identifier` 可能带
 * loader 前缀，只用来补充包名。
 */
function collectBundledPackageDirs(statsPath) {
  const stats = JSON.parse(fs.readFileSync(statsPath, 'utf8'))
  const dirs = new Map()
  for (const mod of stats.modules || []) {
    for (const field of [mod.name, mod.identifier]) {
      if (typeof field !== 'string') continue
      for (const {name, dir} of packagesInPath(field)) {
        if (!dirs.has(name) || (field === mod.name && !fs.existsSync(dirs.get(name)))) {
          dirs.set(name, dir)
        }
      }
    }
  }
  return dirs
}

function collectBundledPackages(statsPath) {
  return [...collectBundledPackageDirs(statsPath).keys()].sort()
}

/**
 * 兜底：从 package-lock 收集入口包的全部传递依赖（含自身）。
 *
 * 同时遍历 `dependencies` 和 `optionalDependencies`：optional 依赖装上后一样会被
 * ncc 打进 bundle，只看 dependencies 会在依赖升级引入 optional 包时静默漏收。
 * peerDependencies 不遍历——它由宿主在顶层提供，是否被 inline 只有 stats 说了算，
 * 这也是本函数只是兜底、stats 才是准绳的原因。
 *
 * optional 依赖以「是否真的装在 node_modules」为准：lockfile v3 会保留平台不匹配
 * 的包及其 os/cpu 条件，条目在但目录不在，这类包不会进 bundle。
 * 必装依赖缺条目则说明 lock 与 package.json 不同步，直接失败。
 */
function collectSubtree(lock, roots, onError = fail, nodeModulesDir = 'node_modules') {
  const pkgs = lock.packages || {}
  const seen = new Set()
  const stack = roots.map(name => ({name, optional: false}))
  while (stack.length > 0) {
    const {name, optional} = stack.pop()
    if (seen.has(name)) continue
    const entry = pkgs[`node_modules/${name}`]
    if (entry == null) {
      // 平台不匹配的 optional 依赖可能连 lock 条目都没有
      if (optional) continue
      onError(`${name} not found in package-lock.json`)
      continue
    }
    // lock 里有条目但没装上（os/cpu 不匹配）→ 不会进 bundle
    if (optional && !isInstalled(name, nodeModulesDir)) continue

    seen.add(name)
    for (const dep of Object.keys(entry.dependencies || {})) {
      stack.push({name: dep, optional: false})
    }
    for (const dep of Object.keys(entry.optionalDependencies || {})) {
      stack.push({name: dep, optional: true})
    }
  }
  return [...seen].sort()
}

/**
 * 取 SPDX 标识：先 lockfile，再退回已安装包自己的 package.json。
 *
 * 两者都在仓库内可核验。lockfile 的 license 字段并非必填，npm 生成时经常缺
 * （openai 就是这样），仅凭它判定会把有明确许可证的包误判为「不明」。
 */
function readSpdx(name, lock, dir = path.join('node_modules', ...name.split('/'))) {
  const fromLock = lock.packages[`node_modules/${name}`]?.license
  if (fromLock != null) return fromLock
  const pkgPath = path.join(dir, 'package.json')
  if (!fs.existsSync(pkgPath)) return null
  const declared = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).license
  return typeof declared === 'string' && declared !== '' ? declared : null
}

/** 在包目录里找许可证文件正文（目录缺省为 npm 布局下的 node_modules/<name>） */
function readLicenseText(name, dir = path.join('node_modules', ...name.split('/'))) {
  if (!fs.existsSync(dir)) return null
  const file = fs.readdirSync(dir).find(f => LICENSE_FILE_PATTERN.test(f))
  if (file == null) return null
  return fs.readFileSync(path.join(dir, file), 'utf8').trim()
}

function parseArgs(argv) {
  const opts = {checkOnly: false, stats: null, roots: [], bundleDir: null}
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--check') opts.checkOnly = true
    else if (argv[i] === '--stats') opts.stats = argv[++i]
    else if (argv[i] === '--roots') opts.roots = argv[++i].split(',').filter(Boolean)
    else positional.push(argv[i])
  }
  opts.bundleDir = positional[0]
  return opts
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.bundleDir == null || (opts.stats == null && opts.roots.length === 0)) {
    fail('usage: check-bundle-licenses.js <bundleDir> [--stats <file>] [--roots <pkg,...>] [--check]')
  }

  const licensePath = path.join(opts.bundleDir, 'licenses.txt')
  if (!fs.existsSync(licensePath)) fail(`${licensePath} not found — run ncc first`)

  const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'))

  let required
  let source
  let dirs = new Map()
  if (opts.stats != null && fs.existsSync(opts.stats)) {
    dirs = collectBundledPackageDirs(opts.stats)
    required = [...dirs.keys()].sort()
    source = `webpack stats（${path.basename(opts.stats)}）`
  } else {
    if (opts.roots.length === 0) fail('--stats 不存在且未提供 --roots，无法确定应覆盖的依赖集合')
    required = collectSubtree(lock, opts.roots)
    source = `package-lock 子树（${opts.roots.join(', ')}）`
  }
  if (required.length === 0) fail(`未能从${source}解析出任何依赖，检查配置`)

  const existing = fs.readFileSync(licensePath, 'utf8')
  // ncc 的条目格式是行首包名，用行匹配避免正文里的同名字符串造成误判
  const listed = new Set(existing.split('\n').map(l => l.trim()))
  const missing = required.filter(name => !listed.has(name))

  if (missing.length === 0) {
    console.log(`PASS: ${licensePath} 覆盖 ${required.length} 个依赖，依据 ${source}`)
    return
  }

  if (opts.checkOnly) {
    fail(
      `${licensePath} 缺少 ${missing.length} 个依赖的许可证（依据 ${source}）：\n  ${missing.join(
        '\n  '
      )}\n运行 npm run package 重新生成。`
    )
  }

  const blocks = []
  const unlicensed = []
  for (const name of missing) {
    const spdx = readSpdx(name, lock, dirs.get(name))
    const text = readLicenseText(name, dirs.get(name))
    // 只有**两者都拿不到**才算「不明许可证」——这也是本文件开头声明的规则。
    // 此前写成 `text == null || spdx == null`（任一缺失即失败），与注释矛盾：
    // 大量 MIT 包不随包分发 LICENSE 文件（@dqbd/tiktoken），而 lockfile 的
    // license 字段又经常缺（openai）。按旧写法，这两类都会被判成供应链风险。
    if (text == null && spdx == null) {
      unlicensed.push(`${name}（license 字段：无，许可证文件：无）`)
      continue
    }
    blocks.push(
      text == null
        ? `${name}\n${spdx}\n（该包未随发行物附带许可证正文，以 SPDX 标识为准）\n`
        : `${name}\n${spdx ?? '（package.json 未声明 SPDX，以下为随包分发的许可证正文）'}\n${text}\n`
    )
  }
  if (unlicensed.length > 0) {
    fail(`以下依赖缺少可核验的许可证信息，供应链检查不通过：\n  ${unlicensed.join('\n  ')}`)
  }

  const separator = existing.endsWith('\n\n') ? '' : existing.endsWith('\n') ? '\n' : '\n\n'
  fs.writeFileSync(licensePath, `${existing}${separator}${blocks.join('\n')}`)
  console.log(`OK: 向 ${licensePath} 补齐 ${blocks.length} 个依赖的许可证（依据 ${source}）`)
}

// 作为 CLI 运行时执行检查；被 require 时只导出纯函数，
// 避免测试重写一份实现，导致同一个缺陷在脚本和测试里同时静默
if (require.main === module) main()

module.exports = {
  collectSubtree,
  collectBundledPackages,
  collectBundledPackageDirs,
  packagesInPath,
  readLicenseText,
  readSpdx,
  isInstalled
}
