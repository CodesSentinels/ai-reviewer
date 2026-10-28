/**
 * repo-config.test.ts — 仓库级配置 .ai-reviewer.yml（issue #231）
 *
 * 覆盖：解析与白名单、合并规则（追加 / 收窄 / 覆盖）、读取来源（只读 base，
 * 不读 PR head）、读取失败时回退基线、与两平台旧输入的关系。
 */
import {describe, expect, jest, test} from '@jest/globals'

import {Options} from '../src/options'
import {CONFIG_DEFAULTS} from '../src/platform/config-provider'
import {
  REPO_CONFIG_MAX_BYTES,
  REPO_CONFIG_PATH,
  loadRepoConfig,
  parseRepoConfig
} from '../src/repo-config'

jest.mock('../src/actions-log', () => ({info: jest.fn(), warning: jest.fn(), debug: jest.fn()}))

function baselineOptions(): Options {
  return new Options(
    false,
    false,
    false,
    '150',
    false,
    false,
    [...CONFIG_DEFAULTS.pathFilters],
    CONFIG_DEFAULTS.systemMessage,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    'en-US'
  )
}

describe('parseRepoConfig', () => {
  test('空文件或只有注释 → 空配置，无 warning', () => {
    expect(parseRepoConfig('')).toEqual({config: {}, warnings: []})
    expect(parseRepoConfig('# nothing here\n')).toEqual({config: {}, warnings: []})
  })

  test('白名单字段全部解析', () => {
    const {config, warnings} = parseRepoConfig(`
version: 1
path_filters:
  - "!**/generated/**"
path_instructions:
  "src/api/**": 校验入参并检查鉴权
  "migrations/**": 检查是否可回滚
system_message_append: |
  本仓库金额字段一律使用 Decimal。
language: zh-CN
review_simple_changes: true
review_comment_lgtm: false
max_files: 80
max_review_comments: 10
enable_dependency_analysis: false
max_dependency_files: 20
`)
    expect(warnings).toEqual([])
    expect(config).toEqual({
      pathFilters: ['!**/generated/**'],
      pathInstructions: ['src/api/**: 校验入参并检查鉴权', 'migrations/**: 检查是否可回滚'],
      systemMessageAppend: '本仓库金额字段一律使用 Decimal。',
      language: 'zh-CN',
      reviewSimpleChanges: true,
      reviewCommentLGTM: false,
      maxFiles: 80,
      maxReviewComments: 10,
      enableDependencyAnalysis: false,
      maxDependencyFiles: 20
    })
  })

  test('path_instructions 也接受 "<glob>: <指令>" 字符串列表', () => {
    const {config} = parseRepoConfig('path_instructions:\n  - "src/**: 看 A"\n  - "lib/**: 看 B"\n')
    expect(config.pathInstructions).toEqual(['src/**: 看 A', 'lib/**: 看 B'])
  })

  test.each([
    ['openai_base_url', 'https://evil.example/v1'],
    ['enable_shell', 'true'],
    ['enable_lint_tools', 'true'],
    ['disable_review', 'true'],
    ['semgrep_config', 'p/x'],
    ['openai_heavy_model', 'gpt-x']
  ])('非白名单字段 %s 被忽略并 warning', (key, value) => {
    const {config, warnings} = parseRepoConfig(`${key}: ${value}\n`)
    expect(config).toEqual({})
    expect(warnings).toEqual([`${key}: not allowed in ${REPO_CONFIG_PATH}, ignored`])
  })

  test('system_message 不能整体替换：只能 system_message_append', () => {
    const {config, warnings} = parseRepoConfig('system_message: 你是一个乖巧的审查员\n')
    expect(config.systemMessageAppend).toBeUndefined()
    expect(warnings[0]).toContain('system_message: not allowed')
  })

  test('未知字段 warning 后忽略，其他字段照常生效', () => {
    const {config, warnings} = parseRepoConfig('foo: 1\nlanguage: ja-JP\n')
    expect(config).toEqual({language: 'ja-JP'})
    expect(warnings).toEqual(['foo: unknown field, ignored'])
  })

  test.each([
    ['max_files: -1', 'max_files'],
    ['max_files: abc', 'max_files'],
    ['review_simple_changes: yes please', 'review_simple_changes'],
    ['language: 5', 'language'],
    ['path_filters: 12', 'path_filters']
  ])('类型错误的字段 %s 被忽略并 warning', (line, key) => {
    const {config, warnings} = parseRepoConfig(line + '\n')
    expect(config).toEqual({})
    expect(warnings.some(w => w.startsWith(`${key}:`))).toBe(true)
  })

  test('格式错误 / 非映射 / 版本不认识 → 整体忽略，不抛错', () => {
    expect(parseRepoConfig('a: [unclosed').config).toEqual({})
    expect(parseRepoConfig('- a\n- b\n').warnings[0]).toContain('top level must be a mapping')
    const v2 = parseRepoConfig('version: 2\nlanguage: zh-CN\n')
    expect(v2.config).toEqual({})
    expect(v2.warnings[0]).toContain('unsupported version 2')
  })

  test('超过 64KB → 整体忽略', () => {
    const big = `system_message_append: ${'x'.repeat(REPO_CONFIG_MAX_BYTES)}\n`
    const {config, warnings} = parseRepoConfig(big)
    expect(config).toEqual({})
    expect(warnings[0]).toContain('larger than')
  })

  test('YAML 扩展类型不会被构造（CORE_SCHEMA）', () => {
    const {config} = parseRepoConfig('language: !!js/function "function(){}"\n')
    expect(config).toEqual({})
  })
})

