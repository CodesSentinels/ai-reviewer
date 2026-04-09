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
import {execSync} from 'child_process'
import OpenAI, {APIError} from 'openai'
import pRetry from 'p-retry'
import {OpenAIOptions, Options} from './options'

/** shell 命令执行的最大输出长度（字符数） */
const SHELL_MAX_OUTPUT_LENGTH = 4096
/** shell 命令执行的超时时间（毫秒） */
const SHELL_TIMEOUT_MS = 30000
/** 单次分析链中允许的最大 shell 调用轮数 */
const SHELL_MAX_ROUNDS = 10
/** 只允许执行的只读命令白名单前缀 */
const SHELL_ALLOWED_COMMANDS = [
  'rg ',
  'grep ',
  'find ',
  'cat ',
  'head ',
  'tail ',
  'wc ',
  'ls ',
  'tree ',
  'file ',
  'stat ',
  'du ',
  'fd ',
  'echo ',
  'pwd'
]

/**
 * 检查 shell 命令是否在安全白名单中（只读命令）
 * 只允许单个命令或通过管道 | 连接的只读命令，禁止 &&、||、; 等链式操作符
 */
function isCommandAllowed(command: string): boolean {
  const trimmed = command.trim()
  // 先拦截所有链式操作符（&& || ; 后台 &）——只允许 | 管道
  if (/&&|\|\||;|(?<!\|)&(?!\|)/.test(trimmed)) return false
  // 按管道分段，每段都必须以白名单命令开头
  const parts = trimmed.split('|').map(p => p.trim())
  return parts.every(part =>
    SHELL_ALLOWED_COMMANDS.some(prefix => part.startsWith(prefix))
  )
}

/**
 * 在指定工作目录下执行 shell 命令，返回 stdout/stderr/exitCode
 */
