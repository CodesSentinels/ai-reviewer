/**
 * command-permission-matrix.test.ts — 命令权限矩阵（CMD-007~016）
 *
 * 权限基线是两平台共用的，写在
 * `docs/github-vs-gitlab-runtime-differences.md` 的命令对照表里。
 * 既有的 `command-permission.test.ts` 只抽查了几个命令，矩阵本身没有被钉住——
 * 结果 `configuration` 长期声明为 `read`，比基线（Reporter+）宽一级，
 * 等于放行 GitLab 的 GUEST。
 *
 * 本文件用表驱动把**整张矩阵**钉死：每个命令的最低权限 + 作者是否豁免，
 * 逐级验证放行与拒绝，任何一格漂移都会失败。
 */
import {describe, expect, test, jest, beforeEach} from '@jest/globals'

// bootstrapCommands → handlers → commenter 会在模块加载时读 context.repo
jest.mock('@actions/github', () => ({
  context: {repo: {owner: 'o', repo: 'r'}, payload: {}}
}))

const platformState = {getCollaboratorPermission: jest.fn<any>()}
jest.mock('../src/platform/git-platform', () => ({
  getPlatform: () => platformState
}))
jest.mock('../src/platform/logger', () => ({
  getLogger: () => ({info: jest.fn(), warning: jest.fn(), error: jest.fn(), debug: jest.fn()})
}))

import {
  canExecute,
  getPermission,
  getPermissionResult,
  _resetPermissionCache
} from '../src/commands/permission'
import {bootstrapCommands} from '../src/commands/bootstrap'
import {getRegistry} from '../src/commands/registry'
import type {CommandHandler, PermissionLevel} from '../src/commands/types'

/** 权限由低到高，用于逐级验证 */
const LADDER: PermissionLevel[] = ['none', 'read', 'triage', 'write', 'maintain', 'admin']

/**
 * 权限基线，来源：docs/github-vs-gitlab-runtime-differences.md 命令对照表。
 * GitLab access level → PlatformPermission 的映射见 gitlab-platform.ts：
 * OWNER→admin / MAINTAINER→maintain / DEVELOPER→write / REPORTER→triage / GUEST→read
 */
const MATRIX: Array<{
  command: string
  /** 文档里的角色说法 */
  baseline: string
  min: PermissionLevel
  /** PR/MR 作者是否豁免 */
  authorExempt: boolean
}> = [
  {command: 'review', baseline: 'Developer+', min: 'write', authorExempt: true},
  {command: 'full review', baseline: 'Developer+', min: 'write', authorExempt: true},
  {command: 'summary', baseline: 'Developer+', min: 'write', authorExempt: true},
  {command: 'pause', baseline: 'Developer+', min: 'write', authorExempt: false},
  {command: 'resume', baseline: 'Developer+', min: 'write', authorExempt: false},
  {command: 'configuration', baseline: 'Reporter+', min: 'triage', authorExempt: false},
  {command: 'help', baseline: '可见项目成员', min: 'read', authorExempt: true},
  {command: 'resolve', baseline: 'Developer+', min: 'write', authorExempt: false}
]

let handlers: Map<string, CommandHandler>

beforeEach(() => {
  jest.clearAllMocks()
  _resetPermissionCache()
  bootstrapCommands()
  handlers = new Map(
    getRegistry()
      .listCommands()
      .map((h: CommandHandler) => [h.name.toLowerCase(), h] as const)
  )
})

describe('CMD-007~014: 权限矩阵与基线一致', () => {
  test('矩阵覆盖了注册表里的全部命令（新增命令必须同步登记）', () => {
    const registered = [...handlers.keys()].sort()
    const covered = MATRIX.map(m => m.command.toLowerCase()).sort()
    expect(registered).toEqual(covered)
  })

  test.each(MATRIX)('$command 的最低权限是 $min（基线 $baseline）', ({command, min}) => {
    const handler = handlers.get(command) as CommandHandler
    expect(handler).toBeDefined()
    expect(handler.minPermission ?? 'write').toBe(min)
  })

  test.each(MATRIX)('$command：低于 $min 的权限一律拒绝（非作者）', ({command, min}) => {
    const handler = handlers.get(command) as CommandHandler
    const minIndex = LADDER.indexOf(min)

    for (const level of LADDER.slice(0, minIndex)) {
      expect(canExecute(handler, level, false)).toBe(false)
    }
  })

  test.each(MATRIX)('$command：达到或高于 $min 的权限一律放行', ({command, min}) => {
    const handler = handlers.get(command) as CommandHandler
    const minIndex = LADDER.indexOf(min)

    for (const level of LADDER.slice(minIndex)) {
      expect(canExecute(handler, level, false)).toBe(true)
    }
  })
})

