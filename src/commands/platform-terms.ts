/**
 * commands/platform-terms.ts - 命令回复里随平台变化的用词
 *
 * 命令回复直接展示在 PR / MR 上。GitLab 用户看到「PR」「仓库 write 权限」
 * 「workflow permissions」这类 GitHub 术语既不准确也无从操作，这里集中给出
 * 按平台区分的说法，handler 不各自拼写。
 *
 * 平台未知（旧调用方没有传 ExecutionContext）时按 GitHub 口径——与既有行为一致。
 */
import type {Platform} from '../platform/execution-context'
import type {PlatformPermission} from '../platform/git-platform'

/** 变更请求的叫法：GitHub PR / GitLab MR */
export function changeRequestNoun(platform?: Platform): 'PR' | 'MR' {
  return platform === 'gitlab' ? 'MR' : 'PR'
}

/**
 * 把面向双平台书写的静态文案（如命令描述）里的「PR」换成本平台叫法。
 * 只替换独立的 `PR` 词，不碰 `PR/MR` 这类已经兼顾两平台的写法。
 */
export function localizeChangeRequest(text: string, platform?: Platform): string {
  if (platform !== 'gitlab') return text
  return text.replace(/(^|[^A-Za-z/])PR(?![A-Za-z/])/g, '$1MR')
}

/** GitLab 角色名（与 gitlab-platform 的 access level → 内部权限映射对应） */
const GITLAB_ROLE: Partial<Record<PlatformPermission, string>> = {
  admin: 'Owner',
  maintain: 'Maintainer',
  write: 'Developer',
  triage: 'Reporter',
  read: 'Guest'
}

/** 最低权限的展示名：GitHub 保持内部叫法（与仓库权限同名），GitLab 换成角色名 */
export function permissionLabel(permission: PlatformPermission, platform?: Platform): string {
  if (platform !== 'gitlab') return permission
  return GITLAB_ROLE[permission] ?? permission
}
