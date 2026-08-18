/**
 * gitlab-ci-config.test.ts — .gitlab-ci.yml 结构性安全守卫（CI-002~013）
 *
 * 没有真实 GitLab 测试项目（ai-reviewer-test 尚未接入），Protected
 * Variable/Pipeline Trigger 的真实生效行为无法端到端回放。这里把
 * docs/tasks/gitlab-ci-design.md 里定的"两个 job 必须怎样隔离"钉成静态断言，
 * 跟 __tests__/workflow-security.test.ts（GitHub 侧 SEC-*）是同一个思路，
 * 覆盖的是 GitLab 侧 CI-*。
 */
import {describe, expect, test} from '@jest/globals'
import * as fs from 'fs'
import * as path from 'path'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const yaml = require('js-yaml')

const CONFIG_PATH = path.resolve(__dirname, '../.gitlab-ci.yml')
const raw = fs.readFileSync(CONFIG_PATH, 'utf8')
const doc = yaml.load(raw) as any

const MR_VERIFY = 'mr_verify'
const TRIGGER = 'ai_review_trigger'

function job(name: string): any {
  return doc[name]
}

function scriptOf(jobDoc: any): string {
  const script = jobDoc.script ?? []
  return (Array.isArray(script) ? script : [script]).join('\n')
}

function ruleConditionsOf(jobDoc: any): string[] {
  const rules = jobDoc.rules ?? []
  return rules.map((r: any) => r.if).filter((x: any) => typeof x === 'string')
}

describe('CI-001: .gitlab-ci.yml 存在且能被解析', () => {
  test('文件存在', () => {
    expect(fs.existsSync(CONFIG_PATH)).toBe(true)
  })

  test('两个 job 都定义了', () => {
    expect(job(MR_VERIFY)).toBeDefined()
    expect(job(TRIGGER)).toBeDefined()
  })
})

describe('CI-006: mr_verify 与 ai_review_trigger 的触发条件互斥', () => {
  test('mr_verify 只在 merge_request_event 触发', () => {
    const conditions = ruleConditionsOf(job(MR_VERIFY))
    expect(conditions.length).toBeGreaterThan(0)
    for (const c of conditions) {
      expect(c).toContain('CI_PIPELINE_SOURCE == "merge_request_event"')
    }
  })

  test('ai_review_trigger 只在 trigger 来源 + protected default branch 触发', () => {
    const conditions = ruleConditionsOf(job(TRIGGER))
    expect(conditions.length).toBeGreaterThan(0)
    for (const c of conditions) {
      expect(c).toContain('CI_PIPELINE_SOURCE == "trigger"')
      expect(c).toContain('CI_COMMIT_REF_NAME == $CI_DEFAULT_BRANCH')
    }
  })

  test('两个 job 的触发条件不可能同时成立（同一次 pipeline 只有一个 CI_PIPELINE_SOURCE 值）', () => {
    const verifyConditions = ruleConditionsOf(job(MR_VERIFY)).join(' ')
    const triggerConditions = ruleConditionsOf(job(TRIGGER)).join(' ')
    expect(verifyConditions).toContain('merge_request_event')
    expect(triggerConditions).toContain('trigger')
    expect(verifyConditions).not.toContain('"trigger"')
    expect(triggerConditions).not.toContain('merge_request_event')
  })
})

describe('CI-004/CI-008: 两个 job 之间没有 artifact 依赖', () => {
  test('mr_verify 没有 needs/dependencies（不消费任何其他 job 的产物）', () => {
    expect(job(MR_VERIFY).needs).toBeUndefined()
    expect(job(MR_VERIFY).dependencies).toBeUndefined()
  })

  test('ai_review_trigger 没有 needs/dependencies 指向 mr_verify（不消费 MR 构建产物）', () => {
    expect(job(TRIGGER).needs).toBeUndefined()
    expect(job(TRIGGER).dependencies).toBeUndefined()
  })

  test('mr_verify 的 artifact 设了过期时间（只用于本次验证，不长期保留）', () => {
    expect(job(MR_VERIFY).artifacts?.expire_in).toBeDefined()
  })
})

describe('CI-007/CI-008: ai_review_trigger 不 build/不执行 MR 代码', () => {
  const script = scriptOf(job(TRIGGER))

  test('脚本里没有 npm ci / npm install（不在这个 job 里安装依赖）', () => {
    expect(script).not.toMatch(/npm (ci|install)\b/)
  })

  test('脚本里没有 npm run build / npm run package（不在这个 job 里构建）', () => {
    expect(script).not.toMatch(/npm run (build|package)\b/)
  })

  test('脚本最终执行的是仓库自带的 dist/gitlab-trigger/index.js', () => {
    expect(script).toContain('node dist/gitlab-trigger/index.js')
  })

  test('GIT_STRATEGY 设为 clone（不复用可能残留 MR 分支内容的 workspace）', () => {
    expect(job(TRIGGER).variables?.GIT_STRATEGY).toBe('clone')
  })
})