describe('CMD-007~011/014: 作者豁免只对无副作用命令生效', () => {
  test.each(MATRIX.filter(m => m.authorExempt))(
    '$command：作者即使只有 read 也可执行',
    ({command}) => {
      const handler = handlers.get(command) as CommandHandler
      expect(canExecute(handler, 'read', true)).toBe(true)
    }
  )

  test.each(MATRIX.filter(m => !m.authorExempt))(
    '$command：作者不豁免，权限不足照样拒绝',
    ({command, min}) => {
      const handler = handlers.get(command) as CommandHandler
      const below = LADDER[LADDER.indexOf(min) - 1]
      expect(canExecute(handler, below, true)).toBe(false)
    }
  )

  test('外部贡献者（权限 none）在自己 PR 上只能触发豁免集内的命令', () => {
    // fork 贡献者对仓库的 collaborator 权限是 none，但确实是 PR 作者。
    // 按 CMD-007~009「MR 作者允许」，他可以对自己的 PR 要审查；
    // 但 pause/resume/resolve/configuration 这些有副作用或涉及配置的命令不行。
    const allowed: string[] = []
    const denied: string[] = []
    for (const {command} of MATRIX) {
      const handler = handlers.get(command) as CommandHandler
      ;(canExecute(handler, 'none', true) ? allowed : denied).push(command)
    }

    expect(allowed.sort()).toEqual(['full review', 'help', 'review', 'summary'])
    expect(denied.sort()).toEqual(['configuration', 'pause', 'resolve', 'resume'])
  })
})

describe('CMD-015: 权限比较基于等级序而非角色名字符串', () => {
  test('等级阶梯严格单调：高等级能做的低等级不一定能做', () => {
    const writeCmd = handlers.get('pause') as CommandHandler
    for (let i = 0; i < LADDER.length - 1; i++) {
      const lower = canExecute(writeCmd, LADDER[i], false)
      const higher = canExecute(writeCmd, LADDER[i + 1], false)
      // 一旦放行，更高等级必须继续放行（不能出现字符串比较导致的乱序）
      if (lower) expect(higher).toBe(true)
    }
  })

  test('GitLab access level 映射后的 triage 能执行 configuration，read 不能', () => {
    const config = handlers.get('configuration') as CommandHandler
    expect(canExecute(config, 'triage', false)).toBe(true) // REPORTER
    expect(canExecute(config, 'read', false)).toBe(false) // GUEST
  })
})

describe('CMD-016: 权限查询失败一律 fail closed', () => {
  test.each([
    ['API 抛错', () => platformState.getCollaboratorPermission.mockRejectedValue(new Error('500'))],
    [
      '用户不存在/项目不可见（适配器返回 none）',
      () => platformState.getCollaboratorPermission.mockResolvedValue('none')
    ]
  ])('%s → 权限为 none', async (_label, setup) => {
    setup()
    await expect(getPermission({owner: 'o', repo: 'r', username: 'u'})).resolves.toBe('none')
  })

  test('查询失败与「确认为 none」必须可区分（否则无法 fail closed）', async () => {
    platformState.getCollaboratorPermission.mockRejectedValue(new Error('500'))
    const failed = await getPermissionResult({owner: 'o', repo: 'r', username: 'u'})
    expect(failed).toEqual({level: 'none', queryFailed: true})

    _resetPermissionCache()
    platformState.getCollaboratorPermission.mockResolvedValue('none')
    const confirmed = await getPermissionResult({owner: 'o', repo: 'r', username: 'u'})
    expect(confirmed).toEqual({level: 'none', queryFailed: false})
  })

  test('查询失败时所有命令都被拒绝——包括作者豁免集内的命令', async () => {
    platformState.getCollaboratorPermission.mockRejectedValue(new Error('network'))
    const {level, queryFailed} = await getPermissionResult({
      owner: 'o',
      repo: 'r',
      username: 'u'
    })
    expect(queryFailed).toBe(true)

    // dispatcher 在 queryFailed 时把 isPrAuthor 置 false，这里模拟同一决策
    const effectiveAuthorExemption = false
    for (const {command} of MATRIX) {
      const handler = handlers.get(command) as CommandHandler
      expect(canExecute(handler, level, effectiveAuthorExemption)).toBe(false)
    }
  })

  test('dispatcher 确实把「查询失败」传导为「不认作者豁免」', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('path')
    const src = fs.readFileSync(path.resolve(__dirname, '../src/commands/dispatcher.ts'), 'utf8')
    expect(src).toMatch(/getPermissionResult\(/)
    expect(src).toMatch(/actorLogin === prAuthor && !queryFailed/)
  })

  test('确认为 none（非故障）时，作者豁免仍按矩阵生效', async () => {
    platformState.getCollaboratorPermission.mockResolvedValue('none')
    const {level, queryFailed} = await getPermissionResult({
      owner: 'o',
      repo: 'r',
      username: 'author'
    })
    expect(queryFailed).toBe(false)

    const review = handlers.get('review') as CommandHandler
    const pause = handlers.get('pause') as CommandHandler
    expect(canExecute(review, level, true)).toBe(true)
    expect(canExecute(pause, level, true)).toBe(false)
  })

  test('查询结果按 owner/repo/username 缓存，不跨用户串权限', async () => {
    platformState.getCollaboratorPermission
      .mockResolvedValueOnce('admin')
      .mockResolvedValueOnce('none')

    const alice = await getPermission({owner: 'o', repo: 'r', username: 'alice'})
    const bob = await getPermission({owner: 'o', repo: 'r', username: 'bob'})
    const aliceAgain = await getPermission({owner: 'o', repo: 'r', username: 'alice'})

    expect([alice, bob, aliceAgain]).toEqual(['admin', 'none', 'admin'])
    expect(platformState.getCollaboratorPermission).toHaveBeenCalledTimes(2)
  })
})
