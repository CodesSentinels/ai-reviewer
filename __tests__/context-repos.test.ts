/**
 * context-repos.test.ts — 审查时可只读访问的上下文仓库（运维方配置，仅 GitLab）
 *
 * 覆盖：配置解析、按路径段的最长前缀匹配、准备阶段的各种失败（都只告警并跳过，
 * 不影响审查）、以及「必须有映射表凭据」这条安全边界。
 */
import {describe, expect, test, jest, beforeEach} from '@jest/globals'
import {
  CONTEXT_REPOS_ENV,
  CONTEXT_REPOS_MAX_PER_PROJECT,
  ContextReposConfigError,
  configureContextRepos,
  getContextRepos,
  matchContextRepos,
  parseContextRepos,
  resetContextRepos
} from '../src/context-repos'

beforeEach(() => resetContextRepos())

describe('parseContextRepos', () => {
  test('一条一行，也可用分号；逗号或空白分隔多个仓库；统一转小写', () => {
    const entries = parseContextRepos(
      'Group/Web/App = Group/Web/Shared, group/web/design\n group/mobile = group/mobile/core ; '
    )
    expect(entries).toEqual([
      {prefix: 'group/web/app', repos: ['group/web/shared', 'group/web/design']},
      {prefix: 'group/mobile', repos: ['group/mobile/core']}
    ])
  })

  test('空串 → 没有条目', () => {
    expect(parseContextRepos('  \n ; ')).toEqual([])
  })

  test.each([
    ['缺等号', 'group/app group/shared'],
    ['没有仓库', 'group/app ='],
    ['仓库不是完整路径', 'group/app = shared'],
    ['路径含非法字符', 'group/app = group/sh@red/x'],
    ['前缀重复', 'group/app = group/a/b\ngroup/app = group/c/d'],
    ['前缀非法', 'Gro up/app = group/a/b']
  ])('非法格式抛错：%s', (_name, raw) => {
    expect(() => parseContextRepos(raw)).toThrow(ContextReposConfigError)
  })

  test(`每个项目最多 ${CONTEXT_REPOS_MAX_PER_PROJECT} 个`, () => {
    expect(() => parseContextRepos('g/app = g/a/1, g/a/2, g/a/3, g/a/4')).toThrow(
      ContextReposConfigError
    )
  })
})

describe('matchContextRepos', () => {
  const entries = parseContextRepos(
    ['group/web = group/lib/one', 'group/web/app = group/lib/two'].join('\n')
  )

  test('最长前缀优先', () => {
    expect(matchContextRepos(entries, 'group/web/app')).toEqual(['group/lib/two'])
    expect(matchContextRepos(entries, 'group/web/app/sub')).toEqual(['group/lib/two'])
    expect(matchContextRepos(entries, 'group/web/other')).toEqual(['group/lib/one'])
  })

  test('按路径段匹配：group/web 不覆盖 group/webapp；不区分大小写', () => {
    expect(matchContextRepos(entries, 'group/webapp/x')).toEqual([])
    expect(matchContextRepos(entries, 'GROUP/WEB/App')).toEqual(['group/lib/two'])
  })

  test('没有命中 → 空', () => {
    expect(matchContextRepos(entries, 'other/project')).toEqual([])
  })
})

