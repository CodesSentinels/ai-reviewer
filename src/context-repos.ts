/**
 * context-repos.ts - 审查时可只读访问的「上下文仓库」（仅 GitLab）
 *
 * 业务项目常把公共代码放在另一个仓库（例如被审仓库经相对路径引用上层主仓的公共层），
 * 只读被审仓库时，模型看不到这些代码，容易把「看不到」当成「不存在」而产生误报。
 * 这里允许运维方为某个项目配置若干只读的上下文仓库，探查工具（read_file /
 * list_directory / search_code）通过 `repo` 参数访问它们。
 *
 * 配置（CI 变量，受信任来源；仓库内的 .ai-reviewer.yml 无权配置）：
 *
 *   AI_REVIEWER_CONTEXT_REPOS =
 *     group/web/app = group/web/shared-lib, group/web/design-system ;
 *     group/mobile  = group/mobile/core
 *
 * 左边是被审项目路径前缀（按路径段匹配，最长前缀优先），右边是上下文仓库的完整路径。
 *
 * 安全约束：
 * - 上下文仓库必须在 AI_REVIEWER_GITLAB_TOKEN_MAP 里有条目：凭据从映射表取，
 *   映射表同时是白名单；没有凭据的仓库跳过并告警，绝不回退到被审仓库的凭据
 * - 只读默认分支；模型只能在已配置的别名里选，不能指定任意仓库
 * - 任何一步失败只告警并跳过，不影响审查本身
 */
import type {IGitPlatform} from './platform/git-platform'

export const CONTEXT_REPOS_ENV = 'AI_REVIEWER_CONTEXT_REPOS'

/** 每个项目最多配置几个上下文仓库（工具描述和提示词都会列出别名，数量要克制） */
export const CONTEXT_REPOS_MAX_PER_PROJECT = 3

export class ContextReposConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ContextReposConfigError'
  }
}

export interface ContextRepoEntry {
  /** 被审项目路径前缀（小写） */
  prefix: string
  /** 上下文仓库完整路径（小写） */
  repos: string[]
}

/** 已就绪的上下文仓库 */
export interface ContextRepo {
  /** 工具参数里使用的别名：仓库路径的最后一段 */
  alias: string
  path: string
  owner: string
  repo: string
  /** 读取使用的 ref：默认分支名 */
  ref: string
  platform: IGitPlatform
}

const PATH_RE = /^[a-z0-9._-]+(?:\/[a-z0-9._-]+)+$/

/**
 * 解析 `AI_REVIEWER_CONTEXT_REPOS`。条目用换行或分号分隔，每条 `前缀 = 仓库1, 仓库2`。
 * 路径不区分大小写（GitLab 路径不区分），统一转小写。格式非法即抛错。
 */
export function parseContextRepos(raw: string): ContextRepoEntry[] {
  const entries: ContextRepoEntry[] = []
  const seen = new Set<string>()
  for (const item of raw.split(/[\n;]/)) {
    const text = item.trim()
    if (text === '') continue
    const eq = text.indexOf('=')
    if (eq <= 0) {
      throw new ContextReposConfigError(
        `${CONTEXT_REPOS_ENV}: expected "prefix = repo", got "${text}"`
      )
    }
    const prefix = text.slice(0, eq).trim().toLowerCase()
    if (!PATH_RE.test(prefix) && !/^[a-z0-9._-]+$/.test(prefix)) {
      throw new ContextReposConfigError(`${CONTEXT_REPOS_ENV}: invalid project prefix "${prefix}"`)
    }
    if (seen.has(prefix)) {
      throw new ContextReposConfigError(`${CONTEXT_REPOS_ENV}: duplicate entry for "${prefix}"`)
    }
    seen.add(prefix)
    const repos = [
      ...new Set(
        text
          .slice(eq + 1)
          .split(/[\s,]+/)
          .map(r => r.trim().toLowerCase())
          .filter(r => r !== '')
      )
    ]
    if (repos.length === 0) {
      throw new ContextReposConfigError(`${CONTEXT_REPOS_ENV}: no repository for "${prefix}"`)
    }
    for (const r of repos) {
      if (!PATH_RE.test(r)) {
        throw new ContextReposConfigError(
          `${CONTEXT_REPOS_ENV}: "${r}" is not a full repository path (group/project)`
        )
      }
    }
    if (repos.length > CONTEXT_REPOS_MAX_PER_PROJECT) {
      throw new ContextReposConfigError(
        `${CONTEXT_REPOS_ENV}: at most ${CONTEXT_REPOS_MAX_PER_PROJECT} repositories per project ("${prefix}")`
      )
    }
    entries.push({prefix, repos})
  }
  return entries
}

