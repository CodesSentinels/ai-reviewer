/**
 * command-rate-limit-platform.test.ts — 以平台评论记录为准的跨进程限流
 *
 * 回归：进程内令牌桶在 GitHub Actions / GitLab CI（一条事件一个进程）里永远是空的，
 * 用户 35 秒内连发 12 条 help，12 条全部被执行，没有任何限流或提示（FT-128）。
 */
import {describe, expect, test} from '@jest/globals'
import {
  checkBurstFromComments,
  mentionsBot,
  _RATE_LIMIT_CONSTANTS
} from '../src/commands/rate-limit'

const MENTIONS = ['@ai-reviewer', '@codesentinel']
const T0 = Date.parse('2026-10-13T08:00:00Z')

function cmd(id: number, atSec: number, author = 'alice', body = '@ai-reviewer help') {
  return {id, author, body, createdAt: new Date(T0 + atSec * 1000).toISOString()}
}

describe('mentionsBot', () => {
  test('带边界的 mention 命中', () => {
    expect(mentionsBot('@ai-reviewer help', MENTIONS)).toBe(true)
    expect(mentionsBot('请帮忙 @AI-Reviewer review', MENTIONS)).toBe(true)
  })
  test('邮箱 / 相似用户名不算', () => {
    expect(mentionsBot('contact dev@ai-reviewer.example', MENTIONS)).toBe(false)
    expect(mentionsBot('@ai-reviewerx help', MENTIONS)).toBe(false)
    expect(mentionsBot('@ai-reviewer-fake help', MENTIONS)).toBe(false)
    expect(mentionsBot('普通评论', MENTIONS)).toBe(false)
  })
})

describe('checkBurstFromComments', () => {
  const MAX = _RATE_LIMIT_CONSTANTS.MAX_PER_WINDOW

  test('35 秒内连发 12 条：前 10 条放行，第 11、12 条被拒（FT-128 回归）', () => {
    const comments = Array.from({length: 12}, (_, i) => cmd(100 + i, i * 3))
    const results = comments.map(c =>
      checkBurstFromComments({comments, actor: 'alice', commentId: c.id, botMentions: MENTIONS})
    )
    expect(results.slice(0, MAX).every(r => r.allowed)).toBe(true)
    expect(results.slice(MAX).every(r => !r.allowed)).toBe(true)
    expect(results[MAX].retryAfterMs).toBeGreaterThan(0)
  })

  test('每个进程看到的评论列表可能不完整：只数“不晚于这条”的评论，结果不变', () => {
    const all = Array.from({length: 12}, (_, i) => cmd(100 + i, i))
    // 处理第 11 条（下标 10）的进程在那一刻只看得到前 11 条
    const seen = all.slice(0, 11)
    const r = checkBurstFromComments({
      comments: seen,
      actor: 'alice',
      commentId: all[10].id,
      botMentions: MENTIONS
    })
    expect(r.allowed).toBe(false)
  })

  test('晚于当前这条的评论不影响判断（第 1 条不会因为后面发了很多条而被拒）', () => {
    const comments = Array.from({length: 15}, (_, i) => cmd(100 + i, i))
    const r = checkBurstFromComments({
      comments,
      actor: 'alice',
      commentId: 100,
      botMentions: MENTIONS
    })
    expect(r.allowed).toBe(true)
  })

  test('窗口外的旧评论不计数', () => {
    const old = Array.from({length: 12}, (_, i) => cmd(1 + i, -300 + i)) // 5 分钟前
    const now = cmd(500, 0)
    const r = checkBurstFromComments({
      comments: [...old, now],
      actor: 'alice',
      commentId: 500,
      botMentions: MENTIONS
    })
    expect(r.allowed).toBe(true)
  })

  test('不同用户互不影响；没有 @ bot 的普通评论不计数', () => {
    const others = Array.from({length: 12}, (_, i) => cmd(200 + i, i, 'bob'))
    const chatter = Array.from({length: 12}, (_, i) => cmd(300 + i, i, 'alice', '普通讨论'))
    const mine = cmd(400, 5)
    const r = checkBurstFromComments({
      comments: [...others, ...chatter, mine],
      actor: 'alice',
      commentId: 400,
      botMentions: MENTIONS
    })
    expect(r.allowed).toBe(true)
  })

  test('当前评论不在列表里（读写延迟）也能工作：补上它自己', () => {
    const nine = Array.from({length: 10}, (_, i) => cmd(100 + i, i))
    const r = checkBurstFromComments({
      comments: nine,
      actor: 'alice',
      commentId: 999,
      botMentions: MENTIONS,
      now: T0 + 20_000
    })
    expect(r.allowed).toBe(false) // 10 条 + 当前这条 = 11
  })

  test('作者大小写不敏感；恰好 10 条仍放行', () => {
    const comments = Array.from({length: MAX}, (_, i) => cmd(100 + i, i, 'Alice'))
    const r = checkBurstFromComments({
      comments,
      actor: 'alice',
      commentId: 100 + MAX - 1,
      botMentions: MENTIONS
    })
    expect(r.allowed).toBe(true)
  })
})
