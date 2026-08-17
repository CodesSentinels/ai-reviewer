/**
 * command-dispatcher.test.ts — 调度主流程集成测试（基于 mock）
 *
 * 覆盖:
 * - 非支持事件/action → ignored
 * - bot 自评论 → ignored
 * - 未命中命令 → fallback_conversation
 * - 命令命中但未注册 → UNKNOWN_COMMAND（其实用非法命令名构造比较难，因为 parser 先拦截；这里用注销的 handler 场景）
 * - 命令权限不足 → FORBIDDEN
 * - 命令非法参数 → INVALID_ARGS
 * - 命令成功执行 → ok
 * - 未实现 handler 抛 code=NOT_IMPLEMENTED → NOT_IMPLEMENTED
 * - 幂等重复 → DUPLICATE
 */
import {describe, expect, test, beforeEach, jest} from '@jest/globals'

// --- mocks ---
// ARCH-005 迁移后 dispatcher 不再读 @actions/github，事件坐标一律来自
// ExecutionContext。原先这里 mock 的 context.payload 正是 GitLab 用不了、
// 也让本文件看不见「GitLab 一 import 就崩」的那个依赖。
import type {ExecutionContext} from '../src/platform/execution-context'
import {setExecCtx} from '../src/platform/run-context'

let currentCtx: ExecutionContext

jest.mock('../src/platform/logger', () => ({
  getLogger: () => ({
    info: jest.fn(),
    warning: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })
}))

const platformState: Record<string, any> = {
  listComments: jest.fn(),
  createComment: jest.fn(),
  updateComment: jest.fn(),
  getCollaboratorPermission: jest.fn(),
  getChangeRequest: jest.fn(),
  updateChangeRequestBody: jest.fn(),
  replyToReviewComment: jest.fn(),
  addReaction: jest.fn()
}

jest.mock('../src/platform/git-platform', () => ({
  getPlatform: () => platformState
}))

// ---
import {dispatchCommentEvent} from '../src/commands/dispatcher'
import {getRegistry} from '../src/commands/registry'
import {_resetBootstrap, bootstrapCommands} from '../src/commands/bootstrap'
import {_resetPermissionCache} from '../src/commands/permission'
import {_resetRateLimit} from '../src/commands/rate-limit'

// 一个最小的 Options 存根；dispatcher 只是传递不使用
const stubOptions: any = {commandAckReaction: 'eyes'}

/**
 * 把原有的「事件名 + payload」测试数据映射成 ExecutionContext。
 *
 * 保留 payload 形状是为了让用例意图保持原样可读；构造期才做的判断
 * （action != created、issue_comment 挂在非 PR issue 上）已由
 * createGitHubExecutionContext 负责，对应覆盖在 github-execution-context.test.ts。
 */
function setEvent(
  eventName: 'issue_comment' | 'pull_request_review_comment' | 'push',
  payload: any
) {
  const eventKind: ExecutionContext['eventKind'] =
    eventName === 'issue_comment'
      ? 'comment_created'
      : eventName === 'pull_request_review_comment'
      ? 'review_comment_created'
      : 'unknown'

  const pr = payload.issue ?? payload.pull_request
  const comment = payload.comment
  const login: string = comment?.user?.login ?? ''

  currentCtx = {
    platform: 'github',
    projectPath: 'octo/demo',
    projectId: 'octo/demo',
    changeRequestId: pr?.number ?? 0,
    eventKind,
    actor: {
      login,
      isBot: comment?.user?.type === 'Bot' || /\[bot\]$/i.test(login)
    },
    baseSha: '',
    headSha: '',
    comment:
      comment == null
        ? undefined
        : {
            kind: eventName === 'pull_request_review_comment' ? 'review_thread' : 'top_level',
            id: comment.id,
            body: comment.body,
            nodeId: comment.node_id
          },
    raw: payload
  } as ExecutionContext

  // handler 内部的 Commenter 拿不到 execCtx 参数，读的是模块级上下文——
  // 入口在生产里也是这么注入的（main.ts / gitlab-trigger.ts）
  setExecCtx(currentCtx)
}

