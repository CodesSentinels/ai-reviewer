/**
 * gitlab-note-hook-parser-reuse.test.ts — EVENT-019 复用性确认（N8）
 *
 * 结论：`src/commands/parser.ts` 的 `parse(body, opts)` 只依赖评论正文字符串
 * 和 `registeredCommands`/`botMentions`（均为纯值，见 constants.ts 的
 * BOT_MENTIONS），不引用任何 GitHub 专有数据结构——可以直接对 GitLab note
 * 的 `object_attributes.note` 字段调用，不需要解耦或改造。
 *
 * 已发现的 GitHub 专属假设（记录但不在本任务内解耦，属于未来 CMD-003 范围）：
 * `commands/types.ts` 的 `CommandEventName` 类型固定为
 * 'issue_comment' | 'pull_request_review_comment'（GitHub webhook 事件名），
 * 被 `commands/dispatcher.ts`/`reaction.ts`/`early-reaction.ts`（命令路由/执行层，
 * 不是 parser 本身）使用。GitLab note 事件（top-level / discussion note）要接入
 * 这一层时，需要先给 CommandEventName 加上 GitLab 对应值或改为平台无关的
 * EventKind，这是 CMD-* 阶段的工作，不在 EVENT-019 范围内。
 *
 * 参考 docs/tasks/gitlab-note-hook-design.md 第 3.4 节。
 */
import {describe, expect, test} from '@jest/globals'
import {parse, type ParserOptions} from '../src/commands/parser'

import noteToplevel from './fixtures/gitlab-note-hook-toplevel.json'
import noteDiscussion from './fixtures/gitlab-note-hook-discussion.json'

const REGISTERED = new Set(['review', 'full review', 'resolve', 'summary'])
const opts: ParserOptions = {registeredCommands: REGISTERED}

describe('EVENT-019: commands/parser.ts 直接复用于 GitLab note body', () => {
  test('顶层 note body（"@ai-reviewer review"）→ 命中 review 命令，无需任何改造', () => {
    const body = (noteToplevel as any).object_attributes.note as string
    const outcome = parse(body, opts)

    expect(outcome.kind).toBe('command')
    expect(outcome.command?.name).toBe('review')
    expect(outcome.error).toBeUndefined()
  })

  test('discussion note body（自然语言提问，无命令）→ conversation fallback', () => {
    const body = (noteDiscussion as any).object_attributes.note as string
    const outcome = parse(body, opts)

    expect(outcome.kind).toBe('conversation')
  })

  test('不含 bot mention 的 note body → none（跟 GitHub 侧行为一致）', () => {
    const outcome = parse('just a regular MR comment', opts)
    expect(outcome.kind).toBe('none')
  })

  test('GitLab note 命令语法非法参数 → 同 GitHub 侧一样返回 INVALID_ARGS', () => {
    const outcome = parse('@ai-reviewer review $(rm -rf /)', opts)
    expect(outcome.kind).toBe('command')
    expect(outcome.error?.code).toBe('INVALID_ARGS')
  })
})
