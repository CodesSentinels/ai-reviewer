/**
 * platform/llm-profile.ts - GitLab 入口的「模型档案」
 *
 * 切换大模型接口原本要同时改 5 个互相独立的 CI 变量（base URL、key、两个模型名、
 * web_search 开关），漏改一个就是半新半旧的组合，回退还得记住原值。档案把它们
 * 收成一组，用 `AI_REVIEWER_LLM_PROFILE` 选中其一，切换和回退只改这一个值：
 *
 *   # AI_REVIEWER_LLM_PROFILES
 *   [openai]
 *   base_url    = https://api.openai.com/v1
 *   api_key_var = OPENAI_API_KEY
 *   heavy_model = gpt-5.4-mini
 *   light_model = gpt-5.4-nano
 *
 *   [gateway]
 *   base_url    = https://llm-gateway.example.com/v1
 *   api_key_var = LLM_API_KEY_GATEWAY
 *   heavy_model = gpt-oss-120b
 *
 *   # AI_REVIEWER_LLM_PROFILE = gateway
 *
 * 档案本身不含密钥：`api_key_var` 只写存放 key 的变量名，key 各自放在独立的
 * Masked + Hidden 变量里（与 AI_REVIEWER_GITLAB_TOKEN_MAP 同一思路）。
 *
 * 任何格式问题都在配置期抛 ConfigError（fail closed），不带着可疑配置去调用模型。
 */

import {ConfigError} from './config-provider'

export const LLM_PROFILES_ENV = 'AI_REVIEWER_LLM_PROFILES'
export const LLM_PROFILE_ENV = 'AI_REVIEWER_LLM_PROFILE'

/** 选中档案时不得再设置的散变量：两套来源混用时说不清哪个生效 */
export const LLM_PROFILE_CONFLICTING_ENVS = [
  'AI_REVIEWER_OPENAI_BASE_URL',
  'AI_REVIEWER_OPENAI_LIGHT_MODEL',
  'AI_REVIEWER_OPENAI_HEAVY_MODEL',
  'AI_REVIEWER_ENABLE_WEB_SEARCH'
] as const

/**
 * `api_key_var` 允许的变量名。
 *
 * key 会随请求发往档案里的 base_url。能改档案（普通变量）的人未必能读到 Hidden
 * 变量的值；若允许任意变量名，写成 `GITLAB_PAT_X` 再把 base_url 指向自己的服务，
 * 就能把业务项目的 token 带出去。所以只放行专门存放模型 key 的命名。
 * 这两种命名都含 `key` 段，也会被 redact 按值脱敏。
 */
const API_KEY_VAR_RE = /^(OPENAI_API_KEY|LLM_API_KEY_[A-Z0-9_]+)$/

const PROFILE_NAME_RE = /^[A-Za-z0-9_.-]+$/

const KNOWN_FIELDS = [
  'base_url',
  'api_key_var',
  'heavy_model',
  'light_model',
  'web_search'
] as const
type Field = (typeof KNOWN_FIELDS)[number]

/** 解析后的一个档案（只含变量名，不含密钥值） */
export interface LlmProfile {
  name: string
  baseUrl: string
  apiKeyVar: string
  heavyModel?: string
  lightModel?: string
  /** 未显式配置时按 base_url 推断：只有官方 OpenAI 默认开启 */
  enableWebSearch: boolean
}

function fail(message: string, field: string = LLM_PROFILES_ENV): never {
  throw new ConfigError(message, 'gitlab', field)
}

function parseBool(value: string, where: string): boolean {
  const lower = value.toLowerCase()
  if (lower === 'true' || lower === '1' || lower === 'yes') return true
  if (lower === 'false' || lower === '0' || lower === 'no') return false
  return fail(`${where}: invalid boolean "${value}" (expected true/false)`)
}

/** 官方 OpenAI 才默认开启 web_search；兼容网关通常不执行该工具，开着只会让模型以为搜过 */
function defaultWebSearch(baseUrl: string): boolean {
  return new URL(baseUrl).hostname === 'api.openai.com'
}

