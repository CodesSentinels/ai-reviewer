/**
 * config-chain.test.ts — 配置链路与 Action input 声明扫描（§14.4 TEST-036/037）
 *
 * 这两条守的是**配置的完整链路**，不是某个函数的行为：
 *
 *   action.yml 声明  →  GitHubConfigProvider 读取  →  Options 规范化值
 *                                                   →  lint orchestrator
 *                                                   →  Semgrep adapter
 *
 * 链路上任一环断了，症状都是「配置写了但不生效」，而且**不会报错**——用户改了
 * `semgrep_config` 却发现规则集没变，或者代码读了一个 `action.yml` 里根本没声明
 * 的 input（永远拿到空串走默认值）。这类问题跑再多功能测试也看不出来，只能靠
 * 静态扫描 + 端到端取值比对。
 *
 * TEST-037 的扫描是反向的：**从生产代码出发**列出所有 input 读取点，逐个回查
 * `action.yml` 是否声明。正向（遍历 action.yml 检查有没有被用到）抓不到「读了
 * 未声明的 input」这类漏洞，而那才是会静默失效的方向。
 */
import {describe, expect, test, beforeEach, afterEach} from '@jest/globals'
import {readFileSync, readdirSync, statSync} from 'fs'
import {join} from 'path'
import * as ts from 'typescript'

import {CONFIG_DEFAULTS} from '../src/platform/config-provider'

const REPO_ROOT = join(__dirname, '..')

// ═══════════════════ action.yml 声明表 ═══════════════════════════════════════

// eslint-disable-next-line @typescript-eslint/no-var-requires
const yaml = require('js-yaml')
const actionYml = yaml.load(readFileSync(join(REPO_ROOT, 'action.yml'), 'utf8')) as any
const DECLARED_INPUTS = new Set(Object.keys(actionYml.inputs ?? {}))

// ═══════════════════ TEST-037：扫描生产代码的 input 读取点 ═══════════════════

/** 递归收集 src/ 下的 .ts 文件 */
function collectSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) collectSources(full, out)
    else if (entry.endsWith('.ts')) out.push(full)
  }
  return out
}

const SOURCES = collectSources(join(REPO_ROOT, 'src'))

/**
 * 用 TypeScript AST 扫描 input 读取点。
 *
 * 第一版用正则，只认单引号裸调用 `getInput('x')`。下面这些全都绕得过去：
 *
 *   getInput("undeclared")            双引号
 *   core.getInput('undeclared')       namespace import
 *   import {getInput as gi} …; gi(x)  别名
 *   const read = getInput; read(x)    赋值给变量
 *
 * 也就是说共享核心里新增一句 `getInput("max_files")`，「只有
 * GitHubConfigProvider 读 input」照样绿。改用 AST 后：
 *
 *   1. 先从 import 声明里解析出本文件里 `@actions/core` input API 的**所有**
 *      本地名字（具名、别名、namespace）；
 *   2. 再按这些名字匹配调用表达式，取字面量参数（引号形式由 AST 归一）。
 *
 * 另外加一道更硬的约束：除 GitHubConfigProvider 外，任何文件**导入** input API
 * 就算越界——不必等它真的调用。导入了却不用是没有意义的，而「导入检查」比
 * 「调用检查」更难绕过（间接调用、动态派发都逃不掉 import 这一关）。
 */
const INPUT_APIS = new Set(['getInput', 'getBooleanInput', 'getMultilineInput'])

interface FileScan {
  file: string
  /** 本文件里 input API 的本地名字（含别名） */
  localNames: Set<string>
  /** `import * as core` 的本地名字 */
  namespaces: Set<string>
  /** 读到的 input 名 */
  inputs: string[]
  /** 本文件里出现的 `require('@actions/core')` 次数 */
  coreRequires: number
}

/** 判断某个表达式是不是 `require('@actions/core')` 调用 */
function isCoreRequire(node: ts.Node): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'require' &&
    node.arguments.length > 0 &&
    ts.isStringLiteralLike(node.arguments[0]) &&
    (node.arguments[0] as ts.StringLiteralLike).text === '@actions/core'
  )
}

