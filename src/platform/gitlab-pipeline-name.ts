/**
 * gitlab-pipeline-name.ts - 给本次 trigger pipeline 起一个说明「在处理什么」的名字
 *
 * 业务项目的 Webhook 直接调用 Pipeline Trigger API，每投递一次就是一条 pipeline。
 * bot 自己改摘要、写描述、发行级评论也会被投递回来，于是一次 push 会带出 4~5 条
 * pipeline，列表里看起来全是同名的 `ai_review_trigger`，分不清谁在做什么。
 *
 * GitLab 无法在创建 pipeline 时按操作者过滤（webhook 没有这个选项，`rules:if`
 * 也读不到 file 类型的 TRIGGER_PAYLOAD），所以只能让每条 pipeline 跑完后自己
 * 报名字：
 *
 *   MR !15 @0aec0f4 · push → 审查完成，发布 1 条评论
 *   MR !15 @0aec0f4 · ↳ bot 更新摘要 · 已跳过
 *   MR !15 @0aec0f4 · ↳ bot 发布行级评论 · 已跳过
 *
 * 名字带 MR 编号 + HEAD 短 SHA，同一次 push 引出的几条在列表里自然排在一起。
 *
 * 全程 best effort：任何一步失败都只记日志，绝不影响审查本身的结果和退出码。
 * 名字只由 payload 的结构化字段和固定文案拼成，不包含评论正文等用户可控文本。
 */
import type {Logger} from './logger'
import {bodyHasMarker} from '../state-markers'
import {updatePipelineName, type GitLabApi, type GitLabClientConfig} from './gitlab-client'

/** GitLab 对 pipeline 名字的长度上限 */
const MAX_NAME_LENGTH = 255

/** 从 payload 读出的「是什么事件触发了这条 pipeline」 */
export interface TriggerDescription {
  /** MR 的 iid；payload 不是 MR 相关事件时为 null */
  mrIid: number | null
  /** MR 当前 HEAD 的完整 SHA；拿不到时为空串 */
  headSha: string
  /** 操作者是否是 reviewer 自己 */
  byBot: boolean
  /** 触发原因的短描述，如「push」「bot 更新摘要」 */
  label: string
}

/**
 * 读 payload 描述触发原因。
 *
 * 只依赖 payload 的结构化字段，不依赖 ExecutionContext：构造 ExecutionContext
 * 失败（无关事件、note 更新等）的那些 pipeline 恰恰最需要一个能看懂的名字。
 */
export function describeTrigger(payload: unknown, botLogins: string[]): TriggerDescription {
  const p = (payload ?? {}) as Record<string, any>
  const attrs = (p.object_attributes ?? {}) as Record<string, any>
  const actor = typeof p.user?.username === 'string' ? (p.user.username as string) : ''
  const byBot = actor !== '' && botLogins.some(login => login.toLowerCase() === actor.toLowerCase())

  if (p.object_kind === 'merge_request') {
    return {
      mrIid: toIid(attrs.iid),
      headSha: stringOr(attrs.last_commit?.id),
      byBot,
      label: mergeRequestLabel(attrs, byBot)
    }
  }

  if (p.object_kind === 'note') {
    const mr = (p.merge_request ?? {}) as Record<string, any>
    return {
      mrIid: toIid(mr.iid),
      headSha: stringOr(mr.last_commit?.id),
      byBot,
      label: noteLabel(attrs, byBot)
    }
  }

  return {mrIid: null, headSha: '', byBot, label: `事件 ${stringOr(p.object_kind) || '未知'}`}
}

function mergeRequestLabel(attrs: Record<string, any>, byBot: boolean): string {
  const action = stringOr(attrs.action)
  // bot 对 MR 本身的写操作只有改描述（发布说明、暂停 / 恢复状态）
  if (byBot) return 'bot 更新 MR 描述'
  switch (action) {
    case 'open':
      return 'MR 创建'
    case 'reopen':
      return 'MR 重新打开'
    case 'update':
      // 带 oldrev 才是推送了新提交；否则是标题、描述、标签等信息变更
      return stringOr(attrs.oldrev) !== '' ? 'push' : 'MR 信息更新'
    default:
      return action !== '' ? `MR ${action}` : 'MR 事件'
  }
}

function noteLabel(attrs: Record<string, any>, byBot: boolean): string {
  const updated = attrs.action === 'update'
  const isDiffNote = attrs.type === 'DiffNote'
  if (byBot) {
    if (bodyHasMarker(attrs.note, 'summarize')) return updated ? 'bot 更新摘要' : 'bot 发布摘要'
    if (updated) return 'bot 更新评论'
    return isDiffNote ? 'bot 发布行级评论' : 'bot 发布评论'
  }
  if (updated) return '评论被编辑'
  return isDiffNote ? '行级评论' : '评论'
}

function toIid(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isInteger(n) && n > 0 ? n : null
}