function executeShellCommand(
  command: string,
  cwd: string
): {stdout: string; stderr: string; exitCode: number; timedOut: boolean} {
  try {
    const stdout = execSync(command, {
      cwd,
      timeout: SHELL_TIMEOUT_MS,
      maxBuffer: 1024 * 1024, // 1MB
      encoding: 'utf8',
      shell: '/bin/sh'
    })
    return {
      stdout: stdout.substring(0, SHELL_MAX_OUTPUT_LENGTH),
      stderr: '',
      exitCode: 0,
      timedOut: false
    }
  } catch (e: any) {
    if (e.killed) {
      return {
        stdout: (e.stdout ?? '').substring(0, SHELL_MAX_OUTPUT_LENGTH),
        stderr: 'Command timed out',
        exitCode: 124,
        timedOut: true
      }
    }
    const stderr: string = (e.stderr ?? '').substring(0, 1024)
    const stdout: string = (e.stdout ?? '').substring(0, SHELL_MAX_OUTPUT_LENGTH)

    // 路径不存在时，搜索相似文件名给模型提示正确路径
    const noSuchFile = stderr.match(/cannot open '?([^':]+)'?.*No such file|No such file.*'([^']+)'/)
    if (noSuchFile != null) {
      const badPath = (noSuchFile[1] ?? noSuchFile[2] ?? '').trim()
      const basename = badPath.split('/').pop() ?? ''
      if (basename) {
        try {
          const similar = execSync(
            `find . -type f -name "${basename}" -not -path "./.git/*" -not -path "./node_modules/*" -not -path "./dist/*"`,
            {cwd, encoding: 'utf8', timeout: 5000, shell: '/bin/sh'}
          ).trim()
          const hint = similar
            ? `Hint: '${badPath}' not found. Correct path(s): ${similar.split('\n').map(p => p.replace(/^\.\//, '')).join(', ')}`
            : `Hint: '${badPath}' not found and no file with that name exists in this repo.`
          return {stdout, stderr: `${stderr}\n${hint}`, exitCode: e.status ?? 1, timedOut: false}
        } catch { /* ignore */ }
      }
    }

    return {stdout, stderr, exitCode: e.status ?? 1, timedOut: false}
  }
}

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
   * 带 shell 工具的对话方法（用于分析链）
   *
   * 模型可以发出 shell_call 请求来探索代码仓库，
   * 我们在本地执行命令并返回结果，形成多轮交互循环。
   * 最终返回模型的文本响应和所有执行过的命令记录（用于展示分析链）。
   *
   * @param message - 要发送的消息内容
   * @param cwd - shell 命令的工作目录（仓库根目录）
   * @returns [响应文本, 分析链记录]
   */
  chatWithShell = async (
    message: string,
    cwd: string
  ): Promise<[string, string]> => {
    if (!message || this.client == null) {
      return ['', '']
    }

    const start = Date.now()
    const shellLog: string[] = [] // 记录所有 shell 调用（用于展示分析链）

    // 构建工具列表：run_command function + web search（如果启用）
    // 注意：local_shell / shell 工具仅支持 gpt-5.4+，gpt-4.1 系列不支持
    // 因此使用 function calling 模拟 shell 能力，兼容所有模型
    const tools: any[] = [
      {
        type: 'function',
        name: 'run_command',
        description:
          'Execute a read-only shell command in the repository to explore the codebase. ' +
          'Allowed commands: rg, grep, find, fd, cat, head, tail, wc, ls, tree, file, stat, du, echo, pwd. ' +
          'Pipes (|) are allowed between these commands. No write operations.',
        parameters: {
          type: 'object',
          properties: {
            command: {
              type: 'string',
              description:
                'The shell command to execute, e.g. "rg functionName src/" or "cat src/utils.ts | head -50"'
            }
          },
          required: ['command']
        }
      }
    ]
    if (this.enableWebSearch) {
      tools.push({type: 'web_search', search_context_size: 'high'})
    }

    // 第一次请求
    const params: any = {
      model: this.model,
      instructions: this.systemMessage,
      input: message,
      temperature: this.temperature,
      max_output_tokens: this.maxOutputTokens,
      tools
    }

    let response: any
    try {
      response = await pRetry(() => this.client!.responses.create(params), {
        retries: this.options.openaiRetries
      })
    } catch (e: any) {
      warning(`Failed to send analysis message: ${e}`)
      return ['', '']
    }

    // 多轮 function calling 交互循环
    let rounds = 0
    while (rounds < SHELL_MAX_ROUNDS) {
      // 检查响应中是否有 function_call（run_command）
      const functionCalls = (response?.output ?? []).filter(
        (item: any) =>
          item.type === 'function_call' && item.name === 'run_command'
      )
      if (functionCalls.length === 0) {
        break // 没有更多工具调用，模型已完成分析
      }
      rounds++

      // 执行命令并构建 function_call_output 列表
      const outputs: any[] = []
      for (const call of functionCalls) {
        let cmd = ''
        try {
          const args = JSON.parse(call.arguments ?? '{}')
          cmd = args.command ?? ''
        } catch {
          cmd = ''
        }

        if (!cmd) {
          outputs.push({
            type: 'function_call_output',
            call_id: call.call_id,
            output: 'Error: no command provided'
          })
          continue
        }

        info(`[shell_call] round ${rounds}: ${cmd}`)

        if (!isCommandAllowed(cmd)) {
          const blocked = `Command blocked by safety filter. Allowed: rg, grep, find, fd, cat, head, tail, wc, ls, tree, file, stat, du, echo, pwd`
          warning(`[shell_call] blocked: ${cmd}`)
          shellLog.push(`$ ${cmd}\n⚠️ ${blocked}`)
          outputs.push({
            type: 'function_call_output',
            call_id: call.call_id,
            output: blocked
          })
          continue
        }

        const result = executeShellCommand(cmd, cwd)
        info(
          `[shell_call] exit=${result.exitCode}, stdout=${result.stdout.length} chars`
        )

        // 记录到分析链日志
        let logEntry = `$ ${cmd}`
        if (result.stdout) {
          logEntry += `\n${result.stdout}`
        }
        if (result.stderr && result.exitCode !== 0) {
          logEntry += `\nstderr: ${result.stderr}`
        }
        shellLog.push(logEntry)

        // 构建输出文本
        let outputText = result.stdout
        if (result.stderr && result.exitCode !== 0) {
          outputText += `\nstderr: ${result.stderr}`
        }
        if (result.timedOut) {
          outputText += '\n(command timed out)'
        }

        outputs.push({
          type: 'function_call_output',
          call_id: call.call_id,
          output: outputText || '(no output)'
        })
      }

      // 将命令结果发回给模型继续对话
      try {
        response = await pRetry(
          () =>
            this.client!.responses.create({
              model: this.model,
              instructions: this.systemMessage,
              input: outputs,
              temperature: this.temperature,
              max_output_tokens: this.maxOutputTokens,
              tools,
              previous_response_id: response.id
            }),
          {retries: this.options.openaiRetries}
        )
      } catch (e: any) {
        warning(`Failed to continue shell conversation: ${e}`)
        break
      }
    }

    if (rounds >= SHELL_MAX_ROUNDS) {
      info(`[shell_call] reached max rounds (${SHELL_MAX_ROUNDS})`)
    }

    // 从最终响应中提取文本
    let responseText = ''
    if (response?.output) {
      for (const item of response.output) {
        if (item.type === 'message') {
          for (const content of item.content) {
            if (content.type === 'output_text') {
              responseText += content.text
            }
          }
        }
      }
    }

    const end = Date.now()
    info(
      `[shell_call] analysis complete: ${rounds} shell rounds, ${
        shellLog.length
      } commands, ${end - start} ms`
    )

    // 构建分析链展示文本
    const chainText =
      shellLog.length > 0
        ? shellLog
            .map(entry => `\`\`\`\n${entry}\n\`\`\``)
            .join('\n\n')
        : ''

    // 将模型的总结文本追加到链末尾
    const fullChain = chainText
      ? `${chainText}\n\n${responseText}`
      : responseText

    return [responseText, fullChain]
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
        // search_context_size 是 OpenAI Responses API 中 web_search 工具的参数，用于控制网页搜索时获取的上下文量。
        // 'low' — 搜索结果少，速度快，token 消耗低
        // 'medium' — 默认值
        // 'high' — 获取更多搜索结果和上下文，回答更全面，但 token 消耗更高
        // 这里设为 'high' 是为了让模型在做 web search 时尽可能多地获取信息，提高回答质量。
        tools.push({type: 'web_search', search_context_size: 'high'})
      }

      info(
        `[web_search_debug] model=${this.model}, enableWebSearch=${
          this.enableWebSearch
        }, tools=${JSON.stringify(tools)}`
      )

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
        const outputTypes = response.output.map((item: any) => item.type)
        info(
          `[web_search_debug] response output types: ${JSON.stringify(
            outputTypes
          )}`
        )
        for (const item of response.output) {
          if (item.type === 'web_search_call') {
            info(
              `[web_search] executed, id: ${(item as any).id}, status: ${
                (item as any).status
              }`
            )
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
