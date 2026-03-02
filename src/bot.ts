/**
 * bot.ts - OpenAI ChatGPT API 封装层
 *
 * 封装了与 OpenAI API 的所有交互逻辑：
 * 1. 初始化 ChatGPTAPI 客户端（模型、Token 限制、系统消息等）
 * 2. 提供带自动重试(p-retry)的 chat() 方法
 * 3. 管理对话上下文状态（parentMessageId / conversationId）
 *
 * 系统中创建两个 Bot 实例：
 * - lightBot: 轻量模型 → 文件摘要和 triage 分类
 * - heavyBot: 重量模型 → 深度代码审查和最终汇总
 */

import './fetch-polyfill'

import {info, setFailed, warning} from '@actions/core'
import {
  ChatGPTAPI,
  ChatGPTError,
  ChatMessage,
  SendMessageOptions
  // eslint-disable-next-line import/no-unresolved
} from 'chatgpt'
import pRetry from 'p-retry'
import {OpenAIOptions, Options} from './options'

/** 对话状态标识，用于维持多轮对话的上下文关联 */
export interface Ids {
  parentMessageId?: string
  conversationId?: string
}

/**
 * Bot 类 - OpenAI API 的核心封装
 *
 * 使用 chatgpt 库与 OpenAI API 通信，支持：
 * - 自定义系统消息（包含知识截止日期、当前日期、响应语言）
 * - Token 限制管理（maxModelTokens / maxResponseTokens）
 * - 自动重试机制（通过 p-retry 实现）
 * - 超时控制
 */
export class Bot {
  private readonly api: ChatGPTAPI | null = null

  private readonly options: Options

  /**
   * 构造函数 - 初始化 ChatGPT API 客户端
   * @param options - 全局配置选项
   * @param openaiOptions - 模型特定配置（模型名称 + Token 限制）
   * @throws 如果 OPENAI_API_KEY 环境变量缺失则抛出异常
   */
  constructor(options: Options, openaiOptions: OpenAIOptions) {
    this.options = options
    if (process.env.OPENAI_API_KEY) {
      // 构建系统消息：包含用户自定义消息 + 知识截止日期 + 当前日期 + 语言要求
      const currentDate = new Date().toISOString().split('T')[0]
      const systemMessage = `${options.systemMessage}
Knowledge cutoff: ${openaiOptions.tokenLimits.knowledgeCutOff}
Current date: ${currentDate}

IMPORTANT: Entire response must be in the language with ISO code: ${options.language}
`

      // 初始化 ChatGPT API 实例
      this.api = new ChatGPTAPI({
        apiBaseUrl: options.apiBaseUrl,
        systemMessage,
        apiKey: process.env.OPENAI_API_KEY,
        apiOrg: process.env.OPENAI_API_ORG ?? undefined,
        debug: options.debug,
        maxModelTokens: openaiOptions.tokenLimits.maxTokens,
        maxResponseTokens: openaiOptions.tokenLimits.responseTokens,
        completionParams: {
          temperature: options.openaiModelTemperature,
          model: openaiOptions.model
        }
      })
    } else {
      const err =
        "Unable to initialize the OpenAI API, both 'OPENAI_API_KEY' environment variable are not available"
      throw new Error(err)
    }
  }

  /**
   * 公开的聊天方法 - 带错误捕获的安全封装
   * @param message - 发送给 AI 的消息内容
   * @param ids - 对话状态（用于多轮对话）
   * @returns [响应文本, 新的对话状态]
   */
  chat = async (message: string, ids: Ids): Promise<[string, Ids]> => {
    let res: [string, Ids] = ['', {}]
    try {
      res = await this.chat_(message, ids)
      return res
    } catch (e: unknown) {
      if (e instanceof ChatGPTError) {
        warning(`Failed to chat: ${e}, backtrace: ${e.stack}`)
      }
      return res
    }
  }

  /**
   * 内部聊天实现 - 实际调用 OpenAI API 并处理响应
   *
   * 流程：
   * 1. 验证消息非空
   * 2. 构建请求选项（超时、父消息 ID）
   * 3. 使用 p-retry 发送消息（自动重试失败请求）
   * 4. 记录响应耗时
   * 5. 清理响应文本（移除 "with " 前缀）
   * 6. 返回响应文本和新的对话状态 ID
   */
  private readonly chat_ = async (
    message: string,
    ids: Ids
  ): Promise<[string, Ids]> => {
    const start = Date.now()
    if (!message) {
      return ['', {}]
    }

    let response: ChatMessage | undefined

    if (this.api != null) {
      // 构建发送选项：超时 + 可选的父消息 ID（用于多轮对话）
      const opts: SendMessageOptions = {
        timeoutMs: this.options.openaiTimeoutMS
      }
      if (ids.parentMessageId) {
        opts.parentMessageId = ids.parentMessageId
      }
      // 使用 p-retry 发送消息，自动重试指定次数
      try {
        response = await pRetry(() => this.api!.sendMessage(message, opts), {
          retries: this.options.openaiRetries
        })
      } catch (e: unknown) {
        if (e instanceof ChatGPTError) {
          info(
            `response: ${response}, failed to send message to openai: ${e}, backtrace: ${e.stack}`
          )
        }
      }
      const end = Date.now()
      info(`response: ${JSON.stringify(response)}`)
      info(
        `openai sendMessage (including retries) response time: ${
          end - start
        } ms`
      )
    } else {
      setFailed('The OpenAI API is not initialized')
    }

    // 提取并清理响应文本
    let responseText = ''
    if (response != null) {
      responseText = response.text
    } else {
      warning('openai response is null')
    }
    // 修正：某些情况下 API 返回的响应以 "with " 开头，需要移除
    if (responseText.startsWith('with ')) {
      responseText = responseText.substring(5)
    }
    if (this.options.debug) {
      info(`openai responses: ${responseText}`)
    }

    // 构建新的对话状态 ID，供后续多轮对话使用
    const newIds: Ids = {
      parentMessageId: response?.id,
      conversationId: response?.conversationId
    }
    return [responseText, newIds]
  }
}
