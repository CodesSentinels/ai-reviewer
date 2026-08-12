/**
 * commands/permission.ts - 命令权限校验
 *
 * 职责:
 * - 查询评论者对仓库的权限等级
 * - 提供命令级权限检查
 * - 进程内缓存，避免在单次 Actions run 中重复查询
 * - PR 作者豁免逻辑
 *
 * 对 GitHub API 的依赖:
 *   octokit.repos.getCollaboratorPermissionLevel({owner, repo, username})
 *   返回 permission ∈ {admin, maintain, write, triage, read, none}
 */
import {getPlatform} from '../platform/git-platform'
import {getLogger} from '../platform/logger'
import type {PermissionLevel, CommandHandler} from './types'
import {permissionAtLeast} from './types'

/**
 * 权限查询结果。
 *
 * `queryFailed` 必须与「确认为 none」区分开：CMD-016 要求权限查询失败时
 * fail closed，而作者豁免是建立在「已确认权限」之上的放行。把 API 故障折叠成
 * none 之后，PR 作者仍能触发 review/full review/summary——那是 fail open。
 */
export interface PermissionResult {
  level: PermissionLevel
  /** true 表示查询本身失败（API 错误），而不是确认了对方没有权限 */
  queryFailed: boolean
}

/** 进程内缓存: `${owner}/${repo}/${username}` → 查询结果 */
const cache = new Map<string, PermissionResult>()

export interface PermissionQuery {
  owner: string
  repo: string
  username: string
}

/**
 * 查询评论者权限，带缓存。
 * 查询失败时回退为 'none' 并标记 queryFailed，记录 warning（不抛异常）。
 */
export async function getPermissionResult(q: PermissionQuery): Promise<PermissionResult> {
  const key = `${q.owner}/${q.repo}/${q.username}`
  const cached = cache.get(key)
  if (cached) return cached

  try {
    const level = (await getPlatform().getCollaboratorPermission(
      q.owner,
      q.repo,
      q.username
    )) as PermissionLevel
    const result: PermissionResult = {level, queryFailed: false}
    cache.set(key, result)
    return result
  } catch (e) {
    getLogger().warning(
      `getCollaboratorPermissionLevel failed for ${key}: ${String(e)} — fail closed`
    )
    const result: PermissionResult = {level: 'none', queryFailed: true}
    cache.set(key, result)
    return result
  }
}

/** 只取权限等级的便捷入口；需要区分「查询失败」时用 getPermissionResult() */
export async function getPermission(q: PermissionQuery): Promise<PermissionLevel> {
  return (await getPermissionResult(q)).level
}

/**
 * 命令级权限检查
 *
 * @param handler    要检查的命令
 * @param actual     评论者权限等级
 * @param isPrAuthor 是否**已确认**的 PR 作者豁免资格。权限查询失败时调用方必须
 *                   传 false——CMD-016 要求 fail closed，不能因为「看起来是作者」
 *                   就在权限未知的情况下放行（见 dispatcher.ts 的调用点）
 */
export function canExecute(
  handler: CommandHandler,
  actual: PermissionLevel,
  isPrAuthor: boolean
): boolean {
  const required: PermissionLevel = handler.minPermission ?? 'write'

  if (permissionAtLeast(actual, required)) return true

  // PR 作者豁免：对自己 PR 调用这些"无副作用/仅影响自身 PR"的命令
  if (isPrAuthor) {
    const selfSafe = new Set(['help', 'review', 'full review', 'summary'])
    if (selfSafe.has(handler.name.toLowerCase())) {
      return true
    }
  }

  return false
}

/** 仅供测试 */
export function _resetPermissionCache(): void {
  cache.clear()
}
