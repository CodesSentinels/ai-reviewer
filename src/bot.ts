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

import {execFileSync, execSync} from 'child_process'
import {info, setFailed, warning} from '@actions/core'
import OpenAI, {APIError} from 'openai'
import pRetry from 'p-retry'
import {OpenAIOptions, Options} from './options'

/** shell 执行结果 */
interface ShellResult {
  stdout: string
  stderr: string
  exitCode: number
  timedOut: boolean
}

/** shell 分析链的配置常量 */
const SHELL_MAX_OUTPUT_LENGTH = 4096
const SHELL_TIMEOUT_MS = 30000
const SHELL_MAX_ROUNDS = 10

/** 允许执行的 shell 命令白名单（仅只读命令） */
const SHELL_ALLOWED_COMMANDS = new Set([
  'rg', 'ripgrep', 'grep', 'find', 'cat', 'head', 'tail',
  'wc', 'ls', 'git', 'echo', 'pwd', 'stat', 'file',
  'sort', 'uniq', 'awk', 'sed', 'cut', 'tr', 'xargs', 'jq'
])

/**
 * 检查命令是否在白名单内，且参数中没有危险的 shell 元字符
 */
function isCommandAllowed(commandArray: string[]): boolean {
  if (!commandArray || commandArray.length === 0) return false
  const cmd = commandArray[0].split('/').pop() ?? ''
  if (!SHELL_ALLOWED_COMMANDS.has(cmd)) return false
  // 禁止参数中出现写操作相关的 shell 操作符
  const dangerous = [';', '&&', '||', '$(', '`', '>&', '>>', '> ', '|&']
  for (const arg of commandArray) {
    if (dangerous.some(d => arg.includes(d))) return false
  }
  return true
}

/**
 * 安全执行 shell 命令（使用 execFileSync，避免 shell 注入）
 * 用于数组形式的命令，如 ['rg', 'pattern', 'path']
 */
function executeShellCommand(commandArray: string[], cwd: string): ShellResult {
  try {
    const stdout = execFileSync(commandArray[0], commandArray.slice(1), {
      cwd,
      timeout: SHELL_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
      encoding: 'utf8'
    }) as string
    return {
      stdout: stdout.substring(0, SHELL_MAX_OUTPUT_LENGTH),
      stderr: '',
      exitCode: 0,
      timedOut: false
    }
  } catch (e: any) {
    if (e.killed) {
      return {stdout: '', stderr: 'Command timed out', exitCode: 124, timedOut: true}
    }
    return {
      stdout: ((e.stdout as string) ?? '').substring(0, SHELL_MAX_OUTPUT_LENGTH),
      stderr: ((e.stderr as string) ?? e.message ?? '').substring(0, 1024),
      exitCode: (e.status as number) ?? 1,
      timedOut: false
    }
  }
}

/**
 * 执行完整 shell 命令字符串（用于 shell tool 返回的 commands 字段）
 * commands 是完整 shell 字符串如 "rg pattern src/"，需通过 shell 执行
 */
