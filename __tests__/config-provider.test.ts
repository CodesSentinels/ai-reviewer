/**
 * config-provider.test.ts — ConfigProvider 单元测试（ARCH-007~011）
 *
 * 覆盖范围：
 * - GitHubConfigProvider（ARCH-008）：读取 action.yml inputs → Options
 * - GitLabConfigProvider（ARCH-009）：读取 CI variables → Options
 * - 配置优先级和错误处理（ARCH-010）
 * - print() 不输出 secret（ARCH-011）
 * - GitLab 安全强制覆盖 enable_shell/enable_lint_tools（CFG-002）
 * - GitLab/GitHub 默认值一致性
 */
import {describe, expect, test, jest, beforeEach, afterEach} from '@jest/globals'

// ======================== Mock @actions/core ========================
const inputStore: Record<string, string> = {}
const boolInputStore: Record<string, string> = {}
const multilineInputStore: Record<string, string> = {}

jest.mock('@actions/core', () => ({
  getInput: jest.fn((name: string) => inputStore[name] ?? ''),
  getBooleanInput: jest.fn((name: string) => {
    const v = boolInputStore[name] ?? inputStore[name] ?? 'false'
    if (v.toLowerCase() === 'true') return true
    if (v.toLowerCase() === 'false') return false
    throw new Error(`Input does not meet YAML 1.2 "Core Schema" specification: ${name}`)
  }),
  getMultilineInput: jest.fn((name: string) => {
    const v = multilineInputStore[name] ?? inputStore[name] ?? ''
    return v
      .split('\n')
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 0)
  }),
  info: jest.fn(),
  warning: jest.fn(),
  error: jest.fn()
}))

// ======================== Imports ========================
import {GitHubConfigProvider} from '../src/platform/github-config-provider'
import {GitLabConfigProvider} from '../src/platform/gitlab-config-provider'
import {ConfigError, CONFIG_DEFAULTS} from '../src/platform/config-provider'
import type {ConfigProvider} from '../src/platform/config-provider'

// ======================== Helpers ========================

/** Set GitHub Action inputs (for GitHubConfigProvider tests) */
function setInputs(inputs: Record<string, string>): void {
  Object.keys(inputStore).forEach(k => delete inputStore[k])
  Object.keys(boolInputStore).forEach(k => delete boolInputStore[k])
  Object.keys(multilineInputStore).forEach(k => delete multilineInputStore[k])

  for (const [k, v] of Object.entries(inputs)) {
    inputStore[k] = v
    boolInputStore[k] = v
    multilineInputStore[k] = v
  }
}

/** Set default GitHub Action inputs matching action.yml defaults */
function setDefaultInputs(): void {
  setInputs({
    debug: 'false',
    disable_review: 'false',
    disable_release_notes: 'false',
    max_files: '150',
    review_simple_changes: 'false',
    review_comment_lgtm: 'false',
    path_filters: '!dist/**',
    system_message: 'You are an AI reviewer',
    openai_light_model: 'gpt-5.4-nano',
    openai_heavy_model: 'gpt-5.4-mini',
    openai_model_temperature: '0.0',
    openai_retries: '5',
    openai_timeout_ms: '360000',
    openai_concurrency_limit: '4',
    github_concurrency_limit: '4',
    openai_base_url: 'https://api.openai.com/v1',
    language: 'zh-CN',
    enable_dependency_analysis: 'true',
    max_dependency_files: '50',
    enable_web_search: 'true',
    enable_shell: 'true',
    enable_lint_tools: 'true',
    enable_eslint: 'true',
    enable_biome: 'true',
    enable_tsc: 'true',
    enable_prettier: 'false',
    enable_semgrep: 'false',
    eslint_version: '^9.15.0',
    biome_version: '^2.3.0',
    tsc_version: '^5.6.0',
    prettier_version: '^3.0.0',
    semgrep_config: 'p/default',
    command_ack_reaction: 'rocket',
    max_review_comments: '20',
    debug_resolve_inject_failures: '0',
    bot_icon: '',
    bot_name: 'CodeSentinel',
    bot_github_login: '',
    summarize: '',
    summarize_release_notes: ''
  })
}

/** Clean all AI_REVIEWER_* env vars */
function cleanEnvVars(): void {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('AI_REVIEWER_')) {
      delete process.env[key]
    }
  }
}

// ======================== GitHubConfigProvider Tests ========================

