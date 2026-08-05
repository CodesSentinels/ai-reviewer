/**
 * arch-guard.test.ts — 架构守卫测试（ARCH-023）
 *
 * 阻止共享核心新增直接平台依赖。
 * 共享核心文件不得直接 import:
 *   - @actions/core（应使用 Logger 抽象）
 *   - @actions/github（应使用 ExecutionContext）
 *   - octokit / @octokit/*（应使用 IGitPlatform）
 *   - @gitbeaker/*（应使用 IGitPlatform）
 *
 * 允许直接 import 的文件（平台 adapter 层 + 遗留待迁移文件）：
 *   - src/octokit.ts（认证层）
 *   - src/main.ts（GitHub 入口）
 *   - src/gitlab-trigger.ts（GitLab 入口）
 *   - src/platform/github-*.ts（GitHub adapter）
 *   - src/platform/gitlab-*.ts（GitLab adapter）
 *   - ARCH-018 full convergence 前暂时豁免的遗留文件
 */
import {describe, expect, test} from '@jest/globals'
import * as fs from 'fs'
import * as path from 'path'

const SRC = path.resolve(__dirname, '../src')

/** 递归收集所有 .ts 文件 */
function collectTsFiles(dir: string): string[] {
  const results: string[] = []
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (['node_modules', 'dist'].includes(entry.name)) continue
      results.push(...collectTsFiles(full))
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      results.push(full)
    }
  }
  return results
}

/**
 * ARCH-018 full convergence 完成前暂时豁免的文件。
 * 每当一个文件完成迁移（不再直接 import octokit/@actions/core），
 * 就从此列表移除，让架构测试自动捕获回退。
 */
const LEGACY_ALLOWLIST = new Set([
  // 直接 import @actions/github（ARCH-005 context 迁移目标）
  'review.ts',
  'commenter.ts',
  'commands/dispatcher.ts',
  // 直接 import @actions/core（Logger 迁移目标）
  'bot.ts',
  'command-handler.ts',
  'commands/early-reaction.ts',
  'fix-suggestion-header.ts',
  'inputs.ts',
  'lint/adapters/biome.ts',
  'lint/adapters/eslint.ts',
  'lint/adapters/exec.ts',
  'lint/adapters/prettier.ts',
  'lint/adapters/semgrep.ts',
  'lint/adapters/tsc.ts',
  'lint/lint-filter.ts',
  'lint/orchestrator.ts',
  'lint/tool-installer.ts',
  'options.ts'
])

/** 平台 adapter / 入口层文件 */
function isAdapterOrEntry(rel: string): boolean {
  if (/^platform\/(github-|gitlab-)/.test(rel)) return true
  return ['octokit.ts', 'main.ts', 'gitlab-trigger.ts'].includes(rel)
}

function isExempt(rel: string): boolean {
  return isAdapterOrEntry(rel) || LEGACY_ALLOWLIST.has(rel)
}

describe('ARCH-023: 共享核心不得新增直接平台依赖', () => {
  const allFiles = collectTsFiles(SRC)
  const coreFiles = allFiles.filter(f => !isExempt(path.relative(SRC, f).replace(/\\/g, '/')))

  test('共享核心文件列表非空（防止 glob 误匹配导致假通过）', () => {
    expect(coreFiles.length).toBeGreaterThan(5)
  })

  test('@actions/core 不应出现在共享核心中', () => {
    const violations: string[] = []
    for (const f of coreFiles) {
      const content = fs.readFileSync(f, 'utf8')
      if (/from ['"]@actions\/core['"]/.test(content)) {
        violations.push(path.relative(SRC, f))
      }
    }
    expect(violations).toEqual([])
  })

  test('@actions/github 不应出现在共享核心中', () => {
    const violations: string[] = []
    for (const f of coreFiles) {
      const content = fs.readFileSync(f, 'utf8')
      if (/from ['"]@actions\/github['"]/.test(content)) {
        violations.push(path.relative(SRC, f))
      }
    }
    expect(violations).toEqual([])
  })

  test('octokit 直接 import 不应出现在共享核心中', () => {
    const violations: string[] = []
    for (const f of coreFiles) {
      const content = fs.readFileSync(f, 'utf8')
      if (/from ['"]\.\.?\/octokit['"]/.test(content)) {
        violations.push(path.relative(SRC, f))
      }
    }
    expect(violations).toEqual([])
  })

  test('@gitbeaker 不应出现在共享核心中', () => {
    const violations: string[] = []
    for (const f of coreFiles) {
      const content = fs.readFileSync(f, 'utf8')
      if (/from ['"]@gitbeaker\//.test(content)) {
        violations.push(path.relative(SRC, f))
      }
    }
    expect(violations).toEqual([])
  })

  test('IGitPlatform 接口文件存在', () => {
    expect(fs.existsSync(path.join(SRC, 'platform/git-platform.ts'))).toBe(true)
  })

  test('GitHub adapter 文件存在', () => {
    expect(fs.existsSync(path.join(SRC, 'platform/github-platform.ts'))).toBe(true)
  })
})
