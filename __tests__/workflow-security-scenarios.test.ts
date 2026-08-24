/**
 * workflow-security-scenarios.test.ts — 四类 PR 的 workflow 安全场景测试（SEC-007）
 *
 * 与 workflow-security.test.ts 的分工：那边断言 workflow **写法**上的规则
 * （不出现某个字符串、权限不超标、Action 固定 SHA）；这边把真实 workflow 拿来，
 * 配上四种事件 payload，把 `${{ }}` 表达式**真解析一遍**，断言解析出来的具体值。
 *
 * 为什么要解析而不是继续匹配字符串：字符串规则只能挡住已知写法。攻击面是
 * 「持密钥的 job 最终拿到了攻击者能控制的值」，而通往这个结果的表达式写法有
 * 无数种（head.ref / head.sha / head.repo.full_name / merge_commit_sha /
 * 经由 needs 中转……）。把攻击者可控的字段全部埋成哨兵串，再断言持密钥 job 的
 * 解析结果里一个哨兵都不出现，规则就与写法无关了。
 *
 * 边界（务必如实理解）：这里跑的是**表达式求值**，不是真实 runner。
 * 它能证明「按当前 workflow 的写法，密钥不会流向攻击者可控的 ref」，
 * 不能替代在真实 PR 上跑一次（§3 验收②，仍未完成）。
 */
import {describe, expect, test} from '@jest/globals'
import * as fs from 'fs'
import * as path from 'path'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const yaml = require('js-yaml')

const WORKFLOW = path.resolve(__dirname, '../.github/workflows/openai-review.yml')
const doc: any = yaml.load(fs.readFileSync(WORKFLOW, 'utf8'))

const OWN_REPO = 'CodesSentinels/ai-reviewer'
const DEFAULT_BRANCH = 'main'

/**
 * 攻击者可控的值一律用哨兵串，且**互不相同**——这样断言失败时能直接看出
 * 是哪个字段泄进了持密钥 job。
 */
const ATTACKER = {
  headSha: 'ATTACKERSHA0000000000000000000000000000a',
  headRef: 'ATTACKER-BRANCH-NAME',
  headRepo: 'attacker-org/ai-reviewer-fork',
  mergeSha: 'ATTACKERSHA0000000000000000000000000000b',
  title: 'ATTACKER-PR-TITLE',
  body: 'ATTACKER-PR-BODY',
  login: 'ATTACKER-LOGIN'
}
const SENTINELS = Object.values(ATTACKER)

/** 业务密钥的哨兵：解析后出现在哪个 job，就说明那个 job 持有它 */
const SECRETS = {
  GITHUB_TOKEN: 'SECRET-GITHUB-TOKEN',
  OPENAI_API_KEY: 'SECRET-OPENAI-API-KEY'
}

interface Scenario {
  name: string
  ctx: any
  /** 该场景下 head 仓库全名（fork 时是攻击者的） */
  headRepo: string
}

function makeCtx(over: {headRepo: string; senderType?: string; senderLogin?: string}): any {
  return {
    github: {
      repository: OWN_REPO,
      actor: over.senderLogin ?? ATTACKER.login,
      event_name: 'pull_request_target',
      sha: 'BASESHA00000000000000000000000000000000c',
      head_ref: ATTACKER.headRef,
      workflow: 'OpenAI Reviewer',
      token: SECRETS.GITHUB_TOKEN,
      event: {
        number: 42,
        repository: {default_branch: DEFAULT_BRANCH, full_name: OWN_REPO},
        sender: {login: over.senderLogin ?? ATTACKER.login, type: over.senderType ?? 'User'},
        pull_request: {
          number: 42,
          title: ATTACKER.title,
          body: ATTACKER.body,
          merge_commit_sha: ATTACKER.mergeSha,
          user: {login: over.senderLogin ?? ATTACKER.login, type: over.senderType ?? 'User'},
          head: {
            sha: ATTACKER.headSha,
            ref: ATTACKER.headRef,
            repo: {full_name: over.headRepo, fork: over.headRepo !== OWN_REPO}
          },
          base: {sha: 'BASESHA00000000000000000000000000000000c', repo: {full_name: OWN_REPO}}
        }
      }
    },
    secrets: SECRETS,
    runner: {temp: '/home/runner/work/_temp'},
    // resolve-pr 通过 API 查询得到，值仍然是 PR head——同样按攻击者可控处理
    needs: {
      'resolve-pr': {
        outputs: {
          head_sha: ATTACKER.headSha,
          base_sha: 'BASESHA00000000000000000000000000000000c',
          head_repo: over.headRepo
        }
      }
    }
  }
}

