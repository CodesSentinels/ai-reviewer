/**
 * workflow-security.test.ts — workflow 执行面安全守卫（SEC-004/006/007/009/010）
 *
 * `.github/workflows/` 下每个文件都是一个可被外部事件触发的执行面。
 * 这里把「哪些组合绝对不允许出现」钉成静态断言，覆盖全部 workflow 而不只是
 * reviewer 那一个——`SEC-004` 关心的是**任何**持有密钥的 job 都不能碰不可信代码。
 *
 * 与 action-inputs.characterization.test.ts 的分工：那边盯 reviewer 的功能契约
 * （入口、input、触发事件、并发），这边盯所有 workflow 的安全属性。
 */
import {describe, expect, test} from '@jest/globals'
import * as fs from 'fs'
import * as path from 'path'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const yaml = require('js-yaml')

const WORKFLOW_DIR = path.resolve(__dirname, '../.github/workflows')

interface Workflow {
  name: string
  file: string
  raw: string
  doc: any
}

function loadWorkflows(): Workflow[] {
  return fs
    .readdirSync(WORKFLOW_DIR)
    .filter(f => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map(file => {
      const raw = fs.readFileSync(path.join(WORKFLOW_DIR, file), 'utf8')
      return {name: file, file: path.join(WORKFLOW_DIR, file), raw, doc: yaml.load(raw)}
    })
}

const workflows = loadWorkflows()

/** YAML 1.1 会把裸 key `on:` 解析成布尔 true */
function triggersOf(doc: any): Record<string, any> {
  const on = doc.on ?? doc[true as unknown as string]
  if (typeof on === 'string') return {[on]: {}}
  if (Array.isArray(on)) return Object.fromEntries(on.map((k: string) => [k, {}]))
  return on ?? {}
}

function jobsOf(doc: any): Array<[string, any]> {
  return Object.entries(doc.jobs ?? {})
}

function stepsOf(job: any): any[] {
  return job.steps ?? []
}

/** 去掉注释后的正文——注释里会为了说明「绝不能这么写」而提到危险表达式 */
function codeOf(raw: string): string {
  return raw
    .split('\n')
    .filter(line => !line.trim().startsWith('#'))
    .join('\n')
}

/** 该步骤是否被注入了密钥 */
function stepCarriesSecrets(step: any): boolean {
  const serialized = JSON.stringify(step.env ?? {}) + JSON.stringify(step.with ?? {})
  return /secrets\./.test(serialized)
}

describe('SEC-007: workflow 清单', () => {
  test('至少扫描到 4 个 workflow（防止路径写错导致空跑通过）', () => {
    expect(workflows.length).toBeGreaterThanOrEqual(4)
    expect(workflows.map(w => w.name)).toContain('openai-review.yml')
  })

  test('每个 workflow 都能被解析且声明了触发事件', () => {
    for (const wf of workflows) {
      expect(Object.keys(triggersOf(wf.doc)).length).toBeGreaterThan(0)
    }
  })
})

describe('SEC-004: 持密钥的 job 不得引用 PR head', () => {
  /** 会在 base 仓库上下文运行、能拿到 secrets 的触发器 */
  const PRIVILEGED_TRIGGERS = [
    'pull_request_target',
    'issue_comment',
    'pull_request_review_comment'
  ]

  /** 指向不可信 PR 内容的表达式 */
  const PR_HEAD_REFS = [
    'pull_request.head.repo',
    'pull_request.head.ref',
    'pull_request.head.sha',
    'event.pull_request.head'
  ]

  const privileged = workflows.filter(wf =>
    Object.keys(triggersOf(wf.doc)).some(t => PRIVILEGED_TRIGGERS.includes(t))
  )

  test('存在特权触发器 workflow（本仓库确实有 reviewer）', () => {
    expect(privileged.map(w => w.name)).toContain('openai-review.yml')
  })

  // 注意作用域：SEC-002 的双 job 方案里，**无密钥** job 合法地 checkout PR head。
  // 因此规则不是「文件里不能出现 PR head」，而是「持密钥的 job 里不能出现」。
  test.each(PR_HEAD_REFS)('持密钥的 job 内不出现 %s', ref => {
    const violations: string[] = []
    for (const wf of privileged) {
      for (const [jobName, job] of jobsOf(wf.doc)) {
        if (!stepsOf(job).some(stepCarriesSecrets)) continue
        if (JSON.stringify(job).includes(ref)) violations.push(`${wf.name}:${jobName}`)
      }
    }
    expect(violations).toEqual([])
  })

  test('持密钥 job 的 checkout 步骤不得指定 repository（可能切到 fork）', () => {
    const violations: string[] = []
    for (const wf of privileged) {
      for (const [jobName, job] of jobsOf(wf.doc)) {
        if (!stepsOf(job).some(stepCarriesSecrets)) continue
        for (const step of stepsOf(job)) {
          if (!String(step.uses ?? '').startsWith('actions/checkout')) continue
          if (step.with?.repository != null) violations.push(`${wf.name}:${jobName}`)
        }
      }
    }
    expect(violations).toEqual([])
  })

  test('确有 job 被判定为持密钥（否则上面几条是空跑）', () => {
    const withSecrets = privileged.flatMap(wf =>
      jobsOf(wf.doc)
        .filter(([, job]) => stepsOf(job).some(stepCarriesSecrets))
        .map(([name]) => `${wf.name}:${name}`)
    )
    expect(withSecrets).toContain('openai-review.yml:review')
  })

  test('本仓库没有任何 workflow 使用裸 pull_request 触发器执行带密钥的步骤', () => {
    const violations: string[] = []
    for (const wf of workflows) {
      if (!Object.keys(triggersOf(wf.doc)).includes('pull_request')) continue
      for (const [jobName, job] of jobsOf(wf.doc)) {
        for (const step of stepsOf(job)) {
          if (stepCarriesSecrets(step)) violations.push(`${wf.name}:${jobName}`)
        }
      }
    }
    expect(violations).toEqual([])
  })
})

describe('SEC-006: 每个 workflow 显式声明最小权限', () => {
  test.each(workflows.map(w => w.name))('%s 声明了 permissions', name => {
    const wf = workflows.find(w => w.name === name) as Workflow
    const jobLevel = jobsOf(wf.doc).every(([, job]) => job.permissions != null)
    expect(wf.doc.permissions != null || jobLevel).toBe(true)
  })

  test('没有任何 workflow 申请 write-all / 全量权限', () => {
    const violations: string[] = []
    for (const wf of workflows) {
      const scopes = [wf.doc.permissions, ...jobsOf(wf.doc).map(([, j]) => j.permissions)]
      for (const scope of scopes) {
        if (scope === 'write-all' || scope === 'read-all') violations.push(wf.name)
      }
    }
    expect(violations).toEqual([])
  })

  test('reviewer 只申请 contents:read + pull-requests:write', () => {
    const wf = workflows.find(w => w.name === 'openai-review.yml') as Workflow
    expect(wf.doc.permissions).toEqual({contents: 'read', 'pull-requests': 'write'})
  })
})

describe('SEC-009/010: 外部 Action 引用固定到 commit SHA', () => {
  /** 收集所有 `uses:` 引用（跳过 `./` 这类仓库内引用） */
  function externalUses(): Array<{workflow: string; uses: string}> {
    const result: Array<{workflow: string; uses: string}> = []
    for (const wf of workflows) {
      for (const [, job] of jobsOf(wf.doc)) {
        for (const step of stepsOf(job)) {
          const uses = step.uses
          if (typeof uses !== 'string') continue
          if (uses.startsWith('./') || uses.startsWith('.\\')) continue
          result.push({workflow: wf.name, uses})
        }
      }
    }
    return result
  }

  const uses = externalUses()

  test('确实存在外部 Action 引用（否则本组断言空跑）', () => {
    expect(uses.length).toBeGreaterThan(0)
  })

  test('全部固定到 40 位 commit SHA，不使用可变 tag', () => {
    const unpinned = uses
      .filter(u => !/@[0-9a-f]{40}$/.test(u.uses))
      .map(u => `${u.workflow} → ${u.uses}`)
    expect(unpinned).toEqual([])
  })

  test('不存在 @latest / @main / @master 这类可被第三方随时改写的引用', () => {
    const mutable = uses
      .filter(u => /@(latest|main|master|HEAD)$/i.test(u.uses))
      .map(u => `${u.workflow} → ${u.uses}`)
    expect(mutable).toEqual([])
  })
})

describe('SEC-002/004/005: 双执行面的分工与产物流向', () => {
  const reviewWf = workflows.find(w => w.name === 'openai-review.yml') as Workflow
  const jobs = Object.fromEntries(jobsOf(reviewWf.doc))

  /** 该 job 是否 checkout 了 PR head */
  function checksOutPrHead(job: any): boolean {
    return stepsOf(job).some(step => {
      if (!String(step.uses ?? '').startsWith('actions/checkout')) return false
      const w = JSON.stringify(step.with ?? {})
      return w.includes('pull_request.head')
    })
  }

  function jobHasSecrets(job: any): boolean {
    return stepsOf(job).some(stepCarriesSecrets)
  }

  test('存在两个 job：不可信的 lint 与持密钥的 review（SEC-002）', () => {
    expect(Object.keys(jobs).sort()).toEqual(['lint', 'review'])
  })

  test('checkout PR head 的 job 一条密钥都没有（允许列表：不给 env）', () => {
    for (const [name, job] of Object.entries(jobs)) {
      if (!checksOutPrHead(job)) continue
      expect(`${name}:hasSecrets=${jobHasSecrets(job)}`).toBe(`${name}:hasSecrets=false`)
      // 也不能有写权限——拿不到密钥但能写评论同样危险
      expect(job.permissions).toEqual({contents: 'read'})
    }
  })

  test('持密钥的 job 不 checkout PR head（SEC-003）', () => {
    for (const [name, job] of Object.entries(jobs)) {
      if (!jobHasSecrets(job)) continue
      expect(`${name}:checksOutPrHead=${checksOutPrHead(job)}`).toBe(
        `${name}:checksOutPrHead=false`
      )
    }
  })

  test('不可信 job 只上传数据 artifact，不上传可执行物（SEC-005）', () => {
    const uploads = stepsOf(jobs.lint).filter(s =>
      String(s.uses ?? '').startsWith('actions/upload-artifact')
    )
    expect(uploads).toHaveLength(1)
    // 只允许单个 JSON 报告；目录/通配会把脚本、依赖一起带过去
    expect(uploads[0].with.path).toBe('lint-report.json')
  })

  test('持密钥 job 下载的产物落在工作区之外，且只作为数据路径传入', () => {
    const download = stepsOf(jobs.review).find(s =>
      String(s.uses ?? '').startsWith('actions/download-artifact')
    )
    expect(download).toBeDefined()
    // runner.temp 不在 checkout 出来的工作区里，不会被当成仓库文件执行
    expect(String(download.with.path)).toContain('runner.temp')

    const action = stepsOf(jobs.review).find(s => s.uses === './')
    expect(String(action.with.lint_report_path)).toContain('runner.temp')
  })

  test('持密钥 job 不执行任何来自产物的脚本（没有 run: 引用下载目录）', () => {
    const runSteps = stepsOf(jobs.review).filter(s => typeof s.run === 'string')
    for (const step of runSteps) {
      expect(step.run).not.toContain('runner.temp')
      expect(step.run).not.toContain('lint-report')
    }
  })

  test('持密钥 job 仍然关闭本地工具（产物是唯一的 lint 来源）', () => {
    const action = stepsOf(jobs.review).find(s => s.uses === './')
    expect(action.with.enable_shell).toBe(false)
    expect(action.with.enable_lint_tools).toBe(false)
  })

  test('lint job 失败或跳过都不阻塞审查', () => {
    expect(String(jobs.review.if)).toContain('always()')
    const lintStep = stepsOf(jobs.lint).find((s: any) => s.id === 'lint')
    expect(lintStep['continue-on-error']).toBe(true)
  })
})
