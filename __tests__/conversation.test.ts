/**
 * conversation.test.ts — 对话式追问纯逻辑单元测试（成员 D · 2.3）
 *
 * 覆盖:
 * - 追问意图识别（mention / 进行中对话 / bot 自评论排除）
 * - 对话轮次统计（countBotTurns）
 * - 对话历史截断 + 摘要压缩（truncateConversationChain）
 */
import {describe, expect, test, jest} from '@jest/globals'

// 工厂 mock，避免加载真实 commenter / octokit / tokenizer 的副作用
jest.mock('../src/commenter', () => ({
  Commenter: class {},
  COMMENT_TAG: '<!-- BOT_COMMENT -->',
  COMMENT_REPLY_TAG: '<!-- BOT_REPLY -->',
  SUMMARIZE_TAG: '<!-- SUMMARY -->'
}))
jest.mock('../src/octokit', () => ({octokit: {}}))
jest.mock('../src/tokenizer', () => ({getTokenCount: () => 0}))

import {isFollowUpQuestion, countBotTurns, truncateConversationChain} from '../src/conversation'

const BOT_REPLY = '<!-- BOT_REPLY -->'
const BOT_COMMENT = '<!-- BOT_COMMENT -->'

describe('isFollowUpQuestion — 意图识别（必须 @bot）', () => {
  test('bot 自身评论不触发', () => {
    expect(
      isFollowUpQuestion({
        commentBody: '@ai-reviewer 在吗',
        authorIsBot: true
      })
    ).toBe(false)
  })

  test('显式 @ 机器人触发', () => {
    expect(
      isFollowUpQuestion({
        commentBody: '@ai-reviewer 为什么这样写？',
        authorIsBot: false
      })
    ).toBe(true)
  })

  test('支持 @codesentinel 别名', () => {
    expect(
      isFollowUpQuestion({
        commentBody: '@CodeSentinel 解释一下',
        authorIsBot: false
      })
    ).toBe(true)
  })

  test('续轮未 @bot 不触发（避免与真人评论冲突）', () => {
    expect(
      isFollowUpQuestion({
        commentBody: '还是不太懂',
        authorIsBot: false
      })
    ).toBe(false)
  })

  test('普通评论（无 mention）不触发', () => {
    expect(
      isFollowUpQuestion({
        commentBody: 'LGTM 我也觉得',
        authorIsBot: false
      })
    ).toBe(false)
  })

  test('评论携带 bot 标签视为 bot 文案，不触发', () => {
    expect(
      isFollowUpQuestion({
        commentBody: `回复内容 ${BOT_COMMENT}`,
        authorIsBot: false
      })
    ).toBe(false)
  })
})

describe('countBotTurns — 轮次统计', () => {
  test('统计 bot 标签出现次数', () => {
    const chain = `u: a\n---\nbot ${BOT_COMMENT}\n---\nu: b\n---\nbot ${BOT_REPLY}`
    expect(countBotTurns(chain)).toBe(2)
  })

  test('空链返回 0', () => {
    expect(countBotTurns('')).toBe(0)
  })
})

describe('truncateConversationChain — 截断与压缩', () => {
  test('短对话原样返回', () => {
    const chain = 'u: hi\n---\nbot: hello'
    expect(truncateConversationChain(chain, 1000)).toBe(chain)
  })

  test('超长对话保留最近内容并标注省略', () => {
    const turns = Array.from({length: 20}, (_, i) => `u: 第 ${i} 轮`.padEnd(50, 'x'))
    const chain = turns.join('\n---\n')
    const out = truncateConversationChain(chain, 200)
    expect(out.length).toBeLessThan(chain.length)
    expect(out).toContain('已省略')
    // 应保留最新一轮
    expect(out).toContain('第 19 轮')
  })

  test('预算极小也至少保留最新一轮', () => {
    const chain = 'u: old\n---\nu: newest content here'
    const out = truncateConversationChain(chain, 1)
    expect(out).toContain('newest content here')
  })
})
