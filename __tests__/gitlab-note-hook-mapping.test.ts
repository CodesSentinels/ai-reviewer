/**
 * gitlab-note-hook-mapping.test.ts — EVENT-014/015 结构性支持确认（M1 同款：
 * 不新增业务代码，只确认既有 comment 字段映射足够支撑命令识别/路由）
 *
 * `ExecutionContext.comment` 字段（kind: 'top_level' | 'review_thread'）已经
 * 能区分顶层 note 和 discussion note，真正的命令解析/路由复用 GitHub 侧既有的
 * commands/dispatcher.ts + commands/parser.ts（不改动，见 EVENT-019 测试）。
 * 参考 docs/tasks/gitlab-note-hook-design.md 第 3.1 节。
 */
import {describe, expect, test} from '@jest/globals'
import {createGitLabExecutionContext} from '../src/platform/gitlab-execution-context'

import noteToplevel from './fixtures/gitlab-note-hook-toplevel.json'
import noteDiscussion from './fixtures/gitlab-note-hook-discussion.json'

describe('EVENT-014: 顶层 MR note → comment.kind=top_level, eventKind=comment_created', () => {
  test('顶层 note（无 discussion_id）映射正确，且携带命令路由所需的全部字段', () => {
    const execCtx = createGitLabExecutionContext(noteToplevel)

    expect(execCtx.eventKind).toBe('comment_created')
    expect(execCtx.comment?.kind).toBe('top_level')
    expect(execCtx.comment?.threadId).toBeUndefined()
    // 命令解析器（EVENT-019）只依赖评论正文，不依赖 ExecutionContext 本身，
    // 这里确认原始 note body 保留在 raw 里，供 adapter 层取出后传给 parser
    expect((execCtx.raw as any).object_attributes.note).toBe('@ai-reviewer review')
  })
})

describe('EVENT-015: discussion note/reply → comment.kind=review_thread, eventKind=review_comment_created', () => {
  test('discussion 回复（有 discussion_id）映射正确，携带对话上下文所需的 threadId', () => {
    const execCtx = createGitLabExecutionContext(noteDiscussion)

    expect(execCtx.eventKind).toBe('review_comment_created')
    expect(execCtx.comment?.kind).toBe('review_thread')
    expect(execCtx.comment?.threadId).toBe('abc123discussionid')
  })
})
