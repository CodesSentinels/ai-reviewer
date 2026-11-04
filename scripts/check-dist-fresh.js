#!/usr/bin/env node
/**
 * check-dist-fresh.js — 检查 dist/ 是否落后于源码（“新鲜度”）
 *
 * 背景（ai-reviewer#168）：GitHub Action 实际运行的是 dist/index.js，不是源码。
 * 现有的 SOURCE_SHA 校验（.gitlab-ci.yml 的 CI-013）只保证“SOURCE_SHA 是当前提交的祖先”——
 * 这能挡住伪造的 SHA，但挡不住“dist 落后源码很多个提交”：祖先永远是祖先，落后 45 个提交也通过。
 *
 * 本脚本补上这一维度：dist/SOURCE_SHA 记录的提交与当前 HEAD 之间，
 * **参与打包的输入文件**（src/、package.json、锁文件、tsconfig.json 等）有没有变化。
 * 有变化 = dist 已经落后于源码，必须重新打包。
 *
 * 为什么不要求 SOURCE_SHA === HEAD：`git rev-parse HEAD` 写入 SOURCE_SHA 时，那个提交还不包含这次写入本身，
 * 随后“重新打包 dist”的单独提交、PR 合并产生的 merge commit 都会让 HEAD 与 SOURCE_SHA 不再相等
 * （见 .gitlab-ci.yml CI-013 的说明）。所以这里比较的是“输入文件有没有变”，而不是“提交相不相等”。
 *
 * 用法（仓库根目录；需要完整 git 历史，GitHub Actions 里 checkout 要 fetch-depth: 0）：
 *   node scripts/check-dist-fresh.js
 *
 * 退出码：0 新鲜；1 dist 落后源码；2 无法判断（SOURCE_SHA 缺失/格式不对/不是已知提交/不是祖先）。
 */
const {execFileSync} = require('child_process')
const {existsSync, readFileSync} = require('fs')
const path = require('path')

/** 三个 bundle 各自记录自己的 SOURCE_SHA */
const BUNDLES = ['dist', 'dist/gitlab-trigger', 'dist/lint-report']

/** 参与打包的输入：这些文件变了而 dist 没跟着重新打包，就是落后 */
// 不含 package.json：依赖变化一定同时改锁文件；而 package.json 里的 scripts 之类改动不影响打包产物，
// 放进来会让“只加一个 npm script”的 PR 也被判成 dist 落后。
const BUILD_INPUTS = [
  'src',
  'package-lock.json',
  'pnpm-lock.yaml',
  'tsconfig.json',
  'scripts/check-bundle-licenses.js'
]

const SHA_RE = /^[0-9a-f]{40}$/i

function git(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
}

function gitOk(root, args) {
  try {
    execFileSync('git', args, {cwd: root, stdio: 'ignore'})
    return true
  } catch {
    return false
  }
}

/**
 * @returns {{ok: boolean, code: 0 | 1 | 2, messages: string[]}}
 */
function checkDistFresh(root = process.cwd(), bundles = BUNDLES, inputs = BUILD_INPUTS) {
  const messages = []
  let worst = 0
  const head = git(root, ['rev-parse', 'HEAD'])

  for (const bundle of bundles) {
    const file = path.join(root, bundle, 'SOURCE_SHA')
    if (!existsSync(file)) {
      messages.push(
        `${bundle}/SOURCE_SHA 不存在——bundle 还没构建（先 npm run build && npm run package）`
      )
      worst = Math.max(worst, 2)
      continue
    }
    const recorded = readFileSync(file, 'utf8').trim()
    // 先卡格式再交给 git：git 的 rev 参数接受 HEAD、分支名、HEAD~1 等写法，不先校验会被绕过
    if (!SHA_RE.test(recorded)) {
      messages.push(`${bundle}/SOURCE_SHA（${recorded}）不是完整的 40 位提交 SHA`)
      worst = Math.max(worst, 2)
      continue
    }
    if (!gitOk(root, ['cat-file', '-e', `${recorded}^{commit}`])) {
      messages.push(
        `${bundle}/SOURCE_SHA（${recorded}）不是本仓库历史里的提交（浅克隆？请使用 fetch-depth: 0）`
      )
      worst = Math.max(worst, 2)
      continue
    }
    if (!gitOk(root, ['merge-base', '--is-ancestor', recorded, head])) {
      messages.push(`${bundle}/SOURCE_SHA（${recorded}）不是当前提交（${head}）的祖先`)
      worst = Math.max(worst, 2)
      continue
    }
    const changed = git(root, ['diff', '--name-only', recorded, head, '--', ...inputs])
      .split('\n')
      .filter(Boolean)
    if (changed.length > 0) {
      const behind = git(root, ['rev-list', '--count', `${recorded}..${head}`])
      const shown = changed
        .slice(0, 15)
        .map(f => `    ${f}`)
        .join('\n')
      const more = changed.length > 15 ? `\n    …另有 ${changed.length - 15} 个文件` : ''
      messages.push(
        `${bundle} 落后于源码：SOURCE_SHA（${recorded.slice(0, 8)}）之后有 ${behind} 个提交，` +
          `其中 ${changed.length} 个打包输入文件发生了变化：\n${shown}${more}`
      )
      worst = Math.max(worst, 1)
      continue
    }
    messages.push(
      `ok: ${bundle} 新鲜（SOURCE_SHA ${recorded.slice(0, 8)}，之后没有打包输入文件的变化）`
    )
  }

  return {ok: worst === 0, code: worst, messages}
}

module.exports = {checkDistFresh, BUNDLES, BUILD_INPUTS}

// 直接运行时执行；被 require（单元测试）时不执行
if (require.main === module) {
  const result = checkDistFresh()
  for (const m of result.messages) console.error(m)
  if (result.code === 1) {
    console.error(
      '\n修复：npm run build && npm run package，然后单独提交 dist/：\n' +
        '  git add dist && git commit -m "chore: 重新打包 dist（对应 <源码提交 SHA>）"'
    )
  }
  process.exit(result.code)
}
