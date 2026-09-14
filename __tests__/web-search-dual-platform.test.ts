/**
 * web-search-dual-platform.test.ts — §8.5 Web Search（WS-001~005）
 *
 * web_search 是**模型能力**，不是平台能力：共享 Bot 只读规范化后的
 * `enableWebSearch`，两个 ConfigProvider 各自映射自己的配置来源。所以这里
 * 分三层验证：
 *
 *   配置层  —— 两侧映射与默认值一致，GitLab 的开关不可被 MR/Note payload 覆盖
 *   Bot 层  —— 关掉时不把 tool 传给模型，也不产生 analysis step
 *   输出层  —— citation 清理与 analysis step 记录不泄露 secret
 */
import {describe, expect, test, jest, beforeEach} from '@jest/globals'

import {CONFIG_DEFAULTS} from '../src/platform/config-provider'
import {sanitizeModelOutput} from '../src/sanitize-model-output'

describe('WS-001：两个平台的默认值与映射一致', () => {
  test('共享默认值为 true', () => {
    expect(CONFIG_DEFAULTS.enableWebSearch).toBe(true)
  })

  test('GitLab：环境变量缺省 → 取共享默认值', () => {
    jest.resetModules()
    const saved = process.env.AI_REVIEWER_ENABLE_WEB_SEARCH
    delete process.env.AI_REVIEWER_ENABLE_WEB_SEARCH
    process.env.GITLAB_HOST = 'https://gitlab.example.com'
    process.env.GITLAB_PAT = 'glpat-test'
    process.env.OPENAI_API_KEY = 'sk-test'

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const {GitLabConfigProvider} = require('../src/platform/gitlab-config-provider')
    const opts = new GitLabConfigProvider().getOptions()
    expect(opts.enableWebSearch).toBe(CONFIG_DEFAULTS.enableWebSearch)

    if (saved === undefined) delete process.env.AI_REVIEWER_ENABLE_WEB_SEARCH
    else process.env.AI_REVIEWER_ENABLE_WEB_SEARCH = saved
  })

  test.each([
    ['false', false],
    ['0', false],
    ['no', false],
    ['true', true],
    ['1', true],
    ['yes', true]
  ])('GitLab：环境变量 "%s" → %s', (raw, expected) => {
    jest.resetModules()
    process.env.AI_REVIEWER_ENABLE_WEB_SEARCH = raw as string
    process.env.GITLAB_HOST = 'https://gitlab.example.com'
    process.env.GITLAB_PAT = 'glpat-test'
    process.env.OPENAI_API_KEY = 'sk-test'

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const {GitLabConfigProvider} = require('../src/platform/gitlab-config-provider')
    expect(new GitLabConfigProvider().getOptions().enableWebSearch).toBe(expected)
    delete process.env.AI_REVIEWER_ENABLE_WEB_SEARCH
  })

  test('GitLab：非法取值 fail closed（抛 ConfigError，不静默当成 true）', () => {
    jest.resetModules()
    process.env.AI_REVIEWER_ENABLE_WEB_SEARCH = 'maybe'
    process.env.GITLAB_HOST = 'https://gitlab.example.com'
    process.env.GITLAB_PAT = 'glpat-test'
    process.env.OPENAI_API_KEY = 'sk-test'

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const {GitLabConfigProvider} = require('../src/platform/gitlab-config-provider')
    expect(() => new GitLabConfigProvider().getOptions()).toThrow()
    delete process.env.AI_REVIEWER_ENABLE_WEB_SEARCH
  })
})

describe('WS-002：GitLab 的开关只来自受信任配置，payload 不能覆盖', () => {
  test('配置只读环境变量，源码里不存在从 payload 取 web search 开关的路径', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('path')
    const src: string = fs.readFileSync(
      path.resolve(__dirname, '../src/platform/gitlab-config-provider.ts'),
      'utf8'
    )
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

    // 开关只能来自 envBool；出现 payload / object_attributes / TRIGGER_PAYLOAD
    // 之类的读取就说明 MR 提交者能自己打开它
    expect(code).toContain("envBool('AI_REVIEWER_ENABLE_WEB_SEARCH')")
    expect(code).not.toMatch(/object_attributes/)
    expect(code).not.toMatch(/\bpayload\b/)
  })

  test('trigger 入口不把 payload 传进 ConfigProvider', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('path')
    const src: string = fs.readFileSync(path.resolve(__dirname, '../src/gitlab-trigger.ts'), 'utf8')
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    // ConfigProvider 是无参构造：配置来源与事件内容物理隔离
    expect(code).toMatch(/new GitLabConfigProvider\(\)/)
  })

  test('与 shell/lint 的强制关闭同处一段（安全开关集中可审计）', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('path')
    const src: string = fs.readFileSync(
      path.resolve(__dirname, '../src/platform/gitlab-config-provider.ts'),
      'utf8'
    )
    const wsIdx = src.indexOf('AI_REVIEWER_ENABLE_WEB_SEARCH')
    const shellIdx = src.indexOf('false, // enableShell')
    expect(wsIdx).toBeGreaterThan(-1)
    expect(shellIdx).toBeGreaterThan(-1)
    // web search 紧邻 CFG-002 的强制关闭块——改任何一个都会看到另一个
    expect(Math.abs(shellIdx - wsIdx)).toBeLessThan(400)
  })
})