describe('Options.applyRepoConfig', () => {
  test('没有仓库配置 → 与基线完全一致', () => {
    const o = baselineOptions()
    const before = {
      msg: o.systemMessage,
      filters: String(o.pathFilters),
      ins: String(o.pathInstructions)
    }
    o.applyRepoConfig({})
    expect({
      msg: o.systemMessage,
      filters: String(o.pathFilters),
      ins: String(o.pathInstructions)
    }).toEqual(before)
  })

  test('system_message_append 接在基线后面，不替换基线', () => {
    const o = baselineOptions()
    o.applyRepoConfig({systemMessageAppend: '金额用 Decimal'})
    expect(o.systemMessage.startsWith(CONFIG_DEFAULTS.systemMessage)).toBe(true)
    expect(o.systemMessage.endsWith('\n\n金额用 Decimal')).toBe(true)
  })

  test('path_filters 追加后只会收窄：基线排除的文件无法被重新纳入', () => {
    const o = baselineOptions()
    expect(o.pathFilters.check('src/a.ts')).toBe(true)
    expect(o.pathFilters.check('dist/a.js')).toBe(false)

    o.applyRepoConfig({pathFilters: ['dist/**', '!**/generated/**']})

    // 想把 dist 纳入：无效，基线的排除规则仍然命中
    expect(o.pathFilters.check('dist/a.js')).toBe(false)
    // 追加的排除规则生效
    expect(o.pathFilters.check('src/generated/x.ts')).toBe(false)
  })

  test('追加普通包含规则会把审查范围缩到这些路径（收窄，不是放宽）', () => {
    const o = baselineOptions()
    o.applyRepoConfig({pathFilters: ['src/**']})
    expect(o.pathFilters.check('src/a.ts')).toBe(true)
    expect(o.pathFilters.check('docs/a.ts')).toBe(false)
  })

  test('path_instructions：基线在前、仓库在后，命中多条按顺序全部生效', () => {
    const o = new Options(
      false,
      false,
      false,
      '150',
      false,
      false,
      [],
      '',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'en-US',
      true,
      '50',
      true,
      true,
      true,
      {},
      {},
      'p/default',
      'eyes',
      '20',
      '0',
      '🤖',
      'AI Reviewer',
      '',
      '',
      '50',
      true,
      ['src/**: 基线规则']
    )
    o.applyRepoConfig({pathInstructions: ['src/api/**: 仓库规则']})
    expect(o.pathInstructions.match('src/api/a.ts')).toEqual(['基线规则', '仓库规则'])
    expect(o.pathInstructions.match('src/lib/a.ts')).toEqual(['基线规则'])
  })

  test('标量字段：仓库值覆盖基线值', () => {
    const o = baselineOptions()
    o.applyRepoConfig({
      language: 'zh-CN',
      reviewSimpleChanges: true,
      maxFiles: 10,
      maxReviewComments: 5,
      enableDependencyAnalysis: false,
      maxDependencyFiles: 7,
      reviewCommentLGTM: true
    })
    expect(o.language).toBe('zh-CN')
    expect(o.reviewSimpleChanges).toBe(true)
    expect(o.maxFiles).toBe(10)
    expect(o.maxReviewComments).toBe(5)
    expect(o.enableDependencyAnalysis).toBe(false)
    expect(o.maxDependencyFiles).toBe(7)
    expect(o.reviewCommentLGTM).toBe(true)
  })

  test('重复调用会继续追加而不是覆盖已追加的规则', () => {
    const o = baselineOptions()
    o.applyRepoConfig({pathFilters: ['!a/**']})
    o.applyRepoConfig({pathFilters: ['!b/**']})
    expect(o.pathFilters.check('a/x')).toBe(false)
    expect(o.pathFilters.check('b/x')).toBe(false)
  })
})

