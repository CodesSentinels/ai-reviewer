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

import {info, setFailed, warning} from './actions-log'
import {exec as execCallback} from 'child_process'
import OpenAI, {APIError} from 'openai'
import pRetry from 'p-retry'
import {OpenAIOptions, Options} from './options'
import {sanitizeModelOutput} from './sanitize-model-output'
import {executeReviewTool, isReviewToolName, reviewToolDefinitions} from './review-tools'

/**
 * 对话 ID 接口，用于维护多轮对话的上下文关系
 * previousResponseId: 上一次响应的 ID，用于 Responses API 的对话链
 */
export interface Ids {
  previousResponseId?: string
}

/**
 * 分析步骤接口，记录模型在审查过程中执行的工具调用
 * （shell / web_search / 只读代码探查工具），用于生成 CodeRabbit 风格的
 * Analysis chain，展示审查推理过程
 */
export interface AnalysisStep {
  type: 'shell' | 'web_search' | 'read_file' | 'list_directory' | 'search_code'
  /** shell 调用 ID */
  callId?: string
  /** shell 命令列表 */
  commands?: string[]
  /** shell 每条命令的输出摘要 */
  commandOutputs?: AnalysisCommandOutput[]
  /** shell 聚合后的 stdout 长度 */
  stdoutLength?: number
  /** shell 聚合后的 stderr 长度 */
  stderrLength?: number
  /** shell 退出码 */
  exitCode?: number
  /** 是否超时 */
  timedOut?: boolean
  /** web_search 的状态 */
  status?: string
  /** web_search 的动作：search / open_page / find_in_page */
  webAction?: string
  /** web_search 的搜索词 */
  queries?: string[]
  /**
   * web_search 引用来源的**域名**（去重）。WS-004：搜索结果是外部内容，完整 URL
   * 不进入分析步骤，评论里只展示不可点击的域名
   */
  sourceDomains?: string[]
  /** web_search open_page / find_in_page 所在页面的域名 */
  pageDomain?: string
  /** web_search find_in_page 的查找内容 */
  pattern?: string
  /** read_file / list_directory 的路径 */
  path?: string
  /** read_file 实际读取的行范围 */
  startLine?: number
  endLine?: number
  /** search_code 的搜索词 */
  query?: string
  /** list_directory / search_code 的结果条数 */
  resultCount?: number
  /** 代码探查工具失败时的原因（会回传给模型） */
  error?: string
}

/** 模型发起的函数调用（只读代码探查工具） */
interface FunctionCallItem {
  type: 'function_call'
  call_id: string
  name: string
  arguments: string
}

/** URL → 域名；只接受 http(s) 与合法主机名字符，其余一律丢弃 */
function domainOf(url: unknown): string | null {
  if (typeof url !== 'string') return null
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    const host = u.hostname.toLowerCase()
    return /^[a-z0-9.-]{1,253}$/.test(host) ? host : null
  } catch {
    return null
  }
}

/** 从 web_search_call 响应项提取 Analysis chain 需要的信息（不保留完整 URL） */
export function webSearchStepFrom(item: any): AnalysisStep {
  const action = item?.action ?? {}
  const step: AnalysisStep = {type: 'web_search', status: item?.status}
  if (typeof action.type === 'string') step.webAction = action.type
  const queries: string[] = Array.isArray(action.queries)
    ? action.queries.filter((q: unknown): q is string => typeof q === 'string' && q !== '')
    : []
  if (queries.length === 0 && typeof action.query === 'string' && action.query !== '') {
    queries.push(action.query)
  }
  if (queries.length > 0) step.queries = queries
  if (Array.isArray(action.sources)) {
    const domains = [
      ...new Set(
        action.sources
          .map((s: any) => domainOf(s?.url))
          .filter((d: string | null): d is string => d != null)
      )
    ] as string[]
    if (domains.length > 0) step.sourceDomains = domains
  }
  const pageDomain = domainOf(action.url)
  if (pageDomain != null) step.pageDomain = pageDomain
  if (typeof action.pattern === 'string' && action.pattern !== '') step.pattern = action.pattern
  return step
}

export interface AnalysisCommandOutput {
  stdoutLength: number
  stderrLength: number
  exitCode?: number
  timedOut?: boolean
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
  outcome: {type: 'exit'; exit_code: number} | {type: 'timeout'}
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
const LOCAL_SHELL_SENSITIVE_ENV_KEYS = [
  'OPENAI_API_KEY',
  'GITHUB_TOKEN',
  'INPUT_OPENAI-API-KEY',
  'INPUT_GITHUB-TOKEN'
]

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
  return `${text.substring(
    0,
    maxLength - LOCAL_SHELL_OUTPUT_TRUNCATED.length
  )}${LOCAL_SHELL_OUTPUT_TRUNCATED}`
}