function scanFile(file: string): FileScan {
  const rel = file.slice(REPO_ROOT.length + 1)
  const code = readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true)

  const scan: FileScan = {
    file: rel,
    localNames: new Set(),
    namespaces: new Set(),
    inputs: [],
    coreRequires: 0
  }

  // 先数一遍 require('@actions/core')——不管它被怎么用
  const countRequires = (node: ts.Node): void => {
    if (isCoreRequire(node)) scan.coreRequires++
    ts.forEachChild(node, countRequires)
  }
  countRequires(sf)

  // ── ① 解析 import ──
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) continue
    if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue
    if (stmt.moduleSpecifier.text !== '@actions/core') continue
    const bindings = stmt.importClause?.namedBindings
    if (bindings == null) continue
    if (ts.isNamespaceImport(bindings)) {
      scan.namespaces.add(bindings.name.text)
    } else if (ts.isNamedImports(bindings)) {
      for (const el of bindings.elements) {
        const imported = (el.propertyName ?? el.name).text
        if (INPUT_APIS.has(imported)) scan.localNames.add(el.name.text)
      }
    }
  }

  // ── ①' CommonJS：const core = require('@actions/core') ──
  const walkRequires = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer != null &&
      isCoreRequire(node.initializer)
    ) {
      if (ts.isIdentifier(node.name)) {
        // const core = require('@actions/core')
        scan.namespaces.add(node.name.text)
      } else if (ts.isObjectBindingPattern(node.name)) {
        // const {getInput: read} = require('@actions/core')
        for (const el of node.name.elements) {
          const imported = (el.propertyName ?? el.name) as ts.Node
          if (
            ts.isIdentifier(imported) &&
            INPUT_APIS.has(imported.text) &&
            ts.isIdentifier(el.name)
          ) {
            scan.localNames.add(el.name.text)
          }
        }
      }
    }
    ts.forEachChild(node, walkRequires)
  }
  walkRequires(sf)

  // ── ② 别名赋值 ──
  //
  // 三种写法都要追：
  //   const read = getInput                       标识符赋值
  //   const read = core.getInput                  namespace 属性赋值
  //   const {getInput: read} = core               从 namespace 解构
  //
  // 第一版只追第一种，后两种既进不了 localNames 也不产生调用记录，而 namespace
  // import 本身又是允许的（actions-log.ts 用它取 info/warning），于是两道越界
  // 检查同时失效。
  //
  // 反复扫描直到不再新增，处理 `const a = getInput; const b = a` 这种链式别名。
  const walkAliases = (node: ts.Node): boolean => {
    let added = false
    if (ts.isVariableDeclaration(node) && node.initializer != null) {
      const init = node.initializer
      const fromIdentifier = ts.isIdentifier(init) && scan.localNames.has(init.text)
      const fromNamespace =
        ts.isPropertyAccessExpression(init) &&
        ts.isIdentifier(init.expression) &&
        scan.namespaces.has(init.expression.text) &&
        INPUT_APIS.has(init.name.text)
      // const read = require('@actions/core').getInput
      const fromInlineRequire =
        ts.isPropertyAccessExpression(init) &&
        isCoreRequire(init.expression) &&
        INPUT_APIS.has(init.name.text)

      if ((fromIdentifier || fromNamespace || fromInlineRequire) && ts.isIdentifier(node.name)) {
        if (!scan.localNames.has(node.name.text)) {
          scan.localNames.add(node.name.text)
          added = true
        }
      }

      // const {getInput: read} = core
      if (
        ts.isObjectBindingPattern(node.name) &&
        ts.isIdentifier(init) &&
        scan.namespaces.has(init.text)
      ) {
        for (const el of node.name.elements) {
          const imported = (el.propertyName ?? el.name) as ts.Node
          if (
            ts.isIdentifier(imported) &&
            INPUT_APIS.has(imported.text) &&
            ts.isIdentifier(el.name) &&
            !scan.localNames.has(el.name.text)
          ) {
            scan.localNames.add(el.name.text)
            added = true
          }
        }
      }
    }
    let childAdded = false
    ts.forEachChild(node, child => {
      if (walkAliases(child)) childAdded = true
    })
    return added || childAdded
  }
  // 链式别名可能需要多轮才能收敛
  for (let i = 0; i < 5 && walkAliases(sf); i++) {
    /* 收敛为止 */
  }

  // ── ③ 收集调用参数 ──
  const isInputCall = (expr: ts.Expression): boolean => {
    if (ts.isIdentifier(expr)) return scan.localNames.has(expr.text)
    if (ts.isPropertyAccessExpression(expr)) {
      if (!INPUT_APIS.has(expr.name.text)) return false
      // ns.getInput(...) 或 require('@actions/core').getInput(...)
      return (
        (ts.isIdentifier(expr.expression) && scan.namespaces.has(expr.expression.text)) ||
        isCoreRequire(expr.expression)
      )
    }
    return false
  }

  const walkCalls = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isInputCall(node.expression)) {
      const arg = node.arguments[0]
      if (arg != null && ts.isStringLiteralLike(arg)) scan.inputs.push(arg.text)
      else scan.inputs.push(DYNAMIC_INPUT)
    }
    ts.forEachChild(node, walkCalls)
  }
  walkCalls(sf)

  return scan
}

/** 参数不是字面量时的占位符——单独有一条用例盯着它 */
const DYNAMIC_INPUT = '<dynamic>'

const FILE_SCANS = SOURCES.map(scanFile)

