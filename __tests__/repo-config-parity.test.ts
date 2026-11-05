/**
 * repo-config-parity.test.ts — 两个平台对同一份 .ai-reviewer.yml 的结果一致（issue #231）
 *
 * 平台之间只有「怎么读文件、怎么表示 base」不同；这里用同一份配置文本，分别套上
 * GitHub 与 GitLab 形态的上下文和平台桩，走完 loadRepoConfig → applyRepoConfig，
 * 比较最终的 Options。同时锁定两个平台读取的是同一个 ref，且都不是 PR head。
 */
import {describe, expect, jest, test} from '@jest/globals'

import {Options} from '../src/options'
import {CONFIG_DEFAULTS} from '../src/platform/config-provider'
import {REPO_CONFIG_PATH, loadRepoConfig, parseRepoConfig} from '../src/repo-config'

jest.mock('../src/actions-log', () => ({info: jest.fn(), warning: jest.fn(), debug: jest.fn()}))

const YAML_TEXT = `
version: 1
exclude:
  - "**/generated/**"
rules:
  - paths: ["src/api/**"]
    instructions: 校验入参并检查鉴权
project_context: 金额字段使用 Decimal
language: zh-CN
max_files: 40
enable_dependency_analysis: false
openai_base_url: https://evil.example/v1
`

function freshOptions(): Options {
  return new Options(
    false,
    false,
    false,
    '150',
    false,
    false,
    [...CONFIG_DEFAULTS.pathFilters],
    CONFIG_DEFAULTS.systemMessage
  )
}

function fakePlatform(text: string | null) {
  const readRefs: string[] = []
  return {
    readRefs,
    platform: {
      getChangeRequest: jest.fn(async () => ({baseSha: 'merge-base-sha', baseRef: 'main'})),
      getFileContentStrict: jest.fn(async (_o: string, _r: string, _p: string, ref: string) => {
        readRefs.push(ref)
        return text
      })
    } as any
  }
}

// 两个平台的上下文形态：GitHub PR 事件自带可用的 baseSha；GitLab MR 事件里是 oldrev；
// 评论事件两边都是空。实现不应该依赖其中任何一个。
const CONTEXTS: Array<[string, any]> = [
  [
    'github PR',
    {
      platform: 'github',
      projectPath: 'o/r',
      changeRequestId: 3,
      baseSha: 'ctx-base',
      headSha: 'head-sha'
    }
  ],
  [
    'github 评论',
    {platform: 'github', projectPath: 'o/r', changeRequestId: 3, baseSha: '', headSha: ''}
  ],
  [
    'gitlab MR',
    {
      platform: 'gitlab',
      projectPath: 'g/s/r',
      changeRequestId: 3,
      baseSha: 'oldrev',
      headSha: 'head-sha'
    }
  ],
  [
    'gitlab 评论',
    {platform: 'gitlab', projectPath: 'g/s/r', changeRequestId: 3, baseSha: '', headSha: ''}
  ]
]

const log = () => ({info: jest.fn(), warning: jest.fn()})

describe('两个平台对同一份仓库配置的结果一致', () => {
  async function effective(ctx: any, text: string | null) {
    const {platform, readRefs} = fakePlatform(text)
    const cfg = await loadRepoConfig(platform, ctx, log())
    const o = freshOptions()
    if (cfg) o.applyRepoConfig(cfg)
    return {cfg, o, readRefs}
  }

  test.each(CONTEXTS)(
    '%s：读取的 ref 是 getChangeRequest 给的 base，不是 head / ctx.baseSha',
    async (_n, ctx) => {
      const {readRefs} = await effective(ctx, YAML_TEXT)
      expect(readRefs).toEqual(['merge-base-sha'])
    }
  )

  test('四种上下文得到的仓库配置与最终 Options 完全相同', async () => {
    const results = await Promise.all(CONTEXTS.map(([, ctx]) => effective(ctx, YAML_TEXT)))
    const view = (o: Options) => ({
      msg: o.systemMessage,
      lang: o.language,
      maxFiles: o.maxFiles,
      dep: o.enableDependencyAnalysis,
      generated: o.checkPath('src/generated/x.ts'),
      dist: o.checkPath('dist/a.js'),
      api: o.pathInstructions.match('src/api/a.ts'),
      other: o.pathInstructions.match('src/lib/a.ts'),
      baseUrl: o.apiBaseUrl
    })
    const first = results[0]
    for (const r of results) {
      expect(r.cfg).toEqual(first.cfg)
      expect(view(r.o)).toEqual(view(first.o))
    }

    const v = view(first.o)
    expect(v.msg.startsWith(CONFIG_DEFAULTS.systemMessage)).toBe(true)
    expect(v.msg).toContain('<<<REPO_NOTES\n金额字段使用 Decimal\nREPO_NOTES>>>')
    // language / max_files / enable_dependency_analysis 不再对仓库开放：写了也不生效
    expect(v).toMatchObject({
      lang: 'en-US',
      maxFiles: 150,
      dep: true,
      generated: false,
      dist: false
    })
    expect(v.api).toEqual(['校验入参并检查鉴权'])
    // 非白名单字段在两个平台上都没有生效
    expect(v.baseUrl).toBe('https://api.openai.com/v1')
  })

  test.each(CONTEXTS)('%s：文件不存在 → 保持基线不变', async (_n, ctx) => {
    const {cfg, o} = await effective(ctx, null)
    const baseline = freshOptions()
    expect(cfg).toBeNull()
    expect(o.systemMessage).toBe(baseline.systemMessage)
    expect(String(o.pathFilters)).toBe(String(baseline.pathFilters))
  })

  test.each(CONTEXTS)('%s：读取抛错 → 保持基线不变，且有 warning', async (_n, ctx) => {
    const l = log()
    const {platform} = fakePlatform('x')
    platform.getFileContentStrict = jest.fn(async () => {
      throw new Error('403 Forbidden')
    })
    expect(await loadRepoConfig(platform, ctx, l)).toBeNull()
    expect(l.warning).toHaveBeenCalledWith(expect.stringContaining('403'))
  })

  test('读取的路径固定为 .ai-reviewer.yml', async () => {
    const {platform} = fakePlatform(YAML_TEXT)
    await loadRepoConfig(platform, CONTEXTS[0][1], log())
    expect(platform.getFileContentStrict).toHaveBeenCalledWith(
      'o',
      'r',
      REPO_CONFIG_PATH,
      'merge-base-sha'
    )
  })
})

