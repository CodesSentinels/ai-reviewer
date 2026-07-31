/**
 * platform/github-config-provider.ts - GitHub Action 配置提供者（ARCH-008）
 *
 * 从 @actions/core 的 getInput / getBooleanInput / getMultilineInput
 * 读取 action.yml 声明的所有 inputs，构建规范化 Options。
 *
 * 保持与现有 main.ts 完全相同的读取逻辑、默认值和类型转换行为，
 * 确保从 main.ts 切换到 GitHubConfigProvider 是无行为变更的重构。
 *
 * ARCH-011：print() 不输出 token / OpenAI Key。
 */

import {getBooleanInput, getInput, getMultilineInput} from '@actions/core'
import type {BotConfig, ConfigProvider, PromptConfig} from './config-provider'
import {validateFloatStr, validateIntStr} from './config-provider'
import type {Platform} from './execution-context'
import {Options} from '../options'

export class GitHubConfigProvider implements ConfigProvider {
  readonly platform: Platform = 'github'

  private cachedOptions: Options | null = null
  private cachedPromptConfig: PromptConfig | null = null
  private cachedBotConfig: BotConfig | null = null

  getOptions(): Options {
    if (this.cachedOptions) return this.cachedOptions

    // 工具版本覆盖：仅收集用户显式填写的值；空字符串视为"用默认版本"
    const toolVersionOverrides = Object.fromEntries(
      (
        [
          ['eslint', 'eslint_version'],
          ['biome', 'biome_version'],
          ['tsc', 'tsc_version'],
          ['prettier', 'prettier_version'],
          ['semgrep', 'semgrep_version']
        ] as const
      )
        .map(([toolName, inputName]) => [toolName, getInput(inputName).trim()])
        .filter(([, v]) => v.length > 0)
    )

    const P = 'github' as const
    this.cachedOptions = new Options(
      getBooleanInput('debug'),
      getBooleanInput('disable_review'),
      getBooleanInput('disable_release_notes'),
      validateIntStr(getInput('max_files'), P, 'max_files'),
      getBooleanInput('review_simple_changes'),
      getBooleanInput('review_comment_lgtm'),
      getMultilineInput('path_filters'),
      getInput('system_message'),
      getInput('openai_light_model'),
      getInput('openai_heavy_model'),
      validateFloatStr(
        getInput('openai_model_temperature'),
        P,
        'openai_model_temperature'
      ),
      validateIntStr(getInput('openai_retries'), P, 'openai_retries'),
      validateIntStr(getInput('openai_timeout_ms'), P, 'openai_timeout_ms'),
      validateIntStr(
        getInput('openai_concurrency_limit'),
        P,
        'openai_concurrency_limit'
      ),
      validateIntStr(
        getInput('github_concurrency_limit'),
        P,
        'github_concurrency_limit'
      ),
      getInput('openai_base_url'),
      getInput('language'),
      getBooleanInput('enable_dependency_analysis'),
      validateIntStr(
        getInput('max_dependency_files'),
        P,
        'max_dependency_files'
      ),
      getBooleanInput('enable_web_search'),
      getBooleanInput('enable_shell'),
      getBooleanInput('enable_lint_tools'),
      {
        eslint: getBooleanInput('enable_eslint'),
        biome: getBooleanInput('enable_biome'),
        tsc: getBooleanInput('enable_tsc'),
        prettier: getBooleanInput('enable_prettier'),
        semgrep: getBooleanInput('enable_semgrep')
      },
      toolVersionOverrides,
      getInput('semgrep_config'),
      getInput('command_ack_reaction'),
      validateIntStr(getInput('max_review_comments'), P, 'max_review_comments'),
      validateIntStr(
        getInput('debug_resolve_inject_failures'),
        P,
        'debug_resolve_inject_failures'
      ),
      getInput('bot_icon') || '🤖',
      getInput('bot_name') || 'AI Reviewer',
      getInput('bot_github_login')
    )

    return this.cachedOptions
  }

  getPromptConfig(): PromptConfig {
    if (this.cachedPromptConfig) return this.cachedPromptConfig

    this.cachedPromptConfig = {
      summarize: getInput('summarize'),
      summarizeReleaseNotes: getInput('summarize_release_notes')
    }

    return this.cachedPromptConfig
  }

  getBotConfig(): BotConfig {
    if (this.cachedBotConfig) return this.cachedBotConfig

    this.cachedBotConfig = {
      icon: getInput('bot_icon') || '🤖',
      name: getInput('bot_name') || 'AI Reviewer',
      platformLogin: getInput('bot_github_login')
    }

    return this.cachedBotConfig
  }

  /**
   * 打印所有非敏感配置（ARCH-011）。
   * 不输出 token、OPENAI_API_KEY 等 secret。
   */
  // eslint-disable-next-line no-unused-vars
  print(log: (msg: string) => void): void {
    const opts = this.getOptions()
    const bot = this.getBotConfig()
    const prompt = this.getPromptConfig()

    log(`[ConfigProvider:github] Configuration:`)
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
    log(`  enable_shell: ${opts.enableShell}`)
    log(`  enable_lint_tools: ${opts.enableLintTools}`)
    log(`  tool_enable_overrides: ${JSON.stringify(opts.toolEnableOverrides)}`)
    log(
      `  tool_version_overrides: ${JSON.stringify(opts.toolVersionOverrides)}`
    )
    log(`  semgrep_config: ${opts.semgrepConfig}`)
    log(`  command_ack_reaction: ${opts.commandAckReaction}`)
    log(`  max_review_comments: ${opts.maxReviewComments}`)
    log(`  bot_icon: ${bot.icon}`)
    log(`  bot_name: ${bot.name}`)
    log(`  bot_github_login: ${bot.platformLogin}`)
    log(`  summarize: ${prompt.summarize ? '(custom)' : '(default)'}`)
    log(
      `  summarize_release_notes: ${
        prompt.summarizeReleaseNotes ? '(custom)' : '(default)'
      }`
    )
  }
}