/**
 * 版本表：`['<tool>', '<tool>_version']` 这样的成对字面量。
 *
 * 工具版本是表驱动读取的（`.map(([, n]) => getInput(n))`），参数不是字面量，
 * 上面的 AST 扫描只能给出 `<dynamic>`。这里把表里的名字单独取出来，
 * 否则五个 `*_version` 会被判成「声明了却没人读」的死配置。
 */
function scanVersionTable(): string[] {
  const names: string[] = []
  for (const file of SOURCES) {
    const code = readFileSync(file, 'utf8')
    for (const m of code.matchAll(/\[\s*'([a-z]+)'\s*,\s*'([a-z_]+_version)'\s*\]/g)) {
      names.push(m[2])
    }
  }
  return names
}

const READ_INPUT_NAMES = new Set([
  ...FILE_SCANS.flatMap(s => s.inputs).filter(n => n !== DYNAMIC_INPUT),
  ...scanVersionTable()
])

describe('TEST-037：所有 Action input 读取点都必须已声明且经过 ConfigProvider', () => {
  const PROVIDER = 'src/platform/github-config-provider.ts'

  test('扫描确实扫到了东西（否则下面全是空转）', () => {
    expect(READ_INPUT_NAMES.size).toBeGreaterThan(20)
    expect(FILE_SCANS.some(s => s.localNames.size > 0)).toBe(true)
  })

  test('每个被读取的 input 都在 action.yml 里声明过', () => {
    const undeclared = [...READ_INPUT_NAMES].filter(n => !DECLARED_INPUTS.has(n))

    expect(undeclared).toEqual([])
  })

  /**
   * 共享核心不得接触 Action input（§1 平台无关原则）。查的是**导入**而不是调用：
   * 导入了却不用没有意义，而 import 这一关比调用更难绕过——别名、间接调用、
   * namespace 访问都逃不掉它。
   */
  /**
   * namespace import / require 的白名单。
   *
   * `actions-log.ts` 用 `import * as core` 只是为了 info/warning，那是合法的。
   * 但 namespace 一旦被允许，`const read = core.getInput` 这类间接引用就绕开了
   * 具名导入检查——所以除白名单外，任何文件都不得以 namespace 或 require 方式
   * 引入 @actions/core。
   */
  const NAMESPACE_ALLOWLIST = new Set(['src/actions-log.ts'])

  /**
   * `require('@actions/core')` 一律禁止出现在 provider 与白名单之外——不管它是
   * 赋值、解构，还是内联成 `require('@actions/core').getInput('x')`。
   *
   * 内联形式尤其要挡：它不产生任何变量绑定，靠追踪赋值的扫描完全看不见。
   * 与其把每种用法都识别一遍（还会有下一种写法），不如直接禁掉这个 require。
   */
  test('provider 与白名单之外不得 require @actions/core', () => {
    const offenders = FILE_SCANS.filter(
      s => s.coreRequires > 0 && s.file !== PROVIDER && !NAMESPACE_ALLOWLIST.has(s.file)
    ).map(s => s.file)

    expect(offenders).toEqual([])
  })

  test('除日志模块外，任何文件不得 namespace/require 引入 @actions/core', () => {
    const offenders = FILE_SCANS.filter(
      s => s.namespaces.size > 0 && !NAMESPACE_ALLOWLIST.has(s.file)
    ).map(s => s.file)

    expect(offenders).toEqual([])
  })

  test('白名单文件本身也不得通过 namespace 取用 input API', () => {
    const offenders = FILE_SCANS.filter(
      s => NAMESPACE_ALLOWLIST.has(s.file) && (s.localNames.size > 0 || s.inputs.length > 0)
    ).map(s => s.file)

    expect(offenders).toEqual([])
  })

  test('只有 GitHubConfigProvider 导入 @actions/core 的 input API', () => {
    // namespace import 本身不算越界——actions-log.ts 用 `import * as core` 只是
    // 为了 info/warning。只有具名导入 input API，或通过 namespace 真的调了
    // core.getInput，才算。
    const offenders = FILE_SCANS.filter(
      s => s.file !== PROVIDER && (s.localNames.size > 0 || s.inputs.length > 0)
    ).map(s => s.file)

    expect(offenders).toEqual([])
  })

  test('只有 GitHubConfigProvider 调用 input API', () => {
    const offenders = FILE_SCANS.filter(s => s.file !== PROVIDER && s.inputs.length > 0).map(
      s => s.file
    )

    expect(offenders).toEqual([])
  })

  /**
   * 非字面量参数会让「已声明」检查失效——扫描看不见名字，自然也查不了。
   * 唯一允许的例外是工具版本表：名字仍以字面量形式写在同一文件里，
   * 由 scanVersionTable() 单独取出。
   */
  test('非字面量参数只允许出现在 ConfigProvider 里', () => {
    const offenders = FILE_SCANS.filter(s => s.inputs.includes(DYNAMIC_INPUT)).map(s => s.file)

    expect(offenders).toEqual([PROVIDER])
  })

  /**
   * 唯一的非字面量读取是工具版本表。它的名字仍以字面量成对写在同一文件里，
   * 由 scanVersionTable() 取出——五个工具必须齐全，否则漏掉的那个会被判成死配置，
   * 或者更糟：读了一个没声明的名字而扫描看不见。
   */
  test('版本表覆盖全部五个工具', () => {
    expect(scanVersionTable().sort()).toEqual([
      'biome_version',
      'eslint_version',
      'prettier_version',
      'semgrep_version',
      'tsc_version'
    ])
  })

  /**
   * 反向守卫：`action.yml` 声明了但代码从不读的 input 是**死配置**——用户照着
   * README 配了却毫无效果。密钥类除外，它们由认证层直接读环境变量（ARCH-011）。
   */
  test('action.yml 里没有死配置（声明了却没人读）', () => {
    const secretLike = new Set(['openai-api-key', 'github-token', 'resolve_token'])
    const dead = [...DECLARED_INPUTS].filter(n => !READ_INPUT_NAMES.has(n) && !secretLike.has(n))

    expect(dead).toEqual([])
  })
})

