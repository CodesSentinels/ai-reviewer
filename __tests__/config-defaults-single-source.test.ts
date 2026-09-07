/**
 * config-defaults-single-source.test.ts — 默认值只有一个受控来源（§16 完成条件）
 *
 * 同一批默认值住在**两个地方**：
 *
 *   action.yml 的 `inputs.<name>.default`  —— GitHub 侧，用户没填时由 Actions 注入
 *   CONFIG_DEFAULTS                        —— 共享兜底，GitLab 没有 action.yml，只能靠它
 *
 * 两处都必须有（GitHub 需要 action.yml 的 default 才能在 UI 上显示、才能让
 * `getInput` 拿到值；GitLab 只有 CONFIG_DEFAULTS），但它们**必须一致**——否则
 * 同一个未配置项在 GitHub 上是一个值、在 GitLab 上是另一个值，而且不会有任何
 * 报错。
 *
 * 既有的跨平台默认值测试（config-provider.test.ts）挡不住这件事：它喂给
 * GitHub 的 input **取自 `CONFIG_DEFAULTS` 本身**，于是只证明了「两边用同一份
 * 常量会得到同样结果」——近乎恒真。`action.yml` 改了而 `CONFIG_DEFAULTS` 没改
 * （或反过来），那条测试照样绿。
 *
 * 本文件是那条缺失的门禁：逐字段比对两个来源。
 */
import {describe, expect, test} from '@jest/globals'
import * as fs from 'fs'
import * as path from 'path'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const yaml = require('js-yaml')

import {CONFIG_DEFAULTS} from '../src/platform/config-provider'

const actionYml = yaml.load(
  fs.readFileSync(path.resolve(__dirname, '../action.yml'), 'utf8')
) as any

/**
 * input 名 → CONFIG_DEFAULTS 字段名。
 *
 * 绝大多数是 snake_case → camelCase 的机械转换，只有少数几个历史命名对不上，
 * 在这里显式列出——用「猜不到就跳过」的写法会让新增字段悄悄脱离门禁。
 */
const NAME_OVERRIDES: Record<string, string> = {
  openai_base_url: 'apiBaseUrl',
  openai_timeout_ms: 'openaiTimeoutMS'
}

/**
 * 有意不进 CONFIG_DEFAULTS 的 input。
 *
 * 这些要么是 GitHub 平台专有、GitLab 侧没有对应概念，要么其默认值由别处治理
 * （`*_version` 见下方单独一组）。列在这里是为了让「两边都有的字段必须一致」
 * 这条规则不被「反正没列全」稀释。
 */
const NOT_IN_SHARED_DEFAULTS = new Set([
  // lint 工具开关与版本：GitLab 侧被 CFG-002 强制关闭，默认值只在 GitHub 侧有意义
  'enable_eslint',
  'enable_biome',
  'enable_tsc',
  'enable_prettier',
  'enable_semgrep',
  'eslint_version',
  'biome_version',
  'tsc_version',
  'prettier_version',
  'lint_report_path',
  // GitHub 专有
  'review_comment_lgtm',
  // bot 身份：GitHub 靠这个 input（默认空串），GitLab 不读它而是用
  // verifyBotIdentity 现查 access token 账号名，因此没有共享默认值可比
  'bot_github_login'
])

function camel(name: string): string {
  return NAME_OVERRIDES[name] ?? name.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase())
}

/** action.yml 里所有声明了 default 的 input */
function declaredDefaults(): Array<[string, string]> {
  const out: Array<[string, string]> = []
  for (const [name, spec] of Object.entries<any>(actionYml.inputs ?? {})) {
    if (spec?.default !== undefined) out.push([name, String(spec.default)])
  }
  return out
}

/** CONFIG_DEFAULTS 里的值统一成字符串，便于与 YAML 的字面量比较 */
function sharedValueAsString(v: unknown): string {
  if (Array.isArray(v)) return v.join('\n')
  return String(v)
}

