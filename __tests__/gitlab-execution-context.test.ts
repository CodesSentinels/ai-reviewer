/**
 * gitlab-execution-context.test.ts — createGitLabExecutionContext() 单元测试（U2）
 *
 * 覆盖 MR open/reopen/update(HEAD变化)/update(仅元数据) + Note
 * create(top-level)/create(discussion回复)/非 create 动作/system note/非 MR
 * note/未知 object_kind，复用 __tests__/fixtures/ 下的共享 GitLab payload 样例
 * （阶段一 G4 产出，EVENT-016/017 补充了 system/non-mr 两个 fixture）。
 * 参考 docs/tasks/execution-context-design.md 第 9.2 节 U2、
 * docs/tasks/gitlab-note-hook-design.md 第 3.2 节（Issue #66 修复）。
 */
import {describe, expect, test} from '@jest/globals'
import {createGitLabExecutionContext} from '../src/platform/gitlab-execution-context'
import {ExecutionContextError} from '../src/platform/execution-context'

import mrOpen from './fixtures/gitlab-mr-hook-open.json'
import mrUpdateSha from './fixtures/gitlab-mr-hook-update-sha.json'
import mrUpdateMeta from './fixtures/gitlab-mr-hook-update-meta.json'
import mrFork from './fixtures/gitlab-mr-hook-fork.json'
import noteToplevel from './fixtures/gitlab-note-hook-toplevel.json'
import noteDiscussion from './fixtures/gitlab-note-hook-discussion.json'
import noteNonCreate from './fixtures/gitlab-note-hook-non-create.json'
import noteSystem from './fixtures/gitlab-note-hook-system.json'
import noteNonMr from './fixtures/gitlab-note-hook-non-mr.json'
import unknownEvent from './fixtures/gitlab-unknown-event.json'
import malformed from './fixtures/gitlab-malformed.json'

/** 捕获 fn 抛出的异常并返回，未抛出时让测试失败（避免依赖非标准全局 fail()） */
function getThrownError(fn: () => unknown): unknown {
  try {
    fn()
  } catch (e) {
    return e
  }
  throw new Error('Expected function to throw, but it did not')
}

