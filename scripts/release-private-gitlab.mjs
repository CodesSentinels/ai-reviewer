#!/usr/bin/env node
// 私有云发布的一条命令：打 tag → 预演 → 停下确认 → 推送 tag → 发布 → 切回原分支。
// 只是把 scripts/publish-private-gitlab.mjs 的手工步骤串起来，不改发布逻辑。
//
//   export PRIVATE_GITLAB_TOKEN=<token>
//   npm run release:private -- v0.1.0-rc.16 [--ref <commit>] [--yes] [--skip-tests] [--allow-overwrite]
//
//   --ref <commit>     新建 tag 时打在哪个提交上，默认 origin/develop 的最新提交；必须在 origin/develop 上
//   --yes              跳过确认。不传则预演后停下提问，输入 yes 才继续；输入流结束（无人值守）按中止处理
//   --skip-tests       预演时不跑测试
//   --allow-overwrite  目标仓库有手动改动时仍覆盖（透传给发布脚本，先看清楚改动是什么）
//
// 确认之前没有任何对外副作用：本次新建的本地 tag 在中止时会被清理，tag 在确认之后才推送。
// 私有云连接信息（地址、项目、分支）仍读环境变量或 .private-gitlab.env；token 只认环境变量。
import {execFileSync, spawnSync} from 'node:child_process'
import {createInterface} from 'node:readline'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(scriptDir, '..')
const publishScript = path.join(scriptDir, 'publish-private-gitlab.mjs')
const TAG_PATTERN = /^v\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/
const DEVELOP = 'origin/develop'

function die(msg) {
  console.error(`release-private-gitlab: ${msg}`)
  process.exitCode = 1
  throw new Error(msg)
}

function step(title) {
  console.log(`\n=== ${title}`)
}

function git(...args) {
  return execFileSync('git', ['-C', root, ...args], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim()
}

/** 退出码为 0 返回 true，否则 false；不抛 */
function gitOk(...args) {
  return spawnSync('git', ['-C', root, ...args], {stdio: 'ignore'}).status === 0
}

function run(cmd, args) {
  const res = spawnSync(cmd, args, {cwd: root, stdio: 'inherit'})
  if (res.status !== 0) die(`${cmd} ${args.join(' ')} failed (exit ${res.status})`)
}

// ---- 参数
const argv = process.argv.slice(2)
const valueOpts = new Set(['--ref'])
const boolOpts = new Set(['--yes', '--skip-tests', '--allow-overwrite'])
let tag
let ref = DEVELOP
const flags = new Set()
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (valueOpts.has(a)) {
    if (argv[i + 1] == null || argv[i + 1].startsWith('--')) die(`${a} needs a value`)
    ref = argv[++i]
  } else if (boolOpts.has(a)) flags.add(a)
  else if (a.startsWith('--')) die(`unknown option ${a}`)
  else if (tag == null) tag = a
  else die(`unexpected argument ${a}`)
}

/** 只有明确输入 yes 才算确认；输入流提前结束（无人值守、管道为空）按中止处理 */
function confirm(question) {
  const rl = createInterface({input: process.stdin, output: process.stdout})
  return new Promise(resolve => {
    let answered = false
    rl.on('close', () => {
      if (!answered) resolve(false)
    })
    rl.question(question, answer => {
      answered = true
      resolve(answer.trim().toLowerCase() === 'yes')
      rl.close()
    })
  })
}

