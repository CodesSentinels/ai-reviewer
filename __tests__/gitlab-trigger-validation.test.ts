/**
 * gitlab-trigger-validation.test.ts — validateTriggerPayload() 结构校验断言（EVENT-003）
 *
 * c9672be 只用 ts-node 手动跑通了 7 种场景，没有留下自动化测试。本文件补齐
 * 覆盖，复用与 gitlab-execution-context.test.ts 相同的共享 fixture。
 */
import {describe, expect, test} from '@jest/globals'
import {validateTriggerPayload} from '../src/gitlab-trigger-validation'

import mrOpen from './fixtures/gitlab-mr-hook-open.json'
import mrFork from './fixtures/gitlab-mr-hook-fork.json'
import malformed from './fixtures/gitlab-malformed.json'
import unknownEvent from './fixtures/gitlab-unknown-event.json'
import noteToplevel from './fixtures/gitlab-note-hook-toplevel.json'
import noteNonCreate from './fixtures/gitlab-note-hook-non-create.json'

describe('validateTriggerPayload()', () => {
  test('非对象 payload → ok:false', () => {
    expect(validateTriggerPayload(null)).toEqual({
      ok: false,
      reason: 'payload is not an object'
    })
    expect(validateTriggerPayload('string')).toEqual({
      ok: false,
      reason: 'payload is not an object'
    })
  })

  test('未知 object_kind → ok:true（粗过滤放行，交给 ECF 层的 unknown_event 分支处理）', () => {
    expect(validateTriggerPayload(unknownEvent)).toEqual({ok: true})
  })

  test('merge_request 正常场景（source==target）→ ok:true, sourceTargetMismatch:false', () => {
    expect(validateTriggerPayload(mrOpen)).toEqual({
      ok: true,
      sourceTargetMismatch: false
    })
  })

  test('merge_request fork 场景（source!=target）→ ok:true, sourceTargetMismatch:true', () => {
    expect(validateTriggerPayload(mrFork)).toEqual({
      ok: true,
      sourceTargetMismatch: true
    })
  })

  test('merge_request 缺少 iid/source_project_id/target_project_id → ok:false', () => {
    expect(validateTriggerPayload(malformed)).toEqual({
      ok: false,
      reason: 'missing object_attributes.iid'
    })
  })

  test('merge_request 缺少 project.id → ok:false', () => {
    const payload = {
      object_kind: 'merge_request',
      project: {},
      object_attributes: {iid: 1, source_project_id: 1, target_project_id: 1}
    }
    expect(validateTriggerPayload(payload)).toEqual({
      ok: false,
      reason: 'missing project.id'
    })
  })

  test('merge_request 有 iid 但缺少 source/target project id → ok:false', () => {
    const payload = {
      object_kind: 'merge_request',
      project: {id: 42},
      object_attributes: {iid: 1}
    }
    expect(validateTriggerPayload(payload)).toEqual({
      ok: false,
      reason: 'missing source_project_id/target_project_id'
    })
  })

  test('note 正常场景 → ok:true', () => {
    expect(validateTriggerPayload(noteToplevel)).toEqual({ok: true})
  })

  test('note action != create 仍通过结构校验（业务判断留给 ECF 层，即已知的 EVENT-016/017 缺口）→ ok:true', () => {
    expect(validateTriggerPayload(noteNonCreate)).toEqual({ok: true})
  })

  test('note 缺少 object_attributes.id → ok:false', () => {
    const payload = {
      object_kind: 'note',
      project: {id: 42},
      object_attributes: {},
      merge_request: {iid: 7}
    }
    expect(validateTriggerPayload(payload)).toEqual({
      ok: false,
      reason: 'missing object_attributes.id'
    })
  })

  test('note 缺少 merge_request.iid → ok:false', () => {
    const payload = {
      object_kind: 'note',
      project: {id: 42},
      object_attributes: {id: 1},
      merge_request: {}
    }
    expect(validateTriggerPayload(payload)).toEqual({
      ok: false,
      reason: 'missing merge_request.iid'
    })
  })

  test('note 缺少 project.id → ok:false', () => {
    const payload = {
      object_kind: 'note',
      project: {},
      object_attributes: {id: 1},
      merge_request: {iid: 7}
    }
    expect(validateTriggerPayload(payload)).toEqual({
      ok: false,
      reason: 'missing project.id'
    })
  })
})
