/**
 * lint-report-cli.test.ts — lint-only 可信执行器（LINT-004~008）
 *
 * 这个 CLI 跑在**低权限**执行面上（无业务密钥、无写权限），扫描 PR head。它的安全职责不是「防住恶意
 * 代码执行」——PR 自带的 lint 配置本来就会被执行，那是该执行面存在的前提——
 * 而是保证：
 *
 *   1. 只从可信路径执行，不从被扫描仓库解析入口/插件/依赖
 *   2. base/head 只认事件里不可伪造的 40 位 SHA，不认分支名
 *   3. 无论如何都产出结构合法的报告并成功退出，不把审查带崩
 *
 * 恶意 PR 场景放在最后一组：改 CLI 源码、改 dist、改 package scripts、改 lint
 * 配置、改 workflow，验证实际执行的仍是默认分支 bundle 且拿不到凭据。
 */
import {describe, expect, test} from '@jest/globals'
import * as fs from 'fs'
import * as path from 'path'
import {isFullSha, parseArgs, splitDiffByFile} from '../src/lint-report-cli'

const ROOT = path.resolve(__dirname, '..')

const FULL_SHA = '6e84aadc2d3a2de682bd5f70f0a2b4f54a17051d'
const OTHER_SHA = '6da31cedc6edd8f71478fb5b3cf0bdf081e058cb'

describe('LINT-006: base/head 只接受不可伪造的完整 SHA', () => {
  test.each([FULL_SHA, OTHER_SHA])('%s 被接受', sha => {
    expect(isFullSha(sha)).toBe(true)
  })

  test.each([
    ['分支名', 'main'],
    ['带斜杠的分支名', 'feature/x'],
    ['短 SHA', '6e84aad'],
    ['大写 SHA', FULL_SHA.toUpperCase()],
    ['41 位', `${FULL_SHA}a`],
    ['含非十六进制字符', `${FULL_SHA.slice(0, 39)}z`],
    ['ref 表达式', 'HEAD~1'],
    ['空字符串', '']
  ])('%s 被拒绝', (_label, value) => {
    expect(isFullSha(value)).toBe(false)
  })

  test('parseArgs 对分支名直接报错，不进入扫描', () => {
    const {args, error} = parseArgs([
      '--repo-root',
      'pr',
      '--base-sha',
      'main',
      '--head-sha',
      'feature/x',
      '--out',
      'r.json'
    ])
    expect(args).toBeNull()
    expect(error).toContain('not refs')
  })

  test('参数齐全且为完整 SHA 时解析成功', () => {
    const {args} = parseArgs([
      '--repo-root',
      'pr',
      '--base-sha',
      FULL_SHA,
      '--head-sha',
      OTHER_SHA,
      '--out',
      'r.json'
    ])
    expect(args).toEqual({
      repoRoot: 'pr',
      baseSha: FULL_SHA,
      headSha: OTHER_SHA,
      out: 'r.json',
      tools: undefined
    })
  })

  test.each([
    ['缺 repo-root', ['--base-sha', FULL_SHA, '--head-sha', OTHER_SHA, '--out', 'r.json']],
    ['缺 out', ['--repo-root', 'pr', '--base-sha', FULL_SHA, '--head-sha', OTHER_SHA]],
    ['位置参数混入', ['positional', '--repo-root', 'pr']]
  ])('%s → 拒绝', (_label, argv) => {
    expect(parseArgs(argv).args).toBeNull()
  })
})

describe('LINT-004: diff 切分', () => {
  const diff = [
    'diff --git a/src/a.ts b/src/a.ts',
    'index 111..222 100644',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1,2 +1,3 @@',
    ' const a = 1',
    '+const added = 2',
    'diff --git a/src/gone.ts b/src/gone.ts',
    'deleted file mode 100644',
    '--- a/src/gone.ts',
    '+++ /dev/null',
    '@@ -1,2 +0,0 @@',
    '-const gone = 1',
    'diff --git a/docs/b.md b/docs/b.md',
    '--- a/docs/b.md',
    '+++ b/docs/b.md',
    '@@ -3,1 +3,2 @@',
    '+line'
  ].join('\n')

  test('按文件切分，保留 hunk 内容', () => {
    const files = splitDiffByFile(diff)
    expect(files.map(([f]) => f)).toEqual(['src/a.ts', 'docs/b.md'])
    expect(files[0][1].startsWith('@@')).toBe(true)
    expect(files[0][1]).toContain('+const added = 2')
  })

  test('删除的文件不参与 lint（+++ /dev/null）', () => {
    expect(splitDiffByFile(diff).map(([f]) => f)).not.toContain('src/gone.ts')
  })

  test('空 diff → 空列表', () => {
    expect(splitDiffByFile('')).toEqual([])
  })

  test('只有 header 没有 hunk 的条目被跳过（如纯 mode 变更）', () => {
    const modeOnly = [
      'diff --git a/x.sh b/x.sh',
      'old mode 100644',
      'new mode 100755',
      '--- a/x.sh',
      '+++ b/x.sh'
    ].join('\n')
    expect(splitDiffByFile(modeOnly)).toEqual([])
  })
})

