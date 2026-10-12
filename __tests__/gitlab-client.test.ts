/**
 * gitlab-client.test.ts — 统一 GitLab client factory 契约测试
 *
 * GLAPI-024（分页契约）/ GLAPI-029（host、PAT、timeout 受信任配置 + 不泄露 token）
 * / GLAPI-030（客户端唯一构造入口）
 */
import {describe, expect, test, jest, beforeEach} from '@jest/globals'

const mockGitlabCtor = jest.fn()

jest.mock('@gitbeaker/rest', () => ({
  Gitlab: mockGitlabCtor.mockImplementation(function (this: any, opts: any) {
    this.opts = opts
  })
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  configuredBotGitLabLogin,
  createGitLabClient,
  describeGitLabClientConfig,
  matchGitLabTokenMap,
  parseGitLabTokenMap,
  prepareGitLabClientConfig,
  previousBotGitLabLogins,
  GitLabClientConfigError,
  GITLAB_CLIENT_DEFAULTS,
  listOptions,
  JOB_TOKEN_LIMITATION_WARNING,
  PAGINATION_DEFAULTS,
  TREE_PAGINATION_DEFAULTS,
  resolveGitLabClientConfig,
  validateGitLabHost,
  validateGitLabTimeoutMS
} = require('../src/platform/gitlab-client')

describe('resolveGitLabClientConfig（GLAPI-029）', () => {
  test('PAT 优先于 CI_JOB_TOKEN', () => {
    const config = resolveGitLabClientConfig({
      GITLAB_PAT: 'glpat-abc',
      CI_JOB_TOKEN: 'job-token'
    })
    expect(config.credential).toEqual({type: 'pat', value: 'glpat-abc'})
  })

  test('PAT 为空白字符串时 fallback 到 CI_JOB_TOKEN', () => {
    const config = resolveGitLabClientConfig({GITLAB_PAT: '   ', CI_JOB_TOKEN: 'job-token'})
    expect(config.credential).toEqual({type: 'job_token', value: 'job-token'})
  })

  // job token 的能力边界是配置期就能确定的事实，不该等运行时逐次 401 才暴露
  test('选中 job token → 打降级 warning，说明命令权限会全拒', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    resolveGitLabClientConfig({CI_JOB_TOKEN: 'job-token'})
    const warned = warnSpy.mock.calls.map(c => String(c[0])).join('\n')
    warnSpy.mockRestore()

    expect(warned).toContain(JOB_TOKEN_LIMITATION_WARNING)
    expect(JOB_TOKEN_LIMITATION_WARNING).toContain('/projects/:id/members')
    expect(JOB_TOKEN_LIMITATION_WARNING).toContain('GITLAB_PAT')
  })

  test('选中 PAT → 不打 job token 的降级 warning', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    resolveGitLabClientConfig({GITLAB_PAT: 'glpat-abc', CI_JOB_TOKEN: 'job-token'})
    const warned = warnSpy.mock.calls.map(c => String(c[0])).join('\n')
    warnSpy.mockRestore()

    expect(warned).not.toContain(JOB_TOKEN_LIMITATION_WARNING)
  })

  test('warning 不含 token 值（GLAPI-029）', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    resolveGitLabClientConfig({CI_JOB_TOKEN: 'super-secret-job-token'})
    const warned = warnSpy.mock.calls.map(c => String(c[0])).join('\n')
    warnSpy.mockRestore()

    expect(warned).not.toContain('super-secret-job-token')
  })

  test('两个凭据都缺失 → fail closed 抛错', () => {
    expect(() => resolveGitLabClientConfig({})).toThrow(GitLabClientConfigError)
    expect(() => resolveGitLabClientConfig({})).toThrow('GITLAB_PAT or CI_JOB_TOKEN is required')
  })

  test('host 默认 gitlab.com，可由 CI_SERVER_URL 覆盖（自定义 host）', () => {
    expect(resolveGitLabClientConfig({GITLAB_PAT: 'p'}).host).toBe(GITLAB_CLIENT_DEFAULTS.host)
    expect(
      resolveGitLabClientConfig({GITLAB_PAT: 'p', CI_SERVER_URL: 'https://gitlab.corp.internal'})
        .host
    ).toBe('https://gitlab.corp.internal')
  })

  test('timeout 默认 30s，可由 AI_REVIEWER_GITLAB_TIMEOUT_MS 覆盖', () => {
    expect(resolveGitLabClientConfig({GITLAB_PAT: 'p'}).timeoutMS).toBe(
      GITLAB_CLIENT_DEFAULTS.timeoutMS
    )
    expect(
      resolveGitLabClientConfig({GITLAB_PAT: 'p', AI_REVIEWER_GITLAB_TIMEOUT_MS: '5000'}).timeoutMS
    ).toBe(5000)
  })

  test('非法 timeout → fail closed，不静默回退默认值', () => {
    expect(() =>
      resolveGitLabClientConfig({GITLAB_PAT: 'p', AI_REVIEWER_GITLAB_TIMEOUT_MS: 'abc'})
    ).toThrow(GitLabClientConfigError)
    expect(() =>
      resolveGitLabClientConfig({GITLAB_PAT: 'p', AI_REVIEWER_GITLAB_TIMEOUT_MS: '0'})
    ).toThrow(/out of range/)
    expect(() =>
      resolveGitLabClientConfig({GITLAB_PAT: 'p', AI_REVIEWER_GITLAB_TIMEOUT_MS: '999999'})
    ).toThrow(/out of range/)
  })
})

