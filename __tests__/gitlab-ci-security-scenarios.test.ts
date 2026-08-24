/**
 * gitlab-ci-security-scenarios.test.ts — 恶意 MR 的五类篡改（TEST-022~026，GitLab 侧）
 *
 * TEST-022~026 说的是「恶意 PR 与 MR 两侧」，但既有的场景化测试
 * （`workflow-security-scenarios.test.ts`）只覆盖 GitHub。GitLab 侧虽然有
 * `gitlab-ci-config.test.ts` 逐条检查配置项，那是**从配置出发**问「这个字段对不
 * 对」；本文件是**从攻击者出发**问「我改这个文件，能拿到什么」——两种视角抓的
 * 问题不一样：前者能确认 `GIT_STRATEGY: clone` 存在，后者才会问「那 MR 分支的
 * 代码到底有没有可能进到持密钥的 job」。
 *
 * ## GitLab 的执行面切分
 *
 *   mr_verify           不可信面：跑 MR 自己的代码（npm ci / build / test），
 *                       但**没有业务密钥**——GitLab 的 Protected 变量只注入
 *                       protected 分支，MR 分支拿不到
 *   ai_review_trigger   持密钥面：只在 `CI_PIPELINE_SOURCE == "trigger"` 且
 *                       `CI_COMMIT_REF_NAME == CI_DEFAULT_BRANCH` 时运行，
 *                       只执行仓库里已受信任的 bundle
 *
 * 五类篡改各自被哪条机制挡住，逐条写明。
 *
 * ## 这个文件**证明不了**什么（重要）
 *
 * 本文件只能验证**仓库内**的结构：`.gitlab-ci.yml` 的规则、脚本顺序、job 之间
 * 的产物流向。而 GitLab 侧真正把密钥挡在恶意 MR 之外的，是两项**项目设置**：
 *
 *   Protected variables   只注入 protected 分支的 pipeline
 *   Protected branch      默认分支受保护，MR 分支不是
 *
 * 这两项在仓库里没有任何投影——恶意 MR 完全可以把 `.gitlab-ci.yml` 里的密钥
 * 自检整段删掉，本文件的断言读的是**默认分支**上的配置，一点反应都不会有。
 *
 * 这个前提对 `TEST-022~026` **五条都成立**：攻击者改自己分支上的
 * `.gitlab-ci.yml`，SOURCE_SHA 祖先链校验、「持密钥 job 不装依赖」这些
 * 仓库内机制统统可以删掉。他唯一拿不到的是 Protected variables。
 *
 * 所以五条的 GitLab 侧**全部保持未勾选**，等真实恶意 MR 验收确认
 * `GITLAB_PAT` / `OPENAI_API_KEY` 在 MR pipeline 中确实不可见之后再说。
 * 本文件的价值是**纵深防御的回归门禁**——默认分支上的这些机制不能悄悄退化，
 * 而不是「已经证明恶意 MR 拿不到密钥」。
 *
 * ## CI_JOB_TOKEN 是已知的例外
 *
 * `mr_verify` 会执行攻击者控制的 install hooks 与 package scripts，而
 * `CI_JOB_TOKEN` 天然存在于每个 job——恶意代码读得到，也能外传。把它排除在
 * 「业务密钥」之外是**设计上的接受**，不是「读不到」：
 *
 *   - 它是 job 级、随 job 结束失效的短期 token
 *   - 它的跨项目访问范围由 GitLab 的 Token Access allowlist 控制
 *
 * 但这两条同样是项目设置，本文件无从验证。所以下面的断言只声称「业务密钥
 * 不可见」，不声称「secret 不可读取」。
 */
import {describe, expect, test} from '@jest/globals'
import * as fs from 'fs'
import * as path from 'path'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const yaml = require('js-yaml')

const REPO_ROOT = path.join(__dirname, '..')
const ciRaw = fs.readFileSync(path.join(REPO_ROOT, '.gitlab-ci.yml'), 'utf8')
const ci = yaml.load(ciRaw) as any

const mrVerify = ci.mr_verify
const trigger = ci.ai_review_trigger

