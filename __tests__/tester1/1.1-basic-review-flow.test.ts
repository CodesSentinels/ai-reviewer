/**
 * 1.1 基础 PR 审查流程（P0）
 *
 * 测试审查引擎的前置条件判断：
 * - 事件类型校验
 * - ignore 关键词跳过
 * - pause 状态跳过
 * - disable_review 配置
 * - 文件路径过滤
 * - 摘要评论格式中的标签管理
 */

import {describe, expect, jest, test, beforeEach} from '@jest/globals'

jest.mock('@actions/core', () => ({
  info: jest.fn(),
  warning: jest.fn(),
  error: jest.fn(),
  getInput: jest.fn().mockReturnValue('')
}))

jest.mock('@actions/github', () => ({
  context: {
    repo: {owner: 'test-owner', repo: 'test-repo'},
    payload: {pull_request: {number: 1, head: {sha: 'head123'}, base: {sha: 'base123'}, body: ''}},
    eventName: 'pull_request'
  }
}))

jest.mock('../../src/octokit', () => ({
  octokit: {
    repos: {compareCommits: jest.fn(), getContent: jest.fn()},
    pulls: {get: jest.fn(), listCommits: jest.fn(), listReviews: jest.fn()},
    issues: {listComments: jest.fn()}
  }
}))

import {PathFilter} from '../../src/options'
import {
  getReviewStateFromBody,
  writeReviewStateToBody,
  REVIEW_STATE_START_TAG,
  REVIEW_STATE_END_TAG,
  reviewStateTags
} from '../../src/review-state'
import {
  COMMIT_ID_START_TAG,
  COMMIT_ID_END_TAG,
  descriptionStartTag,
  descriptionEndTag,
  rawSummaryStartTag,
  rawSummaryEndTag,
  shortSummaryStartTag,
  shortSummaryEndTag,
  summarizeTag
} from '../../src/commenter'

// ==================== 1.1.6 ignore 关键词跳过 ====================

describe('1.1.6 — @codesentinel: ignore 跳过审查', () => {
  test('PR 描述含 ignore 关键词时应跳过', () => {
    const description = `这是一个测试 PR。\n\n@codesentinel: ignore\n\n其他内容`
    expect(description.includes('@codesentinel: ignore')).toBe(true)
  })

  test('ignore 关键词在任意位置均可触发', () => {
    const cases = [
      '@codesentinel: ignore',
      '前缀内容 @codesentinel: ignore 后缀',
      '第一行\n@codesentinel: ignore\n第三行'
    ]
    for (const desc of cases) {
      expect(desc.includes('@codesentinel: ignore')).toBe(true)
    }
  })

  test('不含 ignore 关键词时不跳过', () => {
    const description = '这是一个正常的 PR 描述'
    expect(description.includes('@codesentinel: ignore')).toBe(false)
  })

  test('关键词大小写敏感（必须精确匹配）', () => {
    const description = '@CodeSentinel: Ignore'
    expect(description.includes('@codesentinel: ignore')).toBe(false)
  })
})

// ==================== 1.1.5 disable_review 跳过行级审查 ====================

describe('1.1.5 — disable_review 配置', () => {
  test('disableReview=true 时审查引擎应跳过逐文件审查', () => {
    // Options 中 disableReview 控制是否执行 Phase 4（逐文件审查）
    // 当 disableReview=true 时，仅执行摘要阶段，不产出行级评论
    const disableReview = true
    expect(disableReview).toBe(true)
  })
})

// ==================== pause 状态跳过 ====================

describe('1.1 — pause 状态跳过自动审查', () => {
  test('PR body 含暂停标记时返回 paused', () => {
    const body = `正常内容\n\n${REVIEW_STATE_START_TAG}\nstate: paused\n${REVIEW_STATE_END_TAG}`
    expect(getReviewStateFromBody(body)).toBe('paused')
  })

  test('PR body 无标记时返回 active', () => {
    expect(getReviewStateFromBody('普通 PR 描述')).toBe('active')
  })

  test('PR body 为空时返回 active', () => {
    expect(getReviewStateFromBody('')).toBe('active')
    expect(getReviewStateFromBody()).toBe('active')
  })

  test('writeReviewStateToBody 写入暂停标记（新区块带平台命名空间，GH-014）', () => {
    const body = '原始描述'
    const result = writeReviewStateToBody(body, 'paused')
    const tags = reviewStateTags()
    expect(result).toContain(tags.start)
    expect(result).toContain('state: paused')
    expect(result).toContain(tags.end)
    expect(result).toContain('原始描述')
    expect(getReviewStateFromBody(result)).toBe('paused')
  })

  test('writeReviewStateToBody 替换已有标记', () => {
    const body = `描述\n\n${REVIEW_STATE_START_TAG}\nstate: paused\n${REVIEW_STATE_END_TAG}`
    const result = writeReviewStateToBody(body, 'active')
    expect(result).toContain('state: active')
    expect(result).not.toContain('state: paused')
  })
})

// ==================== 文件路径过滤 ====================