describe('configureContextRepos', () => {
  const platformOf = (branch: string | null | Error) => ({
    getDefaultBranch: jest.fn<any>(async () => {
      if (branch instanceof Error) throw branch
      return branch
    })
  })
  const env = {[CONTEXT_REPOS_ENV]: 'group/web/app = group/lib/shared'}

  function deps(createPlatform: (p: string) => any) {
    const warn = jest.fn<(m: string) => void>()
    const info = jest.fn<(m: string) => void>()
    return {warn, info, createPlatform}
  }

  test('未配置变量 → 空，不创建任何平台', async () => {
    const d = deps(() => {
      throw new Error('should not be called')
    })
    expect(await configureContextRepos('group/web/app', {}, d)).toEqual([])
    expect(d.warn).not.toHaveBeenCalled()
  })

  test('项目没有命中条目 → 空', async () => {
    const d = deps(() => platformOf('main'))
    expect(await configureContextRepos('other/project', env, d)).toEqual([])
  })

  test('成功：别名取路径最后一段，ref 为默认分支，写入模块状态', async () => {
    const p = platformOf('master')
    const d = deps(path => {
      expect(path).toBe('group/lib/shared')
      return p
    })
    const result = await configureContextRepos('group/web/app', env, d)

    expect(result).toEqual([
      {
        alias: 'shared',
        path: 'group/lib/shared',
        owner: 'group/lib',
        repo: 'shared',
        ref: 'master',
        platform: p
      }
    ])
    expect(p.getDefaultBranch).toHaveBeenCalledWith('group/lib', 'shared')
    expect(getContextRepos()).toEqual(result)
    expect(d.info).toHaveBeenCalledWith('context repos: shared@master')
  })

  test('映射表里没有该仓库的凭据 → 跳过并告警（不回退到被审仓库的凭据）', async () => {
    const d = deps(() => {
      throw new Error('project "group/lib/shared" is not listed in AI_REVIEWER_GITLAB_TOKEN_MAP')
    })
    expect(await configureContextRepos('group/web/app', env, d)).toEqual([])
    expect(d.warn).toHaveBeenCalledWith(expect.stringContaining('skipped'))
    expect(getContextRepos()).toEqual([])
  })

  test('平台不支持读取默认分支 → 跳过并告警', async () => {
    const d = deps(() => ({}))
    expect(await configureContextRepos('group/web/app', env, d)).toEqual([])
    expect(d.warn).toHaveBeenCalledWith(expect.stringContaining('default branch'))
  })

  test('读取项目失败（权限等）→ 跳过并告警', async () => {
    const d = deps(() => platformOf(new Error('403 Forbidden')))
    expect(await configureContextRepos('group/web/app', env, d)).toEqual([])
    expect(d.warn).toHaveBeenCalledWith(expect.stringContaining('403 Forbidden'))
  })

  test('空仓库（没有默认分支）→ 跳过并告警', async () => {
    const d = deps(() => platformOf(null))
    expect(await configureContextRepos('group/web/app', env, d)).toEqual([])
    expect(d.warn).toHaveBeenCalledWith(expect.stringContaining('no default branch'))
  })

  test('就是被审仓库自己 → 跳过并告警', async () => {
    const d = deps(() => platformOf('main'))
    const result = await configureContextRepos(
      'group/lib/shared',
      {[CONTEXT_REPOS_ENV]: 'group/lib = group/lib/shared'},
      d
    )
    expect(result).toEqual([])
    expect(d.warn).toHaveBeenCalledWith(expect.stringContaining('under review'))
  })

  test('别名冲突（不同组下同名仓库）→ 后者跳过并告警', async () => {
    const d = deps(() => platformOf('main'))
    const result = await configureContextRepos(
      'group/web/app',
      {[CONTEXT_REPOS_ENV]: 'group/web/app = group/a/shared, group/b/shared'},
      d
    )
    expect(result.map(r => r.path)).toEqual(['group/a/shared'])
    expect(d.warn).toHaveBeenCalledWith(expect.stringContaining('alias "shared"'))
  })

  test('配置格式非法 → 整个功能关闭并告警，不抛错', async () => {
    const d = deps(() => platformOf('main'))
    const result = await configureContextRepos(
      'group/web/app',
      {[CONTEXT_REPOS_ENV]: 'not a valid line'},
      d
    )
    expect(result).toEqual([])
    expect(d.warn).toHaveBeenCalledWith(expect.stringContaining('context repos disabled'))
  })

  test('每次调用都重置上一次的状态', async () => {
    await configureContextRepos(
      'group/web/app',
      env,
      deps(() => platformOf('main'))
    )
    expect(getContextRepos()).toHaveLength(1)
    await configureContextRepos(
      'group/web/app',
      {},
      deps(() => platformOf('main'))
    )
    expect(getContextRepos()).toHaveLength(0)
  })
})