/** 把 job 的 script 拼成单串，便于整体检查 */
function scriptOf(job: any): string {
  const parts = [...(job.before_script ?? []), ...(job.script ?? []), ...(job.after_script ?? [])]
  return parts.join('\n')
}

/**
 * 业务密钥。
 *
 * `CI_JOB_TOKEN` **不在此列**，但那是「已接受的例外」而非「读不到」——见文件头
 * 说明。不能因为它被排除，就把结论说成「恶意 MR 读不到任何 secret」。
 */
const BUSINESS_SECRETS = ['GITLAB_PAT', 'OPENAI_API_KEY']

// ═══════════════════ 前置：夹具本身没有空跑 ═════════════════════════════════

describe('前置：两个 job 都解析出来了，判定不是空转', () => {
  test('mr_verify 与 ai_review_trigger 都存在且有 script', () => {
    expect(mrVerify).toBeDefined()
    expect(trigger).toBeDefined()
    expect(scriptOf(mrVerify).length).toBeGreaterThan(0)
    expect(scriptOf(trigger).length).toBeGreaterThan(0)
  })

  test('两个 job 的触发条件互斥（同一次 pipeline 只会命中一个）', () => {
    const mrRule = JSON.stringify(mrVerify.rules)
    const triggerRule = JSON.stringify(trigger.rules)

    expect(mrRule).toContain('merge_request_event')
    expect(triggerRule).toContain('trigger')
    expect(triggerRule).toContain('CI_DEFAULT_BRANCH')
  })
})

// ═══════════════════ 五类篡改 ═══════════════════════════════════════════════

