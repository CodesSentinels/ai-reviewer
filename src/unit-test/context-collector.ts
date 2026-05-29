/**
 * unit-test/context-collector.ts - 测试生成上下文收集
 *
 * 对应迭代四 §2.4「上下文收集（关键步骤）」。
 *
 * 收集内容（best-effort，IO 失败不抛异常，仅降级）:
 *   1. 目标源代码（完整函数/类源码，不仅 diff）
 *   2. 同目录已有测试样例（最多 2 段，用于风格参考）
 *   3. 类型定义片段（从 import 推断的近邻 d.ts / 接口）
 *
 * 实现要点:
 * - 通过注入式 FS 抽象 (FsReader) 解耦运行时与 git checkout 实际路径
 * - 单元测试可传入 in-memory FsReader
 */
import type {ProjectTestContext, TestTarget} from './types'

/** 文件系统访问的最小接口 */
export interface FsReader {
  /** 返回 null 表示文件不存在或不可读 */
  readFile(relativePath: string): Promise<string | null>
  /** 列出目录下匹配 suffix 的文件（递归与否由实现自行决定） */
  list(prefix: string, suffix: string): Promise<string[]>
}

/** 收集目标完整源码：返回 target.sourceSnippet（已就地补齐） */
export async function fillSourceSnippet(
  target: TestTarget,
  fs: FsReader,
  maxLines = 200
): Promise<TestTarget> {
  if (target.sourceSnippet) return target
  const content = await fs.readFile(target.filePath)
  if (!content) return target

  // 尝试用启发式定位目标函数/类所在区块（首次出现的签名 → 下一个顶层签名前）
  const snippet = extractBlock(content, target.name, maxLines)
  return {...target, sourceSnippet: snippet ?? truncate(content, maxLines)}
}

/** 收集同目录或同包内的已有测试样例 */
export async function collectProjectTestContext(
  target: TestTarget,
  fs: FsReader
): Promise<ProjectTestContext> {
  const dir = parentDir(target.filePath)

  // 优先在 __tests__ 子目录或同目录寻找 *.test.* / *.spec.*
  const candidates = await fs.list(dir, '.test.')
  const specs = await fs.list(dir, '.spec.')
  const pyTests = await fs.list(dir, '.py')

  const sampleTestFiles = unique([
    ...candidates,
    ...specs,
    ...pyTests.filter(p => /\/test_[^/]+\.py$/.test(p))
  ]).slice(0, 3)

  const sampleTestSnippets: ProjectTestContext['sampleTestSnippets'] = []
  for (const p of sampleTestFiles.slice(0, 2)) {
    const content = await fs.readFile(p)
    if (content) {
      sampleTestSnippets.push({path: p, content: truncate(content, 120)})
    }
  }

  // 启发式：是否使用 __tests__/ 目录
  const usesUnderscoreTests = sampleTestFiles.some(p => /__tests__\//.test(p))
  const patternHint = sampleTestSnippets.some(s => /\bdescribe\(/.test(s.content))
    ? 'BDD describe/it'
    : sampleTestSnippets.some(s => /\bdef\s+test_/.test(s.content))
      ? 'pytest test_'
      : undefined

  return {
    sampleTestFiles,
    sampleTestSnippets,
    testDirectoryHint: usesUnderscoreTests ? '__tests__' : undefined,
    patternHint
  }
}

/** 抽取类型定义片段（截取 import 行 + 同文件首部声明） */
export function extractTypeContext(sourceCode: string, maxLines = 40): string {
  const lines = sourceCode.split(/\r?\n/)
  const out: string[] = []
  for (const line of lines) {
    if (/^\s*(import|from\s+[^\s]+\s+import|type\s|interface\s|export\s+type|export\s+interface)/.test(line)) {
      out.push(line)
    }
    if (out.length >= maxLines) break
  }
  return out.join('\n')
}

// ------------------------- helpers -------------------------

function parentDir(p: string): string {
  const i = p.lastIndexOf('/')
  return i >= 0 ? p.slice(0, i) : ''
}

function unique<T>(xs: T[]): T[] {
  return Array.from(new Set(xs))
}

function truncate(s: string, maxLines: number): string {
  const lines = s.split(/\r?\n/)
  if (lines.length <= maxLines) return s
  return `${lines.slice(0, maxLines).join('\n')}\n// ... (truncated, ${lines.length - maxLines} more lines)`
}

/**
 * 从源文件中提取以 name 为名的函数/类块。
 * 启发式：
 * - 找到第一处包含 `name(`、`name =`、`class name`、`def name(`、`func name(` 的行作为锚点
 * - 向下读取直到遇到与锚点同级缩进的下一个顶层声明
 *
 * 导出仅为可测；常规使用请走 `fillSourceSnippet`。
 */
export function extractBlock(
  content: string,
  name: string,
  maxLines: number
): string | null {
  const lines = content.split(/\r?\n/)
  const anchorRe = new RegExp(
    String.raw`(\bclass\s+${escapeRe(name)}\b|\bfunction\s+${escapeRe(name)}\b|\bdef\s+${escapeRe(name)}\b|\bfunc\s+(?:\([^)]+\)\s+)?${escapeRe(name)}\b|\b${escapeRe(name)}\s*[:=]\s*(?:async\s*)?\(|\b${escapeRe(name)}\s*\()`
  )

  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (anchorRe.test(lines[i])) {
      start = i
      break
    }
  }
  if (start < 0) return null

  const baseIndent = leadingSpaces(lines[start])
  const end = Math.min(lines.length, start + maxLines)
  // 简易终止：遇到同/更浅缩进的顶层声明（不含初始行本身）
  const stopRe = /^\s*(?:export\s+)?(?:(?:async\s+)?function|class|const|let|var|def|func)\b/
  let stop = end
  for (let i = start + 1; i < end; i++) {
    if (leadingSpaces(lines[i]) <= baseIndent && stopRe.test(lines[i])) {
      stop = i
      break
    }
  }
  return lines.slice(start, stop).join('\n')
}

function leadingSpaces(s: string): number {
  const m = /^[\t ]*/.exec(s)
  return m ? m[0].length : 0
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
