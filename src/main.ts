/**
 * main.ts - GitHub Action 入口文件
 *
 * 整个 AI Reviewer 的启动入口，负责：
 * 1. 初始化 GitHub 平台的 Logger 和 ConfigProvider
 * 2. 调用共享编排层（ARCH-025）完成配置 → 上下文 → 事件分发
 * 3. 全局异常处理
 */
import {setFailed, warning} from '@actions/core'
import {Bot} from './bot'
import {tryEarlyReaction} from './commands/early-reaction'
import {OpenAIOptions, type Options} from './options'
import {createGitHubExecutionContext} from './platform/github-execution-context'
import {GitHubConfigProvider} from './platform/github-config-provider'
import {GitHubLogger} from './platform/github-logger'
import {setLogger} from './platform/logger'
import {runOrchestrator} from './platform/orchestrator'

function createBots(options: Options): {lightBot: Bot; heavyBot: Bot} | null {
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
  // 初始化 GitHub Logger（ARCH-013）
  setLogger(new GitHubLogger())

  await runOrchestrator({
    configProvider: new GitHubConfigProvider(),
    createExecCtx: createGitHubExecutionContext,
    logger: new GitHubLogger(),
    onFailed: setFailed,
    createBots,
    earlyReaction: tryEarlyReaction
  })
}

// 全局异常处理
process
  .on('unhandledRejection', (reason, p) => {
    warning(`Unhandled Rejection at Promise: ${reason}, promise is ${p}`)
  })
  .on('uncaughtException', (e: any) => {
    warning(`Uncaught Exception thrown: ${e}, backtrace: ${e.stack}`)
  })

// 启动主流程（不用顶层 await，ts-jest CommonJS 转译不支持）
void (async (): Promise<void> => {
  try {
    await run()
  } catch (e: any) {
    warning(`Unhandled error in run(): ${e}`)
  }
})()