function buildIssueCommentPayload(body: string, overrides: any = {}) {
  return {
    action: 'created',
    issue: {
      number: 42,
      pull_request: {},
      user: {login: 'pr-author'}
    },
    comment: {
      id: 1001,
      body,
      user: {login: 'alice', type: 'User'}
    },
    ...overrides
  }
}

function buildReviewCommentPayload(body: string) {
  return {
    action: 'created',
    pull_request: {
      number: 42,
      head: {sha: 'head-sha'},
      base: {sha: 'base-sha'},
      user: {login: 'pr-author'}
    },
    comment: {
      id: 2002,
      body,
      user: {login: 'alice', type: 'User'},
      node_id: 'NODE1'
    }
  }
}

beforeEach(() => {
  _resetBootstrap()
  _resetPermissionCache()
  _resetRateLimit()
  bootstrapCommands()

  for (const key of Object.keys(platformState)) {
    platformState[key].mockReset()
  }

  // 默认: 不存在已处理标记
  platformState.listComments.mockResolvedValue([])
  platformState.createComment.mockResolvedValue({
    id: 9000,
    body: '',
    author: ''
  })
  platformState.updateComment.mockResolvedValue(undefined)
  platformState.getChangeRequest.mockResolvedValue({
    number: 42,
    title: '',
    body: 'PR body',
    state: 'open',
    baseSha: 'base-sha',
    headSha: 'head-sha',
    baseRef: 'main',
    headRef: 'feature',
    author: 'pr-author'
  })
  platformState.replyToReviewComment.mockResolvedValue({
    id: 9001,
    body: '',
    author: ''
  })
  platformState.addReaction.mockResolvedValue(undefined)
  platformState.updateChangeRequestBody.mockResolvedValue(undefined)
  // 默认: alice 有 write 权限
  platformState.getCollaboratorPermission.mockResolvedValue('write')
})

describe('dispatcher — 事件过滤', () => {
  test('非支持事件 → ignored', async () => {
    setEvent('push', {action: 'created'})
    const r = await dispatchCommentEvent({execCtx: currentCtx, options: stubOptions})
    expect(r.kind).toBe('ignored')
  })

  /**
   * 「action != created」和「issue_comment 挂在非 PR issue 上」这两条原本在本文件，
   * ARCH-005 迁移后判断上移到 createGitHubExecutionContext 的构造阶段
   * （抛 ExecutionContextError(ignorable_event)，调用方优雅跳过）。
   *
   * 覆盖没有消失，搬到了逻辑所在的那一层：
   *   github-execution-context.test.ts『issue_comment action=edited → ignorable_event』
   *   github-execution-context.test.ts『issue_comment 但 issue 上没有 pull_request』
   *
   * dispatcher 这一层剩下的契约只有一条：非评论类 eventKind 一律不处理。
   */
  test.each(['pr_opened', 'pr_synchronize', 'metadata_updated', 'unknown'] as const)(
    'eventKind=%s（非评论事件）→ ignored',
    async kind => {
      setEvent('issue_comment', buildIssueCommentPayload('@ai-reviewer help'))
      currentCtx = {...currentCtx, eventKind: kind} as ExecutionContext
      const r = await dispatchCommentEvent({execCtx: currentCtx, options: stubOptions})
      expect(r.kind).toBe('ignored')
      if (r.kind === 'ignored') expect(r.reason).toContain(kind)
    }
  )

  test('bot 评论自身 → ignored', async () => {
    const payload = buildIssueCommentPayload('@ai-reviewer help')
    payload.comment.user = {login: 'ai-reviewer[bot]', type: 'Bot'}
    setEvent('issue_comment', payload)
    const r = await dispatchCommentEvent({execCtx: currentCtx, options: stubOptions})
    expect(r.kind).toBe('ignored')
  })
})

