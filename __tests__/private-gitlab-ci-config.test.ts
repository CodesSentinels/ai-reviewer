/**
 * private-gitlab-ci-config.test.ts — 私有云产物仓库模板（deploy/private-gitlab/）的
 * 结构性守卫。
 *
 * 真实行为（Protected 变量、Webhook、Runner）只能在私有云实测；这里把设计约束
 * 钉成静态断言，防止改模板时悄悄放宽：
 * - 只有一个由 trigger 触发的审查 job，运行前做完整性自检
 * - 模板会被原样交付到私有云：不得出现源码仓库 / GitHub 的信息
 * - 模板本身位于公开的源码仓库：不得出现私有云的地址
 */
import {describe, expect, test} from '@jest/globals'
import * as fs from 'fs'
import * as path from 'path'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const yaml = require('js-yaml')

const DEPLOY_DIR = path.resolve(__dirname, '../deploy/private-gitlab')
const ciRaw = fs.readFileSync(path.join(DEPLOY_DIR, 'gitlab-ci.yml'), 'utf8')
const ci = yaml.load(ciRaw) as any
const REVIEW = ci.ai_review_trigger

function scriptOf(job: any): string {
  return (Array.isArray(job.script) ? job.script : [job.script]).join('\n')
}

describe('私有云 CI 模板：job 清单与触发', () => {
  test('只有 ai_review_trigger 一个 job', () => {
    const reserved = new Set(['stages', 'default', 'variables', 'workflow', 'include'])
    expect(Object.keys(ci).filter(k => !reserved.has(k))).toEqual(['ai_review_trigger'])
  })

  test('默认只由 ai-reviewer 标签的 Runner 执行，镜像 node:24', () => {
    expect(ci.default.tags).toEqual(['ai-reviewer'])
    expect(ci.default.image).toBe('node:24')
  })

  test('只在 trigger 且 default branch 上运行', () => {
    expect(REVIEW.rules.map((r: any) => r.if)).toEqual([
      '$CI_PIPELINE_SOURCE == "trigger" && $CI_COMMIT_REF_NAME == $CI_DEFAULT_BRANCH'
    ])
  })

  test('不下载 artifact，串行执行', () => {
    expect(REVIEW.dependencies).toEqual([])
    expect(REVIEW.resource_group).toBe('ai-reviewer-mvp')
  })

  test('不执行任何构建 / 安装命令（只运行已发布的 bundle）', () => {
    expect(scriptOf(REVIEW)).not.toMatch(/\bnpm\b|\bnpx\b|\byarn\b|\bpnpm\b|curl .*\| *(ba)?sh/)
  })
})

describe('私有云 CI 模板：审查前完整性自检', () => {
  const s = scriptOf(REVIEW)

  test('先 sha256sum --check --strict，再检查清单外文件，最后才运行 bundle', () => {
    const check = s.indexOf('sha256sum --check --strict')
    const extra = s.indexOf('git ls-files')
    const run = s.indexOf('node dist/gitlab-trigger/index.js')
    expect(check).toBeGreaterThanOrEqual(0)
    expect(extra).toBeGreaterThan(check)
    expect(run).toBeGreaterThan(extra)
  })
})

describe('deploy/private-gitlab 双向不泄露', () => {
  const files = fs.readdirSync(DEPLOY_DIR)

  test('模板文件清单', () => {
    expect(files.sort()).toEqual(['README.md', 'gitlab-ci.yml'])
  })

  test.each(files)('%s 不含源码仓库 / GitHub 信息（会被交付到私有云）', name => {
    const text = fs.readFileSync(path.join(DEPLOY_DIR, name), 'utf8')
    expect(text).not.toMatch(/github/i)
    expect(text).not.toMatch(/CodesSentinels/i)
  })

  // 模板和脚本位于公开仓库：不得带出任何私有环境信息。这里不写具体名称（写了就等于
  // 把要保护的名字放进公开仓库），而是用通用规则 + 本地配置派生的检查。
  const PUBLIC_FILES = [
    ...files.map(f => path.join(DEPLOY_DIR, f)),
    path.resolve(__dirname, '../scripts/publish-private-gitlab.mjs'),
    path.resolve(__dirname, '../scripts/assemble-gitlab-dist.mjs'),
    path.resolve(__dirname, '../src/private-gitlab-publish.ts')
  ]
  const ALLOWED_HOSTS = new Set(['gitlab.example.com'])

  test.each(PUBLIC_FILES.map(f => [path.relative(path.resolve(__dirname, '..'), f), f]))(
    '%s 只出现示例域名，不含内网地址',
    (_rel, file) => {
      const text = fs.readFileSync(file, 'utf8')
      const hosts = [...text.matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)].map(m => m[1].toLowerCase())
      expect(hosts.filter(h => !ALLOWED_HOSTS.has(h))).toEqual([])
      expect(text).not.toMatch(
        /\b(10|127)\.\d{1,3}\.\d{1,3}\.\d{1,3}\b|\b192\.168\.\d{1,3}\.\d{1,3}\b/
      )
    }
  )

  // 本机配置了真实私有云地址时（环境变量或 .private-gitlab.env），额外确认它的主机名
  // 没有被写进任何公开文件。CI 上没有这份配置，这条自动退化为空检查。
  test('本地配置的私有云主机名不出现在公开文件里', () => {
    let url = process.env.PRIVATE_GITLAB_URL ?? ''
    const envFile = path.resolve(__dirname, '../.private-gitlab.env')
    if (url === '' && fs.existsSync(envFile)) {
      url = /^\s*PRIVATE_GITLAB_URL\s*=\s*(\S+)/m.exec(fs.readFileSync(envFile, 'utf8'))?.[1] ?? ''
    }
    if (url === '') return
    const host = new URL(url).hostname.toLowerCase()
    for (const file of PUBLIC_FILES) {
      expect(fs.readFileSync(file, 'utf8').toLowerCase()).not.toContain(host)
    }
  })
})