function buildProfile(name: string, fields: Map<Field, string>): LlmProfile {
  const where = `${LLM_PROFILES_ENV} [${name}]`
  const baseUrl = fields.get('base_url')
  if (baseUrl == null) fail(`${where}: missing base_url`)
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    return fail(`${where}: base_url is not a valid URL: "${baseUrl}"`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    fail(`${where}: base_url must be http(s), got "${url.protocol}"`)
  }
  if (url.username !== '' || url.password !== '') {
    fail(`${where}: base_url must not embed credentials; put the key in api_key_var`)
  }

  const apiKeyVar = fields.get('api_key_var')
  if (apiKeyVar == null) fail(`${where}: missing api_key_var`)
  if (!API_KEY_VAR_RE.test(apiKeyVar)) {
    fail(`${where}: api_key_var must be OPENAI_API_KEY or LLM_API_KEY_<NAME>, got "${apiKeyVar}"`)
  }

  const webSearch = fields.get('web_search')
  return {
    name,
    baseUrl,
    apiKeyVar,
    heavyModel: fields.get('heavy_model'),
    lightModel: fields.get('light_model'),
    enableWebSearch:
      webSearch != null ? parseBool(webSearch, `${where} web_search`) : defaultWebSearch(baseUrl)
  }
}

/**
 * 解析 `AI_REVIEWER_LLM_PROFILES`。
 *
 * `[名字]` 开始一个档案，其后每行 `字段 = 值`；`#` 开头的行是注释，空行忽略。
 * 未知字段、重复的档案名或字段、档案外的字段行都视为错误。
 */
export function parseLlmProfiles(raw: string): Map<string, LlmProfile> {
  const sections: Array<{name: string; fields: Map<Field, string>}> = []
  const names = new Set<string>()
  let current: {name: string; fields: Map<Field, string>} | null = null

  for (const line of raw.split('\n')) {
    const item = line.trim()
    if (item === '' || item.startsWith('#')) continue

    if (item.startsWith('[')) {
      if (!item.endsWith(']')) fail(`${LLM_PROFILES_ENV}: malformed section header "${item}"`)
      const name = item.slice(1, -1).trim()
      if (!PROFILE_NAME_RE.test(name)) {
        fail(`${LLM_PROFILES_ENV}: invalid profile name "${name}" (allowed: A-Z a-z 0-9 _ . -)`)
      }
      if (names.has(name)) fail(`${LLM_PROFILES_ENV}: duplicate profile [${name}]`)
      names.add(name)
      current = {name, fields: new Map()}
      sections.push(current)
      continue
    }

    if (current == null) {
      fail(`${LLM_PROFILES_ENV}: "${item}" appears before any [profile] header`)
    }
    const eq = item.indexOf('=')
    if (eq < 0)
      fail(`${LLM_PROFILES_ENV} [${current.name}]: expected "field = value", got "${item}"`)
    const key = item.slice(0, eq).trim()
    const value = item.slice(eq + 1).trim()
    if (!(KNOWN_FIELDS as readonly string[]).includes(key)) {
      fail(
        `${LLM_PROFILES_ENV} [${
          current.name
        }]: unknown field "${key}" (allowed: ${KNOWN_FIELDS.join(', ')})`
      )
    }
    if (value === '') fail(`${LLM_PROFILES_ENV} [${current.name}]: empty value for ${key}`)
    if (current.fields.has(key as Field)) {
      fail(`${LLM_PROFILES_ENV} [${current.name}]: duplicate field ${key}`)
    }
    current.fields.set(key as Field, value)
  }

  return new Map(sections.map(s => [s.name, buildProfile(s.name, s.fields)]))
}

/**
 * 读取当前选中的档案；未设置 `AI_REVIEWER_LLM_PROFILE` 时返回 null（沿用散变量）。
 *
 * 档案表里任何一份写错都会报错，不因为「没选中」就放过：它是一整个变量，
 * 一处写错说明这份配置不可信，而且切换过去时才暴露只会更糟。
 */
export function resolveLlmProfile(
  env: Record<string, string | undefined> = process.env
): LlmProfile | null {
  const selected = (env[LLM_PROFILE_ENV] ?? '').trim()
  if (selected === '') return null

  const conflicts = LLM_PROFILE_CONFLICTING_ENVS.filter(k => (env[k] ?? '') !== '')
  if (conflicts.length > 0) {
    fail(
      `${LLM_PROFILE_ENV} is set, remove the overlapping variables (the profile defines them): ${conflicts.join(
        ', '
      )}`,
      LLM_PROFILE_ENV
    )
  }

  const raw = env[LLM_PROFILES_ENV] ?? ''
  if (raw.trim() === '')
    fail(`${LLM_PROFILE_ENV}="${selected}" but ${LLM_PROFILES_ENV} is empty`, LLM_PROFILE_ENV)
  const profiles = parseLlmProfiles(raw)
  const profile = profiles.get(selected)
  if (profile == null) {
    fail(
      `${LLM_PROFILE_ENV}="${selected}" not found in ${LLM_PROFILES_ENV} (defined: ${[
        ...profiles.keys()
      ].join(', ')})`,
      LLM_PROFILE_ENV
    )
  }
  return profile
}
