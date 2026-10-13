/**
 * gitlab-llm-profile.test.ts — GitLab 入口的「模型档案」
 *
 * 一组档案定义接口地址、key 所在变量、模型名与 web_search；
 * AI_REVIEWER_LLM_PROFILE 选中其一，切换 / 回退只改这一个值。
 */
import {describe, expect, test, beforeEach, afterEach} from '@jest/globals'
import {ConfigError} from '../src/platform/config-provider'
import {GitLabConfigProvider} from '../src/platform/gitlab-config-provider'
import {parseLlmProfiles, resolveLlmProfile} from '../src/platform/llm-profile'
import {buildConfigurationMessage} from '../src/commands/handlers/configuration'
import {Bot} from '../src/bot'

const PROFILES = `
# 官方
[openai]
base_url    = https://api.openai.com/v1
api_key_var = OPENAI_API_KEY
heavy_model = gpt-5.4-mini
light_model = gpt-5.4-nano

[gateway]
base_url    = https://llm-gateway.example.com/v1
api_key_var = LLM_API_KEY_GATEWAY
heavy_model = gpt-oss-120b
light_model = gpt-oss-20b
`

const TOUCHED = [
  'AI_REVIEWER_LLM_PROFILES',
  'AI_REVIEWER_LLM_PROFILE',
  'AI_REVIEWER_OPENAI_BASE_URL',
  'AI_REVIEWER_OPENAI_LIGHT_MODEL',
  'AI_REVIEWER_OPENAI_HEAVY_MODEL',
  'AI_REVIEWER_ENABLE_WEB_SEARCH',
  'OPENAI_API_KEY',
  'LLM_API_KEY_GATEWAY'
]
let saved: Record<string, string | undefined>

beforeEach(() => {
  saved = Object.fromEntries(TOUCHED.map(k => [k, process.env[k]]))
  for (const k of TOUCHED) delete process.env[k]
})

