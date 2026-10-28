/**
 * repo-config-merge.test.ts — 合并规则（issue #231）
 *
 * mergeConfig 是纯函数，规则在这里直接对照设计验证；Options.applyRepoConfig
 * 只是把它的结果写回，另有 repo-config.test.ts 覆盖。
 */
import {describe, expect, test} from '@jest/globals'

import {mergeConfig, type MergeableConfig} from '../src/repo-config-merge'

const baseline = (): MergeableConfig => ({
  pathFilterRules: ['!**/dist/**'],
  pathInstructionLines: ['src/**: 基线规则'],
  systemMessage: 'BASELINE',
  language: 'en-US',
  reviewSimpleChanges: false,
  reviewCommentLGTM: false,
  maxFiles: 150,
  maxReviewComments: 20,
  enableDependencyAnalysis: true,
  maxDependencyFiles: 50
})

describe('mergeConfig', () => {
  test('仓库配置为 null / undefined / 空对象 → 与基线相等', () => {
    expect(mergeConfig(baseline(), null)).toEqual(baseline())
    expect(mergeConfig(baseline(), undefined)).toEqual(baseline())
    expect(mergeConfig(baseline(), {})).toEqual(baseline())
  })

  test('纯函数：不修改入参，返回的列表是独立拷贝', () => {
    const b = baseline()
    const snapshot = JSON.parse(JSON.stringify(b))
    const out = mergeConfig(b, {pathFilters: ['!x/**'], pathInstructions: ['a/**: y']})

    expect(b).toEqual(snapshot)
    out.pathFilterRules.push('!mutated')
    expect(b.pathFilterRules).toEqual(snapshot.pathFilterRules)
  })

  test('列表：基线在前，仓库在后，追加', () => {
    const out = mergeConfig(baseline(), {
      pathFilters: ['!**/generated/**'],
      pathInstructions: ['src/api/**: 仓库规则']
    })
    expect(out.pathFilterRules).toEqual(['!**/dist/**', '!**/generated/**'])
    expect(out.pathInstructionLines).toEqual(['src/**: 基线规则', 'src/api/**: 仓库规则'])
  })

  test('文本：system_message_append 接在基线后面，用空行分隔，不替换', () => {
    const out = mergeConfig(baseline(), {systemMessageAppend: 'EXTRA'})
    expect(out.systemMessage).toBe('BASELINE\n\nEXTRA')
  })

  test('没有 system_message_append 时 systemMessage 原样不变', () => {
    expect(mergeConfig(baseline(), {language: 'zh-CN'}).systemMessage).toBe('BASELINE')
  })

  test('标量：仓库值覆盖基线值，包括 false 和 0', () => {
    const b = {...baseline(), enableDependencyAnalysis: true, maxFiles: 150}
    const out = mergeConfig(b, {
      language: 'zh-CN',
      reviewSimpleChanges: true,
      reviewCommentLGTM: true,
      maxFiles: 0,
      maxReviewComments: 5,
      enableDependencyAnalysis: false,
      maxDependencyFiles: 7
    })
    expect(out).toMatchObject({
      language: 'zh-CN',
      reviewSimpleChanges: true,
      reviewCommentLGTM: true,
      maxFiles: 0,
      maxReviewComments: 5,
      enableDependencyAnalysis: false,
      maxDependencyFiles: 7
    })
  })

  test('只设置了一部分字段时，其余沿用基线', () => {
    const out = mergeConfig(baseline(), {maxFiles: 10})
    expect(out).toEqual({...baseline(), maxFiles: 10})
  })

  test('连续合并等价于一次合并（再次叠加不会覆盖已追加的内容）', () => {
    const once = mergeConfig(baseline(), {pathFilters: ['!a/**', '!b/**']})
    const twice = mergeConfig(mergeConfig(baseline(), {pathFilters: ['!a/**']}), {
      pathFilters: ['!b/**']
    })
    expect(twice.pathFilterRules).toEqual(once.pathFilterRules)
  })
})
