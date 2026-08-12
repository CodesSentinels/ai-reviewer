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

/**
 * 从受信任配置（CI 环境变量）解析 client 配置（GLAPI-029）。
 *
 * - host：`CI_SERVER_URL`，默认 https://gitlab.com
 * - 凭据：`GITLAB_PAT` 优先，为空时 fallback `CI_JOB_TOKEN`
 * - timeout：`AI_REVIEWER_GITLAB_TIMEOUT_MS`，默认 30s
 *
 * 凭据缺失或配置非法时抛 GitLabClientConfigError（fail closed）。
 */
export function resolveGitLabClientConfig(
  env: Record<string, string | undefined> = process.env
): GitLabClientConfig {
  const host = validateGitLabHost(env.CI_SERVER_URL ?? GITLAB_CLIENT_DEFAULTS.host)

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

  const timeoutMS = validateGitLabTimeoutMS(
    env.AI_REVIEWER_GITLAB_TIMEOUT_MS ?? String(GITLAB_CLIENT_DEFAULTS.timeoutMS)
  )

  return {host, credential, timeoutMS}
}

/**
 * 生成可安全打印的配置摘要（GLAPI-029：绝不输出 token 或带 token 的 URL）。
 * 只输出 host、凭据类型和 timeout，不输出凭据值，也不输出其长度前缀等可推断信息。
 */
export function describeGitLabClientConfig(config: GitLabClientConfig): string {
  return `host=${config.host} credential=${config.credential.type} timeout=${config.timeoutMS}ms`
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
