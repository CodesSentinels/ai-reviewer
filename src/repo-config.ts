/**
 * repo-config.ts - 仓库级配置 `.ai-reviewer.yml`（issue #231）
 *
 * 分层：基线（CONFIG_DEFAULTS）→ 仓库配置。仓库层只能在白名单内追加或收窄：
 * - system_message：只能 `system_message_append` 追加，没有整体替换的入口
 * - path_filters / path_instructions：追加到基线之后；排除规则命中即排除，
 *   所以仓库无法把基线已排除的文件重新纳入
 * - 其余白名单字段是标量，仓库值覆盖基线值
 *
 * 安全：文件只从目标分支（base）读取，绝不读 PR head——pull_request_target 持有
 * 密钥，head 内容由 PR 作者控制。读取失败、格式错误、超限一律回退基线，不让审查失败。
 *
 * 本文件不依赖 @actions/core，两个平台共用。
 */

import {CORE_SCHEMA, load} from 'js-yaml'
import type {ExecutionContext} from './platform/execution-context'
import type {IGitPlatform} from './platform/git-platform'
import {repoCoordsOf} from './platform/run-context'

export const REPO_CONFIG_PATH = '.ai-reviewer.yml'
export const REPO_CONFIG_MAX_BYTES = 64 * 1024

/** 仓库层可设置的字段（已规范化为 Options 使用的形态） */
export interface RepoConfig {
  pathFilters?: string[]
  /** 每项是一条 `<glob>: <指令>`，直接交给 PathInstructions */
  pathInstructions?: string[]
  systemMessageAppend?: string
  language?: string
  reviewSimpleChanges?: boolean
  reviewCommentLGTM?: boolean
  maxFiles?: number
  maxReviewComments?: number
  enableDependencyAnalysis?: boolean
  maxDependencyFiles?: number
}

export interface ParsedRepoConfig {
  config: RepoConfig
  warnings: string[]
}

/** 出现在仓库配置里会被忽略并 warning 的字段：执行面、外发地址、绕过审查或运维项 */
const FORBIDDEN_KEYS = new Set([
  'openai_base_url',
  'enable_shell',
  'enable_lint_tools',
  'enable_eslint',
  'enable_biome',
  'enable_tsc',
  'enable_prettier',
  'enable_semgrep',
  'eslint_version',
  'biome_version',
  'tsc_version',
  'prettier_version',
  'semgrep_version',
  'semgrep_config',
  'lint_report_path',
  'disable_review',
  'disable_release_notes',
  'system_message',
  'summarize',
  'summarize_release_notes',
  'openai_light_model',
  'openai_heavy_model',
  'openai_model_temperature',
  'openai_retries',
  'openai_timeout_ms',
  'openai_concurrency_limit',
  'github_concurrency_limit',
  'enable_web_search',
  'bot_icon',
  'bot_name',
  'bot_github_login',
  'command_ack_reaction',
  'warn_files',
  'initial_pr_summary_only',
  'debug',
  'debug_resolve_inject_failures'
])

function asStringList(v: unknown, key: string, warnings: string[]): string[] | undefined {
  if (typeof v === 'string') {
    return v.split('\n').filter(l => l.trim().length > 0)
  }
  if (Array.isArray(v) && v.every(x => typeof x === 'string')) {
    return (v as string[]).filter(l => l.trim().length > 0)
  }
  warnings.push(`${key}: expected a list of strings, ignored`)
  return undefined
}

function asNonNegativeInt(v: unknown, key: string, warnings: string[]): number | undefined {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return v
  warnings.push(`${key}: expected a non-negative integer, ignored`)
  return undefined
}

function asBool(v: unknown, key: string, warnings: string[]): boolean | undefined {
  if (typeof v === 'boolean') return v
  warnings.push(`${key}: expected true/false, ignored`)
  return undefined
}

/**
 * 解析 `.ai-reviewer.yml` 文本。纯函数：任何问题都落成 warning，绝不抛错。
 * 整体无法解析（超限、非 YAML、非映射、版本不认识）时返回空配置。
 */
