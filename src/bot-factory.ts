/**
 * bot-factory.ts — 双入口共享的 Bot 构造（ARCH-025）
 *
 * 原先这段逻辑写在 main.ts 里，用的是 GitHub 专用日志出口（actions-log）。
 * gitlab-trigger.ts 接入共享审查核心后需要同一份逻辑，于是抽出来，把日志出口
 * 变成参数——GitHub 入口传 actions-log 的 warning，GitLab 入口传 Logger.warning。
 *
 * 构造失败返回 null 而不是抛错：模型密钥缺失/无效属于配置问题，应当以「跳过本次
 * 审查」收场，而不是让整个 job 崩掉（这是 main.ts 的既有语义，原样保留）。
 */
import {Bot} from './bot'
import {OpenAIOptions, type Options} from './options'

export interface BotPair {
  lightBot: Bot
  heavyBot: Bot
}

export function createBots(options: Options, warn: (msg: string) => void): BotPair | null {
  let lightBot: Bot
  try {
    lightBot = new Bot(
      options,
      new OpenAIOptions(options.openaiLightModel, options.lightTokenLimits, false, false)
    )
  } catch (e: any) {
    warn(
      `Skipped: failed to create summary bot, please check your openai_api_key: ${e}, backtrace: ${e.stack}`
    )
    return null
  }

  let heavyBot: Bot
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
    warn(
      `Skipped: failed to create review bot, please check your openai_api_key: ${e}, backtrace: ${e.stack}`
    )
    return null
  }

  return {lightBot, heavyBot}
}
