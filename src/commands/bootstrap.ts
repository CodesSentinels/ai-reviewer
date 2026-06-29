/**
 * commands/bootstrap.ts - 命令框架启动注册
 *
 * 统一在应用启动时把所有 handler 注册到 registry。
 * 后续 B/C/D 接入真实 handler 时，将对应的 stub 替换为正式实现即可。
 *
 * 注意: 注册表是单例，且 register 在重复注册时抛异常。
 * 因此 bootstrap 必须保证只被调用一次（用模块级 flag 保护）。
 */
import {helpHandler} from './handlers/help'
import {resolveHandler} from './handlers/resolve'
import {ALL_STUBS} from './handlers/stubs'
import {getRegistry} from './registry'

let bootstrapped = false

export function bootstrapCommands(): void {
  if (bootstrapped) return
  const reg = getRegistry()
  reg.register(helpHandler)
  reg.register(resolveHandler)
  for (const h of ALL_STUBS) {
    reg.register(h)
  }
  bootstrapped = true
}

/** 仅供测试: 清空注册表并允许再次 bootstrap */
export function _resetBootstrap(): void {
  getRegistry()._reset()
  bootstrapped = false
}
