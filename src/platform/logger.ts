/**
 * platform/logger.ts - 平台无关 Logger 接口（ARCH-012）
 *
 * 定义统一的日志接口，替换共享核心中对 @actions/core info/warning/error 的直接依赖。
 * 入口文件（main.ts / gitlab-trigger.ts）在启动时调用 setLogger() 设置平台实现，
 * 共享核心通过 getLogger() 或便捷函数（logger.info 等）输出日志。
 *
 * ARCH-015：GitLab-only 启动不得初始化 @actions/core，因此 GitLabLogger
 * 不 import @actions/core，只使用 console。
 */

/** 平台无关 Logger 接口 */
export interface Logger {
  // eslint-disable-next-line no-unused-vars
  info(msg: string): void
  // eslint-disable-next-line no-unused-vars
  warning(msg: string): void
  // eslint-disable-next-line no-unused-vars
  error(msg: string): void
  // eslint-disable-next-line no-unused-vars
  debug(msg: string): void
}

/**
 * 控制台 Logger（默认 fallback）。
 * 在 setLogger() 调用前或未初始化时使用，保证日志不会丢失。
 */
const consoleLogger: Logger = {
  // eslint-disable-next-line no-console
  info: (msg: string) => console.log(msg),
  // eslint-disable-next-line no-console
  warning: (msg: string) => console.warn(msg),
  // eslint-disable-next-line no-console
  error: (msg: string) => console.error(msg),
  // eslint-disable-next-line no-console
  debug: (msg: string) => console.log(`[DEBUG] ${msg}`)
}

let _logger: Logger = consoleLogger

/** 设置全局 Logger 实例（入口文件调用） */
export function setLogger(logger: Logger): void {
  _logger = logger
}

/** 获取当前 Logger 实例 */
export function getLogger(): Logger {
  return _logger
}

/** 重置为默认 console logger（仅供测试使用） */
export function resetLogger(): void {
  _logger = consoleLogger
}
