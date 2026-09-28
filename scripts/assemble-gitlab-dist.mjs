#!/usr/bin/env node
// 把 GitLab 审查 bundle 组装成「私有云产物仓库」的完整目录树，
// 由 scripts/publish-private-gitlab.mjs 调用。
//
// 输出目录结构：
//   .gitlab-ci.yml           ← deploy/private-gitlab/gitlab-ci.yml
//   README.md                ← deploy/private-gitlab/README.md
//   dist/gitlab-trigger/*    ← --bundle 指向的目录（发布脚本构建的去注释 bundle）
//   VERSION.json             ← { tag, revision }：不含时间戳，同一版本重复组装逐字节一致；
//                              不记来源仓库
//   SHA256SUMS               ← 以上所有文件，格式与 `sha256sum` 一致
//
// 用法：node scripts/assemble-gitlab-dist.mjs --out <dir> --tag <vX.Y.Z> --bundle <dir> [--root <repo>]
//
// 格式约定与 src/dist-sync/manifest.ts 一致（__tests__/assemble-gitlab-dist.test.ts
// 用后者校验本脚本的输出，两边不一致测试会失败）。
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs'
import path from 'node:path'

const TAG_PATTERN = /^v\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/

// 泄露门禁：交付物里不得出现源码仓库 / 组织的标识。第三方依赖自带的通用链接
// （如 github.com/nodejs/...）不在此列——那不指向我们。
const FORBIDDEN = [/CodesSentinels/i, /ai-reviewer\.git/i, /gitlab-dist/]

function die(msg) {
  console.error(`assemble-gitlab-dist: ${msg}`)
  process.exit(1)
}

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]
    const value = argv[i + 1]
    if (!key?.startsWith('--') || value == null) die(`bad arguments: ${argv.join(' ')}`)
    args[key.slice(2)] = value
  }
  return args
}

const args = parseArgs(process.argv.slice(2))
const root = path.resolve(args.root ?? process.cwd())
const out = args.out ? path.resolve(args.out) : die('--out is required')
const bundle = args.bundle ? path.resolve(args.bundle) : die('--bundle is required')
const tag = args.tag ?? die('--tag is required')
if (!TAG_PATTERN.test(tag)) die(`tag must look like v1.2.3: ${tag}`)
if (out === root || root.startsWith(out + path.sep)) die('--out must not contain the repository')

const revision = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], {encoding: 'utf8'}).trim()

rmSync(out, {recursive: true, force: true})
mkdirSync(out, {recursive: true})

function copy(src, to) {
  if (!existsSync(src)) die(`missing ${src}`)
  mkdirSync(path.dirname(path.join(out, to)), {recursive: true})
  copyFileSync(src, path.join(out, to))
}

copy(path.join(root, 'deploy/private-gitlab/gitlab-ci.yml'), '.gitlab-ci.yml')
copy(path.join(root, 'deploy/private-gitlab/README.md'), 'README.md')

if (!existsSync(path.join(bundle, 'index.js'))) die(`missing ${bundle}/index.js`)
// SOURCE_SHA 由构建步骤写入；和当前 HEAD 不一致说明 bundle 不是这次构建的产物
const recorded = readFileSync(path.join(bundle, 'SOURCE_SHA'), 'utf8').trim()
if (recorded !== revision) die(`bundle SOURCE_SHA (${recorded}) != HEAD (${revision}); rebuild the bundle`)
for (const name of readdirSync(bundle)) {
  if (!lstatSync(path.join(bundle, name)).isFile()) die(`${bundle}/${name} is not a regular file`)
  if (name.endsWith('.map')) die(`source map ${name} must not be published`)
  copy(path.join(bundle, name), `dist/gitlab-trigger/${name}`)
}

writeFileSync(path.join(out, 'VERSION.json'), JSON.stringify({tag, revision}, null, 2) + '\n')

function listFiles(dir, rel = '') {
  const files = []
  for (const name of readdirSync(path.join(dir, rel))) {
    const relPath = rel === '' ? name : `${rel}/${name}`
    if (lstatSync(path.join(dir, relPath)).isDirectory()) files.push(...listFiles(dir, relPath))
    else files.push(relPath)
  }
  return files
}

const byteOrder = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))
const files = listFiles(out).sort(byteOrder)

for (const f of files) {
  const text = readFileSync(path.join(out, f)).toString('latin1')
  const hit = FORBIDDEN.find(re => re.test(text))
  if (hit) die(`${f} contains forbidden identifier ${hit} — refusing to assemble`)
}

const sums = files
  .map(f => `${createHash('sha256').update(readFileSync(path.join(out, f))).digest('hex')}  ${f}\n`)
  .join('')
writeFileSync(path.join(out, 'SHA256SUMS'), sums)

console.log(`assembled ${tag} (${revision}) into ${out}`)
process.stdout.write(sums)