describe('GitHubConfigProvider (ARCH-008)', () => {
  beforeEach(() => {
    setDefaultInputs()
  })

  test('platform is "github"', () => {
    const provider = new GitHubConfigProvider()
    expect(provider.platform).toBe('github')
  })

  test('getOptions() returns Options with correct values from action inputs', () => {
    const provider = new GitHubConfigProvider()
    const opts = provider.getOptions()

    expect(opts.debug).toBe(false)
    expect(opts.disableReview).toBe(false)
    expect(opts.disableReleaseNotes).toBe(false)
    expect(opts.maxFiles).toBe(150)
    expect(opts.reviewSimpleChanges).toBe(false)
    expect(opts.reviewCommentLGTM).toBe(false)
    expect(opts.openaiLightModel).toBe('gpt-5.4-nano')
    expect(opts.openaiHeavyModel).toBe('gpt-5.4-mini')
    expect(opts.openaiModelTemperature).toBe(0.0)
    expect(opts.openaiRetries).toBe(5)
    expect(opts.openaiTimeoutMS).toBe(360000)
    expect(opts.openaiConcurrencyLimit).toBe(4)
    expect(opts.githubConcurrencyLimit).toBe(4)
    expect(opts.apiBaseUrl).toBe('https://api.openai.com/v1')
    expect(opts.language).toBe('zh-CN')
    expect(opts.enableDependencyAnalysis).toBe(true)
    expect(opts.maxDependencyFiles).toBe(50)
    expect(opts.enableWebSearch).toBe(true)
    expect(opts.enableShell).toBe(true)
    expect(opts.enableLintTools).toBe(true)
    expect(opts.semgrepConfig).toBe('p/default')
    expect(opts.commandAckReaction).toBe('rocket')
    expect(opts.maxReviewComments).toBe(20)
  })

  test('getOptions() correctly reads tool enable overrides', () => {
    const provider = new GitHubConfigProvider()
    const opts = provider.getOptions()

    expect(opts.toolEnableOverrides).toEqual({
      eslint: true,
      biome: true,
      tsc: true,
      prettier: false,
      semgrep: false
    })
  })

  test('getOptions() correctly reads tool version overrides (non-empty only)', () => {
    const provider = new GitHubConfigProvider()
    const opts = provider.getOptions()

    expect(opts.toolVersionOverrides['eslint']).toBe('^9.15.0')
    expect(opts.toolVersionOverrides['biome']).toBe('^2.3.0')
    expect(opts.toolVersionOverrides['tsc']).toBe('^5.6.0')
    expect(opts.toolVersionOverrides['prettier']).toBe('^3.0.0')
  })

  test('getOptions() excludes empty version strings from toolVersionOverrides', () => {
    inputStore['eslint_version'] = ''
    inputStore['biome_version'] = '  '
    const provider = new GitHubConfigProvider()
    const opts = provider.getOptions()

    expect(opts.toolVersionOverrides).not.toHaveProperty('eslint')
    expect(opts.toolVersionOverrides).not.toHaveProperty('biome')
  })

  test('getOptions() caches result on subsequent calls', () => {
    const provider = new GitHubConfigProvider()
    const opts1 = provider.getOptions()
    const opts2 = provider.getOptions()

    expect(opts1).toBe(opts2)
  })

  test('getPromptConfig() returns prompt templates', () => {
    inputStore['summarize'] = 'Custom summarize prompt'
    inputStore['summarize_release_notes'] = 'Custom release notes prompt'

    const provider = new GitHubConfigProvider()
    const prompt = provider.getPromptConfig()

    expect(prompt.summarize).toBe('Custom summarize prompt')
    expect(prompt.summarizeReleaseNotes).toBe('Custom release notes prompt')
  })

  test('getPromptConfig() caches result', () => {
    const provider = new GitHubConfigProvider()
    expect(provider.getPromptConfig()).toBe(provider.getPromptConfig())
  })

  test('getBotConfig() returns bot display settings', () => {
    inputStore['bot_icon'] = ''
    inputStore['bot_name'] = 'CodeSentinel'
    inputStore['bot_github_login'] = 'my-app[bot]'

    const provider = new GitHubConfigProvider()
    const bot = provider.getBotConfig()

    expect(bot.icon).toBe('🤖')
    expect(bot.name).toBe('CodeSentinel')
    expect(bot.platformLogin).toBe('my-app[bot]')
  })

  test('getBotConfig() uses fallback icon and name when empty', () => {
    inputStore['bot_icon'] = ''
    inputStore['bot_name'] = ''

    const provider = new GitHubConfigProvider()
    const bot = provider.getBotConfig()

    expect(bot.icon).toBe('🤖')
    expect(bot.name).toBe('AI Reviewer')
  })

  test('getBotConfig() caches result', () => {
    const provider = new GitHubConfigProvider()
    expect(provider.getBotConfig()).toBe(provider.getBotConfig())
  })

  test('ARCH-010: invalid integer input throws ConfigError', () => {
    setDefaultInputs()
    inputStore['max_files'] = 'abc'

    const provider = new GitHubConfigProvider()

    expect(() => provider.getOptions()).toThrow(ConfigError)
    expect(() => provider.getOptions()).toThrow(/Invalid integer value/)
  })

  test('ARCH-010: scientific notation (1e3) rejected for integer inputs', () => {
    setDefaultInputs()
    inputStore['openai_retries'] = '1e3'

    const provider = new GitHubConfigProvider()

    expect(() => provider.getOptions()).toThrow(ConfigError)
  })

  test('ARCH-010: invalid float input throws ConfigError', () => {
    setDefaultInputs()
    inputStore['openai_model_temperature'] = 'hot'

    const provider = new GitHubConfigProvider()

    expect(() => provider.getOptions()).toThrow(ConfigError)
    expect(() => provider.getOptions()).toThrow(/Invalid numeric value/)
  })

  test('implements ConfigProvider interface', () => {
    const provider: ConfigProvider = new GitHubConfigProvider()
    expect(provider.platform).toBe('github')
    expect(typeof provider.getOptions).toBe('function')
    expect(typeof provider.getPromptConfig).toBe('function')
    expect(typeof provider.getBotConfig).toBe('function')
    expect(typeof provider.print).toBe('function')
  })
})

