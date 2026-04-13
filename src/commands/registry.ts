/**
 * commands/registry.ts - 命令处理器注册表
 *
 * 单例注册表，维护命令名 → handler 的映射。
 * B/C/D 的 handler 文件在被 import 时调用 registerCommand 自注册。
 *
 * 特性:
 * - 支持别名 (aliases)
 * - 重复注册抛异常（避免默默覆盖）
 * - 提供 listCommands() 给 help handler 使用
 * - 提供 getRegisteredNames() 给 parser 做命中检测
 */
import type {CommandHandler} from './types'

class CommandRegistry {
  private readonly handlers = new Map<string, CommandHandler>()
  /** 规范名 → 注册顺序，help 命令按注册顺序输出 */
  private readonly order: string[] = []

  register(handler: CommandHandler): void {
    const primary = handler.name.toLowerCase()
    if (this.handlers.has(primary)) {
      throw new Error(`Command already registered: ${primary}`)
    }
    this.handlers.set(primary, handler)
    this.order.push(primary)

    for (const alias of handler.aliases ?? []) {
      const a = alias.toLowerCase()
      if (this.handlers.has(a)) {
        throw new Error(
          `Command alias collides with existing command: ${a}`
        )
      }
      this.handlers.set(a, handler)
    }
  }

  get(name: string): CommandHandler | undefined {
    return this.handlers.get(name.toLowerCase())
  }

  has(name: string): boolean {
    return this.handlers.has(name.toLowerCase())
  }

  /** 仅返回主名 + 别名，用于 parser 命中检测 */
  getRegisteredNames(): Set<string> {
    return new Set(this.handlers.keys())
  }

  /** 按注册顺序返回所有主命令（不含别名），供 help 使用 */
  listCommands(): CommandHandler[] {
    return this.order
      .map(n => this.handlers.get(n))
      .filter((h): h is CommandHandler => h !== undefined)
  }

  /** 仅供测试使用 */
  _reset(): void {
    this.handlers.clear()
    this.order.length = 0
  }
}

const globalRegistry = new CommandRegistry()

export function registerCommand(handler: CommandHandler): void {
  globalRegistry.register(handler)
}

export function getRegistry(): CommandRegistry {
  return globalRegistry
}

export {CommandRegistry}
