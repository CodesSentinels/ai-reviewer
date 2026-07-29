/**
 * gitlab-trigger-redact.test.ts — redact() 脱敏断言（EVENT-005）
 *
 * c9672be 的提交信息里写"redact() 对 4 种 token 形态验证通过"，但那是手动
 * ts-node 验证，没有留下自动化测试。本文件把那 4 种形态转成 Jest 用例。
 */
import {describe, expect, test} from '@jest/globals'
import {redact} from '../src/gitlab-trigger-redact'

describe('redact()', () => {
  test('脱敏 GitLab PAT（glpat- 前缀）', () => {
    expect(redact('token=glpat-AbC123_-xyz failed')).toBe(
      'token=glpat-*** failed'
    )
  })

  test('脱敏 Bearer token（大小写不敏感）', () => {
    expect(redact('Authorization: bearer AbC123.def-456')).toBe(
      'Authorization: Bearer ***'
    )
  })

  test('脱敏 URL query 中的 token 参数', () => {
    expect(redact('https://gitlab.example.com/api?token=secret123&x=1')).toBe(
      'https://gitlab.example.com/api?token=***&x=1'
    )
  })

  test('脱敏 URL query 中的 private_token 参数', () => {
    expect(
      redact('https://gitlab.example.com/api?private_token=secret456')
    ).toBe('https://gitlab.example.com/api?private_token=***')
  })

  test('同一字符串中多种 token 形态同时出现，全部脱敏', () => {
    const input =
      'glpat-secret1 Bearer secret2 ?token=secret3&private_token=secret4'
    const result = redact(input)
    expect(result).not.toContain('secret1')
    expect(result).not.toContain('secret2')
    expect(result).not.toContain('secret3')
    expect(result).not.toContain('secret4')
  })

  test('不包含任何 token 形态的普通字符串原样返回', () => {
    expect(redact('plain error message, nothing sensitive')).toBe(
      'plain error message, nothing sensitive'
    )
  })
})
