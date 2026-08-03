/**
 * gitlab-mr-hook-rules.test.ts — checkForkMergeRequest/isHeadStale/
 * buildMrIdempotencyKey 单元测试 + EVENT-011 不变量测试（M2/M3/M4/M5）
 *
 * 参考 docs/tasks/gitlab-mr-hook-design.md 第 3.2/3.3/3.4/3.5 节。
 */
import {describe, expect, test} from '@jest/globals'
import {
  checkForkMergeRequest,
  isHeadStale,
  buildMrIdempotencyKey
} from '../src/gitlab-mr-hook-rules'
import {createGitLabExecutionContext} from '../src/platform/gitlab-execution-context'

import mrOpen from './fixtures/gitlab-mr-hook-open.json'
import mrFork from './fixtures/gitlab-mr-hook-fork.json'

describe('EVENT-010: checkForkMergeRequest()', () => {
  test('source_project_id !== target_project_id → isFork:true，附带 reason', () => {
    const result = checkForkMergeRequest(99, 42)
    expect(result.isFork).toBe(true)
    expect(result.reason).toBe(
      'source_project_id(99) !== target_project_id(42)'
    )
  })

  test('source_project_id === target_project_id → isFork:false，reason 缺失', () => {
    const result = checkForkMergeRequest(42, 42)
    expect(result.isFork).toBe(false)
    expect(result.reason).toBeUndefined()
  })
})

describe('EVENT-011: fork 检测与 ExecutionContext 字段结构无关（不变量）', () => {
  test('同项目 MR 与 fork MR 构造出的 ExecutionContext 字段结构（key 集合）完全一致', () => {
    const same = createGitLabExecutionContext(mrOpen)
    const fork = createGitLabExecutionContext(mrFork)

    expect(Object.keys(same).sort()).toEqual(Object.keys(fork).sort())
    expect(typeof same.projectPath).toBe(typeof fork.projectPath)
    expect(typeof same.headSha).toBe(typeof fork.headSha)
    expect(typeof same.actor.login).toBe(typeof fork.actor.login)
    // fork 场景不会因为 source!=target 而跳过任何字段填充或改变类型
    expect(fork.eventKind).toBe(same.eventKind)
  })
})

describe('EVENT-012: isHeadStale()', () => {
  test('两个 headSha 相同 → stale:false', () => {
    const result = isHeadStale('sha-abc', 'sha-abc')
    expect(result.stale).toBe(false)
    expect(result.eventHeadSha).toBe('sha-abc')
    expect(result.currentHeadSha).toBe('sha-abc')
  })

  test('两个 headSha 不同 → stale:true', () => {
    const result = isHeadStale('sha-old', 'sha-new')
    expect(result.stale).toBe(true)
    expect(result.eventHeadSha).toBe('sha-old')
    expect(result.currentHeadSha).toBe('sha-new')
  })

  test('是纯函数：不发起任何网络/文件 IO，仅比较传入的两个字符串', () => {
    // 调用两次相同输入，结果应完全一致（无隐藏状态）
    const a = isHeadStale('x', 'y')
    const b = isHeadStale('x', 'y')
    expect(a).toEqual(b)
  })
})

describe('EVENT-013: buildMrIdempotencyKey()', () => {
  test('格式为 gitlab:{project_id}:{mr_iid}:head:{head_sha}', () => {
    expect(buildMrIdempotencyKey('42', 7, 'head-sha-0001')).toBe(
      'gitlab:42:7:head:head-sha-0001'
    )
  })

  test('不同 project_id/mr_iid/head_sha 组合产生不同的键（无碰撞）', () => {
    const a = buildMrIdempotencyKey('42', 7, 'sha-1')
    const b = buildMrIdempotencyKey('42', 8, 'sha-1')
    const c = buildMrIdempotencyKey('43', 7, 'sha-1')
    const d = buildMrIdempotencyKey('42', 7, 'sha-2')
    expect(new Set([a, b, c, d]).size).toBe(4)
  })
})
