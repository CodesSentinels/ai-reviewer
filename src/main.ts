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
import {info, setFailed, warning} from '@actions/core'
import {Bot} from './bot'
import {initBotGreeting} from './commenter'
import {handleCommentEvent} from './command-handler'
import {tryEarlyReaction} from './commands/early-reaction'
import {OpenAIOptions, type Options} from './options'
import {
  type ExecutionContext,
  ExecutionContextError
} from './platform/execution-context'
import {createGitHubExecutionContext} from './platform/github-execution-context'
import {ConfigError} from './platform/config-provider'
import {GitHubConfigProvider} from './platform/github-config-provider'
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
  // ==================== 通过 ConfigProvider 读取配置（ARCH-007/008） ====================
  // ConfigError 必须 fail closed（ARCH-010）：配置校验失败时 Action 必须以失败状态退出，
  // 不得静默跳过审查让用户误以为"通过"。
  let options: Options
  const configProvider = new GitHubConfigProvider()
  try {
    options = configProvider.getOptions()

    // 初始化 bot 问候语（CFG-005：共享核心不再直读 getInput）
    initBotGreeting(options.botIcon, options.botName)

    // 打印所有非敏感配置（ARCH-011）
    configProvider.print(info)
  } catch (e) {
    if (e instanceof ConfigError) {
      setFailed(`Configuration error [${e.platform}:${e.field}]: ${e.message}`)
    } else if (e instanceof Error) {
      setFailed(`Failed to read configuration: ${e.message}`)
    } else {
      setFailed(`Failed to read configuration: ${e}`)
    }
    return
  }

  // ==================== 构造平台无关执行上下文（ARCH-001~003） ====================
  // GitHub-only：不读取任何 GitLab 配置也能正常构造和运行（GH-016）。
  let execCtx: ExecutionContext
  try {
    execCtx = createGitHubExecutionContext()
  } catch (e) {
    if (e instanceof ExecutionContextError && e.reason === 'unknown_event') {
      // 非致命：不支持的事件类型直接跳过，不调用模型（与改造前行为一致）
      warning(`Skipped: ${e.message}`)
      return
    }
    // 致命：payload 缺失/格式错误 → fail closed（ARCH-006），不得继续执行审查
    if (e instanceof ExecutionContextError) {
      setFailed(`Failed to build ExecutionContext: ${e.message}`)
    } else if (e instanceof Error) {
      setFailed(
        `Failed to build ExecutionContext: ${e.message}, backtrace: ${e.stack}`
      )
    } else {
      setFailed(`Failed to build ExecutionContext: ${e}`)
    }
    return
  }

  info(
    `GitHub event: ${process.env.GITHUB_EVENT_NAME} → eventKind: ${execCtx.eventKind}`
  )

  // 评论事件：在 Bot 初始化前尽快给用户评论打 ACK 表情
  if (
    execCtx.eventKind === 'comment_created' ||
    execCtx.eventKind === 'review_comment_created'
  ) {
    await tryEarlyReaction(execCtx, options.commandAckReaction)
  }

  // 构建提示词模板对象，包含用户自定义的摘要和发布说明提示词
  const promptConfig = configProvider.getPromptConfig()
  const prompts: Prompts = new Prompts(
    promptConfig.summarize,
    promptConfig.summarizeReleaseNotes
  )

  try {
    // 根据归一化事件类型分发处理逻辑
    if (
      execCtx.eventKind === 'pr_opened' ||
      execCtx.eventKind === 'pr_synchronize' ||
      execCtx.eventKind === 'pr_reopened'
    ) {
      const bots = createBots(options)
      if (bots == null) return

      // PR 事件：执行完整的代码审查流程（摘要 + 逐文件审查）
      await codeReview(execCtx, bots.lightBot, bots.heavyBot, options, prompts)
    } else if (
      execCtx.eventKind === 'comment_created' ||
      execCtx.eventKind === 'review_comment_created'
    ) {
      // 评论事件（顶层 issue_comment 或 review comment）
      // 先走命令调度，未命中命令时再透传给既有的对话式追问
      await handleCommentEvent({
        execCtx,
        options,
        prompts,
        getReviewBots: () => createBots(options)
      })
    } else {
      // metadata_updated（title/label/assignee 等元数据更新）或 unknown：
      // 不调用模型。当前 GitHub workflow 的 `types:` 触发器已过滤掉非
      // opened/synchronize/reopened 的 pull_request action，这里是防御性兜底。
      info(
        `Skipped: eventKind ${execCtx.eventKind} does not trigger model calls`
      )
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
// 注：故意不用顶层 `await run()` —— 顶层 await 在当前 ts-jest（CommonJS 转译）下无法编译，
// 导致 main.ts 完全无法被测试文件 import。run() 内部已自行 catch 所有异常并调用
// setFailed，不会向外抛出；文件末尾也没有后续语句依赖 run() 完成，因此改为立即执行的
// async 函数对 Action 运行时行为没有任何可观察影响（进程仍会等待未完成的 Promise 才退出）。
void (async (): Promise<void> => {
  try {
    await run()
  } catch (e: any) {
    warning(`Unhandled error in run(): ${e}`)
  }
})()