function executeShellCommandString(cmd: string, cwd: string): ShellResult {
  try {
    const stdout = execSync(cmd, {
      cwd,
      timeout: SHELL_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
      encoding: 'utf8',
      shell: '/bin/sh'
    }) as string
    return {
      stdout: stdout.substring(0, SHELL_MAX_OUTPUT_LENGTH),
      stderr: '',
      exitCode: 0,
      timedOut: false
    }
  } catch (e: any) {
    if (e.killed) {
      return {stdout: '', stderr: 'Command timed out', exitCode: 124, timedOut: true}
    }
    const stderr: string = ((e.stderr as string) ?? e.message ?? '').substring(0, 1024)
    const stdout: string = ((e.stdout as string) ?? '').substring(0, SHELL_MAX_OUTPUT_LENGTH)

    // 若报 "No such file or directory"，自动搜索相似文件名给模型提示
    const noSuchFile = stderr.match(/cannot open ['"]?([^'":\s]+)['"]? for reading|No such file or directory.*['"]([^'"]+)['"]/)
    if (noSuchFile != null) {
      const badPath = noSuchFile[1] ?? noSuchFile[2] ?? ''
      const basename = badPath.split('/').pop() ?? ''
      if (basename) {
        try {
          const similar = execSync(
            `find . -type f -name "${basename}" -not -path "./.git/*" -not -path "./node_modules/*" -not -path "./dist/*"`,
            {cwd, encoding: 'utf8', timeout: 5000}
          ).trim()
          const hint = similar
            ? `Hint: '${badPath}' not found. Similar files: ${similar.split('\n').map(p => p.replace(/^\.\//, '')).join(', ')}`
            : `Hint: '${badPath}' not found and no similar file exists in this repo.`
          return {stdout, stderr: `${stderr}\n${hint}`, exitCode: (e.status as number) ?? 1, timedOut: false}
        } catch {
          // ignore hint errors
        }
      }
    }

    return {
      stdout,
      stderr,
      exitCode: (e.status as number) ?? 1,
      timedOut: false
    }
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
   * 使用 local_shell 工具进行仓库探索式分析（Analysis chain）
   *
   * 流程：向模型发送提示词 → 模型请求执行 shell 命令 → 本地执行并返回结果 → 模型继续分析
   * 循环直到模型不再请求 shell 命令或达到最大轮次限制。
   *
   * @param message - 分析提示词（含 diff 和上下文）
   * @param cwd - 工作目录（GitHub Actions 中为 GITHUB_WORKSPACE）
   * @returns [模型最终摘要文本, 完整 shell 执行日志]
   */
  chatWithShell = async (message: string, cwd: string): Promise<[string, string]> => {
    if (this.client == null || !message) return ['', '']

    const chainLog: string[] = []
    let responseText = ''
    let previousResponseId: string | undefined

    // 正确格式：{ type: 'shell', environment: { type: 'local' } }
    // 仅 gpt-5.4（完整版）支持，mini/nano 不支持
    const tools = [{type: 'shell', environment: {type: 'local'}}] as unknown as OpenAI.Responses.Tool[]
    const shellModel = 'gpt-5.4'

    // 第一轮用字符串 input，后续轮次用 shell 输出数组
    let currentInput: string | OpenAI.Responses.ResponseInput[] = message

    for (let round = 0; round < SHELL_MAX_ROUNDS; round++) {
      const params = {
        model: shellModel,
        instructions: this.systemMessage,
        input: currentInput,
        temperature: this.temperature,
        max_output_tokens: this.maxOutputTokens,
        tools,
        ...(previousResponseId != null && {previous_response_id: previousResponseId})
      } as OpenAI.Responses.ResponseCreateParams

      let response: OpenAI.Responses.Response | undefined
      try {
        const raw = await pRetry(() => this.client!.responses.create(params), {
          retries: this.options.openaiRetries
        })
        response = raw as OpenAI.Responses.Response
      } catch (e: any) {
        warning(`chatWithShell round ${round}: API error: ${e as string}`)
        break
      }

      if (response == null) break
      previousResponseId = response.id

      // 提取文本输出和 shell 调用请求（type 是 'shell_call'，不是 'local_shell_call'）
      const shellCalls: any[] = []
      for (const item of response.output ?? []) {
        if ((item as any).type === 'shell_call') {
          shellCalls.push(item)
        }
        if (item.type === 'message') {
          for (const content of item.content) {
            if (content.type === 'output_text') {
              responseText = content.text
            }
          }
        }
      }

      // 没有 shell 请求，模型已完成分析
      if (shellCalls.length === 0) break

      // 执行 shell 调用
      // action.commands 是完整 shell 字符串数组，如 ["ls -l /src", "rg pattern"]
      const shellOutputs: OpenAI.Responses.ResponseInput[] = []
      for (const call of shellCalls) {
        const commands: string[] = (call as any).action?.commands ?? []
        const commandOutputs: Array<{stdout: string; stderr: string; outcome: {type: string; exit_code?: number}}> = []

        for (const cmd of commands) {
          const firstWord = cmd.trim().split(/\s+/)[0]
          let result: ShellResult

          if (!isCommandAllowed([firstWord])) {
            result = {stdout: '', stderr: `Command not allowed: ${cmd}`, exitCode: 1, timedOut: false}
            chainLog.push(`\`$ ${cmd}\`\n> [BLOCKED: command not in allowlist]`)
          } else {
            info(`[analysis_chain] executing: ${cmd}`)
            result = executeShellCommandString(cmd, cwd)
            const output = result.stdout || (result.stderr ? `[stderr] ${result.stderr}` : '(no output)')
            chainLog.push(`\`$ ${cmd}\`\n\`\`\`\n${output}\n\`\`\``)
          }

          commandOutputs.push({
            stdout: result.stdout,
            stderr: result.stderr,
            outcome: result.timedOut
              ? {type: 'timeout'}
              : {type: 'exit', exit_code: result.exitCode}
          })
        }

        // 输出格式：{ type: 'shell_call_output', call_id, output: [{stdout, stderr, outcome}] }
        shellOutputs.push({
          type: 'shell_call_output',
          call_id: (call as any).call_id,
          output: commandOutputs
        } as unknown as OpenAI.Responses.ResponseInput)
      }

      currentInput = shellOutputs
    }

    const fullChainLog = chainLog.join('\n\n')
    return [responseText, fullChainLog]
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
