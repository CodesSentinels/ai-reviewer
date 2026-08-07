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

describe('ARCH-024: @gitbeaker/rest 类型不泄露到 IGitPlatform 或共享核心', () => {
  const gitPlatformContent = fs.readFileSync(path.join(SRC, 'platform/git-platform.ts'), 'utf8')
  const gitlabPlatformContent = fs.readFileSync(
    path.join(SRC, 'platform/gitlab-platform.ts'),
    'utf8'
  )

  test('IGitPlatform 定义文件不引用 @gitbeaker（任何形式）', () => {
    // from '@gitbeaker/...'
    expect(gitPlatformContent).not.toMatch(/['"]@gitbeaker\//)
    // import('@gitbeaker/...')
    expect(gitPlatformContent).not.toMatch(/import\s*\(\s*['"]@gitbeaker\//)
    // require('@gitbeaker/...')
    expect(gitPlatformContent).not.toMatch(/require\s*\(\s*['"]@gitbeaker\//)
  })

  test('gitlab-platform.ts 只导出项目自定义类型（allowlist）', () => {
    // 允许导出的项目自定义标识符（新增 export 时必须同步更新此列表）
    const allowedExports = new Set(['GitLabCredential', 'GitLabPlatform'])

    // 匹配所有 export 声明的标识符名称（覆盖多行情况）
    const exportPattern = /export\s+(?:interface|class|type|function|const|enum)\s+(\w+)/g
    const exportedNames: string[] = []
    let match
    while ((match = exportPattern.exec(gitlabPlatformContent)) !== null) {
      exportedNames.push(match[1])
    }

    // 也检查 re-export：export { Foo } from '...' 或 export type { Foo } from '...'
    const reExportPattern = /export\s+(?:type\s+)?{([^}]+)}/g
    while ((match = reExportPattern.exec(gitlabPlatformContent)) !== null) {
      const names = match[1].split(',').map(n =>
        n
          .trim()
          .split(/\s+as\s+/)
          .pop()!
          .trim()
      )
      exportedNames.push(...names.filter(n => n.length > 0))
    }

    expect(exportedNames.length).toBeGreaterThan(0)

    const unexpected = exportedNames.filter(name => !allowedExports.has(name))
    expect(unexpected).toEqual([])
  })

  test('gitlab-platform.ts 内容中不存在 gitbeaker 类型的 re-export 或动态 import', () => {
    // export ... from '@gitbeaker/...'
    expect(gitlabPlatformContent).not.toMatch(/export\s+.*from\s+['"]@gitbeaker\//)
    // import('@gitbeaker/...') 形式的动态类型引用
    expect(gitlabPlatformContent).not.toMatch(/import\s*\(\s*['"]@gitbeaker\//)
    // require('@gitbeaker/...')
    expect(gitlabPlatformContent).not.toMatch(/require\s*\(\s*['"]@gitbeaker\//)
  })

  test('GitLabPlatform 的 Gitlab 实例是 private，不泄露到消费方', () => {
    expect(gitlabPlatformContent).toMatch(/private\s+api/)
  })

  test('GitLab adapter 文件存在', () => {
    expect(fs.existsSync(path.join(SRC, 'platform/gitlab-platform.ts'))).toBe(true)
  })
})