// ═══════════════════ TEST-036：配置链路 ═════════════════════════════════════

/** action.yml 的 input 名 → GitHub Actions 注入的环境变量名 */
function inputEnv(name: string): string {
  return `INPUT_${name.replace(/ /g, '_').toUpperCase()}`
}

/** 完整公开配置矩阵：同一语义在两平台各自的键与取值 */
interface MatrixEntry {
  /** Options 上的字段名 */
  field: string
  input: string
  gitlabEnv: string
  value: string
  expected: unknown
  /** 从 Options 取值；默认按 field 直接取 */
  read?: (o: any) => unknown
}

const CONFIG_MATRIX: MatrixEntry[] = [
  {field: 'debug', input: 'debug', gitlabEnv: 'AI_REVIEWER_DEBUG', value: 'true', expected: true},
  {
    field: 'disableReview',
    input: 'disable_review',
    gitlabEnv: 'AI_REVIEWER_DISABLE_REVIEW',
    value: 'true',
    expected: true
  },
  {
    field: 'disableReleaseNotes',
    input: 'disable_release_notes',
    gitlabEnv: 'AI_REVIEWER_DISABLE_RELEASE_NOTES',
    value: 'true',
    expected: true
  },
  {
    field: 'maxFiles',
    input: 'max_files',
    gitlabEnv: 'AI_REVIEWER_MAX_FILES',
    value: '77',
    expected: 77
  },
  {
    field: 'reviewSimpleChanges',
    input: 'review_simple_changes',
    gitlabEnv: 'AI_REVIEWER_REVIEW_SIMPLE_CHANGES',
    value: 'true',
    expected: true
  },
  {
    field: 'reviewCommentLGTM',
    input: 'review_comment_lgtm',
    gitlabEnv: 'AI_REVIEWER_REVIEW_COMMENT_LGTM',
    value: 'true',
    expected: true
  },
  {
    field: 'pathFilters',
    input: 'path_filters',
    gitlabEnv: 'AI_REVIEWER_PATH_FILTERS',
    value: '!dist/**',
    // PathFilter 是对象，比较它对同一路径的判定结果
    read: o => o.checkPath('dist/index.js'),
    expected: false
  },
  {
    field: 'systemMessage',
    input: 'system_message',
    gitlabEnv: 'AI_REVIEWER_SYSTEM_MESSAGE',
    value: '自定义系统消息',
    expected: '自定义系统消息'
  },
  {
    field: 'openaiLightModel',
    input: 'openai_light_model',
    gitlabEnv: 'AI_REVIEWER_OPENAI_LIGHT_MODEL',
    value: 'custom-light',
    expected: 'custom-light'
  },
  {
    field: 'openaiHeavyModel',
    input: 'openai_heavy_model',
    gitlabEnv: 'AI_REVIEWER_OPENAI_HEAVY_MODEL',
    value: 'custom-heavy',
    expected: 'custom-heavy'
  },
  {
    field: 'openaiModelTemperature',
    input: 'openai_model_temperature',
    gitlabEnv: 'AI_REVIEWER_OPENAI_MODEL_TEMPERATURE',
    value: '0.7',
    expected: 0.7
  },
  {
    field: 'openaiRetries',
    input: 'openai_retries',
    gitlabEnv: 'AI_REVIEWER_OPENAI_RETRIES',
    value: '7',
    expected: 7
  },
  {
    field: 'openaiTimeoutMS',
    input: 'openai_timeout_ms',
    gitlabEnv: 'AI_REVIEWER_OPENAI_TIMEOUT_MS',
    value: '12345',
    expected: 12345
  },
  {
    field: 'openaiConcurrencyLimit',
    input: 'openai_concurrency_limit',
    gitlabEnv: 'AI_REVIEWER_OPENAI_CONCURRENCY_LIMIT',
    value: '9',
    expected: 9
  },
  {
    field: 'githubConcurrencyLimit',
    input: 'github_concurrency_limit',
    gitlabEnv: 'AI_REVIEWER_GITHUB_CONCURRENCY_LIMIT',
    value: '6',
    expected: 6
  },
  {
    field: 'apiBaseUrl',
    input: 'openai_base_url',
    gitlabEnv: 'AI_REVIEWER_OPENAI_BASE_URL',
    value: 'https://proxy.example.com/v1',
    expected: 'https://proxy.example.com/v1'
  },
  {
    field: 'language',
    input: 'language',
    gitlabEnv: 'AI_REVIEWER_LANGUAGE',
    value: 'en-US',
    expected: 'en-US'
  },
  {
    field: 'enableDependencyAnalysis',
    input: 'enable_dependency_analysis',
    gitlabEnv: 'AI_REVIEWER_ENABLE_DEPENDENCY_ANALYSIS',
    value: 'false',
    expected: false
  },
  {
    field: 'maxDependencyFiles',
    input: 'max_dependency_files',
    gitlabEnv: 'AI_REVIEWER_MAX_DEPENDENCY_FILES',
    value: '25',
    expected: 25
  },
  {
    field: 'enableWebSearch',
    input: 'enable_web_search',
    gitlabEnv: 'AI_REVIEWER_ENABLE_WEB_SEARCH',
    value: 'false',
    expected: false
  },
  {
    field: 'semgrepConfig',
    input: 'semgrep_config',
    gitlabEnv: 'AI_REVIEWER_SEMGREP_CONFIG',
    value: 'p/security-audit',
    expected: 'p/security-audit'
  },
  {
    field: 'commandAckReaction',
    input: 'command_ack_reaction',
    gitlabEnv: 'AI_REVIEWER_COMMAND_ACK_REACTION',
    value: 'eyes',
    expected: 'eyes'
  },
  {
    field: 'maxReviewComments',
    input: 'max_review_comments',
    gitlabEnv: 'AI_REVIEWER_MAX_REVIEW_COMMENTS',
    value: '5',
    expected: 5
  },
  {
    field: 'debugResolveInjectFailures',
    input: 'debug_resolve_inject_failures',
    gitlabEnv: 'AI_REVIEWER_DEBUG_RESOLVE_INJECT_FAILURES',
    value: '2',
    expected: 2
  },
  {
    field: 'botIcon',
    input: 'bot_icon',
    gitlabEnv: 'AI_REVIEWER_BOT_ICON',
    value: '🦊',
    expected: '🦊'
  },
  {
    field: 'botName',
    input: 'bot_name',
    gitlabEnv: 'AI_REVIEWER_BOT_NAME',
    value: 'MyReviewer',
    expected: 'MyReviewer'
  }
]

