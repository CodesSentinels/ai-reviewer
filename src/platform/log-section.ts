/**
 * platform/log-section.ts - 可折叠的日志分段
 *
 * 审查 job 的日志很长（每个文件的摘要、审查、发布各有若干行）。按阶段分段后，
 * GitLab job log 里每段是一个带耗时的可折叠 section，GitHub 里是 `::group::`。
 * 具体输出由 Logger 的可选方法 startSection / endSection 决定；没实现时这里什么也不做。
 *
 * 单独成模块而不放进 logger.ts：大量测试按 `{getLogger}` 的形状 mock logger 模块，
 * 这里通过 getLogger() 取实现，不要求那些 mock 跟着加导出。
 */
import {getLogger} from './logger'

let openSection: string | null = null

/**
 * 进入下一个日志分段：先结束当前分段，再开启新的；与当前分段同名时不做任何事。
 * 审查流程是顺序的几个阶段，用「切换」而不是成对的 begin/end，中途 return
 * 也不会留下没关闭的分段（入口再统一调一次 endLogSection 兜底）。
 */
export function beginLogSection(id: string, title: string): void {
  if (openSection === id) return
  endLogSection()
  try {
    getLogger().startSection?.(id, title)
  } catch {
    // 分段只是日志排版，失败不能影响审查
  }
  openSection = id
}

/** 结束当前日志分段（没有打开的分段时什么也不做） */
export function endLogSection(): void {
  if (openSection == null) return
  const id = openSection
  openSection = null
  try {
    getLogger().endSection?.(id)
  } catch {
    // 同上
  }
}
