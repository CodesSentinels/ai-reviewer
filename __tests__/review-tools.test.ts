/**
 * review-tools.test.ts — shell 不可用时的只读代码探查工具
 *
 * 覆盖：执行器（读文件 / 列目录 / 搜索）的边界与安全约束、Bot 工具循环的接线、
 * Analysis chain 展示、bot-factory 与提示词的启用条件。
 */
import {describe, expect, test, jest, beforeEach} from '@jest/globals'

const platform = {
  getFileContent: jest.fn<(...a: any[]) => Promise<string | null>>(),
  listRepositoryTree: jest.fn<(...a: any[]) => Promise<any>>(),
  searchCode: jest.fn<(...a: any[]) => Promise<any[]>>()
}
jest.mock('../src/platform/git-platform', () => ({getPlatform: () => platform}))

const ctx = {platform: 'gitlab', projectPath: 'group/sub/project', headSha: 'h'.repeat(40)}
jest.mock('../src/platform/run-context', () => {
  const actual = jest.requireActual<any>('../src/platform/run-context')
  return {...actual, getExecCtx: () => ctx}
})

jest.mock('@actions/core', () => ({info: jest.fn(), warning: jest.fn(), error: jest.fn()}))

import {executeReviewTool, reviewToolDefinitions, REVIEW_TOOL_LIMITS} from '../src/review-tools'
import {Bot} from '../src/bot'
import {OpenAIOptions} from '../src/options'
import {formatAnalysisChain} from '../src/review'
import {Prompts, buildInvestigationSection} from '../src/prompts'

beforeEach(() => {
  jest.clearAllMocks()
})

describe('read_file', () => {
  test('按 HEAD 版本读取，带行号与范围说明', async () => {
    platform.getFileContent.mockResolvedValue('a\nb\nc\nd')
    const r = await executeReviewTool(
      'read_file',
      JSON.stringify({path: 'src/x.ts', start_line: 2, end_line: 3})
    )

    expect(platform.getFileContent).toHaveBeenCalledWith(
      'group/sub',
      'project',
      'src/x.ts',
      ctx.headSha
    )
    expect(r.output).toBe('src/x.ts (lines 2-3 of 4)\n2: b\n3: c')
    expect(r.step).toEqual({type: 'read_file', path: 'src/x.ts', startLine: 2, endLine: 3})
  })

  test('超过行数上限时截断，并提示从哪里继续', async () => {
    const total = REVIEW_TOOL_LIMITS.readFileMaxLines + 50
    platform.getFileContent.mockResolvedValue(
      Array.from({length: total}, (_, i) => `l${i + 1}`).join('\n')
    )
    const r = await executeReviewTool('read_file', JSON.stringify({path: 'big.ts'}))

    expect(r.step.endLine).toBe(REVIEW_TOOL_LIMITS.readFileMaxLines)
    expect(r.output).toContain(`start_line=${REVIEW_TOOL_LIMITS.readFileMaxLines + 1}`)
  })

  test.each(['../etc/passwd', '/etc/passwd', 'a/../../b', 'a\\\\b', ''])(
    '非法路径 %s → 返回错误，不调用平台',
    async path => {
      const r = await executeReviewTool('read_file', JSON.stringify({path}))
      expect(r.output).toMatch(/^error: invalid path/)
      expect(platform.getFileContent).not.toHaveBeenCalled()
    }
  )

  test('文件不存在 → 以文本返回错误', async () => {
    platform.getFileContent.mockResolvedValue(null)
    const r = await executeReviewTool('read_file', JSON.stringify({path: 'nope.ts'}))
    expect(r.output).toMatch(/^error: file not found/)
    expect(r.step.error).toBeDefined()
  })

  test('文件里的密钥在回传给模型之前被脱敏', async () => {
    const secret = 'sk-' + 'A'.repeat(40)
    platform.getFileContent.mockResolvedValue(`OPENAI_API_KEY=${secret}\nconst x = 1`)
    const r = await executeReviewTool('read_file', JSON.stringify({path: '.env'}))
    expect(r.output).not.toContain(secret)
    expect(r.output).toContain('const x = 1')
  })
})

