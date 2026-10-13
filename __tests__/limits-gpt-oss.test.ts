/**
 * limits-gpt-oss.test.ts — gpt-oss 系列（含网关前缀别名）按 128K 上下文计算
 *
 * 未知模型会落到 1M 的默认值；gpt-oss 实际只有 128K，大 diff 会被网关以超长拒绝。
 */
import {describe, expect, test} from '@jest/globals'
import {TokenLimits} from '../src/limits'

describe('TokenLimits：gpt-oss', () => {
  test.each(['gpt-oss-120b', 'gpt-oss-20b', 'gw-gpt-oss-120b', 'gw-gpt-oss-20b'])(
    '%s → 128K',
    model => {
      const limits = new TokenLimits(model)
      expect(limits.maxTokens).toBe(131072)
      expect(limits.responseTokens).toBe(16384)
      expect(limits.requestTokens).toBe(131072 - 16384 - 100)
    }
  )

  test('未知模型仍用默认值（对照）', () => {
    expect(new TokenLimits('some-unknown-model').maxTokens).toBe(1047576)
  })
})
