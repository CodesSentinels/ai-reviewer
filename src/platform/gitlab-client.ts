/**
 * platform/gitlab-client.ts — 统一 GitLab client factory（GLAPI-029/030/031/032）
 *
 * 唯一构造 `@gitbeaker/rest` 实例的地方：
 * - GLAPI-029：host / PAT / timeout 只从受信任配置（CI 环境变量）读取并校验；
 *   任何日志输出都不含 token，也不含带 token 的 URL/Header。
 * - GLAPI-030：adapter 通过本 factory 返回的实例调用 Projects、Merge Requests、
 *   Repository Files/Tree、Notes、Discussions、Members、Award Emoji API。
 * - GLAPI-031：业务层与 adapter 都不直接 `fetch`；确需 fallback 时也必须复用
 *   本文件的 host/认证/timeout 与 gitlab-errors/gitlab-retry 的错误与重试语义。
 * - GLAPI-024/032：分页不依赖 SDK 默认值，统一由 listOptions() 给出显式契约。
 *
 * @gitbeaker/rest 的实例与类型只存在于本文件和 GitLab adapter 内（ARCH-024）。
 */

import {Gitlab} from '@gitbeaker/rest'
import {getLogger} from './logger'

/** GitLab 凭据：PAT 优先，缺失时 fallback 到 CI job token */
export interface GitLabCredential {
  type: 'pat' | 'job_token'
  value: string
}

/** 受信任配置解析结果 */
export interface GitLabClientConfig {
  host: string
  credential: GitLabCredential
  timeoutMS: number
  /** 凭据从哪里选出来的（映射表条目），只含变量名，可安全打印 */
  credentialSource?: string
}

/** gitbeaker 实例类型别名（只在 adapter 层内部使用，不进入 IGitPlatform） */
export type GitLabApi = InstanceType<typeof Gitlab>

export const GITLAB_CLIENT_DEFAULTS = {
  host: 'https://gitlab.com',
  timeoutMS: 30_000,
  minTimeoutMS: 1_000,
  maxTimeoutMS: 300_000
} as const

/**
 * GLAPI-024/032：list API 的显式分页契约。
 *
 * gitbeaker 的 `all*()` 只有在「不传 page」时才会沿 Link header 自动翻页，
 * 且默认 perPage=20。这里固定 perPage=100 并用 maxPages 兜底，避免
 * 「SDK 默认行为 == IGitPlatform 语义」的隐式假设：
 * - 不传 `page`（传了会退化为单页）
 * - perPage 100 是 GitLab REST API 上限
 * - maxPages 给超大 MR/仓库一个有上限的请求数，避免无界翻页
 */
export const PAGINATION_DEFAULTS = {
  perPage: 100,
  maxPages: 50
} as const

/**
 * DEP-004：仓库文件树的分页上限单列。
 *
 * 通用上限 50 页 = 5000 条，对中等规模仓库（一个组件多的前端仓库就够）
 * 直接截断，而文件树截断意味着跨文件依赖分析看不全仓库、导入解析静默失败。
 * tree 条目只有 path + type（几十字节），单独放宽到 500 页 = 5 万条；
 * 代价只是超大仓库最坏情况多几百次轻量请求，普通仓库仍然一两页结束。
 */
export const TREE_PAGINATION_DEFAULTS = {
  perPage: 100,
  maxPages: 500
} as const

/** 分页契约的形状（PAGINATION_DEFAULTS / TREE_PAGINATION_DEFAULTS） */
export interface PaginationContract {
  perPage: number
  maxPages: number
}

/**
 * 构造 list API 的分页参数。调用方传入的 `page` 会被丢弃（会破坏自动翻页契约）。
 *
 * @param extra - 附加查询参数
 * @param pagination - 分页契约，默认 PAGINATION_DEFAULTS；文件树等条目轻量、
 *   数量大的接口传入自己的契约（如 TREE_PAGINATION_DEFAULTS）
 */
