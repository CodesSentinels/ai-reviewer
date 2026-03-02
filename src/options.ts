/**
 * options.ts - 配置管理模块
 *
 * 包含三个核心类：
 * - Options: 解析并存储所有 GitHub Action 输入参数
 * - PathFilter: 基于 minimatch glob 模式的文件路径过滤器（! 前缀表示排除）
 * - OpenAIOptions: OpenAI 模型配置（模型名称 + Token 限制）
 */

import {info} from '@actions/core'
import {minimatch} from 'minimatch'
import {TokenLimits} from './limits'

/**
 * Options 类 - GitHub Action 全局配置
 *
 * 从 Action 输入参数中解析所有配置项，包括：
 * - 功能开关（debug、禁用审查、禁用发布说明等）
 * - 模型配置（轻量/重量模型、温度、重试次数、超时等）
 * - 并发控制（OpenAI API 和 GitHub API 的并发限制）
 * - 文件过滤（基于 glob 模式的路径过滤器）
 */
export class Options {
  debug: boolean                    // 调试模式开关
  disableReview: boolean            // 禁用代码审查
  disableReleaseNotes: boolean      // 禁用发布说明生成
  maxFiles: number                  // 最大处理文件数(0=不限)
  reviewSimpleChanges: boolean      // 是否审查简单变更(跳过triage分类)
  reviewCommentLGTM: boolean        // 是否在审查中保留 LGTM 评论
  pathFilters: PathFilter           // 文件路径过滤器
  systemMessage: string             // OpenAI 系统提示消息
  openaiLightModel: string          // 轻量模型名称(用于摘要)
  openaiHeavyModel: string          // 重量模型名称(用于审查)
  openaiModelTemperature: number    // 模型温度(0=确定性, 1=随机性)
  openaiRetries: number             // API 调用失败重试次数
  openaiTimeoutMS: number           // API 调用超时(毫秒)
  openaiConcurrencyLimit: number    // OpenAI 并发请求上限
  githubConcurrencyLimit: number    // GitHub API 并发请求上限
  lightTokenLimits: TokenLimits     // 轻量模型的 Token 限制
  heavyTokenLimits: TokenLimits     // 重量模型的 Token 限制
  apiBaseUrl: string                // OpenAI API 基础 URL
  language: string                  // 响应语言 ISO 代码

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

  /** 将所有配置选项输出到 GitHub Action 日志 */
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

  /** 检查文件路径是否通过过滤规则（true=应审查, false=跳过） */
  checkPath(path: string): boolean {
    const ok = this.pathFilters.check(path)
    info(`checking path: ${path} => ${ok}`)
    return ok
  }
}

/**
 * PathFilter 类 - 文件路径过滤器
 *
 * 基于 minimatch glob 模式过滤文件路径。规则格式：
 * - "src/**" → 包含匹配的文件
 * - "!*.test.ts" → 排除匹配的文件（! 前缀）
 *
 * 逻辑：如果存在包含规则，文件必须匹配至少一个包含规则；
 *       如果文件匹配任何排除规则，则被过滤掉。
 */
export class PathFilter {
  private readonly rules: Array<[string /* rule */, boolean /* exclude */]>

  /** 解析过滤规则列表，! 前缀表示排除规则 */
  constructor(rules: string[] | null = null) {
    this.rules = []
    if (rules != null) {
      for (const rule of rules) {
        const trimmed = rule?.trim()
        if (trimmed) {
          if (trimmed.startsWith('!')) {
            this.rules.push([trimmed.substring(1).trim(), true])
          } else {
            this.rules.push([trimmed, false])
          }
        }
      }
    }
  }

  /**
   * 检查路径是否通过过滤规则
   * @returns true=通过(应处理), false=被过滤(应跳过)
   *
   * 规则逻辑：
   * - 无规则时默认通过
   * - 有包含规则时，必须匹配至少一个包含规则
   * - 匹配任何排除规则则被拒绝（排除优先于包含）
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

    // 包含规则不存在或匹配，且未被排除规则命中
    return (!inclusionRuleExists || included) && !excluded
  }
}

/** OpenAI 模型配置 - 封装模型名称和对应的 Token 限制 */
export class OpenAIOptions {
  model: string
  tokenLimits: TokenLimits

  constructor(model = 'gpt-3.5-turbo', tokenLimits: TokenLimits | null = null) {
    this.model = model
    if (tokenLimits != null) {
      this.tokenLimits = tokenLimits
    } else {
      this.tokenLimits = new TokenLimits(model)
    }
  }
}