// ======================== GitLabConfigProvider Tests ========================

describe('GitLabConfigProvider (ARCH-009)', () => {
  beforeEach(() => {
    cleanEnvVars()
  })

  afterEach(() => {
    cleanEnvVars()
  })

  test('platform is "gitlab"', () => {
    const provider = new GitLabConfigProvider()
    expect(provider.platform).toBe('gitlab')
  })

  test('getOptions() uses CONFIG_DEFAULTS when no env vars set', () => {
    const provider = new GitLabConfigProvider()
    const opts = provider.getOptions()

    expect(opts.debug).toBe(false)
    expect(opts.disableReview).toBe(false)
    expect(opts.disableReleaseNotes).toBe(false)
    expect(opts.maxFiles).toBe(150)
    expect(opts.openaiLightModel).toBe('gpt-5.4-nano')
    expect(opts.openaiHeavyModel).toBe('gpt-5.4-mini')
    expect(opts.openaiModelTemperature).toBe(0.0)
    expect(opts.openaiRetries).toBe(5)
    expect(opts.openaiTimeoutMS).toBe(360000)
    expect(opts.openaiConcurrencyLimit).toBe(4)
    expect(opts.githubConcurrencyLimit).toBe(4)
    expect(opts.apiBaseUrl).toBe('https://api.openai.com/v1')
    expect(opts.language).toBe('zh-CN')
    expect(opts.enableDependencyAnalysis).toBe(true)
    expect(opts.enableWebSearch).toBe(true)
    expect(opts.semgrepConfig).toBe('p/default')
    expect(opts.commandAckReaction).toBe('rocket')
    expect(opts.maxReviewComments).toBe(20)
  })

  test('getOptions() reads from AI_REVIEWER_* env vars', () => {
    process.env.AI_REVIEWER_DEBUG = 'true'
    process.env.AI_REVIEWER_DISABLE_REVIEW = 'true'
    process.env.AI_REVIEWER_MAX_FILES = '200'
    process.env.AI_REVIEWER_OPENAI_LIGHT_MODEL = 'gpt-4o-mini'
    process.env.AI_REVIEWER_OPENAI_HEAVY_MODEL = 'gpt-4o'
    process.env.AI_REVIEWER_LANGUAGE = 'en-US'
    process.env.AI_REVIEWER_OPENAI_BASE_URL = 'https://custom.api.com/v1'

    const provider = new GitLabConfigProvider()
    const opts = provider.getOptions()

    expect(opts.debug).toBe(true)
    expect(opts.disableReview).toBe(true)
    expect(opts.maxFiles).toBe(200)
    expect(opts.openaiLightModel).toBe('gpt-4o-mini')
    expect(opts.openaiHeavyModel).toBe('gpt-4o')
    expect(opts.language).toBe('en-US')
    expect(opts.apiBaseUrl).toBe('https://custom.api.com/v1')
  })

  test('CFG-002: enable_shell is ALWAYS forced false', () => {
    process.env.AI_REVIEWER_ENABLE_SHELL = 'true'

    const provider = new GitLabConfigProvider()
    const opts = provider.getOptions()

    expect(opts.enableShell).toBe(false)
  })

  test('CFG-002: enable_lint_tools is ALWAYS forced false', () => {
    process.env.AI_REVIEWER_ENABLE_LINT_TOOLS = 'true'

    const provider = new GitLabConfigProvider()
    const opts = provider.getOptions()

    expect(opts.enableLintTools).toBe(false)
  })

  test('CFG-002: per-tool enables are all forced false (consistent with lint master switch)', () => {
    const provider = new GitLabConfigProvider()
    const opts = provider.getOptions()

    expect(opts.toolEnableOverrides).toEqual({
      eslint: false,
      biome: false,
      tsc: false,
      prettier: false,
      semgrep: false
    })
  })

  test('CFG-002: per-tool enables stay false even when env vars say true', () => {
    process.env.AI_REVIEWER_ENABLE_ESLINT = 'true'
    process.env.AI_REVIEWER_ENABLE_BIOME = 'true'

    const provider = new GitLabConfigProvider()
    const opts = provider.getOptions()

    expect(opts.toolEnableOverrides['eslint']).toBe(false)
    expect(opts.toolEnableOverrides['biome']).toBe(false)
  })

  test('CFG-002: security override logs when values are overridden', () => {
    process.env.AI_REVIEWER_ENABLE_SHELL = 'true'
    process.env.AI_REVIEWER_ENABLE_LINT_TOOLS = 'true'

    const provider = new GitLabConfigProvider()
    provider.getOptions()

    expect(provider.securityOverrides).toHaveLength(2)
    expect(provider.securityOverrides[0]).toContain('AI_REVIEWER_ENABLE_SHELL')
    expect(provider.securityOverrides[0]).toContain('CFG-002')
    expect(provider.securityOverrides[1]).toContain('AI_REVIEWER_ENABLE_LINT_TOOLS')
  })

  test('CFG-002: no security override log when values are already false', () => {
    process.env.AI_REVIEWER_ENABLE_SHELL = 'false'
    process.env.AI_REVIEWER_ENABLE_LINT_TOOLS = 'false'

    const provider = new GitLabConfigProvider()
    provider.getOptions()

    expect(provider.securityOverrides).toHaveLength(0)
  })

  test('getOptions() reads tool version overrides from env vars', () => {
    process.env.AI_REVIEWER_ESLINT_VERSION = '^8.57.0'
    process.env.AI_REVIEWER_BIOME_VERSION = '^2.0.0'

    const provider = new GitLabConfigProvider()
    const opts = provider.getOptions()

    expect(opts.toolVersionOverrides['eslint']).toBe('^8.57.0')
    expect(opts.toolVersionOverrides['biome']).toBe('^2.0.0')
    expect(opts.toolVersionOverrides).not.toHaveProperty('tsc')
  })

  test('getOptions() excludes empty version strings', () => {
    process.env.AI_REVIEWER_ESLINT_VERSION = ''
    process.env.AI_REVIEWER_BIOME_VERSION = '  '

    const provider = new GitLabConfigProvider()
    const opts = provider.getOptions()

    expect(opts.toolVersionOverrides).not.toHaveProperty('eslint')
    expect(opts.toolVersionOverrides).not.toHaveProperty('biome')
  })

  test('getOptions() caches result on subsequent calls', () => {
    const provider = new GitLabConfigProvider()
    const opts1 = provider.getOptions()
    const opts2 = provider.getOptions()

    expect(opts1).toBe(opts2)
  })

  test('getOptions() reads multiline path filters', () => {
    process.env.AI_REVIEWER_PATH_FILTERS = '!dist/**\n!**/*.json\nsrc/**'

    const provider = new GitLabConfigProvider()
    const opts = provider.getOptions()

    expect(opts.checkPath('src/main.ts')).toBe(true)
    expect(opts.checkPath('dist/index.js')).toBe(false)
  })

  test('getPromptConfig() returns prompt templates from env vars', () => {
    process.env.AI_REVIEWER_SUMMARIZE = 'Custom GitLab summarize'
    process.env.AI_REVIEWER_SUMMARIZE_RELEASE_NOTES = 'Custom GitLab release notes'

    const provider = new GitLabConfigProvider()
    const prompt = provider.getPromptConfig()

    expect(prompt.summarize).toBe('Custom GitLab summarize')
    expect(prompt.summarizeReleaseNotes).toBe('Custom GitLab release notes')
  })

  test('getPromptConfig() uses CONFIG_DEFAULTS when env vars not set', () => {
    const provider = new GitLabConfigProvider()
    const prompt = provider.getPromptConfig()

    expect(prompt.summarize).toBe(CONFIG_DEFAULTS.summarize)
    expect(prompt.summarizeReleaseNotes).toBe(CONFIG_DEFAULTS.summarizeReleaseNotes)
    // Verify defaults are non-empty
    expect(prompt.summarize.length).toBeGreaterThan(0)
    expect(prompt.summarizeReleaseNotes.length).toBeGreaterThan(0)
  })

  test('getBotConfig() returns bot settings from env vars', () => {
    process.env.AI_REVIEWER_BOT_ICON = '🤖'
    process.env.AI_REVIEWER_BOT_NAME = 'MyBot'
    process.env.AI_REVIEWER_BOT_GITLAB_LOGIN = 'bot-user'

    const provider = new GitLabConfigProvider()
    const bot = provider.getBotConfig()

    expect(bot.icon).toBe('🤖')
    expect(bot.name).toBe('MyBot')
    expect(bot.platformLogin).toBe('bot-user')
  })

  test('getBotConfig() uses CONFIG_DEFAULTS fallback values when env vars not set', () => {
    const provider = new GitLabConfigProvider()
    const bot = provider.getBotConfig()

    expect(bot.icon).toBe('🦉')
    expect(bot.name).toBe('CodeSentinel')
    expect(bot.platformLogin).toBe('')
  })

  test('ARCH-010: invalid boolean value throws ConfigError', () => {
    process.env.AI_REVIEWER_DEBUG = 'maybe'

    const provider = new GitLabConfigProvider()

    expect(() => provider.getOptions()).toThrow(ConfigError)
    expect(() => provider.getOptions()).toThrow(/Invalid boolean value/)
  })

  test('ARCH-010: ConfigError includes platform and field', () => {
    process.env.AI_REVIEWER_DISABLE_REVIEW = 'not-a-bool'

    const provider = new GitLabConfigProvider()

    let caught: unknown
    try {
      provider.getOptions()
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(ConfigError)
    const ce = caught as InstanceType<typeof ConfigError>
    expect(ce.platform).toBe('gitlab')
    expect(ce.field).toBe('AI_REVIEWER_DISABLE_REVIEW')
  })

  test('ARCH-010: invalid integer value throws ConfigError', () => {
    process.env.AI_REVIEWER_MAX_FILES = 'abc'

    const provider = new GitLabConfigProvider()

    expect(() => provider.getOptions()).toThrow(ConfigError)
    expect(() => provider.getOptions()).toThrow(/Invalid integer value/)
  })

  test('ARCH-010: ConfigError for integer includes field name', () => {
    process.env.AI_REVIEWER_OPENAI_TIMEOUT_MS = 'not-a-number'

    const provider = new GitLabConfigProvider()

    let caught: unknown
    try {
      provider.getOptions()
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(ConfigError)
    const ce = caught as InstanceType<typeof ConfigError>
    expect(ce.platform).toBe('gitlab')
    expect(ce.field).toBe('AI_REVIEWER_OPENAI_TIMEOUT_MS')
  })

  test('ARCH-010: scientific notation (1e3) rejected for integer fields', () => {
    process.env.AI_REVIEWER_MAX_FILES = '1e3'

    const provider = new GitLabConfigProvider()

    expect(() => provider.getOptions()).toThrow(ConfigError)
    expect(() => provider.getOptions()).toThrow(/Invalid integer value/)
  })

  test('ARCH-010: Infinity rejected for integer fields', () => {
    process.env.AI_REVIEWER_OPENAI_RETRIES = 'Infinity'

    const provider = new GitLabConfigProvider()

    expect(() => provider.getOptions()).toThrow(ConfigError)
  })

  test('ARCH-010: float value (3.14) rejected for integer fields', () => {
    process.env.AI_REVIEWER_MAX_FILES = '3.14'

    const provider = new GitLabConfigProvider()

    expect(() => provider.getOptions()).toThrow(ConfigError)
    expect(() => provider.getOptions()).toThrow(/Invalid integer value/)
  })

  test('ARCH-010: invalid float value throws ConfigError', () => {
    process.env.AI_REVIEWER_OPENAI_MODEL_TEMPERATURE = 'abc'

    const provider = new GitLabConfigProvider()

    expect(() => provider.getOptions()).toThrow(ConfigError)
    expect(() => provider.getOptions()).toThrow(/Invalid numeric value/)
  })

  test('getOptions() uses CONFIG_DEFAULTS.pathFilters when env var not set', () => {
    const provider = new GitLabConfigProvider()
    const opts = provider.getOptions()

    // dist/index.js should be excluded by default path_filters
    expect(opts.checkPath('dist/index.js')).toBe(false)
    // Source files should be allowed
    expect(opts.checkPath('src/main.ts')).toBe(true)
  })

  test('ARCH-010: valid numeric strings pass validation', () => {
    process.env.AI_REVIEWER_MAX_FILES = '200'
    process.env.AI_REVIEWER_OPENAI_RETRIES = '10'
    process.env.AI_REVIEWER_OPENAI_MODEL_TEMPERATURE = '0.5'

    const provider = new GitLabConfigProvider()
    const opts = provider.getOptions()

    expect(opts.maxFiles).toBe(200)
    expect(opts.openaiRetries).toBe(10)
    expect(opts.openaiModelTemperature).toBe(0.5)
  })

  test('envBool accepts various true/false representations', () => {
    // Test 'yes'
    process.env.AI_REVIEWER_DEBUG = 'yes'
    let provider = new GitLabConfigProvider()
    expect(provider.getOptions().debug).toBe(true)
    cleanEnvVars()

    // Test '1'
    process.env.AI_REVIEWER_DEBUG = '1'
    provider = new GitLabConfigProvider()
    expect(provider.getOptions().debug).toBe(true)
    cleanEnvVars()

    // Test 'no'
    process.env.AI_REVIEWER_DEBUG = 'no'
    provider = new GitLabConfigProvider()
    expect(provider.getOptions().debug).toBe(false)
    cleanEnvVars()

    // Test '0'
    process.env.AI_REVIEWER_DEBUG = '0'
    provider = new GitLabConfigProvider()
    expect(provider.getOptions().debug).toBe(false)
    cleanEnvVars()

    // Test 'TRUE' (case insensitive)
    process.env.AI_REVIEWER_DEBUG = 'TRUE'
    provider = new GitLabConfigProvider()
    expect(provider.getOptions().debug).toBe(true)
  })

  test('implements ConfigProvider interface', () => {
    const provider: ConfigProvider = new GitLabConfigProvider()
    expect(provider.platform).toBe('gitlab')
    expect(typeof provider.getOptions).toBe('function')
    expect(typeof provider.getPromptConfig).toBe('function')
    expect(typeof provider.getBotConfig).toBe('function')
    expect(typeof provider.print).toBe('function')
  })
})

// ======================== ARCH-011: print() Security Tests ========================

describe('ARCH-011: print() must not output secrets', () => {
  const SECRET_PATTERNS = [
    /openai.*key/i,
    /api.*key/i,
    /github.*token/i,
    /gitlab.*pat/i,
    /trigger.*token/i,
    /secret/i,
    /password/i,
    /sk-[a-zA-Z0-9]/,
    /ghp_[a-zA-Z0-9]/,
    /gho_[a-zA-Z0-9]/,
    /glpat-[a-zA-Z0-9]/
  ]

  test('GitHubConfigProvider.print() does not output secret fields', () => {
    setDefaultInputs()
    const provider = new GitHubConfigProvider()
    const lines: string[] = []
    provider.print(msg => lines.push(msg))

    const output = lines.join('\n')
    for (const pattern of SECRET_PATTERNS) {
      expect(output).not.toMatch(pattern)
    }
  })

  test('GitLabConfigProvider.print() does not output secret fields', () => {
    cleanEnvVars()
    const provider = new GitLabConfigProvider()
    const lines: string[] = []
    provider.print(msg => lines.push(msg))

    const output = lines.join('\n')
    for (const pattern of SECRET_PATTERNS) {
      expect(output).not.toMatch(pattern)
    }
  })

  test('GitHubConfigProvider.print() outputs all non-secret config fields', () => {
    setDefaultInputs()
    const provider = new GitHubConfigProvider()
    const lines: string[] = []
    provider.print(msg => lines.push(msg))

    const output = lines.join('\n')
    expect(output).toContain('debug')
    expect(output).toContain('openai_light_model')
    expect(output).toContain('openai_heavy_model')
    expect(output).toContain('language')
    expect(output).toContain('enable_web_search')
    expect(output).toContain('bot_name')
    expect(output).toContain('ConfigProvider:github')
  })

  test('GitLabConfigProvider.print() outputs all non-secret config fields', () => {
    cleanEnvVars()
    const provider = new GitLabConfigProvider()
    const lines: string[] = []
    provider.print(msg => lines.push(msg))

    const output = lines.join('\n')
    expect(output).toContain('debug')
    expect(output).toContain('enable_shell')
    expect(output).toContain('CFG-002')
    expect(output).toContain('ConfigProvider:gitlab')
  })

  test('GitLabConfigProvider.print() outputs CFG-002 security override warnings', () => {
    process.env.AI_REVIEWER_ENABLE_SHELL = 'true'
    process.env.AI_REVIEWER_ENABLE_LINT_TOOLS = 'true'

    const provider = new GitLabConfigProvider()
    const lines: string[] = []
    provider.print(msg => lines.push(msg))

    const output = lines.join('\n')
    expect(output).toContain('[SECURITY]')
    expect(output).toContain('CFG-002')

    cleanEnvVars()
  })
})

// ======================== Cross-Platform Consistency Tests ========================

describe('Cross-platform config consistency', () => {
  beforeEach(() => {
    cleanEnvVars()
  })

  afterEach(() => {
    cleanEnvVars()
  })

  test('GitLab defaults match action.yml defaults (CONFIG_DEFAULTS)', () => {
    // Use the same values that action.yml would provide for GitHub
    setInputs({
      debug: 'false',
      disable_review: 'false',
      disable_release_notes: 'false',
      max_files: CONFIG_DEFAULTS.maxFiles,
      review_simple_changes: 'false',
      review_comment_lgtm: 'false',
      path_filters: '',
      system_message: CONFIG_DEFAULTS.systemMessage,
      openai_light_model: CONFIG_DEFAULTS.openaiLightModel,
      openai_heavy_model: CONFIG_DEFAULTS.openaiHeavyModel,
      openai_model_temperature: CONFIG_DEFAULTS.openaiModelTemperature,
      openai_retries: CONFIG_DEFAULTS.openaiRetries,
      openai_timeout_ms: CONFIG_DEFAULTS.openaiTimeoutMS,
      openai_concurrency_limit: CONFIG_DEFAULTS.openaiConcurrencyLimit,
      github_concurrency_limit: CONFIG_DEFAULTS.githubConcurrencyLimit,
      openai_base_url: CONFIG_DEFAULTS.apiBaseUrl,
      language: CONFIG_DEFAULTS.language,
      enable_dependency_analysis: 'true',
      max_dependency_files: CONFIG_DEFAULTS.maxDependencyFiles,
      enable_web_search: 'true',
      enable_shell: 'true',
      enable_lint_tools: 'true',
      enable_eslint: 'true',
      enable_biome: 'true',
      enable_tsc: 'true',
      enable_prettier: 'false',
      enable_semgrep: 'false',
      eslint_version: '',
      biome_version: '',
      tsc_version: '',
      prettier_version: '',
      semgrep_config: CONFIG_DEFAULTS.semgrepConfig,
      command_ack_reaction: CONFIG_DEFAULTS.commandAckReaction,
      max_review_comments: CONFIG_DEFAULTS.maxReviewComments,
      debug_resolve_inject_failures: CONFIG_DEFAULTS.debugResolveInjectFailures,
      bot_icon: '',
      bot_name: '',
      bot_github_login: '',
      summarize: '',
      summarize_release_notes: ''
    })

    const ghOpts = new GitHubConfigProvider().getOptions()
    const glOpts = new GitLabConfigProvider().getOptions()

    // All shared fields must match
    expect(ghOpts.debug).toBe(glOpts.debug)
    expect(ghOpts.disableReview).toBe(glOpts.disableReview)
    expect(ghOpts.disableReleaseNotes).toBe(glOpts.disableReleaseNotes)
    expect(ghOpts.maxFiles).toBe(glOpts.maxFiles)
    expect(ghOpts.openaiLightModel).toBe(glOpts.openaiLightModel)
    expect(ghOpts.openaiHeavyModel).toBe(glOpts.openaiHeavyModel)
    expect(ghOpts.openaiModelTemperature).toBe(glOpts.openaiModelTemperature)
    expect(ghOpts.openaiRetries).toBe(glOpts.openaiRetries)
    expect(ghOpts.openaiTimeoutMS).toBe(glOpts.openaiTimeoutMS)
    expect(ghOpts.openaiConcurrencyLimit).toBe(glOpts.openaiConcurrencyLimit)
    expect(ghOpts.githubConcurrencyLimit).toBe(glOpts.githubConcurrencyLimit)
    expect(ghOpts.apiBaseUrl).toBe(glOpts.apiBaseUrl)
    expect(ghOpts.language).toBe(glOpts.language)
    expect(ghOpts.enableDependencyAnalysis).toBe(glOpts.enableDependencyAnalysis)
    expect(ghOpts.maxDependencyFiles).toBe(glOpts.maxDependencyFiles)
    expect(ghOpts.enableWebSearch).toBe(glOpts.enableWebSearch)
    expect(ghOpts.semgrepConfig).toBe(glOpts.semgrepConfig)
    expect(ghOpts.commandAckReaction).toBe(glOpts.commandAckReaction)
    expect(ghOpts.maxReviewComments).toBe(glOpts.maxReviewComments)
  })

  test('GitLab always has enable_shell=false and enable_lint_tools=false regardless of GitHub settings', () => {
    setDefaultInputs()
    inputStore['enable_shell'] = 'true'
    inputStore['enable_lint_tools'] = 'true'

    const ghOpts = new GitHubConfigProvider().getOptions()
    expect(ghOpts.enableShell).toBe(true)
    expect(ghOpts.enableLintTools).toBe(true)

    process.env.AI_REVIEWER_ENABLE_SHELL = 'true'
    process.env.AI_REVIEWER_ENABLE_LINT_TOOLS = 'true'
    const glOpts = new GitLabConfigProvider().getOptions()
    expect(glOpts.enableShell).toBe(false)
    expect(glOpts.enableLintTools).toBe(false)
  })

  test('GitLab prompt defaults are non-empty and match CONFIG_DEFAULTS', () => {
    const provider = new GitLabConfigProvider()
    const prompt = provider.getPromptConfig()

    expect(prompt.summarize).toContain('Walkthrough')
    expect(prompt.summarize).toContain('Changes')
    expect(prompt.summarizeReleaseNotes).toContain('release notes')
  })
})

// ======================== CFG-003: Semgrep Version Tests ========================

describe('CFG-003: Semgrep version alignment', () => {
  beforeEach(() => {
    cleanEnvVars()
  })

  afterEach(() => {
    cleanEnvVars()
  })

  test('CONFIG_DEFAULTS includes semgrepVersion matching Semgrep adapter default', () => {
    expect(CONFIG_DEFAULTS.semgrepVersion).toBe('^1.95.0')
  })

  test('GitHub provider passes semgrep_version through toolVersionOverrides', () => {
    setDefaultInputs()
    inputStore['semgrep_version'] = '^2.0.0'

    const provider = new GitHubConfigProvider()
    const opts = provider.getOptions()

    expect(opts.toolVersionOverrides['semgrep']).toBe('^2.0.0')
  })

  test('GitLab provider passes AI_REVIEWER_SEMGREP_VERSION through toolVersionOverrides', () => {
    process.env.AI_REVIEWER_SEMGREP_VERSION = '^2.0.0'

    const provider = new GitLabConfigProvider()
    const opts = provider.getOptions()

    expect(opts.toolVersionOverrides['semgrep']).toBe('^2.0.0')
  })

  test('empty semgrep_version does not enter toolVersionOverrides', () => {
    setDefaultInputs()
    inputStore['semgrep_version'] = ''

    const provider = new GitHubConfigProvider()
    const opts = provider.getOptions()

    expect(opts.toolVersionOverrides).not.toHaveProperty('semgrep')
  })
})

// ======================== CFG-005: Bot Config in Options Tests ========================

describe('CFG-005: bot config passed through Options', () => {
  test('GitHub provider passes botIcon/botName/botLogin to Options', () => {
    setDefaultInputs()
    inputStore['bot_icon'] = '🦉'
    inputStore['bot_name'] = 'TestBot'
    inputStore['bot_github_login'] = 'test-app[bot]'

    const provider = new GitHubConfigProvider()
    const opts = provider.getOptions()

    expect(opts.botIcon).toBe('🦉')
    expect(opts.botName).toBe('TestBot')
    expect(opts.botLogin).toBe('test-app[bot]')
  })

  test('GitHub provider uses fallback bot values when inputs are empty', () => {
    setDefaultInputs()
    inputStore['bot_icon'] = ''
    inputStore['bot_name'] = ''
    inputStore['bot_github_login'] = ''

    const provider = new GitHubConfigProvider()
    const opts = provider.getOptions()

    expect(opts.botIcon).toBe('🤖')
    expect(opts.botName).toBe('AI Reviewer')
    expect(opts.botLogin).toBe('')
  })

  test('GitLab provider passes botIcon/botName/botLogin to Options from CONFIG_DEFAULTS', () => {
    const provider = new GitLabConfigProvider()
    const opts = provider.getOptions()

    expect(opts.botIcon).toBe('🦉')
    expect(opts.botName).toBe('CodeSentinel')
    expect(opts.botLogin).toBe('')
  })

  test('GitLab provider reads bot config from env vars', () => {
    process.env.AI_REVIEWER_BOT_ICON = '🤖'
    process.env.AI_REVIEWER_BOT_NAME = 'MyBot'
    process.env.AI_REVIEWER_BOT_GITLAB_LOGIN = 'bot-user'

    const provider = new GitLabConfigProvider()
    const opts = provider.getOptions()

    expect(opts.botIcon).toBe('🤖')
    expect(opts.botName).toBe('MyBot')
    expect(opts.botLogin).toBe('bot-user')
  })
})

// ======================== CFG-006: Undeclared Input Audit ========================

describe('CFG-006: no undeclared inputs read by ConfigProvider', () => {
  test('all GitHub inputs read by provider are covered by CONFIG_DEFAULTS or action.yml', () => {
    // This test verifies that getOptions() does not crash with default inputs,
    // meaning all required inputs have sensible defaults
    setDefaultInputs()
    const provider = new GitHubConfigProvider()

    expect(() => provider.getOptions()).not.toThrow()
    expect(() => provider.getPromptConfig()).not.toThrow()
    expect(() => provider.getBotConfig()).not.toThrow()
  })

  test('debug_resolve_inject_failures defaults to 0', () => {
    setDefaultInputs()
    const provider = new GitHubConfigProvider()
    const opts = provider.getOptions()

    expect(opts.debugResolveInjectFailures).toBe(0)
  })

  test('GitLab debug_resolve_inject_failures defaults to 0 via CONFIG_DEFAULTS', () => {
    const provider = new GitLabConfigProvider()
    const opts = provider.getOptions()

    expect(opts.debugResolveInjectFailures).toBe(0)
    expect(CONFIG_DEFAULTS.debugResolveInjectFailures).toBe('0')
  })
})
