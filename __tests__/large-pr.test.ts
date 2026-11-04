import {describe, expect, test} from '@jest/globals'
import {
  INITIAL_PR_MIN_ADDED_FILES,
  countChangedLines,
  detectInitialPr,
  fileTier,
  initialPrNotice,
  largePrNotice,
  prioritizeFiles
} from '../src/large-pr'

function patchOf(added: number, removed = 0): string {
  return [
    '@@ -1,1 +1,1 @@',
    ...Array.from({length: added}, (_, i) => `+a${i}`),
    ...Array.from({length: removed}, (_, i) => `-r${i}`)
  ].join('\n')
}

describe('countChangedLines', () => {
  test('只统计 + / - 行，不算 diff 头和上下文', () => {
    expect(countChangedLines('--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n ctx\n-old\n+new\n+more')).toBe(3)
  })

  test('空 patch 为 0', () => {
    expect(countChangedLines(undefined)).toBe(0)
    expect(countChangedLines('')).toBe(0)
  })
})

describe('fileTier', () => {
  test.each([
    [{filename: 'src/a.ts', status: 'modified'}, 1],
    [{filename: 'src/a.test.ts', status: 'added'}, 1],
    [{filename: 'README.md', status: 'modified'}, 2],
    [{filename: 'docs/guide.rst'}, 2],
    [{filename: 'package-lock.json'}, 3],
    [{filename: 'apps/web/pnpm-lock.yaml'}, 3],
    [{filename: 'go.sum'}, 3],
    [{filename: 'src/__snapshots__/a.test.ts.snap'}, 3],
    [{filename: 'dist/app.min.js'}, 3],
    [{filename: 'src/old.ts', status: 'removed'}, 3],
    [{filename: 'src/moved.ts', status: 'renamed', patch: ''}, 3],
    [{filename: 'src/moved.ts', status: 'renamed', patch: patchOf(2)}, 1]
  ])('%j → 档位 %d', (file, tier) => {
    expect(fileTier(file)).toBe(tier)
  })
})

describe('prioritizeFiles', () => {
  const ident = (f: {filename: string; status?: string; patch?: string}) => f

  test('代码 > 文档 > 低价值；同档位变更多的在前', () => {
    const files = [
      {filename: 'package-lock.json', status: 'modified', patch: patchOf(500)},
      {filename: 'README.md', status: 'modified', patch: patchOf(40)},
      {filename: 'src/small.ts', status: 'modified', patch: patchOf(2)},
      {filename: 'src/old.ts', status: 'removed', patch: patchOf(0, 90)},
      {filename: 'src/big.ts', status: 'modified', patch: patchOf(30, 10)}
    ]
    expect(prioritizeFiles(files, ident).map(f => f.filename)).toEqual([
      'src/big.ts',
      'src/small.ts',
      'README.md',
      'package-lock.json',
      'src/old.ts'
    ])
  })

  test('完全同级时保持原顺序（稳定排序）', () => {
    const files = ['c.ts', 'a.ts', 'b.ts'].map(filename => ({filename, patch: patchOf(3)}))
    expect(prioritizeFiles(files, ident).map(f => f.filename)).toEqual(['c.ts', 'a.ts', 'b.ts'])
  })

  test('不修改输入数组', () => {
    const files = [
      {filename: 'README.md', patch: patchOf(1)},
      {filename: 'a.ts', patch: patchOf(1)}
    ]
    prioritizeFiles(files, ident)
    expect(files.map(f => f.filename)).toEqual(['README.md', 'a.ts'])
  })
})

describe('detectInitialPr', () => {
  const many = (n: number, status: string): string[] => Array.from({length: n}, () => status)

  test('新增文件数达到下限且占比 > 90% → 初始化 PR', () => {
    expect(detectInitialPr([...many(95, 'added'), ...many(5, 'modified')])).toEqual({
      isInitial: true,
      added: 95,
      total: 100
    })
  })

  test('占比够但数量不够（新建几个文件的小 PR）→ 不是', () => {
    expect(detectInitialPr(many(3, 'added')).isInitial).toBe(false)
    expect(detectInitialPr(many(INITIAL_PR_MIN_ADDED_FILES - 1, 'added')).isInitial).toBe(false)
  })

  test('数量够但占比不够（大重构里顺带新增很多文件）→ 不是', () => {
    expect(detectInitialPr([...many(80, 'added'), ...many(200, 'modified')]).isInitial).toBe(false)
  })

  test('占比恰好 90% 不算（要求严格大于）', () => {
    expect(detectInitialPr([...many(90, 'added'), ...many(10, 'modified')]).isInitial).toBe(false)
  })

  test('空列表 → 不是', () => {
    expect(detectInitialPr([])).toEqual({isInitial: false, added: 0, total: 0})
  })
})

describe('提示文案', () => {
  test('文件数超过 warn_files 才提示；≤ 0 关闭', () => {
    expect(largePrNotice(50, 50)).toBeNull()
    expect(largePrNotice(51, 50)).toContain('51 个文件，超过 `warn_files`（50）')
    expect(largePrNotice(500, 0)).toBeNull()
    expect(largePrNotice(500, -1)).toBeNull()
    expect(largePrNotice(500, NaN)).toBeNull()
    expect(largePrNotice(500, undefined as unknown as number)).toBeNull()
  })

  test('初始化 PR 说明带上统计数字和重新审查的命令', () => {
    const text = initialPrNotice({isInitial: true, added: 95, total: 100}, '@ai-reviewer')
    expect(text).toContain('新增 95 / 100 个文件')
    expect(text).toContain('`@ai-reviewer full review`')
  })
})