/** 按路径段匹配前缀，最长前缀优先：`group/web` 覆盖 `group/web/app`，不覆盖 `group/webapp` */
export function matchContextRepos(entries: ContextRepoEntry[], projectPath: string): string[] {
  const path = projectPath.trim().toLowerCase()
  let best: ContextRepoEntry | null = null
  for (const entry of entries) {
    const covers = path === entry.prefix || path.startsWith(`${entry.prefix}/`)
    if (covers && (best == null || entry.prefix.length > best.prefix.length)) best = entry
  }
  return best?.repos ?? []
}

export interface ConfigureContextReposDeps {
  /** 用映射表里该路径的凭据创建平台；没有凭据时抛错 */
  createPlatform: (projectPath: string) => IGitPlatform
  warn: (message: string) => void
  info?: (message: string) => void
}

let ready: ContextRepo[] = []

/** 当前运行里已就绪的上下文仓库（未配置时为空） */
export function getContextRepos(): readonly ContextRepo[] {
  return ready
}

export function resetContextRepos(): void {
  ready = []
}

function splitPath(path: string): {owner: string; repo: string} {
  const idx = path.lastIndexOf('/')
  return {owner: path.slice(0, idx), repo: path.slice(idx + 1)}
}

/**
 * 按被审项目解析并准备上下文仓库。任何问题只告警并跳过对应仓库，不抛错。
 * 结果存入模块级状态，供探查工具和提示词读取。
 */
export async function configureContextRepos(
  projectPath: string,
  env: Record<string, string | undefined>,
  deps: ConfigureContextReposDeps
): Promise<ContextRepo[]> {
  ready = []
  const raw = (env[CONTEXT_REPOS_ENV] ?? '').trim()
  if (raw === '') return ready

  let paths: string[]
  try {
    paths = matchContextRepos(parseContextRepos(raw), projectPath)
  } catch (e) {
    deps.warn(`context repos disabled: ${(e as Error).message}`)
    return ready
  }

  const self = projectPath.trim().toLowerCase()
  const aliases = new Set<string>()
  const result: ContextRepo[] = []
  for (const path of paths) {
    if (path === self) {
      deps.warn(`context repo "${path}" is the repository under review, skipped`)
      continue
    }
    const {owner, repo} = splitPath(path)
    const alias = repo
    if (aliases.has(alias)) {
      deps.warn(`context repo "${path}": alias "${alias}" is already used, skipped`)
      continue
    }
    let platform: IGitPlatform
    try {
      platform = deps.createPlatform(path)
    } catch (e) {
      deps.warn(`context repo "${path}" skipped: ${(e as Error).message}`)
      continue
    }
    if (typeof platform.getDefaultBranch !== 'function') {
      deps.warn(`context repo "${path}" skipped: the platform cannot report a default branch`)
      continue
    }
    let ref: string | null
    try {
      ref = await platform.getDefaultBranch(owner, repo)
    } catch (e) {
      deps.warn(
        `context repo "${path}" skipped: could not read the project (${(e as Error).message})`
      )
      continue
    }
    if (ref == null || ref === '') {
      deps.warn(`context repo "${path}" skipped: it has no default branch`)
      continue
    }
    aliases.add(alias)
    result.push({alias, path, owner, repo, ref, platform})
  }

  ready = result
  if (result.length > 0) {
    deps.info?.(`context repos: ${result.map(r => `${r.alias}@${r.ref}`).join(', ')}`)
  }
  return result
}
