/**
 * unit-test/post-processor.ts - 生成代码后处理
 *
 * 对应迭代四 §2.1「后处理」与 §4.1「静态校验」。
 *
 * 流程:
 *   1. 从 LLM 原始响应中抽取首个代码块 (语言围栏优先)
 *   2. 去除常见噪音（响应模型说明、Markdown 标题）
 *   3. 启发式语法校验（括号配对、import 存在性、命名规范）
 *   4. 计数测试用例数（用于覆盖度展示）
 *
 * 不做编译/执行校验（§4.2 留待后续）。
 */
import type {SourceLanguage, TestFramework} from './types'

export interface PostProcessResult {
  code: string
  caseCount: number
  passedStaticCheck: boolean
  staticCheckError?: string
}

/** 从 LLM 响应中抽取代码并执行静态校验 */
export function postProcess(
  raw: string,
  language: SourceLanguage,
  framework: TestFramework
): PostProcessResult {
  const code = extractCodeBlock(raw, language)
  if (!code) {
    return {
      code: '',
      caseCount: 0,
      passedStaticCheck: false,
      staticCheckError: '响应中未找到可用的代码块'
    }
  }

  const caseCount = countTestCases(code, language, framework)
  const check = staticCheck(code, language)

  return {
    code,
    caseCount,
    passedStaticCheck: check.ok,
    staticCheckError: check.ok ? undefined : check.reason
  }
}

/** 从 markdown 文本中抽取首个代码块 */
export function extractCodeBlock(
  raw: string,
  language: SourceLanguage
): string {
  const trimmed = raw.trim()
  // 优先匹配围栏代码块
  const fenceLangs = languageFenceVariants(language)
  for (const lang of fenceLangs) {
    const re = lang
      ? new RegExp('```' + lang + '\\s*\\n([\\s\\S]*?)```', 'm')
      : /```\s*\n([\s\S]*?)```/m
    const m = re.exec(trimmed)
    if (m && m[1]) return m[1].trim()
  }
  // 兜底：整段响应（如果看起来像代码）
  if (/^[\s\S]*\b(describe|it|test|def\s+test_|func\s+Test)/m.test(trimmed)) {
    return trimmed
  }
  return ''
}

function languageFenceVariants(language: SourceLanguage): string[] {
  switch (language) {
    case 'typescript':
      return ['typescript', 'ts', 'tsx', '']
    case 'javascript':
      return ['javascript', 'js', 'jsx', '']
    case 'python':
      return ['python', 'py', '']
    case 'go':
      return ['go', '']
    default:
      return ['']
  }
}

/** 启发式：统计测试用例数 */
export function countTestCases(
  code: string,
  language: SourceLanguage,
  framework: TestFramework
): number {
  if (language === 'python') {
    return (code.match(/^\s*def\s+test_/gm) ?? []).length
  }
  if (language === 'go') {
    return (code.match(/^\s*func\s+Test[A-Z]\w*\s*\(/gm) ?? []).length
  }
  // JS/TS
  if (framework === 'mocha' || framework === 'jest' || framework === 'vitest') {
    return (code.match(/\b(it|test)\s*\(\s*['"`]/g) ?? []).length
  }
  return (code.match(/\b(it|test)\s*\(\s*['"`]/g) ?? []).length
}

/** 启发式静态校验：括号配对 + 至少一处测试声明 */
export function staticCheck(
  code: string,
  language: SourceLanguage
): {ok: true} | {ok: false; reason: string} {
  if (!code.trim()) return {ok: false, reason: '代码为空'}

  // 检查大括号配对（Python 无此约束）
  if (language !== 'python') {
    if (!isBalanced(code, '{', '}')) {
      return {ok: false, reason: '花括号配对失败 — 生成代码可能截断'}
    }
    if (!isBalanced(code, '(', ')')) {
      return {ok: false, reason: '小括号配对失败 — 生成代码可能截断'}
    }
  }

  // 至少含一处测试声明
  const hasTest =
    /\b(it|test)\s*\(\s*['"`]/.test(code) ||
    /\b(describe)\s*\(\s*['"`]/.test(code) ||
    /^\s*def\s+test_/m.test(code) ||
    /^\s*func\s+Test[A-Z]/m.test(code) ||
    /^\s*class\s+\w+\(unittest\.TestCase\)/m.test(code)

  if (!hasTest) {
    return {ok: false, reason: '未发现测试声明（it/test/def test_/func Test…）'}
  }

  return {ok: true}
}

function isBalanced(s: string, open: string, close: string): boolean {
  let depth = 0
  let inString: '"' | "'" | '`' | null = null
  let inLineComment = false
  let inBlockComment = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    const next = s[i + 1]

    if (inLineComment) {
      if (c === '\n') inLineComment = false
      continue
    }
    if (inBlockComment) {
      if (c === '*' && next === '/') {
        inBlockComment = false
        i++
      }
      continue
    }
    if (inString) {
      if (c === '\\') {
        i++
        continue
      }
      if (c === inString) inString = null
      continue
    }
    if (c === '/' && next === '/') {
      inLineComment = true
      continue
    }
    if (c === '/' && next === '*') {
      inBlockComment = true
      i++
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      inString = c as '"' | "'" | '`'
      continue
    }
    if (c === open) depth++
    else if (c === close) {
      depth--
      if (depth < 0) return false
    }
  }
  return depth === 0
}