describe('dispatcher — 解析与 fallback', () => {
  test('无 @bot → ignored', async () => {
    setEvent('issue_comment', buildIssueCommentPayload('普通评论'))
    const r = await dispatchCommentEvent({execCtx: currentCtx, options: stubOptions})
    expect(r.kind).toBe('ignored')
  })

  test('@bot 后跟自然语言（中文）→ fallback_conversation', async () => {
    setEvent('issue_comment', buildIssueCommentPayload('@ai-reviewer 这里为啥这样写？'))
    const r = await dispatchCommentEvent({execCtx: currentCtx, options: stubOptions})
    expect(r.kind).toBe('fallback_conversation')
  })

  test('@bot 后跟未知 ASCII 命令 → UNKNOWN_COMMAND with help listing and ACK reaction', async () => {
    setEvent('issue_comment', buildIssueCommentPayload('@ai-reviewer invalidcmd'))
    const r = await dispatchCommentEvent({execCtx: currentCtx, options: stubOptions})
    expect(r).toEqual({
      kind: 'executed',
      command: 'unknown',
      ok: false,
      error: 'UNKNOWN_COMMAND'
    })
    // 应添加 ACK reaction
    expect(platformState.addReaction).toHaveBeenCalled()
    // 应回复评论并包含支持的命令列表
    expect(platformState.createComment).toHaveBeenCalled()
    const body = platformState.createComment.mock.calls[0][3] // positional: (owner, repo, issueNumber, body)
    expect(body).toContain('invalidcmd')
    expect(body).toContain('commands I support')
  })

  test('review_comment 线程内回复（无 @bot）→ ignored（对话必须 @bot）', async () => {
    const payload = buildReviewCommentPayload('这个问题严重吗')
    ;(payload.comment as any).in_reply_to_id = 2001
    setEvent('pull_request_review_comment', payload)
    const r = await dispatchCommentEvent({execCtx: currentCtx, options: stubOptions})
    expect(r.kind).toBe('ignored')
  })

  test('review_comment 线程内回复（带 @bot 自然语言）→ fallback_conversation', async () => {
    const payload = buildReviewCommentPayload('@ai-reviewer 这个问题严重吗')
    ;(payload.comment as any).in_reply_to_id = 2001
    setEvent('pull_request_review_comment', payload)
    const r = await dispatchCommentEvent({execCtx: currentCtx, options: stubOptions})
    expect(r.kind).toBe('fallback_conversation')
  })

  test('review_comment 未知命令 → 回复到 thread 而非主评论区', async () => {
    setEvent('pull_request_review_comment', buildReviewCommentPayload('@ai-reviewer invalidcmd'))
    const r = await dispatchCommentEvent({execCtx: currentCtx, options: stubOptions})
    expect(r).toEqual({
      kind: 'executed',
      command: 'unknown',
      ok: false,
      error: 'UNKNOWN_COMMAND'
    })
    // 应添加 ACK reaction
    expect(platformState.addReaction).toHaveBeenCalled()
    // 应使用 replyToReviewComment 回复到 thread
    expect(platformState.replyToReviewComment).toHaveBeenCalled()
    // 不应使用 createComment
    expect(platformState.createComment).not.toHaveBeenCalled()
    const body = platformState.replyToReviewComment.mock.calls[0][4] // positional: (owner, repo, prNumber, commentId, body)
    expect(body).toContain('invalidcmd')
    expect(body).toContain('commands I support')
  })
})

