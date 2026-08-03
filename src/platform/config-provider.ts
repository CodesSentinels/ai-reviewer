/**
 * platform/config-provider.ts - 平台无关配置提供者接口（ARCH-007）
 *
 * 定义 ConfigProvider 接口和共享配置子类型。业务层通过 ConfigProvider
 * 获取规范化配置，不直接读取 `@actions/core` getInput 或 process.env。
 *
 * 平台专有实现：
 * - GitHubConfigProvider（ARCH-008）：读取 action.yml inputs
 * - GitLabConfigProvider（ARCH-009）：读取 CI variables + 事件上下文
 *
 * ARCH-011：print() 禁止输出 OpenAI Key、PAT、Trigger token 或其他 secret。
 * Secret 由各平台的认证层（octokit.ts / GitLab client）从平台认可的 secret
 * 来源单独读取，不经过 ConfigProvider。
 */

import type {Platform} from './execution-context'
import type {Options} from '../options'

/** 提示词模板配置（summarize / summarize_release_notes） */
export interface PromptConfig {
  summarize: string
  summarizeReleaseNotes: string
}

/** Bot 显示配置 */
export interface BotConfig {
  /** Bot 评论前缀图标，如 '🦉' */
  icon: string
  /** Bot 显示名称，如 'CodeSentinel' */
  name: string
  /**
   * 平台专有的 bot 登录标识。
   * - GitHub: bot_github_login（用于识别 bot 创建的 review thread）
   * - GitLab: PAT 用户名（未来由 GLAPI-022 实现）
   * 空字符串表示未配置。
   */
  platformLogin: string
}

/**
 * 平台无关配置提供者（ARCH-007）。
 *
 * 每个平台实现一个 ConfigProvider，将平台专有配置源（Action inputs / CI variables /
 * 仓库配置文件）转换为统一的 Options + PromptConfig + BotConfig。
 *
 * 设计约束（ARCH-010）：
 * - 必填字段缺失时 fail closed（抛出 ConfigError）
 * - 类型转换失败（如非数字字符串给 max_files）时 fail closed
 * - 未知字段静默忽略（允许平台新增 input 而不破坏旧版本）
 * - 两平台对相同语义字段使用相同的默认值（来自 CONFIG_DEFAULTS）
 */
export interface ConfigProvider {
  readonly platform: Platform

  /** 构建规范化的 Options 对象 */
  getOptions(): Options

  /** 获取提示词模板配置 */
  getPromptConfig(): PromptConfig

  /** 获取 Bot 显示配置 */
  getBotConfig(): BotConfig

  /**
   * 打印所有非敏感配置用于调试。
   * ARCH-011：禁止输出 OpenAI Key、GitHub Token、GitLab PAT、Trigger token。
   * @param log - 日志输出函数，解耦 @actions/core 依赖
   */

  print(log: (msg: string) => void): void
}

/**
 * 配置错误（ARCH-010 fail closed）。
 * 必填字段缺失、类型转换失败或安全约束违反时抛出。
 */
export class ConfigError extends Error {
  constructor(
    message: string,

    public readonly platform: Platform,

    public readonly field: string
  ) {
    super(message)
    this.name = 'ConfigError'
  }
}

/**
 * 跨平台共享的配置默认值（对齐 action.yml）。
 *
 * GitHubConfigProvider 通过 @actions/core 读取 action.yml 的 default 字段，
 * 天然与这些值一致。GitLabConfigProvider 在 CI variable 未设置时必须使用
 * 这里的值，避免与 Options 构造函数的旧默认值产生漂移。
 */
