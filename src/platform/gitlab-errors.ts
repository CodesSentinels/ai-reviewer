/**
 * platform/gitlab-errors.ts — GitLab 错误归一化契约（GLAPI-025/026/032）
 *
 * gitbeaker 的错误对象不是 IGitPlatform 语义，必须显式建立适配层契约：
 * - GitbeakerRequestError：`cause.response` 是 fetch Response（含 status/headers）
 * - GitbeakerTimeoutError：只有 name，没有 status（queryTimeout 触发）
 * - GitbeakerRetryError：SDK 内部对 429/502 重试耗尽后抛出，status 只在 message 里
 * - 原生网络错误：ECONNRESET/ETIMEDOUT/ENOTFOUND 等只有 message
 *
 * 归一化后：
 * - GLAPI-025：429 / 5xx / timeout / 网络错误 → 可重试
 * - GLAPI-026：401 / 403 → 不可重试，附带权限诊断
 * - 所有 message 经 redact() 脱敏后才进入 GitPlatformError（A5 日志脱敏）
 */

import {GitPlatformError, type GitPlatformErrorKind} from './git-platform'
import {redact} from '../gitlab-trigger-redact'

/** 可重试的错误类别（GLAPI-025） */
const RETRYABLE_KINDS: ReadonlySet<GitPlatformErrorKind> = new Set<GitPlatformErrorKind>([
  'rate_limited',
  'server_error',
  'timeout'
])

export function isRetryableErrorKind(kind: GitPlatformErrorKind): boolean {
  return RETRYABLE_KINDS.has(kind)
}

/** 从各种 gitbeaker/fetch 错误形态中提取 HTTP status */
export function extractStatus(e: unknown): number | undefined {
  const anyErr = e as any
  const candidates = [
    anyErr?.cause?.response?.status,
    anyErr?.response?.status,
    anyErr?.status,
    anyErr?.statusCode
  ]
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c)) return c
  }
  // GitbeakerRetryError：状态码只出现在 message 里
  const msg = e instanceof Error ? e.message : String(e)
  const m = /last status code:\s*(\d{3})/i.exec(msg)
  if (m) return Number(m[1])
  return undefined
}

/**
 * 提取 Retry-After（秒或 HTTP-date），返回毫秒。
 * 429 常带该 header，尊重它比盲目指数退避更快恢复，也更礼貌。
 */
export function extractRetryAfterMS(e: unknown, now: number = Date.now()): number | undefined {
  const headers = (e as any)?.cause?.response?.headers ?? (e as any)?.response?.headers
  if (headers == null) return undefined

  let raw: string | null | undefined
  if (typeof headers.get === 'function') raw = headers.get('retry-after')
  else raw = headers['retry-after'] ?? headers['Retry-After']
  if (raw == null || raw === '') return undefined

  if (/^\d+$/.test(String(raw).trim())) return Number(raw) * 1000

  const at = Date.parse(String(raw))
  if (Number.isNaN(at)) return undefined
  return Math.max(0, at - now)
}

/** 判断是否为网络层错误（无 HTTP status） */
function isNetworkErrorMessage(msg: string): boolean {
  return /ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|socket hang up|network|fetch failed|timed?\s?out/i.test(
    msg
  )
}

/**
 * GLAPI-026：401/403 的权限诊断。
 *
 * 不重试，并给出可操作的排查方向；不输出 token 本身。
 */
export function permissionDiagnostics(status: number, detail: string): string {
  const base =
    status === 401
      ? 'GitLab authentication failed (401): token is missing, expired, or revoked'
      : 'GitLab authorization failed (403): token lacks the required scope or project access level'
  const hints =
    status === 401
      ? 'check GITLAB_PAT / CI_JOB_TOKEN is set on the trigger job and still valid'
      : 'check the token has `api` scope and at least Reporter (read) / Developer (write) on the project'
  const suffix = detail.trim() === '' ? '' : ` — ${detail.trim()}`
  return `${base}${suffix}; ${hints}. Not retrying.`
}

/**
 * 把任意 GitLab 侧错误归一化为 GitPlatformError（GLAPI-032）。
 *
 * 已经是 GitPlatformError 的直接返回，避免多层包装丢失原始 kind。
 */
export function normalizeGitLabError(e: unknown, operation?: string): GitPlatformError {
  if (e instanceof GitPlatformError) return e

  const rawMsg = e instanceof Error ? e.message : String(e)
  const name = e instanceof Error ? e.name : ''
  const status = extractStatus(e)

  let kind: GitPlatformErrorKind = 'unknown'
  if (status === 401 || status === 403) kind = 'forbidden'
  else if (status === 404) kind = 'not_found'
  else if (status === 409) kind = 'conflict'
  else if (status === 429) kind = 'rate_limited'
  else if (status != null && status >= 500) kind = 'server_error'
  else if (status == null) {
    if (name === 'GitbeakerTimeoutError' || name === 'TimeoutError' || name === 'AbortError') {
      kind = 'timeout'
    } else if (isNetworkErrorMessage(rawMsg)) {
      kind = 'timeout'
    }
  }

  const detail = redact(rawMsg)
  const prefix = operation == null || operation === '' ? '' : `${operation}: `
  const message =
    status === 401 || status === 403
      ? `${prefix}${permissionDiagnostics(status, detail)}`
      : `${prefix}${detail}`

  return new GitPlatformError(message, kind, status, e)
}