describe('恶意 MR：五类篡改各自被哪条机制挡住（TEST-022~026）', () => {
  /**
   * TEST-024：改 `.gitlab-ci.yml` 本身。
   *
   * GitLab 与 GitHub 在这里的机制完全不同：GitHub 靠 `pull_request_target` 用
   * base 分支的 workflow；GitLab 的 MR pipeline **会**用 MR 分支的
   * `.gitlab-ci.yml`——攻击者确实能改。挡住他的是另外两件事：
   *
   *   1. 持密钥的 job 只在 `CI_PIPELINE_SOURCE == "trigger"` 时运行，而 MR
   *      pipeline 的来源是 `merge_request_event`，规则不匹配
   *   2. 就算他把规则改成 trigger，Protected 变量也只注入 protected 分支，
   *      MR 分支上那个 job 拿不到密钥
   */
  test('改 .gitlab-ci.yml —— 持密钥 job 的规则同时要求 trigger 来源与默认分支', () => {
    // 直接取 if 表达式原文比对：JSON.stringify 会把内层引号转义成 \\"，
    // 拿转义后的串去 contain 原文永远不匹配
    const conditions = (trigger.rules as any[]).map(r => String(r.if ?? '')).join(' ')

    // 两个条件缺一不可：只有来源判断的话，攻击者在自己分支上手动触发就能命中
    expect(conditions).toContain('$CI_PIPELINE_SOURCE == "trigger"')
    expect(conditions).toContain('$CI_COMMIT_REF_NAME == $CI_DEFAULT_BRANCH')
  })

  /**
   * 注意这条断言的**边界**：它证明的是「默认分支上的 mr_verify 带着密钥自检」，
   * 不是「恶意 MR 拿不到密钥」。攻击者改自己分支上的 `.gitlab-ci.yml` 就能把这段
   * 删掉，而本文件读的是默认分支的配置。真正的屏障是 Protected variables，
   * 那是项目设置，只能靠真实恶意 MR 验收。
   */
  test('默认分支上的 mr_verify 带业务密钥自检（不等于恶意 MR 读不到）', () => {
    const script = scriptOf(mrVerify)

    for (const secret of BUSINESS_SECRETS) {
      expect(script).toContain(secret)
    }
    expect(script).toMatch(/LEAK/)
    expect(script).toMatch(/exit 1/)
  })

  /**
   * CI_JOB_TOKEN 的现状固化。
   *
   * 它在 mr_verify 里是可读的（攻击者控制的 install hooks 就在同一个 job）。
   * 这条不是「防住了」，而是把「我们知道它可读、并接受」写成可执行的记录——
   * 哪天有人把业务密钥也按同样理由排除，就会先撞到这条用例的说明。
   */
  test('CI_JOB_TOKEN 是已接受的例外，不计入业务密钥', () => {
    expect(BUSINESS_SECRETS).not.toContain('CI_JOB_TOKEN')
    // 但配置里不得主动把它 echo 出来，或塞进 artifact
    const all = `${scriptOf(mrVerify)}\n${scriptOf(trigger)}`
    expect(all).not.toMatch(/echo[^\n]*CI_JOB_TOKEN/)
  })

  /**
   * TEST-022/023：改 reviewer 源码 / dist bundle。
   *
   * 持密钥 job 不 build，直接跑仓库里的 `dist/gitlab-trigger/index.js`。
   * 攻击者改 MR 分支上的 dist 没用——那个 job 根本不 checkout MR 分支
   * （`GIT_STRATEGY: clone` + 只在默认分支上运行），而且 CI-013 会校验
   * bundle 记录的 SOURCE_SHA 确实是这条受保护分支历史上的 commit。
   */
  test('改 reviewer 源码 —— 持密钥 job 不 build、不装依赖', () => {
    const script = scriptOf(trigger)

    expect(script).not.toMatch(/npm\s+(ci|install)/)
    expect(script).not.toMatch(/npm\s+run\s+(build|package)/)
  })

  test('改 dist bundle —— 校验步骤全部排在 bundle 执行之前', () => {
    // 只查「这些字符串存在」是不够的：把 `node dist/...` 挪到校验前面，
    // 关键字照样都在，测试却全绿——而那时 bundle 已经跑完了。
    // 所以按 script 数组的**位置**断言。
    const steps = trigger.script as string[]
    const idxOf = (pattern: RegExp): number => steps.findIndex(line => pattern.test(String(line)))

    const catFile = idxOf(/git cat-file -e/)
    const mergeBase = idxOf(/git merge-base --is-ancestor/)
    const refused = idxOf(/REFUSED/)
    const readSha = idxOf(/dist\/gitlab-trigger\/SOURCE_SHA/)
    const runBundle = idxOf(/node dist\/gitlab-trigger\/index\.js/)

    // 先确认每一环都存在（缺任何一个，下面的比较就没有意义）
    for (const [label, idx] of [
      ['读取 SOURCE_SHA', readSha],
      ['git cat-file -e', catFile],
      ['git merge-base --is-ancestor', mergeBase],
      ['REFUSED 退出', refused],
      ['执行 bundle', runBundle]
    ] as Array<[string, number]>) {
      expect(`${label}: ${idx}`).not.toBe(`${label}: -1`)
    }

    // 全部校验都必须早于执行
    expect(readSha).toBeLessThan(runBundle)
    expect(catFile).toBeLessThan(runBundle)
    expect(mergeBase).toBeLessThan(runBundle)
    expect(refused).toBeLessThan(runBundle)
  })

  test('改 dist bundle —— 校验失败时以非零码退出，不继续执行', () => {
    const script = scriptOf(trigger)

    // 两处 REFUSED 分支都必须紧跟 exit 1，否则只是打条日志然后照跑
    const refusedBlocks = script.split('REFUSED').slice(1)
    expect(refusedBlocks.length).toBeGreaterThanOrEqual(2)
    for (const block of refusedBlocks) {
      expect(block.slice(0, 200)).toMatch(/exit 1/)
    }
  })

  test('改 dist bundle —— GIT_STRATEGY: clone，工作区不残留任何 MR 分支内容', () => {
    expect(trigger.variables?.GIT_STRATEGY).toBe('clone')
    // 浅克隆会让祖先链校验因历史不全而误判
    expect(String(trigger.variables?.GIT_DEPTH)).toBe('0')
  })

  /**
   * TEST-025：改 package scripts、依赖和 install hooks。
   *
   * `npm ci` 会执行 preinstall/postinstall 等生命周期脚本——这是供应链攻击最
   * 常见的入口。持密钥 job 一次都不装依赖，所以攻击者改 `package.json` 的
   * scripts 或塞一个带 install hook 的依赖，都只能在**没有密钥**的 mr_verify
   * 里执行。
   */
  test('改 package scripts / install hooks —— 持密钥 job 不触发任何生命周期脚本', () => {
    const script = scriptOf(trigger)

    // 任何会执行 package.json scripts 的命令都不允许出现
    expect(script).not.toMatch(/npm\s+(ci|install|run|test|start|exec)\b/)
    expect(script).not.toMatch(/\bnpx\b/)
    expect(script).not.toMatch(/\byarn\b|\bpnpm\b/)
  })

  /**
   * 只做对照，不声称安全。
   *
   * 原用例名是「装依赖只发生在不可信面，且**那一面无密钥**」——后半句过度声称：
   * 断言实际只看到脚本里有 LEAK 自检，而自检本身可以被恶意 MR 删掉；
   * `CI_JOB_TOKEN` 更是明确可读。这里只保留它该有的作用：证明上一条
   * 「持密钥 job 不装依赖」不是因为整个仓库压根没人装依赖。
   */
  test('对照：装依赖确实发生在 mr_verify（否则「不装」这条没有意义）', () => {
    expect(scriptOf(mrVerify)).toMatch(/npm\s+ci/)
    expect(scriptOf(trigger)).not.toMatch(/npm\s+ci/)
  })

  /**
   * TEST-026：尝试读取环境、文件系统、artifact 和日志中的 secret。
   */
  test('读环境 —— 持密钥 job 的 script 里没有遍历/导出环境变量的写法', () => {
    const script = scriptOf(trigger)

    expect(script).not.toMatch(/\benv\b\s*(\||>|$)/m)
    expect(script).not.toMatch(/\bprintenv\b/)
    expect(script).not.toMatch(/\bset\s+-x\b/) // 会把变量展开打进日志
  })

  test('读 artifact —— 持密钥 job 不消费任何其他 job 的产物', () => {
    expect(trigger.needs).toBeUndefined()
    expect(trigger.dependencies).toBeUndefined()
  })

  test('读 artifact —— 不可信面的产物有过期时间，且不流向持密钥面', () => {
    expect(mrVerify.artifacts?.expire_in).toBeDefined()
    // 反向：持密钥 job 没有 needs 指向 mr_verify（上一条已断言 needs 不存在），
    // 这里再确认它也没声明 artifacts 供别人取用
    expect(trigger.artifacts).toBeUndefined()
  })

  test('读日志 —— 持密钥 job 不 echo 任何业务密钥变量', () => {
    const script = scriptOf(trigger)

    for (const secret of BUSINESS_SECRETS) {
      // 允许出现变量名（比如注释里说明），但不允许 `echo $SECRET` 这种展开
      expect(script).not.toMatch(new RegExp(`echo[^\\n]*\\$\\{?${secret}`))
    }
  })

  test('读日志 —— 不可信面的密钥自检只做布尔判断，不展开值', () => {
    const script = scriptOf(mrVerify)

    for (const secret of BUSINESS_SECRETS) {
      expect(script).not.toMatch(new RegExp(`echo[^\\n]*\\$\\{?${secret}\\b`))
    }
    // 它输出的是变量**名**，不是值
    expect(script).toMatch(/LEAK: \$VAR/)
  })
})

// ═══════════════════ 触发面本身的收窄 ═══════════════════════════════════════

describe('持密钥 job 的执行面收窄', () => {
  test('只跑一条命令：仓库自带的 bundle', () => {
    const runnable = (trigger.script as string[]).filter(
      line => !line.trim().startsWith('#') && line.trim() !== ''
    )
    const last = runnable[runnable.length - 1]

    expect(last).toContain('node dist/gitlab-trigger/index.js')
  })

  test('串行执行面 + 有限超时与重试（STATE-009 / CI-011）', () => {
    expect(trigger.resource_group).toBe('ai-reviewer-mvp')
    expect(trigger.timeout).toBeDefined()
    expect(trigger.retry?.max).toBeLessThanOrEqual(2)
  })

  test('不使用自定义 runner tag（只跑在共享 runner 上）', () => {
    // MVP 红线：持密钥 job 不落到持久化 self-hosted runner
    expect(trigger.tags).toBeUndefined()
  })
})