describe('CI-013: ai_review_trigger 校验 bundle 来源', () => {
  test('脚本读取并比对 dist/gitlab-trigger/SOURCE_SHA 与 CI_COMMIT_SHA', () => {
    const script = scriptOf(job(TRIGGER))
    expect(script).toContain('dist/gitlab-trigger/SOURCE_SHA')
    expect(script).toContain('CI_COMMIT_SHA')
  })

  /**
   * 2026-08-18 真实 GitLab 环境验证（Issue #118）暴露：`[ "$RECORDED_SHA" !=
   * "$CI_COMMIT_SHA" ]` 精确相等校验永远无法自洽——`git rev-parse HEAD` 写入
   * SOURCE_SHA 时那个 commit 还不包含这次写入本身，随后无论是单独的"重新打包
   * dist"提交，还是 PR 合并产生的 merge commit，都会让 CI_COMMIT_SHA 与写入
   * 时的 HEAD 不再相等，导致这个 job 在受保护分支上永远拒绝执行。改为祖先链
   * 校验（`git merge-base --is-ancestor`），保留"必须是真实历史上的 commit，
   * 挡住伪造/其他分支的 SHA"这条安全属性，但不再要求恰好等于当前 HEAD。
   */
  test('用祖先链校验（git merge-base --is-ancestor）而不是精确字符串相等', () => {
    const script = scriptOf(job(TRIGGER))
    expect(script).toContain('git merge-base --is-ancestor')
    expect(script).not.toMatch(/\["\$RECORDED_SHA"\s*!=\s*"\$CI_COMMIT_SHA"\]/)
  })

  test('先校验 RECORDED_SHA 确实是仓库里的真实 commit，再做祖先链判断', () => {
    const script = scriptOf(job(TRIGGER))
    expect(script).toContain('git cat-file -e')
  })

  test('GIT_DEPTH 设为 0（完整历史），否则浅克隆会让祖先链校验误判', () => {
    expect(job(TRIGGER).variables?.GIT_DEPTH).toBe('0')
  })
})

describe('CI-009: ai_review_trigger 配置 resource_group', () => {
  test('resource_group 为 ai-reviewer-mvp', () => {
    expect(job(TRIGGER).resource_group).toBe('ai-reviewer-mvp')
  })
})

describe('CI-011: ai_review_trigger 有 timeout 和有限 retry', () => {
  test('配置了 timeout', () => {
    expect(job(TRIGGER).timeout).toBeDefined()
  })

  test('retry 上限不超过 2 次，且只针对基础设施性故障', () => {
    const retry = job(TRIGGER).retry
    expect(retry).toBeDefined()
    expect(retry.max).toBeLessThanOrEqual(2)
    expect(retry.when).toEqual(
      expect.arrayContaining(['runner_system_failure', 'stuck_or_timeout_failure'])
    )
  })
})

describe('CI-003: mr_verify 只做布尔断言，不展开密钥值', () => {
  const script = scriptOf(job(MR_VERIFY))

  test('脚本里出现了针对 GITLAB_PAT/OPENAI_API_KEY 的检查', () => {
    expect(script).toContain('GITLAB_PAT')
    expect(script).toContain('OPENAI_API_KEY')
  })

  test('脚本里没有直接 echo 密钥值的写法（$GITLAB_PAT / $OPENAI_API_KEY 前面不是纯变量名判断）', () => {
    expect(script).not.toMatch(/echo\s+.*\$GITLAB_PAT\b/)
    expect(script).not.toMatch(/echo\s+.*\$OPENAI_API_KEY\b/)
  })

  test('脚本里没有 CI_JOB_TOKEN 的非空断言（它不是要防的业务密钥，天然存在于每个 job）', () => {
    // 只应该出现在设计文档/注释里讨论为什么排除它，不应该被断言为"必须为空"
    const nonCommentLines = script
      .split('\n')
      .filter(l => !l.trim().startsWith('#'))
      .join('\n')
    expect(nonCommentLines).not.toContain('CI_JOB_TOKEN')
  })
})

describe('结构完整性：防止 YAML 误改导致断言空跑', () => {
  test('mr_verify 的 rules 数组非空', () => {
    expect(ruleConditionsOf(job(MR_VERIFY)).length).toBeGreaterThan(0)
  })

  test('ai_review_trigger 的 rules 数组非空', () => {
    expect(ruleConditionsOf(job(TRIGGER)).length).toBeGreaterThan(0)
  })

  test('两个 job 的 script 都非空', () => {
    expect(scriptOf(job(MR_VERIFY)).length).toBeGreaterThan(0)
    expect(scriptOf(job(TRIGGER)).length).toBeGreaterThan(0)
  })
})