describe('dispatcher — 命令执行', () => {
  test('help 命令成功执行', async () => {
    setEvent('issue_comment', buildIssueCommentPayload('@ai-reviewer help'))
    const r = await dispatchCommentEvent({execCtx: currentCtx, options: stubOptions})
    expect(r).toEqual({kind: 'executed', command: 'help', ok: true})
    expect(platformState.createComment).toHaveBeenCalled()
    // help handler 的响应 body 应包含 "支持的命令"
    const bodyArg = platformState.createComment.mock.calls[0][3] // positional: (owner, repo, issueNumber, body)
    expect(bodyArg).toMatch(/支持的命令/)
  })

  test('stub handler 抛 NOT_IMPLEMENTED', async () => {
    // resolve 已由成员 B 实现；改用成员 C 尚未实现的 review stub
    setEvent('issue_comment', buildIssueCommentPayload('@ai-reviewer review'))
    const r = await dispatchCommentEvent({execCtx: currentCtx, options: stubOptions})
    expect(r.kind).toBe('executed')
    if (r.kind === 'executed') {
      expect(r.ok).toBe(false)
      expect(r.error).toBe('NOT_IMPLEMENTED')
    }
    // 需要 ACK，所以先 create 后 update
    expect(platformState.createComment).toHaveBeenCalled()
    expect(platformState.updateComment).toHaveBeenCalled()
  })

  test('review_comment 上的 help 命令', async () => {
    setEvent('pull_request_review_comment', buildReviewCommentPayload('@ai-reviewer help'))
    const r = await dispatchCommentEvent({execCtx: currentCtx, options: stubOptions})
    expect(r.kind).toBe('executed')
  })

  test('非法参数 → INVALID_ARGS', async () => {
    setEvent('issue_comment', buildIssueCommentPayload('@ai-reviewer review $(whoami)'))
    const r = await dispatchCommentEvent({execCtx: currentCtx, options: stubOptions})
    expect(r.kind).toBe('executed')
    if (r.kind === 'executed') {
      expect(r.error).toBe('INVALID_ARGS')
    }
  })

  test('权限不足 → FORBIDDEN', async () => {
    platformState.getCollaboratorPermission.mockResolvedValue('read')
    // 用 pause 命令（无 PR 作者豁免）
    setEvent('issue_comment', buildIssueCommentPayload('@ai-reviewer pause'))
    const r = await dispatchCommentEvent({execCtx: currentCtx, options: stubOptions})
    expect(r.kind).toBe('executed')
    if (r.kind === 'executed') {
      expect(r.error).toBe('FORBIDDEN')
    }
  })

  test('PR 作者豁免可以跑 review（即使是 read 权限，但需 paused 状态）', async () => {
    platformState.getCollaboratorPermission.mockResolvedValue('read')
    // PR body 中包含 paused 状态标记
    platformState.getChangeRequest.mockResolvedValue({
      number: 42,
      title: '',
      body: '<!-- codesentinel-review-state:start -->\nstate: paused\n<!-- codesentinel-review-state:end -->',
      state: 'open',
      baseSha: 'base-sha',
      headSha: 'head-sha',
      baseRef: 'main',
      headRef: 'feature',
      author: 'pr-author'
    })
    const triggerReview: any = jest.fn().mockResolvedValue(undefined as never)
    // 让 alice 成为 PR 作者。ARCH-005 迁移后 prAuthor 不再取自 payload.issue.user，
    // 而是 getChangeRequest().author——payload 里的作者可能是缓存的旧值
    platformState.getChangeRequest.mockResolvedValue({
      number: 42,
      title: '',
      body: '<!-- codesentinel-review-state:start -->\nstate: paused\n<!-- codesentinel-review-state:end -->',
      state: 'open',
      baseSha: 'base-sha',
      headSha: 'head-sha',
      baseRef: 'main',
      headRef: 'feature',
      author: 'alice'
    })
    setEvent('issue_comment', buildIssueCommentPayload('@ai-reviewer review'))
    const r = await dispatchCommentEvent({
      execCtx: currentCtx,
      options: stubOptions,
      triggerReview
    })
    expect(r.kind).toBe('executed')
    if (r.kind === 'executed') {
      expect(r.ok).toBe(true)
    }
    expect(triggerReview).toHaveBeenCalledWith('incremental')
  })

  test('review 命令在非 paused 状态下返回提示信息', async () => {
    const triggerReview: any = jest.fn().mockResolvedValue(undefined as never)
    setEvent('issue_comment', buildIssueCommentPayload('@ai-reviewer review'))
    const r = await dispatchCommentEvent({execCtx: currentCtx, options: stubOptions, triggerReview})
    expect(r.kind).toBe('executed')
    if (r.kind === 'executed') {
      expect(r.ok).toBe(true)
    }
    expect(triggerReview).not.toHaveBeenCalled()
  })

  test('full review 命令触发全量审查', async () => {
    const triggerReview: any = jest.fn().mockResolvedValue(undefined as never)
    setEvent('issue_comment', buildIssueCommentPayload('@ai-reviewer full review'))
    const r = await dispatchCommentEvent({execCtx: currentCtx, options: stubOptions, triggerReview})
    expect(r).toEqual({kind: 'executed', command: 'full review', ok: true})
    expect(triggerReview).toHaveBeenCalledWith('full')
  })

  test('full review 命令：HEAD 已审查 → 不再重复触发', async () => {
    const triggerReview: any = jest.fn().mockResolvedValue(undefined as never)
    // 摘要评论已把 head-sha 记入已审查 commit 区块
    platformState.listComments.mockResolvedValue([
      {
        id: 555,
        body: `<!-- This is an auto-generated comment: summarize by AI Reviewer -->\n<!-- commit_ids_reviewed_start -->\n<!-- head-sha -->\n<!-- commit_ids_reviewed_end -->`,
        author: 'bot',
        nodeId: 'N555',
        createdAt: '2024-01-01T00:00:00Z'
      }
    ])
    setEvent('issue_comment', buildIssueCommentPayload('@ai-reviewer full review'))
    const r = await dispatchCommentEvent({execCtx: currentCtx, options: stubOptions, triggerReview})
    expect(r).toEqual({kind: 'executed', command: 'full review', ok: true})
    expect(triggerReview).not.toHaveBeenCalled()
  })

  test('summary 命令触发摘要重生成', async () => {
    const triggerReview: any = jest.fn().mockResolvedValue(undefined as never)
    setEvent('issue_comment', buildIssueCommentPayload('@ai-reviewer summary'))
    const r = await dispatchCommentEvent({execCtx: currentCtx, options: stubOptions, triggerReview})
    expect(r).toEqual({kind: 'executed', command: 'summary', ok: true})
    expect(triggerReview).toHaveBeenCalledWith('summary')
  })

  test('pause 命令写入暂停状态', async () => {
    // STATE-016：写入走「读最新 → 只改自己那段 → 写回 → 读回校验」，
    // 因此平台桩必须反映写入结果，否则校验读不到刚写的内容会判为并发冲突。
    // 静态只写桩模拟的是「写了但读不回来」的平台，那本来就该报失败。
    let storedBody = 'PR body'
    platformState.getChangeRequest.mockImplementation(async () => ({
      number: 42,
      title: '',
      body: storedBody,
      state: 'open',
      baseSha: 'base-sha',
      headSha: 'head-sha',
      baseRef: 'main',
      headRef: 'feature',
      author: 'pr-author'
    }))
    platformState.updateChangeRequestBody.mockImplementation(
      async (_o: any, _r: any, _n: any, body: string) => {
        storedBody = body
      }
    )

    setEvent('issue_comment', buildIssueCommentPayload('@ai-reviewer pause'))
    const r = await dispatchCommentEvent({execCtx: currentCtx, options: stubOptions})
    expect(r).toEqual({kind: 'executed', command: 'pause', ok: true})
    expect(platformState.updateChangeRequestBody).toHaveBeenCalled()
    const newBody = platformState.updateChangeRequestBody.mock.calls[0][3] // positional: (owner, repo, prNumber, body)
    expect(newBody).toContain('state: paused')
  })
})

describe('dispatcher — 幂等', () => {
  test('已有 CMD_REPLY_TAG 的评论 → DUPLICATE', async () => {
    // 模拟 listComments 返回包含标签的历史评论
    platformState.listComments.mockResolvedValue([
      {
        id: 800,
        body: '<!-- codesentinel-cmd-reply:1001:help -->\n之前的回复',
        author: 'bot',
        nodeId: 'N800',
        createdAt: '2024-01-01T00:00:00Z'
      }
    ])
    setEvent('issue_comment', buildIssueCommentPayload('@ai-reviewer help'))
    const r = await dispatchCommentEvent({execCtx: currentCtx, options: stubOptions})
    expect(r.kind).toBe('executed')
    if (r.kind === 'executed') {
      expect(r.error).toBe('DUPLICATE')
      expect(r.ok).toBe(false)
    }
    // 不应二次发布 create 评论
    expect(platformState.createComment).not.toHaveBeenCalled()
  })
})
