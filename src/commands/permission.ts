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

/** 进程内缓存: `${owner}/${repo}/${username}` → permission */
const cache = new Map<string, PermissionLevel>()

export interface PermissionQuery {
  owner: string
  repo: string
  username: string
}

/**
 * 查询评论者权限，带缓存。
 * 查询失败时回退为 'none'，并记录 warning（不抛异常）。
 */
export async function getPermission(
  q: PermissionQuery
): Promise<PermissionLevel> {
  const key = `${q.owner}/${q.repo}/${q.username}`
  const cached = cache.get(key)
  if (cached) return cached

  try {
    const perm = (await getPlatform().getCollaboratorPermission(
      q.owner,
      q.repo,
      q.username
    )) as PermissionLevel
    cache.set(key, perm)
    return perm
  } catch (e) {
    getLogger().warning(
      `getCollaboratorPermissionLevel failed for ${key}: ${String(e)} — ` +
        `falling back to 'none'`
    )
    cache.set(key, 'none')
    return 'none'
  }
}

/**
 * 命令级权限检查
 *
 * @param handler    要检查的命令
 * @param actual     评论者权限等级
 * @param isPrAuthor 是否 PR 作者（作者对自己 PR 有部分豁免）
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
