/**
 * commands/handlers/configuration.ts — 显示生效配置及其来源（CMD-022）
 *
 * 从 stubs.ts 转正，补上原实现缺的两件事：
 *
 *   1. **来源**。原来只有「配置 | 值」两列，用户看到 `max_files: 150` 也不知道
 *      该去哪儿改——GitHub 改 workflow 的 `with:`，GitLab 改 CI/CD 变量，两者
 *      的键名还不一样。现在每行都标出本平台的配置键，并区分「已显式配置」与
 *      「默认值」。
 *   2. **被强制覆盖的项要说清楚**。GitLab secret-bearing trigger 把
 *      `enable_shell` / `enable_lint_tools` 硬编码为 false（LOCAL-001/002），
 *      用户在 CI 变量里设了 true 也不会生效。只显示 `false` 而不说明原因，
 *      用户会反复怀疑自己没配对。
 *
 * 敏感项一律不显示（ARCH-011）：OpenAI Key、PAT、Trigger token 都不经过
 * ConfigProvider，本命令也只读 Options 上的非敏感字段。
 */
import type {CommandHandler, CommandContext, CommandResult} from '../types'
import type {Options} from '../../options'
import type {Platform} from '../../platform/execution-context'
import {getReviewState} from '../../review-state'
import {PRIMARY_BOT_MENTION} from '../../constants'

/**
 * 展示行定义。
 *
 * `key` 同时是 GitHub 的 action input 名和 GitLab 的 CI 变量后缀
 * （GitLab 侧统一是 `AI_REVIEWER_` + 大写），两个 provider 本来就按这套命名
 * 读取，所以一张表够用。
 *
 * 这张表只用于**展示**，不参与取值——取值一律来自已经构造好的 Options，
 * 所以它不会影响任何实际行为，最坏情况是显示的键名过时。
 * `configuration-rows.test.ts` 里有一条守卫盯着它与 Options 字段的对应关系。
 */
interface Row {
  key: string
  value: (o: Options) => unknown
  /** 该项在某些平台被强制覆盖时的说明 */
  forcedOn?: Partial<Record<Platform, string>>
}

const ROWS: Row[] = [
  {key: 'disable_review', value: o => o.disableReview},
  {key: 'disable_release_notes', value: o => o.disableReleaseNotes},
  {key: 'max_files', value: o => o.maxFiles},
  {key: 'review_simple_changes', value: o => o.reviewSimpleChanges},
  {key: 'review_comment_lgtm', value: o => o.reviewCommentLGTM},
  {key: 'max_review_comments', value: o => o.maxReviewComments},
  {key: 'openai_light_model', value: o => o.openaiLightModel},
  {key: 'openai_heavy_model', value: o => o.openaiHeavyModel},
  {key: 'openai_concurrency_limit', value: o => o.openaiConcurrencyLimit},
  {key: 'github_concurrency_limit', value: o => o.githubConcurrencyLimit},
  {key: 'enable_dependency_analysis', value: o => o.enableDependencyAnalysis},
  {key: 'max_dependency_files', value: o => o.maxDependencyFiles},
  {key: 'enable_web_search', value: o => o.enableWebSearch},
  {
    key: 'enable_shell',
    value: o => o.enableShell,
    forcedOn: {gitlab: 'trigger 强制关闭（LOCAL-001）'}
  },
  {
    key: 'enable_lint_tools',
    value: o => o.enableLintTools,
    forcedOn: {gitlab: 'trigger 强制关闭（LOCAL-002）'}
  },
  {key: 'language', value: o => o.language}
]

/** 本平台上这一项的配置键；顺便说明未显式配置时会落到默认值 */
export function describeSource(platform: Platform, key: string): string {
  return platform === 'gitlab'
    ? `CI 变量 \`AI_REVIEWER_${key.toUpperCase()}\``
    : `Action input \`${key}\``
}

/**
 * 描述这一项的取值来源。
 *
 * **只有 GitLab 能区分「显式配置」与「默认值」。** GitLab CI 只为用户真正定义过
 * 的变量注入环境变量，读不到就是没配。
 *
 * GitHub 不行：`action.yml` 里带 `default:` 的 input（本仓库 46 处）在 Actions
 * 运行时同样会展开成 `INPUT_<KEY>`，无论用户在 `with:` 里写没写。按环境变量有无
 * 判断，会把默认值一律标成「用户显式设置」——这比不标更糟，用户会照着一个并不
 * 存在的配置去找。所以 GitHub 侧只给键名，不声称能区分。
 *
 * 要真正区分得在 ConfigProvider 阶段留下来源元数据，那属于 §4，不在本章范围。
 */
export function describeValueSource(platform: Platform, key: string, env = process.env): string {
  const source = describeSource(platform, key)
  if (platform !== 'gitlab') return `${source}（或 action.yml 默认值）`

  const raw = env[`AI_REVIEWER_${key.toUpperCase()}`]
  return raw != null && raw.trim() !== '' ? source : `默认值（未设置 ${source}）`
}

export function buildConfigurationMessage(
  platform: Platform,
  options: Options,
  reviewState: string,
  env = process.env
): string {
  const lines: string[] = []
  lines.push('## 当前审查配置')
  lines.push('')
  lines.push(`平台：\`${platform}\``)
  lines.push('')
  lines.push('| 配置 | 生效值 | 来源 |')
  lines.push('| :--- | :--- | :--- |')
  lines.push(`| 自动审查状态 | \`${reviewState}\` | PR/MR 描述中的 reviewer 区块 |`)

  for (const row of ROWS) {
    const forced = row.forcedOn?.[platform]
    const source = forced ?? describeValueSource(platform, row.key, env)
    lines.push(`| ${row.key} | \`${String(row.value(options))}\` | ${source} |`)
  }

  lines.push('')
  lines.push(
    '> 仅显示生效后的非敏感配置。API Key、PAT、Trigger token 不经过配置层，也不会在此显示。'
  )
  return lines.join('\n')
}

export const configurationHandler: CommandHandler = {
  name: 'configuration',
  description: '显示当前仓库的审查配置',
  usage: `${PRIMARY_BOT_MENTION} configuration`,
  needsAck: false,
  // CMD-012：Reporter+。GitLab 的 REPORTER(20) 映射为 'triage'，
  // 与运行差异文档的权限基线一致。此前是 'read'，等于放行 GitLab GUEST。
  minPermission: 'triage',
  async execute(ctx: CommandContext): Promise<CommandResult> {
    const state = await getReviewState(ctx.owner, ctx.repo, ctx.prNumber)
    const platform = ctx.execCtx?.platform ?? 'github'
    return {message: buildConfigurationMessage(platform, ctx.options, state)}
  }
}