/**
 * 有意**不**等价的字段，逐个写明理由。
 *
 * 这份清单和上面的矩阵合起来必须覆盖 Options 的全部字段——下方有完整性守卫。
 * 没有它，新增一个配置却忘了接 GitLab 侧映射，测试不会有任何反应。
 */
const INTENTIONALLY_DIVERGENT: Record<string, string> = {
  enableShell: 'CFG-002：GitLab secret-bearing trigger 强制关闭（LOCAL-001）',
  enableLintTools: 'CFG-002：GitLab secret-bearing trigger 强制关闭（LOCAL-002）',
  toolEnableOverrides: 'GitLab 侧随 enable_lint_tools 一并强制为 false（LOCAL-002）',
  botLogin: '平台专有身份：GitHub App 名 vs GitLab PAT 用户名，语义上就不该相同',
  lintReportPath: 'SEC-002：只在 GitHub 低权限 lint job 链路上有值',
  lightTokenLimits: '由模型名推导，不是独立配置项',
  heavyTokenLimits: '同上'
}

/**
 * **等价，但不能用 toEqual 直接比**的字段，各有专门用例。
 *
 * 与上面那组分开：它们同样要求两平台一致，只是对象形态决定了比较方式不同。
 * 混在 INTENTIONALLY_DIVERGENT 里会让测试输出和注释都说反话——读到的人会以为
 * 这两项本来就允许发散。
 */
const SPECIALLY_COMPARED: Record<string, string> = {
  toolVersionOverrides: '对象形态：设相同覆盖后逐 key 比较完整 map',
  pathFilters: '对象形态：通过 checkPath 对同一路径的判定结果比较（已在矩阵里）'
}

const savedEnv: Record<string, string | undefined> = {}

