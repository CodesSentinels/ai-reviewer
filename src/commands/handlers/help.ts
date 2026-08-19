/**
 * commands/handlers/help.ts - help 命令的参考实现（成员 A 交付）
 *
 * 功能:
 * - 自动聚合 registry 中已注册的所有命令
 * - 按注册顺序输出命令名、描述、用法
 * - 提供 buildHelpMessage() 纯函数，便于单测
 */
import type {CommandHandler, CommandResult, CommandContext} from '../types'
import type {Platform} from '../../platform/execution-context'
import {getRegistry} from '../registry'
import {resolveBotMentions} from '../parser'
import {PRIMARY_BOT_MENTION} from '../../constants'

export interface HelpIdentity {
  /** 运行平台，决定权限名的说明口径 */
  platform: Platform
  /** 配置的 bot 账号（GitHub App / GitLab PAT 用户名），空串表示未配置 */
  botLogin: string
  botIcon: string
}

/**
 * 纯函数：根据命令列表生成 help Markdown。
 * 提取出来便于单元测试（不依赖 registry 单例）。
 *
 * CMD-023 要求 help 展示四样东西：命令、权限、**触发前缀**、**评论身份**。
 * 后两样此前是缺的——底部只列了 BOT_MENTIONS 两个静态别名，而 GitLab 上
 * reviewer 通常以某个 PAT 账号发言，@ 那个账号才是最自然的用法，用户从 help
 * 里根本看不到它；权限列也只有 `write`/`triage` 这种词，GitLab 用户不知道对应
 * 自己项目里的哪个角色。
 */
export function buildHelpMessage(
  commands: CommandHandler[],
  botIconOrIdentity: string | HelpIdentity = '🤖'
): string {
  const identity: HelpIdentity =
    typeof botIconOrIdentity === 'string'
      ? {platform: 'github', botLogin: '', botIcon: botIconOrIdentity}
      : botIconOrIdentity
  const botIcon = identity.botIcon
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

  // ── 权限名对照（CMD-023）──
  // 表格里的 `write` / `triage` 是平台无关的内部叫法。GitHub 用户看得懂，
  // GitLab 用户得知道它对应 access level 才能自查。
  lines.push('')
  lines.push('### 权限说明')
  lines.push(
    identity.platform === 'gitlab'
      ? '- `write` → Developer(30) 及以上\n' +
          '- `triage` → Reporter(20) 及以上\n' +
          '- `read` → 对项目可见即可\n\n' +
          '`review` / `full review` / `summary` 对 MR 作者豁免权限要求；' +
          '`pause` / `resume` / `resolve` 不豁免。权限查询失败一律拒绝执行。'
      : '- `write` → 仓库 write 及以上\n' +
          '- `triage` → triage 及以上\n' +
          '- `read` → 对仓库可见即可\n\n' +
          '`review` / `full review` / `summary` 对 PR 作者豁免权限要求；' +
          '`pause` / `resume` / `resolve` 不豁免。权限查询失败一律拒绝执行。'
  )

  // ── 触发前缀与评论身份（CMD-023）──
  lines.push('')
  lines.push('### 如何触发')
  const mentions = resolveBotMentions(identity.botLogin)
  lines.push(`把下面任一前缀写在评论行首即可：${mentions.map(m => `\`${m}\``).join('、')}`)
  lines.push('')
  lines.push(
    identity.botLogin === ''
      ? `> ${botIcon} 本 reviewer 尚未配置账号标识，只能用上面的文本别名触发。`
      : `> ${botIcon} 本 reviewer 以 \`@${identity.botLogin}\` 的身份发表评论，` +
          `@ 这个账号同样可以触发命令。`
  )
  lines.push('')
  lines.push('顶层评论和行级评论（review thread / diff discussion）都支持。')
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
    return {
      message: buildHelpMessage(cmds, {
        platform: ctx.execCtx?.platform ?? 'github',
        botLogin: ctx.options.botLogin ?? '',
        botIcon: ctx.options.botIcon
      })
    }
  }
}