describe('list_directory', () => {
  test('根目录：取全量树后只保留第一层，目录带斜杠', async () => {
    platform.listRepositoryTree.mockResolvedValue({
      entries: [
        {type: 'tree', path: 'src'},
        {type: 'blob', path: 'src/a.ts'},
        {type: 'blob', path: 'README.md'}
      ],
      truncated: false
    })
    const r = await executeReviewTool('list_directory', JSON.stringify({path: ''}))

    expect(platform.listRepositoryTree).toHaveBeenCalledWith(
      'group/sub',
      'project',
      ctx.headSha,
      undefined
    )
    expect(r.output).toBe('(root)/\nREADME.md\nsrc/')
    expect(r.step).toEqual({type: 'list_directory', path: '', resultCount: 2})
  })

  test('子目录：只查一层', async () => {
    platform.listRepositoryTree.mockResolvedValue({
      entries: [{type: 'blob', path: 'src/a.ts'}],
      truncated: false
    })
    await executeReviewTool('list_directory', JSON.stringify({path: 'src/'}))
    expect(platform.listRepositoryTree).toHaveBeenCalledWith(
      'group/sub',
      'project',
      ctx.headSha,
      'src'
    )
  })
})

describe('search_code', () => {
  test('列出命中位置与片段，并传入条数上限', async () => {
    platform.searchCode.mockResolvedValue([
      {path: 'src/a.ts', startLine: 10, snippet: 'callFoo()'},
      {path: 'src/b.ts', startLine: null, snippet: ''}
    ])
    const r = await executeReviewTool('search_code', JSON.stringify({query: 'callFoo'}))

    expect(platform.searchCode).toHaveBeenCalledWith(
      'group/sub',
      'project',
      'callFoo',
      REVIEW_TOOL_LIMITS.searchMaxHits
    )
    expect(r.output).toBe('results for: callFoo\n- src/a.ts:10\ncallFoo()\n- src/b.ts')
    expect(r.step).toEqual({type: 'search_code', query: 'callFoo', resultCount: 2})
  })

  test('平台调用失败 → 以文本返回错误，不抛出', async () => {
    platform.searchCode.mockRejectedValue(new Error('403 forbidden'))
    const r = await executeReviewTool('search_code', JSON.stringify({query: 'x'}))
    expect(r.output).toBe('error: 403 forbidden')
    expect(r.step).toEqual({type: 'search_code', query: 'x', error: '403 forbidden'})
  })

  test('空查询、非法 JSON、未知工具 → 错误文本', async () => {
    expect((await executeReviewTool('search_code', '{"query":"  "}')).output).toMatch(
      /^error: empty query/
    )
    expect((await executeReviewTool('read_file', '{not json')).output).toMatch(
      /^error: arguments are not valid JSON/
    )
    expect((await executeReviewTool('rm_rf', '{}')).output).toMatch(/^error: unknown tool/)
  })
})