describe('validateGitLabHost（GLAPI-029）', () => {
  test('去掉结尾斜杠', () => {
    expect(validateGitLabHost('https://gitlab.com/')).toBe('https://gitlab.com')
    expect(validateGitLabHost('https://gitlab.com///')).toBe('https://gitlab.com')
  })

  test('拒绝非 URL / 非 http(s) 协议', () => {
    expect(() => validateGitLabHost('not-a-url')).toThrow(GitLabClientConfigError)
    expect(() => validateGitLabHost('ftp://gitlab.com')).toThrow(/http\/https/)
    expect(() => validateGitLabHost('  ')).toThrow(/empty/)
  })

  test('拒绝内嵌凭据的 host（防止 token 进日志）', () => {
    expect(() => validateGitLabHost('https://user:glpat-secret@gitlab.com')).toThrow(
      /must not embed credentials/
    )
  })

  test('拒绝带 token query 的 host', () => {
    expect(() => validateGitLabHost('https://gitlab.com?private_token=glpat-x')).toThrow(
      /token query parameter/
    )
    expect(() => validateGitLabHost('https://gitlab.com?token=x')).toThrow(/token query parameter/)
  })
})

describe('validateGitLabTimeoutMS', () => {
  test('接受区间内的正整数', () => {
    expect(validateGitLabTimeoutMS('1000')).toBe(1000)
    expect(validateGitLabTimeoutMS(' 60000 ')).toBe(60000)
  })

  test('拒绝负数、小数和非数字', () => {
    expect(() => validateGitLabTimeoutMS('-1')).toThrow(GitLabClientConfigError)
    expect(() => validateGitLabTimeoutMS('1.5')).toThrow(GitLabClientConfigError)
    expect(() => validateGitLabTimeoutMS('30s')).toThrow(GitLabClientConfigError)
  })
})

