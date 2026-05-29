/**
 * unit-test/change-analyzer.ts - 从 PR diff 中抽取测试目标
 *
 * 对应迭代四 §2.2「变更代码分析」。
 *
 * 设计要点:
 * - 输入: 一个 PR 文件级 diff 描述（文件路径 + patch 文本）。
 * - 输出: TestTarget[] —— 新增/修改的函数/类/方法等。
 * - 解析策略:
 *   1. 通过文件后缀判定语言
 *   2. 在 patch 中扫描 "+ " 开头的行（新增/修改），对应 +/- 的修改对作为"修改"
 *   3. 用正则识别 function / class / 方法签名
 *   4. 不做 AST 解析（一期成本控制）；保留可扩展接口
 *
 * 不在本模块的职责:
 * - 不读取磁盘上的源文件（context-collector 负责）
 * - 不判断已有测试是否存在（test-path-resolver 与 context-collector 配合判断）
 */
import type {SourceLanguage, TestTarget} from './types'

/** PR 中的单个文件 diff（与 octokit 的 listFiles 字段对齐，仅保留必要项） */
export interface DiffFile {
  filename: string
  status?: 'added' | 'modified' | 'removed' | 'renamed' | string
  patch?: string
}

const EXT_LANG_MAP: Record<string, SourceLanguage> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  go: 'go'
}

/** 路径推断语言；未知 → 'unknown' */
export function detectLanguageByPath(filePath: string): SourceLanguage {
  const m = /\.([A-Za-z0-9]+)$/.exec(filePath)
  if (!m) return 'unknown'
  return EXT_LANG_MAP[m[1].toLowerCase()] ?? 'unknown'
}

/** 应跳过的路径模式（已有测试文件、配置、生成产物等） */
const IGNORE_PATH_RE = [
  /(^|\/)__tests__\//,
  /(^|\/)tests?\//,
  /\.test\.(t|j)sx?$/,
  /\.spec\.(t|j)sx?$/,
  /_test\.go$/,
  /(^|\/)test_[^/]+\.py$/,
  /(^|\/)tests?_[^/]+\.py$/,
  /(^|\/)dist\//,
  /(^|\/)build\//,
  /(^|\/)node_modules\//,
  /(^|\/)\.git\//
]

export function shouldSkipPath(filePath: string): boolean {
  return IGNORE_PATH_RE.some(re => re.test(filePath))
}

/**
 * 在 unified diff 文本中提取"被加号触及"的代码片段。
 * 返回新增行（含上下文行）的合并文本，便于后续正则识别。
 */
function collectAddedLines(patch: string): string {
  const out: string[] = []
  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (line.startsWith('@@')) continue
    if (line.startsWith('+')) {
      out.push(line.slice(1))
    }
  }
  return out.join('\n')
}

/**
 * 各语言的"目标符号"匹配规则。
 *
 * 设计:
 * - 所有正则同时带 `g` 与 `m` 标志，便于通过 String.prototype.matchAll 一次遍历
 *   出整段文本中所有匹配（避免 exec + slice 的累计推进逻辑及其零宽匹配死循环风险）。
 * - 每条规则的捕获组 `[1]` 必须是符号名。
 */

/** JS/TS 函数签名（含箭头函数 / 类方法 / export const = function） */
const JSTS_PATTERNS: Array<{kind: TestTarget['kind']; re: RegExp}> = [
  // class Foo { ... } 或 export class Foo { ... }
  {kind: 'class', re: /^\s*(?:export\s+(?:default\s+)?)?(?:abstract\s+)?class\s+([A-Z][A-Za-z0-9_]*)/gm},
  // function foo() { ... }
  {kind: 'function', re: /^\s*(?:export\s+(?:default\s+)?)?(?:async\s+)?function\*?\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/gm},
  // const foo = (...) => { ... } / const foo = async (...) =>
  {kind: 'function', re: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*[:=]\s*(?:async\s*)?\(/gm},
  // 类内方法（粗略）：以缩进开头的 methodName(...) {
  {kind: 'method', re: /^\s+(?:public|private|protected|static|async)?\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\([^)]*\)\s*[:{]/gm}
]

const PY_PATTERNS: Array<{kind: TestTarget['kind']; re: RegExp}> = [
  // class Foo:
  {kind: 'class', re: /^\s*class\s+([A-Z][A-Za-z0-9_]*)\s*[:(]/gm},
  // def foo(...):
  {kind: 'function', re: /^\s*def\s+([a-z_][A-Za-z0-9_]*)\s*\(/gm}
]

const GO_PATTERNS: Array<{kind: TestTarget['kind']; re: RegExp}> = [
  // func Foo(...) ... { 或 func (r *Recv) Foo(...) ...
  {kind: 'function', re: /^\s*func\s+(?:\([^)]+\)\s+)?([A-Z][A-Za-z0-9_]*)\s*\(/gm}
]

function patternsByLang(
  lang: SourceLanguage
): Array<{kind: TestTarget['kind']; re: RegExp}> {
  switch (lang) {
    case 'typescript':
    case 'javascript':
      return JSTS_PATTERNS
    case 'python':
      return PY_PATTERNS
    case 'go':
      return GO_PATTERNS
    default:
      return []
  }
}

/**
 * 从一组 PR diff 文件中抽取测试目标
 *
 * @param files PR 文件级 diff 列表（来自 octokit.pulls.listFiles）
 * @returns 去重后的 TestTarget 列表
 */
export function extractTestTargets(files: DiffFile[]): TestTarget[] {
  const targets: TestTarget[] = []
  const seen = new Set<string>()

  for (const file of files) {
    if (!file.filename) continue
    if (shouldSkipPath(file.filename)) continue
    if (file.status === 'removed') continue
    if (!file.patch) continue

    const lang = detectLanguageByPath(file.filename)
    if (lang === 'unknown') continue

    const addedText = collectAddedLines(file.patch)
    if (!addedText.trim()) continue

    const patterns = patternsByLang(lang)
    for (const {kind, re} of patterns) {
      // re 必须带 /g —— matchAll 内部维护 lastIndex，零宽匹配场景由 V8 保证推进
      for (const m of addedText.matchAll(re)) {
        const name = m[1]
        if (!name) continue
        const key = `${file.filename}::${kind}::${name}`
        if (seen.has(key)) continue
        seen.add(key)
        targets.push({
          name,
          kind,
          filePath: file.filename,
          language: lang,
          // 文件 status=added 时整文件视为新增；否则按目标符号是否新出现近似判定
          isNew: file.status === 'added',
          priority: kind === 'class' || kind === 'function' ? 'P0' : 'P1'
        })
      }
    }
  }

  return targets
}

/**
 * 根据命令参数过滤目标（支持 `--function NAME` 或裸文件路径作为正参数）
 */
export function filterTargetsByArgs(
  targets: TestTarget[],
  args: string[],
  kv: Record<string, string>
): TestTarget[] {
  const wantedFunction = kv['--function'] ?? kv['function']
  // 正参数中没有 -- 开头的视为路径过滤
  const wantedPaths = args.filter(a => !a.startsWith('--'))

  let filtered = targets
  if (wantedFunction) {
    filtered = filtered.filter(t => t.name === wantedFunction)
  }
  if (wantedPaths.length > 0) {
    filtered = filtered.filter(t =>
      wantedPaths.some(p => t.filePath === p || t.filePath.endsWith(p))
    )
  }
  return filtered
}