describe('Bot 工具循环', () => {
  const BOT_OPTIONS: any = {
    openaiModelTemperature: 0,
    openaiRetries: 0,
    openaiTimeoutMS: 1000,
    apiBaseUrl: 'https://api.openai.com/v1',
    debug: false,
    systemMessage: '',
    language: 'zh-CN'
  }
  const TOKEN_LIMITS: any = {
    requestTokens: 1000,
    responseTokens: 100,
    maxTokens: 1100,
    knowledgeCutOff: ''
  }

  function botWith(enableCodeTools: boolean, responses: any[]): {bot: any; calls: any[]} {
    process.env.OPENAI_API_KEY = 'sk-test-key-for-bot-loop-000000000000'
    const bot: any = new Bot(
      BOT_OPTIONS,
      new OpenAIOptions('gpt-test', TOKEN_LIMITS, false, false, enableCodeTools)
    )
    const calls: any[] = []
    bot.client = {responses: {create: async (p: any) => (calls.push(p), responses.shift())}}
    return {bot, calls}
  }

  const finalMessage = {
    id: 'r2',
    output: [{type: 'message', content: [{type: 'output_text', text: 'done'}]}]
  }

  test('模型调用 read_file → 执行并以 function_call_output 回传，步骤进入 analysis chain', async () => {
    platform.getFileContent.mockResolvedValue('x')
    const {bot, calls} = botWith(true, [
      {
        id: 'r1',
        output: [
          {type: 'function_call', call_id: 'c1', name: 'read_file', arguments: '{"path":"a.ts"}'}
        ]
      },
      finalMessage
    ])
    const [text, ids, steps] = await bot.chat('review', {})

    expect(calls[0].tools.map((t: any) => t.name)).toEqual([
      'read_file',
      'list_directory',
      'search_code'
    ])
    expect(calls[1].previous_response_id).toBe('r1')
    expect(calls[1].input).toEqual([
      {type: 'function_call_output', call_id: 'c1', output: 'a.ts (lines 1-1 of 1)\n1: x'}
    ])
    expect(steps).toEqual([{type: 'read_file', path: 'a.ts', startLine: 1, endLine: 1}])
    expect(text).toBe('done')
    expect(ids.previousResponseId).toBe('r2')
  })

  test('未启用代码工具：请求里没有工具声明；意外的 function_call 回一条错误，不执行', async () => {
    const {bot, calls} = botWith(false, [
      {
        id: 'r1',
        output: [
          {type: 'function_call', call_id: 'c1', name: 'read_file', arguments: '{"path":"a.ts"}'}
        ]
      },
      finalMessage
    ])
    await bot.chat('review', {})

    expect(calls[0].tools).toBeUndefined()
    expect(platform.getFileContent).not.toHaveBeenCalled()
    expect(calls[1].input[0].output).toMatch(/^error: tool read_file is not available/)
  })
})

describe('Analysis chain 展示', () => {
  test('三种代码探查步骤与失败原因', () => {
    const md = formatAnalysisChain(
      [
        {type: 'read_file', path: 'src/a.ts', startLine: 1, endLine: 40},
        {type: 'list_directory', path: '', resultCount: 3},
        {type: 'search_code', query: 'callFoo', resultCount: 2},
        {type: 'read_file', path: 'gone.ts', error: 'file not found at head commit: gone.ts'}
      ],
      ''
    )
    expect(md).toContain('📄 Read file: `src/a.ts` (lines 1-40)')
    expect(md).toContain('📁 Listed directory: `(root)` (3 entries)')
    expect(md).toContain('🔎 Searched code: `callFoo` (2 results)')
    expect(md).toContain('📄 Read file: `gone.ts` — failed: file not found at head commit: gone.ts')
  })
})

describe('启用条件', () => {
  test('bot-factory：shell 关闭时审查模型拿到代码工具，shell 开启时不重复提供', () => {
    process.env.OPENAI_API_KEY = 'sk-test-key-for-bot-factory-00000000000'
    const {createBots} = require('../src/bot-factory')
    const base: any = {
      openaiLightModel: 'm',
      openaiHeavyModel: 'm',
      lightTokenLimits: {responseTokens: 1},
      heavyTokenLimits: {responseTokens: 1},
      enableWebSearch: false,
      systemMessage: '',
      language: 'zh-CN',
      openaiTimeoutMS: 1000
    }
    const off = createBots({...base, enableShell: false}, () => {})
    const on = createBots({...base, enableShell: true}, () => {})
    expect(off.heavyBot.enableCodeTools).toBe(true)
    expect(off.lightBot.enableCodeTools).toBe(false)
    expect(on.heavyBot.enableCodeTools).toBe(false)
  })

  test('提示词：shell 不可用但有代码工具 → 要求用只读工具调查', () => {
    const section = buildInvestigationSection({shell: false, webSearch: false, codeTools: true})
    expect(section).toContain('**read_file**')
    expect(section).toContain('**search_code**')
    expect(section).not.toContain('Shell access is not available')
    // 没有代码工具时仍是「只能基于提供的上下文」
    expect(buildInvestigationSection({shell: false, webSearch: false})).toContain(
      'Shell access is not available'
    )
    expect(new Prompts('', '').tools.codeTools).toBeUndefined()
  })

  test('工具定义：只读、参数受限', () => {
    const defs = reviewToolDefinitions()
    expect(defs.map(d => d.name)).toEqual(['read_file', 'list_directory', 'search_code'])
    for (const d of defs) expect((d.parameters as any).additionalProperties).toBe(false)
  })
})
