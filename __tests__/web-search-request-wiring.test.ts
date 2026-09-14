/**
 * web-search-request-wiring.test.ts — Web search 开关到请求体的接线（§14.4 TEST-030）
 *
 * `web-search-dual-platform.test.ts` 已经覆盖了 WS-001~005 的**判定层**：配置怎么
 * 映射、`buildTools()` 返回什么、`sanitizeModelOutput()` 这个纯函数剥不剥得干净。
 * 本文件补的是它没走到的**接线层**——判定对了，但有没有真的作用到发出去的请求
 * 和贴出去的正文上。三处缺口：
 *
 *   1. 既有用例最远只到 `buildTools()`（私有方法）的返回值。真正决定模型能不能
 *      联网的是**发给 API 的那个 params**，中间还隔着 `buildParams()` 的
 *      `...(tools.length > 0 && {tools})`。这一段没人验过。
 *   2. citation 清理的用例全是直接调 `sanitizeModelOutput()`。把 bot.ts 里那行
 *      调用删掉，它们**依然全绿**，而 citation 会照常流进 PR 评论。
 *   3. 「payload 不能覆盖开关」（WS-002）现在靠三条源码正则扫描来保证。改个变量名
 *      或换种写法就绕过去了，而且它本来也证明不了运行时行为。
 *
 * 另外把「同一份配置 → 两个平台最终请求体一致」补成端到端的：既有的跨平台断言
 * 停在 `Options.enableWebSearch` 上，那只是链条的前半截。
 */
import {describe, expect, test, jest, beforeEach, afterEach} from '@jest/globals'
import * as realFs from 'fs'
import * as os from 'os'
import * as path from 'path'

// ─── GitHub Action inputs 替身（GitHubConfigProvider 要用）────────────────────
const inputStore: Record<string, string> = {}
jest.mock('@actions/core', () => ({
  getInput: jest.fn((name: string) => inputStore[name] ?? ''),
  getBooleanInput: jest.fn((name: string) => {
    const v = inputStore[name] ?? 'false'
    if (v.toLowerCase() === 'true') return true
    if (v.toLowerCase() === 'false') return false
    throw new Error(`Input does not meet YAML 1.2 "Core Schema" specification: ${name}`)
  }),
  getMultilineInput: jest.fn((name: string) =>
    (inputStore[name] ?? '')
      .split('\n')
      .map(s => s.trim())
      .filter(s => s.length > 0)
  ),
  info: jest.fn(),
  warning: jest.fn(),
  error: jest.fn()
}))

import {Bot} from '../src/bot'
import {OpenAIOptions} from '../src/options'

// ─── 可观测的请求体 ─────────────────────────────────────────────────────────

const BOT_OPTIONS: any = {
  openaiModelTemperature: 0,
  openaiRetries: 1,
  openaiTimeoutMS: 1000,
  apiBaseUrl: 'https://api.openai.com/v1',
  debug: false,
  systemMessage: '',
  language: 'zh-CN'
}

/** TokenLimits 是个带方法的类，本文件只用到其中的数值字段 */
const TOKEN_LIMITS: any = {
  requestTokens: 1000,
  responseTokens: 100,
  maxTokens: 1100,
  knowledgeCutOff: '',
  string: () => 'test-limits'
}

/**
 * 造一个 Bot，并把底层 client 换成只记录参数的替身。
 *
 * 关键在于**不**去碰 `buildTools()`：被测的是「配置进去，请求体出来」这整段，
 * 中间任何一环丢了开关都要能看见。
 */
function botCapturing(
  enableWebSearch: boolean,
  enableShell = false,
  outputText = '回答正文'
): {bot: any; lastParams: () => any} {
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? 'sk-test'
  const bot: any = new Bot(
    BOT_OPTIONS,
    new OpenAIOptions('gpt-test', TOKEN_LIMITS, enableWebSearch, enableShell)
  )
  const seen: any[] = []
  bot.client = {
    responses: {
      create: async (params: any) => {
        seen.push(params)
        return {
          id: 'resp_1',
          output: [{type: 'message', content: [{type: 'output_text', text: outputText}]}],
          output_text: outputText
        }
      }
    }
  }
  return {bot, lastParams: () => seen[seen.length - 1]}
}