const SCENARIOS: Scenario[] = [
  {name: 'fork PR', ctx: makeCtx({headRepo: ATTACKER.headRepo}), headRepo: ATTACKER.headRepo},
  {name: '同项目 PR', ctx: makeCtx({headRepo: OWN_REPO}), headRepo: OWN_REPO},
  {
    name: '机器人 PR',
    ctx: makeCtx({headRepo: OWN_REPO, senderType: 'Bot', senderLogin: 'dependabot[bot]'}),
    headRepo: OWN_REPO
  },
  {
    // 恶意 PR：fork + 作者已篡改 dist/、workflow、package scripts、src/、依赖。
    // 篡改发生在 PR head 里，因此凡是解析到 head 的东西都等于执行攻击者代码。
    name: '恶意 PR（改 dist/workflow/package scripts/源码/依赖）',
    ctx: makeCtx({headRepo: ATTACKER.headRepo}),
    headRepo: ATTACKER.headRepo
  }
]

/** 取 `a.b.c`；带引号的当字面量 */
function lookup(expr: string, ctx: any): unknown {
  const t = expr.trim()
  if (/^'.*'$/.test(t)) return t.slice(1, -1)
  if (/^-?\d+(\.\d+)?$/.test(t)) return t // 数字字面量，别按 a.b 路径去查
  return t.split('.').reduce<any>((o, k) => (o == null ? undefined : o[k]), ctx)
}

/** 求值 `${{ ... }}`，支持 `a || b` 回退链（workflow 里用得很多） */
function resolveExpr(raw: unknown, ctx: any): string {
  return String(raw ?? '').replace(/\$\{\{([^}]+)\}\}/g, (_m, body: string) => {
    for (const alt of body.split('||')) {
      const v = lookup(alt, ctx)
      if (v != null && v !== '') return String(v)
    }
    return ''
  })
}

/** 深度求值一个对象里的所有字符串 */
function resolveDeep(node: unknown, ctx: any): unknown {
  if (typeof node === 'string') return resolveExpr(node, ctx)
  if (Array.isArray(node)) return node.map(n => resolveDeep(n, ctx))
  if (node != null && typeof node === 'object') {
    return Object.fromEntries(
      Object.entries(node as Record<string, unknown>).map(([k, v]) => [k, resolveDeep(v, ctx)])
    )
  }
  return node
}

const jobs: Record<string, any> = doc.jobs
const stepsOf = (job: any): any[] => (Array.isArray(job?.steps) ? job.steps : [])

/** 该 job 是否持有业务密钥或写权限（只读 GITHUB_TOKEN 不算——checkout 私有仓库要用） */
function hasBusinessSecrets(job: any): boolean {
  const env = JSON.stringify(stepsOf(job).map(s => s.env ?? {}))
  return (
    /secrets\.(?!GITHUB_TOKEN)/.test(env) || JSON.stringify(job.permissions ?? {}).includes('write')
  )
}

const SECRET_JOBS = Object.entries(jobs).filter(([, j]) => hasBusinessSecrets(j))
const CHECKOUT = 'actions/checkout'

describe('SEC-007 前置：场景求值器本身没有空跑', () => {
  test('workflow 里确实存在待求值的表达式', () => {
    expect(fs.readFileSync(WORKFLOW, 'utf8')).toContain('${{')
  })

  test('求值器能解析回退链与字面量', () => {
    const ctx = SCENARIOS[0].ctx
    expect(resolveExpr('${{ github.event.repository.default_branch }}', ctx)).toBe(DEFAULT_BRANCH)
    expect(resolveExpr('${{ github.event.pull_request.head.ref }}', ctx)).toBe(ATTACKER.headRef)
    // 回退链：前者为空时取后者
    expect(resolveExpr('${{ github.event.comment.id || 42 }}', ctx)).toBe('42')
  })

  test('确有 job 被判定为持业务密钥（否则下面全是空跑）', () => {
    expect(SECRET_JOBS.map(([n]) => n)).toEqual(['review'])
  })

  test('哨兵串确实能被检出（自检）', () => {
    const leaked = JSON.stringify(
      resolveDeep({ref: '${{ github.event.pull_request.head.sha }}'}, SCENARIOS[0].ctx)
    )
    expect(SENTINELS.some(s => leaked.includes(s))).toBe(true)
  })
})

