/**
 * redact.test.ts — 通用日志脱敏（SEC-008）
 *
 * 覆盖 SEC-008 点名的五个泄漏面：HTTP Header、URL query、异常对象、
 * 环境变量、debug 输出。
 */
import {describe, expect, test, jest, afterEach} from '@jest/globals'
import {REDACTED, collectSecretValues, redactForLog, redactString, redactValue} from '../src/redact'

const savedEnv = {...process.env}

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key]
  }
  Object.assign(process.env, savedEnv)
})

describe('SEC-008: 按环境变量实际值脱敏', () => {
  test('敏感命名的环境变量值被收集', () => {
    process.env.OPENAI_API_KEY = 'sk-live-abcdefghijklmnop'
    process.env.GITLAB_PAT = 'glpat-abcdefghijklmnop'
    process.env.SOME_PASSWORD = 'p@ssw0rd-long-enough'

    const values = collectSecretValues()
    expect(values).toContain('sk-live-abcdefghijklmnop')
    expect(values).toContain('glpat-abcdefghijklmnop')
    expect(values).toContain('p@ssw0rd-long-enough')
  })

  test('非敏感命名的环境变量不被收集（避免把无害值全局打码）', () => {
    process.env.GITHUB_REPOSITORY = 'octo/demo-repository'
    process.env.AI_REVIEWER_MODEL = 'gpt-5.4-mini-long-name'

    const values = collectSecretValues()
    expect(values).not.toContain('octo/demo-repository')
    expect(values).not.toContain('gpt-5.4-mini-long-name')
  })

  test('过短的值不做全局字面量替换', () => {
    process.env.SHORT_TOKEN = 'abc'
    expect(collectSecretValues()).not.toContain('abc')
  })

  test('按下划线整段匹配，PATH / KEYWORD 这类不被误判为密钥', () => {
    // 子串匹配会把 PATH 当成 pat、KEYWORD 当成 key，
    // 于是整条 PATH 被打成 ***，日志直接不可读
    process.env.PATH = '/usr/local/bin:/usr/bin:/bin'
    process.env.AI_REVIEWER_KEYWORD = 'codesentinel-review-keyword'
    process.env.NODE_PATH = '/some/long/node/path/value'

    const values = collectSecretValues()
    expect(values).not.toContain('/usr/local/bin:/usr/bin:/bin')
    expect(values).not.toContain('codesentinel-review-keyword')
    expect(values).not.toContain('/some/long/node/path/value')
  })

  test('GITLAB_PAT 这类整段命名能被认出（本仓库实际在用）', () => {
    process.env.GITLAB_PAT = 'glpat-realvalue12345'
    process.env.CI_JOB_TOKEN = 'job-token-value-1234'
    expect(collectSecretValues()).toContain('glpat-realvalue12345')
    expect(collectSecretValues()).toContain('job-token-value-1234')
  })

  test('密钥值无论出现在什么位置都被遮蔽（最强的一层）', () => {
    const secret = 'totally-secret-value-1234'
    const out = redactString(`模型返回失败，请求体 {"auth":"${secret}"} 结束`, [secret])
    expect(out).not.toContain(secret)
    expect(out).toContain(REDACTED)
  })

  test('长值优先替换，不会被短值切碎', () => {
    const long = 'prefix-secret-tail-0001'
    const short = 'prefix-secret'
    const out = redactString(
      `value=${long}`,
      [long, short].sort((a, b) => b.length - a.length)
    )
    expect(out).toBe(`value=${REDACTED}`)
  })
})

describe('SEC-008: HTTP Header 与 URL', () => {
  test.each([
    ['Authorization: Bearer abcdef123456', 'abcdef123456'],
    ['authorization=Basic YWJjOmRlZg==', 'YWJjOmRlZg'],
    ['PRIVATE-TOKEN: glpat-abcdefghijkl', 'glpat-abcdefghijkl'],
    ['X-Api-Key: k-1234567890', 'k-1234567890'],
    ['Cookie: session=abcdef123456', 'abcdef123456']
  ])('Header %s 的值被遮蔽', (input, secret) => {
    expect(redactString(input, [])).not.toContain(secret)
  })

  test('URL 内嵌凭据被遮蔽，主机名保留（便于排错）', () => {
    const out = redactString('git remote add gl https://oauth2:glpat-abcdef@gitlab.com/x.git', [])
    expect(out).not.toContain('glpat-abcdef')
    expect(out).toContain('gitlab.com/x.git')
    expect(out).toContain('oauth2')
  })

  test.each(['token', 'private_token', 'access_token', 'api_key', 'password', 'signature'])(
    'URL query 参数 %s 被遮蔽',
    param => {
      const out = redactString(`https://h/api?a=1&${param}=supersecret&b=2`, [])
      expect(out).not.toContain('supersecret')
      expect(out).toContain('a=1')
      expect(out).toContain('b=2')
    }
  )

  test.each([
    'glpat-abcdefghijklmn',
    'glrt-abcdefghijklmn',
    'ghp_abcdefghijklmnopqrstuvwxyz01',
    'github_pat_abcdefghijklmnop1234',
    'sk-abcdefghijklmnopqrstuvwx'
  ])('已知 token 前缀 %s 被遮蔽（覆盖 API 回显场景）', token => {
    expect(redactString(`value=${token}`, [])).not.toContain(token)
  })
})

