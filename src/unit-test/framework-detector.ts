/**
 * unit-test/framework-detector.ts - 测试框架探测
 *
 * 对应迭代四 §2.3「测试框架检测」。
 *
 * 探测策略（按优先级从高到低）:
 *   1. 配置文件 (vitest.config.* / pytest.ini / pyproject.toml [tool.pytest])
 *   2. 依赖声明 (package.json / Gemfile)
 *   3. 文件模式推断 (*_test.go / *.spec.* / __tests__/*)
 *
 * 设计要点:
 * - 输入: 已读入的"仓库快照"（FrameworkRepoSnapshot），由调用方提供文件存在判断与 package.json 内容
 * - 输出: FrameworkDetection
 * - 探测器不直接做磁盘 IO，便于单元测试
 */
import type {FrameworkDetection, SourceLanguage, TestFramework} from './types'

/** 仓库快照：调用方负责采集，本模块只做"判断" */
export interface FrameworkRepoSnapshot {
  /** 已存在的文件路径集合（相对仓库根） */
  files: Set<string>
  /** 解析过的 package.json（如果存在），合并 dependencies + devDependencies */
  packageJsonDeps?: Record<string, string>
  /** 解析过的 pyproject.toml 顶层文本（用于检测 [tool.pytest]） */
  pyprojectToml?: string
  /** 推荐的源语言提示，影响默认值选择 */
  primaryLanguage?: SourceLanguage
}

const DEFAULTS: Record<SourceLanguage, TestFramework> = {
  typescript: 'jest',
  javascript: 'jest',
  python: 'pytest',
  go: 'go-testing',
  unknown: 'unknown'
}

/** 从快照中探测测试框架 */
export function detectFramework(
  snapshot: FrameworkRepoSnapshot
): FrameworkDetection {
  const signals: string[] = []

  // 1. 配置文件优先（最强信号）
  const configFile = ['vitest.config.ts', 'vitest.config.js', 'vitest.config.mjs']
    .find(p => snapshot.files.has(p))
  if (configFile) {
    signals.push(`config:${configFile}`)
    return {
      framework: 'vitest',
      confidence: 'high',
      signals,
      testFilePattern: '*.test.ts'
    }
  }

  if (snapshot.files.has('jest.config.js') || snapshot.files.has('jest.config.ts')) {
    signals.push('config:jest.config.*')
    return {
      framework: 'jest',
      confidence: 'high',
      signals,
      testFilePattern: '*.test.ts'
    }
  }

  if (snapshot.files.has('pytest.ini')) {
    signals.push('config:pytest.ini')
    return {
      framework: 'pytest',
      confidence: 'high',
      signals,
      testFilePattern: 'test_*.py'
    }
  }

  if (snapshot.pyprojectToml && /\[tool\.pytest/.test(snapshot.pyprojectToml)) {
    signals.push('config:pyproject.toml [tool.pytest]')
    return {
      framework: 'pytest',
      confidence: 'high',
      signals,
      testFilePattern: 'test_*.py'
    }
  }

  // 2. 依赖声明（中等信号）
  const deps = snapshot.packageJsonDeps ?? {}
  if (deps['vitest']) {
    signals.push('dep:vitest')
    return {
      framework: 'vitest',
      confidence: 'medium',
      signals,
      testFilePattern: '*.test.ts'
    }
  }
  if (deps['jest'] || deps['ts-jest'] || deps['@types/jest']) {
    signals.push('dep:jest')
    return {
      framework: 'jest',
      confidence: 'medium',
      signals,
      testFilePattern: '*.test.ts'
    }
  }
  if (deps['mocha']) {
    signals.push('dep:mocha')
    return {
      framework: 'mocha',
      confidence: 'medium',
      signals,
      testFilePattern: 'test/**/*.spec.js',
      assertionLibrary: deps['chai'] ? 'chai' : undefined
    }
  }

  // 3. 文件模式推断（弱信号）
  for (const f of snapshot.files) {
    if (/_test\.go$/.test(f)) {
      signals.push(`pattern:*_test.go`)
      return {
        framework: 'go-testing',
        confidence: 'medium',
        signals,
        testFilePattern: '*_test.go'
      }
    }
    if (/^test_[^/]+\.py$/.test(f) || /\/test_[^/]+\.py$/.test(f)) {
      signals.push('pattern:test_*.py')
      return {
        framework: 'pytest',
        confidence: 'low',
        signals,
        testFilePattern: 'test_*.py'
      }
    }
    if (/\.(test|spec)\.(t|j)sx?$/.test(f)) {
      signals.push('pattern:*.test.ts')
      return {
        framework: 'jest',
        confidence: 'low',
        signals,
        testFilePattern: '*.test.ts'
      }
    }
  }

  // 4. 兜底：按语言默认
  const lang = snapshot.primaryLanguage ?? 'unknown'
  signals.push(`default-by-lang:${lang}`)
  return {
    framework: DEFAULTS[lang],
    confidence: 'low',
    signals
  }
}