describe.each(SCENARIOS)('$name', ({ctx, headRepo}) => {
  test('持密钥 job 的所有输入解析后不含任何攻击者可控值', () => {
    for (const [name, job] of SECRET_JOBS) {
      const resolved = JSON.stringify(resolveDeep(stepsOf(job), ctx))
      const leaked = SENTINELS.filter(s => resolved.includes(s))
      expect(`${name}: ${leaked.join(', ')}`).toBe(`${name}: `)
    }
  })

  test('持密钥 job 的 checkout 解析为默认分支，且不指定 repository', () => {
    for (const [name, job] of SECRET_JOBS) {
      const checkouts = stepsOf(job).filter(s => String(s.uses ?? '').startsWith(CHECKOUT))
      expect(checkouts.length).toBeGreaterThan(0)
      for (const c of checkouts) {
        const w = resolveDeep(c.with ?? {}, ctx) as Record<string, string>
        expect(`${name}:ref=${w.ref}`).toBe(`${name}:ref=${DEFAULT_BRANCH}`)
        expect(w.repository).toBeUndefined()
        expect(String(w['persist-credentials'])).toBe('false')
      }
    }
  })

  test('持密钥 job 执行的代码只来自可信 checkout 或固定 SHA 的外部 Action', () => {
    for (const [name, job] of SECRET_JOBS) {
      for (const step of stepsOf(job)) {
        const uses = String(step.uses ?? '')
        if (uses === '') continue
        // `./` = 工作区根 = 上面刚断言过的默认分支 checkout
        const ok = uses === './' || /@[0-9a-f]{40}$/.test(uses)
        expect(`${name}:${uses}`).toBe(ok ? `${name}:${uses}` : `${name}: 不可信来源`)
      }
    }
  })

  test('业务密钥只出现在持密钥 job（不泄漏到 lint / resolve-pr）', () => {
    for (const [name, job] of Object.entries(jobs)) {
      const resolved = JSON.stringify(resolveDeep(stepsOf(job), ctx))
      const hasOpenAi = resolved.includes(SECRETS.OPENAI_API_KEY)
      expect(`${name}:openai=${hasOpenAi}`).toBe(`${name}:openai=${name === 'review'}`)
    }
  })

  test('resolve-pr 只查 API，不 checkout 任何代码', () => {
    const checkouts = stepsOf(jobs['resolve-pr']).filter(s =>
      String(s.uses ?? '').startsWith(CHECKOUT)
    )
    expect(checkouts).toHaveLength(0)
  })

  test('lint job 确实扫到了本场景的 PR head（正向断言，防止「什么都没扫」也算通过）', () => {
    const prCheckout = stepsOf(jobs.lint)
      .filter(s => String(s.uses ?? '').startsWith(CHECKOUT))
      .map(s => resolveDeep(s.with ?? {}, ctx) as Record<string, string>)
      .find(w => w.path === 'pr')

    expect(prCheckout).toBeDefined()
    expect(prCheckout?.repository).toBe(headRepo)
    expect(prCheckout?.ref).toBe(ATTACKER.headSha)
  })

  test('执行 PR 代码的那一步解析后不带任何凭据', () => {
    const exec = stepsOf(jobs.lint).find(s => String(s.run ?? '').includes('dist/lint-report'))
    expect(exec).toBeDefined()
    const env = JSON.stringify(resolveDeep(exec.env ?? {}, ctx))
    for (const secret of Object.values(SECRETS)) {
      expect(env).not.toContain(secret)
    }
  })
})

