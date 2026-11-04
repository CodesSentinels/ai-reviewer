/**
 * gitlab-config-display.test.ts — 配置在日志 / 评论中的展示
 *
 * - PathFilter 的展示形式（此前插值成 `[object Object]`）
 * - GitLab 侧展示与变量名不带 GitHub 字样：job 日志和 `configuration` 命令的
 *   评论都在 GitLab 上对用户可见
 */
import {describe, expect, test, beforeEach, afterEach} from '@jest/globals'
import * as fs from 'fs'
import * as path from 'path'
import {PathFilter} from '../src/options'
import {GitLabConfigProvider} from '../src/platform/gitlab-config-provider'
import {buildConfigurationMessage} from '../src/commands/handlers/configuration'

const TOUCHED = [
  'AI_REVIEWER_GITLAB_CONCURRENCY_LIMIT',
  'AI_REVIEWER_GITHUB_CONCURRENCY_LIMIT',
  'AI_REVIEWER_PATH_FILTERS',
  'AI_REVIEWER_SYSTEM_MESSAGE'
]
let saved: Record<string, string | undefined>

beforeEach(() => {
  saved = Object.fromEntries(TOUCHED.map(k => [k, process.env[k]]))
  for (const k of TOUCHED) delete process.env[k]
})

afterEach(() => {
  for (const k of TOUCHED) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

function printed(): string[] {
  const lines: string[] = []
  new GitLabConfigProvider().print(msg => lines.push(msg))
  return lines
}

describe('PathFilter#toString', () => {
  test('没有规则', () => {
    expect(String(new PathFilter())).toBe('(none)')
    expect(String(new PathFilter(['', '  ']))).toBe('(none)')
  })

  test('还原包含 / 排除规则', () => {
    expect(String(new PathFilter(['src/**', ' !dist/** ', '!**/*.lock']))).toBe(
      'src/**, !dist/**, !**/*.lock'
    )
  })
})

describe('GitLab 平台 API 并发上限变量', () => {
  test('读取 AI_REVIEWER_GITLAB_CONCURRENCY_LIMIT', () => {
    process.env.AI_REVIEWER_GITLAB_CONCURRENCY_LIMIT = '3'
    expect(new GitLabConfigProvider().getOptions().githubConcurrencyLimit).toBe(3)
  })

  test('不读取 GitHub 侧的变量名', () => {
    process.env.AI_REVIEWER_GITHUB_CONCURRENCY_LIMIT = '9'
    expect(new GitLabConfigProvider().getOptions().githubConcurrencyLimit).toBe(4)
  })

  // 读取的变量名会作为字符串字面量打进交付到 GitLab 的 bundle：不得带 GITHUB
  test('GitLab 配置源码中读取的变量名都不含 GITHUB', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../src/platform/gitlab-config-provider.ts'),
      'utf8'
    )
    const keys = [...src.matchAll(/['"`](AI_REVIEWER_[A-Z0-9_]+)['"`]/g)].map(m => m[1])
    expect(keys.length).toBeGreaterThan(20)
    expect(keys.filter(k => k.includes('GITHUB'))).toEqual([])
  })
})

describe('GitLab 配置日志', () => {
  test('path_filters 按规则展示', () => {
    process.env.AI_REVIEWER_PATH_FILTERS = 'src/**\n!dist/**'
    expect(printed()).toContain('  path_filters: src/**, !dist/**')
  })

  test('system_message 只标注是否自定义，不打印原文', () => {
    expect(printed()).toContain('  system_message: (default)')
    process.env.AI_REVIEWER_SYSTEM_MESSAGE = 'You are a careful reviewer. SECRET-PROMPT-TEXT'
    const lines = printed()
    expect(lines).toContain('  system_message: (custom)')
    expect(lines.join('\n')).not.toContain('SECRET-PROMPT-TEXT')
  })

  test('默认配置下整段日志不含 GitHub 字样', () => {
    expect(printed().join('\n')).not.toMatch(/github/i)
  })

  test('并发上限以 GitLab 名称展示', () => {
    expect(printed()).toContain('  gitlab_concurrency_limit: 4')
  })
})

describe('configuration 命令输出', () => {
  const options = new GitLabConfigProvider().getOptions()

  test('GitLab 上不含 GitHub 字样，并发上限指向 GitLab 变量', () => {
    const msg = buildConfigurationMessage('gitlab', options, 'active', {})
    expect(msg).not.toMatch(/github/i)
    expect(msg).toContain('| gitlab_concurrency_limit |')
    expect(msg).toContain('AI_REVIEWER_GITLAB_CONCURRENCY_LIMIT')
  })

  test('GitLab 上显式设置了新变量时标为已配置', () => {
    const msg = buildConfigurationMessage('gitlab', options, 'active', {
      AI_REVIEWER_GITLAB_CONCURRENCY_LIMIT: '3'
    })
    const row = msg.split('\n').find(l => l.startsWith('| gitlab_concurrency_limit |')) ?? ''
    expect(row).not.toContain('默认值')
  })

  test('GitHub 上保持 action input 名', () => {
    const msg = buildConfigurationMessage('github', options, 'active', {})
    expect(msg).toContain('| github_concurrency_limit |')
  })
})
