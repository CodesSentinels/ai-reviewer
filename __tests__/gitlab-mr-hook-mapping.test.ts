/**
 * gitlab-mr-hook-mapping.test.ts — EVENT-006~009 既有映射的测试补强（M1）
 *
 * `mapMergeRequestAction()`（platform/gitlab-execution-context.ts）在
 * feat/gitlab-trigger-cli 分支就已实现，本文件不新增业务代码，只通过公开的
 * `createGitLabExecutionContext()` 补充此前未覆盖的边界场景：`changes` 缺失/
 * 只含 source_branch（强制推送）/其他 action 值。
 * 参考 docs/tasks/gitlab-mr-hook-design.md 第 3.1 节。
 */
import {describe, expect, test} from '@jest/globals'
import {createGitLabExecutionContext} from '../src/platform/gitlab-execution-context'

import mrOpen from './fixtures/gitlab-mr-hook-open.json'
import mrReopen from './fixtures/gitlab-mr-hook-reopen.json'
import mrUpdateSha from './fixtures/gitlab-mr-hook-update-sha.json'
import mrUpdateMeta from './fixtures/gitlab-mr-hook-update-meta.json'
import mrUpdateSourceBranchOnly from './fixtures/gitlab-mr-hook-update-source-branch-only.json'
import mrUpdateOldrevOnly from './fixtures/gitlab-mr-hook-update-oldrev-only.json'
import mrMergeAction from './fixtures/gitlab-mr-hook-merge-action.json'

describe('EVENT-006~009: MR action → eventKind 映射', () => {
  test('EVENT-006 action=open → pr_opened', () => {
    expect(createGitLabExecutionContext(mrOpen).eventKind).toBe('pr_opened')
  })

  test('EVENT-007 action=reopen → pr_reopened', () => {
    expect(createGitLabExecutionContext(mrReopen).eventKind).toBe('pr_reopened')
  })

  test('EVENT-008 action=update 且 changes.last_commit 存在 → pr_synchronize', () => {
    expect(createGitLabExecutionContext(mrUpdateSha).eventKind).toBe('pr_synchronize')
  })

  test('EVENT-008 action=update 且 changes 只含 source_branch（强制推送，last_commit 缺失）→ pr_synchronize', () => {
    expect(createGitLabExecutionContext(mrUpdateSourceBranchOnly).eventKind).toBe('pr_synchronize')
  })

  /**
   * 2026-08-05 复核指出的真实回归场景：`changes.last_commit`/
   * `changes.source_branch` 是否出现在真实 GitLab webhook 里并未被官方文档
   * 承诺，只有 `object_attributes.oldrev`（push 触发的 update 才会带这个字段）
   * 才是权威信号。此前的实现只看 `changes`，遇到 `changes` 为空但确实由 push
   * 触发（`oldrev` 存在）的场景会误判为 `metadata_updated` 而漏审。
   */
  test('EVENT-008 修复回归：oldrev 存在但 changes 为空（真实 push 场景）→ pr_synchronize，不再误判为 metadata_updated', () => {
    expect(createGitLabExecutionContext(mrUpdateOldrevOnly).eventKind).toBe('pr_synchronize')
  })

  test('EVENT-009 action=update 且 changes 为空对象 → metadata_updated', () => {
    const payload = {
      ...mrOpen,
      object_attributes: {
        ...(mrOpen as any).object_attributes,
        action: 'update'
      },
      changes: {}
    }
    expect(createGitLabExecutionContext(payload).eventKind).toBe('metadata_updated')
  })

  test('EVENT-009 action=update 且 changes 字段整体缺失（undefined）→ metadata_updated', () => {
    const payload: any = {
      ...mrOpen,
      object_attributes: {
        ...(mrOpen as any).object_attributes,
        action: 'update'
      }
    }
    delete payload.changes
    expect(createGitLabExecutionContext(payload).eventKind).toBe('metadata_updated')
  })

  test('EVENT-009 action=update 且 changes 只含 title/labels → metadata_updated', () => {
    expect(createGitLabExecutionContext(mrUpdateMeta).eventKind).toBe('metadata_updated')
  })

  test('action 为其他值（如 merge）→ unknown（不触发模型）', () => {
    expect(createGitLabExecutionContext(mrMergeAction).eventKind).toBe('unknown')
  })
})