describe('action.yml 的 default 与 CONFIG_DEFAULTS 必须逐字段一致', () => {
  const pairs = declaredDefaults().filter(([name]) => {
    if (NOT_IN_SHARED_DEFAULTS.has(name)) return false
    return Object.prototype.hasOwnProperty.call(CONFIG_DEFAULTS, camel(name))
  })

  test('比对集合非空（防止映射写错导致整组空跑）', () => {
    expect(pairs.length).toBeGreaterThan(15)
  })

  test.each(pairs)('%s', (name, ymlDefault) => {
    const shared = sharedValueAsString((CONFIG_DEFAULTS as any)[camel(name)])
    // 多行文本（prompt / path_filters）两边的尾随空白与缩进由 YAML 折叠规则决定，
    // 不构成语义差异；逐行 trim 后比较
    const norm = (s: string): string =>
      s
        .split('\n')
        .map(line => line.trimEnd())
        .join('\n')
        .trim()

    expect(norm(shared)).toBe(norm(ymlDefault))
  })
})

describe('映射表本身不能悄悄失效', () => {
  test('每个 NAME_OVERRIDES 的键都还是 action.yml 里的真实 input', () => {
    for (const name of Object.keys(NAME_OVERRIDES)) {
      expect(Object.prototype.hasOwnProperty.call(actionYml.inputs, name)).toBe(true)
    }
  })

  test('每个 NAME_OVERRIDES 的值都还是 CONFIG_DEFAULTS 的真实字段', () => {
    for (const field of Object.values(NAME_OVERRIDES)) {
      expect(Object.prototype.hasOwnProperty.call(CONFIG_DEFAULTS, field)).toBe(true)
    }
  })

  test('豁免清单里的每一项都还是 action.yml 里的真实 input（清单不得陈旧）', () => {
    for (const name of NOT_IN_SHARED_DEFAULTS) {
      expect(Object.prototype.hasOwnProperty.call(actionYml.inputs, name)).toBe(true)
    }
  })

  /**
   * 反向完整性：CONFIG_DEFAULTS 里的字段，若在 action.yml 有同名 input，就必须
   * 落进上面的比对集合。漏进来的话，改一边不改另一边就还是没人发现。
   */
  test('CONFIG_DEFAULTS 中凡在 action.yml 有对应 input 的字段都已被比对', () => {
    const compared = new Set(
      declaredDefaults()
        .filter(([n]) => !NOT_IN_SHARED_DEFAULTS.has(n))
        .map(([n]) => camel(n))
    )
    const declared = new Set(Object.keys(actionYml.inputs ?? {}).map(camel))

    for (const field of Object.keys(CONFIG_DEFAULTS)) {
      if (!declared.has(field)) continue // GitLab 专有 / 无公开 input，不在本门禁范围
      expect(compared.has(field)).toBe(true)
    }
  })
})

describe('工具默认版本只有一个受控来源（§16）', () => {
  /**
   * semgrep 是唯一一个默认版本同时出现在两处的工具：`action.yml` 的
   * `semgrep_version.default` 与 `CONFIG_DEFAULTS.semgrepVersion`（CFG-003 要求
   * 它必须被 action.yml 声明）。两处漂移的后果是「以为装的是 A、实际装的是 B」，
   * 而版本差异正是 lint 结论飘移的常见原因。
   */
  test('semgrep 默认版本两处一致', () => {
    expect(String(actionYml.inputs.semgrep_version.default)).toBe(CONFIG_DEFAULTS.semgrepVersion)
  })

  test('其余四个工具的默认版本只在 action.yml 一处（不在 CONFIG_DEFAULTS 里另立一份）', () => {
    for (const tool of ['eslint', 'biome', 'tsc', 'prettier']) {
      expect(Object.prototype.hasOwnProperty.call(actionYml.inputs, `${tool}_version`)).toBe(true)
      expect(Object.prototype.hasOwnProperty.call(CONFIG_DEFAULTS, `${tool}Version`)).toBe(false)
    }
  })
})
