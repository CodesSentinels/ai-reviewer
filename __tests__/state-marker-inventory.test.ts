/**
 * state-marker-inventory.test.ts — 状态 marker 完整清单（GH-014）
 *
 * 上一版只迁移了 pause/resume、reviewed commit IDs、命令回复、对话回复四个 marker，
 * 而 COMMENT_TAG（行级评论去重）、SUMMARIZE_TAG（定位唯一摘要评论）等仍无平台前缀，
 * 且当时的架构门禁只查「硬编码的 ai-reviewer:xxx」，查不出「压根没有前缀」的漏网 marker。
 *
 * 这里正面解决：
 * 1. 枚举 commenter.ts 里所有 `<!-- ... -->` 形态的 marker 字面量，
 *    要求每一个都已登记进 STATE_MARKERS 清单（漏登记直接失败）
 * 2. 清单里每个 marker 的当前形态都必须带平台命名空间
 * 3. 每个 marker 的新旧两种形态都能被匹配到（写新读旧）
 */
import {describe, expect, test, jest, afterEach} from '@jest/globals'
import * as fs from 'fs'
import * as path from 'path'

jest.mock('@actions/github', () => ({
  context: {repo: {owner: 'o', repo: 'r'}, payload: {}}
}))

import {
  STATE_MARKERS,
  bodyHasMarker,
  stateMarker,
  stateMarkerVariantsFor,
  tagPairVariants,
  variantsForTag,
  type StateMarkerName
} from '../src/commenter'
import {resetStateNamespace, setStateNamespace} from '../src/platform/state-namespace'

const NAMES = Object.keys(STATE_MARKERS) as StateMarkerName[]

afterEach(() => {
  resetStateNamespace()
})

describe('GH-014: 清单完整性', () => {
  test('清单非空且覆盖已知的行为性 marker', () => {
    expect(NAMES.length).toBeGreaterThanOrEqual(15)
    for (const required of [
      'comment', // 行级评论去重
      'commentReply',
      'summarize', // 定位唯一摘要评论
      'inProgressStart',
      'inProgressEnd',
      'descriptionStart', // PR 描述发布说明区域
      'descriptionEnd',
      'rawSummaryStart',
      'rawSummaryEnd',
      'shortSummaryStart',
      'shortSummaryEnd',
      'commitIdsStart', // reviewed SHA
      'commitIdsEnd',
      'reviewStateStart', // pause/resume
      'reviewStateEnd'
    ]) {
      expect(NAMES).toContain(required)
    }
  })

  test('清单模块里出现的 marker 字面量全部已登记（防止再漏网）', () => {
    const raw = fs.readFileSync(path.resolve(__dirname, '../src/state-markers.ts'), 'utf8')
    // 先去掉代码注释：文档里会举例写 <!-- sha1 --> 之类，不是真的 marker
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '')

    // 只看单行完整的 HTML 注释；不跨引号/换行，避免把模板字面量连成一片
    const literals = new Set<string>()
    for (const m of src.matchAll(/(<!--[^'"`\n]*?-->)/g)) {
      const lit = m[1]
      // '<!--' / '-->' 这类解析用片段不是 marker
      if (lit.replace(/<!--|-->/g, '').trim() === '') continue
      // `<!-- ${commitId} -->` 是区块内的数据包装，边界 marker 才需要登记
      if (lit.includes('${')) continue
      literals.add(lit)
    }

    const registered = new Set<string>()
    for (const spec of Object.values(STATE_MARKERS)) {
      registered.add(spec.legacy)
      // 多行 marker（raw/short summary）由 legacy 常量整体登记
      for (const line of spec.legacy.split('\n')) {
        if (line.startsWith('<!--')) registered.add(line)
      }
    }

    const unregistered = [...literals].filter(
      lit => !registered.has(lit) && !lit.includes('ai-reviewer:')
    )
    expect(unregistered).toEqual([])
  })

  test('每个 marker 的 kind 唯一，不会互相覆盖', () => {
    const kinds = Object.values(STATE_MARKERS).map(s => s.kind)
    expect(new Set(kinds).size).toBe(kinds.length)
  })
})

describe('GH-014: 每个 marker 都带平台命名空间', () => {
  test.each(NAMES)('%s 的当前形态含 ai-reviewer:github:', name => {
    expect(stateMarker(name)).toContain('ai-reviewer:github:')
  })

  test.each(NAMES)('%s 在 GitLab 运行时改用 gitlab: 前缀', name => {
    setStateNamespace('gitlab')
    expect(stateMarker(name)).toContain('ai-reviewer:gitlab:')
    expect(stateMarker(name)).not.toContain('ai-reviewer:github:')
  })

  test.each(NAMES)('%s 的 legacy 形态确实没有平台前缀（说明确有迁移必要）', name => {
    expect(STATE_MARKERS[name].legacy).not.toContain('ai-reviewer:github:')
    expect(STATE_MARKERS[name].legacy).not.toContain('ai-reviewer:gitlab:')
  })
})

describe('GH-014: 写新读旧', () => {
  test.each(NAMES)('%s 的新旧两种形态都能被匹配', name => {
    const [current, legacy] = stateMarkerVariantsFor(name)
    expect(bodyHasMarker(`正文 ${current} 尾部`, name)).toBe(true)
    expect(bodyHasMarker(`正文 ${legacy} 尾部`, name)).toBe(true)
    expect(bodyHasMarker('无 marker 的正文', name)).toBe(false)
  })

  test('variantsForTag 由任一形态都能反查出完整变体', () => {
    const spec = STATE_MARKERS.summarize
    expect(variantsForTag(spec.current())).toEqual([spec.current(), spec.legacy])
    expect(variantsForTag(spec.legacy)).toEqual([spec.current(), spec.legacy])
  })

  test('未登记的自定义 tag 原样返回，不被吞掉', () => {
    expect(variantsForTag('<!-- custom -->')).toEqual(['<!-- custom -->'])
  })

  test('起止标签成对回退，不会新旧混搭截出错误区间', () => {
    const start = STATE_MARKERS.rawSummaryStart
    const end = STATE_MARKERS.rawSummaryEnd
    expect(tagPairVariants(start.current(), end.current())).toEqual([
      [start.current(), end.current()],
      [start.legacy, end.legacy]
    ])
  })
})

describe('GH-015: marker 不跨平台命中', () => {
  test.each(NAMES)('%s：GitHub 形态不被 GitLab 命名空间匹配', name => {
    setStateNamespace('github')
    const githubBody = `正文 ${stateMarker(name)}`

    setStateNamespace('gitlab')
    const [gitlabCurrent] = stateMarkerVariantsFor(name)
    expect(githubBody.includes(gitlabCurrent)).toBe(false)
  })
})