describe('createGitLabExecutionContext()', () => {
  test('payload 为 null → ExecutionContextError(missing_payload)', () => {
    const e = getThrownError(() => createGitLabExecutionContext(null))
    expect(e).toBeInstanceOf(ExecutionContextError)
    expect((e as ExecutionContextError).platform).toBe('gitlab')
    expect((e as ExecutionContextError).reason).toBe('missing_payload')
  })

  test('payload 非对象（字符串）→ ExecutionContextError(missing_payload)', () => {
    const e = getThrownError(() => createGitLabExecutionContext('not-an-object'))
    expect(e).toBeInstanceOf(ExecutionContextError)
    expect((e as ExecutionContextError).reason).toBe('missing_payload')
  })

  test('未知 object_kind（如 pipeline）→ ExecutionContextError(unknown_event)', () => {
    const e = getThrownError(() => createGitLabExecutionContext(unknownEvent))
    expect(e).toBeInstanceOf(ExecutionContextError)
    expect((e as ExecutionContextError).reason).toBe('unknown_event')
  })

  test('MR open → eventKind=pr_opened，字段映射正确', () => {
    const execCtx = createGitLabExecutionContext(mrOpen)

    expect(execCtx.platform).toBe('gitlab')
    expect(execCtx.eventKind).toBe('pr_opened')
    expect(execCtx.projectPath).toBe('octo/demo')
    expect(execCtx.projectId).toBe('42')
    expect(execCtx.changeRequestId).toBe(7)
    expect(execCtx.actor).toEqual({login: 'alice', isBot: false})
    expect(execCtx.headSha).toBe('head-sha-0001')
    expect(execCtx.comment).toBeUndefined()
  })

  test('MR update 且 changes.last_commit 存在 → eventKind=pr_synchronize', () => {
    const execCtx = createGitLabExecutionContext(mrUpdateSha)

    expect(execCtx.eventKind).toBe('pr_synchronize')
    expect(execCtx.headSha).toBe('head-sha-0002')
    expect(execCtx.baseSha).toBe('head-sha-0001') // oldrev
  })

  test('MR update 且 changes 只含 title/labels → eventKind=metadata_updated', () => {
    const execCtx = createGitLabExecutionContext(mrUpdateMeta)
    expect(execCtx.eventKind).toBe('metadata_updated')
  })

  test('MR reopen → eventKind=pr_reopened', () => {
    const reopenPayload = {
      ...mrOpen,
      object_attributes: {
        ...(mrOpen as any).object_attributes,
        action: 'reopen'
      }
    }
    const execCtx = createGitLabExecutionContext(reopenPayload)
    expect(execCtx.eventKind).toBe('pr_reopened')
  })

  test('MR 缺少 object_attributes.iid → ExecutionContextError(missing_required_field)', () => {
    const e = getThrownError(() => createGitLabExecutionContext(malformed))
    expect(e).toBeInstanceOf(ExecutionContextError)
    expect((e as ExecutionContextError).reason).toBe('missing_required_field')
  })

  test('fork MR（source_project_id != target_project_id）→ 工厂函数本身不做 fork 拒绝，仍正常构造', () => {
    // ARCH-004 明确不实现 EVENT-010（fork 拒绝）；这里确认工厂函数没有意外提前实现该逻辑
    const execCtx = createGitLabExecutionContext(mrFork)
    expect(execCtx.eventKind).toBe('pr_opened')
    expect(execCtx.changeRequestId).toBe(8)
  })

  test('Note create（顶层）→ eventKind=comment_created，comment.kind=top_level', () => {
    const execCtx = createGitLabExecutionContext(noteToplevel)

    expect(execCtx.platform).toBe('gitlab')
    expect(execCtx.eventKind).toBe('comment_created')
    expect(execCtx.changeRequestId).toBe(7)
    expect(execCtx.headSha).toBe('head-sha-0001') // merge_request.diff_head_sha
    expect(execCtx.baseSha).toBe('')
    expect(execCtx.actor).toEqual({login: 'alice', isBot: false})
    expect(execCtx.comment).toEqual({
      kind: 'top_level',
      id: 5001,
      threadId: undefined
    })
  })

  test('Note create（discussion 回复）→ eventKind=review_comment_created，comment.kind=review_thread', () => {
    const execCtx = createGitLabExecutionContext(noteDiscussion)

    expect(execCtx.eventKind).toBe('review_comment_created')
    expect(execCtx.comment).toEqual({
      kind: 'review_thread',
      id: 5002,
      threadId: 'abc123discussionid'
    })
  })

  test('Note action != create → ExecutionContextError(ignorable_event)（修复 Issue #66：编辑/删除评论应优雅跳过而非 fail closed）', () => {
    const e = getThrownError(() => createGitLabExecutionContext(noteNonCreate))
    expect(e).toBeInstanceOf(ExecutionContextError)
    expect((e as ExecutionContextError).reason).toBe('ignorable_event')
  })

  test('Note system=true（系统事件note，如"changed the description"）→ ExecutionContextError(ignorable_event)', () => {
    const e = getThrownError(() => createGitLabExecutionContext(noteSystem))
    expect(e).toBeInstanceOf(ExecutionContextError)
    expect((e as ExecutionContextError).reason).toBe('ignorable_event')
  })

  test('Note noteable_type 不是 MergeRequest（如 Issue 上的评论）→ ExecutionContextError(ignorable_event)', () => {
    const e = getThrownError(() => createGitLabExecutionContext(noteNonMr))
    expect(e).toBeInstanceOf(ExecutionContextError)
    expect((e as ExecutionContextError).reason).toBe('ignorable_event')
  })

  test('Note 缺少 merge_request.iid → ExecutionContextError(missing_required_field)', () => {
    const payload = {
      object_kind: 'note',
      user: {username: 'alice'},
      project: {id: 42, path_with_namespace: 'octo/demo'},
      object_attributes: {
        id: 5001,
        action: 'create',
        noteable_type: 'MergeRequest'
      }
      // merge_request 字段整个缺失
    }
    const e = getThrownError(() => createGitLabExecutionContext(payload))
    expect(e).toBeInstanceOf(ExecutionContextError)
    expect((e as ExecutionContextError).reason).toBe('missing_required_field')
  })

  test('isBot 恒为 false（GitLab MVP 用个人 PAT，无天然 bot 标记，见 EVENT-018）', () => {
    const execCtx = createGitLabExecutionContext(mrOpen)
    expect(execCtx.actor.isBot).toBe(false)
  })
})
