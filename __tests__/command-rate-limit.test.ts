/**
 * command-rate-limit.test.ts — 速率限制（CMD-027~032）
 *
 * 原来的 key 是裸 actor 名，这三条基础用例只能证明「同一个人会被限、不同人不
 * 互扰」。双平台之后真正要防的是**串桶**：同一个人在两个平台、两个项目、两个
 * MR 上发命令，不应互相消耗配额。下面按维度逐个隔离验证（CMD-031）。
 */
import {describe, expect, test, beforeEach} from '@jest/globals'

import {
  checkRateLimit,
  rateLimitKey,
  _resetRateLimit,
  _bucketCount,
  _RATE_LIMIT_CONSTANTS,
  type RateLimitScope
} from '../src/commands/rate-limit'

const {MAX_PER_WINDOW, WINDOW_MS} = _RATE_LIMIT_CONSTANTS

/** 基准限流域，各用例只改其中一维 */
function scope(over: Partial<RateLimitScope> = {}): RateLimitScope {
  return {
    platform: 'github',
    projectPath: 'octo/demo',
    changeRequestId: 42,
    actor: 'alice',
    ...over
  }
}

/** 把某个域打满，返回下一次调用的时间戳 */
function saturate(s: RateLimitScope, t: number): number {
  for (let i = 0; i < MAX_PER_WINDOW; i++) {
    expect(checkRateLimit(s, t + i).allowed).toBe(true)
  }
  return t + MAX_PER_WINDOW
}

beforeEach(() => {
  _resetRateLimit()
})

describe('基础令牌桶行为', () => {
  test('前 N 次允许，第 N+1 次拒绝', () => {
    const next = saturate(scope(), 1_000_000)
    const blocked = checkRateLimit(scope(), next)

    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterMs).toBeGreaterThan(0)
  })

  test('窗口过后恢复', () => {
    const t = 2_000_000
    saturate(scope(), t)
    expect(checkRateLimit(scope(), t + MAX_PER_WINDOW).allowed).toBe(false)
    expect(checkRateLimit(scope(), t + WINDOW_MS + 1).allowed).toBe(true)
  })
})

describe('CMD-027/031：四个维度各自隔离', () => {
  /**
   * 逐维验证。每条都是「把基准域打满 → 只改这一维 → 仍应放行」，
   * 并顺带断言确实产生了两个桶——只看 allowed 有可能是别的原因放行的。
   */
  const dimensions: Array<[string, Partial<RateLimitScope>]> = [
    ['platform（同一人在 GitHub 与 GitLab）', {platform: 'gitlab'}],
    ['project（同一人在两个项目）', {projectPath: 'octo/other'}],
    ['changeRequestId（同一项目的两个 PR/MR）', {changeRequestId: 43}],
    ['actor（同一 MR 上的两个人）', {actor: 'bob'}]
  ]

  test.each(dimensions)('只改 %s → 不共享配额', (_label, diff) => {
    const t = 3_000_000
    const next = saturate(scope(), t)

    expect(checkRateLimit(scope(), next).allowed).toBe(false) // 基准域已满
    expect(checkRateLimit(scope(diff), next).allowed).toBe(true) // 换一维就放行
    expect(_bucketCount()).toBe(2)
  })

  test('四维全同才共享同一个桶（对照组：证明上面的放行不是因为永远不限）', () => {
    const t = 4_000_000
    const next = saturate(scope(), t)

    // 换个对象但四维取值一致 —— 必须命中同一个桶
    expect(checkRateLimit({...scope()}, next).allowed).toBe(false)
    expect(_bucketCount()).toBe(1)
  })

  test('GitLab 子组路径参与 key（group/sub/demo 与 group/demo 不同域）', () => {
    const t = 5_000_000
    const gitlab = scope({platform: 'gitlab', projectPath: 'group/sub/demo'})
    const next = saturate(gitlab, t)

    expect(checkRateLimit(gitlab, next).allowed).toBe(false)
    expect(
      checkRateLimit(scope({platform: 'gitlab', projectPath: 'group/demo'}), next).allowed
    ).toBe(true)
  })
})

