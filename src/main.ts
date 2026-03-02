/**
 * main.ts - GitHub Action 入口文件
 *
 * 整个 AI PR Reviewer 的启动入口。主要职责：
 * 1. 从 GitHub Action 输入参数中读取所有配置
 * 2. 初始化两个 OpenAI Bot 实例（lightBot 用于摘要，heavyBot 用于深度审查）
 * 3. 根据 GitHub 事件类型，将任务分发到对应的处理函数
 *
 * 支持的事件：
 * - pull_request / pull_request_target → 代码审查 (codeReview)
 * - pull_request_review_comment → 评论回复 (handleReviewComment)
 */

import {
  getBooleanInput,
  getInput,
  getMultilineInput,
  setFailed,
  warning
} from '@actions/core'
import {Bot} from './bot'
import {OpenAIOptions, Options} from './options'
import {Prompts} from './prompts'
import {codeReview} from './review'
import {handleReviewComment} from './review-comment'

/** 主运行函数 - 解析输入、初始化 Bot、分发事件处理 */
async function run(): Promise<void> {
  // 步骤1: 从 GitHub Action 输入中读取所有配置参数，构建 Options 对象
  const options: Options = new Options(
    getBooleanInput('debug'),                 // 是否启用调试日志
    getBooleanInput('disable_review'),        // 是否禁用代码审查
    getBooleanInput('disable_release_notes'), // 是否禁用发布说明生成
    getInput('max_files'),                    // 最大处理文件数(0=不限)
    getBooleanInput('review_simple_changes'), // 是否审查简单变更(跳过triage)
    getBooleanInput('review_comment_lgtm'),   // 是否保留 LGTM 评论
    getMultilineInput('path_filters'),        // 文件路径过滤规则(glob模式)
    getInput('system_message'),               // OpenAI 系统提示消息
    getInput('openai_light_model'),           // 轻量模型(用于摘要)
    getInput('openai_heavy_model'),           // 重量模型(用于审查)
    getInput('openai_model_temperature'),     // 模型温度参数
    getInput('openai_retries'),               // API 重试次数
    getInput('openai_timeout_ms'),            // API 超时(毫秒)
    getInput('openai_concurrency_limit'),     // OpenAI 并发限制
    getInput('github_concurrency_limit'),     // GitHub API 并发限制
    getInput('openai_base_url'),              // OpenAI API 基础URL
    getInput('language')                      // 响应语言(ISO代码)
  )

  // 步骤2: 打印配置到 Action 日志
  options.print()

  // 步骤3: 构建提示词模板（支持用户自定义摘要和发布说明的提示词）
  const prompts: Prompts = new Prompts(
    getInput('summarize'),
    getInput('summarize_release_notes')
  )

  // 步骤4: 创建两个 Bot 实例
  // lightBot - 轻量模型，负责文件变更摘要和 triage 分类(NEEDS_REVIEW/APPROVED)
  let lightBot: Bot | null = null
  try {
    lightBot = new Bot(
      options,
      new OpenAIOptions(options.openaiLightModel, options.lightTokenLimits)
    )
  } catch (e: any) {
    warning(
      `Skipped: failed to create summary bot, please check your openai_api_key: ${e}, backtrace: ${e.stack}`
    )
    return
  }

  // heavyBot - 重量模型，负责深度代码审查、汇总摘要和评论回复
  let heavyBot: Bot | null = null
  try {
    heavyBot = new Bot(
      options,
      new OpenAIOptions(options.openaiHeavyModel, options.heavyTokenLimits)
    )
  } catch (e: any) {
    warning(
      `Skipped: failed to create review bot, please check your openai_api_key: ${e}, backtrace: ${e.stack}`
    )
    return
  }

  // 步骤5: 根据 GitHub 事件类型分发到对应的处理逻辑
  try {
    if (
      process.env.GITHUB_EVENT_NAME === 'pull_request' ||
      process.env.GITHUB_EVENT_NAME === 'pull_request_target'
    ) {
      // PR 创建/更新事件 → 执行完整代码审查(摘要+审查+发布说明)
      await codeReview(lightBot, heavyBot, options, prompts)
    } else if (
      process.env.GITHUB_EVENT_NAME === 'pull_request_review_comment'
    ) {
      // PR 评论事件 → 处理用户与 Bot 的对话交互
      await handleReviewComment(heavyBot, options, prompts)
    } else {
      warning('Skipped: this action only works on push events or pull_request')
    }
  } catch (e: any) {
    if (e instanceof Error) {
      setFailed(`Failed to run: ${e.message}, backtrace: ${e.stack}`)
    } else {
      setFailed(`Failed to run: ${e}, backtrace: ${e.stack}`)
    }
  }
}

// 全局异常处理：防止 Action 静默失败
process
  .on('unhandledRejection', (reason, p) => {
    warning(`Unhandled Rejection at Promise: ${reason}, promise is ${p}`)
  })
  .on('uncaughtException', (e: any) => {
    warning(`Uncaught Exception thrown: ${e}, backtrace: ${e.stack}`)
  })

// 启动入口
await run()
