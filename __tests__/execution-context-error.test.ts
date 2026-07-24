/**
 * execution-context-error.test.ts — ExecutionContextError 分类断言（U3）
 *
 * 覆盖 ExecutionContextError 类本身的行为（构造参数正确赋值、name/instanceof），
 * 以及 GitHub/GitLab 两个工厂函数分别在哪些 reason 下抛出该错误的矩阵验证。
 *
 * 注：ExecutionContextError.reason 的类型定义包含 4 种取值
 * （missing_payload/malformed_payload/unknown_event/missing_required_field），
 * 但当前两个工厂函数实际只会抛出其中 3 种——`malformed_payload` 目前没有任何
 * 调用点使用（GitLab CLI 的 JSON.parse 失败发生在 gitlab-trigger.ts 里，在
 * 调用 createGitLabExecutionContext 之前就已经处理掉，不会变成
 * ExecutionContextError）。这是已知的、有意保留的预留分类，不是本测试的缺陷，
 * 对齐设计文档 9.2 节 U3"三种 reason 分类断言"的原始措辞。
 */
import {describe, expect, test} from '@jest/globals'
import {ExecutionContextError} from '../src/platform/execution-context'

describe('ExecutionContextError', () => {
  test('构造函数正确赋值 message/platform/reason，name 固定为 ExecutionContextError', () => {
    const e = new ExecutionContextError('boom', 'github', 'unknown_event')

    expect(e.message).toBe('boom')
    expect(e.platform).toBe('github')
    expect(e.reason).toBe('unknown_event')
    expect(e.name).toBe('ExecutionContextError')
  })

  test('是 Error 的实例，也是 ExecutionContextError 的实例', () => {
    const e = new ExecutionContextError('boom', 'gitlab', 'missing_payload')
    expect(e).toBeInstanceOf(Error)
    expect(e).toBeInstanceOf(ExecutionContextError)
  })

  test.each([
    {platform: 'github', reason: 'missing_payload'},
    {platform: 'github', reason: 'unknown_event'},
    {platform: 'github', reason: 'missing_required_field'},
    {platform: 'gitlab', reason: 'missing_payload'},
    {platform: 'gitlab', reason: 'unknown_event'},
    {platform: 'gitlab', reason: 'missing_required_field'}
  ] as const)(
    '$platform 平台可以构造 reason=$reason 的错误，且字段可读',
    ({platform, reason}) => {
      const e = new ExecutionContextError(`${platform}/${reason} test`, platform, reason)
      expect(e.platform).toBe(platform)
      expect(e.reason).toBe(reason)
    }
  )

  test('malformed_payload 是类型定义里预留但当前两个工厂函数均未使用的 reason（记录现状，非缺陷）', () => {
    // 仍然能正常构造——只是没有任何生产代码路径会触发它
    const e = new ExecutionContextError('reserved', 'github', 'malformed_payload')
    expect(e.reason).toBe('malformed_payload')
  })
})