export function listOptions<T extends Record<string, unknown>>(
  extra?: T,
  pagination: PaginationContract = PAGINATION_DEFAULTS
): T & {perPage: number; maxPages: number} {
  const rest = {...((extra ?? {}) as Record<string, unknown>)}
  delete rest.page
  return {
    ...(rest as T),
    perPage: pagination.perPage,
    maxPages: pagination.maxPages
  }
}

/**
 * CI job token 的能力降级告警（GLAPI-029 / CMD-016）。
 *
 * job token 的 API allowlist 不含 `/users` 和 `/projects/:id/members`，
 * 而命令权限判定（getCollaboratorPermission）正是靠这两个端点。
 * 结果是每次查询都 401/403 → GLAPI-021 fail closed → 所有人的所有命令被拒。
 * 这是配置期就能预判的事实，不该等到运行时逐次报错才暴露。
 */
export const JOB_TOKEN_LIMITATION_WARNING =
  'GitLab credential is CI_JOB_TOKEN: job tokens cannot call /users or /projects/:id/members, ' +
  'so command permission checks will fail closed (every command denied) and MR discussion writes ' +
  'may be rejected. Set GITLAB_PAT to enable the full feature set.'

/** 配置非法时抛出（fail closed，不回退到默认 host/token） */
export class GitLabClientConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GitLabClientConfigError'
  }
}

/**
 * 校验 host：必须是 http/https URL，且不得内嵌凭据或 token query。
 * 内嵌凭据的 URL 一旦进入日志就是明文泄露，直接 fail closed。
 */
export function validateGitLabHost(raw: string): string {
  const value = raw.trim()
  if (value === '') throw new GitLabClientConfigError('GitLab host is empty')

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new GitLabClientConfigError(`GitLab host is not a valid URL: ${value}`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new GitLabClientConfigError(`GitLab host must use http/https: ${url.protocol}`)
  }
  if (url.username !== '' || url.password !== '') {
    throw new GitLabClientConfigError('GitLab host must not embed credentials')
  }
  if (url.searchParams.has('private_token') || url.searchParams.has('token')) {
    throw new GitLabClientConfigError('GitLab host must not carry a token query parameter')
  }
  // 去掉结尾 '/'，避免 gitbeaker 拼出 '//api/v4'
  return value.replace(/\/+$/, '')
}

/** 校验 timeout：必须是正整数毫秒且落在允许区间内 */
export function validateGitLabTimeoutMS(raw: string): number {
  const value = raw.trim()
  if (!/^\d+$/.test(value)) {
    throw new GitLabClientConfigError(`GitLab timeout must be a positive integer (ms): ${value}`)
  }
  const ms = Number(value)
  if (ms < GITLAB_CLIENT_DEFAULTS.minTimeoutMS || ms > GITLAB_CLIENT_DEFAULTS.maxTimeoutMS) {
    throw new GitLabClientConfigError(
      `GitLab timeout ${ms}ms out of range ` +
        `[${GITLAB_CLIENT_DEFAULTS.minTimeoutMS}, ${GITLAB_CLIENT_DEFAULTS.maxTimeoutMS}]`
    )
  }
  return ms
}

/** 按项目选择凭据的映射表变量名 */
export const TOKEN_MAP_ENV = 'AI_REVIEWER_GITLAB_TOKEN_MAP'

/** 映射表里「匹配任意项目」的条目，优先级最低 */
const TOKEN_MAP_WILDCARD = '*'

/**
 * 映射表只能引用 `GITLAB_` 开头的变量：值会作为 token 发给 GitLab，
 * 写错成 `OPENAI_API_KEY` 之类时要在配置期拒绝，而不是把别的密钥发出去。
 */
const TOKEN_MAP_VARIABLE_RE = /^GITLAB_[A-Z0-9_]+$/

/** 映射表的一条：项目路径前缀（或 `*`）→ 存放 token 的 CI 变量名 */
export interface GitLabTokenMapEntry {
  prefix: string
  variable: string
}