const truncateShellStreams = (
  stdout: string,
  stderr: string,
  maxLength: number
): {stdout: string; stderr: string} => {
  if (maxLength <= 0) {
    return {stdout: '', stderr: ''}
  }

  const totalLength = stdout.length + stderr.length
  if (totalLength <= maxLength) {
    return {stdout, stderr}
  }

  if (stdout.length === 0) {
    return {stdout, stderr: truncateText(stderr, maxLength)}
  }
  if (stderr.length === 0) {
    return {stdout: truncateText(stdout, maxLength), stderr}
  }

  let stdoutBudget = Math.max(1, Math.floor((maxLength * stdout.length) / totalLength))
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
  private readonly enableCodeTools: boolean // 是否提供只读代码探查工具

  private readonly options: Options // 全局配置选项

  constructor(options: Options, openaiOptions: OpenAIOptions) {
    this.options = options
    this.model = openaiOptions.model
    this.temperature = options.openaiModelTemperature
    this.maxOutputTokens = openaiOptions.tokenLimits.responseTokens
    this.enableWebSearch = openaiOptions.enableWebSearch
    this.enableShell = openaiOptions.enableShell
    this.enableCodeTools = openaiOptions.enableCodeTools ?? false

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
        const pendingFunctionCalls: FunctionCallItem[] = []
        const outputTypes = response.output.map((item: any) => item.type)
        info(`[web_search_debug] response output types: ${JSON.stringify(outputTypes)}`)

        for (let i = 0; i < response.output.length; i++) {
          const item = response.output[i] as any
          info(
            `[analysis_chain_debug] output[${i}] type="${item.type}", keys=${JSON.stringify(
              Object.keys(item)
            )}`
          )

          // WS-003：开关必须同时校验。只看响应项类型的话，兼容 API 返回了意外的
          // web_search_call、或响应协议漂移时，开关为 false 也会记下 web search
          // analysis step——那条 step 会进 PR 评论，等于对外宣称做过搜索。
          if (this.enableWebSearch && item.type === 'web_search_call') {
            const step = webSearchStepFrom(item)
            info(
              `[web_search] executed, id: ${(item as any).id}, status: ${step.status}, action: ${
                step.webAction ?? '-'
              }, queries: ${JSON.stringify(step.queries ?? [])}, source domains: ${
                step.sourceDomains?.length ?? 0
              }`
            )
            analysisSteps.push(step)
          }

          if (item.type === 'shell_call') {
            const shellItem = item as ShellCallItem
            info(
              `[analysis_chain_debug] shell_call found! id=${
                shellItem.id
              }, commands=${JSON.stringify(shellItem.action?.commands)}, status=${shellItem.status}`
            )
            this.ensureShellAnalysisStep(analysisSteps, shellItem)
            pendingShellCalls.push(shellItem)
          }

          if (item.type === 'function_call') {
            pendingFunctionCalls.push(item as FunctionCallItem)
          }

          if (item.type === 'shell_call_output') {
            const shellOutput = item as ShellCallOutputItem
            info(
              `[analysis_chain_debug] shell_call_output found! call_id=${
                shellOutput.call_id
              }, output_count=${shellOutput.output?.length ?? 0}`
            )
            this.attachShellOutput(analysisSteps, shellOutput.call_id, shellOutput.output)
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

        if (pendingShellCalls.length === 0 && pendingFunctionCalls.length === 0) {
          break
        }

        if (turn === MAX_LOCAL_SHELL_TURNS - 1) {
          warning(`Reached tool turn limit (${MAX_LOCAL_SHELL_TURNS}) for response ${response.id}`)
          break
        }

        const toolOutputs: OpenAI.Responses.ResponseInputItem[] = [
          ...(await this.executeShellCalls(pendingShellCalls, analysisSteps)),
          ...(await this.executeFunctionCalls(pendingFunctionCalls, analysisSteps))
        ]
        response = await this.createResponse(this.buildParams(toolOutputs, response.id, tools))
      }

      // info(`[analysis_chain] total analysis steps captured: ${analysisSteps.length}`)
      // if (analysisSteps.length > 0) {
      //   for (let i = 0; i < analysisSteps.length; i++) {
      //     const s = analysisSteps[i]
      //     info(`[analysis_chain] step[${i}]: type=${s.type}, commands=${JSON.stringify(s.commands)}, stdout_len=${s.stdoutLength ?? 0}, stderr_len=${s.stderrLength ?? 0}`)
      //   }
      // }

      // 移除响应中可能存在的多余前缀 "with "
      if (responseText.startsWith('with ')) {
        responseText = responseText.substring(5)
      }

      // 剥离 LLM 内置工具（web_search / browse / file_search）插入的 citation
      // marker（看起来像乱码的 `citeturn0search0` 之类）。详见
      // src/sanitize-model-output.ts 头部注释。
      const beforeLen = responseText.length
      responseText = sanitizeModelOutput(responseText)
      if (responseText.length !== beforeLen) {
        info(`[sanitize] stripped citation markers: ${beforeLen} → ${responseText.length} chars`)
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
    if (this.enableCodeTools) {
      tools.push(...reviewToolDefinitions())
    }
    return tools
  }

  /**
   * 执行模型发起的只读代码探查调用。工具未启用或名称未知时同样回一条
   * function_call_output（Responses API 要求每个 function_call 都有对应输出）。
   */
  private readonly executeFunctionCalls = async (
    calls: FunctionCallItem[],
    analysisSteps: AnalysisStep[]
  ): Promise<OpenAI.Responses.ResponseInputItem[]> => {
    const outputs: OpenAI.Responses.ResponseInputItem[] = []
    for (const call of calls) {
      let output: string
      if (this.enableCodeTools && isReviewToolName(call.name)) {
        const result = await executeReviewTool(call.name, call.arguments)
        analysisSteps.push(result.step)
        output = result.output
        info(
          `[code_tools] ${call.name} ${call.arguments} → ${
            result.step.error != null ? `error: ${result.step.error}` : `${output.length} chars`
          }`
        )
      } else {
        output = `error: tool ${call.name} is not available`
        warning(`[code_tools] unexpected function call: ${call.name}`)
      }
      // eslint-disable-next-line camelcase
      outputs.push({type: 'function_call_output', call_id: call.call_id, output})
    }
    return outputs
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
      // web search 的来源默认不返回，要显式请求，Analysis chain 才能列出参考来源
      ...(this.enableWebSearch && {include: ['web_search_call.action.sources']}),
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
      info(`openai sendMessage (including retries) response time: ${Date.now() - start} ms`)
      return response
    } catch (e: unknown) {
      info(`openai sendMessage (including retries) response time: ${Date.now() - start} ms`)
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
      info('[analysis_chain_debug] shell_call_output but no matching shell step found or no output')
      return
    }

    const commandOutputs: AnalysisCommandOutput[] = []
    let stdoutLength = 0
    let stderrLength = 0
    let timedOut = false
    let exitCode: number | undefined

    for (const out of output) {
      info(
        `[analysis_chain_debug] shell output chunk: stdout_len=${
          out.stdout?.length ?? 0
        }, stderr_len=${out.stderr?.length ?? 0}, outcome=${JSON.stringify(out.outcome)}`
      )
      const stdoutChunkLength = out.stdout?.length ?? 0
      const stderrChunkLength = out.stderr?.length ?? 0
      stdoutLength += stdoutChunkLength
      stderrLength += stderrChunkLength

      const commandOutput: AnalysisCommandOutput = {
        stdoutLength: stdoutChunkLength,
        stderrLength: stderrChunkLength
      }
      if (out.outcome.type === 'exit') {
        commandOutput.exitCode = out.outcome.exit_code
        exitCode = out.outcome.exit_code
      } else if (out.outcome.type === 'timeout') {
        commandOutput.timedOut = true
        timedOut = true
      }
      commandOutputs.push(commandOutput)
    }

    shellStep.commandOutputs = commandOutputs
    shellStep.stdoutLength = stdoutLength
    shellStep.stderrLength = stderrLength
    shellStep.exitCode = exitCode
    shellStep.timedOut = timedOut
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
    const timeoutMs = shellCall.action?.timeout_ms ?? DEFAULT_LOCAL_SHELL_TIMEOUT_MS
    const requestedMaxOutputLength = shellCall.action?.max_output_length ?? null
    const effectiveMaxOutputLength =
      requestedMaxOutputLength ?? DEFAULT_LOCAL_SHELL_MAX_OUTPUT_LENGTH
    let remainingOutputBudget = effectiveMaxOutputLength
    const output: ShellCallOutputContent[] = []

    for (let i = 0; i < commands.length; i++) {
      const command = commands[i]
      info(
        `[local_shell] executing command ${i + 1}/${commands.length} for call ${
          shellCall.call_id
        }: ${command}`
      )

      const result = await this.runLocalShellCommand(command, timeoutMs, effectiveMaxOutputLength)

      const commandsRemaining = commands.length - i
      const commandBudget =
        remainingOutputBudget > 0
          ? Math.max(1, Math.floor(remainingOutputBudget / commandsRemaining))
          : 0
      const truncatedOutput = truncateShellStreams(result.stdout, result.stderr, commandBudget)
      remainingOutputBudget = Math.max(
        0,
        remainingOutputBudget - truncatedOutput.stdout.length - truncatedOutput.stderr.length
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
      Math.min(LOCAL_SHELL_MAX_BUFFER_BYTES, Math.max(maxOutputLength * 8, 1_024 * 1_024))
    )

    const sanitizedEnv = {...process.env}
    for (const key of LOCAL_SHELL_SENSITIVE_ENV_KEYS) {
      delete sanitizedEnv[key]
    }

    try {
      const {stdout, stderr} = await new Promise<{
        stdout: string
        stderr: string
      }>((resolve, reject) => {
        execCallback(
          command,
          {
            cwd: process.cwd(),
            env: sanitizedEnv,
            timeout: timeoutMs,
            maxBuffer,
            ...(shell ? {shell} : {})
          },
          (error, stdout, stderr) => {
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
          }
        )
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
        typeof shellError.code === 'number' ? shellError.code : timedOut ? undefined : 1

      return {
        stdout: shellError.stdout ?? '',
        stderr: shellError.stderr ?? (error instanceof Error ? error.message : String(error)),
        exitCode,
        timedOut
      }
    }
  }
}
