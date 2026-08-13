/**
 * state-namespace.test.ts — marker / 幂等键的平台命名空间（GH-014 / GH-015）
 *
 * 两条不变式：
 * - 写入的状态 marker 一律带 `ai-reviewer:{platform}:` 前缀，两平台不会撞 key
 * - 匹配同时接受历史格式，升级当天在途 PR 不会「找不到自己写过的 marker」
 *   而重复回帖或重复审查
 */
import {describe, expect, test, afterEach} from '@jest/globals'
import {
  buildStateMarker,
  getStateNamespace,
  hasStateMarker,
  resetStateNamespace,
  setStateNamespace,
  stateMarkerVariants
} from '../src/platform/state-namespace'

afterEach(() => {
  resetStateNamespace()
})

describe('GH-014: 状态 marker 带平台命名空间', () => {
  test('默认命名空间为 github（历史行为）', () => {
    expect(getStateNamespace()).toBe('github')
    expect(buildStateMarker('cmd-reply', 1, 'help')).toBe(
      '<!-- ai-reviewer:github:cmd-reply:1:help -->'
    )
  })

  test('入口切换命名空间后，写入的 marker 随之变化', () => {
    setStateNamespace('gitlab')
    expect(buildStateMarker('cmd-reply', 1, 'help')).toBe(
      '<!-- ai-reviewer:gitlab:cmd-reply:1:help -->'
    )
  })

  test('同一 kind + 同一标识在两平台生成不同 marker（禁止跨平台合并状态）', () => {
    setStateNamespace('github')
    const githubMarker = buildStateMarker('conv-reply', 2001)
    setStateNamespace('gitlab')
    const gitlabMarker = buildStateMarker('conv-reply', 2001)

    expect(githubMarker).not.toBe(gitlabMarker)
    expect(hasStateMarker(`body ${githubMarker}`, [gitlabMarker])).toBe(false)
  })

  test('无附加标识时不产生多余分隔符', () => {
    expect(buildStateMarker('commit-ids-reviewed-start')).toBe(
      '<!-- ai-reviewer:github:commit-ids-reviewed-start -->'
    )
  })

  test('多段标识按顺序拼接', () => {
    expect(buildStateMarker('cmd-reply', 12345, 'full review')).toContain(':12345:full review')
  })
})

describe('GH-014: 写新读旧的兼容匹配', () => {
  const legacy = '<!-- codesentinel-cmd-reply:1:help -->'

  test('variants 同时含新格式与历史格式', () => {
    const variants = stateMarkerVariants('cmd-reply', legacy, 1, 'help')
    expect(variants).toEqual(['<!-- ai-reviewer:github:cmd-reply:1:help -->', legacy])
  })

  test('历史格式正文能被匹配到（在途 PR 不会被重复回帖）', () => {
    const variants = stateMarkerVariants('cmd-reply', legacy, 1, 'help')
    expect(hasStateMarker(`已回复 ${legacy}`, variants)).toBe(true)
  })

  test('新格式正文同样能被匹配到', () => {
    const variants = stateMarkerVariants('cmd-reply', legacy, 1, 'help')
    expect(hasStateMarker(`已回复 ${buildStateMarker('cmd-reply', 1, 'help')}`, variants)).toBe(
      true
    )
  })

  test('不同标识不误命中', () => {
    const variants = stateMarkerVariants('cmd-reply', legacy, 1, 'help')
    expect(hasStateMarker('<!-- codesentinel-cmd-reply:2:help -->', variants)).toBe(false)
    expect(hasStateMarker(buildStateMarker('cmd-reply', 2, 'help'), variants)).toBe(false)
  })

  test('非字符串正文安全返回 false', () => {
    const variants = stateMarkerVariants('cmd-reply', legacy, 1, 'help')
    expect(hasStateMarker(null, variants)).toBe(false)
    expect(hasStateMarker(undefined, variants)).toBe(false)
    expect(hasStateMarker(123, variants)).toBe(false)
  })
})

describe('GH-015: 平台间不读写对方的 marker', () => {
  test('GitHub 命名空间不匹配 GitLab 写入的 marker', () => {
    setStateNamespace('gitlab')
    const gitlabBody = `note ${buildStateMarker('conv-reply', 7)}`

    setStateNamespace('github')
    const githubVariants = stateMarkerVariants(
      'conv-reply',
      '<!-- codesentinel-conv-reply:7 -->',
      7
    )
    expect(hasStateMarker(gitlabBody, githubVariants)).toBe(false)
  })

  test('GitLab 命名空间不匹配 GitHub 写入的 marker', () => {
    setStateNamespace('github')
    const githubBody = `comment ${buildStateMarker('conv-reply', 7)}`

    setStateNamespace('gitlab')
    const gitlabVariants = stateMarkerVariants(
      'conv-reply',
      '<!-- codesentinel-conv-reply:7 -->',
      7
    )
    expect(hasStateMarker(githubBody, gitlabVariants)).toBe(false)
  })

  test('历史格式无命名空间，两平台都会命中——这正是它只用于读、不用于写的原因', () => {
    const legacyBody = 'old reply <!-- codesentinel-conv-reply:7 -->'
    const legacyVariant = ['<!-- codesentinel-conv-reply:7 -->']

    setStateNamespace('github')
    expect(hasStateMarker(legacyBody, legacyVariant)).toBe(true)
    setStateNamespace('gitlab')
    expect(hasStateMarker(legacyBody, legacyVariant)).toBe(true)

    // 新写入一律带命名空间，历史格式不会再增长
    expect(buildStateMarker('conv-reply', 7)).toContain(':gitlab:')
  })
})
