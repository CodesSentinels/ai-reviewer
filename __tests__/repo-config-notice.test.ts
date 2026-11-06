/**
 * repo-config-notice.test.ts — .ai-reviewer.yml 被丢弃 / 截断内容的提示评论（issue #231）
 */
import {describe, expect, test} from '@jest/globals'

import {buildRepoConfigNoticeBody} from '../src/review'

describe('buildRepoConfigNoticeBody', () => {
  test('没有 notices → 不发评论', () => {
    expect(buildRepoConfigNoticeBody([])).toBeNull()
  })

  test('逐条列出，并声明内置规则不可被覆盖', () => {
    const body = buildRepoConfigNoticeBody([
      'project_context: truncated (800 chars > 500)',
      'profile.languages: "rust" is not supported, ignored'
    ])!
    expect(body).toContain('.ai-reviewer.yml')
    expect(body).toContain('- project_context: truncated (800 chars > 500)')
    expect(body).toContain('- profile.languages: "rust" is not supported, ignored')
    expect(body).toContain('不能被仓库配置覆盖')
  })

  test('不含 GitHub 专有信息（GitLab 上禁止出现）', () => {
    const body = buildRepoConfigNoticeBody(['x'])!
    expect(body.toLowerCase()).not.toContain('github')
  })
})