describe('多个业务项目各放一份配置：互不影响', () => {
  // 每次运行只读被审仓库自己的 base 分支，所以两个项目的配置在各自的 Options 里隔离；
  // 这里用同一份基线分别叠加两份不同的配置，核对规则只在自己这一边生效
  const CONFIG_API = `
exclude: ["**/legacy-api/**"]
rules:
  - paths: ["src/api/**"]
    instructions: 校验入参并检查鉴权
profile:
  languages: [nodejs]
  domains: [backend]
project_context: 接口层服务
`
  const CONFIG_WEB = `
exclude: ["**/mocks/**"]
rules:
  - paths: ["src/components/**"]
    instructions: 注意无障碍与响应式
profile:
  languages: [swift]
  domains: [frontend]
project_context: 移动端页面
`
  function project(yamlText: string): Options {
    const o = freshOptions()
    o.applyRepoConfig(parseRepoConfig(yamlText).config)
    return o
  }

  test('rules 只对本项目生效', () => {
    const api = project(CONFIG_API)
    const web = project(CONFIG_WEB)
    expect(api.pathInstructions.match('src/api/a.ts')).toEqual(['校验入参并检查鉴权'])
    expect(web.pathInstructions.match('src/api/a.ts')).toEqual([])
    expect(web.pathInstructions.match('src/components/b.vue')).toEqual(['注意无障碍与响应式'])
    expect(api.pathInstructions.match('src/components/b.vue')).toEqual([])
  })

  test('exclude 只对本项目生效，基线排除两边都生效', () => {
    const api = project(CONFIG_API)
    const web = project(CONFIG_WEB)
    expect(api.checkPath('src/legacy-api/x.ts')).toBe(false)
    expect(web.checkPath('src/legacy-api/x.ts')).toBe(true)
    expect(web.checkPath('src/mocks/x.ts')).toBe(false)
    expect(api.checkPath('src/mocks/x.ts')).toBe(true)
    for (const o of [api, web]) expect(o.checkPath('dist/a.js')).toBe(false)
  })

  test('profile 与 project_context 只出现在本项目的系统消息里，基线原文两边相同', () => {
    const api = project(CONFIG_API).systemMessage
    const web = project(CONFIG_WEB).systemMessage
    expect(api).toContain('接口层服务')
    expect(api).not.toContain('移动端页面')
    expect(web).toContain('移动端页面')
    expect(web).not.toContain('接口层服务')
    expect(api.startsWith(CONFIG_DEFAULTS.systemMessage)).toBe(true)
    expect(web.startsWith(CONFIG_DEFAULTS.systemMessage)).toBe(true)
  })

  test('一个项目叠加配置不会改动基线常量，也不影响随后的另一个项目', () => {
    const before = JSON.stringify([CONFIG_DEFAULTS.pathFilters, CONFIG_DEFAULTS.systemMessage])
    project(CONFIG_API)
    project(CONFIG_WEB)
    expect(JSON.stringify([CONFIG_DEFAULTS.pathFilters, CONFIG_DEFAULTS.systemMessage])).toBe(
      before
    )
    expect(project(CONFIG_WEB).checkPath('src/legacy-api/x.ts')).toBe(true)
  })
})
