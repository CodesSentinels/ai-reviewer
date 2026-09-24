/**
 * dist-sync/manifest.ts - 私有云产物仓库的 SHA256SUMS 清单与发布计划（纯函数）
 *
 * 私有云产物仓库只由发布脚本写入，仓库里的每个文件都登记在根目录 SHA256SUMS 里
 * （格式与 `sha256sum` 输出一致：`<64 位 hex>␠␠<path>`，SHA256SUMS 自身不登记）。
 * 这份清单同时承担三件事：
 * 1. 本地组装结果的完整性校验（推送的内容与组装时一致）
 * 2. 产物仓库的手动改动检测（仓库内容与它自己的清单不一致 = 有人手改过）
 * 3. ai_review_trigger 运行前的自检（`sha256sum -c --strict SHA256SUMS`）
 *
 * 本文件不做网络和 git 写操作，便于单测；读 git 索引只用于列出受跟踪文件。
 */
import {createHash} from 'crypto'
import {execFileSync} from 'child_process'
import {readFileSync, readdirSync, lstatSync} from 'fs'
import {join} from 'path'

export const SUMS_FILE = 'SHA256SUMS'

/** path → sha256 hex（小写） */
export type FileHashes = Map<string, string>

export class ManifestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ManifestError'
  }
}

/**
 * 仓库内相对路径的安全校验：只允许 posix 风格的普通相对路径。
 * 挡住 `..` 穿越、绝对路径、`.git/` 内部文件和反斜杠——这些路径最终会原样
 * 作为 GitLab Commits API 的 file_path 提交，也会被 `sha256sum -c` 打开。
 */
export function isSafeRelPath(p: string): boolean {
  if (p === '' || p.startsWith('/') || p.includes('\\') || p.includes('\0')) return false
  const parts = p.split('/')
  if (parts.some(seg => seg === '' || seg === '.' || seg === '..')) return false
  if (parts[0] === '.git') return false
  return true
}

const SUMS_LINE = /^([0-9a-f]{64}) {2}(.+)$/

/** 解析 SHA256SUMS。任何不合规的行、重复路径、不安全路径都直接抛错（fail closed）。 */
export function parseSums(text: string): FileHashes {
  const out: FileHashes = new Map()
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line === '' && i === lines.length - 1) continue // 末尾换行
    const m = SUMS_LINE.exec(line)
    if (!m) throw new ManifestError(`${SUMS_FILE} line ${i + 1} is malformed`)
    const [, hash, file] = m
    if (!isSafeRelPath(file))
      throw new ManifestError(`${SUMS_FILE} line ${i + 1} has unsafe path: ${file}`)
    if (file === SUMS_FILE) throw new ManifestError(`${SUMS_FILE} must not list itself`)
    if (out.has(file)) throw new ManifestError(`${SUMS_FILE} lists ${file} more than once`)
    out.set(file, hash)
  }
  if (out.size === 0) throw new ManifestError(`${SUMS_FILE} is empty`)
  return out
}

/** 生成 SHA256SUMS 文本：按路径字节序排序，保证同一内容永远得到同一份清单。 */
export function formatSums(hashes: FileHashes): string {
  const keys = [...hashes.keys()].sort(byteOrder)
  return keys.map(k => `${hashes.get(k)}  ${k}\n`).join('')
}

function byteOrder(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a), Buffer.from(b))
}

export function sha256OfFile(absPath: string): string {
  return createHash('sha256').update(readFileSync(absPath)).digest('hex')
}

/**
 * 列出 git 工作区里受跟踪的文件（相对路径）。只接受普通文件（mode 100644）：
 * 符号链接、子模块、可执行位都不是产物仓库该有的东西，出现即说明被手动动过。
 */
export function listGitFiles(root: string): string[] {
  const out = execFileSync('git', ['-C', root, 'ls-files', '-s', '-z'], {encoding: 'utf8'})
  const files: string[] = []
  for (const entry of out.split('\0')) {
    if (entry === '') continue
    // 格式：<mode> <object> <stage>\t<path>
    const tab = entry.indexOf('\t')
    const mode = entry.slice(0, entry.indexOf(' '))
    const file = entry.slice(tab + 1)
    if (mode !== '100644') throw new ManifestError(`unsupported file mode ${mode} for ${file}`)
    files.push(file)
  }
  return files.sort(byteOrder)
}

