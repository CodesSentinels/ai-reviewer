/**
 * default-path-filters.test.ts — path_filters 默认值对构建产物目录的排除
 *
 * 默认规则原先是 `!dist/**`，只排除仓库根目录的 dist/。monorepo 里子包的构建产物
 * （packages/utils/dist/ 等）因此被当作普通源码送去审查。现在是 `!**\/dist/**`。
 */
import {describe, expect, test} from '@jest/globals'
import {CONFIG_DEFAULTS} from '../src/platform/config-provider'
import {PathFilter} from '../src/options'

const filter = new PathFilter([...CONFIG_DEFAULTS.pathFilters])

describe('path_filters 默认值：任意层级的 dist/ 都被排除', () => {
  test.each([
    'dist/index.js',
    'dist/nested/chunk.js',
    'packages/utils/dist/index.js',
    'apps/web/packages/ui/dist/chunk/a.js'
  ])('%s 被排除', path => {
    expect(filter.check(path)).toBe(false)
  })

  test.each([
    'src/index.ts',
    'packages/utils/src/index.ts',
    // 名字相近但不是 dist 目录，不能被误排除
    'src/distance.ts',
    'packages/my-dist/index.ts',
    'packages/distribution/index.ts',
    'src/dist.ts'
  ])('%s 照常审查', path => {
    expect(filter.check(path)).toBe(true)
  })

  test('显式配置的 path_filters 不受默认值影响', () => {
    const custom = new PathFilter(['src/**'])
    expect(custom.check('src/dist/helper.ts')).toBe(true)
    expect(custom.check('packages/utils/dist/index.js')).toBe(false)
  })
})
