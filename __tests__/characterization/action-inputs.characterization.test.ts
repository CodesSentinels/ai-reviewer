/**
 * action-inputs.characterization.test.ts — GitHub Action 入口与输入基线（GH-001~005）
 *
 * 双平台改造期间，GitHub 侧的对外契约（Action 入口、input 名称/默认值/类型、
 * 触发事件、并发策略）必须保持不变（TODO §1「不删功能」）。这里把这些声明式
 * 契约钉成快照与不变量，任何静默漂移都会在这里失败。
 *
 * 分工：
 * - 事件分发的**代码行为**基线在 main.characterization.test.ts
 * - 本文件覆盖 action.yml 与 workflow 的**声明**，以及「声明与代码读取一致」
 */
import {describe, expect, test} from '@jest/globals'
import * as fs from 'fs'
import * as path from 'path'
// js-yaml 无内置类型声明，项目也未装 @types/js-yaml，按既有约定用 require
// eslint-disable-next-line @typescript-eslint/no-var-requires
const yaml = require('js-yaml')

const ROOT = path.resolve(__dirname, '../..')

const actionYml = yaml.load(fs.readFileSync(path.join(ROOT, 'action.yml'), 'utf8')) as any
const reviewWorkflow = yaml.load(
  fs.readFileSync(path.join(ROOT, '.github/workflows/openai-review.yml'), 'utf8')
) as any

const declaredInputs: Record<string, any> = actionYml.inputs ?? {}

/** 递归收集 src 下全部 .ts 源文件 */
function collectTsFiles(dir: string): string[] {
  const results: string[] = []
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) results.push(...collectTsFiles(full))
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) results.push(full)
  }
  return results
}

interface InputRead {
  /** 解析方式：action.yml 里所有 input 都是字符串，真正有语义的类型是代码怎么读它 */
  type: string
  /** 读取位置，失败时直接给出可跳转的 file:line */
  locations: string[]
}

/**
 * 扫描 **整个 src** 收集被读取的 Action input。
 *
 * 只扫 github-config-provider.ts 会让「A6：禁止静默读取」形同虚设——
 * `src/octokit.ts` 就在配置层之外读 `getInput('token')`。
 */
