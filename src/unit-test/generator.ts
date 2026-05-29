/**
 * unit-test/generator.ts - LLM 测试代码生成调用层
 *
 * 对应迭代四 §2.1「LLM 生成 / 后处理」步骤。
 *
 * 职责:
 * - 接收 GenerationInput[]，分目标顺序调用 LLM
 * - 每个目标独立维护 conversation id（避免污染）
 * - 调用 post-processor 完成静态校验与代码抽取
 * - 失败/截断的目标进入 skipped 列表，不中断整体流程
 *
 * 与 Bot 的集成:
 * - 通过依赖注入接收一个 `chat(prompt, ids) => Promise<[text, ids, steps]>`
 *   形态的对话函数，便于单测替换为 stub。
 */
import {info, warning} from '@actions/core'
import {buildPrompt} from './prompt-builder'
import {postProcess} from './post-processor'
import {resolveTestPath} from './test-path-resolver'
import type {
  GeneratedTest,
  GenerationInput,
  GenerationRunResult
} from './types'

/** 与 bot.ts Bot.chat 的最小契约 */
export type ChatFn = (
  message: string,
  ids: {previousResponseId?: string}
) => Promise<[string, {previousResponseId?: string}, unknown]>

export interface GeneratorOptions {
  /** 是否存在 __tests__/ 目录（影响测试文件路径） */
  hasUnderscoreTests?: boolean
  /** 是否存在 tests/ 目录（影响 Python 测试路径） */
  hasTestsDir?: boolean
  /** 单次运行最多生成多少个目标的测试，防止 Token 爆炸 */
  maxTargets?: number
}

/** 按顺序为每个目标生成测试 */
export async function generateTests(
  inputs: GenerationInput[],
  chat: ChatFn,
  opts: GeneratorOptions = {}
): Promise<GenerationRunResult> {
  const result: GenerationRunResult = {
    tests: [],
    skipped: [],
    warnings: []
  }

  const maxTargets = opts.maxTargets ?? 10
  if (inputs.length === 0) {
    result.warnings.push('未在 PR 变更中识别出可生成测试的函数/类')
    return result
  }
  if (inputs.length > maxTargets) {
    result.warnings.push(
      `识别到 ${inputs.length} 个目标，超过单次上限 ${maxTargets}，仅处理前 ${maxTargets} 个`
    )
  }

  const limited = inputs.slice(0, maxTargets)
  for (const input of limited) {
    try {
      const prompt = buildPrompt(input)
      info(
        `unit-test/generator: generating tests for ${input.target.kind} ${input.target.name} in ${input.target.filePath}`
      )
      // 每个 target 独立对话上下文，避免相互污染
      const [raw] = await chat(prompt, {})
      const post = postProcess(raw, input.target.language, input.framework.framework)

      if (!post.code) {
        result.skipped.push({
          target: input.target,
          reason: post.staticCheckError ?? '生成代码为空'
        })
        continue
      }

      const test: GeneratedTest = {
        target: input.target,
        framework: input.framework.framework,
        code: post.code,
        caseCount: post.caseCount,
        passedStaticCheck: post.passedStaticCheck,
        staticCheckError: post.staticCheckError,
        suggestedTestPath: resolveTestPath(
          input.target.filePath,
          input.target.language,
          input.framework.framework,
          {
            hasUnderscoreTests: opts.hasUnderscoreTests,
            hasTestsDir: opts.hasTestsDir
          }
        )
      }
      result.tests.push(test)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      warning(
        `unit-test/generator: failed for ${input.target.name}: ${msg}`
      )
      result.skipped.push({target: input.target, reason: msg})
    }
  }

  return result
}