/**
 * 解析 `AI_REVIEWER_GITLAB_TOKEN_MAP`。
 *
 * 每条形如 `group/subgroup = GITLAB_PAT_X`，条目之间用换行、`;` 或 `,` 分隔，
 * `#` 开头的行是注释。映射表本身只含变量名、不含 token：token 各自放在
 * 独立的 CI 变量里，才能逐个设成 Masked + Hidden（多行 / JSON 的值无法 mask）。
 *
 * 语法错误、变量名不合规、前缀重复都抛 GitLabClientConfigError（fail closed）。
 */
export function parseGitLabTokenMap(raw: string): GitLabTokenMapEntry[] {
  const entries: GitLabTokenMapEntry[] = []
  const seen = new Set<string>()
  for (const line of raw.split(/[\n;,]/)) {
    const item = line.trim()
    if (item === '' || item.startsWith('#')) continue
    const eq = item.indexOf('=')
    if (eq < 0) {
      throw new GitLabClientConfigError(
        `${TOKEN_MAP_ENV}: expected "path = VARIABLE", got "${item}"`
      )
    }
    const rawPrefix = item.substring(0, eq).trim()
    const variable = item.substring(eq + 1).trim()
    const prefix =
      rawPrefix === TOKEN_MAP_WILDCARD
        ? rawPrefix
        : rawPrefix.replace(/^\/+|\/+$/g, '').toLowerCase()
    if (prefix === '') {
      throw new GitLabClientConfigError(`${TOKEN_MAP_ENV}: empty project path in "${item}"`)
    }
    if (!TOKEN_MAP_VARIABLE_RE.test(variable)) {
      throw new GitLabClientConfigError(
        `${TOKEN_MAP_ENV}: "${variable}" is not allowed — token variables must match GITLAB_[A-Z0-9_]+`
      )
    }
    if (seen.has(prefix)) {
      throw new GitLabClientConfigError(`${TOKEN_MAP_ENV}: duplicate entry for "${prefix}"`)
    }
    seen.add(prefix)
    entries.push({prefix, variable})
  }
  if (entries.length === 0) {
    throw new GitLabClientConfigError(`${TOKEN_MAP_ENV} is set but contains no entries`)
  }
  return entries
}

/**
 * 在映射表里为项目找条目：按路径段匹配前缀（`group/web` 覆盖 `group/web/app`，
 * 不覆盖 `group/webapp`），最长的前缀优先，`*` 兜底。GitLab 路径不区分大小写。
 */
export function matchGitLabTokenMap(
  entries: GitLabTokenMapEntry[],
  projectPath: string
): GitLabTokenMapEntry | null {
  const path = projectPath.trim().toLowerCase()
  let best: GitLabTokenMapEntry | null = null
  for (const entry of entries) {
    if (entry.prefix === TOKEN_MAP_WILDCARD) continue
    const covers = path === entry.prefix || path.startsWith(`${entry.prefix}/`)
    if (covers && (best == null || entry.prefix.length > best.prefix.length)) best = entry
  }
  return best ?? entries.find(e => e.prefix === TOKEN_MAP_WILDCARD) ?? null
}

/**
 * 是否启用了按项目选择凭据。启用时各项目的 bot 账号不同，
 * 单个的 `AI_REVIEWER_BOT_GITLAB_LOGIN` 无法同时对应，见 configuredBotGitLabLogin。
 */
export function isGitLabTokenMapEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return (env[TOKEN_MAP_ENV] ?? '').trim() !== ''
}

/**
 * 配置的 bot 用户名（`AI_REVIEWER_BOT_GITLAB_LOGIN`）。
 *
 * 启用映射表时恒为空：每个项目的 token 对应不同的 bot 账号，配置值只可能
 * 对得上其中一个；而共享核心里「配置值优先于凭据真实身份」，配置值会让其他
 * 项目认不出 bot 自己的评论（摘要重复创建、自评论触发命令）。这时 bot 身份
 * 一律来自当前凭据的 `GET /user`。
 */
