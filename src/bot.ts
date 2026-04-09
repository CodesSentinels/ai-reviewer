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

import { info, setFailed, warning } from '@actions/core'
import { exec as execCallback } from 'child_process'
import OpenAI, { APIError } from 'openai'
import pRetry from 'p-retry'
import { OpenAIOptions, Options } from './options'

/**
 * 对话 ID 接口，用于维护多轮对话的上下文关系
 * previousResponseId: 上一次响应的 ID，用于 Responses API 的对话链
 */
export interface Ids {
  previousResponseId?: string
}

/**
 * 分析步骤接口，记录模型在审查过程中执行的工具调用（shell / web_search）
 * 用于生成 CodeRabbit 风格的 Analysis chain，展示审查推理过程
 */
export interface AnalysisStep {
  type: 'shell' | 'web_search'
  /** shell 调用 ID */
  callId?: string
  /** shell 命令列表 */
  commands?: string[]
  /** shell 执行的 stdout 输出 */
  stdout?: string
  /** shell 执行的 stderr 输出 */
  stderr?: string
  /** shell 退出码 */
  exitCode?: number
  /** 是否超时 */
  timedOut?: boolean
  /** web_search 的状态 */
  status?: string
}

interface ShellCallItem {
  id?: string | null
  type: 'shell_call'
  call_id: string
  status?: 'in_progress' | 'completed' | 'incomplete' | null
  action?: {
    commands?: string[]
    timeout_ms?: number | null
    max_output_length?: number | null
  }
}

interface ShellCallOutputContent {
  stdout: string
  stderr: string
  outcome: { type: 'exit'; exit_code: number } | { type: 'timeout' }
}

interface ShellCallOutputItem {
  type: 'shell_call_output'
  call_id: string
  max_output_length: number | null
  output: ShellCallOutputContent[]
}

interface LocalShellCommandResult {
  stdout: string
  stderr: string
  exitCode?: number
  timedOut: boolean
}

const DEFAULT_LOCAL_SHELL_TIMEOUT_MS = 60_000
const DEFAULT_LOCAL_SHELL_MAX_OUTPUT_LENGTH = 4_096
const MAX_LOCAL_SHELL_TURNS = 8
const LOCAL_SHELL_OUTPUT_TRUNCATED = '\n... (truncated)'
const LOCAL_SHELL_MAX_BUFFER_BYTES = 4 * 1024 * 1024

const getLocalShellBinary = (): string | undefined => {
  if (process.env.SHELL) {
    return process.env.SHELL
  }
  if (process.platform === 'win32') {
    return process.env.ComSpec ?? 'cmd.exe'
  }
  return '/bin/bash'
}

const truncateText = (text: string, maxLength: number): string => {
  if (maxLength <= 0) {
    return ''
  }
  if (text.length <= maxLength) {
    return text
  }
  if (maxLength <= LOCAL_SHELL_OUTPUT_TRUNCATED.length) {
    return text.substring(0, maxLength)
  }
  return `${text.substring(0, maxLength - LOCAL_SHELL_OUTPUT_TRUNCATED.length)}${LOCAL_SHELL_OUTPUT_TRUNCATED}`
}

