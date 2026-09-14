/**
 * commands/bootstrap.ts - 命令框架启动注册
 *
 * 统一在应用启动时把所有 handler 注册到 registry。
 *
 * 注意: 注册表是单例，且 register 在重复注册时抛异常。
 * 因此 bootstrap 必须保证只被调用一次（用模块级 flag 保护）。
 */
import {helpHandler} from './handlers/help'
import {resolveHandler} from './handlers/resolve'
import {reviewHandler, fullReviewHandler, summaryHandler} from './handlers/review'
import {pauseHandler, resumeHandler} from './handlers/pause'
import {configurationHandler} from './handlers/configuration'
import type {CommandHandler} from './types'
import {getRegistry} from './registry'

/**
 * 全部已实现的命令（§9.3 完成后 stubs.ts 不再存在）。
 * 新增命令在这里挂上即可，registry 会拒绝重名注册。
 */
const ALL_HANDLERS: CommandHandler[] = [
  helpHandler,
  resolveHandler,
  reviewHandler,
  fullReviewHandler,
  summaryHandler,
  pauseHandler,
  resumeHandler,
  configurationHandler
]

let bootstrapped = false

export function bootstrapCommands(): void {
  if (bootstrapped) return
  const reg = getRegistry()
  for (const h of ALL_HANDLERS) {
    reg.register(h)
  }
  bootstrapped = true
}

/** 仅供测试: 清空注册表并允许再次 bootstrap */
export function _resetBootstrap(): void {
  getRegistry()._reset()
  bootstrapped = false
}