function setEnv(name: string, value: string | undefined): void {
  if (!(name in savedEnv)) savedEnv[name] = process.env[name]
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

/** 构造一份 GitHub Options：先把全部声明过的 input 填成 action.yml 的默认值 */
function githubOptions(overrides: Record<string, string> = {}): any {
  for (const [name, spec] of Object.entries(actionYml.inputs ?? {})) {
    const def = (spec as any).default
    setEnv(inputEnv(name), def == null ? '' : String(def))
  }
  for (const [name, value] of Object.entries(overrides)) setEnv(inputEnv(name), value)

  // provider 内部有缓存，必须每次新建实例
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const {GitHubConfigProvider} = require('../src/platform/github-config-provider')
  return new GitHubConfigProvider().getOptions()
}

function gitlabOptions(overrides: Record<string, string> = {}): any {
  // 清掉所有 AI_REVIEWER_*，否则上一条用例的覆盖会漏进来
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('AI_REVIEWER_')) setEnv(key, undefined)
  }
  for (const item of CONFIG_MATRIX) setEnv(item.gitlabEnv, undefined)
  for (const [name, value] of Object.entries(overrides)) setEnv(name, value)

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const {GitLabConfigProvider} = require('../src/platform/gitlab-config-provider')
  return new GitLabConfigProvider().getOptions()
}

beforeEach(() => {
  setEnv('GITHUB_REPOSITORY', 'octo/demo')
})

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  for (const k of Object.keys(savedEnv)) delete savedEnv[k]
})

describe('TEST-036：action.yml 必须声明代码实际读取的 lint 配置', () => {
  test.each(['semgrep_version', 'semgrep_config'])('%s 已声明', name => {
    expect(DECLARED_INPUTS.has(name)).toBe(true)
  })

  test.each(['eslint', 'biome', 'tsc', 'prettier', 'semgrep'])(
    '%s 的 enable_ 与 _version 两个 input 都已声明',
    tool => {
      expect(DECLARED_INPUTS.has(`enable_${tool}`)).toBe(true)
      expect(DECLARED_INPUTS.has(`${tool}_version`)).toBe(true)
    }
  )
})

describe('TEST-036：两平台公开配置产生相同的规范化值', () => {
  test.each(CONFIG_MATRIX.map(m => [m.input, m]))('%s', (_name, spec: any) => {
    const read = spec.read ?? ((o: any) => o[spec.field])
    const gh = githubOptions({[spec.input]: spec.value})
    const gl = gitlabOptions({[spec.gitlabEnv]: spec.value})

    expect(read(gh)).toEqual(spec.expected)
    expect(read(gl)).toEqual(spec.expected)
  })

  /**
   * 完整性守卫：Options 的每个字段要么在等价矩阵里，要么在「有意不等价」清单里。
   *
   * 少了它，「完整公开配置矩阵」就只是一句话——新增配置忘了接 GitLab 映射，
   * 或者矩阵漏了某个字段，测试都不会有任何反应。第一版矩阵只有 7 个字段，
   * 却按「完整」勾了完成。
   */
  test('矩阵 + 两份清单覆盖 Options 的全部字段', () => {
    const covered = new Set([
      ...CONFIG_MATRIX.map(m => m.field),
      ...Object.keys(INTENTIONALLY_DIVERGENT),
      ...Object.keys(SPECIALLY_COMPARED)
    ])
    const actual = Object.keys(githubOptions()).filter(k => !k.startsWith('_'))
    const uncovered = actual.filter(k => !covered.has(k))

    expect(uncovered).toEqual([])
  })

  // 两份清单里的每一项都必须真的是 Options 上的字段，
  // 避免写个不存在的名字来「覆盖」完整性检查
  test.each(Object.entries(INTENTIONALLY_DIVERGENT))('有意不等价：%s — %s', field => {
    expect(Object.keys(githubOptions())).toContain(field)
  })

  test.each(Object.entries(SPECIALLY_COMPARED))('等价但需专门比较：%s — %s', field => {
    expect(Object.keys(githubOptions())).toContain(field)
  })

  test('两份清单不重叠', () => {
    const overlap = Object.keys(SPECIALLY_COMPARED).filter(k => k in INTENTIONALLY_DIVERGENT)

    expect(overlap).toEqual([])
  })

  /**
   * 工具版本覆盖在**两个平台都是可配置的**（GitLab 读五个
   * AI_REVIEWER_*_VERSION）。此前把它列进「有意不等价」并写成「GitLab 恒为空」，
   * 与实现直接矛盾——真发散了也看不出来。设相同覆盖，比较完整 map。
   */
  test('toolVersionOverrides：两平台设相同覆盖 → 完整 map 相同', () => {
    const versions = {
      eslint: '^9.1.0',
      biome: '^1.8.0',
      tsc: '^5.5.0',
      prettier: '^3.3.0',
      semgrep: '^1.99.0'
    }
    const gh = githubOptions(
      Object.fromEntries(Object.entries(versions).map(([t, v]) => [`${t}_version`, v]))
    )
    const gl = gitlabOptions(
      Object.fromEntries(
        Object.entries(versions).map(([t, v]) => [`AI_REVIEWER_${t.toUpperCase()}_VERSION`, v])
      )
    )

    expect(gh.toolVersionOverrides).toEqual(versions)
    expect(gl.toolVersionOverrides).toEqual(gh.toolVersionOverrides)
  })

  test('GitLab 强制关闭 shell/lint，且不受公开配置影响', () => {
    const gl = gitlabOptions({
      AI_REVIEWER_ENABLE_SHELL: 'true',
      AI_REVIEWER_ENABLE_LINT_TOOLS: 'true'
    })

    expect(gl.enableShell).toBe(false)
    expect(gl.enableLintTools).toBe(false)
    expect(Object.values(gl.toolEnableOverrides)).toEqual([false, false, false, false, false])
  })

  /**
   * 对照组：不设任何覆盖时，两平台也必须落到**同一个**默认值。
   * 各自维护一套默认值是最容易悄悄发散的地方——GitHub 的默认写在 action.yml，
   * GitLab 的写在 CONFIG_DEFAULTS，改了一边忘了另一边不会有任何报错。
   */
  test('默认值：两平台一致，且等于 CONFIG_DEFAULTS', () => {
    const gh = githubOptions()
    const gl = gitlabOptions()

    expect(gh.language).toBe(gl.language)
    expect(gh.openaiLightModel).toBe(gl.openaiLightModel)
    expect(gh.maxFiles).toBe(gl.maxFiles)
    expect(gh.semgrepConfig).toBe(CONFIG_DEFAULTS.semgrepConfig)
    expect(gl.semgrepConfig).toBe(CONFIG_DEFAULTS.semgrepConfig)
  })
})

