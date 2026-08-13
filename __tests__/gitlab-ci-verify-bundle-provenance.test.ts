/**
 * gitlab-ci-verify-bundle-provenance.test.ts — CI-012 校验脚本单元测试
 *
 * scripts/check-ci-verify-bundle-provenance.js 是纯 Node 脚本，不依赖真实
 * GitLab 环境（只读两个 SOURCE_SHA 文件 + 比对一个环境变量），直接用临时
 * 目录 + child_process 跑，不需要 mock GitLab CI。
 */
import {describe, expect, test} from '@jest/globals'
import {execFileSync} from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const SCRIPT = path.resolve(__dirname, '../scripts/check-ci-verify-bundle-provenance.js')

function makeFixtureRoot(shaForGithub: string | null, shaForGitlab: string | null): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-provenance-'))
  fs.mkdirSync(path.join(root, 'dist', 'gitlab-trigger'), {recursive: true})
  if (shaForGithub != null) {
    fs.writeFileSync(path.join(root, 'dist', 'SOURCE_SHA'), shaForGithub)
  }
  if (shaForGitlab != null) {
    fs.writeFileSync(path.join(root, 'dist', 'gitlab-trigger', 'SOURCE_SHA'), shaForGitlab)
  }
  return root
}

function run(cwd: string, env: Record<string, string>): {status: number; output: string} {
  try {
    const output = execFileSync('node', [SCRIPT], {
      cwd,
      env: {...process.env, ...env},
      encoding: 'utf8'
    })
    return {status: 0, output}
  } catch (e: any) {
    return {status: e.status ?? 1, output: `${e.stdout ?? ''}${e.stderr ?? ''}`}
  }
}

describe('check-ci-verify-bundle-provenance.js', () => {
  test('两个 SOURCE_SHA 都匹配 CI_COMMIT_SHA → 通过', () => {
    const root = makeFixtureRoot('abc123', 'abc123')
    const result = run(root, {CI_COMMIT_SHA: 'abc123'})
    expect(result.status).toBe(0)
    expect(result.output).toContain('dist/SOURCE_SHA 匹配')
    expect(result.output).toContain('dist/gitlab-trigger/SOURCE_SHA 匹配')
  })

  test('dist/SOURCE_SHA 与 CI_COMMIT_SHA 不一致 → 失败并说明原因', () => {
    const root = makeFixtureRoot('stale-sha', 'abc123')
    const result = run(root, {CI_COMMIT_SHA: 'abc123'})
    expect(result.status).not.toBe(0)
    expect(result.output).toContain('FAIL')
    expect(result.output).toContain('dist/SOURCE_SHA')
  })

  test('SOURCE_SHA 文件缺失 → 失败并提示先构建', () => {
    const root = makeFixtureRoot(null, 'abc123')
    const result = run(root, {CI_COMMIT_SHA: 'abc123'})
    expect(result.status).not.toBe(0)
    expect(result.output).toContain('不存在')
  })

  test('CI_COMMIT_SHA 未设置 → 失败（脚本只应在 CI 里跑）', () => {
    const root = makeFixtureRoot('abc123', 'abc123')
    const result = run(root, {CI_COMMIT_SHA: ''})
    expect(result.status).not.toBe(0)
    expect(result.output).toContain('CI_COMMIT_SHA 未设置')
  })
})