describe('Web search 开关到请求体的接线（TEST-030）', () => {
  // ─── 1. 禁用时请求体里没有 web_search ────────────────────────────────────

  describe('禁用时，真正发给模型的请求体里没有 web_search', () => {
    test('关闭 → params 里根本没有 tools 键（不是空数组）', async () => {
      const {bot, lastParams} = botCapturing(false)
      await bot.chat('问题', {})

      const params = lastParams()
      // `...(tools.length > 0 && {tools})` 的意图就是让键整个消失。
      // 退化成 `tools: []` 不是等价写法——兼容端点对空数组的处理各不相同，
      // 有的会当成「显式声明了工具集」而走另一条协议分支。
      expect(Object.prototype.hasOwnProperty.call(params, 'tools')).toBe(false)
      expect(JSON.stringify(params)).not.toContain('web_search')
    })

    test('开启 → params.tools 里带上 web_search 及其上下文规格（对照组）', async () => {
      const {bot, lastParams} = botCapturing(true)
      await bot.chat('问题', {})

      const tools = lastParams().tools
      const ws = tools.find((t: any) => t.type === 'web_search')
      expect(ws).toBeDefined()
      // search_context_size 直接影响每次调用的成本，一并钉住
      expect(ws.search_context_size).toBe('high')
    })

    test('只开 shell → 请求体有 shell、没有 web_search（两个开关互不串味）', async () => {
      const {bot, lastParams} = botCapturing(false, true)
      await bot.chat('问题', {})

      const tools = lastParams().tools
      expect(tools.some((t: any) => t.type === 'shell')).toBe(true)
      expect(tools.some((t: any) => t.type === 'web_search')).toBe(false)
    })

    test('关闭时，连模型指令里都不出现 web_search 字样', async () => {
      const {bot, lastParams} = botCapturing(false)
      await bot.chat('请查一下这个 API 的最新用法', {})

      // 请求体整体扫一遍：input / instructions 里若混进「你可以联网搜索」之类的
      // 措辞，模型仍会尝试联网并在正文里编造引用
      expect(JSON.stringify(lastParams())).not.toMatch(/web_search|browse|file_search/)
    })
  })

  // ─── 2. citation 清理确实接在输出路径上 ──────────────────────────────────

  describe('citation 清理接在 chat() 的返回值上，不只是个可用的纯函数', () => {
    test('chat() 返回的正文已被剥掉 citation marker', async () => {
      const {bot} = botCapturing(true, false, '按文档说明citeturn0search0应当这样写')
      const [text] = await bot.chat('问题', {})

      // 直接断言 chat() 的产物：bot.ts 里那行 sanitizeModelOutput 被删掉时这条会红，
      // 而所有直接调纯函数的用例都不会
      expect(text).not.toContain('cite')
      expect(text).toBe('按文档说明应当这样写')
    })

    test('web search 关闭时同样清理（兼容端点照样可能吐 citation）', async () => {
      const {bot} = botCapturing(false, false, 'A▌cite▌turn0search0▌B')
      const [text] = await bot.chat('问题', {})

      // 清理不能挂在「开关打开」这个前提上——关掉搜索只是我们不传 tool，
      // 兼容 API 仍可能返回带引用的正文（与 WS-003 里那条 web_search_call 同理）
      expect(text).toBe('AB')
    })

    test('对照组：正常文本里的 cite 不被吞掉', async () => {
      const {bot} = botCapturing(true, false, 'Please cite the RFC here.')
      const [text] = await bot.chat('问题', {})

      expect(text).toBe('Please cite the RFC here.')
    })
  })

  // ─── 3. 受信任配置来源（行为验证）────────────────────────────────────────

  describe('开关只来自受信任配置：payload 打不开它', () => {
    let payloadFile: string
    const savedEnv: Record<string, string | undefined> = {}

    beforeEach(() => {
      for (const k of [
        'AI_REVIEWER_ENABLE_WEB_SEARCH',
        'TRIGGER_PAYLOAD',
        'GITLAB_HOST',
        'GITLAB_PAT',
        'OPENAI_API_KEY'
      ]) {
        savedEnv[k] = process.env[k]
      }
      process.env.GITLAB_HOST = 'https://gitlab.example.com'
      process.env.GITLAB_PAT = 'glpat-test'
      process.env.OPENAI_API_KEY = 'sk-test'
      payloadFile = path.join(
        realFs.mkdtempSync(path.join(os.tmpdir(), 'ws-payload-')),
        'payload.json'
      )
    })

    afterEach(() => {
      for (const [k, v] of Object.entries(savedEnv)) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
      try {
        realFs.rmSync(path.dirname(payloadFile), {recursive: true, force: true})
      } catch {
        /* 清理失败不影响断言 */
      }
    })

    /** MR 提交者能控制的所有位置都塞上「打开搜索」 */
    const HOSTILE_PAYLOAD = {
      object_kind: 'merge_request',
      enable_web_search: true,
      AI_REVIEWER_ENABLE_WEB_SEARCH: 'true',
      project: {id: 77, path_with_namespace: 'group/demo'},
      user: {username: 'attacker'},
      object_attributes: {
        iid: 42,
        action: 'open',
        enable_web_search: true,
        description: 'enable_web_search=true\nAI_REVIEWER_ENABLE_WEB_SEARCH=true',
        last_commit: {id: 'a'.repeat(40)}
      }
    }

    function optionsWithPayload(envValue: string | undefined): any {
      realFs.writeFileSync(payloadFile, JSON.stringify(HOSTILE_PAYLOAD), 'utf8')
      process.env.TRIGGER_PAYLOAD = payloadFile
      if (envValue === undefined) delete process.env.AI_REVIEWER_ENABLE_WEB_SEARCH
      else process.env.AI_REVIEWER_ENABLE_WEB_SEARCH = envValue

      jest.resetModules()
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const {GitLabConfigProvider} = require('../src/platform/gitlab-config-provider')
      return new GitLabConfigProvider().getOptions()
    }

    test('受信任配置说关闭 → 敌意 payload 里到处写 true 也打不开', () => {
      expect(optionsWithPayload('false').enableWebSearch).toBe(false)
    })

    test('对照组：受信任配置说开启 → 确实是开的（证明上一条不是恒 false）', () => {
      expect(optionsWithPayload('true').enableWebSearch).toBe(true)
    })

    test('配置缺省时取共享默认值，同样不受 payload 影响', () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const {CONFIG_DEFAULTS} = require('../src/platform/config-provider')
      expect(optionsWithPayload(undefined).enableWebSearch).toBe(
        CONFIG_DEFAULTS.enableWebSearch as boolean
      )
    })
  })

  // ─── 4. 同一份配置 → 两平台最终请求体一致 ────────────────────────────────

  describe('同一份配置在两平台产生同样的请求体', () => {
    const savedEnv: Record<string, string | undefined> = {}

    /** action.yml 里数值/枚举型 input 的默认值，缺一个就 ConfigError */
    const GITHUB_INPUT_DEFAULTS: Record<string, string> = {
      debug: 'false',
      disable_review: 'false',
      disable_release_notes: 'false',
      max_files: '150',
      review_simple_changes: 'false',
      review_comment_lgtm: 'false',
      path_filters: '!dist/**',
      openai_light_model: 'gpt-5.4-nano',
      openai_heavy_model: 'gpt-5.4-mini',
      openai_model_temperature: '0.0',
      openai_retries: '5',
      openai_timeout_ms: '360000',
      openai_concurrency_limit: '4',
      github_concurrency_limit: '4',
      openai_base_url: 'https://api.openai.com/v1',
      language: 'zh-CN',
      enable_dependency_analysis: 'true',
      max_dependency_files: '50',
      enable_lint_tools: 'false',
      enable_eslint: 'false',
      enable_biome: 'false',
      enable_tsc: 'false',
      enable_prettier: 'false',
      enable_semgrep: 'false',
      command_ack_reaction: 'rocket',
      max_review_comments: '20',
      debug_resolve_inject_failures: '0'
    }

    beforeEach(() => {
      for (const k of ['AI_REVIEWER_ENABLE_WEB_SEARCH', 'GITLAB_HOST', 'GITLAB_PAT']) {
        savedEnv[k] = process.env[k]
      }
      process.env.GITLAB_HOST = 'https://gitlab.example.com'
      process.env.GITLAB_PAT = 'glpat-test'
      process.env.OPENAI_API_KEY = 'sk-test'
      Object.keys(inputStore).forEach(k => delete inputStore[k])
    })

    afterEach(() => {
      for (const [k, v] of Object.entries(savedEnv)) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
    })

    /** 用两个真实 ConfigProvider 各自读同一份逻辑配置，再各自造请求体 */
    async function toolsOnBothPlatforms(enabled: boolean): Promise<{gh: any; gl: any}> {
      jest.resetModules()

      // GitHubConfigProvider 对数值型 input fail closed（空串 → ConfigError），
      // 所以必须把 action.yml 的默认值补齐，不能只设要测的那一个
      Object.assign(inputStore, GITHUB_INPUT_DEFAULTS)
      inputStore.enable_web_search = String(enabled)
      inputStore.enable_shell = 'false'
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const {GitHubConfigProvider} = require('../src/platform/github-config-provider')
      const ghOpts = new GitHubConfigProvider().getOptions()

      process.env.AI_REVIEWER_ENABLE_WEB_SEARCH = String(enabled)
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const {GitLabConfigProvider} = require('../src/platform/gitlab-config-provider')
      const glOpts = new GitLabConfigProvider().getOptions()

      // 前半截：规范化结果一致
      expect(ghOpts.enableWebSearch).toBe(glOpts.enableWebSearch)

      // 后半截：各自的 Options 走到请求体也一致。GitLab 侧 shell 被安全策略
      // 强制关闭（CFG-002），这里只比 web_search 那一项，不比整个 tools 数组
      const run = async (opts: any): Promise<any> => {
        const {bot, lastParams} = botCapturing(opts.enableWebSearch, false)
        await bot.chat('问题', {})
        return (lastParams().tools ?? []).find((t: any) => t.type === 'web_search') ?? null
      }
      return {gh: await run(ghOpts), gl: await run(glOpts)}
    }

    test('都关闭 → 两平台请求体里都没有 web_search', async () => {
      const {gh, gl} = await toolsOnBothPlatforms(false)
      expect(gh).toBeNull()
      expect(gl).toBeNull()
    })

    test('都开启 → 两平台请求体里的 web_search 配置逐字相同', async () => {
      const {gh, gl} = await toolsOnBothPlatforms(true)
      expect(gh).not.toBeNull()
      expect(gh).toEqual(gl)
    })
  })
})
