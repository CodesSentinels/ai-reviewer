/**
 * shared-core-platform-neutral.test.ts — 共享核心必须能在非 GitHub 环境加载
 * （ARCH-005 / REVIEW-001）
 *
 * 长期挡住 gitlab-trigger.ts 接入审查核心的不是 GLAPI 缺口，而是这个：
 *
 *   review.ts:104     const repo = context.repo
 *   commenter.ts:23   const repo = context.repo
 *
 * 都是**模块级**求值，而 `@actions/github` 的 `context.repo` 在没有
 * GITHUB_REPOSITORY 时直接抛：
 *
 *   context.repo requires a GITHUB_REPOSITORY environment variable like 'owner/repo'
 *
 * 于是 GitLab 入口一 import 编排层，模块加载阶段就崩，run() 根本执行不到。
 *
 * 这类回归光靠单元测试挡不住——既有用例几乎都 `jest.mock('@actions/github')`，
 * 恰好把出问题的依赖屏蔽掉了。所以这里**不 mock**，直接在清空 GITHUB_* 的环境里
 * 真加载模块。
 */
import {describe, expect, test, beforeEach, afterEach, jest} from '@jest/globals'
import * as fs from 'fs'
import * as path from 'path'

const SRC = path.resolve(__dirname, '../src')
const GITHUB_ENV = [
  'GITHUB_REPOSITORY',
  'GITHUB_EVENT_PATH',
  'GITHUB_EVENT_NAME',
  'GITHUB_SERVER_URL',
  'GITHUB_ACTION',
  'GITHUB_TOKEN'
]

/** 共享核心里曾经直连 GitHub context 的三个文件 */
const MIGRATED = ['review.ts', 'commenter.ts', 'commands/dispatcher.ts']

function codeOf(rel: string): string {
  return fs
    .readFileSync(path.join(SRC, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
}

describe('共享核心不再直连 GitHub context', () => {
  test.each(MIGRATED)('%s 不 import @actions/github', rel => {
    expect(codeOf(rel)).not.toMatch(/from ['"]@actions\/github['"]/)
  })

  test.each(MIGRATED)('%s 不读 context.payload / context.repo / context.eventName', rel => {
    const code = codeOf(rel)
    expect(code).not.toMatch(/\bcontext\.payload\b/)
    expect(code).not.toMatch(/\bcontext\.eventName\b/)
    // `context.repo` 尤其致命：模块级求值会让整个文件在非 GitHub 环境无法加载
    expect(code).not.toMatch(/=\s*context\.repo\b/)
  })

  test('三个文件确实存在且非空（防止路径写错导致空跑通过）', () => {
    for (const rel of MIGRATED) {
      expect(codeOf(rel).length).toBeGreaterThan(500)
    }
  })
})

describe('清空 GITHUB_* 后仍可加载共享核心（真加载，不 mock）', () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const k of GITHUB_ENV) {
      saved[k] = process.env[k]
      delete process.env[k]
    }
    jest.resetModules()
  })

  afterEach(() => {
    for (const k of GITHUB_ENV) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  test('前置自检：@actions/github 的 context.repo 在此环境下确实会抛', () => {
    // 如果哪天这条不再成立（上游改了行为），下面两条就失去意义，必须知道
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const {context} = require('@actions/github')
    expect(() => context.repo).toThrow(/GITHUB_REPOSITORY/)
  })

  test.each(['../src/commenter', '../src/commands/dispatcher'])('import %s 不抛错', mod => {
    expect(() => require(mod)).not.toThrow()
  })

  test('run-context 在未初始化时 fail closed，而不是返回空坐标', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const {getRepoCoords, resetExecCtx} = require('../src/platform/run-context')
    resetExecCtx()
    expect(() => getRepoCoords()).toThrow(/run context is not initialized/)
  })
})

describe('projectPath → (owner, repo) 的切分对两个平台都成立', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const {repoCoordsOf} = require('../src/platform/run-context')
  const ctx = (projectPath: string): any => ({projectPath})

  test.each([
    ['GitHub 两段式', 'octo/demo', 'octo', 'demo'],
    ['GitLab 顶层项目', 'group/demo', 'group', 'demo'],
    ['GitLab 子组项目', 'group/subgroup/project', 'group/subgroup', 'project'],
    ['GitLab 多层子组', 'a/b/c/d', 'a/b/c', 'd']
  ])('%s', (_label, projectPath, owner, repo) => {
    // 按**最后**一个斜杠切：两个平台的 adapter 都用 `${owner}/${repo}` 还原完整
    // 路径，按第一个斜杠切会把 GitLab 子组项目切错
    expect(repoCoordsOf(ctx(projectPath))).toEqual({owner, repo})
  })

  test.each(['', 'noslash', '/leading', 'trailing/'])('非法 projectPath "%s" → 抛错', bad => {
    expect(() => repoCoordsOf(ctx(bad))).toThrow(/invalid projectPath/)
  })
})
