/**
 * review-tools.ts - 审查时供模型调用的只读代码探查工具
 *
 * 本地 shell 不可用时（GitLab trigger 强制关闭，CFG-002），模型无法像 GitHub 侧
 * 那样 `cat` / `grep` 仓库来确认跨文件上下文。这里改为提供三个**只读**的函数
 * 工具，底层走平台 API（IGitPlatform），不执行任何代码：
 *
 *   - read_file       读取文件（可指定行范围），版本为本次变更的 HEAD
 *   - list_directory  列出一层目录，版本为本次变更的 HEAD
 *   - search_code     在仓库中搜索代码（平台索引的默认分支）
 *
 * 安全约束：
 * - 只访问当前审查的项目（坐标来自受信任的 ExecutionContext，不来自模型参数）
 * - 输出有硬上限，超出即截断并注明
 * - 回传给模型之前做密钥脱敏（与日志出口同一套规则）：仓库里若误提交了密钥，
 *   不会因为模型读了这个文件就被发往模型服务
 * - 任何失败都以文本形式返回给模型（让它调整探查方式），不向上抛错
 */
import type OpenAI from 'openai'
import type {AnalysisStep} from './bot'
import {getPlatform} from './platform/git-platform'
import {getExecCtx, repoCoordsOf} from './platform/run-context'
import {redactString} from './redact'

export const REVIEW_TOOL_NAMES = ['read_file', 'list_directory', 'search_code'] as const
export type ReviewToolName = (typeof REVIEW_TOOL_NAMES)[number]

export const REVIEW_TOOL_LIMITS = {
  readFileMaxLines: 400,
  readFileMaxChars: 24_000,
  listDirectoryMaxEntries: 200,
  searchMaxHits: 20,
  searchSnippetMaxChars: 300
} as const

/** Responses API 的函数工具声明 */
export function reviewToolDefinitions(): OpenAI.Responses.FunctionTool[] {
  return [
    {
      type: 'function',
      name: 'read_file',
      description:
        'Read a file from the repository at the head commit of the change under review. ' +
        `Returns numbered lines (at most ${REVIEW_TOOL_LIMITS.readFileMaxLines} lines per call). ` +
        'Use start_line / end_line to read a specific range of a large file.',
      strict: false,
      parameters: {
        type: 'object',
        properties: {
          path: {type: 'string', description: 'Repository-relative file path'},
          start_line: {type: 'integer', description: 'First line to read (1-based, optional)'},
          end_line: {type: 'integer', description: 'Last line to read (inclusive, optional)'}
        },
        required: ['path'],
        additionalProperties: false
      }
    },
    {
      type: 'function',
      name: 'list_directory',
      description:
        'List the entries (one level) of a directory at the head commit of the change under review. ' +
        'Use an empty string for the repository root.',
      strict: false,
      parameters: {
        type: 'object',
        properties: {
          path: {type: 'string', description: 'Repository-relative directory path'}
        },
        required: ['path'],
        additionalProperties: false
      }
    },
    {
      type: 'function',
      name: 'search_code',
      description:
        'Search the repository for code containing the given text, e.g. to find where a function ' +
        "is used. Searches the platform's index of the default branch, so it does not include the " +
        'new code of the change under review.',
      strict: false,
      parameters: {
        type: 'object',
        properties: {
          query: {type: 'string', description: 'Text to search for (e.g. an identifier)'}
        },
        required: ['query'],
        additionalProperties: false
      }
    }
  ]
}

export function isReviewToolName(name: string): name is ReviewToolName {
  return (REVIEW_TOOL_NAMES as readonly string[]).includes(name)
}

export interface ReviewToolResult {
  /** 回传给模型的文本（已截断、已脱敏） */
  output: string
  /** 记入 Analysis chain 的步骤 */
  step: AnalysisStep
}

/** 仓库相对路径的基本校验：只允许普通相对路径 */
function normalizeRepoPath(raw: unknown, allowRoot: boolean): string | null {
  if (typeof raw !== 'string') return null
  const p = raw
    .trim()
    .replace(/^\.\/+/, '')
    .replace(/\/+$/, '')
  if (p === '' || p === '.') return allowRoot ? '' : null
  if (p.startsWith('/') || p.includes('\\') || p.includes('\0')) return null
  if (p.split('/').some(seg => seg === '' || seg === '..')) return null
  return p
}

function positiveInt(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null
}