export function configuredBotGitLabLogin(
  env: Record<string, string | undefined> = process.env
): string {
  if (isGitLabTokenMapEnabled(env)) return ''
  return (env.AI_REVIEWER_BOT_GITLAB_LOGIN ?? '').trim()
}

/** 以前用过的 bot 账号（只读认领）的变量名 */
export const PREVIOUS_BOT_LOGINS_ENV = 'AI_REVIEWER_GITLAB_PREVIOUS_BOT_LOGINS'

/**
 * 以前用过的 bot 用户名（`AI_REVIEWER_GITLAB_PREVIOUS_BOT_LOGINS`），用逗号、
 * 分号或空白分隔，可带 `@`。
 *
 * 换 token 后 bot 账号随之变化（Project / Group Access Token 每新建一个就是一个
 * 新账号）时配置，让新 bot 认领旧账号留在已有 MR 上的摘要和评论。与
 * `AI_REVIEWER_BOT_GITLAB_LOGIN` 不同，它在映射表模式下同样生效：用户名全局唯一，
 * 列出多个项目的旧 bot 不会互相干扰。
 */
export function previousBotGitLabLogins(
  env: Record<string, string | undefined> = process.env
): string[] {
  return (env[PREVIOUS_BOT_LOGINS_ENV] ?? '')
    .split(/[\s,;]+/)
    .map(l => l.replace(/^@/, '').trim())
    .filter(l => l !== '')
}

/**
 * 从受信任配置（CI 环境变量）准备 client 配置（GLAPI-029），分两步：
 * 这里先校验与项目无关的部分，返回的函数在拿到事件里的项目路径后选出凭据。
 * 这样配置错误在读事件之前就暴露，而按项目选择又能拿到项目路径。
 *
 * - host：`CI_SERVER_URL`，默认 https://gitlab.com
 * - 凭据：
 *   - 设置了 `AI_REVIEWER_GITLAB_TOKEN_MAP`：按项目路径从映射表选出变量名，
 *     读取该变量作为 token；项目不在表里或变量为空时抛错——映射表同时是
 *     项目白名单，不回退到 `GITLAB_PAT`
 *   - 否则 `GITLAB_PAT` 优先，为空时 fallback `CI_JOB_TOKEN`。这里填的可以是
 *     个人 PAT、Project Access Token 或 Group Access Token，调用方式相同
 * - timeout：`AI_REVIEWER_GITLAB_TIMEOUT_MS`，默认 30s
 *
 * 配置非法时抛 GitLabClientConfigError（fail closed）。
 * 选中 job token 时会打一条能力降级 warning——见 JOB_TOKEN_LIMITATION_WARNING。
 */