afterEach(() => {
  for (const k of TOUCHED) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

function configError(fn: () => unknown): ConfigError {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(ConfigError)
    return e as ConfigError
  }
  throw new Error('expected ConfigError')
}

describe('parseLlmProfiles：格式', () => {
  test('解析多个档案；web_search 未写时只有官方 OpenAI 默认开启', () => {
    const profiles = parseLlmProfiles(PROFILES)
    expect([...profiles.keys()]).toEqual(['openai', 'gateway'])
    expect(profiles.get('openai')).toEqual({
      name: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKeyVar: 'OPENAI_API_KEY',
      heavyModel: 'gpt-5.4-mini',
      lightModel: 'gpt-5.4-nano',
      enableWebSearch: true
    })
    expect(profiles.get('gateway')?.enableWebSearch).toBe(false)
  })

  test('显式 web_search 覆盖按地址推断的默认值', () => {
    const p = parseLlmProfiles(
      '[g]\nbase_url = https://g.example.com/v1\napi_key_var = LLM_API_KEY_G\nweb_search = true'
    )
    expect(p.get('g')?.enableWebSearch).toBe(true)
  })

  test('模型名可以不写（落到默认值）', () => {
    const p = parseLlmProfiles(
      '[g]\nbase_url = https://g.example.com/v1\napi_key_var = LLM_API_KEY_G'
    )
    expect(p.get('g')?.heavyModel).toBeUndefined()
  })

  test.each([
    ['档案头之前出现字段', 'base_url = https://a/v1', /before any \[profile\]/],
    ['档案头不闭合', '[a\nbase_url = https://a/v1', /malformed section header/],
    ['档案名非法', '[a b]\nbase_url = https://a/v1', /invalid profile name/],
    [
      '重复档案',
      '[a]\nbase_url = https://a/v1\napi_key_var = OPENAI_API_KEY\n[a]',
      /duplicate profile/
    ],
    ['未知字段（拼写错误）', '[a]\nbase_ulr = https://a/v1', /unknown field "base_ulr"/],
    [
      '重复字段',
      '[a]\nbase_url = https://a/v1\nbase_url = https://b/v1',
      /duplicate field base_url/
    ],
    ['缺等号', '[a]\nbase_url https://a/v1', /expected "field = value"/],
    ['空值', '[a]\nbase_url =', /empty value for base_url/],
    ['缺 base_url', '[a]\napi_key_var = OPENAI_API_KEY', /missing base_url/],
    ['缺 api_key_var', '[a]\nbase_url = https://a.example.com/v1', /missing api_key_var/],
    ['地址不合法', '[a]\nbase_url = not a url\napi_key_var = OPENAI_API_KEY', /not a valid URL/],
    [
      '非 http(s)',
      '[a]\nbase_url = ftp://a.example.com\napi_key_var = OPENAI_API_KEY',
      /must be http\(s\)/
    ],
    [
      '地址内嵌凭据',
      '[a]\nbase_url = https://u:p@a.example.com/v1\napi_key_var = OPENAI_API_KEY',
      /must not embed credentials/
    ],
    [
      'web_search 非布尔',
      '[a]\nbase_url = https://a.example.com/v1\napi_key_var = OPENAI_API_KEY\nweb_search = maybe',
      /invalid boolean/
    ]
  ])('%s → ConfigError', (_label, raw, message) => {
    expect(configError(() => parseLlmProfiles(raw)).message).toMatch(message)
  })

  test.each([
    'GITLAB_PAT_X',
    'AI_REVIEWER_PIPELINE_TOKEN',
    'CI_JOB_TOKEN',
    'LLM_API_KEY_',
    'openai_api_key'
  ])('api_key_var=%s 被拒（不能借档案把其他凭据发往档案里的地址）', name => {
    const raw = `[a]\nbase_url = https://evil.example.com/v1\napi_key_var = ${name}`
    expect(configError(() => parseLlmProfiles(raw)).message).toMatch(/api_key_var must be/)
  })
})

describe('resolveLlmProfile：选择与冲突', () => {
  test('未设置 AI_REVIEWER_LLM_PROFILE → null（沿用散变量，档案表即使有错也不读）', () => {
    expect(resolveLlmProfile({AI_REVIEWER_LLM_PROFILES: '[bad'})).toBeNull()
  })

  test('选中存在的档案', () => {
    const env = {AI_REVIEWER_LLM_PROFILES: PROFILES, AI_REVIEWER_LLM_PROFILE: ' gateway '}
    expect(resolveLlmProfile(env)?.name).toBe('gateway')
  })

  test('选中的档案不存在 → 报错并列出已定义的档案', () => {
    const env = {AI_REVIEWER_LLM_PROFILES: PROFILES, AI_REVIEWER_LLM_PROFILE: 'gatway'}
    expect(configError(() => resolveLlmProfile(env)).message).toMatch(
      /"gatway" not found .*defined: openai, gateway/
    )
  })

  test('选中档案但档案表为空 → 报错', () => {
    expect(
      configError(() => resolveLlmProfile({AI_REVIEWER_LLM_PROFILE: 'openai'})).message
    ).toMatch(/AI_REVIEWER_LLM_PROFILES is empty/)
  })

  test('未选中的档案写错也报错（整张表不可信）', () => {
    const env = {
      AI_REVIEWER_LLM_PROFILES: `${PROFILES}\n[broken]\nbase_url = https://x.example.com/v1`,
      AI_REVIEWER_LLM_PROFILE: 'openai'
    }
    expect(configError(() => resolveLlmProfile(env)).message).toMatch(
      /\[broken\]: missing api_key_var/
    )
  })

  test('与散变量混用 → 报错并列出全部冲突项', () => {
    const env = {
      AI_REVIEWER_LLM_PROFILES: PROFILES,
      AI_REVIEWER_LLM_PROFILE: 'gateway',
      AI_REVIEWER_OPENAI_BASE_URL: 'https://api.openai.com/v1',
      AI_REVIEWER_ENABLE_WEB_SEARCH: 'false'
    }
    const e = configError(() => resolveLlmProfile(env))
    expect(e.field).toBe('AI_REVIEWER_LLM_PROFILE')
    expect(e.message).toContain('AI_REVIEWER_OPENAI_BASE_URL, AI_REVIEWER_ENABLE_WEB_SEARCH')
  })
})

describe('GitLabConfigProvider 接入档案', () => {
  test('选中档案：地址、模型、web_search、key 变量都取自档案', () => {
    process.env.AI_REVIEWER_LLM_PROFILES = PROFILES
    process.env.AI_REVIEWER_LLM_PROFILE = 'gateway'
    const o = new GitLabConfigProvider().getOptions()
    expect(o.apiBaseUrl).toBe('https://llm-gateway.example.com/v1')
    expect(o.openaiHeavyModel).toBe('gpt-oss-120b')
    expect(o.openaiLightModel).toBe('gpt-oss-20b')
    expect(o.enableWebSearch).toBe(false)
    expect(o.apiKeyEnv).toBe('LLM_API_KEY_GATEWAY')
    expect(o.llmProfile).toBe('gateway')
  })

  test('未选中档案：行为与原来一致', () => {
    process.env.AI_REVIEWER_OPENAI_HEAVY_MODEL = 'custom-model'
    const o = new GitLabConfigProvider().getOptions()
    expect(o.openaiHeavyModel).toBe('custom-model')
    expect(o.apiKeyEnv).toBe('OPENAI_API_KEY')
    expect(o.llmProfile).toBe('')
  })

  test('job 日志显示档案名与接口地址，不含 key 的值', () => {
    process.env.AI_REVIEWER_LLM_PROFILES = PROFILES
    process.env.AI_REVIEWER_LLM_PROFILE = 'gateway'
    process.env.LLM_API_KEY_GATEWAY = 'sk-gateway-secret-value'
    const lines: string[] = []
    new GitLabConfigProvider().print(m => lines.push(m))
    const text = lines.join('\n')
    expect(text).toContain('llm_profile: gateway')
    expect(text).toContain('api_base_url: https://llm-gateway.example.com/v1')
    expect(text).not.toContain('sk-gateway-secret-value')
  })

  test('configuration 命令：显示接口域名与档案，模型类配置的来源标为档案', () => {
    process.env.AI_REVIEWER_LLM_PROFILES = PROFILES
    process.env.AI_REVIEWER_LLM_PROFILE = 'gateway'
    process.env.LLM_API_KEY_GATEWAY = 'sk-gateway-secret-value'
    const msg = buildConfigurationMessage(
      'gitlab',
      new GitLabConfigProvider().getOptions(),
      'active'
    )
    expect(msg).toContain('模型接口：`llm-gateway.example.com`，key 取自变量 `LLM_API_KEY_GATEWAY`')
    expect(msg).toContain('模型档案 `gateway`')
    expect(msg).toMatch(/\| openai_heavy_model \| `gpt-oss-120b` \| 模型档案 `gateway` \|/)
    expect(msg).toMatch(/\| enable_web_search \| `false` \| 模型档案 `gateway` \|/)
    expect(msg).not.toContain('sk-gateway-secret-value')
  })
})

describe('Bot 从档案指定的变量读取 key', () => {
  const mk = (apiKeyEnv?: string): Bot =>
    new Bot(
      {openaiModelTemperature: 0, systemMessage: '', apiKeyEnv} as any,
      {model: 'gpt-oss-120b', tokenLimits: {responseTokens: 1000}} as any
    )

  test('档案变量有值 → 可以创建；不再要求 OPENAI_API_KEY', () => {
    process.env.LLM_API_KEY_GATEWAY = 'sk-gateway'
    expect(() => mk('LLM_API_KEY_GATEWAY')).not.toThrow()
  })

  test('档案变量为空 → 报错时指出是哪个变量', () => {
    process.env.OPENAI_API_KEY = 'sk-openai'
    expect(() => mk('LLM_API_KEY_GATEWAY')).toThrow(/'LLM_API_KEY_GATEWAY' is not available/)
  })

  test('未指定（未使用档案）→ 仍读 OPENAI_API_KEY', () => {
    process.env.OPENAI_API_KEY = 'sk-openai'
    expect(() => mk()).not.toThrow()
  })
})