async function readFile(args: Record<string, unknown>): Promise<ReviewToolResult> {
  const path = normalizeRepoPath(args.path, false)
  if (path == null) {
    return fail({type: 'read_file', path: String(args.path ?? '')}, 'invalid path')
  }
  const ctx = getExecCtx()
  const {owner, repo} = repoCoordsOf(ctx)
  const content = await getPlatform().getFileContent(owner, repo, path, ctx.headSha)
  if (content == null) {
    return fail({type: 'read_file', path}, `file not found at head commit: ${path}`)
  }
  const lines = content.split('\n')
  const start = Math.min(positiveInt(args.start_line) ?? 1, Math.max(lines.length, 1))
  const requestedEnd = positiveInt(args.end_line) ?? lines.length
  const end = Math.min(
    Math.max(requestedEnd, start),
    lines.length,
    start + REVIEW_TOOL_LIMITS.readFileMaxLines - 1
  )

  let body = lines
    .slice(start - 1, end)
    .map((l, i) => `${start + i}: ${l}`)
    .join('\n')
  const notes: string[] = []
  if (end < Math.min(requestedEnd, lines.length)) {
    notes.push(`truncated at line ${end}; call again with start_line=${end + 1} to continue`)
  }
  if (body.length > REVIEW_TOOL_LIMITS.readFileMaxChars) {
    body = body.slice(0, REVIEW_TOOL_LIMITS.readFileMaxChars)
    notes.push('truncated by size limit')
  }
  const header = `${path} (lines ${start}-${end} of ${lines.length})`
  return {
    output: redactString([header, body, ...notes.map(n => `[${n}]`)].join('\n')),
    step: {type: 'read_file', path, startLine: start, endLine: end}
  }
}

async function listDirectory(args: Record<string, unknown>): Promise<ReviewToolResult> {
  const path = normalizeRepoPath(args.path ?? '', true)
  if (path == null) {
    return fail({type: 'list_directory', path: String(args.path ?? '')}, 'invalid path')
  }
  const ctx = getExecCtx()
  const {owner, repo} = repoCoordsOf(ctx)
  // 根目录只能取全量树再筛出第一层（带路径时平台接口本身只查一层）
  const tree = await getPlatform().listRepositoryTree(
    owner,
    repo,
    ctx.headSha,
    path === '' ? undefined : path
  )
  const prefix = path === '' ? '' : `${path}/`
  const entries = tree.entries
    .filter(e => typeof e.path === 'string' && e.path.startsWith(prefix))
    .filter(e => !(e.path as string).slice(prefix.length).includes('/'))
    .map(e => `${e.path}${e.type === 'tree' ? '/' : ''}`)
    .sort()
  const shown = entries.slice(0, REVIEW_TOOL_LIMITS.listDirectoryMaxEntries)
  const notes: string[] = []
  if (entries.length > shown.length) notes.push(`showing ${shown.length} of ${entries.length}`)
  if (tree.truncated) notes.push('the platform reported a truncated listing')
  return {
    output: redactString(
      [`${path === '' ? '(root)' : path}/`, ...shown, ...notes.map(n => `[${n}]`)].join('\n')
    ),
    step: {type: 'list_directory', path, resultCount: entries.length}
  }
}

async function searchCode(args: Record<string, unknown>): Promise<ReviewToolResult> {
  const query = typeof args.query === 'string' ? args.query.trim() : ''
  if (query === '') return fail({type: 'search_code', query: ''}, 'empty query')
  const {owner, repo} = repoCoordsOf(getExecCtx())
  const hits = await getPlatform().searchCode(owner, repo, query, REVIEW_TOOL_LIMITS.searchMaxHits)
  const body = hits.map(h => {
    const where = h.startLine != null ? `${h.path}:${h.startLine}` : h.path
    const snippet = h.snippet.trim().slice(0, REVIEW_TOOL_LIMITS.searchSnippetMaxChars)
    return snippet === '' ? `- ${where}` : `- ${where}\n${snippet}`
  })
  return {
    output: redactString(
      hits.length === 0 ? `no results for: ${query}` : [`results for: ${query}`, ...body].join('\n')
    ),
    step: {type: 'search_code', query, resultCount: hits.length}
  }
}

function fail(step: AnalysisStep, message: string): ReviewToolResult {
  return {output: `error: ${message}`, step: {...step, error: message}}
}

/**
 * 执行一次模型发起的工具调用。未知工具、参数不是合法 JSON、平台调用失败，
 * 都以 `error: …` 文本返回，不抛错。
 */
export async function executeReviewTool(
  name: string,
  argumentsJson: string
): Promise<ReviewToolResult> {
  let args: Record<string, unknown>
  try {
    const parsed = JSON.parse(argumentsJson === '' ? '{}' : argumentsJson)
    args = parsed != null && typeof parsed === 'object' ? parsed : {}
  } catch {
    return fail({type: 'read_file', path: ''}, `arguments are not valid JSON for ${name}`)
  }
  try {
    switch (name) {
      case 'read_file':
        return await readFile(args)
      case 'list_directory':
        return await listDirectory(args)
      case 'search_code':
        return await searchCode(args)
      default:
        return fail({type: 'read_file', path: ''}, `unknown tool: ${name}`)
    }
  } catch (e) {
    const message = redactString(e instanceof Error ? e.message : String(e)).slice(0, 300)
    const base: AnalysisStep =
      name === 'search_code'
        ? {type: 'search_code', query: String(args.query ?? '')}
        : {
            type: name === 'list_directory' ? 'list_directory' : 'read_file',
            path: String(args.path ?? '')
          }
    return fail(base, message)
  }
}