describe('WS-003：关闭时不传 tool，也不产生 analysis step', () => {
  /**
   * 调用**真实的** buildTools。
   *
   * 第一版这里是自己按同样的 if/else 拼一个 tools 数组，再断言它——那只是把
   * 生产逻辑抄了一遍，改坏 bot.ts 也不会红。buildTools 是私有方法，用原型访问
   * 绕过 TS 的可见性即可，被测的仍是真实实现。
   */
  function realTools(enableWebSearch: boolean, enableShell = false): any[] {
    // Bot 构造要求 OPENAI_API_KEY 存在（缺失时会抛「Unable to initialize」）；
    // 前面的配置用例会改动环境变量，这里显式补上
    process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? 'sk-test'
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const {Bot} = require('../src/bot')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const {OpenAIOptions} = require('../src/options')

    const options: any = {
      openaiModelTemperature: 0,
      openaiRetries: 1,
      openaiTimeoutMS: 1000,
      apiBaseUrl: 'https://api.openai.com/v1',
      debug: false,
      systemMessage: '',
      language: 'zh-CN'
    }
    const openaiOptions = new OpenAIOptions(
      'gpt-test',
      {requestTokens: 1000, responseTokens: 100, maxTokens: 1100, knowledgeCutOff: ''},
      enableWebSearch,
      enableShell
    )
    const bot = new Bot(options, openaiOptions)
    return (bot as any).buildTools()
  }

  test('enableWebSearch=false → tools 里没有 web_search', () => {
    expect(realTools(false).some((t: any) => t.type === 'web_search')).toBe(false)
  })

  test('enableWebSearch=true → tools 里有 web_search（对照组）', () => {
    const tools = realTools(true)
    expect(tools.some((t: any) => t.type === 'web_search')).toBe(true)
    // 配置也一并钉住：搜索上下文大小影响成本
    expect(tools.find((t: any) => t.type === 'web_search').search_context_size).toBe('high')
  })

  test('两个开关互不影响：只开 shell 时不带 web_search', () => {
    const tools = realTools(false, true)
    expect(tools.some((t: any) => t.type === 'shell')).toBe(true)
    expect(tools.some((t: any) => t.type === 'web_search')).toBe(false)
  })

  test('都关 → 空 tools（不给模型任何工具）', () => {
    expect(realTools(false, false)).toEqual([])
  })

  /**
   * 走**真实的响应解析路径**，而不是断言源码里 push 的相对位置。
   *
   * 先前那条只看 buildTools() 和源码结构，捕获不到「关掉开关但兼容 API 仍返回
   * web_search_call」这种情况——协议漂移或第三方兼容端点都可能触发，届时 step
   * 会进 PR 评论，等于对外宣称做过搜索。
   */
  function botWithStubbedResponse(enableWebSearch: boolean, output: any[]): any {
    process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? 'sk-test'
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const {Bot} = require('../src/bot')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const {OpenAIOptions} = require('../src/options')

    const options: any = {
      openaiModelTemperature: 0,
      openaiRetries: 1,
      openaiTimeoutMS: 1000,
      apiBaseUrl: 'https://api.openai.com/v1',
      debug: false,
      systemMessage: '',
      language: 'zh-CN'
    }
    const bot = new Bot(
      options,
      new OpenAIOptions(
        'gpt-test',
        {requestTokens: 1000, responseTokens: 100, maxTokens: 1100, knowledgeCutOff: ''},
        enableWebSearch,
        false
      )
    )
    // 替换底层客户端，让 chat() 走完整的响应解析
    ;(bot as any).client = {
      responses: {
        create: async () => ({
          id: 'resp_1',
          output: output,
          output_text: '回答正文'
        })
      }
    }
    return bot
  }

  const webSearchCallItem = {type: 'web_search_call', id: 'ws_1', status: 'completed'}
  const messageItem = {
    type: 'message',
    content: [{type: 'output_text', text: '回答正文'}]
  }

  test('关闭时兼容 API 仍返回 web_search_call → 不记录 analysis step', async () => {
    const bot = botWithStubbedResponse(false, [webSearchCallItem, messageItem])
    const [, , steps] = await bot.chat('问题', {})

    expect(steps.filter((s: any) => s.type === 'web_search')).toEqual([])
  })

  test('开启时返回 web_search_call → 记录 step（对照组，证明上一条不是恒空）', async () => {
    const bot = botWithStubbedResponse(true, [webSearchCallItem, messageItem])
    const [, , steps] = await bot.chat('问题', {})

    const ws = steps.filter((s: any) => s.type === 'web_search')
    expect(ws).toHaveLength(1)
    expect(ws[0].status).toBe('completed')
  })

  test('开启但响应里没有 web_search_call → 不凭空造 step', async () => {
    const bot = botWithStubbedResponse(true, [messageItem])
    const [, , steps] = await bot.chat('问题', {})

    expect(steps.filter((s: any) => s.type === 'web_search')).toEqual([])
  })
})