describe('CMD-027：key 组装不可被段内容伪造', () => {
  /**
   * 各段单独 encodeURIComponent 再用 `:` 连接。若直接拼接，一个含分隔符的段就能
   * 把自己伪装成两段，让两组无关的取值撞进同一个桶。
   *
   * 下面这两组的**裸拼接结果完全相同**：
   *
   *   A  github : octo/demo:42 : 7  : alice    → github:octo/demo:42:7:alice
   *   B  github : octo/demo    : 42 : 7:alice  → github:octo/demo:42:7:alice
   *
   * 第一版用的是 (octo/demo:42, 7) 对 (octo/demo, 42)，裸拼接分别是
   * `...octo/demo:42:7:alice` 和 `...octo/demo:42:alice`——本来就不相等，
   * 所以那条断言不管有没有 encodeURIComponent 都会通过，证明不了任何事。
   */
  const collidingA = scope({projectPath: 'octo/demo:42', changeRequestId: 7, actor: 'alice'})
  const collidingB = scope({projectPath: 'octo/demo', changeRequestId: 42, actor: '7:alice'})

  function naiveKey(s: RateLimitScope): string {
    return [s.platform, s.projectPath, String(s.changeRequestId), s.actor].join(':')
  }

  test('前提：这两组用裸拼接确实会撞（否则下面的断言没有意义）', () => {
    expect(naiveKey(collidingA)).toBe(naiveKey(collidingB))
  })

  test('段内含分隔符时不会与另一组合撞 key', () => {
    expect(rateLimitKey(collidingA)).not.toBe(rateLimitKey(collidingB))
  })

  test('行为上也不共享配额（不只是字符串不同）', () => {
    const next = saturate(collidingA, 7_000_000)

    expect(checkRateLimit(collidingA, next).allowed).toBe(false)
    expect(checkRateLimit(collidingB, next).allowed).toBe(true)
    expect(_bucketCount()).toBe(2)
  })

  test('key 含全部四个维度', () => {
    // 解码后再断言，这条只管「四个维度都在」，不绑定具体编码方式——否则改动
    // 编码策略会让一条与编码无关的用例莫名其妙地红。
    const key = decodeURIComponent(rateLimitKey(scope({platform: 'gitlab', actor: 'bob'})))

    expect(key).toContain('gitlab')
    expect(key).toContain('bob')
    expect(key).toContain('42')
    expect(key).toContain('octo/demo')
  })
})

describe('CMD-029/032：这个实现的边界', () => {
  /**
   * 桶是纯进程内 Map。这条不是在测「功能」，是把 CMD-029 的声明钉住：新进程
   * 从零开始，所以它挡不住跨 run / 跨 pipeline 的连续评论——文档和用户可见
   * 文案都不得声称能挡。
   */
  test('重置后配额清零，等价于新进程从零开始（跨 run 不生效）', () => {
    const t = 6_000_000
    const next = saturate(scope(), t)
    expect(checkRateLimit(scope(), next).allowed).toBe(false)

    _resetRateLimit() // 模拟进程退出后的下一次 run

    expect(checkRateLimit(scope(), next).allowed).toBe(true)
    expect(_bucketCount()).toBe(1)
  })

  test('CMD-032：不依赖任何外部存储（模块只 import 类型）', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const source = require('fs').readFileSync('src/commands/rate-limit.ts', 'utf8') as string
    // 必须先剥注释再扫：文件头正写着「不引入 Redis、数据库…」，连注释一起扫
    // 会被自己的正确表述判为越界（这个坑踩过一次）。
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    const imports = code.match(/^import .*$/gm) ?? []

    // 唯一允许的是 type-only import
    expect(imports).not.toHaveLength(0)
    expect(imports.every(line => line.startsWith('import type '))).toBe(true)
    expect(code).not.toMatch(/redis|ioredis|mongodb|sqlite|require\(/i)
  })
})
