/**
 * platform/state-namespace.ts — marker 与幂等键的平台命名空间（GH-014 / STATE-006）
 *
 * 双平台同时启用时，marker 和幂等键必须能区分来源，禁止用同一把 key 合并两平台的
 * 任务状态。做法是给所有**状态类** marker 加 `ai-reviewer:{platform}:` 前缀：
 *
 *   <!-- ai-reviewer:github:cmd-reply:12345:help -->
 *   <!-- ai-reviewer:gitlab:conv-reply:12345 -->
 *
 * 两条边界：
 *
 * - **命名空间来自入口**：共享核心（commenter / conversation / commands）不读平台
 *   payload，也不该猜自己跑在哪个平台上。入口（main.ts / gitlab-trigger.ts）在
 *   setPlatform() 之后调用 setStateNamespace()，共享核心只消费结果。未设置时按
 *   'github' 处理——这是历史行为，且 GitLab 命令路径尚未接入（CMD-* / STATE-*）。
 * - **写新读旧**：命名空间是本次新增的，线上在途 PR 里已经存在无前缀的旧 marker。
 *   写入一律用新格式，匹配则同时接受新旧两种形态，否则升级当天所有在途 PR 会
 *   「找不到自己写过的 marker」，造成重复回帖或重复审查。旧格式在所有在途 PR
 *   关闭后即可删除。
 */

import type {Platform} from './execution-context'

const MARKER_PREFIX = 'ai-reviewer'

let _namespace: Platform = 'github'

/** 入口在 setPlatform() 之后调用，声明本次运行的状态命名空间 */
export function setStateNamespace(platform: Platform): void {
  _namespace = platform
}

/** 当前状态命名空间；未显式设置时为 'github'（历史行为） */
export function getStateNamespace(): Platform {
  return _namespace
}

/** 重置为默认值（仅供测试使用） */
export function resetStateNamespace(): void {
  _namespace = 'github'
}

/**
 * 构造带命名空间的状态 marker。
 *
 * @param kind marker 种类，如 'cmd-reply' / 'conv-reply' / 'commit-ids-start'
 * @param parts 附加标识（评论 ID、命令名等），按顺序拼在 kind 之后
 */
export function buildStateMarker(kind: string, ...parts: Array<string | number>): string {
  const suffix = parts.length > 0 ? `:${parts.join(':')}` : ''
  return `<!-- ${MARKER_PREFIX}:${_namespace}:${kind}${suffix} -->`
}

/**
 * 返回匹配时应接受的全部 marker 形态：当前命名空间的新格式 + 传入的历史格式。
 *
 * 只用于**读取/匹配**；写入必须只用 buildStateMarker() 的结果。
 */
export function stateMarkerVariants(
  kind: string,
  legacy: string,
  ...parts: Array<string | number>
): string[] {
  return [buildStateMarker(kind, ...parts), legacy]
}

/** 判断正文是否包含某个状态 marker（新旧格式皆可） */
export function hasStateMarker(body: unknown, variants: string[]): boolean {
  if (typeof body !== 'string') return false
  return variants.some(v => body.includes(v))
}