export const CONFIG_DEFAULTS = {
  debug: false,
  disableReview: false,
  disableReleaseNotes: false,
  maxFiles: '150',
  reviewSimpleChanges: false,
  reviewCommentLGTM: false,
  /** 对齐 action.yml path_filters 默认值：排除 dist/二进制/生成/图片等 */
  pathFilters: [
    '!dist/**',
    '!**/*.app',
    '!**/*.bin',
    '!**/*.bz2',
    '!**/*.class',
    '!**/*.db',
    '!**/*.csv',
    '!**/*.tsv',
    '!**/*.dat',
    '!**/*.dll',
    '!**/*.dylib',
    '!**/*.egg',
    '!**/*.glif',
    '!**/*.gz',
    '!**/*.xz',
    '!**/*.zip',
    '!**/*.7z',
    '!**/*.rar',
    '!**/*.zst',
    '!**/*.ico',
    '!**/*.jar',
    '!**/*.tar',
    '!**/*.war',
    '!**/*.lo',
    '!**/*.log',
    '!**/*.mp3',
    '!**/*.wav',
    '!**/*.wma',
    '!**/*.mp4',
    '!**/*.avi',
    '!**/*.mkv',
    '!**/*.wmv',
    '!**/*.m4a',
    '!**/*.m4v',
    '!**/*.3gp',
    '!**/*.3g2',
    '!**/*.rm',
    '!**/*.mov',
    '!**/*.flv',
    '!**/*.iso',
    '!**/*.swf',
    '!**/*.flac',
    '!**/*.nar',
    '!**/*.o',
    '!**/*.ogg',
    '!**/*.otf',
    '!**/*.p',
    '!**/*.pdf',
    '!**/*.doc',
    '!**/*.docx',
    '!**/*.xls',
    '!**/*.xlsx',
    '!**/*.ppt',
    '!**/*.pptx',
    '!**/*.pkl',
    '!**/*.pickle',
    '!**/*.pyc',
    '!**/*.pyd',
    '!**/*.pyo',
    '!**/*.pub',
    '!**/*.pem',
    '!**/*.rkt',
    '!**/*.so',
    '!**/*.ss',
    '!**/*.eot',
    '!**/*.exe',
    '!**/*.pb.go',
    '!**/*.lock',
    '!**/*.ttf',
    '!**/*.yaml',
    '!**/*.yml',
    '!**/*.cfg',
    '!**/*.toml',
    '!**/*.ini',
    '!**/*.mod',
    '!**/*.sum',
    '!**/*.work',
    '!**/*.json',
    '!**/*.mmd',
    '!**/*.svg',
    '!**/*.jpeg',
    '!**/*.jpg',
    '!**/*.png',
    '!**/*.gif',
    '!**/*.bmp',
    '!**/*.tiff',
    '!**/*.webm',
    '!**/*.woff',
    '!**/*.woff2',
    '!**/*.dot',
    '!**/*.md5sum',
    '!**/*.wasm',
    '!**/*.snap',
    '!**/*.parquet',
    '!**/gen/**',
    '!**/_gen/**',
    '!**/generated/**',
    '!**/@generated/**',
    '!**/vendor/**',
    '!**/*.min.js',
    '!**/*.min.js.map',
    '!**/*.min.js.css',
    '!**/*.tfstate',
    '!**/*.tfstate.backup'
  ],
  systemMessage: `You are \`@ai-reviewer\` (aka \`github-actions[bot]\`), a language model
trained by OpenAI. Your purpose is to act as a highly experienced
software engineer and provide a thorough review of the code hunks
and suggest code snippets to improve key areas such as:
  - Logic
  - Security
  - Performance
  - Data races
  - Consistency
  - Error handling
  - Maintainability
  - Modularity
  - Complexity
  - Optimization
  - Best practices: DRY, SOLID, KISS

Do not comment on minor code style issues, missing
comments/documentation. Identify and resolve significant
concerns to improve overall code quality while deliberately
disregarding minor issues.`,
  openaiLightModel: 'gpt-5.4-nano',
  openaiHeavyModel: 'gpt-5.4-mini',
  openaiModelTemperature: '0.0',
  openaiRetries: '5',
  openaiTimeoutMS: '360000',
  openaiConcurrencyLimit: '4',
  githubConcurrencyLimit: '4',
  apiBaseUrl: 'https://api.openai.com/v1',
  language: 'zh-CN',
  enableDependencyAnalysis: true,
  maxDependencyFiles: '50',
  enableWebSearch: true,
  enableShell: true,
  enableLintTools: true,
  semgrepVersion: '^1.95.0',
  semgrepConfig: 'p/default',
  commandAckReaction: 'rocket',
  maxReviewComments: '20',
  debugResolveInjectFailures: '0',
  botIcon: '🦉',
  botName: 'CodeSentinel',
  summarize: `Provide your final response in markdown with the following content:

- **Walkthrough**: A high-level summary of the overall change instead of
  specific files within 80 words.
- **Changes**: A markdown table of files and their summaries. Group files
  with similar changes together into a single row to save space.

Avoid additional commentary as this summary will be added as a comment on the
GitHub pull request. Use the titles "Walkthrough" and "Changes" and they must be H2.`,
  summarizeReleaseNotes: `Craft concise release notes for the pull request.
Focus on the purpose and user impact, categorizing changes as "New Feature", "Bug Fix",
"Documentation", "Refactor", "Style", "Test", "Chore", or "Revert". Provide a bullet-point list,
e.g., "- New Feature: Added search functionality to the UI". Limit your response to 50-100 words
and emphasize features visible to the end-user while omitting code-level details.`
} as const

/**
 * 校验整数字符串（ARCH-010 fail closed）。
 * 拒绝 NaN、Infinity、浮点数、科学计数法（1e3 → parseInt=1，不符合语义）。
 */
export function validateIntStr(
  value: string,
  platform: Platform,
  field: string
): string {
  const trimmed = value.trim()
  if (trimmed === '') {
    throw new ConfigError(
      `Empty value for integer field ${field}`,
      platform,
      field
    )
  }
  if (!/^-?\d+$/.test(trimmed)) {
    throw new ConfigError(
      `Invalid integer value for ${field}: "${value}"`,
      platform,
      field
    )
  }
  return trimmed
}

/**
 * 校验浮点数字符串（ARCH-010 fail closed）。
 * 允许小数点，拒绝 NaN、Infinity、科学计数法。
 */
export function validateFloatStr(
  value: string,
  platform: Platform,
  field: string
): string {
  const trimmed = value.trim()
  if (trimmed === '') {
    throw new ConfigError(
      `Empty value for numeric field ${field}`,
      platform,
      field
    )
  }
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new ConfigError(
      `Invalid numeric value for ${field}: "${value}"`,
      platform,
      field
    )
  }
  return trimmed
}
