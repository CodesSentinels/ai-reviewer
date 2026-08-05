/**
 * platform/gitlab-config-provider.ts - GitLab CI 配置提供者（ARCH-009）
 *
 * 从 process.env CI variables（AI_REVIEWER_* 前缀）读取配置，
 * 构建规范化 Options。
 *
 * 安全约束（CFG-002）：
 * - enable_shell 强制为 false（secret-bearing trigger 不执行本地 shell）
 * - enable_lint_tools 强制为 false（不在 trigger job 中检测/安装/运行 lint 工具）
 * - 所有 per-tool enable 也强制为 false（与总开关一致，避免配置矛盾）
 * - 仓库配置、MR payload 和 Note payload 均不得重新开启上述字段
 *
 * 配置优先级（ARCH-010）：
 * 1. 安全强制覆盖（CFG-002，最高优先级，不可被任何来源覆盖）
 * 2. CI variables（AI_REVIEWER_* 环境变量）
 * 3. CONFIG_DEFAULTS 共享默认值（与 action.yml 默认值对齐）
 *
 * 不 import @actions/core——GitLab-only 启动不得依赖 GitHub 专有运行时（ARCH-015）。
 */

import type {BotConfig, ConfigProvider, PromptConfig} from './config-provider'
import {CONFIG_DEFAULTS, ConfigError, validateFloatStr, validateIntStr} from './config-provider'
import type {Platform} from './execution-context'
import {Options} from '../options'

/** 从环境变量读取字符串，未设置或空则返回 undefined */
function envStr(key: string): string | undefined {
  const v = process.env[key]
  if (v == null || v === '') return undefined
  return v
}

/** 从环境变量读取布尔值，支持 'true'/'false'（不区分大小写） */
function envBool(key: string): boolean | undefined {
  const v = envStr(key)
  if (v == null) return undefined
  const lower = v.toLowerCase()
  if (lower === 'true' || lower === '1' || lower === 'yes') return true
  if (lower === 'false' || lower === '0' || lower === 'no') return false
  throw new ConfigError(
    `Invalid boolean value for ${key}: "${v}" (expected true/false)`,
    'gitlab',
    key
  )
}

/** 从环境变量读取整数字符串并校验（ARCH-010 fail closed） */
function envIntStr(key: string, fallback: string): string {
  const v = envStr(key)
  if (v == null) return fallback
  return validateIntStr(v, 'gitlab', key)
}

/** 从环境变量读取浮点数字符串并校验（ARCH-010 fail closed） */
function envFloatStr(key: string, fallback: string): string {
  const v = envStr(key)
  if (v == null) return fallback
  return validateFloatStr(v, 'gitlab', key)
}

/** 从环境变量读取多行值（按换行分割） */
function envMultiline(key: string): string[] | undefined {
  const v = envStr(key)
  if (v == null) return undefined
  return v.split('\n').filter(line => line.trim().length > 0)
}

/**
 * 受安全强制覆盖保护的字段名称。
 * 即使 CI variable 显式设为 true，也会被强制覆盖为 false。
 */
const SECURITY_FORCED_FALSE = ['AI_REVIEWER_ENABLE_SHELL', 'AI_REVIEWER_ENABLE_LINT_TOOLS'] as const

export class GitLabConfigProvider implements ConfigProvider {
  readonly platform: Platform = 'gitlab'

  private cachedOptions: Options | null = null
  private cachedPromptConfig: PromptConfig | null = null
  private cachedBotConfig: BotConfig | null = null

  /** 安全强制覆盖日志（供测试验证） */
  readonly securityOverrides: string[] = []