const truncateShellStreams = (
  stdout: string,
  stderr: string,
  maxLength: number
): { stdout: string; stderr: string } => {
  if (maxLength <= 0) {
    return { stdout: '', stderr: '' }
  }

  const totalLength = stdout.length + stderr.length
  if (totalLength <= maxLength) {
    return { stdout, stderr }
  }

  if (stdout.length === 0) {
    return { stdout, stderr: truncateText(stderr, maxLength) }
  }
  if (stderr.length === 0) {
    return { stdout: truncateText(stdout, maxLength), stderr }
  }

  let stdoutBudget = Math.max(
    1,
    Math.floor((maxLength * stdout.length) / totalLength)
  )
  let stderrBudget = Math.max(1, maxLength - stdoutBudget)

  if (stdoutBudget + stderrBudget > maxLength) {
    stderrBudget = Math.max(1, maxLength - stdoutBudget)
  } else if (stdoutBudget + stderrBudget < maxLength) {
    stdoutBudget += maxLength - (stdoutBudget + stderrBudget)
  }

  return {
    stdout: truncateText(stdout, stdoutBudget),
    stderr: truncateText(stderr, stderrBudget)
  }
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
  private readonly enableShell: boolean // 是否启用 enableShell

  private readonly options: Options // 全局配置选项

  constructor(options: Options, openaiOptions: OpenAIOptions) {
    this.options = options
    this.model = openaiOptions.model
    this.temperature = options.openaiModelTemperature
    this.maxOutputTokens = openaiOptions.tokenLimits.responseTokens
    this.enableWebSearch = openaiOptions.enableWebSearch
    this.enableShell = openaiOptions.enableShell

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
  chat = async (message: string, ids: Ids): Promise<[string, Ids, AnalysisStep[]]> => {
    let res: [string, Ids, AnalysisStep[]] = ['', {}, []]
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
  ): Promise<[string, Ids, AnalysisStep[]]> => {
    // 记录请求开始时间，用于计算响应耗时
    const start = Date.now()
    if (!message) {
      return ['', {}, []]
    }

    if (this.client != null) {
      const tools = this.buildTools()

      info(
        `[web_search_debug] model=${this.model}, enableWebSearch=${
          this.enableWebSearch
        }, enableShell=${this.enableShell} , tools=${JSON.stringify(tools)}`
      )

      let responseText = ''
      const analysisSteps: AnalysisStep[] = []
      let response = await this.createResponse(
        this.buildParams(message, ids.previousResponseId, tools)
      )

      for (let turn = 0; turn < MAX_LOCAL_SHELL_TURNS; turn++) {
        if (response == null) {
          break
        }

        if (response.output == null) {
          warning('openai response is null')
          break
        }

        const pendingShellCalls: ShellCallItem[] = []
        const outputTypes = response.output.map((item: any) => item.type)
        info(
          `[web_search_debug] response output types: ${JSON.stringify(
            outputTypes
          )}`
        )

        for (let i = 0; i < response.output.length; i++) {
          const item = response.output[i] as any
          info(
            `[analysis_chain_debug] output[${i}] type="${item.type}", keys=${JSON.stringify(Object.keys(item))}`
          )

          if (item.type === 'web_search_call') {
            info(
              `[web_search] executed, id: ${(item as any).id}, status: ${
                (item as any).status
              }`
            )
            analysisSteps.push({
              type: 'web_search',
              status: (item as any).status
            })
          }

          if (item.type === 'shell_call') {
            const shellItem = item as ShellCallItem
            info(
              `[analysis_chain_debug] shell_call found! id=${shellItem.id}, commands=${JSON.stringify(shellItem.action?.commands)}, status=${shellItem.status}`
            )
            this.ensureShellAnalysisStep(analysisSteps, shellItem)
            pendingShellCalls.push(shellItem)
          }

          if (item.type === 'shell_call_output') {
            const shellOutput = item as ShellCallOutputItem
            info(
              `[analysis_chain_debug] shell_call_output found! call_id=${shellOutput.call_id}, output_count=${shellOutput.output?.length ?? 0}`
            )
            this.attachShellOutput(
              analysisSteps,
              shellOutput.call_id,
              shellOutput.output
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

        if (pendingShellCalls.length === 0) {
          break
        }

        if (turn === MAX_LOCAL_SHELL_TURNS - 1) {
          warning(
            `Reached local shell turn limit (${MAX_LOCAL_SHELL_TURNS}) for response ${response.id}`
          )
          break
        }

        const shellOutputs = await this.executeShellCalls(
          pendingShellCalls,
          analysisSteps
        )
        response = await this.createResponse(
          this.buildParams(shellOutputs, response.id, tools)
        )
      }

      info(`[analysis_chain] total analysis steps captured: ${analysisSteps.length}`)
      if (analysisSteps.length > 0) {
        for (let i = 0; i < analysisSteps.length; i++) {
          const s = analysisSteps[i]
          info(`[analysis_chain] step[${i}]: type=${s.type}, commands=${JSON.stringify(s.commands)}, stdout_len=${s.stdout?.length ?? 0}, stderr_len=${s.stderr?.length ?? 0}`)
        }
      }

      // 移除响应中可能存在的多余前缀 "with "
      if (responseText.startsWith('with ')) {
        responseText = responseText.substring(5)
      }
      if (this.options.debug) {
        // info(`openai responses: ${responseText}`)
      }

      // 构建新的对话 ID，用于后续多轮对话
      const newIds: Ids = {
        previousResponseId: response?.id
      }
      return [responseText, newIds, analysisSteps]
    } else {
      setFailed('The OpenAI API is not initialized')
    }

    return ['', {}, []]
  }

  private readonly buildTools = (): OpenAI.Responses.Tool[] => {
    const tools: OpenAI.Responses.Tool[] = []
    if (this.enableWebSearch) {
      tools.push({type: 'web_search', search_context_size: 'high'})
    }
    if (this.enableShell) {
      tools.push({type: 'shell', environment: {type: 'local'}})
    }
    return tools
  }

  private readonly buildParams = (
    input: string | Array<OpenAI.Responses.ResponseInputItem>,
    previousResponseId: string | undefined,
    tools: OpenAI.Responses.Tool[]
  ): OpenAI.Responses.ResponseCreateParams => {
    return {
      model: this.model,
      instructions: this.systemMessage,
      input,
      temperature: this.temperature,
      max_output_tokens: this.maxOutputTokens,
      ...(tools.length > 0 && {tools}),
      ...(previousResponseId && {
        previous_response_id: previousResponseId
      })
    }
  }

  private readonly createResponse = async (
    params: OpenAI.Responses.ResponseCreateParams
  ): Promise<OpenAI.Responses.Response | undefined> => {
    const start = Date.now()
    try {
      const response = await pRetry(
        () => this.client!.responses.create(params) as Promise<OpenAI.Responses.Response>,
        {
          retries: this.options.openaiRetries
        }
      )
      info(
        `openai sendMessage (including retries) response time: ${
          Date.now() - start
        } ms`
      )
      return response
    } catch (e: unknown) {
      info(
        `openai sendMessage (including retries) response time: ${
          Date.now() - start
        } ms`
      )
      if (e instanceof APIError) {
        warning(`Failed to send message to openai: ${e}, backtrace: ${e.stack}`)
      }
      return undefined
    }
  }

  private readonly ensureShellAnalysisStep = (
    analysisSteps: AnalysisStep[],
    shellCall: ShellCallItem
  ): AnalysisStep => {
    const existingStep = analysisSteps.find(
      step => step.type === 'shell' && step.callId === shellCall.call_id
    )
    if (existingStep) {
      existingStep.commands = shellCall.action?.commands ?? existingStep.commands
      existingStep.status = shellCall.status ?? existingStep.status
      return existingStep
    }

    const step: AnalysisStep = {
      type: 'shell',
      callId: shellCall.call_id,
      commands: shellCall.action?.commands ?? [],
      status: shellCall.status ?? undefined
    }
    analysisSteps.push(step)
    return step
  }

  private readonly attachShellOutput = (
    analysisSteps: AnalysisStep[],
    callId: string,
    output: ShellCallOutputContent[]
  ): void => {
    const shellStep = [...analysisSteps]
      .reverse()
      .find(step => step.type === 'shell' && step.callId === callId)

    if (shellStep == null || output.length === 0) {
      info(
        '[analysis_chain_debug] shell_call_output but no matching shell step found or no output'
      )
      return
    }

    for (const out of output) {
      info(
        `[analysis_chain_debug] shell output chunk: stdout_len=${out.stdout?.length ?? 0}, stderr_len=${out.stderr?.length ?? 0}, outcome=${JSON.stringify(out.outcome)}`
      )
      shellStep.stdout = (shellStep.stdout ?? '') + (out.stdout ?? '')
      shellStep.stderr = (shellStep.stderr ?? '') + (out.stderr ?? '')
      if (out.outcome.type === 'exit') {
        shellStep.exitCode = out.outcome.exit_code
      } else if (out.outcome.type === 'timeout') {
        shellStep.timedOut = true
      }
    }
  }

  private readonly executeShellCalls = async (
    shellCalls: ShellCallItem[],
    analysisSteps: AnalysisStep[]
  ): Promise<Array<OpenAI.Responses.ResponseInputItem>> => {
    const shellOutputs: Array<OpenAI.Responses.ResponseInputItem> = []

    for (const shellCall of shellCalls) {
      const step = this.ensureShellAnalysisStep(analysisSteps, shellCall)
      const shellOutput = await this.runLocalShellCall(shellCall)
      this.attachShellOutput(analysisSteps, shellCall.call_id, shellOutput.output)
      step.status = 'completed'
      shellOutputs.push(shellOutput as OpenAI.Responses.ResponseInputItem)
    }

    return shellOutputs
  }

  private readonly runLocalShellCall = async (
    shellCall: ShellCallItem
  ): Promise<ShellCallOutputItem> => {
    const commands = shellCall.action?.commands ?? []
    const timeoutMs =
      shellCall.action?.timeout_ms ?? DEFAULT_LOCAL_SHELL_TIMEOUT_MS
    const requestedMaxOutputLength = shellCall.action?.max_output_length ?? null
    const effectiveMaxOutputLength =
      requestedMaxOutputLength ?? DEFAULT_LOCAL_SHELL_MAX_OUTPUT_LENGTH
    let remainingOutputBudget = effectiveMaxOutputLength
    const output: ShellCallOutputContent[] = []

    for (let i = 0; i < commands.length; i++) {
      const command = commands[i]
      info(
        `[local_shell] executing command ${i + 1}/${commands.length} for call ${shellCall.call_id}: ${command}`
      )

      const result = await this.runLocalShellCommand(
        command,
        timeoutMs,
        effectiveMaxOutputLength
      )

      const commandsRemaining = commands.length - i
      const commandBudget =
        remainingOutputBudget > 0
          ? Math.max(1, Math.floor(remainingOutputBudget / commandsRemaining))
          : 0
      const truncatedOutput = truncateShellStreams(
        result.stdout,
        result.stderr,
        commandBudget
      )
      remainingOutputBudget = Math.max(
        0,
        remainingOutputBudget -
          truncatedOutput.stdout.length -
          truncatedOutput.stderr.length
      )

      output.push({
        stdout: truncatedOutput.stdout,
        stderr: truncatedOutput.stderr,
        outcome: result.timedOut
          ? {type: 'timeout'}
          : {
              type: 'exit',
              exit_code: result.exitCode ?? 1
            }
      })
    }

    return {
      type: 'shell_call_output',
      call_id: shellCall.call_id,
      max_output_length: requestedMaxOutputLength,
      output
    }
  }

  private readonly runLocalShellCommand = async (
    command: string,
    timeoutMs: number,
    maxOutputLength: number
  ): Promise<LocalShellCommandResult> => {
    const shell = getLocalShellBinary()
    const maxBuffer = Math.max(
      1_024 * 1_024,
      Math.min(
        LOCAL_SHELL_MAX_BUFFER_BYTES,
        Math.max(maxOutputLength * 8, 1_024 * 1_024)
      )
    )

    try {
      const {stdout, stderr} = await new Promise<{
        stdout: string
        stderr: string
      }>((resolve, reject) => {
        execCallback(command, {
          cwd: process.cwd(),
          timeout: timeoutMs,
          maxBuffer,
          ...(shell ? {shell} : {})
        }, (error, stdout, stderr) => {
          if (error != null) {
            const enrichedError = error as NodeJS.ErrnoException & {
              stdout?: string
              stderr?: string
            }
            enrichedError.stdout = stdout
            enrichedError.stderr = stderr
            reject(enrichedError)
            return
          }
          resolve({stdout, stderr})
        })
      })
      return {
        stdout,
        stderr,
        exitCode: 0,
        timedOut: false
      }
    } catch (error: unknown) {
      const shellError = error as NodeJS.ErrnoException & {
        stdout?: string
        stderr?: string
        code?: string | number
        killed?: boolean
        signal?: string | null
      }
      const timedOut =
        shellError.signal === 'SIGTERM' &&
        (shellError.killed === true || shellError.code === 'ETIMEDOUT')
      const exitCode =
        typeof shellError.code === 'number'
          ? shellError.code
          : timedOut
            ? undefined
            : 1

      return {
        stdout: shellError.stdout ?? '',
        stderr:
          shellError.stderr ??
          (error instanceof Error ? error.message : String(error)),
        exitCode,
        timedOut
      }
    }
  }
}