/**
 * PromptConfig 与 BotConfig 不在 Options 上，基于 `Object.keys(githubOptions())`
 * 的完整性检查完全看不到它们——summarize / summarize_release_notes 的映射错了，
 * 前面所有用例都不会有反应。各自建一张矩阵，并同样加完整性守卫。
 */
describe('TEST-036：PromptConfig 与 BotConfig 也要逐字段等价', () => {
  function githubPrompt(overrides: Record<string, string> = {}): any {
    for (const [name, spec] of Object.entries(actionYml.inputs ?? {})) {
      const def = (spec as any).default
      setEnv(inputEnv(name), def == null ? '' : String(def))
    }
    for (const [name, value] of Object.entries(overrides)) setEnv(inputEnv(name), value)
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const {GitHubConfigProvider} = require('../src/platform/github-config-provider')
    const p = new GitHubConfigProvider()
    return {prompt: p.getPromptConfig(), bot: p.getBotConfig()}
  }

  function gitlabPrompt(overrides: Record<string, string> = {}): any {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('AI_REVIEWER_')) setEnv(key, undefined)
    }
    for (const [name, value] of Object.entries(overrides)) setEnv(name, value)
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const {GitLabConfigProvider} = require('../src/platform/gitlab-config-provider')
    const p = new GitLabConfigProvider()
    return {prompt: p.getPromptConfig(), bot: p.getBotConfig()}
  }

  const PROMPT_MATRIX: Array<[string, string, string, string]> = [
    ['summarize', 'summarize', 'AI_REVIEWER_SUMMARIZE', '自定义摘要提示词'],
    [
      'summarizeReleaseNotes',
      'summarize_release_notes',
      'AI_REVIEWER_SUMMARIZE_RELEASE_NOTES',
      '自定义发布说明提示词'
    ]
  ]

  test.each(PROMPT_MATRIX)('PromptConfig.%s 两平台等价', (field, input, env, value) => {
    const gh = githubPrompt({[input]: value})
    const gl = gitlabPrompt({[env]: value})

    expect(gh.prompt[field]).toBe(value)
    expect(gl.prompt[field]).toBe(value)
  })

  test('PromptConfig 默认值两平台一致', () => {
    expect(githubPrompt().prompt).toEqual(gitlabPrompt().prompt)
  })

  test('PromptConfig 的字段全部进了矩阵', () => {
    const covered = new Set(PROMPT_MATRIX.map(([f]) => f))
    const actual = Object.keys(githubPrompt().prompt)

    expect(actual.filter(k => !covered.has(k))).toEqual([])
  })

  const BOT_MATRIX: Array<[string, string, string, string]> = [
    ['icon', 'bot_icon', 'AI_REVIEWER_BOT_ICON', '🦊'],
    ['name', 'bot_name', 'AI_REVIEWER_BOT_NAME', 'MyReviewer']
  ]

  test.each(BOT_MATRIX)('BotConfig.%s 两平台等价', (field, input, env, value) => {
    const gh = githubPrompt({[input]: value})
    const gl = gitlabPrompt({[env]: value})

    expect(gh.bot[field]).toBe(value)
    expect(gl.bot[field]).toBe(value)
  })

  test('BotConfig 默认 icon/name 两平台一致', () => {
    const gh = githubPrompt().bot
    const gl = gitlabPrompt().bot

    expect(gh.icon).toBe(gl.icon)
    expect(gh.name).toBe(gl.name)
  })

  /**
   * platformLogin 是唯一有意不等价的字段：GitHub 读 bot_github_login，
   * GitLab 读 AI_REVIEWER_BOT_GITLAB_LOGIN，指的本来就是两个不同账号。
   */
  test('BotConfig 只有 platformLogin 有意不等价', () => {
    const covered = new Set([...BOT_MATRIX.map(([f]) => f), 'platformLogin'])
    const actual = Object.keys(githubPrompt().bot)

    expect(actual.filter(k => !covered.has(k))).toEqual([])
  })
})

