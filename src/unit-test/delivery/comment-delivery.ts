/**
 * unit-test/delivery/comment-delivery.ts - 评论交付（P0）
 *
 * 对应迭代四 §2.6 方式一「Post copyable unit tests in a comment」。
 *
 * 行为:
 * - 一组生成结果聚合为单条 Markdown 评论
 * - 每个测试块带上"目标函数 + 文件路径 + 用例数 + 校验状态"标题
 * - 评论本体由调用方（命令 handler）通过 Reply.success() 发布，
 *   本模块只负责"渲染" Markdown，便于单元测试
 */
import {DEFAULT_BOT_MENTIONS} from '../../commands/parser'
import type {DeliveryInput, DeliveryOutcome, GeneratedTest} from '../types'

/** 复用 parser 的 mention 列表，避免硬编码"@ai-reviewer" */
const PRIMARY_MENTION = DEFAULT_BOT_MENTIONS[0] ?? '@ai-reviewer'

/** 渲染评论 Markdown（纯函数） */
export function renderCommentBody(input: DeliveryInput): string {
  const {run} = input
  const lines: string[] = []

  lines.push('## 🧪 Generated Unit Tests')

  if (run.tests.length === 0) {
    lines.push('')
    lines.push('> 未生成任何测试。')
    if (run.skipped.length > 0) {
      lines.push('')
      lines.push('### 跳过的目标')
      for (const s of run.skipped) {
        lines.push(`- \`${s.target.name}\` (${s.target.filePath}) — ${s.reason}`)
      }
    }
    if (run.warnings.length > 0) {
      lines.push('')
      for (const w of run.warnings) lines.push(`> ⚠️ ${w}`)
    }
    return lines.join('\n')
  }

  lines.push('')
  lines.push(coverageTable(run.tests))
  lines.push('')

  for (const t of run.tests) {
    lines.push(renderSingleTest(t))
  }

  if (run.skipped.length > 0) {
    lines.push('')
    lines.push('<details><summary>跳过的目标</summary>')
    lines.push('')
    for (const s of run.skipped) {
      lines.push(`- \`${s.target.name}\` (${s.target.filePath}) — ${s.reason}`)
    }
    lines.push('')
    lines.push('</details>')
  }

  if (run.warnings.length > 0) {
    lines.push('')
    for (const w of run.warnings) lines.push(`> ⚠️ ${w}`)
  }

  lines.push('')
  lines.push(
    `> 📋 复制代码块到对应测试文件路径即可。或回复 \`${PRIMARY_MENTION} generate unit tests --commit\` 直接提交到当前 PR 分支。`
  )

  return lines.join('\n')
}

function renderSingleTest(t: GeneratedTest): string {
  const fence = fenceFor(t.target.language)
  const status = t.passedStaticCheck ? '✅ static-check passed' : `⚠️ ${t.staticCheckError ?? 'static-check failed'}`

  return [
    `### \`${t.target.name}\` — \`${t.target.filePath}\``,
    '',
    `- Framework: \`${t.framework}\``,
    `- Suggested test file: \`${t.suggestedTestPath}\``,
    `- Cases: ${t.caseCount}`,
    `- Validation: ${status}`,
    '',
    '```' + fence,
    t.code,
    '```'
  ].join('\n')
}

function coverageTable(tests: GeneratedTest[]): string {
  const head = '| 目标 | 测试文件 | 用例数 | 校验 |'
  const sep = '| :--- | :--- | ---: | :---: |'
  const rows = tests.map(
    t =>
      `| \`${t.target.name}\` | \`${t.suggestedTestPath}\` | ${t.caseCount} | ${t.passedStaticCheck ? '✅' : '⚠️'} |`
  )
  return [head, sep, ...rows].join('\n')
}

function fenceFor(lang: string): string {
  switch (lang) {
    case 'typescript':
      return 'typescript'
    case 'javascript':
      return 'javascript'
    case 'python':
      return 'python'
    case 'go':
      return 'go'
    default:
      return ''
  }
}

/** 命令侧调用入口：返回 outcome（实际发布由命令 handler 通过 Reply 完成） */
export function commentDelivery(input: DeliveryInput): {
  body: string
  outcome: DeliveryOutcome
} {
  const body = renderCommentBody(input)
  return {
    body,
    outcome: {
      mode: 'comment',
      succeeded: input.run.tests.length,
      errors: input.run.skipped.map(s => `${s.target.name}: ${s.reason}`)
    }
  }
}