function stringOr(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/**
 * 收集这次运行的处理结论。
 *
 * 结论分散在共享核心的各个分支里（review.ts 十几处 `Skipped:` 提前返回、命令
 * 调度结果），逐处埋点侵入性太大。这些分支本来就都会打日志，而且用的是稳定的
 * 前缀约定，所以这里观察日志得出结论；`skip()` 留给入口里能直接判断的分支。
 * 观察不到任何信号时结论是「已处理」，不会猜错成别的。
 */
export class RunOutcome {
  private skipReason: string | null = null
  private reviewStarted = false
  private delivered: number | null = null
  private command: {name: string; ok: boolean} | null = null
  private conversation = false

  /** 入口里能直接判断的跳过（重复投递、HEAD 已变化等） */
  skip(reason: string): void {
    this.skipReason ??= reason
  }

  /** 观察一条日志，从中提取处理结论 */
  observe(msg: string): void {
    const skipped = /^Skipped: (.*)$/s.exec(msg)
    if (skipped != null) {
      this.skip(skipReasonOf(skipped[1]))
      return
    }
    if (msg.startsWith('Will review ')) {
      this.reviewStarted = true
      return
    }
    const submitted = /^Submitting review for PR #\d+, delivered: (\d+)/.exec(msg)
    if (submitted != null) {
      this.delivered = (this.delivered ?? 0) + Number(submitted[1])
      return
    }
    const dispatched = /^commentEvent dispatcher outcome: (.*)$/s.exec(msg)
    if (dispatched != null) this.observeDispatch(dispatched[1])
  }

  private observeDispatch(json: string): void {
    let outcome: Record<string, any>
    try {
      outcome = JSON.parse(json)
    } catch {
      return
    }
    if (outcome.kind === 'executed' && typeof outcome.command === 'string') {
      this.command = {name: outcome.command, ok: outcome.ok !== false}
    } else if (outcome.kind === 'fallback_conversation') {
      this.conversation = true
    } else if (outcome.kind === 'ignored') {
      this.skip('无需处理')
    }
  }

  /** 结论的短描述 */
  describe(failed: boolean): string {
    if (failed) return '失败'
    if (this.command != null) {
      return `命令 ${this.command.name} ${this.command.ok ? '完成' : '未完成'}`
    }
    if (this.conversation) return '已回复'
    // 审查跑完才算审查：审查中途 Skipped 的（无可审文件等）按跳过报告
    if (this.reviewStarted && this.skipReason == null) {
      return this.delivered != null && this.delivered > 0
        ? `审查完成，发布 ${this.delivered} 条评论`
        : '审查完成，无新评论'
    }
    if (this.skipReason != null) {
      return this.skipReason === '' ? '已跳过' : `已跳过：${this.skipReason}`
    }
    return '已处理'
  }
}

/** 把 `Skipped:` 后的英文原因归成几类中文短语；认不出的只报「已跳过」 */
function skipReasonOf(reason: string): string {
  const r = reason.toLowerCase()
  if (
    /files is null|no files to review|filterselectedfiles is null|files data is missing/.test(r)
  ) {
    return '无可审查文件'
  }
  if (r.includes('paused')) return '自动审查已暂停'
  if (r.includes('ignore_keyword')) return '描述含忽略关键词'
  return ''
}

/** 拼出 pipeline 名字 */
export function buildPipelineName(trigger: TriggerDescription, outcome: string): string {
  const where =
    trigger.mrIid != null
      ? `MR !${trigger.mrIid}${trigger.headSha !== '' ? ` @${trigger.headSha.slice(0, 7)}` : ''}`
      : 'AI 审查'
  // bot 自己的操作缩进一格，和引出它的那次用户操作区分开
  const what = trigger.byBot ? `↳ ${trigger.label}` : trigger.label
  const separator = trigger.byBot ? ' · ' : ' → '
  const name = `${where} · ${what}${separator}${outcome}`
  return name.length > MAX_NAME_LENGTH ? `${name.slice(0, MAX_NAME_LENGTH - 1)}…` : name
}

/** 改名请求的超时：展示性功能，不值得为它拖长 job */
const RENAME_TIMEOUT_MS = 10_000

/**
 * 给当前 pipeline 改名（请求经 gitlab-client 的 gitbeaker client 发出，见 GLAPI-031）。
 *
 * 凭据用专门的 AI_REVIEWER_PIPELINE_TOKEN：产物仓库的 Maintainer、api scope
 * （实测 Developer 调改名接口返回 403）。不复用 GITLAB_PAT：那是业务项目的凭据，对产物仓库没有权限，
 * 也不该为了一个展示功能扩大它的授权范围。没配置时不改名。
 */
export async function renamePipeline(
  name: string,
  logger: Logger,
  env: Record<string, string | undefined> = process.env,
  createClient?: (config: GitLabClientConfig) => Pick<GitLabApi, 'Pipelines'>
): Promise<void> {
  const token = (env.AI_REVIEWER_PIPELINE_TOKEN ?? '').trim()
  const host = env.CI_SERVER_URL
  const projectId = env.CI_PROJECT_ID
  const pipelineId = env.CI_PIPELINE_ID
  if (host == null || projectId == null || pipelineId == null) return // 不在 GitLab CI 里
  if (token === '') {
    logger.debug('pipeline name: AI_REVIEWER_PIPELINE_TOKEN is not set, keeping the default name')
    return
  }
  try {
    await updatePipelineName(
      {host, credential: {type: 'pat', value: token}, timeoutMS: RENAME_TIMEOUT_MS},
      {projectId, pipelineId, name},
      createClient
    )
  } catch (e) {
    logger.warning(`pipeline name: rename failed: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/** 包一层 Logger：照常输出，同时把每条日志交给 RunOutcome 观察 */
export function observingLogger(inner: Logger, outcome: RunOutcome): Logger {
  return {
    info: msg => {
      outcome.observe(msg)
      inner.info(msg)
    },
    warning: msg => {
      outcome.observe(msg)
      inner.warning(msg)
    },
    error: msg => inner.error(msg),
    debug: msg => inner.debug(msg)
  }
}
