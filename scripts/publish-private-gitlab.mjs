#!/usr/bin/env node
// 发布 GitLab 审查 bundle 到私有云产物仓库。在能同时访问源码和私有云的内网机器上运行。
//
//   npm run publish:private-gitlab -- --tag v1.2.3 [--dry-run] [--allow-overwrite] [--skip-tests]
//
// 私有云连接信息从环境变量或仓库根目录的 .private-gitlab.env（已 gitignore）读取：
//   PRIVATE_GITLAB_URL      例如 https://gitlab.example.com
//   PRIVATE_GITLAB_PROJECT  项目 ID 或 group/project 路径
//   PRIVATE_GITLAB_BRANCH   产物仓库默认分支
//   PRIVATE_GITLAB_TOKEN    api scope，对产物仓库有推送权限（建议只放环境变量）
//
// 步骤：校验工作区 → 测试 → 去注释编译 → 打包审查 bundle → 组装 → 冒烟测试 → 推送。
// 全部中间产物在 .publish/（已 gitignore），不改动仓库里已跟踪的 dist/。
import {execFileSync, spawnSync} from 'node:child_process'
import {copyFileSync, existsSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const work = path.join(root, '.publish')
const TAG_PATTERN = /^v\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/

function die(msg) {
  console.error(`publish-private-gitlab: ${msg}`)
  process.exit(1)
}

function step(title) {
  console.log(`\n=== ${title}`)
}

function sh(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {cwd: root, stdio: 'inherit', ...opts})
  if (res.status !== 0) die(`${cmd} ${args.join(' ')} failed`)
}

function git(...args) {
  return execFileSync('git', ['-C', root, ...args], {encoding: 'utf8'}).trim()
}

// ---- 参数与配置
const argv = process.argv.slice(2)
const flags = new Set(argv.filter(a => a.startsWith('--') && a !== '--tag'))
const tagIndex = argv.indexOf('--tag')
const tag = tagIndex >= 0 ? argv[tagIndex + 1] : undefined
for (const f of flags) {
  if (!['--dry-run', '--allow-overwrite', '--skip-tests'].includes(f)) die(`unknown option ${f}`)
}
if (tag == null || !TAG_PATTERN.test(tag)) die('--tag vX.Y.Z is required')

const envFile = path.join(root, '.private-gitlab.env')
const fileEnv = {}
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (m && !line.trimStart().startsWith('#')) fileEnv[m[1]] = m[2]
  }
}
const cfg = {}
for (const key of ['PRIVATE_GITLAB_URL', 'PRIVATE_GITLAB_PROJECT', 'PRIVATE_GITLAB_BRANCH', 'PRIVATE_GITLAB_TOKEN']) {
  cfg[key] = process.env[key] || fileEnv[key] || ''
  if (cfg[key] === '') die(`${key} is not set (environment or .private-gitlab.env)`)
}

// ---- 1. 工作区必须干净，且 HEAD 正是要发布的 tag
step(`check worktree for ${tag}`)
if (git('status', '--porcelain') !== '') die('worktree is not clean; commit or stash first')
let tagCommit
try {
  tagCommit = git('rev-parse', `refs/tags/${tag}^{commit}`)
} catch {
  die(`tag ${tag} does not exist locally`)
}
const head = git('rev-parse', 'HEAD')
if (tagCommit !== head) die(`HEAD (${head}) is not ${tag} (${tagCommit}); run: git checkout ${tag}`)
console.log(`ok: HEAD is ${tag} (${head})`)

rmSync(work, {recursive: true, force: true})

// ---- 2. 测试
if (!flags.has('--skip-tests')) {
  step('test')
  sh('npm', ['test', '--', '--silent'])
}

// ---- 3. 去注释编译：只去掉我们自己源码的注释；第三方依赖不受影响
step('compile without comments')
sh('npx', ['tsc', '-p', '.', '--removeComments', '--outDir', path.join(work, 'lib')])

// ---- 4. 打包审查 bundle 与发布器
step('bundle')
const bundle = path.join(work, 'gitlab-trigger')
const stats = path.join(work, 'gitlab-trigger-stats.json')
sh('npx', ['ncc', 'build', path.join(work, 'lib/gitlab-trigger.js'), '-o', bundle, '--license', 'licenses.txt', '--stats-out', stats])
copyFileSync(path.join(root, 'node_modules/@dqbd/tiktoken/tiktoken_bg.wasm'), path.join(bundle, 'tiktoken_bg.wasm'))
sh('node', ['scripts/check-bundle-licenses.js', bundle, '--stats', stats, '--roots', '@gitbeaker/rest'])
writeFileSync(path.join(bundle, 'SOURCE_SHA'), `${head}\n`)
const publisher = path.join(work, 'publisher')
sh('npx', ['ncc', 'build', path.join(work, 'lib/private-gitlab-publish.js'), '-o', publisher])

// ---- 5. 组装
step('assemble')
const out = path.join(work, 'out')
sh('node', ['scripts/assemble-gitlab-dist.mjs', '--root', root, '--out', out, '--bundle', bundle, '--tag', tag])

// ---- 6. 冒烟：去注释后的 bundle 能加载并走到已知的 fail-closed 分支
step('smoke test assembled bundle')
const smoke = spawnSync('node', [path.join(out, 'dist/gitlab-trigger/index.js')], {
  encoding: 'utf8',
  env: {PATH: process.env.PATH, HOME: process.env.HOME}
})
const smokeOut = `${smoke.stdout}${smoke.stderr}`
if (/Cannot find module|SyntaxError|is not defined|MODULE_NOT_FOUND/.test(smokeOut)) die(`bundle failed to load:\n${smokeOut}`)
if (!smokeOut.includes('GITLAB_PAT or CI_JOB_TOKEN is required')) die(`unexpected smoke output:\n${smokeOut}`)
console.log('ok: bundle loads and fails closed without credentials')

// ---- 7. 推送
step(flags.has('--dry-run') ? 'publish (dry run)' : 'publish')
sh('node', [path.join(publisher, 'index.js')], {
  env: {
    ...process.env,
    ...cfg,
    PUBLISH_SOURCE_DIR: out,
    PUBLISH_DRY_RUN: String(flags.has('--dry-run')),
    PUBLISH_ALLOW_OVERWRITE: String(flags.has('--allow-overwrite'))
  }
})
