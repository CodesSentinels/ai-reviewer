/**
 * options.ts - 配置管理模块
 *
 * 包含三个核心类：
 * - Options: 全局配置类，读取并存储所有 GitHub Action 输入参数
 * - PathFilter: 文件路径过滤器，根据 glob 规则决定哪些文件需要审查
 * - OpenAIOptions: OpenAI 模型配置，关联模型名称与其 token 限制
 */
import {info} from '@actions/core'
import {minimatch} from 'minimatch'
import {TokenLimits} from './limits'

/**
 * Options 类 - 全局配置
 *
 * 从 GitHub Action 输入参数中读取所有配置项，并解析为对应的类型。
 * 同时根据模型名称自动初始化轻量模型和重量模型的 token 限制。
 */
export class Options {
  debug: boolean                  // 是否开启调试模式
  disableReview: boolean          // 是否禁用代码审查
  disableReleaseNotes: boolean    // 是否禁用发布说明生成
  maxFiles: number                // 最大处理文件数（0 表示不限制）
  reviewSimpleChanges: boolean    // 是否审查简单变更（false 时启用分类筛选）
  reviewCommentLGTM: boolean      // 是否保留 LGTM 评论
  pathFilters: PathFilter         // 文件路径过滤规则
  systemMessage: string           // AI 系统消息（定义角色和行为）
  openaiLightModel: string        // 轻量模型名称（用于摘要）
  openaiHeavyModel: string        // 重量模型名称（用于代码审查）
  openaiModelTemperature: number  // 模型温度参数（控制随机性）
  openaiRetries: number           // API 请求失败重试次数
  openaiTimeoutMS: number         // API 请求超时时间（毫秒）
  openaiConcurrencyLimit: number  // OpenAI API 并发请求数限制
  githubConcurrencyLimit: number  // GitHub API 并发请求数限制
  lightTokenLimits: TokenLimits   // 轻量模型的 token 限制
  heavyTokenLimits: TokenLimits   // 重量模型的 token 限制
  apiBaseUrl: string              // OpenAI API 基础 URL
  language: string                // 响应语言（ISO 语言代码）

  constructor(
    debug: boolean,
    disableReview: boolean,
    disableReleaseNotes: boolean,
    maxFiles = '0',
    reviewSimpleChanges = false,
    reviewCommentLGTM = false,
    pathFilters: string[] | null = null,
    systemMessage = '',
    openaiLightModel = 'gpt-3.5-turbo',
    openaiHeavyModel = 'gpt-3.5-turbo',
    openaiModelTemperature = '0.0',
    openaiRetries = '3',
    openaiTimeoutMS = '120000',
    openaiConcurrencyLimit = '6',
    githubConcurrencyLimit = '6',
    apiBaseUrl = 'https://api.openai.com/v1',
    language = 'en-US'
  ) {
    this.debug = debug
    this.disableReview = disableReview
    this.disableReleaseNotes = disableReleaseNotes
    this.maxFiles = parseInt(maxFiles)
    this.reviewSimpleChanges = reviewSimpleChanges
    this.reviewCommentLGTM = reviewCommentLGTM
    this.pathFilters = new PathFilter(pathFilters)
    this.systemMessage = systemMessage
    this.openaiLightModel = openaiLightModel
    this.openaiHeavyModel = openaiHeavyModel
    this.openaiModelTemperature = parseFloat(openaiModelTemperature)
    this.openaiRetries = parseInt(openaiRetries)
    this.openaiTimeoutMS = parseInt(openaiTimeoutMS)
    this.openaiConcurrencyLimit = parseInt(openaiConcurrencyLimit)
    this.githubConcurrencyLimit = parseInt(githubConcurrencyLimit)
    this.lightTokenLimits = new TokenLimits(openaiLightModel)
    this.heavyTokenLimits = new TokenLimits(openaiHeavyModel)
    this.apiBaseUrl = apiBaseUrl
    this.language = language
  }

