import {info, warning} from '@actions/core'
import type {CommandHandler, CommandContext, CommandResult} from '../types'
import {Bot} from '../../bot'
import {OpenAIOptions} from '../../options'
import {Prompts} from '../../prompts'
import {octokit} from '../../octokit'
import {PRIMARY_BOT_MENTION} from '../../constants'

export const explainHandler: CommandHandler = {
  name: 'explain',
  description:
    '以专家讲解模式解析 PR 业务逻辑，输出 Mermaid 数据流图 + 关键设计点',
  usage: `${PRIMARY_BOT_MENTION} explain`,
  needsAck: true,
  minPermission: 'read',
  execute
}

async function execute(ctx: CommandContext): Promise<CommandResult> {
  const {owner, repo, prNumber, baseSha, headSha, options} = ctx

  // 拉取 PR 元信息
  const prResp = await octokit.pulls.get({owner, repo, pull_number: prNumber})
  const title = prResp.data.title
  const description = prResp.data.body ?? ''

  // 获取 base → head 的完整 diff
  const compareResp = await octokit.repos.compareCommits({
    owner,
    repo,
    base: baseSha,
    head: headSha,
    mediaType: {format: 'diff'}
  })

  // compareCommits with format:'diff' 返回 raw diff 字符串
  const rawDiff = (compareResp.data as unknown as string)
  const diff = typeof rawDiff === 'string' ? rawDiff : buildPatchDiff(compareResp.data.files ?? [])

  if (!diff.trim()) {
    return {message: 'ℹ️ 当前 PR 没有可分析的代码变更'}
  }

  // 截断：避免超出 heavyBot token 上限（粗略按字符截到 80k）
  const truncatedDiff = diff.length > 80000
    ? diff.slice(0, 80000) + '\n\n[diff truncated — showing first 80k chars]'
    : diff

  info(`explain: diff length=${diff.length}, truncated=${diff.length > 80000}`)

  // 构建 heavyBot（与 main.ts 保持一致）
  let heavyBot: Bot
  try {
    heavyBot = new Bot(
      options,
      new OpenAIOptions(
        options.openaiHeavyModel,
        options.heavyTokenLimits,
        false, // web search 对 explain 无益
        false
      )
    )
  } catch (e) {
    warning(`explain: failed to create bot: ${e}`)
    return {message: '❌ 无法初始化 AI 模型，请检查 OPENAI_API_KEY 配置'}
  }

  const prompts = new Prompts()
  const prompt = prompts.renderExplainBusinessLogic(title, description, truncatedDiff)

  info(`explain: calling heavyBot for PR #${prNumber}`)
  const [response] = await heavyBot.chat(prompt, {})

  if (!response.trim()) {
    return {message: '❌ AI 未返回内容，请稍后重试'}
  }

  return {message: response}
}

// 当 mediaType:diff 未生效时的 fallback：把各文件 patch 拼接成 unified diff
function buildPatchDiff(
  files: Array<{filename: string; patch?: string}>
): string {
  return files
    .filter(f => f.patch)
    .map(f => `--- a/${f.filename}\n+++ b/${f.filename}\n${f.patch}`)
    .join('\n\n')
}