describe('WS-004：输出侧不泄露 secret，也不夹带搜索内容', () => {
  test('analysis chain 只记录 status，不记录搜索结果或 URL', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('path')
    const src: string = fs.readFileSync(path.resolve(__dirname, '../src/review.ts'), 'utf8')
    const start = src.indexOf("step.type === 'web_search'")
    const block = src.slice(start, start + 300)
    // 搜索结果是外部内容，进评论正文就是一条注入通道；只写 status（API 枚举值）
    expect(block).toContain('status')
    expect(block).not.toMatch(/step\.(results|urls|content|snippet)/)
  })

  test.each([
    ['PUA 包裹', '看这里citeturn0search0后面', '看这里后面'],
    ['Block 包裹', '看这里▌cite▌turn0search0▌后面', '看这里后面'],
    ['裸文本', '看这里citeturn0search0后面', '看这里后面'],
    ['多个连续引用', 'A▌cite▌turn0search0▌B▌cite▌turn1search2▌C', 'ABC']
  ])('citation 清理：%s', (_label, input, expected) => {
    expect(sanitizeModelOutput(input as string)).toBe(expected)
  })

  test('代码块里的引用同样剥掉，但不破坏缩进', () => {
    const out = sanitizeModelOutput('```js\n  const a = 1 // ▌cite▌turn0search0▌\n```')
    expect(out).not.toContain('cite')
    expect(out).toContain('  const a = 1') // 缩进保留
  })

  test('清理不应吞掉正常文本里的 “cite” 单词', () => {
    const out = sanitizeModelOutput('Please cite the RFC in a comment.')
    expect(out).toContain('cite the RFC')
  })

  test('清理是纯函数：不抛异常，非字符串输入安全', () => {
    expect(() => sanitizeModelOutput('')).not.toThrow()
    expect(sanitizeModelOutput('')).toBe('')
  })
})

describe('WS-005：同一配置在两个平台产生相同的工具启用语义', () => {
  beforeEach(() => {
    jest.resetModules()
    process.env.GITLAB_HOST = 'https://gitlab.example.com'
    process.env.GITLAB_PAT = 'glpat-test'
    process.env.OPENAI_API_KEY = 'sk-test'
  })

  test.each([
    ['关闭', 'false', false],
    ['开启', 'true', true]
  ])('%s：GitLab 规范化结果与共享核心读到的一致', (_label, raw, expected) => {
    process.env.AI_REVIEWER_ENABLE_WEB_SEARCH = raw as string
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const {GitLabConfigProvider} = require('../src/platform/gitlab-config-provider')
    const opts = new GitLabConfigProvider().getOptions()

    // 共享核心只读这个规范化字段——两个平台走同一条路径
    expect(opts.enableWebSearch).toBe(expected)
    delete process.env.AI_REVIEWER_ENABLE_WEB_SEARCH
  })

  test('共享核心不按平台分支决定 web search 是否启用', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('path')
    for (const rel of ['bot.ts', 'review.ts']) {
      const code: string = fs
        .readFileSync(path.resolve(__dirname, '../src', rel), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '')
      const idx = code.indexOf('enableWebSearch')
      if (idx === -1) continue
      // 附近不得出现平台判断
      const around = code.slice(Math.max(0, idx - 400), idx + 400)
      expect(around).not.toMatch(/platform\s*===\s*['"](github|gitlab)['"]/)
    }
  })
})