/** 递归列出目录下的普通文件（相对路径），用于还没有 git 索引的组装目录。 */
export function listFsFiles(root: string, rel = ''): string[] {
  const files: string[] = []
  for (const name of readdirSync(join(root, rel))) {
    const relPath = rel === '' ? name : `${rel}/${name}`
    if (relPath === '.git') continue
    const st = lstatSync(join(root, relPath))
    if (st.isDirectory()) files.push(...listFsFiles(root, relPath))
    else if (st.isFile()) files.push(relPath)
    else throw new ManifestError(`unsupported file type for ${relPath}`)
  }
  return files.sort(byteOrder)
}

export function hashFiles(root: string, files: string[]): FileHashes {
  const out: FileHashes = new Map()
  for (const f of files) {
    if (!isSafeRelPath(f)) throw new ManifestError(`unsafe path: ${f}`)
    out.set(f, sha256OfFile(join(root, f)))
  }
  return out
}

export interface ManifestCheck {
  /** 目录里没有 SHA256SUMS（私有云仓库首次同步前的状态） */
  bootstrap: boolean
  /** 清单登记了但文件不存在 */
  missing: string[]
  /** 文件存在但 hash 与清单不符 */
  modified: string[]
  /** 文件存在但清单没有登记 */
  extra: string[]
}

export function isClean(check: ManifestCheck): boolean {
  return (
    !check.bootstrap &&
    check.missing.length === 0 &&
    check.modified.length === 0 &&
    check.extra.length === 0
  )
}

/** 用目录自己的 SHA256SUMS 校验 files（通常来自 listGitFiles / listFsFiles）。 */
export function checkAgainstManifest(root: string, files: string[]): ManifestCheck {
  const present = new Set(files)
  if (!present.has(SUMS_FILE)) {
    return {bootstrap: true, missing: [], modified: [], extra: files}
  }
  const manifest = parseSums(readFileSync(join(root, SUMS_FILE), 'utf8'))
  const actual = hashFiles(
    root,
    files.filter(f => f !== SUMS_FILE)
  )
  const missing: string[] = []
  const modified: string[] = []
  for (const [f, hash] of manifest) {
    const got = actual.get(f)
    if (got == null) missing.push(f)
    else if (got !== hash) modified.push(f)
  }
  const extra = [...actual.keys()].filter(f => !manifest.has(f))
  return {bootstrap: false, missing, modified, extra}
}

export type SyncActionKind = 'create' | 'update' | 'delete'

export interface SyncAction {
  action: SyncActionKind
  path: string
}

/**
 * 计算把 current 变成 incoming 所需的最小动作集。两边都应包含 SHA256SUMS 本身，
 * 这样清单文件和它描述的内容在同一个 commit 里一起更新。
 */
export function planSync(current: FileHashes, incoming: FileHashes): SyncAction[] {
  const actions: SyncAction[] = []
  for (const [f, hash] of incoming) {
    const cur = current.get(f)
    if (cur == null) actions.push({action: 'create', path: f})
    else if (cur !== hash) actions.push({action: 'update', path: f})
  }
  for (const f of current.keys()) {
    if (!incoming.has(f)) actions.push({action: 'delete', path: f})
  }
  return actions.sort((a, b) => byteOrder(a.path, b.path))
}

/** 产物仓库必须具备的文件（缺任何一个都说明组装结果不完整） */
export const REQUIRED_DIST_FILES = [
  '.gitlab-ci.yml',
  'VERSION.json',
  'dist/gitlab-trigger/index.js'
] as const

/** VERSION.json：只记版本号和源码 revision，不记来源仓库 */
export interface DistVersion {
  tag: string
  revision: string
}

const TAG_PATTERN = /^v\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/

export function parseDistVersion(text: string): DistVersion {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new ManifestError('VERSION.json is not valid JSON')
  }
  const v = raw as Partial<DistVersion>
  if (typeof v.tag !== 'string' || !TAG_PATTERN.test(v.tag)) {
    throw new ManifestError(`VERSION.json has invalid tag: ${String(v.tag)}`)
  }
  if (typeof v.revision !== 'string' || !/^[0-9a-f]{40}$/.test(v.revision)) {
    throw new ManifestError(`VERSION.json has invalid revision: ${String(v.revision)}`)
  }
  return {tag: v.tag, revision: v.revision}
}