export function prepareGitLabClientConfig(
  env: Record<string, string | undefined> = process.env
): (projectPath?: string) => GitLabClientConfig {
  const host = validateGitLabHost(env.CI_SERVER_URL ?? GITLAB_CLIENT_DEFAULTS.host)
  const timeoutMS = validateGitLabTimeoutMS(
    env.AI_REVIEWER_GITLAB_TIMEOUT_MS ?? String(GITLAB_CLIENT_DEFAULTS.timeoutMS)
  )

  if (isGitLabTokenMapEnabled(env)) {
    const entries = parseGitLabTokenMap(env[TOKEN_MAP_ENV] ?? '')
    return projectPath => {
      if (projectPath == null || projectPath.trim() === '') {
        throw new GitLabClientConfigError(`${TOKEN_MAP_ENV} needs the project path to pick a token`)
      }
      const entry = matchGitLabTokenMap(entries, projectPath)
      if (entry == null) {
        throw new GitLabClientConfigError(
          `project "${projectPath}" is not listed in ${TOKEN_MAP_ENV}; add an entry for it (or "*")`
        )
      }
      const value = (env[entry.variable] ?? '').trim()
      if (value === '') {
        throw new GitLabClientConfigError(
          `${entry.variable} (mapped for "${entry.prefix}" in ${TOKEN_MAP_ENV}) is not set`
        )
      }
      return {
        host,
        credential: {type: 'pat', value},
        timeoutMS,
        credentialSource: `${TOKEN_MAP_ENV}: ${entry.prefix} → ${entry.variable}`
      }
    }
  }

  const pat = (env.GITLAB_PAT ?? '').trim()
  const jobToken = (env.CI_JOB_TOKEN ?? '').trim()
  const credential: GitLabCredential | null =
    pat !== ''
      ? {type: 'pat', value: pat}
      : jobToken !== ''
      ? {type: 'job_token', value: jobToken}
      : null
  if (credential == null) {
    throw new GitLabClientConfigError('GITLAB_PAT or CI_JOB_TOKEN is required')
  }

  // 凭据的能力差异是配置期就能知道的事，不该等到运行时每次调用报 401
  if (credential.type === 'job_token') {
    getLogger().warning(JOB_TOKEN_LIMITATION_WARNING)
  }

  return () => ({host, credential, timeoutMS})
}

/**
 * 一步解析 client 配置：prepareGitLabClientConfig 的简写。
 * 启用映射表时必须给出项目路径。
 */
export function resolveGitLabClientConfig(
  env: Record<string, string | undefined> = process.env,
  projectPath?: string
): GitLabClientConfig {
  return prepareGitLabClientConfig(env)(projectPath)
}

/**
 * 生成可安全打印的配置摘要（GLAPI-029：绝不输出 token 或带 token 的 URL）。
 * 只输出 host、凭据类型、凭据来源（映射表条目，只含变量名）和 timeout，
 * 不输出凭据值，也不输出其长度前缀等可推断信息。
 */
export function describeGitLabClientConfig(config: GitLabClientConfig): string {
  const source = config.credentialSource != null ? ` (${config.credentialSource})` : ''
  return `host=${config.host} credential=${config.credential.type}${source} timeout=${config.timeoutMS}ms`
}

/**
 * 统一 client factory：所有 GitLab API 调用都必须使用这里创建的实例。
 *
 * `queryTimeout` 把 timeout 下沉到每个请求的 AbortSignal，
 * 超时表现为 GitbeakerTimeoutError，由 gitlab-errors 归一化为 'timeout'。
 */
export function createGitLabClient(config: GitLabClientConfig): GitLabApi {
  const host = validateGitLabHost(config.host)
  const queryTimeout = config.timeoutMS

  return config.credential.type === 'job_token'
    ? new Gitlab({host, jobToken: config.credential.value, queryTimeout})
    : new Gitlab({host, token: config.credential.value, queryTimeout})
}

/**
 * 修改 pipeline 名字（`PUT /projects/:id/pipelines/:pipeline_id/metadata`）。
 *
 * gitbeaker 43 没有封装这个端点，这里用同一个 client 的底层 requester 调用
 * （GLAPI-031：仍走本文件的 host 校验、认证与超时，不另起原生 HTTP）。
 * 凭据由调用方给出：改名用的是产物仓库自己的 token，不是审查用的那个。
 *
 * 只用于展示性的改名，失败不重试——不值得为它拖长 job。
 */
export async function updatePipelineName(
  config: GitLabClientConfig,
  target: {projectId: string; pipelineId: string; name: string},
  createClient: (
    clientConfig: GitLabClientConfig
  ) => Pick<GitLabApi, 'Pipelines'> = createGitLabClient
): Promise<void> {
  const api = createClient(config)
  await api.Pipelines.requester.put(
    `projects/${encodeURIComponent(target.projectId)}/pipelines/${encodeURIComponent(
      target.pipelineId
    )}/metadata`,
    {body: {name: target.name}}
  )
}
