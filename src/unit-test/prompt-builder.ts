/**
 * unit-test/prompt-builder.ts - 测试生成 Prompt 组装
 *
 * 对应迭代四 §2.5「测试生成 Prompt 设计」。
 *
 * 设计要点:
 * - 纯函数，输入 GenerationInput，输出 string（完整 user-side prompt）
 * - 系统消息由 Bot 类侧统一注入，这里只关注业务 prompt
 * - 包含明确的 "OUTPUT REQUIREMENTS"，要求模型仅输出代码（外加可解析的语言围栏）
 */
import type {GenerationInput, SourceLanguage, TestFramework} from './types'

const LANG_FENCE: Record<SourceLanguage, string> = {
  typescript: 'typescript',
  javascript: 'javascript',
  python: 'python',
  go: 'go',
  unknown: ''
}

const FRAMEWORK_HINTS: Record<TestFramework, string> = {
  jest: 'Use Jest. Prefer jest.fn(), jest.useFakeTimers() when timing is involved.',
  vitest: 'Use Vitest with the standard `describe/it/expect` API and `vi.fn()` / `vi.useFakeTimers()`.',
  mocha: 'Use Mocha (describe/it) + Chai (`expect`). Use Sinon for stubs/spies if necessary.',
  pytest: 'Use pytest. Prefer `pytest.raises`, `pytest.mark.parametrize`, monkeypatch fixtures.',
  unittest: 'Use the standard `unittest` module with `TestCase` subclasses.',
  'go-testing': 'Use the standard `testing` package. Table-driven tests are preferred.',
  unknown: 'Pick the most appropriate test framework for the language.'
}

export function buildPrompt(input: GenerationInput): string {
  const {target, framework, projectContext, typeContext, prMeta} = input
  const fence = LANG_FENCE[target.language] || ''
  const langLabel = target.language === 'unknown' ? '' : target.language

  const sections: string[] = []

  sections.push('## Task')
  sections.push(
    `Generate high-quality unit tests for the ${target.kind} \`${target.name}\` defined in \`${target.filePath}\`.`
  )

  sections.push('## Test Framework')
  sections.push(
    `${framework.framework} (confidence: ${framework.confidence}; signals: ${framework.signals.join(', ')}).`
  )
  sections.push(FRAMEWORK_HINTS[framework.framework])

  if (framework.testFilePattern) {
    sections.push(`Test file naming convention: \`${framework.testFilePattern}\`.`)
  }
  if (projectContext.testDirectoryHint) {
    sections.push(`Tests live under: \`${projectContext.testDirectoryHint}/\`.`)
  }
  if (projectContext.patternHint) {
    sections.push(`Existing test pattern: ${projectContext.patternHint}.`)
  }

  sections.push('## Target Source')
  sections.push(codeBlock(target.sourceSnippet ?? '// (source unavailable)', fence))

  if (typeContext.trim()) {
    sections.push('## Type / Import Context')
    sections.push(codeBlock(typeContext, fence))
  }

  if (projectContext.sampleTestSnippets.length > 0) {
    sections.push('## Existing Test Style Sample(s)')
    for (const s of projectContext.sampleTestSnippets) {
      sections.push(`From \`${s.path}\`:`)
      sections.push(codeBlock(s.content, fence))
    }
  }

  sections.push('## PR Metadata')
  sections.push(`- Title: ${prMeta.title || '(untitled)'}`)
  sections.push(`- Base: ${shortSha(prMeta.baseSha)} → Head: ${shortSha(prMeta.headSha)}`)

  sections.push('## Requirements')
  sections.push(
    [
      '1. Follow the AAA pattern (Arrange / Act / Assert) — one logical assertion per test.',
      '2. Cover the following scenarios where applicable:',
      '   - Happy path with expected inputs.',
      '   - Boundary conditions (empty, zero, very large/small, negative).',
      '   - Error handling for invalid inputs.',
      '   - Asynchronous behaviour (Promises, callbacks, timers) if present.',
      '3. Mock/stub external dependencies; never hit network/filesystem/clock directly.',
      '4. Use descriptive `it`/`test` names that read like English sentences.',
      '5. No magic numbers — use named constants with meaningful identifiers.',
      '6. Do NOT include the source code under test — only the test file body.'
    ].join('\n')
  )

  sections.push('## Output')
  sections.push(
    [
      `Return ONLY the test file content, wrapped in a single fenced code block tagged \`${fence || langLabel}\`.`,
      'Do not include explanations, headings, or surrounding prose.',
      'Imports must reference the source under test by the relative path that the test file would actually use.'
    ].join('\n')
  )

  return sections.join('\n\n')
}

function codeBlock(content: string, fence: string): string {
  return ['```' + fence, content, '```'].join('\n')
}

/** issue_comment 路径下 dispatcher 不会填充 head/base SHA，此处兜底 */
function shortSha(sha: string): string {
  if (!sha) return 'unknown'
  return sha.length > 7 ? sha.slice(0, 7) : sha
}