export function parseRepoConfig(text: string): ParsedRepoConfig {
  const warnings: string[] = []
  const empty: ParsedRepoConfig = {config: {}, warnings}

  if (Buffer.byteLength(text, 'utf8') > REPO_CONFIG_MAX_BYTES) {
    warnings.push(`${REPO_CONFIG_PATH}: larger than ${REPO_CONFIG_MAX_BYTES} bytes, ignored`)
    return empty
  }

  let doc: unknown
  try {
    // CORE_SCHEMA：不解析时间戳、二进制等扩展类型，只保留基础类型
    doc = load(text, {schema: CORE_SCHEMA})
  } catch (e) {
    warnings.push(`${REPO_CONFIG_PATH}: invalid YAML, ignored (${(e as Error).message})`)
    return empty
  }

  if (doc == null) return empty
  if (typeof doc !== 'object' || Array.isArray(doc)) {
    warnings.push(`${REPO_CONFIG_PATH}: top level must be a mapping, ignored`)
    return empty
  }

  const raw = doc as Record<string, unknown>
  if ('version' in raw && raw.version !== 1) {
    warnings.push(`${REPO_CONFIG_PATH}: unsupported version ${String(raw.version)}, ignored`)
    return empty
  }

  const config: RepoConfig = {}
  for (const [key, value] of Object.entries(raw)) {
    switch (key) {
      case 'version':
        break
      case 'path_filters': {
        const list = asStringList(value, key, warnings)
        if (list) config.pathFilters = list
        break
      }
      case 'path_instructions': {
        if (value != null && typeof value === 'object' && !Array.isArray(value)) {
          const lines: string[] = []
          for (const [glob, ins] of Object.entries(value as Record<string, unknown>)) {
            if (typeof ins !== 'string' || !ins.trim()) {
              warnings.push(
                `path_instructions: instruction for "${glob}" must be a string, ignored`
              )
              continue
            }
            lines.push(`${glob}: ${ins}`)
          }
          config.pathInstructions = lines
        } else {
          const list = asStringList(value, key, warnings)
          if (list) config.pathInstructions = list
        }
        break
      }
      case 'system_message_append':
        if (typeof value === 'string') {
          if (value.trim()) config.systemMessageAppend = value.trim()
        } else {
          warnings.push(`${key}: expected a string, ignored`)
        }
        break
      case 'language':
        if (typeof value === 'string' && value.trim()) config.language = value.trim()
        else warnings.push(`${key}: expected a non-empty string, ignored`)
        break
      case 'review_simple_changes': {
        const b = asBool(value, key, warnings)
        if (b !== undefined) config.reviewSimpleChanges = b
        break
      }
      case 'review_comment_lgtm': {
        const b = asBool(value, key, warnings)
        if (b !== undefined) config.reviewCommentLGTM = b
        break
      }
      case 'enable_dependency_analysis': {
        const b = asBool(value, key, warnings)
        if (b !== undefined) config.enableDependencyAnalysis = b
        break
      }
      case 'max_files': {
        const n = asNonNegativeInt(value, key, warnings)
        if (n !== undefined) config.maxFiles = n
        break
      }
      case 'max_review_comments': {
        const n = asNonNegativeInt(value, key, warnings)
        if (n !== undefined) config.maxReviewComments = n
        break
      }
      case 'max_dependency_files': {
        const n = asNonNegativeInt(value, key, warnings)
        if (n !== undefined) config.maxDependencyFiles = n
        break
      }
      default:
        if (FORBIDDEN_KEYS.has(key)) {
          warnings.push(`${key}: not allowed in ${REPO_CONFIG_PATH}, ignored`)
        } else {
          warnings.push(`${key}: unknown field, ignored`)
        }
    }
  }

  return {config, warnings}
}

/** 供日志使用：列出仓库层实际生效的字段名（不含值，避免把整段指令刷进日志） */
export function describeRepoConfig(config: RepoConfig): string[] {
  const out: string[] = []
  if (config.pathFilters?.length) out.push(`path_filters(+${config.pathFilters.length})`)
  if (config.pathInstructions?.length) {
    out.push(`path_instructions(+${config.pathInstructions.length})`)
  }
  if (config.systemMessageAppend) out.push('system_message_append')
  if (config.language !== undefined) out.push('language')
  if (config.reviewSimpleChanges !== undefined) out.push('review_simple_changes')
  if (config.reviewCommentLGTM !== undefined) out.push('review_comment_lgtm')
  if (config.maxFiles !== undefined) out.push('max_files')
  if (config.maxReviewComments !== undefined) out.push('max_review_comments')
  if (config.enableDependencyAnalysis !== undefined) out.push('enable_dependency_analysis')
  if (config.maxDependencyFiles !== undefined) out.push('max_dependency_files')
  return out
}

export interface RepoConfigLogger {
  info(msg: string): void
  warning(msg: string): void
}

/**
 * 读取并解析目标分支上的 `.ai-reviewer.yml`。
 *
 * 读取版本：优先 PR/MR 的 base commit SHA，其次目标分支名。两者都不是 PR head，
 * PR 作者改不了。注意 ExecutionContext.baseSha 在评论事件里为空，GitLab MR 事件里
 * 也不是 base，所以统一经 getChangeRequest 取。
 *
 * 返回 null 表示没有可用的仓库配置（文件不存在，或读取失败——后者已 warning）。
 */
export async function loadRepoConfig(
  platform: Pick<IGitPlatform, 'getChangeRequest' | 'getFileContent'>,
  ctx: ExecutionContext,
  log: RepoConfigLogger
): Promise<RepoConfig | null> {
  let text: string | null
  try {
    const {owner, repo} = repoCoordsOf(ctx)
    // GitHub 的 PR 事件自带 base.sha，省一次 API 调用；评论事件为空，GitLab 的
    // baseSha 字段是 oldrev 而不是 base，这两种情况都经 getChangeRequest 取。
    let ref = ctx.platform === 'github' ? ctx.baseSha : ''
    if (!ref) {
      const cr = await platform.getChangeRequest(owner, repo, ctx.changeRequestId)
      ref = cr.baseSha || cr.baseRef
    }
    if (!ref) {
      log.warning(`repo-config: no base ref for #${ctx.changeRequestId}, using baseline only`)
      return null
    }
    text = await platform.getFileContent(owner, repo, REPO_CONFIG_PATH, ref)
  } catch (e) {
    log.warning(
      `repo-config: could not read ${REPO_CONFIG_PATH} (${
        (e as Error).message
      }), using baseline only`
    )
    return null
  }

  if (text == null) {
    log.info(`repo-config: no ${REPO_CONFIG_PATH} on base branch, using baseline only`)
    return null
  }

  const {config, warnings} = parseRepoConfig(text)
  for (const w of warnings) log.warning(`repo-config: ${w}`)
  const applied = describeRepoConfig(config)
  log.info(`repo-config: applied from ${REPO_CONFIG_PATH}: ${applied.join(', ') || '(none)'}`)
  return config
}