  getOptions(): Options {
    if (this.cachedOptions) return this.cachedOptions

    // CFG-002: 记录安全强制覆盖
    for (const key of SECURITY_FORCED_FALSE) {
      const raw = envStr(key)
      if (raw != null && raw.toLowerCase() !== 'false' && raw !== '0' && raw !== 'no') {
        this.securityOverrides.push(`${key}="${raw}" overridden to false (CFG-002 security policy)`)
      }
    }

    // 工具版本覆盖
    const toolVersionOverrides = Object.fromEntries(
      (
        [
          ['eslint', 'AI_REVIEWER_ESLINT_VERSION'],
          ['biome', 'AI_REVIEWER_BIOME_VERSION'],
          ['tsc', 'AI_REVIEWER_TSC_VERSION'],
          ['prettier', 'AI_REVIEWER_PRETTIER_VERSION'],
          ['semgrep', 'AI_REVIEWER_SEMGREP_VERSION']
        ] as const
      )
        .map(([toolName, envKey]) => [toolName, (envStr(envKey) ?? '').trim()])
        .filter(([, v]) => v.length > 0)
    )

    // CFG-002: enable_lint_tools 被强制关闭，per-tool enable 也全部为 false，
    // 避免配置日志出现 "enable_lint_tools=false, eslint=true" 的矛盾状态。
    const toolEnableOverrides: Record<string, boolean> = {
      eslint: false,
      biome: false,
      tsc: false,
      prettier: false,
      semgrep: false
    }

    this.cachedOptions = new Options(
      envBool('AI_REVIEWER_DEBUG') ?? CONFIG_DEFAULTS.debug,
      envBool('AI_REVIEWER_DISABLE_REVIEW') ?? CONFIG_DEFAULTS.disableReview,
      envBool('AI_REVIEWER_DISABLE_RELEASE_NOTES') ?? CONFIG_DEFAULTS.disableReleaseNotes,
      envIntStr('AI_REVIEWER_MAX_FILES', CONFIG_DEFAULTS.maxFiles),
      envBool('AI_REVIEWER_REVIEW_SIMPLE_CHANGES') ?? CONFIG_DEFAULTS.reviewSimpleChanges,
      envBool('AI_REVIEWER_REVIEW_COMMENT_LGTM') ?? CONFIG_DEFAULTS.reviewCommentLGTM,
      envMultiline('AI_REVIEWER_PATH_FILTERS') ?? [...CONFIG_DEFAULTS.pathFilters],
      envStr('AI_REVIEWER_SYSTEM_MESSAGE') ?? CONFIG_DEFAULTS.systemMessage,
      envStr('AI_REVIEWER_OPENAI_LIGHT_MODEL') ?? CONFIG_DEFAULTS.openaiLightModel,
      envStr('AI_REVIEWER_OPENAI_HEAVY_MODEL') ?? CONFIG_DEFAULTS.openaiHeavyModel,
      envFloatStr('AI_REVIEWER_OPENAI_MODEL_TEMPERATURE', CONFIG_DEFAULTS.openaiModelTemperature),
      envIntStr('AI_REVIEWER_OPENAI_RETRIES', CONFIG_DEFAULTS.openaiRetries),
      envIntStr('AI_REVIEWER_OPENAI_TIMEOUT_MS', CONFIG_DEFAULTS.openaiTimeoutMS),
      envIntStr('AI_REVIEWER_OPENAI_CONCURRENCY_LIMIT', CONFIG_DEFAULTS.openaiConcurrencyLimit),
      envIntStr('AI_REVIEWER_GITHUB_CONCURRENCY_LIMIT', CONFIG_DEFAULTS.githubConcurrencyLimit),
      envStr('AI_REVIEWER_OPENAI_BASE_URL') ?? CONFIG_DEFAULTS.apiBaseUrl,
      envStr('AI_REVIEWER_LANGUAGE') ?? CONFIG_DEFAULTS.language,
      envBool('AI_REVIEWER_ENABLE_DEPENDENCY_ANALYSIS') ?? CONFIG_DEFAULTS.enableDependencyAnalysis,
      envIntStr('AI_REVIEWER_MAX_DEPENDENCY_FILES', CONFIG_DEFAULTS.maxDependencyFiles),
      envBool('AI_REVIEWER_ENABLE_WEB_SEARCH') ?? CONFIG_DEFAULTS.enableWebSearch,
      // CFG-002: 安全强制覆盖 — 不可被任何配置来源重新开启
      false, // enableShell
      false, // enableLintTools
      toolEnableOverrides,
      toolVersionOverrides,
      envStr('AI_REVIEWER_SEMGREP_CONFIG') ?? CONFIG_DEFAULTS.semgrepConfig,
      envStr('AI_REVIEWER_COMMAND_ACK_REACTION') ?? CONFIG_DEFAULTS.commandAckReaction,
      envIntStr('AI_REVIEWER_MAX_REVIEW_COMMENTS', CONFIG_DEFAULTS.maxReviewComments),
      envIntStr(
        'AI_REVIEWER_DEBUG_RESOLVE_INJECT_FAILURES',
        CONFIG_DEFAULTS.debugResolveInjectFailures
      ),
      envStr('AI_REVIEWER_BOT_ICON') ?? CONFIG_DEFAULTS.botIcon,
      envStr('AI_REVIEWER_BOT_NAME') ?? CONFIG_DEFAULTS.botName,
      envStr('AI_REVIEWER_BOT_GITLAB_LOGIN') ?? ''
    )

    return this.cachedOptions
  }

