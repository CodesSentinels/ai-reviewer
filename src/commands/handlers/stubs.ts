/**
 * commands/handlers/stubs.ts - B/C/D 命令的占位实现
 *
 * 成员 A 负责在命令框架中登记这些命令名，确保:
 *   1. 白名单完整，parser 能正确识别
 *   2. help 命令能展示
 *   3. 未实现时反馈统一的 NOT_IMPLEMENTED 错误
 *
 * 随着 B/C/D 接入，应**逐个替换**本文件中的 stub 为真实 handler。
 */
import type {CommandHandler, CommandContext, CommandResult} from '../types'

function notImplemented(name: string): CommandHandler['execute'] {
  return async (_ctx: CommandContext): Promise<CommandResult> => {
    // 调度器会把抛出的标记型错误转成 NOT_IMPLEMENTED 反馈
    const e = new Error(`Command not implemented: ${name}`)
    ;(e as Error & {code?: string}).code = 'NOT_IMPLEMENTED'
    throw e
  }
}

/** 成员 C */
export const reviewStub: CommandHandler = {
  name: 'review',
  description: '触发增量审查（仅审查自上次审查以来的新增变更）',
  usage: '@ai-reviewer review',
  needsAck: true,
  minPermission: 'write',
  execute: notImplemented('review')
}

export const fullReviewStub: CommandHandler = {
  name: 'full review',
  description: '触发全量审查（从 base 到 HEAD 的完整 diff）',
  usage: '@ai-reviewer full review',
  needsAck: true,
  minPermission: 'write',
  execute: notImplemented('full review')
}

export const summaryStub: CommandHandler = {
  name: 'summary',
  description: '基于当前最新代码重新生成 PR 摘要',
  usage: '@ai-reviewer summary',
  needsAck: true,
  minPermission: 'write',
  execute: notImplemented('summary')
}

export const pauseStub: CommandHandler = {
  name: 'pause',
  description: '暂停对当前 PR 的自动审查',
  usage: '@ai-reviewer pause',
  needsAck: false,
  minPermission: 'write',
  execute: notImplemented('pause')
}

export const resumeStub: CommandHandler = {
  name: 'resume',
  description: '恢复对当前 PR 的自动审查',
  usage: '@ai-reviewer resume',
  needsAck: false,
  minPermission: 'write',
  execute: notImplemented('resume')
}

export const configurationStub: CommandHandler = {
  name: 'configuration',
  description: '显示当前仓库的审查配置',
  usage: '@ai-reviewer configuration',
  needsAck: false,
  minPermission: 'read',
  execute: notImplemented('configuration')
}

export const ALL_STUBS: CommandHandler[] = [
  reviewStub,
  fullReviewStub,
  summaryStub,
  pauseStub,
  resumeStub,
  configurationStub
]
