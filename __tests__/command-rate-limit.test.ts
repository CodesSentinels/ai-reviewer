/**
 * command-rate-limit.test.ts — 速率限制单元测试
 */
import {describe, expect, test, beforeEach} from '@jest/globals'

import {
  checkRateLimit,
  _resetRateLimit,
  _RATE_LIMIT_CONSTANTS
} from '../src/commands/rate-limit'

describe('rate-limit', () => {
  beforeEach(() => {
    _resetRateLimit()
  })

  test('前 N 次允许，第 N+1 次拒绝', () => {
    const {MAX_PER_WINDOW} = _RATE_LIMIT_CONSTANTS
    const t = 1_000_000
    for (let i = 0; i < MAX_PER_WINDOW; i++) {
      expect(checkRateLimit('alice', t + i).allowed).toBe(true)
    }
    const blocked = checkRateLimit('alice', t + MAX_PER_WINDOW)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterMs).toBeGreaterThan(0)
  })

  test('窗口过后恢复', () => {
    const {MAX_PER_WINDOW, WINDOW_MS} = _RATE_LIMIT_CONSTANTS
    const t = 2_000_000
    for (let i = 0; i < MAX_PER_WINDOW; i++) {
      checkRateLimit('bob', t + i)
    }
    expect(checkRateLimit('bob', t + MAX_PER_WINDOW).allowed).toBe(false)
    // 前进一个完整窗口 + 1ms
    expect(checkRateLimit('bob', t + WINDOW_MS + 1).allowed).toBe(true)
  })

  test('不同用户独立计数', () => {
    const {MAX_PER_WINDOW} = _RATE_LIMIT_CONSTANTS
    const t = 3_000_000
    for (let i = 0; i < MAX_PER_WINDOW; i++) {
      checkRateLimit('alice', t + i)
    }
    expect(checkRateLimit('alice', t + MAX_PER_WINDOW).allowed).toBe(false)
    expect(checkRateLimit('charlie', t + MAX_PER_WINDOW).allowed).toBe(true)
  })
})
