/**
 * lint-report-cli.ts — lint-only 可信执行器的**核心模块**（LINT-004）
 *
 * 本文件只导出函数，导入它不产生任何副作用。可执行入口是
 * `lint-report-entry.ts`——两者必须分开：早先把「是否以 CLI 方式被调用」判成
 * 「argv 里有 --xxx」，而 jest / ncc 自己就带这类参数，于是测试一导入模块就
 * 真的跑了一遍 run()，还按错误的下标把空报告写到了首个参数指向的路径。
 *
 * 由 `openai-review.yml` 的**低权限** `lint` job 调用，用于 SEC-002 的第二步：
 * 让不可信代码只在没有业务密钥、没有写权限的执行面上被扫描，持密钥的 reviewer
 * 只读结果数据。
 *
 * 运行形态（双 checkout）：
 *
 *   工作区根/  ← 默认分支的可信代码，本 CLI 与其依赖都来自这里
 *   工作区根/pr/ ← PR head，**只作为扫描对象**
 *
 * 因此本文件承担的安全职责是「只从可信路径执行、只把 pr/ 当数据」：
 *
 * - 不从 `--repo-root` 解析任何入口、插件或依赖；lint 工具由 tool-installer
 *   装进 /tmp 沙箱（不碰被扫描仓库的 node_modules），也不跑它的 npm install、
 *   生命周期脚本或 package scripts
 * - base/head 只接受事件传入的 40 位十六进制 SHA，不接受分支名——分支名由 PR
 *   控制，可被指向任意提交；SHA 来自 webhook payload，不可伪造
 * - checkout 之后先验证两个 commit 确实存在，不存在就产空报告退出
 * - 无论发生什么都产出一份**合法的** JSON 并以 0 退出：静态分析是增强项，
 *   它挂掉不能连带把 PR 的审查挡住
 *
 * 注意：PR 自带的 lint 配置（eslint.config.js 等）会被 lint 工具执行，这是本
 * 执行面存在的**前提**而不是缺陷——正因为如此它才必须不持有业务密钥或写权限，
 * 且只能跑在 GitHub 托管的临时 runner 上。（该 job 仍有只读 GITHUB_TOKEN：
 * checkout 私有仓库离不开它，但它只在本 CLI 启动**之前**的步骤里出现。）
 */

import {execFileSync} from 'child_process'
import {existsSync, statSync, writeFileSync} from 'fs'
import {resolve} from 'path'
import {runLintTools} from './lint'
import type {LintReport} from './lint'
import {getLogger} from './platform/logger'

/** 报告体积上限，与消费端 review.ts 保持一致（8 MiB） */
const MAX_REPORT_BYTES = 8 * 1024 * 1024

/** 空报告：任何失败路径的统一产物 */
const EMPTY_REPORT: LintReport = {
  results: [],
  toolSummaries: [],
  durationMs: 0,
  filesScanned: 0
}

export interface CliArgs {
  repoRoot: string
  baseSha: string
  headSha: string
  out: string
  /** 逗号分隔的工具名；缺省时用各适配器的 defaultEnabled */
  tools?: string
}

/** 只接受 40 位十六进制 SHA——分支名由 PR 控制，不可信 */
export function isFullSha(value: string): boolean {
  return /^[0-9a-f]{40}$/.test(value)
}

export function parseArgs(argv: string[]): {args: CliArgs | null; error?: string} {
  const map = new Map<string, string>()
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i]?.startsWith('--')) return {args: null, error: `unexpected argument: ${argv[i]}`}
    map.set(argv[i].slice(2), argv[i + 1] ?? '')
  }

  const repoRoot = map.get('repo-root') ?? ''
  const baseSha = map.get('base-sha') ?? ''
  const headSha = map.get('head-sha') ?? ''
  const out = map.get('out') ?? ''

  if (repoRoot === '' || baseSha === '' || headSha === '' || out === '') {
    return {
      args: null,
      error: 'usage: --repo-root <dir> --base-sha <sha> --head-sha <sha> --out <file>'
    }
  }
  if (!isFullSha(baseSha) || !isFullSha(headSha)) {
    return {args: null, error: 'base-sha/head-sha must be full 40-char commit SHAs, not refs'}
  }

  return {args: {repoRoot, baseSha, headSha, out, tools: map.get('tools')}}
}

/**
 * 在被扫描仓库里跑 git。
 *
 * `-c` 关掉可能被仓库内容影响的机制：external diff driver（.gitattributes 可
 * 指定）、fsmonitor 钩子。工作区是 actions/checkout 建的，`.git/config` 不由
 * PR 控制，这里属于纵深防御。
 */
function git(repoRoot: string, args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'core.fsmonitor=false', '-c', 'diff.external=', '-C', repoRoot, ...args],
    {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024}
  )
}

/**
 * base 与 head 是否存在共同祖先。
 *
 * 浅历史（例如用 `--depth=1` 取回 base）会让 `git diff base...head` 直接失败。
 * 单独判一次是为了把「没有 merge base」这个降级原因明确报出来，而不是混在
 * 一条泛泛的 "git diff failed" 里——lint 静默失效是最难发现的故障。
 */