describe('AI_REVIEWER_GITLAB_TOKEN_MAP：按项目选择凭据', () => {
  const MAP = [
    '# 注释行',
    'group/web = GITLAB_PAT_WEB',
    'group/web/app = GITLAB_PAT_APP',
    'other/lib=GITLAB_PAT_LIB'
  ].join('\n')
  const ENV = {
    AI_REVIEWER_GITLAB_TOKEN_MAP: MAP,
    GITLAB_PAT_WEB: 'tok-web',
    GITLAB_PAT_APP: 'tok-app',
    GITLAB_PAT_LIB: 'tok-lib',
    GITLAB_PAT: 'tok-default'
  }

  test('解析：支持换行 / ; / , 分隔，忽略注释与首尾斜杠，路径转小写', () => {
    expect(parseGitLabTokenMap('/Group/Web/ = GITLAB_A; b = GITLAB_B, * = GITLAB_C\n# x')).toEqual([
      {prefix: 'group/web', variable: 'GITLAB_A'},
      {prefix: 'b', variable: 'GITLAB_B'},
      {prefix: '*', variable: 'GITLAB_C'}
    ])
  })

  test.each([
    ['group/web', '缺少 = 号', 'expected "path = VARIABLE"'],
    [' = GITLAB_A', '空路径', 'empty project path'],
    ['a = OPENAI_API_KEY', '不是 GITLAB_ 开头的变量', 'not allowed'],
    ['a = gitlab_lower', '小写变量名', 'not allowed'],
    ['a = GITLAB_A\nA/ = GITLAB_B', '前缀重复（忽略大小写和斜杠）', 'duplicate entry'],
    ['# 只有注释', '没有条目', 'contains no entries']
  ])('解析：%j（%s）→ fail closed', (raw, _why, message) => {
    expect(() => parseGitLabTokenMap(raw)).toThrow(GitLabClientConfigError)
    expect(() => parseGitLabTokenMap(raw)).toThrow(message)
  })

  test('匹配：按路径段匹配，最长前缀优先，* 兜底，不区分大小写', () => {
    const entries = parseGitLabTokenMap(`${MAP}\n* = GITLAB_PAT`)
    const pick = (path: string): string | undefined => matchGitLabTokenMap(entries, path)?.variable
    expect(pick('group/web/app')).toBe('GITLAB_PAT_APP')
    expect(pick('group/web/app/sub')).toBe('GITLAB_PAT_APP')
    expect(pick('Group/Web/Other')).toBe('GITLAB_PAT_WEB')
    expect(pick('group/web')).toBe('GITLAB_PAT_WEB')
    // 不能按字符串前缀匹配：group/webapp 不属于 group/web
    expect(pick('group/webapp')).toBe('GITLAB_PAT')
    expect(pick('unrelated/x')).toBe('GITLAB_PAT')
  })

  test('匹配：没有 * 时，表外项目没有条目', () => {
    expect(matchGitLabTokenMap(parseGitLabTokenMap(MAP), 'group/webapp')).toBeNull()
  })

  test('选中映射表里的 token，优先于 GITLAB_PAT', () => {
    const config = resolveGitLabClientConfig(ENV, 'group/web/app')
    expect(config.credential).toEqual({type: 'pat', value: 'tok-app'})
    expect(resolveGitLabClientConfig(ENV, 'other/lib').credential.value).toBe('tok-lib')
  })

  test('映射表即白名单：表外项目拒绝，不回退到 GITLAB_PAT', () => {
    expect(() => resolveGitLabClientConfig(ENV, 'group/webapp')).toThrow(
      'project "group/webapp" is not listed in AI_REVIEWER_GITLAB_TOKEN_MAP'
    )
  })

  test('映射到的变量为空 → 报出变量名，不报 token', () => {
    expect(() => resolveGitLabClientConfig({...ENV, GITLAB_PAT_APP: ' '}, 'group/web/app')).toThrow(
      'GITLAB_PAT_APP (mapped for "group/web/app" in AI_REVIEWER_GITLAB_TOKEN_MAP) is not set'
    )
  })

  test('启用映射表但没给项目路径 → 拒绝', () => {
    expect(() => resolveGitLabClientConfig(ENV)).toThrow('needs the project path')
  })

  test('语法错误在拿到项目路径之前就暴露', () => {
    expect(() => prepareGitLabClientConfig({AI_REVIEWER_GITLAB_TOKEN_MAP: 'oops'})).toThrow(
      GitLabClientConfigError
    )
  })

  test('配置摘要带上命中的条目（只有变量名），不含 token', () => {
    const summary = describeGitLabClientConfig(resolveGitLabClientConfig(ENV, 'group/web/app'))
    expect(summary).toBe(
      'host=https://gitlab.com credential=pat ' +
        '(AI_REVIEWER_GITLAB_TOKEN_MAP: group/web/app → GITLAB_PAT_APP) timeout=30000ms'
    )
    expect(summary).not.toContain('tok-')
  })

  test('未启用映射表时行为不变：GITLAB_PAT（可以是 PAT / Project / Group Access Token）', () => {
    expect(
      resolveGitLabClientConfig({GITLAB_PAT: 'tok-default'}, 'any/project').credential
    ).toEqual({type: 'pat', value: 'tok-default'})
  })

  test('启用映射表时忽略 AI_REVIEWER_BOT_GITLAB_LOGIN：各项目的 bot 账号不同', () => {
    expect(configuredBotGitLabLogin({AI_REVIEWER_BOT_GITLAB_LOGIN: ' my-bot '})).toBe('my-bot')
    expect(configuredBotGitLabLogin({AI_REVIEWER_BOT_GITLAB_LOGIN: 'my-bot', ...ENV})).toBe('')
  })
})

describe('AI_REVIEWER_GITLAB_PREVIOUS_BOT_LOGINS：以前用过的 bot 账号', () => {
  test('逗号 / 分号 / 空白分隔，去掉 @ 和空项', () => {
    expect(
      previousBotGitLabLogins({
        AI_REVIEWER_GITLAB_PREVIOUS_BOT_LOGINS: ' @project_1_bot_a, project_2_bot_b;\nold '
      })
    ).toEqual(['project_1_bot_a', 'project_2_bot_b', 'old'])
  })

  test('未配置 → 空列表', () => {
    expect(previousBotGitLabLogins({})).toEqual([])
  })

  test('映射表模式下同样生效（不像 AI_REVIEWER_BOT_GITLAB_LOGIN 那样被忽略）', () => {
    expect(
      previousBotGitLabLogins({
        AI_REVIEWER_GITLAB_TOKEN_MAP: '* = GITLAB_PAT',
        AI_REVIEWER_GITLAB_PREVIOUS_BOT_LOGINS: 'old'
      })
    ).toEqual(['old'])
  })
})

