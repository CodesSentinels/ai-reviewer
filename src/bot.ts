/**
 * bot.ts - OpenAI API 封装层
 *
 * 封装与 OpenAI API 的通信逻辑，提供：
 * 1. 基于官方 openai SDK 的 Responses API 客户端
 * 2. 带重试机制的消息发送（通过 p-retry）
 * 3. 多轮对话支持（通过 previous_response_id 维护上下文）
 * 4. 系统消息构建（包含知识截止日期、当前日期、语言设置）
 * 5. 可选的 web search 工具支持（用于验证 API 用法）
 */

import {info, setFailed, warning} from '@actions/core'
import OpenAI, {APIError} from 'openai'
import pRetry from 'p-retry'
import {OpenAIOptions, Options} from './options'

/**
 * 对话 ID 接口，用于维护多轮对话的上下文关系
 * previousResponseId: 上一次响应的 ID，用于 Responses API 的对话链
 */
export interface Ids {
  previousResponseId?: string
}

/**
 * Bot 类 - AI 对话机器人
 *
 * 封装 OpenAI Responses API，提供带错误处理和重试的对话能力。
 * 每个 Bot 实例对应一个特定的模型配置（轻量模型或重量模型）。
 */
export class Bot {
  private readonly client: OpenAI | null = null // OpenAI API 客户端实例
  private readonly model: string // 模型名称
  private readonly systemMessage: string // 系统消息
  private readonly temperature: number // 温度参数
  private readonly maxOutputTokens: number // 最大输出 token 数
  private readonly enableWebSearch: boolean // 是否启用 web search

  private readonly options: Options // 全局配置选项

  constructor(options: Options, openaiOptions: OpenAIOptions) {
    this.options = options
    this.model = openaiOptions.model
    this.temperature = options.openaiModelTemperature
    this.maxOutputTokens = openaiOptions.tokenLimits.responseTokens
    this.enableWebSearch = openaiOptions.enableWebSearch

    if (process.env.OPENAI_API_KEY) {
      // 构建系统消息：包含自定义系统消息 + 知识截止日期 + 当前日期 + 语言要求
      const currentDate = new Date().toISOString().split('T')[0]
      this.systemMessage = `${options.systemMessage}
Knowledge cutoff: ${openaiOptions.tokenLimits.knowledgeCutOff}
Current date: ${currentDate}

IMPORTANT: Entire response must be in the language with ISO code: ${options.language}
`

      // 初始化 OpenAI API 客户端
      this.client = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        organization: process.env.OPENAI_API_ORG ?? undefined,
        baseURL: options.apiBaseUrl,
        timeout: options.openaiTimeoutMS,
        maxRetries: 0 // 使用 pRetry 自行管理重试
      })
    } else {
      const err =
        "Unable to initialize the OpenAI API, both 'OPENAI_API_KEY' environment variable are not available"
      throw new Error(err)
    }
  }

  /**
   * 发送消息到 OpenAI API（公开方法，带错误捕获）
   * @param message - 要发送的消息内容
   * @param ids - 对话上下文 ID（用于多轮对话）
   * @returns [响应文本, 新的对话 ID] 元组
   */
  chat = async (message: string, ids: Ids): Promise<[string, Ids]> => {
    let res: [string, Ids] = ['', {}]
    try {
      res = await this.chat_(message, ids)
      return res
    } catch (e: unknown) {
      if (e instanceof APIError) {
        warning(`Failed to chat: ${e}, backtrace: ${e.stack}`)
      }
      return res
    }
  }

  /**
   * 发送消息到 OpenAI API（私有方法，包含实际的 API 调用逻辑）
   *
   * 流程：
   * 1. 检查消息是否为空
   * 2. 构建 Responses API 请求参数（包含 web search 工具配置）
   * 3. 通过 pRetry 发送消息（自动重试失败的请求）
   * 4. 记录响应时间和内容
   * 5. 从响应输出中提取文本
   * 6. 返回响应文本和新的对话 ID
   */
  private readonly chat_ = async (
    message: string,
    ids: Ids
  ): Promise<[string, Ids]> => {
    // 记录请求开始时间，用于计算响应耗时
    const start = Date.now()
    if (!message) {
      return ['', {}]
    }

    if (this.client != null) {
      // 构建工具列表（可选启用 web search）
      const tools: OpenAI.Responses.Tool[] = []
      if (this.enableWebSearch) {
        tools.push({type: 'web_search'})
      }

      // 构建 Responses API 请求参数
      const params: OpenAI.Responses.ResponseCreateParams = {
        model: this.model,
        instructions: this.systemMessage,
        input: message,
        temperature: this.temperature,
        max_output_tokens: this.maxOutputTokens,
        ...(tools.length > 0 && {tools}),
        ...(ids.previousResponseId && {
          previous_response_id: ids.previousResponseId
        })
      }

      let response: OpenAI.Responses.Response | undefined
      try {
        // 使用 pRetry 发送消息，失败时自动重试（重试次数由配置决定）
        response = await pRetry(() => this.client!.responses.create(params), {
          retries: this.options.openaiRetries
        })
      } catch (e: unknown) {
        if (e instanceof APIError) {
          info(
            `response: ${response}, failed to send message to openai: ${e}, backtrace: ${e.stack}`
          )
        }
      }

      // 记录响应时间
      const end = Date.now()
      info(`response: ${JSON.stringify(response)}`)
      info(
        `openai sendMessage (including retries) response time: ${
          end - start
        } ms`
      )

      // 从响应输出中提取文本，并记录 web_search 和 reasoning 信息
      let responseText = ''
      if (response?.output) {
        for (const item of response.output) {
          if (item.type === 'web_search_call') {
            info(`[web_search] executed, id: ${(item as any).id}, status: ${(item as any).status}`)
          }
          if (item.type === 'message') {
            for (const content of item.content) {
              if (content.type === 'output_text') {
                responseText += content.text
              }
              if ((content as any).type === 'reasoning') {
                info(`[reasoning] model thinking: ${JSON.stringify(content)}`)
              }
            }
          }
        }
      } else {
        warning('openai response is null')
      }

      // 移除响应中可能存在的多余前缀 "with "
      if (responseText.startsWith('with ')) {
        responseText = responseText.substring(5)
      }
      if (this.options.debug) {
        info(`openai responses: ${responseText}`)
      }

      // 构建新的对话 ID，用于后续多轮对话
      const newIds: Ids = {
        previousResponseId: response?.id
      }
      return [responseText, newIds]
    } else {
      setFailed('The OpenAI API is not initialized')
    }

    return ['', {}]
  }
}
