/**
 * gitlab-execution-context.integration.test.ts — GitLab payload 字段完整性验证（I2）
 *
 * U2（gitlab-execution-context.test.ts）已经用同一批 fixture 做了逐场景的
 * 单元测试（每个用例只挑关键字段断言、验证特定分支行为）。本文件换一个角度：
 * 对全部 9 个共享 fixture 做一次性、完整字段快照比对——确保
 * createGitLabExecutionContext 产出的 ExecutionContext 对象里，
 * ExecutionContext 类型定义要求的每一个字段（platform/projectPath/projectId/
 * changeRequestId/eventKind/actor/baseSha/headSha/comment?/raw）在每个成功
 * 场景下都被正确、完整地填充，而不只是抽查过的那几个字段。
 *
 * 不接真实 GitLab（trigger CLI 尚未存在，见 EVENT-001~005），只用文档里
 * 整理的 payload 结构手工构造/复用的 fixture。
 *
 * 参考 docs/tasks/execution-context-design.md 第 9.3 节 I2。
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

const REQUIRED_FIELDS = [
  'platform',
  'projectPath',
  'projectId',
  'changeRequestId',
  'eventKind',
  'actor',
  'baseSha',
  'headSha',
  'raw'
] as const

describe('I2: GitLab fixture 全字段完整性快照', () => {
  test('MR open（gitlab-mr-hook-open.json）→ 完整字段快照', () => {
    const execCtx = createGitLabExecutionContext(mrOpen)
    expect(execCtx).toEqual({
      platform: 'gitlab',
      projectPath: 'octo/demo',
      projectId: '42',
      changeRequestId: 7,
      eventKind: 'pr_opened',
      actor: {login: 'alice', isBot: false},
      baseSha: '',
      headSha: 'head-sha-0001',
      raw: mrOpen
    })
  })

  test('MR update+SHA变化（gitlab-mr-hook-update-sha.json）→ 完整字段快照', () => {
    const execCtx = createGitLabExecutionContext(mrUpdateSha)
    expect(execCtx).toEqual({
      platform: 'gitlab',
      projectPath: 'octo/demo',
      projectId: '42',
      changeRequestId: 7,
      eventKind: 'pr_synchronize',
      actor: {login: 'alice', isBot: false},
      baseSha: 'head-sha-0001',
      headSha: 'head-sha-0002',
      raw: mrUpdateSha
    })
  })

  test('MR update+仅元数据（gitlab-mr-hook-update-meta.json）→ 完整字段快照', () => {
    const execCtx = createGitLabExecutionContext(mrUpdateMeta)
    expect(execCtx).toEqual({
      platform: 'gitlab',
      projectPath: 'octo/demo',
      projectId: '42',
      changeRequestId: 7,
      eventKind: 'metadata_updated',
      actor: {login: 'alice', isBot: false},
      baseSha: '',
      headSha: 'head-sha-0001',
      raw: mrUpdateMeta
    })
  })

  test('fork MR（gitlab-mr-hook-fork.json）→ 完整字段快照，projectPath/Id 取自 target project（顶层 project 字段）', () => {
    const execCtx = createGitLabExecutionContext(mrFork)
    expect(execCtx).toEqual({
      platform: 'gitlab',
      projectPath: 'octo/demo',
      projectId: '42',
      changeRequestId: 8,
      eventKind: 'pr_opened',
      actor: {login: 'bob', isBot: false},
      baseSha: '',
      headSha: 'head-sha-fork-0001',
      raw: mrFork
    })
  })

  test('Note create 顶层（gitlab-note-hook-toplevel.json）→ 完整字段快照', () => {
    const execCtx = createGitLabExecutionContext(noteToplevel)
    expect(execCtx).toEqual({
      platform: 'gitlab',
      projectPath: 'octo/demo',
      projectId: '42',
      changeRequestId: 7,
      eventKind: 'comment_created',
      actor: {login: 'alice', isBot: false},
      baseSha: '',
      headSha: 'head-sha-0001',
      comment: {kind: 'top_level', id: 5001, threadId: undefined},
      raw: noteToplevel
    })
  })

  test('Note create discussion 回复（gitlab-note-hook-discussion.json）→ 完整字段快照', () => {
    const execCtx = createGitLabExecutionContext(noteDiscussion)
    expect(execCtx).toEqual({
      platform: 'gitlab',
      projectPath: 'octo/demo',
      projectId: '42',
      changeRequestId: 7,
      eventKind: 'review_comment_created',
      actor: {login: 'alice', isBot: false},
      baseSha: '',
      headSha: 'head-sha-0001',
      comment: {
        kind: 'review_thread',
        id: 5002,
        threadId: 'abc123discussionid'
      },
      raw: noteDiscussion
    })
  })

  test.each([
    {
      label: '未知 object_kind',
      fixture: unknownEvent,
      expectedReason: 'unknown_event'
    },
    {
      label: '缺少 iid/source-target project',
      fixture: malformed,
      expectedReason: 'missing_required_field'
    },
    {
      label: 'note action != create（EVENT-016/017，修复 Issue #66）',
      fixture: noteNonCreate,
      expectedReason: 'ignorable_event'
    },
    {
      label: 'note system=true（EVENT-017）',
      fixture: noteSystem,
      expectedReason: 'ignorable_event'
    },
    {
      label: 'note noteable_type 非 MergeRequest（EVENT-017）',
      fixture: noteNonMr,
      expectedReason: 'ignorable_event'
    }
  ] as const)(
    '$label → 不产出 ExecutionContext，reason=$expectedReason',
    ({fixture, expectedReason}) => {
      expect(() => createGitLabExecutionContext(fixture)).toThrow(ExecutionContextError)
      try {
        createGitLabExecutionContext(fixture)
      } catch (e) {
        expect((e as ExecutionContextError).reason).toBe(expectedReason)
      }
    }
  )

  test('全部 6 个成功场景的 ExecutionContext 都包含类型定义要求的全部必需字段', () => {
    const successfulFixtures = [
      mrOpen,
      mrUpdateSha,
      mrUpdateMeta,
      mrFork,
      noteToplevel,
      noteDiscussion
    ]
    for (const fixture of successfulFixtures) {
      const execCtx = createGitLabExecutionContext(fixture)
      for (const field of REQUIRED_FIELDS) {
        expect(execCtx).toHaveProperty(field)
        expect((execCtx as any)[field]).not.toBeUndefined()
      }
    }
  })
})