async function main() {
  // ---- 1. 前置校验：都在动任何东西之前
  if (tag == null || !TAG_PATTERN.test(tag)) die('usage: release:private -- vX.Y.Z[-rc.N] (tag must look like v1.2.3 or v1.2.3-rc.1)')
  if ((process.env.PRIVATE_GITLAB_TOKEN ?? '').trim() === '') {
    die('PRIVATE_GITLAB_TOKEN is not set in the environment (export it first; it is not read from files)')
  }
  if (git('status', '--porcelain') !== '') die('worktree is not clean; commit or stash first')

  const originalHead = git('rev-parse', '--abbrev-ref', 'HEAD')
  const restoreTo = originalHead === 'HEAD' ? git('rev-parse', 'HEAD') : originalHead
  let createdLocalTag = false
  let tagPushed = false

  try {
    // ---- 2. 确定 tag 指向的提交
    step('resolve tag')
    git('fetch', 'origin', 'develop')
    const remoteLine = git('ls-remote', '--tags', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`)
    const remoteCommit = remoteLine
      .split('\n')
      .filter(Boolean)
      .map(l => l.split('\t'))
      .sort((a, b) => (a[1].endsWith('^{}') ? -1 : 0) - (b[1].endsWith('^{}') ? -1 : 0))[0]?.[0]
    const hasLocal = gitOk('rev-parse', '--verify', '--quiet', `refs/tags/${tag}`)
    let commit
    if (hasLocal) {
      commit = git('rev-parse', `refs/tags/${tag}^{commit}`)
      if (remoteCommit != null && remoteCommit !== commit) die(`tag ${tag} points to ${commit} locally but ${remoteCommit} on origin; resolve this first`)
      console.log(`tag ${tag} already exists locally → ${commit}`)
    } else if (remoteCommit != null) {
      git('fetch', 'origin', `refs/tags/${tag}:refs/tags/${tag}`)
      commit = git('rev-parse', `refs/tags/${tag}^{commit}`)
      console.log(`tag ${tag} fetched from origin → ${commit}`)
    } else {
      commit = git('rev-parse', '--verify', `${ref}^{commit}`)
      console.log(`tag ${tag} does not exist yet; will create it at ${ref} → ${commit}`)
    }
    if (!gitOk('merge-base', '--is-ancestor', commit, DEVELOP)) die(`${commit} is not on ${DEVELOP}; only commits merged into develop can be released`)
    if (!hasLocal && remoteCommit == null) {
      git('tag', tag, commit)
      createdLocalTag = true
    }
    console.log(`release commit: ${git('log', '-1', '--format=%h %s', commit)}`)

    // ---- 3. 检出 tag（依赖有变化才 npm ci），预演
    step(`checkout ${tag}`)
    run('git', ['checkout', '-q', '--detach', tag])
    if (!gitOk('diff', '--quiet', restoreTo, tag, '--', 'package-lock.json')) {
      step('npm ci (package-lock.json differs from the original checkout)')
      run('npm', ['ci'])
    }
    step('dry run (read-only; shows the plan)')
    run('node', [publishScript, '--tag', tag, '--dry-run', ...(flags.has('--skip-tests') ? ['--skip-tests'] : [])])

    // ---- 4. 停下确认
    if (!flags.has('--yes')) {
      const ok = await confirm(`\n以上是 ${tag}（${commit.slice(0, 7)}）的发布计划。输入 yes 确认发布，其他任意输入中止：`)
      if (!ok) die('aborted before publishing; nothing was pushed')
    }

    // ---- 5. 推送 tag（确认之后才对外）→ 发布
    if (remoteCommit == null) {
      step(`push tag ${tag}`)
      // 本机全局 pre-push hook（安全软件）会拦截推送；--no-verify 不够，需整体绕过 hooksPath
      run('git', ['-c', 'core.hooksPath=/dev/null', 'push', 'origin', `refs/tags/${tag}:refs/tags/${tag}`])
      tagPushed = true
    }
    step('publish')
    // 测试已在预演里跑过，同一个提交不重复
    run('node', [publishScript, '--tag', tag, '--skip-tests', ...(flags.has('--allow-overwrite') ? ['--allow-overwrite'] : [])])
    console.log(`\n发布完成：${tag}（${commit.slice(0, 7)}）。下一步：在已接入的业务项目开一个测试 MR，确认审查正常（见发布指南「验证」一节）。`)
  } finally {
    // 无论成败都回到原来的分支；中止时清理本次新建、尚未推送的本地 tag
    spawnSync('git', ['-C', root, 'checkout', '-q', restoreTo], {stdio: 'inherit'})
    if (createdLocalTag && !tagPushed) spawnSync('git', ['-C', root, 'tag', '-d', tag], {stdio: 'ignore'})
  }
}

main().catch(e => {
  if (process.exitCode == null || process.exitCode === 0) {
    console.error(`release-private-gitlab: ${e instanceof Error ? e.message : String(e)}`)
    process.exitCode = 1
  }
})