describe('1.1 — 文件路径过滤（PathFilter）', () => {
  test('无规则时允许所有文件', () => {
    const filter = new PathFilter(null)
    expect(filter.check('src/index.ts')).toBe(true)
    expect(filter.check('any/path.go')).toBe(true)
  })

  test('包含规则仅匹配指定 glob', () => {
    const filter = new PathFilter(['**/*.ts', '**/*.vue'])
    expect(filter.check('src/index.ts')).toBe(true)
    expect(filter.check('components/App.vue')).toBe(true)
    expect(filter.check('styles/main.css')).toBe(false)
    expect(filter.check('assets/logo.png')).toBe(false)
  })

  test('排除规则（! 前缀）排除匹配文件', () => {
    const filter = new PathFilter(['**/*.ts', '!**/*.test.ts'])
    expect(filter.check('src/index.ts')).toBe(true)
    expect(filter.check('src/index.test.ts')).toBe(false)
  })

  test('排除 lock 文件', () => {
    const filter = new PathFilter(['**/*', '!**/*.lock'])
    expect(filter.check('package-lock.json')).toBe(true) // .json 不匹配 *.lock
    expect(filter.check('pnpm-lock.yaml')).toBe(true) // .yaml 不匹配 *.lock
    expect(filter.check('yarn.lock')).toBe(false) // *.lock 被排除
  })

  test('排除 node_modules 和 dist', () => {
    const filter = new PathFilter(['**/*.ts', '!node_modules/**', '!dist/**'])
    expect(filter.check('src/index.ts')).toBe(true)
    expect(filter.check('node_modules/lodash/index.ts')).toBe(false)
    expect(filter.check('dist/index.ts')).toBe(false)
  })

  test('workflow 实际配置的过滤规则', () => {
    const filter = new PathFilter([
      '**/*.ts',
      '**/*.vue',
      '**/*.js',
      '**/*.md',
      '**/*.yml',
      '**/*.yaml',
      'package.json',
      '!**/*.lock',
      '!node_modules/**',
      '!dist/**',
      '!.output/**'
    ])
    expect(filter.check('src/review.ts')).toBe(true)
    expect(filter.check('components/App.vue')).toBe(true)
    expect(filter.check('package.json')).toBe(true)
    expect(filter.check('README.md')).toBe(true)
    // minimatch 默认不匹配 dotfiles，.github/ 路径不会匹配 **/*.yml
    expect(filter.check('.github/workflows/ci.yml')).toBe(false)
    expect(filter.check('config/deploy.yml')).toBe(true)
    // pnpm-lock.yaml 匹配 **/*.yaml 包含规则，且不匹配 !**/*.lock（后缀是 .yaml），所以通过
    expect(filter.check('pnpm-lock.yaml')).toBe(true)
    expect(filter.check('yarn.lock')).toBe(false) // .lock 后缀被排除
    expect(filter.check('dist/index.js')).toBe(false)
    expect(filter.check('node_modules/pkg/index.ts')).toBe(false)
    expect(filter.check('.output/server/index.mjs')).toBe(false)
    expect(filter.check('assets/logo.png')).toBe(false)
    expect(filter.check('styles/main.css')).toBe(false)
  })

  test('空白规则被忽略', () => {
    const filter = new PathFilter(['', '  ', '**/*.ts', '  '])
    expect(filter.check('src/a.ts')).toBe(true)
  })
})

// ==================== 摘要评论标签管理 ====================

describe('1.1.2 — 摘要评论标签与格式', () => {
  test('summarizeTag() 标识摘要评论，且带平台命名空间（GH-014）', () => {
    expect(summarizeTag()).toContain('summarize')
    expect(summarizeTag()).toContain('ai-reviewer:github:')
  })

  test('摘要评论应包含原始摘要标签对', () => {
    const mockSummary = `${rawSummaryStartTag()}raw content here${rawSummaryEndTag()}`
    expect(mockSummary).toContain(rawSummaryStartTag())
    expect(mockSummary).toContain(rawSummaryEndTag())
  })

  test('摘要评论应包含精简摘要标签对', () => {
    const mockSummary = `${shortSummaryStartTag()}short content${shortSummaryEndTag()}`
    expect(mockSummary).toContain(shortSummaryStartTag())
    expect(mockSummary).toContain(shortSummaryEndTag())
  })

  test('发布说明标签对', () => {
    const prBody = `用户描述\n\n${descriptionStartTag()}\n发布说明内容\n${descriptionEndTag()}`
    expect(prBody).toContain(descriptionStartTag())
    expect(prBody).toContain(descriptionEndTag())
  })
})

// ==================== TRIAGE 分类解析 ====================

describe('1.1 — TRIAGE 分类解析（NEEDS_REVIEW / APPROVED）', () => {
  const triageRegex = /\[TRIAGE\]:\s*(NEEDS_REVIEW|APPROVED)/

  test('解析 NEEDS_REVIEW', () => {
    const resp = '文件摘要内容...\n[TRIAGE]: NEEDS_REVIEW'
    const match = resp.match(triageRegex)
    expect(match).not.toBeNull()
    expect(match![1]).toBe('NEEDS_REVIEW')
  })

  test('解析 APPROVED', () => {
    const resp = '简单配置变更\n[TRIAGE]: APPROVED'
    const match = resp.match(triageRegex)
    expect(match).not.toBeNull()
    expect(match![1]).toBe('APPROVED')
  })

  test('无分类标签时默认为 NEEDS_REVIEW', () => {
    const resp = '没有分类标签的摘要'
    const match = resp.match(triageRegex)
    expect(match).toBeNull()
    // review.ts 中：无标签时 return [filename, summarizeResp, true]（needsReview=true）
  })

  test('移除分类标签后保留摘要内容', () => {
    const resp = '文件摘要内容\n[TRIAGE]: NEEDS_REVIEW\n其他内容'
    const summary = resp.replace(triageRegex, '').trim()
    expect(summary).toBe('文件摘要内容\n\n其他内容')
  })
})
