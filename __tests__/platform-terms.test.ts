/**
 * platform-terms.test.ts — 命令回复里随平台变化的用词
 */
import {describe, expect, test} from '@jest/globals'
import {
  changeRequestNoun,
  localizeChangeRequest,
  permissionLabel
} from '../src/commands/platform-terms'
import {isExactCommentLocation, isSameCommentLocation} from '../src/commenter'

describe('changeRequestNoun / localizeChangeRequest', () => {
  test('GitHub（及平台未知）保持 PR', () => {
    expect(changeRequestNoun('github')).toBe('PR')
    expect(changeRequestNoun(undefined)).toBe('PR')
    expect(localizeChangeRequest('暂停对当前 PR 的自动审查', 'github')).toBe(
      '暂停对当前 PR 的自动审查'
    )
  })

  test('GitLab 换成 MR，只换独立的 PR 词', () => {
    expect(changeRequestNoun('gitlab')).toBe('MR')
    expect(localizeChangeRequest('基于当前最新代码重新生成 PR 摘要', 'gitlab')).toBe(
      '基于当前最新代码重新生成 MR 摘要'
    )
    expect(localizeChangeRequest('PR 摘要', 'gitlab')).toBe('MR 摘要')
    // 已兼顾两平台的写法、以及含 PR 的其他单词不动
    expect(localizeChangeRequest('PR/MR 描述', 'gitlab')).toBe('PR/MR 描述')
    expect(localizeChangeRequest('PRIMARY PRs', 'gitlab')).toBe('PRIMARY PRs')
  })
})

describe('permissionLabel', () => {
  test('GitHub 保持内部权限名', () => {
    expect(permissionLabel('write', 'github')).toBe('write')
    expect(permissionLabel('triage', undefined)).toBe('triage')
  })

  test('GitLab 换成项目角色名', () => {
    expect(permissionLabel('write', 'gitlab')).toBe('Developer')
    expect(permissionLabel('triage', 'gitlab')).toBe('Reporter')
    expect(permissionLabel('read', 'gitlab')).toBe('Guest')
    expect(permissionLabel('none', 'gitlab')).toBe('none')
  })
})

describe('评论位置判定', () => {
  test('只有锚点行：锚点落在范围内即同一处；替换仍要求单行精确一致', () => {
    expect(isSameCommentLocation({line: 33, start_line: null}, 31, 34)).toBe(true)
    expect(isSameCommentLocation({line: 35, start_line: null}, 31, 34)).toBe(false)
    expect(isExactCommentLocation({line: 33, start_line: null}, 31, 34)).toBe(false)
    expect(isExactCommentLocation({line: 33, start_line: null}, 33, 33)).toBe(true)
  })

  test('有完整行范围：两种口径都要求起止行一致', () => {
    expect(isSameCommentLocation({line: 34, start_line: 30}, 31, 34)).toBe(false)
    expect(isSameCommentLocation({line: 34, start_line: 31}, 31, 34)).toBe(true)
    expect(isExactCommentLocation({line: 34, start_line: 31}, 31, 34)).toBe(true)
  })

  test('锚点缺失 → 不匹配', () => {
    expect(isSameCommentLocation({line: null, start_line: null}, 31, 34)).toBe(false)
  })
})

describe('GitLab 上的命令文案不出现 GitHub 术语', () => {
  // 注册全部 handler 后取命令列表（与运行时一致）
  const {buildHelpMessage, buildUnknownCommandMessage} = require('../src/commands/handlers/help')
  const {getRegistry} = require('../src/commands/registry')
  const {formatErrorMessage} = require('../src/commands/reply')
  require('../src/commands/bootstrap').bootstrapCommands()
  const commands = getRegistry().listCommands()

  const standalonePR = /(^|[^A-Za-z/])PR(?![A-Za-z/])/

  test('help：描述用 MR、权限列用角色名', () => {
    const msg: string = buildHelpMessage(commands, {
      platform: 'gitlab',
      botLogin: 'bot',
      botIcon: '🤖'
    })
    expect(msg).not.toMatch(standalonePR)
    expect(msg).toContain('重新生成 MR 摘要')
    expect(msg).toContain('| `Developer` |')
    expect(msg).not.toMatch(/\| `write` \|/)
  })

  test('help：GitHub 上保持原样', () => {
    const msg: string = buildHelpMessage(commands, {
      platform: 'github',
      botLogin: 'bot',
      botIcon: '🤖'
    })
    expect(msg).toContain('重新生成 PR 摘要')
    expect(msg).toContain('| `write` |')
  })

  test('未知命令回复：命令描述在 GitLab 上用 MR', () => {
    const msg: string = buildUnknownCommandMessage('foo', 'alice', commands, 'gitlab')
    expect(msg).toContain('重新生成 MR 摘要')
    expect(msg).not.toMatch(standalonePR)
  })

  test('权限类错误在 GitLab 上不提 workflow / 仓库 write', () => {
    for (const code of ['FORBIDDEN', 'BOT_FORBIDDEN']) {
      const msg: string = formatErrorMessage(code, undefined, 'gitlab')
      expect(msg).not.toMatch(/workflow|pull-requests|`write`/)
    }
    expect(formatErrorMessage('BOT_FORBIDDEN', undefined, 'github')).toContain('workflow')
  })
})
