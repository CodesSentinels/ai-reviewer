/**
 * gitlab-retry.test.ts — 错误归一化 + 有上限退避重试契约测试
 *
 * GLAPI-025（429/5xx/超时退避重试，有上限）
 * GLAPI-026（401/403 不重试，返回权限诊断）
 * GLAPI-032（gitbeaker 错误对象 → IGitPlatform 错误语义的适配层契约）
 */
import {describe, expect, test, beforeEach, afterEach, jest} from '@jest/globals'
import {GitPlatformError} from '../src/platform/git-platform'
import {
  extractRetryAfterMS,
  extractStatus,
  isRetryableErrorKind,
  normalizeGitLabError,
  permissionDiagnostics
} from '../src/platform/gitlab-errors'
import {
  computeBackoffMS,
  configureGitLabRetry,
  GITLAB_RETRY_DEFAULTS,
  resetGitLabRetryPolicy,
  withGitLabRetry
} from '../src/platform/gitlab-retry'
import {resetLogger, setLogger} from '../src/platform/logger'

/** 构造 gitbeaker GitbeakerRequestError 的等价形态：cause.response 是 fetch Response */
function requestError(status: number, message = 'boom', headers: Record<string, string> = {}) {
  const err = new Error(message)
  err.name = 'GitbeakerRequestError'
  ;(err as any).cause = {
    description: message,
    response: {
      status,
      headers: {get: (k: string) => headers[k.toLowerCase()] ?? null}
    }
  }
  return err
}

function timeoutError(): Error {
  const err = new Error('Query timeout was reached')
  err.name = 'GitbeakerTimeoutError'
  return err
}