  getPromptConfig(): PromptConfig {
    if (this.cachedPromptConfig) return this.cachedPromptConfig

    this.cachedPromptConfig = {
      summarize: envStr('AI_REVIEWER_SUMMARIZE') ?? CONFIG_DEFAULTS.summarize,
      summarizeReleaseNotes:
        envStr('AI_REVIEWER_SUMMARIZE_RELEASE_NOTES') ?? CONFIG_DEFAULTS.summarizeReleaseNotes
    }

    return this.cachedPromptConfig
  }

  getBotConfig(): BotConfig {
    if (this.cachedBotConfig) return this.cachedBotConfig

    this.cachedBotConfig = {
      icon: envStr('AI_REVIEWER_BOT_ICON') ?? CONFIG_DEFAULTS.botIcon,
      name: envStr('AI_REVIEWER_BOT_NAME') ?? CONFIG_DEFAULTS.botName,
      platformLogin: envStr('AI_REVIEWER_BOT_GITLAB_LOGIN') ?? ''
    }

    return this.cachedBotConfig
  }

  /**
   * 打印所有非敏感配置（ARCH-011）。
   * 不输出 OPENAI_API_KEY、GITLAB_PAT、Trigger token 等 secret。
   */

  print(log: (msg: string) => void): void {
    const opts = this.getOptions()
    const bot = this.getBotConfig()
    const prompt = this.getPromptConfig()

    // 输出安全强制覆盖警告
    for (const override of this.securityOverrides) {
      log(`  [SECURITY] ${override}`)
    }

    log(`[ConfigProvider:gitlab] Configuration:`)
    log(`  debug: ${opts.debug}`)
    log(`  disable_review: ${opts.disableReview}`)
    log(`  disable_release_notes: ${opts.disableReleaseNotes}`)
    log(`  max_files: ${opts.maxFiles}`)
    log(`  review_simple_changes: ${opts.reviewSimpleChanges}`)
    log(`  review_comment_lgtm: ${opts.reviewCommentLGTM}`)
    log(`  path_filters: ${opts.pathFilters}`)
    log(`  system_message: ${opts.systemMessage}`)
    log(`  openai_light_model: ${opts.openaiLightModel}`)
    log(`  openai_heavy_model: ${opts.openaiHeavyModel}`)
    log(`  openai_model_temperature: ${opts.openaiModelTemperature}`)
    log(`  openai_retries: ${opts.openaiRetries}`)
    log(`  openai_timeout_ms: ${opts.openaiTimeoutMS}`)
    log(`  openai_concurrency_limit: ${opts.openaiConcurrencyLimit}`)
    log(`  github_concurrency_limit: ${opts.githubConcurrencyLimit}`)
    log(`  summary_token_limits: ${opts.lightTokenLimits.string()}`)
    log(`  review_token_limits: ${opts.heavyTokenLimits.string()}`)
    log(`  api_base_url: ${opts.apiBaseUrl}`)
    log(`  language: ${opts.language}`)
    log(`  enable_dependency_analysis: ${opts.enableDependencyAnalysis}`)
    log(`  max_dependency_files: ${opts.maxDependencyFiles}`)
    log(`  enable_web_search: ${opts.enableWebSearch}`)
    log(`  enable_shell: ${opts.enableShell} (CFG-002: forced false)`)
    log(`  enable_lint_tools: ${opts.enableLintTools} (CFG-002: forced false)`)
    log(`  tool_enable_overrides: ${JSON.stringify(opts.toolEnableOverrides)}`)
    log(`  tool_version_overrides: ${JSON.stringify(opts.toolVersionOverrides)}`)
    log(`  semgrep_config: ${opts.semgrepConfig}`)
    log(`  command_ack_reaction: ${opts.commandAckReaction}`)
    log(`  max_review_comments: ${opts.maxReviewComments}`)
    log(`  bot_icon: ${bot.icon}`)
    log(`  bot_name: ${bot.name}`)
    log(`  bot_gitlab_login: ${bot.platformLogin}`)
    log(`  summarize: ${prompt.summarize ? '(custom)' : '(default)'}`)
    log(`  summarize_release_notes: ${prompt.summarizeReleaseNotes ? '(custom)' : '(default)'}`)
  }
}