  /** 打印所有配置项到日志，方便调试 */
  print(): void {
    info(`debug: ${this.debug}`)
    info(`disable_review: ${this.disableReview}`)
    info(`disable_release_notes: ${this.disableReleaseNotes}`)
    info(`max_files: ${this.maxFiles}`)
    info(`review_simple_changes: ${this.reviewSimpleChanges}`)
    info(`review_comment_lgtm: ${this.reviewCommentLGTM}`)
    info(`path_filters: ${this.pathFilters}`)
    info(`system_message: ${this.systemMessage}`)
    info(`openai_light_model: ${this.openaiLightModel}`)
    info(`openai_heavy_model: ${this.openaiHeavyModel}`)
    info(`openai_model_temperature: ${this.openaiModelTemperature}`)
    info(`openai_retries: ${this.openaiRetries}`)
    info(`openai_timeout_ms: ${this.openaiTimeoutMS}`)
    info(`openai_concurrency_limit: ${this.openaiConcurrencyLimit}`)
    info(`github_concurrency_limit: ${this.githubConcurrencyLimit}`)
    info(`summary_token_limits: ${this.lightTokenLimits.string()}`)
    info(`review_token_limits: ${this.heavyTokenLimits.string()}`)
    info(`api_base_url: ${this.apiBaseUrl}`)
    info(`language: ${this.language}`)
  }

  /**
   * 检查文件路径是否通过过滤规则
   * @param path - 文件路径
   * @returns true 表示该文件需要处理，false 表示跳过
   */
  checkPath(path: string): boolean {
    const ok = this.pathFilters.check(path)
    info(`checking path: ${path} => ${ok}`)
    return ok
  }
}

/**
 * PathFilter 类 - 文件路径过滤器
 *
 * 基于 glob 模式匹配的文件过滤器。
 * 规则格式：
 * - 普通规则（如 "src/**"）：包含匹配的文件
 * - 排除规则（以 "!" 开头，如 "!dist/**"）：排除匹配的文件
 *
 * 过滤逻辑：
 * - 如果没有任何规则，允许所有文件
 * - 如果存在包含规则，文件必须匹配至少一个包含规则
 * - 如果文件匹配任何排除规则，则被排除
 */
export class PathFilter {
  private readonly rules: Array<[string /* 规则模式 */, boolean /* 是否为排除规则 */]>

  constructor(rules: string[] | null = null) {
    this.rules = []
    if (rules != null) {
      for (const rule of rules) {
        const trimmed = rule?.trim()
        if (trimmed) {
          if (trimmed.startsWith('!')) {
            // "!" 开头的规则为排除规则
            this.rules.push([trimmed.substring(1).trim(), true])
          } else {
            // 普通规则为包含规则
            this.rules.push([trimmed, false])
          }
        }
      }
    }
  }

  /**
   * 检查路径是否通过过滤
   * @param path - 待检查的文件路径
   * @returns true 表示通过（文件需要处理），false 表示被过滤掉
   */
  check(path: string): boolean {
    if (this.rules.length === 0) {
      return true
    }

    let included = false
    let excluded = false
    let inclusionRuleExists = false

    for (const [rule, exclude] of this.rules) {
      if (minimatch(path, rule)) {
        if (exclude) {
          excluded = true
        } else {
          included = true
        }
      }
      if (!exclude) {
        inclusionRuleExists = true
      }
    }

    // 通过条件：（不存在包含规则 或 匹配了包含规则）且 未被排除
    return (!inclusionRuleExists || included) && !excluded
  }
}

/**
 * OpenAIOptions 类 - OpenAI 模型配置
 *
 * 将模型名称与其对应的 token 限制关联在一起。
 * 用于创建 Bot 实例时传入模型配置。
 */
export class OpenAIOptions {
  model: string            // 模型名称（如 "gpt-4"、"gpt-3.5-turbo"）
  tokenLimits: TokenLimits // 该模型的 token 限制配置

  constructor(model = 'gpt-3.5-turbo', tokenLimits: TokenLimits | null = null) {
    this.model = model
    if (tokenLimits != null) {
      this.tokenLimits = tokenLimits
    } else {
      this.tokenLimits = new TokenLimits(model)
    }
  }
}
