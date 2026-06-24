/**
 * lint/language-detector.ts - 文件语言检测
 *
 * 根据文件扩展名识别语言。供 orchestrator 在选择工具前使用。
 *
 * 与 src/repo-tree.ts 的 detectLanguage 互不依赖：
 * - repo-tree 的 Language 仅覆盖 dependency-analyzer 需要的几种语言（ts/py/go/java）
 * - 此处的 LintLanguage 覆盖 lint 工具支持的更广泛语言集
 */

export type LintLanguage =
  | 'javascript'
  | 'typescript'
  | 'go'
  | 'python'
  | 'ruby'
  | 'rust'
  | 'java'
  | 'kotlin'
  | 'php'
  | 'css'
  | 'html'
  | 'vue'
  | 'unknown'

/** 扩展名 → 语言映射（含点号） */
const EXTENSION_TO_LANGUAGE: Record<string, LintLanguage> = {
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.go': 'go',
  '.py': 'python',
  '.pyi': 'python',
  '.rb': 'ruby',
  '.rs': 'rust',
  '.java': 'java',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.php': 'php',
  '.css': 'css',
  '.scss': 'css',
  '.less': 'css',
  '.html': 'html',
  '.htm': 'html',
  '.vue': 'vue'
}

/**
 * 根据文件路径检测语言
 *
 * @param filename 文件路径（相对或绝对均可）
 * @returns 语言枚举值（无法识别时为 'unknown'）
 */
export function detectLintLanguage(filename: string): LintLanguage {
  const lower = filename.toLowerCase()
  const dotIdx = lower.lastIndexOf('.')
  if (dotIdx === -1) return 'unknown'
  const ext = lower.substring(dotIdx)
  return EXTENSION_TO_LANGUAGE[ext] ?? 'unknown'
}

/**
 * 检查文件是否属于给定的语言集合
 */
export function isLanguageSupported(
  filename: string,
  supportedLanguages: string[]
): boolean {
  const lang = detectLintLanguage(filename)
  if (lang === 'unknown') return false
  return supportedLanguages.includes(lang)
}

/**
 * 按语言对文件分组
 */
export function groupFilesByLanguage(
  files: string[]
): Map<LintLanguage, string[]> {
  const groups = new Map<LintLanguage, string[]>()
  for (const f of files) {
    const lang = detectLintLanguage(f)
    if (lang === 'unknown') continue
    const list = groups.get(lang) ?? []
    list.push(f)
    groups.set(lang, list)
  }
  return groups
}