describe('SEC-008: 异常对象与嵌套结构', () => {
  test('Error 的 message / stack 都被脱敏', () => {
    const err = new Error('request failed with glpat-abcdefghijkl')
    err.stack = 'Error: glpat-abcdefghijkl\n    at foo()'

    const out = redactValue(err, []) as Record<string, string>
    expect(out.message).not.toContain('glpat-abcdefghijkl')
    expect(out.stack).not.toContain('glpat-abcdefghijkl')
    expect(out.name).toBe('Error')
  })

  test('Error.cause 递归脱敏', () => {
    const inner = new Error('inner glpat-abcdefghijkl')
    const outer = new Error('outer', {cause: inner})

    const out = JSON.stringify(redactValue(outer, []))
    expect(out).not.toContain('glpat-abcdefghijkl')
  })

  test('敏感字段名的值直接遮蔽，不看内容形态', () => {
    const out = redactValue(
      {
        url: 'https://gitlab.com',
        authorization: 'anything-at-all',
        headers: {'private-token': 'whatever', accept: 'application/json'},
        api_key: 'plain-looking-value'
      },
      []
    ) as any

    expect(out.authorization).toBe(REDACTED)
    expect(out.headers['private-token']).toBe(REDACTED)
    expect(out.api_key).toBe(REDACTED)
    // 无关字段保留，日志仍可用于排错
    expect(out.url).toBe('https://gitlab.com')
    expect(out.headers.accept).toBe('application/json')
  })

  test('数组与深层嵌套都会被走到', () => {
    const out = JSON.stringify(redactValue({items: [{nested: {deep: 'glpat-abcdefghijkl'}}]}, []))
    expect(out).not.toContain('glpat-abcdefghijkl')
  })

  test('循环引用不栈溢出', () => {
    const node: any = {name: 'root'}
    node.self = node

    expect(() => redactValue(node, [])).not.toThrow()
    expect(JSON.stringify(redactValue(node, []))).toContain('[Circular]')
  })
})

describe('SEC-008: redactForLog 的容错与幂等', () => {
  test('对象被序列化为可读字符串', () => {
    expect(redactForLog({a: 1, token: 'x'})).toContain('"token":"***"')
  })

  test('脱敏结果幂等：再跑一次不变', () => {
    const once = redactString('Authorization: Bearer abcdef123456', [])
    expect(redactString(once, [])).toBe(once)
  })

  test('序列化失败时返回占位符，绝不漏原文', () => {
    const hostile = {
      toJSON() {
        throw new Error('boom')
      }
    }
    expect(redactForLog(hostile)).toBe('[unloggable value redacted]')
  })

  test('不含密钥的普通文本原样返回', () => {
    const plain = 'Reviewing 3 files in src/, 2 findings'
    expect(redactString(plain, [])).toBe(plain)
  })

  test.each([
    'token count: 12345',
    'summary token limit 4096 exceeded',
    'request tokens=8192 response tokens=1024',
    'basic review completed in 12s',
    'Basic review completed in 12s'
  ])('正常诊断信息 %s 不被误打码（否则日志失去可读性）', line => {
    expect(redactString(line, [])).toBe(line)
  })

  test('真正的 Authorization: token xxx 仍被遮蔽（方案关键字保留）', () => {
    const out = redactString('Authorization: token abc123def456', [])
    expect(out).toBe('Authorization: token ***')
  })
})

describe('SEC-008: 日志出口统一接线', () => {
  test('actions-log 的每个函数都把内容脱敏后再交给 @actions/core', async () => {
    const secret = 'glpat-abcdefghijklmn'
    const captured: Record<string, string> = {}

    jest.resetModules()
    jest.doMock('@actions/core', () => ({
      info: (m: string) => (captured.info = m),
      warning: (m: string) => (captured.warning = m),
      error: (m: string) => (captured.error = m),
      debug: (m: string) => (captured.debug = m),
      setFailed: (m: string) => (captured.setFailed = m)
    }))

    try {
      const log = await import('../src/actions-log')
      log.info(`info ${secret}`)
      log.warning(`warning ${secret}`)
      log.error(`error ${secret}`)
      log.debug(`debug ${secret}`)
      log.setFailed(`failed ${secret}`)

      expect(Object.keys(captured)).toHaveLength(5)
      for (const [level, line] of Object.entries(captured)) {
        expect(`${level}:${line}`).not.toContain(secret)
        expect(line).toContain(REDACTED)
      }
    } finally {
      jest.dontMock('@actions/core')
      jest.resetModules()
    }
  })

  test('GitHubLogger 的四个级别同样经 redactForLog（源码断言）', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('path')
    const src = fs.readFileSync(path.resolve(__dirname, '../src/platform/github-logger.ts'), 'utf8')
    for (const level of ['info', 'warning', 'error', 'debug']) {
      expect(src).toMatch(new RegExp(`${level}\\(redactForLog\\(msg\\)\\)`))
    }
  })
})