describe('LINT-005: 新 bundle 纳入打包与产物追溯', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))

  test('package:lint-report 存在，且写 SOURCE_SHA、过 license 检查', () => {
    const script = pkg.scripts['package:lint-report'] as string
    expect(script).toContain('lib/lint-report-entry.js')
    expect(script).toContain('dist/lint-report')
    expect(script).toContain('SOURCE_SHA')
    expect(script).toContain('check-bundle-licenses.js')
  })

  test('npm run package 连带产出第三个 bundle', () => {
    expect(pkg.scripts.package).toContain('package:lint-report')
  })

  test('smoke 覆盖 lint-only bundle 的启动与参数校验', () => {
    const smoke = fs.readFileSync(path.join(ROOT, 'scripts/smoke-test.sh'), 'utf8')
    expect(smoke).toContain('dist/lint-report/index.js')
    expect(smoke).toContain('must be full 40-char commit SHAs, not refs')
  })

  test('产物齐备：index.js / SOURCE_SHA / licenses.txt', () => {
    for (const f of ['index.js', 'SOURCE_SHA', 'licenses.txt']) {
      expect(fs.existsSync(path.join(ROOT, 'dist/lint-report', f))).toBe(true)
    }
  })
})

describe('LINT-007/008: 恶意 PR 无法改变实际执行的代码', () => {
  const workflow = fs.readFileSync(path.join(ROOT, '.github/workflows/openai-review.yml'), 'utf8')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const yaml = require('js-yaml')
  const lintJob = yaml.load(workflow).jobs.lint
  const steps = lintJob.steps as any[]

  const trustedCheckout = steps.find(
    s => String(s.uses ?? '').startsWith('actions/checkout') && s.with?.repository == null
  )
  const prCheckout = steps.find(s => s.with?.repository != null)
  const runStep = steps.find(s => typeof s.run === 'string' && s.run.includes('dist/lint-report'))

  test('可信 checkout 取默认分支——改 PR 里的 CLI 源码或 dist 都不会被执行', () => {
    expect(trustedCheckout.with.ref).toBe('${{ github.event.repository.default_branch }}')
    expect(trustedCheckout.with.path).toBeUndefined() // 落在工作区根
  })

  test('PR head 被隔离到 pr/ 子目录，只作为扫描对象', () => {
    expect(prCheckout.with.path).toBe('pr')
    // ref 来自 resolve-pr 经 API 查出的 head SHA，而不是 PR 可控的分支名
    expect(String(prCheckout.with.ref)).toContain('needs.resolve-pr.outputs.head_sha')
  })

  test('执行的是可信路径下的 bundle，扫描目标才是 pr/', () => {
    expect(runStep.run).toContain('node dist/lint-report/index.js')
    expect(runStep.run).toContain('--repo-root pr')
    // 绝不能变成 node pr/dist/... 或 cd pr && node ...
    expect(runStep.run).not.toMatch(/node\s+pr\//)
    expect(runStep.run).not.toMatch(/cd\s+pr/)
    expect(runStep['working-directory']).toBeUndefined()
  })

  test('不跑 PR 的 npm install / 生命周期脚本 / package scripts', () => {
    const allRuns = steps
      .filter(s => typeof s.run === 'string')
      .map(s => s.run)
      .join('\n')
    for (const forbidden of ['npm install', 'npm ci', 'npm run', 'yarn', 'pnpm']) {
      expect(allRuns).not.toContain(forbidden)
    }
  })

  test('两个 checkout 都不保留凭据（低权限 ≠ 没有 token）', () => {
    const checkouts = steps.filter(s => String(s.uses ?? '').startsWith('actions/checkout'))
    expect(checkouts).toHaveLength(2)
    for (const c of checkouts) {
      expect(c.with['persist-credentials']).toBe(false)
    }
  })

  test('lint job 不引用 PR 可控的分支名，只用解析出的 SHA', () => {
    const serialized = JSON.stringify(lintJob)
    expect(serialized).not.toContain('head_ref')
    expect(serialized).not.toContain('pull_request.head.ref')
  })

  // 真实的不变式不是「lint job 零凭据」——actions/checkout 的 token 默认就是
  // ${{ github.token }}，两个 checkout 一直在用它拉代码，私有仓库更是非用不可。
  // 能保证、也真正重要的是下面三条。
  test('执行 PR 代码的那一步不带任何凭据', () => {
    const lintStep = steps.find(s => String(s.run ?? '').includes('dist/lint-report/index.js'))
    const env = Object.values(lintStep.env ?? {}).join(' ')
    expect(env).not.toContain('secrets.')
    expect(env).not.toContain('github.token')
  })

  test('凭据只出现在执行 PR 代码之前的步骤里', () => {
    const lintIndex = steps.findIndex(s =>
      String(s.run ?? '').includes('dist/lint-report/index.js')
    )
    expect(lintIndex).toBeGreaterThan(-1)

    steps.forEach((step, i) => {
      const carries = JSON.stringify(step.env ?? {}).includes('secrets.')
      if (carries) expect(i).toBeLessThan(lintIndex)
    })
  })

  test('凭据不落到工作区：checkout 不持久化，fetch 用 -c 内联传头', () => {
    for (const c of steps.filter(s => String(s.uses ?? '').startsWith('actions/checkout'))) {
      expect(c.with['persist-credentials']).toBe(false)
    }
    const fetchStep = steps.find(s => String(s.run ?? '').includes('http.extraheader'))
    expect(fetchStep).toBeDefined()
    // -c 是一次性配置，不写进 .git/config；用 git config 设置就会留在工作区
    expect(fetchStep.run).toContain('git -c http.extraheader=')
    expect(fetchStep.run).not.toMatch(/git config .*extraheader/)
  })

  test('lint job 只申请只读权限', () => {
    expect(lintJob.permissions).toEqual({contents: 'read'})
  })

  test('不回显认证头，避免 base64 token 进日志', () => {
    const fetchStep = steps.find(s => String(s.run ?? '').includes('http.extraheader'))
    // 注释里会写「不用 set -x」，剥掉注释再断言，否则自己命中自己
    const code = String(fetchStep.run)
      .split('\n')
      .filter(line => !line.trim().startsWith('#'))
      .join('\n')
    expect(code).not.toMatch(/set -x/)
    expect(code).not.toMatch(/echo .*\$AUTH/)
  })

  test('只在 GitHub 托管的临时 runner 上运行（禁止 self-hosted）', () => {
    expect(lintJob['runs-on']).toBe('ubuntu-latest')
    expect(String(lintJob['runs-on'])).not.toContain('self-hosted')
  })

  test('产物仍是单一 JSON，改 workflow 也改不到可信侧', () => {
    const upload = steps.find(s => String(s.uses ?? '').startsWith('actions/upload-artifact'))
    expect(upload.with.path).toBe('lint-report.json')
  })

  test('CLI 不从被扫描仓库解析任何模块（源码层面）', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/lint-report-cli.ts'), 'utf8')
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    // 不得出现基于 repoRoot 的动态 require/import
    expect(code).not.toMatch(/require\s*\(\s*[^'"]*repoRoot/)
    expect(code).not.toMatch(/import\s*\(\s*[^'"]*repoRoot/)
  })
})

/**
 * 文案漂移门禁。
 *
 * LINT-009 给 base fetch 补了只读 token 之后，注释和文档里仍留着「绝不持有任何
 * 密钥 / job 全程无密钥」的旧说法——行为改了、描述没改，等于把一个已经不成立的
 * 安全承诺留在最容易被当成事实引用的地方。这条锁住准确的不变式。
 */
describe('不得再声称 lint job「无密钥」（LINT-009 后已不成立）', () => {
  const STALE = ['绝不持有任何密钥', '全程无密钥', '没有任何密钥', '零密钥']

  // 只扫非测试文件：本文件本身必然包含这些字面量
  const targets = [
    '.github/workflows/openai-review.yml',
    '.github/scripts/run-lint-report.sh',
    'docs/github-gitlab-compatibility-todo.md',
    'src/lint-report-cli.ts',
    'src/lint/report-schema.ts',
    'src/review.ts',
    'src/options.ts'
  ]

  // 同义改写同样要挡：上一轮只查字面量，漏掉了 workflow 里的
  // 「lint job 不允许有 token」「碰代码的没 token」
  const STALE_PATTERNS = [
    /lint\s*job[^\n]{0,24}(不允许有|不得有|不能有|没有|无)\s*token/i,
    /碰代码的没\s*token/
    // 不再加更宽的正则：先前写过一条 /(job|执行面).{0,12}(无|没有任何)(密钥|token)/，
    // 它反而误伤了 workflow 里那句正确的「不是『没有任何 token』」。
  ]

  test.each(targets)('%s 不含过时的「无密钥」表述', rel => {
    const text = fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8')
    expect(STALE.filter(phrase => text.includes(phrase))).toEqual([])
    expect(STALE_PATTERNS.filter(re => re.test(text)).map(String)).toEqual([])
  })

  test('workflow 里写明了准确的不变式（不是空口不提）', () => {
    const wf = fs.readFileSync(
      path.resolve(__dirname, '../.github/workflows/openai-review.yml'),
      'utf8'
    )
    expect(wf).toContain('不持有业务密钥')
    expect(wf).toContain('执行 PR 代码的步骤')
  })
})
