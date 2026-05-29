/**
 * unit-test/register.ts - 注册 `generate unit tests` 命令
 *
 * 迭代四对命令框架的接入点。设计意图:
 *
 * - 命令框架 (Member A) 的 CommandHandler 接口不携带 Bot 实例，因此本模块
 *   通过"工厂函数 + 闭包"方式生成一个绑定了 heavyBot 的 handler。
 * - 由 command-handler.ts 在 dispatchCommentEvent 之前调用一次。
 * - 内部使用 `_registered` flag 保证幂等，避免 hot-reload 场景下的重复注册。
 *
 * 与 B/C/D 的关系:
 * - 不修改 commands/handlers/stubs.ts（B/C/D 后续替换 stubs 不受影响）
 * - 不修改 commands/bootstrap.ts（只增加一个独立的注册入口）
 */
import {info, warning} from '@actions/core'
import type {Bot} from '../bot'
import {getRegistry} from '../commands/registry'
import type {
  CommandContext,
  CommandHandler,
  CommandResult
} from '../commands/types'
import {runUnitTestGeneration} from './orchestrator'
import type {DeliveryMode} from './types'

const COMMAND_NAME = 'generate unit tests'

let _registered = false

/**
 * 注册 `generate unit tests` 命令。
 *
 * 幂等策略（两条独立检查，避免与 commands/bootstrap._resetBootstrap 失步）:
 *   1. 本模块 `_registered` flag —— 避免同一 Actions run 内重复构造 handler
 *   2. registry.has(name) —— 防御 B/C/D 未来误把同名 stub 加入 ALL_STUBS
 *      （或测试中 _resetBootstrap 重启后本模块状态未同步）
 *
 * @param heavyBot 用于生成测试的重量模型实例
 */
export function registerUnitTestCommand(heavyBot: Bot): void {
  if (_registered && getRegistry().has(COMMAND_NAME)) return

  if (getRegistry().has(COMMAND_NAME)) {
    warning(
      `unit-test/register: command "${COMMAND_NAME}" already registered by another module — skipping`
    )
    _registered = true
    return
  }

  const handler = buildGenerateUnitTestsHandler(heavyBot)
  getRegistry().register(handler)
  _registered = true
}

/**
 * 仅供测试。
 *
 * 注意：通常配合 `commands/bootstrap._resetBootstrap()` 一起使用，
 * 否则会出现 "_registered=false 但 registry 仍带有 handler" 的不一致状态。
 */
export function _resetRegistered(): void {
  _registered = false
}

export function buildGenerateUnitTestsHandler(heavyBot: Bot): CommandHandler {
  return {
    name: 'generate unit tests',
    description:
      '基于 PR 变更代码自动生成单元测试（默认在评论中展示，支持 --commit / --pr）',
    usage:
      '@ai-reviewer generate unit tests [--commit | --pr] [--function NAME] [PATH...]',
    needsAck: true,
    minPermission: 'write',
    async execute(ctx: CommandContext): Promise<CommandResult> {
      const mode = resolveMode(ctx)
      info(
        `unit-test/register: start, mode=${mode}, args=${JSON.stringify(
          ctx.command.args
        )}`
      )

      const {run, delivery, commentBody} = await runUnitTestGeneration(
        {
          owner: ctx.owner,
          repo: ctx.repo,
          prNumber: ctx.prNumber,
          args: ctx.command.args,
          kv: ctx.command.kv,
          mode,
          triggerCommentId: ctx.commentId
        },
        {heavyBot}
      )

      // 评论模式：commentBody 直接作为消息回填
      if (mode === 'comment') {
        if (run.tests.length === 0) {
          return {
            message:
              commentBody ??
              '⚠️ 未在 PR 变更中识别出可生成测试的函数/类。'
          }
        }
        return {message: commentBody ?? '已生成测试，但未能渲染评论。'}
      }

      // commit / pr 模式：根据 outcome 拼装反馈
      const lines: string[] = []
      if (mode === 'commit') {
        lines.push(
          `✅ 已提交 **${delivery.succeeded}** 个测试文件到分支 \`${ctx.command.kv['--branch'] ?? '当前 PR 分支'}\`。`
        )
        if (delivery.commitSha) {
          lines.push(`Commit: \`${delivery.commitSha.slice(0, 7)}\``)
        }
      } else if (mode === 'pr') {
        if (delivery.newPrUrl) {
          lines.push(`✅ 已创建新 PR：${delivery.newPrUrl}`)
        } else {
          lines.push('⚠️ 创建 PR 未成功。')
        }
      }

      if (delivery.errors.length > 0) {
        lines.push('')
        lines.push('### 警告 / 失败明细')
        for (const err of delivery.errors) lines.push(`- ${err}`)
      }
      if (run.warnings.length > 0) {
        lines.push('')
        for (const w of run.warnings) lines.push(`> ${w}`)
      }

      return {message: lines.join('\n')}
    }
  }
}

/** 解析命令参数到 DeliveryMode；默认 comment */
function resolveMode(ctx: CommandContext): DeliveryMode {
  const args = ctx.command.args
  // 简单关键字识别：--commit / --pr / --comment
  if (args.includes('--commit')) return 'commit'
  if (args.includes('--pr')) return 'pr'
  return 'comment'
}

// 暴露给测试
export function _resolveMode(ctx: CommandContext): DeliveryMode {
  return resolveMode(ctx)
}
