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
  createGitLabClient,
  describeGitLabClientConfig,
  GitLabClientConfigError,
  GITLAB_CLIENT_DEFAULTS,
  listOptions,
  PAGINATION_DEFAULTS,
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
})
