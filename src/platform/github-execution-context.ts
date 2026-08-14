/**
 * platform/github-execution-context.ts - GitHub ExecutionContext 工厂（ARCH-003）
 *
 * 从 `@actions/github` context 和 `process.env.GITHUB_EVENT_NAME` 构造平台无关的
 * ExecutionContext，兼容现有 GitHub payload 和环境变量。不改变 `action.yml`/
 * Action inputs 的读取方式——那部分继续走 `@actions/core`（ConfigProvider 是
 * ARCH-007 的范围，不在本文件内）。
 *
 * 参考 docs/tasks/execution-context-design.md 第 4 节。
 */
import {context as githubContext} from '@actions/github'
import {
  type ActorInfo,
  type EventKind,
  type ExecutionContext,
  ExecutionContextError
} from './execution-context'

// 键名必须与真实 GitHub 事件名一致（camelcase 规则对 Record key 逐行豁免）

const EVENT_MAP: Record<string, (payload: any) => EventKind> = {
  // eslint-disable-next-line camelcase
  pull_request: mapPullRequestAction,
  // eslint-disable-next-line camelcase
  pull_request_target: mapPullRequestAction,
  // eslint-disable-next-line camelcase
  issue_comment: () => 'comment_created',
  // eslint-disable-next-line camelcase
  pull_request_review_comment: () => 'review_comment_created'
}

function mapPullRequestAction(payload: any): EventKind {
  switch (payload.action) {
    case 'opened':
      return 'pr_opened'
    case 'synchronize':
      return 'pr_synchronize'
    case 'reopened':
      return 'pr_reopened'
    default:
      // title/label/assignee 等元数据更新，不触发模型调用
      return 'metadata_updated'
  }
}

function makeActor(login: string | undefined | null, userType?: string | null): ActorInfo {
  const safeLogin = login ?? ''
  return {login: safeLogin, isBot: userType === 'Bot' || /\[bot\]$/i.test(safeLogin)}
}

/**
 * 从当前 GitHub Actions 运行时构造 ExecutionContext。
 *
 * @throws {ExecutionContextError} 事件类型未设置/不受支持，或 payload 缺少必需字段时
 */
export function createGitHubExecutionContext(): ExecutionContext {
  const eventName = process.env.GITHUB_EVENT_NAME
  if (eventName == null || eventName === '') {
    throw new ExecutionContextError('GITHUB_EVENT_NAME is not set', 'github', 'missing_payload')
  }

  const mapper = EVENT_MAP[eventName]
  if (mapper == null) {
    throw new ExecutionContextError(
      `Unsupported GitHub event: ${eventName}`,
      'github',
      'unknown_event'
    )
  }

  const {owner, repo} = githubContext.repo
  const eventKind = mapper(githubContext.payload)

  // pull_request* 事件
  if (eventKind !== 'comment_created' && eventKind !== 'review_comment_created') {
    const pr = (githubContext.payload as any).pull_request
    if (pr == null) {
      throw new ExecutionContextError(
        'pull_request payload missing',
        'github',
        'missing_required_field'
      )
    }
    return {
      platform: 'github',
      projectPath: `${owner}/${repo}`,
      projectId: `${owner}/${repo}`,
      changeRequestId: pr.number,
      eventKind,
      actor: makeActor(githubContext.actor),
      baseSha: pr.base.sha,
      headSha: pr.head.sha,
      raw: githubContext.payload
    }
  }

  // issue_comment / pull_request_review_comment 事件
  const payload = githubContext.payload as any
  const comment = payload.comment
  const prNumber = payload.issue?.number ?? payload.pull_request?.number
  if (comment == null || prNumber == null) {
    throw new ExecutionContextError(
      'comment payload missing required fields',
      'github',
      'missing_required_field'
    )
  }
  // 结构合法但业务上不需要处理：优雅跳过（与 GitLab 侧 EVENT-016/017、Issue #66
  // 同一模式）。这两条此前只在共享核心的 conversation.ts/early-reaction.ts 里各自
  // 靠读 execCtx.raw 判断（ARCH-005，GitHub Issue #88 P2 复核指出）——现在提到构造
  // 阶段统一判断，调用方不必再读 raw 就能拿到同样保证。
  if (payload.action !== 'created') {
    throw new ExecutionContextError(
      `comment action is '${payload.action}', not 'created' — ignorable`,
      'github',
      'ignorable_event'
    )
  }
  if (eventKind === 'comment_created' && payload.issue?.pull_request == null) {
    throw new ExecutionContextError(
      'issue_comment on non-PR issue — ignorable',
      'github',
      'ignorable_event'
    )
  }
  return {
    platform: 'github',
    projectPath: `${owner}/${repo}`,
    projectId: `${owner}/${repo}`,
    changeRequestId: prNumber,
    eventKind,
    actor: makeActor(comment.user?.login, comment.user?.type),
    // PR 事件的 base/head SHA 在评论事件里默认取不到，交由调用方在需要时
    // 另行查询当前 HEAD；此处留空字符串——与现状行为一致（resolve/summary
    // 等命令本就在执行时重新查询 HEAD，不依赖事件 payload 里的 SHA）。
    baseSha: '',
    headSha: '',
    comment: {
      kind: eventKind === 'review_comment_created' ? 'review_thread' : 'top_level',
      id: comment.id,
      body: typeof comment.body === 'string' ? comment.body : undefined,
      nodeId: typeof comment.node_id === 'string' ? comment.node_id : undefined
      // threadId 故意不填充——见 CommentRef.threadId 的文档注释（ARCH-021/Issue #88 P2）。
    },
    raw: githubContext.payload
  }
}
