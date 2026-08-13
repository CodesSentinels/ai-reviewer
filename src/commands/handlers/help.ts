/**
 * commands/handlers/help.ts - help 命令的参考实现（成员 A 交付）
 *
 * 功能:
 * - 自动聚合 registry 中已注册的所有命令
 * - 按注册顺序输出命令名、描述、用法
 * - 提供 buildHelpMessage() 纯函数，便于单测
 */
import type {CommandHandler, CommandResult, CommandContext} from '../types'
import {getRegistry} from '../registry'
import {BOT_MENTIONS, PRIMARY_BOT_MENTION} from '../../constants'

/**
 * 纯函数：根据命令列表生成 help Markdown。
 * 提取出来便于单元测试（不依赖 registry 单例）。
 * @param botIcon 可选 bot 图标，用于底部提示（CFG-005）
 */
export function buildHelpMessage(commands: CommandHandler[], botIcon = '🤖'): string {
  const lines: string[] = []
  lines.push('## 支持的命令')
  lines.push('')
  lines.push('| 命令 | 描述 | 最低权限 |')
  lines.push('| :--- | :--- | :------- |')

  // help 自身也要出现在列表里，但排在最后
  const ordered = [...commands].sort((a, b) => {
    if (a.name === 'help') return 1
    if (b.name === 'help') return -1
    return 0
  })

  for (const c of ordered) {
    const perm = c.minPermission ?? 'write'
    const usage = c.usage ?? `${PRIMARY_BOT_MENTION} ${c.name}`
    lines.push(`| \`${usage}\` | ${c.description} | \`${perm}\` |`)
  }

  if (ordered.some(c => (c.aliases?.length ?? 0) > 0)) {
    lines.push('')
    lines.push('### 别名')
    for (const c of ordered) {
      if (c.aliases && c.aliases.length > 0) {
        lines.push(`- \`${c.name}\` → ${c.aliases.map(a => `\`${a}\``).join(', ')}`)
      }
    }
  }

  lines.push('')
  lines.push(
    `> ${botIcon} Bot 同时支持 ${BOT_MENTIONS.map(m => `\`${m}\``).join(' 与 ')} 共 ${
      BOT_MENTIONS.length
    } 个 mention。`
  )
  return lines.join('\n')
}

/**
 * 构造"未知命令"回复消息，列出所有支持的命令。
 * 参考 coderabbitai 格式: @user, I didn't recognize `xxx` as a valid command.
 */
export function buildUnknownCommandMessage(
  invalidCmd: string,
  actorLogin: string,
  commands: CommandHandler[]
): string {
  const lines: string[] = []
  lines.push(
    `@${actorLogin} , I didn't recognize \`${invalidCmd}\` as a valid command. Here are the commands I support:`
  )
  lines.push('')

  const ordered = [...commands].sort((a, b) => {
    if (a.name === 'help') return 1
    if (b.name === 'help') return -1
    return 0
  })

  for (const c of ordered) {
    const usage = c.usage ?? `${PRIMARY_BOT_MENTION} ${c.name}`
    lines.push(`- \`${usage}\` — ${c.description}`)
  }

  lines.push('')
  lines.push(`Let me know which one you'd like to run, or feel free to ask me a question directly!`)
  return lines.join('\n')
}

export const helpHandler: CommandHandler = {
  name: 'help',
  description: '显示所有支持的命令及用法',
  usage: `${PRIMARY_BOT_MENTION} help`,
  needsAck: false,
  minPermission: 'read',
  async execute(ctx: CommandContext): Promise<CommandResult> {
    const cmds = getRegistry().listCommands()
    return {message: buildHelpMessage(cmds, ctx.options.botIcon)}
  }
}