describe('TEST-036：enable_<tool> 与 <tool>_version 的转换', () => {
  test('enable_<tool> → toolEnableOverrides', () => {
    const o = githubOptions({
      enable_lint_tools: 'true',
      enable_eslint: 'true',
      enable_biome: 'false',
      enable_tsc: 'true',
      enable_prettier: 'false',
      enable_semgrep: 'true'
    })

    expect(o.toolEnableOverrides).toEqual({
      eslint: true,
      biome: false,
      tsc: true,
      prettier: false,
      semgrep: true
    })
  })

  test('<tool>_version → toolVersionOverrides', () => {
    const o = githubOptions({eslint_version: '^9.0.0', semgrep_version: '^1.99.0'})

    expect(o.toolVersionOverrides.eslint).toBe('^9.0.0')
    expect(o.toolVersionOverrides.semgrep).toBe('^1.99.0')
  })

  /**
   * 空字符串**不能**进入 toolVersionOverrides。进去了的话，adapter 会拿着空串
   * 去装版本，等于把「用受控默认版本」变成「装一个叫空字符串的版本」。
   */
  test('未填写或空版本不进入 toolVersionOverrides', () => {
    const o = githubOptions({eslint_version: '', biome_version: '   ', tsc_version: ''})

    expect(o.toolVersionOverrides).not.toHaveProperty('eslint')
    expect(o.toolVersionOverrides).not.toHaveProperty('biome')
    expect(o.toolVersionOverrides).not.toHaveProperty('tsc')
  })

  test('空 semgrep_config 回退到 p/default', () => {
    const o = githubOptions({semgrep_config: ''})

    expect(o.semgrepConfig).toBe('p/default')
    expect(o.semgrepConfig).toBe(CONFIG_DEFAULTS.semgrepConfig)
  })

  test('GitLab 侧同样不把空版本塞进 overrides', () => {
    const o = gitlabOptions({AI_REVIEWER_ESLINT_VERSION: '  '})

    expect(o.toolVersionOverrides).not.toHaveProperty('eslint')
  })
})

describe('TEST-036：规范化值确实传到 lint orchestrator 与 Semgrep adapter', () => {
  /**
   * 前面几条只证明 Options 上的字段对。字段对不代表用得上——链路后半段
   * （orchestrator 读 toolVersionOverrides、SemgrepAdapter 读 config）
   * 断了同样是静默失效。
   */
  test('SemgrepAdapter 接收 options.semgrepConfig', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const {SemgrepAdapter} = require('../src/lint/adapters/semgrep')

    expect(new SemgrepAdapter({config: 'p/security-audit'}).config).toBe('p/security-audit')
    // 不传时回落到同一个受控默认
    expect(new SemgrepAdapter().config).toBe(CONFIG_DEFAULTS.semgrepConfig)
  })

  test('orchestrator 把 semgrepConfig 交给 SemgrepAdapter', () => {
    const src = readFileSync(join(REPO_ROOT, 'src/lint/orchestrator.ts'), 'utf8')

    expect(src).toContain('new SemgrepAdapter({config: options.semgrepConfig})')
  })

  test('orchestrator 按工具名取版本覆盖传给 detect', () => {
    const src = readFileSync(join(REPO_ROOT, 'src/lint/orchestrator.ts'), 'utf8')

    expect(src).toContain('options.toolVersionOverrides')
    expect(src).toMatch(/versionOverrides\[a\.name\]/)
  })

  test('review.ts 把 Options 上的版本覆盖传进 orchestrator', () => {
    const src = readFileSync(join(REPO_ROOT, 'src/review.ts'), 'utf8')

    expect(src).toContain('toolVersionOverrides: options.toolVersionOverrides')
  })
})