export function hasMergeBase(repoRoot: string, baseSha: string, headSha: string): boolean {
  try {
    git(repoRoot, ['merge-base', baseSha, headSha])
    return true
  } catch {
    return false
  }
}

/** commit 是否存在于该仓库 */
export function commitExists(repoRoot: string, sha: string): boolean {
  try {
    git(repoRoot, ['cat-file', '-e', `${sha}^{commit}`])
    return true
  } catch {
    return false
  }
}

/**
 * 把 `git diff` 输出切成 per-file 的 [filename, fileDiff] 列表。
 *
 * fileDiff 保留 hunk 内容即可——scanPatch 从 `@@` 开始扫，前面的 header 行会
 * 被跳过。删除的文件不参与 lint。
 */
export function splitDiffByFile(diff: string): Array<[string, string]> {
  const out: Array<[string, string]> = []
  const chunks = diff.split(/^diff --git /m).filter(c => c.trim() !== '')

  for (const chunk of chunks) {
    // 新路径优先；纯删除的文件没有 +++ b/ 行，跳过
    const newPath = /^\+\+\+ b\/(.+)$/m.exec(chunk)?.[1]
    if (newPath == null || newPath === '/dev/null') continue
    const hunkStart = chunk.indexOf('@@')
    if (hunkStart === -1) continue
    out.push([newPath.trim(), chunk.slice(hunkStart)])
  }
  return out
}

function writeReport(outPath: string, report: LintReport, note: string): void {
  const json = JSON.stringify(report)
  if (Buffer.byteLength(json, 'utf8') > MAX_REPORT_BYTES) {
    // 上传端第一道体积闸；消费端 review.ts 还有一道
    writeFileSync(outPath, JSON.stringify(EMPTY_REPORT), 'utf8')
    getLogger().info(
      `lint-report-cli: report exceeded ${MAX_REPORT_BYTES} bytes — emitted empty report`
    )
    return
  }
  writeFileSync(outPath, json, 'utf8')
  getLogger().info(
    `lint-report-cli: wrote ${report.results.length} finding(s) to ${outPath} (${note})`
  )
}

export async function run(argv: string[]): Promise<void> {
  const {args, error} = parseArgs(argv)
  if (args == null) {
    // 参数错误也要产出合法报告：调用方（workflow）已经把 --out 写死，
    // 这里拿不到路径时只能放弃写文件，由 workflow 的 fallback 兜底
    getLogger().error(`lint-report-cli: ${error}`)
    // 只有确实存在 --out 且其后跟着一个非 flag 值时才写兜底报告。
    // 早先用 `indexOf('--out') + 1` 取值：找不到时 indexOf 返回 -1，加一变成 0，
    // 于是把空报告写到 argv[0] 指向的路径——在 jest/ncc 这类宿主里会凭空造出文件。
    const outIndex = argv.indexOf('--out')
    const out = outIndex === -1 ? undefined : argv[outIndex + 1]
    if (out != null && out !== '' && !out.startsWith('--')) {
      writeFileSync(out, JSON.stringify(EMPTY_REPORT), 'utf8')
    }
    return
  }

  const repoRoot = resolve(args.repoRoot)
  if (!existsSync(repoRoot) || !statSync(repoRoot).isDirectory()) {
    writeReport(args.out, EMPTY_REPORT, `repo root not found: ${repoRoot}`)
    return
  }
  for (const sha of [args.baseSha, args.headSha]) {
    if (!commitExists(repoRoot, sha)) {
      writeReport(args.out, EMPTY_REPORT, `commit not present after checkout: ${sha}`)
      return
    }
  }

  if (!hasMergeBase(repoRoot, args.baseSha, args.headSha)) {
    writeReport(
      args.out,
      EMPTY_REPORT,
      `no merge base between ${args.baseSha} and ${args.headSha} — ` +
        'history is likely shallow (fetch base without --depth, or deepen until merge-base succeeds)'
    )
    return
  }

  let filesAndChanges: Array<[string, string, string, Array<[number, number, string]>]>
  try {
    const diff = git(repoRoot, [
      'diff',
      '--no-color',
      '--no-ext-diff',
      '--unified=3',
      `${args.baseSha}...${args.headSha}`
    ])
    filesAndChanges = splitDiffByFile(diff).map(([file, fileDiff]) => [file, '', fileDiff, []])
  } catch (e) {
    writeReport(args.out, EMPTY_REPORT, `git diff failed: ${String(e)}`)
    return
  }

  if (filesAndChanges.length === 0) {
    writeReport(args.out, EMPTY_REPORT, 'no changed files')
    return
  }

  const toolEnableOverrides =
    args.tools == null
      ? undefined
      : Object.fromEntries(
          args.tools
            .split(',')
            .map(t => t.trim())
            .filter(t => t !== '')
            .map(t => [t, true])
        )

  try {
    const report = await runLintTools({repoRoot, filesAndChanges, toolEnableOverrides})
    writeReport(args.out, report, `${filesAndChanges.length} changed file(s)`)
  } catch (e) {
    writeReport(args.out, EMPTY_REPORT, `lint run failed: ${String(e)}`)
  }
}
