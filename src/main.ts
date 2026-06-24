/**
 * main.ts - GitHub Action 入口文件
 *
 * 整个 AI Reviewer 的启动入口，负责：
 * 1. 读取 GitHub Action 的所有输入参数（配置项）
 * 2. 初始化轻量模型 Bot（用于摘要）和重量模型 Bot（用于代码审查）
 * 3. 根据 GitHub 事件类型分发到不同的处理流程：
 *    - pull_request / pull_request_target → 执行完整代码审查流程
 *    - pull_request_review_comment → 处理用户在审查评论中的回复
 */
import {
  getBooleanInput,
  getInput,
  getMultilineInput,
  setFailed,
  warning
} from '@actions/core'
import {Bot} from './bot'
import {handleCommentEvent} from './command-handler'
import {tryEarlyReaction} from './commands/early-reaction'
import {OpenAIOptions, Options} from './options'
import {Prompts} from './prompts'
import {codeReview} from './review'

function createBots(options: Options): {lightBot: Bot; heavyBot: Bot} | null {
  // 初始化轻量模型 Bot（默认 gpt-5.4-nano），用于快速生成文件摘要
  let lightBot: Bot | null = null
  try {
    lightBot = new Bot(
      options,
      new OpenAIOptions(
        options.openaiLightModel,
        options.lightTokenLimits,
        false,
        false
      )
    )
  } catch (e: any) {
    warning(
      `Skipped: failed to create summary bot, please check your openai_api_key: ${e}, backtrace: ${e.stack}`
    )
    return null
  }

  // 初始化重量模型 Bot（默认 gpt-5.4-mini），用于深度代码审查和最终摘要生成
  let heavyBot: Bot | null = null
  try {
    heavyBot = new Bot(
      options,
      new OpenAIOptions(
        options.openaiHeavyModel,
        options.heavyTokenLimits,
        options.enableWebSearch,
        options.enableShell
      )
    )
  } catch (e: any) {
    warning(
      `Skipped: failed to create review bot, please check your openai_api_key: ${e}, backtrace: ${e.stack}`
    )
    return null
  }

  return {lightBot, heavyBot}
}

async function run(): Promise<void> {
  // 从 action.yml 中读取所有配置参数，构建 Options 配置对象
  const options: Options = new Options(
    getBooleanInput('debug'),
    getBooleanInput('disable_review'),
    getBooleanInput('disable_release_notes'),
    getInput('max_files'),
    getBooleanInput('review_simple_changes'),
    getBooleanInput('review_comment_lgtm'),
    getMultilineInput('path_filters'),
    getInput('system_message'),
    getInput('openai_light_model'),
    getInput('openai_heavy_model'),
    getInput('openai_model_temperature'),
    getInput('openai_retries'),
    getInput('openai_timeout_ms'),
    getInput('openai_concurrency_limit'),
    getInput('github_concurrency_limit'),
    getInput('openai_base_url'),
    getInput('language'),
    getBooleanInput('enable_dependency_analysis'),
    getInput('max_dependency_files'),
    getBooleanInput('enable_web_search'),
    getBooleanInput('enable_shell'),
    getBooleanInput('enable_lint_tools'),
    {
      // 取代 .codesentinel.yaml：所有 lint 工具的开关都通过 Action 输入控制
      eslint: getBooleanInput('enable_eslint'),
      biome: getBooleanInput('enable_biome'),
      tsc: getBooleanInput('enable_tsc'),
      prettier: getBooleanInput('enable_prettier'),
      semgrep: getBooleanInput('enable_semgrep')
    },
    // 工具版本覆盖：仅收集用户**显式填写**的值；空字符串视为"用默认版本"
    Object.fromEntries(
      (
        [
          ['eslint', 'eslint_version'],
          ['biome', 'biome_version'],
          ['tsc', 'tsc_version'],
          ['prettier', 'prettier_version'],
          ['semgrep', 'semgrep_version']
        ] as const
      )
        .map(([toolName, inputName]) => [toolName, getInput(inputName).trim()])
        .filter(([, v]) => v.length > 0)
    ),
    getInput('semgrep_config'),
    getInput('command_ack_reaction'),
    getInput('max_review_comments')
  )

  // 打印所有配置项，方便调试
  options.print()

  // 评论事件：在 Bot 初始化前尽快给用户评论打 ACK 表情
  if (
    process.env.GITHUB_EVENT_NAME === 'issue_comment' ||
    process.env.GITHUB_EVENT_NAME === 'pull_request_review_comment'
  ) {
    await tryEarlyReaction(options.commandAckReaction)
  }

  // 构建提示词模板对象，包含用户自定义的摘要和发布说明提示词
  const prompts: Prompts = new Prompts(
    getInput('summarize'),
    getInput('summarize_release_notes')
  )

  try {
    // 根据 GitHub 事件类型分发处理逻辑
    console.log(`GitHub event: ${process.env.GITHUB_EVENT_NAME}`)
    if (
      process.env.GITHUB_EVENT_NAME === 'pull_request' ||
      process.env.GITHUB_EVENT_NAME === 'pull_request_target'
    ) {
      const bots = createBots(options)
      if (bots == null) return

      // PR 事件：执行完整的代码审查流程（摘要 + 逐文件审查）
      await codeReview(bots.lightBot, bots.heavyBot, options, prompts)
    } else if (
      process.env.GITHUB_EVENT_NAME === 'pull_request_review_comment' ||
      process.env.GITHUB_EVENT_NAME === 'issue_comment'
    ) {
      // 评论事件（顶层 issue_comment 或 review comment）
      // 先走命令调度，未命中命令时再透传给既有的对话式追问
      await handleCommentEvent({
        options,
        prompts,
        getReviewBots: () => createBots(options)
      })
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

// 全局异常处理：捕获未处理的 Promise 拒绝和未捕获的异常
process
  .on('unhandledRejection', (reason, p) => {
    warning(`Unhandled Rejection at Promise: ${reason}, promise is ${p}`)
  })
  .on('uncaughtException', (e: any) => {
    warning(`Uncaught Exception thrown: ${e}, backtrace: ${e.stack}`)
  })

// 启动主流程
await run()
