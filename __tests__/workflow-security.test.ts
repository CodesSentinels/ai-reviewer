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

describe('SEC-004: 特权触发器下不得引用 PR head', () => {
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

  test.each(PR_HEAD_REFS)('特权 workflow 正文不含 %s', ref => {
    const violations = privileged.filter(wf => codeOf(wf.raw).includes(ref)).map(w => w.name)
    expect(violations).toEqual([])
  })

  test('特权 workflow 的 checkout 步骤不得指定 repository（可能切到 fork）', () => {
    const violations: string[] = []
    for (const wf of privileged) {
      for (const [jobName, job] of jobsOf(wf.doc)) {
        for (const step of stepsOf(job)) {
          if (!String(step.uses ?? '').startsWith('actions/checkout')) continue
          if (step.with?.repository != null) violations.push(`${wf.name}:${jobName}`)
        }
      }
    }
    expect(violations).toEqual([])
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

describe('SEC-005: 持密钥的步骤不消费不可信产物', () => {
  test('没有任何 workflow 下载 artifact 后交给带密钥的步骤', () => {
    const violations: string[] = []
    for (const wf of workflows) {
      for (const [jobName, job] of jobsOf(wf.doc)) {
        const steps = stepsOf(job)
        const downloadsArtifact = steps.some(s =>
          String(s.uses ?? '').startsWith('actions/download-artifact')
        )
        const hasSecrets = steps.some(stepCarriesSecrets)
        if (downloadsArtifact && hasSecrets) violations.push(`${wf.name}:${jobName}`)
      }
    }
    // 第二步恢复 lint 时会引入 artifact 传递：届时必须改成
    // 「无密钥 job 产出 + 严格 schema 校验后消费」，并在此显式登记豁免
    expect(violations).toEqual([])
  })
})