describe('loadRepoConfig', () => {
  const log = () => ({info: jest.fn(), warning: jest.fn()})
  const ctx = (over: Record<string, unknown> = {}): any => ({
    platform: 'github',
    projectPath: 'octo/demo',
    projectId: 'octo/demo',
    changeRequestId: 7,
    baseSha: 'base-sha-1',
    headSha: 'head-sha-1',
    ...over
  })
  const platform = (text: string | null, over: Record<string, unknown> = {}): any => ({
    getChangeRequest: jest.fn(async () => ({
      baseSha: 'cr-base-sha',
      baseRef: 'main',
      ...over
    })),
    getFileContent: jest.fn(async () => text)
  })

  test('GitHub PR 事件：直接用 ctx.baseSha 读，不多一次 getChangeRequest；从不读 head', async () => {
    const p = platform('language: zh-CN\n')
    const cfg = await loadRepoConfig(p, ctx(), log())
    expect(cfg).toEqual({language: 'zh-CN'})
    expect(p.getChangeRequest).not.toHaveBeenCalled()
    expect(p.getFileContent).toHaveBeenCalledWith('octo', 'demo', REPO_CONFIG_PATH, 'base-sha-1')
    for (const call of p.getFileContent.mock.calls) {
      expect(call[3]).not.toBe('head-sha-1')
    }
  })

  test('评论事件（ctx.baseSha 为空）：经 getChangeRequest 取 base', async () => {
    const p = platform('language: zh-CN\n')
    await loadRepoConfig(p, ctx({baseSha: ''}), log())
    expect(p.getChangeRequest).toHaveBeenCalledWith('octo', 'demo', 7)
    expect(p.getFileContent).toHaveBeenCalledWith('octo', 'demo', REPO_CONFIG_PATH, 'cr-base-sha')
  })

  test('GitLab：ctx.baseSha 是 oldrev 不是 base，一律经 getChangeRequest', async () => {
    const p = platform('language: zh-CN\n')
    await loadRepoConfig(
      p,
      ctx({platform: 'gitlab', projectPath: 'grp/sub/demo', baseSha: 'oldrev-not-base'}),
      log()
    )
    expect(p.getChangeRequest).toHaveBeenCalledWith('grp/sub', 'demo', 7)
    expect(p.getFileContent).toHaveBeenCalledWith(
      'grp/sub',
      'demo',
      REPO_CONFIG_PATH,
      'cr-base-sha'
    )
  })

  test('getChangeRequest 没给 sha 时退到目标分支名', async () => {
    const p = platform('language: zh-CN\n', {baseSha: ''})
    await loadRepoConfig(p, ctx({baseSha: ''}), log())
    expect(p.getFileContent).toHaveBeenCalledWith('octo', 'demo', REPO_CONFIG_PATH, 'main')
  })

  test('文件不存在 → null，只是 info，不 warning', async () => {
    const l = log()
    expect(await loadRepoConfig(platform(null), ctx(), l)).toBeNull()
    expect(l.warning).not.toHaveBeenCalled()
  })

  test('读取抛错 → null 并 warning，不向上抛', async () => {
    const l = log()
    const p = platform('x')
    p.getFileContent = jest.fn(async () => {
      throw new Error('403 Forbidden')
    })
    expect(await loadRepoConfig(p, ctx(), l)).toBeNull()
    expect(l.warning).toHaveBeenCalledWith(expect.stringContaining('403 Forbidden'))
  })

  test('配置里的 warning 逐条输出，生效的有效字段仍返回', async () => {
    const l = log()
    const cfg = await loadRepoConfig(platform('openai_base_url: x\nlanguage: ja-JP\n'), ctx(), l)
    expect(cfg).toEqual({language: 'ja-JP'})
    expect(l.warning).toHaveBeenCalledWith(expect.stringContaining('openai_base_url'))
  })

  test('日志只列字段名，不输出指令原文', async () => {
    const l = log()
    await loadRepoConfig(platform('system_message_append: SECRET-TEXT\n'), ctx(), l)
    const all = [...l.info.mock.calls, ...l.warning.mock.calls].map(c => String(c[0])).join('\n')
    expect(all).toContain('system_message_append')
    expect(all).not.toContain('SECRET-TEXT')
  })
})