/** 剥掉 shell 行注释（行首或空白后的 #），避免注释里的说明文字触发误判 */
function stripShellComments(script: string): string {
  return script
    .split('\n')
    .map(line => line.replace(/(^|\s)#.*$/, '$1'))
    .join('\n')
}

describe('恶意 PR：五类篡改各自被哪条机制挡住（§3 验收①）', () => {
  const ctx = SCENARIOS[3].ctx
  const review = jobs.review
  const lint = jobs.lint

  test('改 workflow 本身 —— 生效的是 base 分支的 workflow（pull_request_target）', () => {
    // pull_request 触发器会用 PR 里的 workflow 定义；pull_request_target 用 base 的
    // YAML 1.1 把裸 `on:` 解析成布尔真键，两种都取
    const triggers = Object.keys(doc.on ?? (doc as Record<string, any>)['true'] ?? {})
    expect(triggers).toContain('pull_request_target')
    expect(triggers).not.toContain('pull_request')
  })

  test('改 Action 源码 / dist/index.js —— review 跑的是默认分支 checkout 的 ./', () => {
    const action = stepsOf(review).find(s => String(s.uses ?? '') === './')
    expect(action).toBeDefined()
    // 工作区根来自上面解析为 default_branch 的 checkout，与 PR head 无关
    const checkout = stepsOf(review).find(s => String(s.uses ?? '').startsWith(CHECKOUT))
    const w = resolveDeep(checkout.with ?? {}, ctx) as Record<string, string>
    expect(w.ref).toBe(DEFAULT_BRANCH)
    // 且 ./ 之前没有任何把 PR 内容放进工作区根的步骤
    const idx = stepsOf(review).indexOf(action)
    for (const step of stepsOf(review).slice(0, idx)) {
      const w2 = JSON.stringify(resolveDeep(step.with ?? {}, ctx))
      expect(SENTINELS.filter(s => w2.includes(s))).toEqual([])
    }
  })

  test('改 dist/lint-report —— lint 从可信工作区根执行，只把 pr/ 当扫描对象', () => {
    const exec = stepsOf(lint).find(s => String(s.run ?? '').includes('dist/lint-report'))
    const run = String(exec.run)
    // 执行的脚本路径不能落在 pr/ 下
    expect(run).toMatch(/node\s+dist\/lint-report\/index\.js/)
    expect(run).not.toMatch(/node\s+(\.\/)?pr\//)
    // pr/ 只能作为 --repo-root 的值（数据），不能作为入口
    expect(run).toContain('--repo-root pr')
    expect(exec['working-directory']).toBeUndefined()
  })

  test('pr/ 只能作为 --repo-root 的值出现，不能被别的 flag 当成入口或配置', () => {
    // 注入验证时发现的缺口：`--repo-root pr --config pr/lint.config.js` 原本能
    // 全绿通过。LINT-007 要求 CLI 不从 pr/ 解析入口、插件或依赖，光断言
    // 「入口脚本不在 pr/ 下」挡不住经由其它参数把 pr/ 里的 JS 喂进来。
    const exec = stepsOf(lint).find(s => String(s.run ?? '').includes('dist/lint-report'))
    const tokens = String(exec.run)
      .split(/\s+/)
      .filter(t => t !== '')

    const prTokens = tokens
      .map((t, i) => ({t, prev: tokens[i - 1] ?? ''}))
      .filter(({t}) => t === 'pr' || t.startsWith('pr/') || t.startsWith('./pr'))

    expect(prTokens.length).toBeGreaterThan(0) // 正向：确实扫了 pr/
    for (const {t, prev} of prTokens) {
      expect(`${prev} ${t}`).toBe(`--repo-root ${t}`)
    }
  })

  test('改 package scripts / 依赖 —— 没有任何步骤在 pr/ 里装依赖或跑 script', () => {
    for (const [name, job] of Object.entries(jobs)) {
      for (const step of stepsOf(job)) {
        const run = String(step.run ?? '')
        if (run === '') continue
        const inPr = step['working-directory'] === 'pr'
        // pr/ 目录里不得出现包管理器动作
        if (inPr) {
          expect(`${name}:${run}`).not.toMatch(/npm |yarn |pnpm |npx /)
        }
        // 任何位置都不得对 pr/ 执行安装或 script
        expect(`${name}`).toBe(name)
        expect(run).not.toMatch(/(npm|yarn|pnpm)\s+(ci|install|run)[^\n]*pr\//)
        expect(run).not.toMatch(/--prefix\s+pr\b/)
      }
    }
  })

  test('尝试读密钥 —— 持密钥 job 全程没有 run: 步骤，没有可注入的执行点', () => {
    const runSteps = stepsOf(review).filter(s => s.run != null)
    expect(runSteps.map(s => String(s.run).slice(0, 40))).toEqual([])
  })

  /**
   * TEST-025 的 install hooks 那一维。
   *
   * `npm ci` 会执行 preinstall / postinstall / prepare 等生命周期脚本——攻击者
   * 不必改 package scripts，塞一个带 install hook 的依赖就够了。上一条断言的是
   * 「不在 pr/ 里装依赖」；这条补的是：**凡是会装依赖的步骤，都必须在装之前就
   * 已经不可能看到 PR 内容**，且持密钥 job 一次都不装。
   */
  test('改 install hooks —— 持密钥 job 不装依赖，生命周期脚本无从触发', () => {
    for (const step of stepsOf(review)) {
      const run = String(step.run ?? '')
      expect(run).not.toMatch(/(npm|yarn|pnpm)\s+(ci|install)/)
    }
  })

  test('改 install hooks —— 每一个装依赖的步骤都在 PR 代码落盘之前', () => {
    // 只看第一个安装步骤是不够的：下面这种顺序会被漏掉——
    //   npm ci  →  checkout(path: pr)  →  npm install
    // 第二次安装发生在 PR 内容已经在工作区之后，install hook 就能跑起来。
    // 所以收集**全部**安装步骤，逐个与最早的 PR checkout 位置比较。
    const violations: string[] = []

    for (const [name, job] of Object.entries(jobs)) {
      const steps = stepsOf(job)
      const installIdxs = steps
        .map((step, i) => ({i, run: String(step.run ?? '')}))
        .filter(x => /(npm|yarn|pnpm)\s+(ci|install)/.test(x.run))
        .map(x => x.i)
      const prCheckoutIdxs = steps
        .map((step, i) => ({i, step}))
        .filter(
          x =>
            String(x.step.uses ?? '').startsWith('actions/checkout') &&
            String(x.step.with?.path ?? '') === 'pr'
        )
        .map(x => x.i)

      if (prCheckoutIdxs.length === 0) continue
      const firstPrCheckout = Math.min(...prCheckoutIdxs)

      for (const idx of installIdxs) {
        if (idx > firstPrCheckout) {
          violations.push(
            `${name}: step#${idx} 安装依赖发生在 PR checkout(#${firstPrCheckout}) 之后`
          )
        }
      }
    }

    expect(violations).toEqual([])
  })

  /**
   * TEST-026 的日志那一维。
   *
   * 密钥进日志和密钥被读走一样严重——日志对仓库协作者可见，PR 作者往往就是
   * 协作者。这里查两件事：没有任何步骤开启命令回显（会把展开后的环境变量打出
   * 来），也没有任何步骤把 secrets 表达式直接 echo 出去。
   */
  test('读日志 —— 没有步骤开启 shell 命令回显（set -x / bash -x）', () => {
    for (const [name, job] of Object.entries(jobs)) {
      for (const step of stepsOf(job)) {
        // 必须先剥 shell 注释：workflow 里正写着「不用 set -x、不回显 AUTH」，
        // 连注释一起扫会被自己的正确说明判为违规（这个坑踩过三次）
        const run = stripShellComments(String(step.run ?? ''))
        expect(`${name}:${run}`).not.toMatch(/set\s+-[a-z]*x|bash\s+-x|sh\s+-x/)
      }
    }
  })

  test('读日志 —— 没有步骤把 secrets 表达式 echo 出去', () => {
    for (const [name, job] of Object.entries(jobs)) {
      for (const step of stepsOf(job)) {
        const run = stripShellComments(String(step.run ?? ''))
        expect(`${name}:${run}`).not.toMatch(/echo[^\n]*secrets\./)
        expect(`${name}:${run}`).not.toMatch(/echo[^\n]*\$\{\{[^}]*secrets/)
      }
    }
  })

  test('产物是数据不是代码 —— 下载目录在工作区之外，且没有步骤执行它', () => {
    const dl = stepsOf(review).find(s => String(s.uses ?? '').includes('download-artifact'))
    const dest = resolveExpr(dl.with.path, ctx)
    expect(dest.startsWith('/home/runner/work/_temp')).toBe(true)
    for (const step of stepsOf(review)) {
      expect(String(step.run ?? '')).not.toContain(dest)
    }
  })
})

describe('机器人 PR：不因发起人身份放宽任何限制', () => {
  const bot = SCENARIOS[2]
  const human = SCENARIOS[1]

  test('bot 与人类发起的同项目 PR，解析结果逐字节一致', () => {
    const a = JSON.stringify(resolveDeep(doc.jobs, bot.ctx))
    const b = JSON.stringify(resolveDeep(doc.jobs, human.ctx))
    expect(a).toBe(b)
  })

  test('没有任何 job 的 if: 依据发起人身份分支', () => {
    for (const [name, job] of Object.entries(jobs)) {
      const cond = String(job.if ?? '')
      expect(`${name}:${cond}`).not.toMatch(/github\.actor|event\.sender|user\.type|\[bot\]/)
    }
  })
})
