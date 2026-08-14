/**
 * main.ts - GitHub Action 入口文件
 *
 * 整个 AI Reviewer 的启动入口，负责：
 * 1. 初始化 GitHub 平台的 Logger 和 ConfigProvider
 * 2. 调用共享编排层（ARCH-025）完成配置 → 上下文 → 事件分发
 * 3. 全局异常处理
 */
import {setFailed, warning} from './actions-log'
import {tryEarlyReaction} from './commands/early-reaction'
import {type Options} from './options'
import {createBots as createBotPair} from './bot-factory'
import {createGitHubExecutionContext} from './platform/github-execution-context'
import {GitHubConfigProvider} from './platform/github-config-provider'
import {GitHubLogger} from './platform/github-logger'
import {setPlatform} from './platform/git-platform'
import {setStateNamespace} from './platform/state-namespace'
import {GitHubPlatform} from './platform/github-platform'
import {setLogger} from './platform/logger'
import {runOrchestrator} from './platform/orchestrator'

async function run(): Promise<void> {
  // 初始化 GitHub Logger（ARCH-013）+ Platform（ARCH-018）
  setLogger(new GitHubLogger())
  setPlatform(new GitHubPlatform())
  // GH-014：本次运行写入的 marker / 幂等键带 github: 命名空间
  setStateNamespace('github')

  await runOrchestrator({
    configProvider: new GitHubConfigProvider(),
    createExecCtx: createGitHubExecutionContext,
    logger: new GitHubLogger(),
    onFailed: setFailed,
    createBots: (options: Options) => createBotPair(options, warning),
    earlyReaction: tryEarlyReaction
  })
}

// 全局异常处理
// GitHub Issue #88 P2 复核：这三处此前只 warning，不设 exitCode/setFailed——
// Node 一旦挂了 uncaughtException 监听器就不再默认崩溃退出，事件循环清空后照样
// 以 0（成功）退出，导致真正的意外异常在 GitHub Action 上显示假成功。改为
// setFailed()（内部会设 process.exitCode = 1），使这三条路径都 fail closed。
process
  .on('unhandledRejection', (reason, p) => {
    setFailed(`Unhandled Rejection at Promise: ${reason}, promise is ${p}`)
  })
  .on('uncaughtException', (e: any) => {
    setFailed(`Uncaught Exception thrown: ${e}, backtrace: ${e.stack}`)
  })

// 启动主流程（不用顶层 await，ts-jest CommonJS 转译不支持）
void (async (): Promise<void> => {
  try {
    await run()
  } catch (e: any) {
    setFailed(`Unhandled error in run(): ${e}`)
  }
})()
