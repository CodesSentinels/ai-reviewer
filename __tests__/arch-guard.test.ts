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
const LEGACY_ALLOWLIST = new Set<string>([
  // 原先这里是 review.ts / commenter.ts / commands/dispatcher.ts（ARCH-005 context
  // 迁移目标）。三者已改为只消费 ExecutionContext + IGitPlatform，不再 import
  // @actions/github，因此从豁免列表移除——这正是迁移的意义：让门禁能挡住回退。
  // 原先这里还有 17 个直接 import @actions/core 的文件（Logger 迁移目标）。
  // SEC-008 把它们的日志出口统一换成了 src/actions-log.ts 的脱敏包装，
  // 不再直接依赖 @actions/core，因此从豁免列表移除。
])

/** 平台 adapter / 入口层文件 */
function isAdapterOrEntry(rel: string): boolean {
  if (/^platform\/(github-|gitlab-)/.test(rel)) return true
  // actions-log.ts 是 @actions/core 日志出口的脱敏包装（SEC-008），
  // 属于 GitHub 平台边界层，允许直接 import @actions/core
  return ['octokit.ts', 'main.ts', 'gitlab-trigger.ts', 'actions-log.ts'].includes(rel)
}

function isExempt(rel: string): boolean {
  return isAdapterOrEntry(rel) || LEGACY_ALLOWLIST.has(rel)
}