describe('normalizeGitLabError — HTTP 状态映射（GLAPI-032）', () => {
  test.each([
    [401, 'forbidden'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [409, 'conflict'],
    [429, 'rate_limited'],
    [500, 'server_error'],
    [502, 'server_error'],
    [503, 'server_error']
  ])('status %i → kind %s', (status, kind) => {
    const err = normalizeGitLabError(requestError(status))
    expect(err).toBeInstanceOf(GitPlatformError)
    expect(err.errorKind).toBe(kind)
    expect(err.statusCode).toBe(status)
  })

  test('GitbeakerTimeoutError → timeout（无 status）', () => {
    const err = normalizeGitLabError(timeoutError())
    expect(err.errorKind).toBe('timeout')
    expect(err.statusCode).toBeUndefined()
  })

  test('原生网络错误 → timeout', () => {
    for (const msg of ['ECONNRESET', 'socket hang up', 'fetch failed', 'ETIMEDOUT']) {
      expect(normalizeGitLabError(new Error(msg)).errorKind).toBe('timeout')
    }
  })

  test('GitbeakerRetryError 从 message 中还原状态码', () => {
    const err = new Error(
      'Could not successfully complete this request after 10 retries, last status code: 429. Check the applicable rate limits'
    )
    err.name = 'GitbeakerRetryError'
    const normalized = normalizeGitLabError(err)
    expect(normalized.statusCode).toBe(429)
    expect(normalized.errorKind).toBe('rate_limited')
  })

  test('无法识别的错误 → unknown（不猜测为可重试）', () => {
    const err = normalizeGitLabError(new Error('something odd'))
    expect(err.errorKind).toBe('unknown')
    expect(isRetryableErrorKind(err.errorKind)).toBe(false)
  })

  test('已经是 GitPlatformError → 原样返回，不重复包装', () => {
    const original = new GitPlatformError('already normalized', 'conflict', 409)
    expect(normalizeGitLabError(original)).toBe(original)
  })

  test('message 经脱敏后才进入 GitPlatformError（A5）', () => {
    const err = normalizeGitLabError(requestError(500, 'failed with token glpat-abcdef123456'))
    expect(err.message).not.toContain('glpat-abcdef123456')
    expect(err.message).toContain('glpat-***')
  })

  test('operation 作为前缀便于定位调用点', () => {
    expect(normalizeGitLabError(requestError(500), 'listComments').message).toMatch(
      /^listComments: /
    )
  })
})

describe('extractStatus / extractRetryAfterMS（GLAPI-032）', () => {
  test('支持 cause.response.status、response.status、status、statusCode 四种形态', () => {
    expect(extractStatus(requestError(404))).toBe(404)
    expect(extractStatus(Object.assign(new Error('x'), {response: {status: 403}}))).toBe(403)
    expect(extractStatus(Object.assign(new Error('x'), {status: 429}))).toBe(429)
    expect(extractStatus(Object.assign(new Error('x'), {statusCode: 500}))).toBe(500)
    expect(extractStatus(new Error('no status'))).toBeUndefined()
  })

  test('Retry-After 秒数 → 毫秒', () => {
    expect(extractRetryAfterMS(requestError(429, 'rate limited', {'retry-after': '3'}))).toBe(3000)
  })

  test('Retry-After HTTP-date → 距今毫秒', () => {
    const now = Date.parse('2026-08-10T00:00:00Z')
    const err = requestError(429, 'rate limited', {
      'retry-after': 'Mon, 10 Aug 2026 00:00:10 GMT'
    })
    expect(extractRetryAfterMS(err, now)).toBe(10_000)
  })

  test('无 Retry-After 或不可解析 → undefined', () => {
    expect(extractRetryAfterMS(requestError(429))).toBeUndefined()
    expect(extractRetryAfterMS(requestError(429, 'x', {'retry-after': 'soon'}))).toBeUndefined()
    expect(extractRetryAfterMS(new Error('plain'))).toBeUndefined()
  })
})

describe('permissionDiagnostics（GLAPI-026）', () => {
  test('401 提示凭据缺失/过期', () => {
    const msg = permissionDiagnostics(401, '401 Unauthorized')
    expect(msg).toContain('401')
    expect(msg).toContain('GITLAB_PAT / CI_JOB_TOKEN')
    expect(msg).toContain('Not retrying')
  })

  test('403 提示 scope 与 access level', () => {
    const msg = permissionDiagnostics(403, '403 Forbidden')
    expect(msg).toContain('scope')
    expect(msg).toMatch(/Reporter|Developer/)
    expect(msg).toContain('Not retrying')
  })

  test('归一化后的 401/403 错误自带诊断信息', () => {
    expect(normalizeGitLabError(requestError(401), 'createComment').message).toContain(
      'GITLAB_PAT / CI_JOB_TOKEN'
    )
    expect(normalizeGitLabError(requestError(403), 'createComment').message).toContain('scope')
  })
})

describe('computeBackoffMS（GLAPI-025 有上限退避）', () => {
  const policy = {...GITLAB_RETRY_DEFAULTS, random: () => 1}

  test('指数增长', () => {
    expect(computeBackoffMS(1, policy)).toBe(500)
    expect(computeBackoffMS(2, policy)).toBe(1000)
    expect(computeBackoffMS(3, policy)).toBe(2000)
  })

  test('不超过 maxDelayMS 上限', () => {
    expect(computeBackoffMS(20, policy)).toBe(policy.maxDelayMS)
  })

  test('全抖动：random 越小等待越短', () => {
    expect(computeBackoffMS(3, {...policy, random: () => 0})).toBe(0)
    expect(computeBackoffMS(3, {...policy, random: () => 0.5})).toBe(1000)
  })
})

describe('withGitLabRetry（GLAPI-025/026/027）', () => {
  const warnings: string[] = []
  const sleeps: number[] = []

  beforeEach(() => {
    warnings.length = 0
    sleeps.length = 0
    setLogger({
      info: () => {},
      warning: (m: string) => warnings.push(m),
      error: () => {},
      debug: () => {}
    })
    configureGitLabRetry({
      random: () => 1,
      sleep: async (ms: number) => {
        sleeps.push(ms)
      }
    })
  })

  afterEach(() => {
    resetGitLabRetryPolicy()
    resetLogger()
  })

  test('成功时只调用一次', async () => {
    const fn = jest.fn<any>().mockResolvedValue('ok')
    await expect(withGitLabRetry('op', fn)).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
    expect(sleeps).toEqual([])
  })

  test('429 重试后成功', async () => {
    const fn = jest
      .fn<any>()
      .mockRejectedValueOnce(requestError(429))
      .mockResolvedValue('recovered')
    await expect(withGitLabRetry('op', fn)).resolves.toBe('recovered')
    expect(fn).toHaveBeenCalledTimes(2)
    expect(sleeps).toEqual([500])
  })

  test('5xx 与超时同样重试，次数有上限', async () => {
    for (const failure of [requestError(500), timeoutError()]) {
      sleeps.length = 0
      const fn = jest.fn<any>().mockRejectedValue(failure)
      await expect(withGitLabRetry('op', fn)).rejects.toThrow(GitPlatformError)
      expect(fn).toHaveBeenCalledTimes(GITLAB_RETRY_DEFAULTS.maxAttempts)
      // 最后一次失败后不再等待
      expect(sleeps).toEqual([500, 1000])
    }
  })

  test('GLAPI-026：401/403 立即失败，不重试', async () => {
    for (const status of [401, 403]) {
      const fn = jest.fn<any>().mockRejectedValue(requestError(status))
      await expect(withGitLabRetry('op', fn)).rejects.toThrow(/Not retrying/)
      expect(fn).toHaveBeenCalledTimes(1)
    }
    expect(sleeps).toEqual([])
  })

  test('404 / 409 / unknown 不重试', async () => {
    for (const failure of [requestError(404), requestError(409), new Error('weird')]) {
      const fn = jest.fn<any>().mockRejectedValue(failure)
      await expect(withGitLabRetry('op', fn)).rejects.toThrow(GitPlatformError)
      expect(fn).toHaveBeenCalledTimes(1)
    }
  })

  test('尊重 Retry-After 而不是指数退避', async () => {
    const fn = jest
      .fn<any>()
      .mockRejectedValueOnce(requestError(429, 'slow down', {'retry-after': '2'}))
      .mockResolvedValue('ok')
    await expect(withGitLabRetry('op', fn)).resolves.toBe('ok')
    expect(sleeps).toEqual([2000])
  })

  test('Retry-After 超过预算 → 直接放弃，不空等', async () => {
    const fn = jest.fn<any>().mockRejectedValue(requestError(429, 'slow', {'retry-after': '600'}))
    await expect(withGitLabRetry('op', fn)).rejects.toThrow(GitPlatformError)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(sleeps).toEqual([])
    expect(warnings.join('\n')).toMatch(/exceeds .* budget/)
  })

  test('重试日志包含操作名和错误类别，不含 token', async () => {
    const fn = jest
      .fn<any>()
      .mockRejectedValueOnce(requestError(500, 'boom with glpat-secret123456'))
      .mockResolvedValue('ok')
    await withGitLabRetry('listComments', fn)
    expect(warnings[0]).toContain('listComments')
    expect(warnings[0]).toContain('server_error')
    expect(warnings.join('\n')).not.toContain('glpat-secret123456')
  })

  test('GLAPI-027：回调收到 attempt 序号，供写操作做幂等探测', async () => {
    const attempts: number[] = []
    const fn = jest.fn<any>().mockImplementation(async (attempt: any) => {
      attempts.push(attempt as number)
      if ((attempt as number) < 3) throw requestError(500)
      return 'ok'
    })
    await expect(withGitLabRetry('op', fn)).resolves.toBe('ok')
    expect(attempts).toEqual([1, 2, 3])
  })

  test('overrides 可收紧重试预算', async () => {
    const fn = jest.fn<any>().mockRejectedValue(requestError(500))
    await expect(withGitLabRetry('op', fn, {maxAttempts: 1})).rejects.toThrow(GitPlatformError)
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
