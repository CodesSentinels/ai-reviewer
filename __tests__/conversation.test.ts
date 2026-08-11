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
  commentTag: () => '<!-- BOT_COMMENT -->',
  commentReplyTag: () => '<!-- BOT_REPLY -->',
  summarizeTag: () => '<!-- SUMMARY -->',
  // 写新读旧：variants 同时含新旧两种形态（GH-014）
  stateMarkerVariantsFor: (name: string) =>
    name === 'comment'
      ? ['<!-- BOT_COMMENT -->', '<!-- LEGACY_BOT_COMMENT -->']
      : ['<!-- BOT_REPLY -->', '<!-- LEGACY_BOT_REPLY -->'],
  bodyHasMarker: (body: unknown, name: string) =>
    typeof body === 'string' &&
    (name === 'comment'
      ? body.includes('<!-- BOT_COMMENT -->') || body.includes('<!-- LEGACY_BOT_COMMENT -->')
      : body.includes('<!-- BOT_REPLY -->') || body.includes('<!-- LEGACY_BOT_REPLY -->'))
}))
jest.mock('../src/octokit', () => ({octokit: {}}))
jest.mock('../src/tokenizer', () => ({getTokenCount: () => 0}))

import {
  botCommentTagVariants,
  countBotTurns,
  isFollowUpQuestion,
  truncateConversationChain
} from '../src/conversation'

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

describe('GH-014: bot 标签在运行时解析且含历史形态', () => {
  test('botCommentTagVariants 返回 current + legacy 四种形态', () => {
    expect(botCommentTagVariants()).toEqual([
      '<!-- BOT_COMMENT -->',
      '<!-- LEGACY_BOT_COMMENT -->',
      '<!-- BOT_REPLY -->',
      '<!-- LEGACY_BOT_REPLY -->'
    ])
  })

  test('countBotTurns 统计到升级前发的 bot 评论（历史形态）', () => {
    const chain = [
      'bot: 回复一 <!-- LEGACY_BOT_REPLY -->',
      'user: 追问',
      'bot: 回复二 <!-- BOT_REPLY -->'
    ].join('\n---\n')

    expect(countBotTurns(chain)).toBe(2)
  })

  test('isFollowUpQuestion 把带历史标签的评论识别为 bot 自评论', () => {
    expect(
      isFollowUpQuestion({
        commentBody: '@ai-reviewer 这样改行吗 <!-- LEGACY_BOT_REPLY -->',
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