/**
 * 判定 import 必须先剥注释：文档注释里写「迁移前是 import ... from '@actions/github'」
 * 这类说明是常态，把它算成违规会逼着注释绕开事实。
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
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
      const content = stripComments(fs.readFileSync(f, 'utf8'))
      if (/from ['"]@actions\/core['"]/.test(content)) {
        violations.push(path.relative(SRC, f))
      }
    }
    expect(violations).toEqual([])
  })

  test('@actions/github 不应出现在共享核心中', () => {
    const violations: string[] = []
    for (const f of coreFiles) {
      const content = stripComments(fs.readFileSync(f, 'utf8'))
      if (/from ['"]@actions\/github['"]/.test(content)) {
        violations.push(path.relative(SRC, f))
      }
    }
    expect(violations).toEqual([])
  })

  test('octokit 直接 import 不应出现在共享核心中', () => {
    const violations: string[] = []
    for (const f of coreFiles) {
      const content = stripComments(fs.readFileSync(f, 'utf8'))
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

/** 粗粒度剥离注释（块注释/行注释），避免文档里提到 "execCtx.raw" 这几个字触发假阳性 */
describe('ARCH-005: 共享业务层不得新增 execCtx.raw 读取（GitHub Issue #88 P2 复核）', () => {
  // 已知例外：conversation.ts 需要 review comment 的 diff_hunk/path 等深层 GitHub
  // 字段，以及完整 PR title/body/base/head sha——这些依赖 Commenter（本身仍直接
  // import @actions/github，见上方 LEGACY_ALLOWLIST）提供的上下文，是比本次修复
  // 范围更大的独立迁移任务（尚无 GLAPI-*/REVIEW-* 对应任务落地），暂不消除，
  // 只冻结在这份 allowlist 里，防止新文件继续蔓延同类读取。
  const RAW_READ_ALLOWLIST = new Set(['conversation.ts'])

  const allFiles = collectTsFiles(SRC)
  const coreFiles = allFiles.filter(f => {
    const rel = path.relative(SRC, f).replace(/\\/g, '/')
    return !isAdapterOrEntry(rel) && !RAW_READ_ALLOWLIST.has(rel)
  })

  test('共享核心文件列表非空（防止 glob 误匹配导致假通过）', () => {
    expect(coreFiles.length).toBeGreaterThan(5)
  })

  test('execCtx.raw 不应在共享核心中被读取', () => {
    const violations: string[] = []
    for (const f of coreFiles) {
      const content = stripComments(fs.readFileSync(f, 'utf8'))
      if (/\.raw\b/.test(content)) {
        violations.push(path.relative(SRC, f))
      }
    }
    expect(violations).toEqual([])
  })

  test('allowlist 中的文件仍然真实读取 execCtx.raw（防止清单陈旧、掩盖假通过）', () => {
    for (const rel of RAW_READ_ALLOWLIST) {
      const content = stripComments(fs.readFileSync(path.join(SRC, rel), 'utf8'))
      expect(content).toMatch(/\.raw\b/)
    }
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
    const allowedExports = new Set([
      'GitLabCredential',
      'GitLabPlatform',
      'FALLBACK_BOT_LOGIN' // GLAPI-022：bot 用户名兜底值，项目自定义字符串常量
    ])

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

describe('GLAPI-031: GitLab HTTP 调用只走统一 client', () => {
  const allFiles = collectTsFiles(SRC)

  test('共享核心不直接 fetch，也不引用 GitLab client factory', () => {
    const coreFiles = allFiles.filter(f => !isExempt(path.relative(SRC, f).replace(/\\/g, '/')))
    const violations: string[] = []
    for (const f of coreFiles) {
      const content = fs.readFileSync(f, 'utf8')
      if (/\bfetch\s*\(/.test(content) || /from ['"].*gitlab-client['"]/.test(content)) {
        violations.push(path.relative(SRC, f))
      }
    }
    expect(violations).toEqual([])
  })

  test('GitLab adapter 内没有绕过 client factory 的原生 fetch', () => {
    const gitlabFiles = allFiles.filter(f =>
      /platform\/gitlab-/.test(path.relative(SRC, f).replace(/\\/g, '/'))
    )
    expect(gitlabFiles.length).toBeGreaterThan(0)
    const violations = gitlabFiles.filter(f => /\bfetch\s*\(/.test(fs.readFileSync(f, 'utf8')))
    expect(violations.map(f => path.relative(SRC, f))).toEqual([])
  })

  test('GitHub adapter 不引用 GitLab client（adapter 不跨平台）', () => {
    const githubFiles = allFiles.filter(f =>
      /platform\/github-/.test(path.relative(SRC, f).replace(/\\/g, '/'))
    )
    const violations = githubFiles.filter(f =>
      /gitlab/i.test(fs.readFileSync(f, 'utf8').replace(/\/\/.*|\/\*[\s\S]*?\*\//g, ''))
    )
    expect(violations.map(f => path.relative(SRC, f))).toEqual([])
  })
})

describe('SEC-008: @actions/core 日志出口只能经脱敏包装', () => {
  const allFiles = collectTsFiles(SRC)
  /** 允许直接从 @actions/core 导入日志函数的文件 */
  const LOG_EXPORT_EXEMPT = new Set(['actions-log.ts', 'platform/github-logger.ts'])
  const LOG_FUNCTIONS = ['info', 'warning', 'error', 'debug', 'setFailed']

  test('只有包装层与 GitHubLogger 直接导入 @actions/core 的日志函数', () => {
    const violations: string[] = []
    for (const f of allFiles) {
      const rel = path.relative(SRC, f).replace(/\\/g, '/')
      if (LOG_EXPORT_EXEMPT.has(rel)) continue
      const content = fs.readFileSync(f, 'utf8')
      const m = /import\s*\{([^}]*)\}\s*from\s*['"]@actions\/core['"]/.exec(content)
      if (m == null) continue
      const imported = m[1].split(',').map(n => n.trim())
      const leaked = imported.filter(n => LOG_FUNCTIONS.includes(n))
      if (leaked.length > 0) violations.push(`${rel} → ${leaked.join(', ')}`)
    }
    expect(violations).toEqual([])
  })

  test('也不得通过动态 require 绕开包装层', () => {
    const violations: string[] = []
    for (const f of allFiles) {
      const rel = path.relative(SRC, f).replace(/\\/g, '/')
      if (LOG_EXPORT_EXEMPT.has(rel)) continue
      const code = fs
        .readFileSync(f, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
      if (/require\s*\(\s*['"]@actions\/core['"]\s*\)/.test(code)) violations.push(rel)
    }
    expect(violations).toEqual([])
  })

  test('除平台 Logger 外不得直接使用 console 输出（会完全绕过脱敏）', () => {
    // 平台 Logger 本身就是 console 的封装，是唯一合法出口
    const CONSOLE_EXEMPT = new Set(['platform/logger.ts', 'platform/gitlab-logger.ts'])
    const violations: string[] = []
    for (const f of allFiles) {
      const rel = path.relative(SRC, f).replace(/\\/g, '/')
      if (CONSOLE_EXEMPT.has(rel)) continue
      // 注释里会举例提到 console.log（如 biome adapter 的 reporter 说明），先剥掉
      const code = fs
        .readFileSync(f, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
      const hits = code.match(/console\.(log|warn|error|debug|info)\s*\(/g)
      if (hits != null) violations.push(`${rel} → ${hits.join(', ')}`)
    }
    expect(violations).toEqual([])
  })

  test('包装层确实存在且每个日志函数都过 redactForLog', () => {
    const src = fs.readFileSync(path.join(SRC, 'actions-log.ts'), 'utf8')
    for (const fn of LOG_FUNCTIONS) {
      expect(src).toMatch(new RegExp(`export function ${fn}\\b`))
    }
    // 每个导出函数体内都必须调用 redactForLog，一个都不能漏
    const bodies = src.match(/export function \w+\([^)]*\)[^{]*\{[^}]*\}/g) ?? []
    expect(bodies.length).toBe(LOG_FUNCTIONS.length)
    for (const body of bodies) {
      expect(body).toContain('redactForLog(')
    }
  })

  test('高风险路径：bot.ts 打印异常与 stack，必须走包装层', () => {
    const src = fs.readFileSync(path.join(SRC, 'bot.ts'), 'utf8')
    expect(src).toMatch(/from '\.\/actions-log'/)
    expect(src).toContain('e.stack')
  })
})

describe('GH-015: 平台状态 marker 不跨平台读写', () => {
  const allFiles = collectTsFiles(SRC)

  /**
   * 硬编码平台前缀的规则：
   * - 共享核心：一律不得硬编码，必须经 state-namespace 按运行平台生成
   * - 平台 adapter：只允许硬编码**自己**平台的前缀（如 GitLab 写幂等 marker），
   *   绝不允许出现对方平台的前缀
   */
  test('共享核心不硬编码平台 marker 前缀，adapter 只能硬编码自己的', () => {
    const violations: string[] = []
    for (const f of allFiles) {
      const rel = path.relative(SRC, f).replace(/\\/g, '/')
      // state-namespace.ts 是前缀的定义处
      if (rel === 'platform/state-namespace.ts') continue
      // 去掉注释后再匹配，避免命中文档性说明
      const code = fs.readFileSync(f, 'utf8').replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '')
      const own = rel.startsWith('platform/gitlab-')
        ? 'gitlab'
        : rel.startsWith('platform/github-')
        ? 'github'
        : null
      for (const platform of ['github', 'gitlab']) {
        if (platform === own) continue
        if (new RegExp(`['"\`][^'"\`]*ai-reviewer:${platform}:`).test(code)) {
          violations.push(`${rel} → ai-reviewer:${platform}:`)
        }
      }
    }
    expect(violations).toEqual([])
  })

  /**
   * 上一版门禁只查「硬编码的 ai-reviewer:{platform}:」，查不出「压根没有平台前缀」
   * 的漏网 marker——COMMENT_TAG / SUMMARIZE_TAG 当时就是这样躲过去的。
   * 这里正面兜底：src 里出现的 marker 字面量只允许在已登记的 legacy 白名单里。
   */
  test('src 中不存在未登记的无命名空间 marker 字面量', () => {
    // 直接读清单模块：它不依赖 GitHub context，静态检查可安全 require
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const {STATE_MARKERS} = require('../src/state-markers')

    const allowed = new Set<string>()
    for (const spec of Object.values(STATE_MARKERS) as Array<{legacy: string}>) {
      for (const line of spec.legacy.split('\n')) {
        if (line.startsWith('<!--')) allowed.add(line)
      }
    }

    const violations: string[] = []
    for (const f of allFiles) {
      const rel = path.relative(SRC, f).replace(/\\/g, '/')
      const code = fs
        .readFileSync(f, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*/g, '')
      for (const m of code.matchAll(/(<!--[^'"`\n]*?-->)/g)) {
        const lit = m[1]
        // 解析用片段、模板插值的数据包装、已带命名空间的 marker 都不算
        if (lit.replace(/<!--|-->/g, '').trim() === '') continue
        if (lit.includes('${') || lit.includes('ai-reviewer:')) continue
        if (allowed.has(lit)) continue
        violations.push(`${rel} → ${lit}`)
      }
    }
    expect(violations).toEqual([])
  })

  /**
   * 命名空间由入口在运行时设置，模块级常量会在 import 时固化成默认前缀，
   * GitLab 入口之后再调 setStateNamespace() 也改不回来
   * （BOT_COMMENT_TAGS 就踩过这个坑）。
   */
  test('不得在模块级把 marker 固化为常量', () => {
    const markerCalls =
      '(commentTag|commentReplyTag|summarizeTag|inProgressStartTag|inProgressEndTag' +
      '|descriptionStartTag|descriptionEndTag|rawSummaryStartTag|rawSummaryEndTag' +
      '|shortSummaryStartTag|shortSummaryEndTag|stateMarker|stateMarkerVariantsFor' +
      '|commitIdTags|reviewStateTags|buildStateMarker)'
    // 模块级 = 行首没有缩进的 const 声明
    const pattern = new RegExp(
      `^(?:export )?const\\s+\\w+[^\\n=]*=[^\\n]*\\b${markerCalls}\\(`,
      'm'
    )

    const violations: string[] = []
    for (const f of allFiles) {
      const code = fs
        .readFileSync(f, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*/g, '')
      if (pattern.test(code)) violations.push(path.relative(SRC, f).replace(/\\/g, '/'))
    }
    expect(violations).toEqual([])
  })

  test('GitHub adapter 不引用 GitLab 的 marker 模块', () => {
    const githubFiles = allFiles.filter(f =>
      /platform\/github-/.test(path.relative(SRC, f).replace(/\\/g, '/'))
    )
    const violations = githubFiles.filter(f =>
      /gitlab-(write-marker|mr-hook-rules|note-hook-rules)/.test(fs.readFileSync(f, 'utf8'))
    )
    expect(violations.map(f => path.relative(SRC, f))).toEqual([])
  })

  test('GitLab adapter 不引用 GitHub 侧 marker 常量', () => {
    const gitlabFiles = allFiles.filter(f =>
      /platform\/gitlab-/.test(path.relative(SRC, f).replace(/\\/g, '/'))
    )
    const violations = gitlabFiles.filter(f => {
      const code = fs.readFileSync(f, 'utf8').replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '')
      return /commentTag()|summarizeTag()|COMMIT_ID_(START|END)_TAG|REVIEW_STATE_(START|END)_TAG/.test(
        code
      )
    })
    expect(violations.map(f => path.relative(SRC, f))).toEqual([])
  })

  test('入口文件各自声明状态命名空间（否则共享核心会写错前缀）', () => {
    const main = fs.readFileSync(path.join(SRC, 'main.ts'), 'utf8')
    const gitlabTrigger = fs.readFileSync(path.join(SRC, 'gitlab-trigger.ts'), 'utf8')
    expect(main).toMatch(/setStateNamespace\(\s*'github'\s*\)/)
    expect(gitlabTrigger).toMatch(/setStateNamespace\(\s*'gitlab'\s*\)/)
  })
})

describe('SYNC-009: GitLab 运行代码不得读取同步 Token', () => {
  const allFiles = collectTsFiles(SRC)

  // GITLAB_TOKEN 是 .github/workflows/sync-to-gitlab.yml 专用的、持有 GitLab
  // 写权限的同步凭据，只应存在于 GitHub Actions secret 里；GitLab-only 运行时
  // 用的是完全不同的 GITLAB_PAT/CI_JOB_TOKEN（见 gitlab-trigger.ts
  // resolveGitLabCredential()）。src/ 里任何地方出现 GITLAB_TOKEN 字符串，
  // 都意味着有代码在尝试读取本该只属于同步 workflow 的凭据。
  test('src/ 下不出现 GITLAB_TOKEN（与 GITLAB_PAT/CI_JOB_TOKEN 是两个不同凭据）', () => {
    const violations: string[] = []
    for (const f of allFiles) {
      const code = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '')
      if (/\bGITLAB_TOKEN\b/.test(code)) {
        violations.push(path.relative(SRC, f).replace(/\\/g, '/'))
      }
    }
    expect(violations).toEqual([])
  })

  test('gitlab-trigger.ts 确实使用的是 GITLAB_PAT/CI_JOB_TOKEN（防止两个凭据名字都被删掉导致上一条测试空跑）', () => {
    const content = fs.readFileSync(path.join(SRC, 'gitlab-trigger.ts'), 'utf8')
    expect(content).toContain('GITLAB_PAT')
    expect(content).toContain('CI_JOB_TOKEN')
  })
})