describe('describeGitLabClientConfig（GLAPI-029：日志不含 token）', () => {
  test('摘要只含 host / 凭据类型 / timeout', () => {
    const summary = describeGitLabClientConfig({
      host: 'https://gitlab.corp.internal',
      credential: {type: 'pat', value: 'glpat-super-secret-value'},
      timeoutMS: 30000
    })
    expect(summary).toBe('host=https://gitlab.corp.internal credential=pat timeout=30000ms')
    expect(summary).not.toContain('glpat-')
    expect(summary).not.toContain('super-secret')
  })
})

describe('createGitLabClient（GLAPI-029/030）', () => {
  beforeEach(() => {
    mockGitlabCtor.mockClear()
  })

  test('PAT 注入 token 字段，并下发 host 与 queryTimeout', () => {
    createGitLabClient({
      host: 'https://gitlab.corp.internal/',
      credential: {type: 'pat', value: 'glpat-abc'},
      timeoutMS: 12000
    })
    expect(mockGitlabCtor).toHaveBeenCalledWith({
      host: 'https://gitlab.corp.internal',
      token: 'glpat-abc',
      queryTimeout: 12000
    })
  })

  test('job token 走 jobToken 字段而不是 token', () => {
    createGitLabClient({
      host: 'https://gitlab.com',
      credential: {type: 'job_token', value: 'ci-job-token'},
      timeoutMS: 30000
    })
    expect(mockGitlabCtor).toHaveBeenCalledWith({
      host: 'https://gitlab.com',
      jobToken: 'ci-job-token',
      queryTimeout: 30000
    })
  })

  test('非法 host 在构造时也 fail closed', () => {
    expect(() =>
      createGitLabClient({
        host: 'https://user:pw@gitlab.com',
        credential: {type: 'pat', value: 'p'},
        timeoutMS: 30000
      })
    ).toThrow(GitLabClientConfigError)
    expect(mockGitlabCtor).not.toHaveBeenCalled()
  })
})

describe('listOptions（GLAPI-024 分页契约）', () => {
  test('始终带 perPage / maxPages', () => {
    expect(listOptions()).toEqual({
      perPage: PAGINATION_DEFAULTS.perPage,
      maxPages: PAGINATION_DEFAULTS.maxPages
    })
  })

  test('保留调用方参数', () => {
    expect(listOptions({ref: 'main', recursive: true})).toEqual({
      ref: 'main',
      recursive: true,
      perPage: PAGINATION_DEFAULTS.perPage,
      maxPages: PAGINATION_DEFAULTS.maxPages
    })
  })

  test('丢弃 page（传 page 会让 gitbeaker 退化为单页，破坏全量翻页契约）', () => {
    const opts = listOptions({page: 3, sort: 'asc'})
    expect(opts).not.toHaveProperty('page')
    expect(opts.sort).toBe('asc')
  })

  test('perPage 取 GitLab REST 上限 100，maxPages 给出有上限的请求预算', () => {
    expect(PAGINATION_DEFAULTS.perPage).toBe(100)
    expect(PAGINATION_DEFAULTS.maxPages).toBeGreaterThan(0)
  })

  // DEP-004：文件树条目轻量、数量大，用自己的分页契约
  test('可传入自定义分页契约覆盖默认值', () => {
    expect(listOptions({ref: 'main'}, TREE_PAGINATION_DEFAULTS)).toEqual({
      ref: 'main',
      perPage: TREE_PAGINATION_DEFAULTS.perPage,
      maxPages: TREE_PAGINATION_DEFAULTS.maxPages
    })
  })

  test('自定义契约同样丢弃 page', () => {
    expect(listOptions({page: 9}, TREE_PAGINATION_DEFAULTS)).not.toHaveProperty('page')
  })

  test('文件树上限显著高于通用上限（5000 条会截断中等规模仓库）', () => {
    const treeLimit = TREE_PAGINATION_DEFAULTS.perPage * TREE_PAGINATION_DEFAULTS.maxPages
    const generalLimit = PAGINATION_DEFAULTS.perPage * PAGINATION_DEFAULTS.maxPages
    expect(treeLimit).toBeGreaterThan(generalLimit)
    expect(treeLimit).toBeGreaterThanOrEqual(50_000)
  })
})