function collectInputReads(): {reads: Map<string, InputRead>; scannedFiles: string[]} {
  // 顺序即优先级：int/float 比兜底的 string 更精确
  // onlyIn 限定生效文件——lint 工具版本表在 GitHub 侧是 input 名，
  // 在 GitLab 侧是同形状的环境变量名（AI_REVIEWER_*），不能一起当成 input
  const patterns: Array<{pattern: RegExp; type: string; onlyIn?: string}> = [
    {pattern: /getBooleanInput\(\s*'([^']+)'/g, type: 'boolean'},
    {pattern: /getMultilineInput\(\s*'([^']+)'/g, type: 'multiline'},
    {pattern: /validateIntStr\(\s*getInput\(\s*'([^']+)'/g, type: 'int'},
    {pattern: /validateFloatStr\(\s*getInput\(\s*'([^']+)'/g, type: 'float'},
    {
      pattern: /\['(?:eslint|biome|tsc|prettier|semgrep)',\s*'([^']+)'\]/g,
      type: 'string',
      onlyIn: 'github-config-provider.ts'
    },
    {pattern: /getInput\(\s*'([^']+)'/g, type: 'string'}
  ]

  const reads = new Map<string, InputRead>()
  const scannedFiles = collectTsFiles(path.join(ROOT, 'src')).map(f => path.relative(ROOT, f))
  for (const file of collectTsFiles(path.join(ROOT, 'src'))) {
    const src = fs.readFileSync(file, 'utf8')
    const rel = path.relative(ROOT, file)
    for (const {pattern, type, onlyIn} of patterns) {
      if (onlyIn != null && !file.endsWith(onlyIn)) continue
      for (const m of src.matchAll(pattern)) {
        const line = src.slice(0, m.index ?? 0).split('\n').length
        const existing = reads.get(m[1])
        if (existing == null) {
          reads.set(m[1], {type, locations: [`${rel}:${line}`]})
        } else if (!existing.locations.includes(`${rel}:${line}`)) {
          existing.locations.push(`${rel}:${line}`)
        }
      }
    }
  }
  return {reads, scannedFiles}
}

const {reads: inputReads, scannedFiles} = collectInputReads()
const readTypes = new Map([...inputReads].map(([name, read]) => [name, read.type]))

/**
 * 敏感输入表（GH-002「敏感性」维度的权威来源）。
 *
 * 敏感 = 该输入的值本身是凭据或可推断凭据，日志/错误/调试输出中必须脱敏。
 * 当前为空：密钥（OPENAI_API_KEY / GITHUB_TOKEN）一律走 env，不做公开 input。
 * 新增敏感输入时必须登记到这里——快照会因分类变化而失败，逼出显式确认。
 */
const SENSITIVE_INPUTS = new Set<string>([])

/** 名称启发式：作为「新增了像密钥的输入却没登记」的绊线，不作为分类依据 */
function looksSensitive(name: string): boolean {
  return /(^|_)(token|key|secret|password|credential)s?($|_)/i.test(name)
}

/**
 * 已知的「代码读取但 action.yml 未声明」豁免项。
 *
 * 当前为空：`src/octokit.ts` 原先读 `getInput('token')` 作为 GITHUB_TOKEN 的
 * fallback，已删除——密钥只走 env，不作为公开 Action input 暴露。
 *
 * 下面的用例会双向断言：豁免项必须真实存在于扫描结果中——否则这条豁免会在
 * 代码变更后变成无人察觉的死配置。
 */
const KNOWN_UNDECLARED_READS = new Set<string>([])

describe('GH-001: Action 入口保持不变', () => {
  test('action.yml 声明 node24 运行时与 dist/index.js 入口', () => {
    expect(actionYml.runs).toEqual({using: 'node24', main: 'dist/index.js'})
  })

  test('dist/index.js 存在且为可运行的打包产物', () => {
    const bundle = path.join(ROOT, 'dist/index.js')
    expect(fs.existsSync(bundle)).toBe(true)
    // 空文件/占位符也能"存在"，用体积下限排除
    expect(fs.statSync(bundle).size).toBeGreaterThan(100_000)
  })

  test('action.yml 保留 name / description / branding 等市场元数据', () => {
    expect(typeof actionYml.name).toBe('string')
    expect(typeof actionYml.description).toBe('string')
    expect(actionYml.branding).toBeDefined()
  })
})

describe('GH-002: Action input 快照与不变量', () => {
  test('全部 input 的名称、必填、默认值、解析类型快照', () => {
    const snapshot = Object.keys(declaredInputs)
      .sort()
      .map(name => ({
        name,
        required: declaredInputs[name].required ?? false,
        default: declaredInputs[name].default,
        type: readTypes.get(name) ?? '(未被任何源码读取)',
        sensitive: SENSITIVE_INPUTS.has(name)
      }))
    expect(snapshot).toMatchSnapshot()
  })

  test('input 数量与快照一致（新增/删除必须显式更新快照）', () => {
    expect(Object.keys(declaredInputs).length).toMatchSnapshot()
  })

  test('每个 input 都有 description 和显式 default', () => {
    const incomplete = Object.entries(declaredInputs)
      .filter(([, spec]) => spec.description == null || spec.default === undefined)
      .map(([name]) => name)
    expect(incomplete).toEqual([])
  })

  test('扫描覆盖整个 src，而不只是配置层（否则本组门禁形同虚设）', () => {
    // 断言的是「扫了哪些文件」而非「哪些文件里有读取」——否则一旦配置层之外
    // 恰好没有违规，这条自证就会随之失效，门禁又退回只看一个文件也能通过
    expect(scannedFiles).toEqual(
      expect.arrayContaining([
        'src/octokit.ts',
        'src/main.ts',
        'src/platform/github-config-provider.ts'
      ])
    )
    expect(scannedFiles.length).toBeGreaterThan(30)
  })

  test('octokit.ts 只从 env 取 GITHUB_TOKEN，不读 Action 输入', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/octokit.ts'), 'utf8')
    expect(src).toContain('process.env.GITHUB_TOKEN')
    expect(src).not.toMatch(/getInput\(/)
  })

  test('代码读取的 input 必须已在 action.yml 声明（A6：禁止静默读取）', () => {
    const undeclared = [...inputReads.entries()]
      .filter(([name]) => declaredInputs[name] == null && !KNOWN_UNDECLARED_READS.has(name))
      .map(([name, read]) => `${name}（${read.locations.join(', ')}）`)
    expect(undeclared).toEqual([])
  })

  test('未声明豁免项必须真实存在，避免变成无人察觉的死配置', () => {
    const stale = [...KNOWN_UNDECLARED_READS].filter(
      name => !inputReads.has(name) || declaredInputs[name] != null
    )
    expect(stale).toEqual([])
  })

  test('声明的 input 必须被代码读取（避免遗留死输入）', () => {
    const unread = Object.keys(declaredInputs).filter(name => !readTypes.has(name))
    expect(unread).toEqual([])
  })

  test('敏感性：不得把密钥做成 Action input，密钥只能走 env', () => {
    expect([...SENSITIVE_INPUTS]).toEqual([])
    expect(Object.keys(declaredInputs).filter(name => SENSITIVE_INPUTS.has(name))).toEqual([])
  })

  test('名称像密钥的新输入必须登记进敏感输入表（启发式绊线）', () => {
    const unregistered = Object.keys(declaredInputs).filter(
      name => looksSensitive(name) && !SENSITIVE_INPUTS.has(name)
    )
    expect(unregistered).toEqual([])
  })

  test('resolve_token 保持注释状态（PAT 不作为公开输入暴露）', () => {
    const raw = fs.readFileSync(path.join(ROOT, 'action.yml'), 'utf8')
    expect(declaredInputs.resolve_token).toBeUndefined()
    // 注释块仍在，说明是有意保留的历史决策而非被误删
    expect(raw).toMatch(/#\s*resolve_token:/)
  })

  test('布尔型 input 的默认值只能是 true/false 字符串', () => {
    const booleanInputs = [...readTypes.entries()]
      .filter(([, type]) => type === 'boolean')
      .map(([name]) => name)
    expect(booleanInputs.length).toBeGreaterThan(5)

    const invalid = booleanInputs
      .filter(name => declaredInputs[name] != null)
      .filter(name => !['true', 'false'].includes(String(declaredInputs[name].default)))
    expect(invalid).toEqual([])
  })

  test('数值型 input 的默认值必须可解析为数字', () => {
    const numericInputs = [...readTypes.entries()]
      .filter(([, type]) => type === 'int' || type === 'float')
      .map(([name]) => name)
    expect(numericInputs.length).toBeGreaterThan(3)

    const invalid = numericInputs
      .filter(name => declaredInputs[name] != null)
      .filter(name => Number.isNaN(Number(declaredInputs[name].default)))
    expect(invalid).toEqual([])
  })
})

describe('GH-003/GH-004: workflow 触发事件保持不变', () => {
  // js-yaml 会把裸 key `on:` 解析成布尔 true（YAML 1.1），需按此取值
  const triggers = reviewWorkflow.on ?? reviewWorkflow[true as unknown as string]

  test('PR 自动审查覆盖 opened / synchronize / reopened', () => {
    expect(triggers.pull_request_target.types).toEqual(['opened', 'synchronize', 'reopened'])
  })

  test('保留 issue_comment 与 pull_request_review_comment 入口（仅 created）', () => {
    expect(triggers.issue_comment.types).toEqual(['created'])
    expect(triggers.pull_request_review_comment.types).toEqual(['created'])
  })

  test('workflow 声明最小权限', () => {
    expect(reviewWorkflow.permissions).toEqual({
      contents: 'read',
      'pull-requests': 'write'
    })
  })
})

describe('SEC-001~006: pull_request_target 执行面不得接触 PR head', () => {
  const reviewJob = reviewWorkflow.jobs.review
  const rawWorkflow = fs.readFileSync(
    path.join(ROOT, '.github/workflows/openai-review.yml'),
    'utf8'
  )

  const checkoutStep = reviewJob.steps.find((s: any) =>
    String(s.uses ?? '').startsWith('actions/checkout')
  )

  test('review job 存在 checkout 步骤（用于取可信代码，不是取 PR）', () => {
    expect(checkoutStep).toBeDefined()
  })

  test('checkout 固定默认分支，绝不指向 PR head 的 repo/ref', () => {
    expect(checkoutStep.with.ref).toBe('${{ github.event.repository.default_branch }}')
    // repository 一旦出现就意味着可能切到 fork 仓库
    expect(checkoutStep.with.repository).toBeUndefined()
  })

  test('持密钥的 review job 内不出现任何 PR head 引用', () => {
    // 作用域是 job 而非整个文件：SEC-002 的双 job 方案里，无密钥的 lint job
    // 合法地 checkout PR head。跨 workflow 的完整安全规则由
    // workflow-security.test.ts 负责，这里只钉 reviewer 自己这一格。
    const serialized = JSON.stringify(reviewJob)
    for (const forbidden of [
      'pull_request.head.repo',
      'pull_request.head.ref',
      'pull_request.head.sha'
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  test('checkout 不保留凭据', () => {
    expect(checkoutStep.with['persist-credentials']).toBe(false)
  })

  test('持有密钥的步骤关闭 shell 与 lint（二者都需要工作区里的 PR 代码）', () => {
    const actionStep = reviewJob.steps.find((s: any) => s.uses === './')
    expect(actionStep).toBeDefined()
    // 确认这一步确实拿着密钥——否则下面的断言就失去意义
    expect(actionStep.env.OPENAI_API_KEY).toBeDefined()
    expect(actionStep.env.GITHUB_TOKEN).toBeDefined()

    expect(actionStep.with.enable_shell).toBe(false)
    expect(actionStep.with.enable_lint_tools).toBe(false)
  })

  test('job 级显式声明最小权限（SEC-006）', () => {
    expect(reviewJob.permissions).toEqual({contents: 'read', 'pull-requests': 'write'})
  })
})

describe('GH-005: 并发与取消策略保持不变', () => {
  const concurrency = reviewWorkflow.concurrency

  test('并发分组按仓库 + PR + workflow + 评论 ID 划分', () => {
    for (const fragment of [
      'github.repository',
      'github.event.number',
      'github.workflow',
      "github.event.comment.id || 'pr'"
    ]) {
      expect(concurrency.group).toContain(fragment)
    }
  })

  test('评论事件不取消在途任务，PR 事件取消旧任务（旧任务不得写入新 PR 状态）', () => {
    // 评论事件各自独占分组且不取消，避免连续评论互相驱逐；
    // PR 事件同分组取消在途，保证旧 SHA 的审查不会覆盖新 HEAD 的结果
    expect(concurrency['cancel-in-progress']).toContain(
      "github.event_name != 'pull_request_review_comment'"
    )
    expect(concurrency['cancel-in-progress']).toContain("github.event_name != 'issue_comment'")
  })
})
