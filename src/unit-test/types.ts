/**
 * unit-test/types.ts - 单元测试自动生成相关共享类型
 *
 * 对应迭代四（06-iteration-unit-testing.md）。
 *
 * 设计原则:
 * - 所有跨模块的数据结构集中在本文件
 * - 与命令框架（commands/types.ts）解耦：单元测试引擎不直接依赖命令上下文
 * - delivery 方式通过 DeliveryMode 字面量枚举表达
 */

/** 三种交付方式 */
export type DeliveryMode = 'comment' | 'commit' | 'pr'

/** 支持的源代码语言（首期范围，见 §6） */
export type SourceLanguage =
  | 'javascript'
  | 'typescript'
  | 'python'
  | 'go'
  | 'unknown'

/** 支持的测试框架 */
export type TestFramework =
  | 'jest'
  | 'vitest'
  | 'mocha'
  | 'pytest'
  | 'unittest'
  | 'go-testing'
  | 'unknown'

/** 测试目标类型 */
export type TargetKind = 'function' | 'class' | 'method' | 'module'

/** 从 PR diff 中抽取出的单个测试目标 */
export interface TestTarget {
  /** 目标名（函数/类/方法名） */
  name: string
  /** 目标种类 */
  kind: TargetKind
  /** 所在源文件相对仓库根路径 */
  filePath: string
  /** 源语言 */
  language: SourceLanguage
  /** 在 diff 中是否为新增；否则为修改 */
  isNew: boolean
  /** 目标完整源代码（不仅 diff，含上下文） */
  sourceSnippet?: string
  /** 在文件中的起止行（如能确定） */
  startLine?: number
  endLine?: number
  /** 优先级（P0/P1，对应文档 2.2） */
  priority: 'P0' | 'P1' | 'P2'
}

/** 框架探测结果 */
export interface FrameworkDetection {
  framework: TestFramework
  /** 检测置信度（来源越具体越高） */
  confidence: 'high' | 'medium' | 'low'
  /** 探测到的依据，用于日志/反馈 */
  signals: string[]
  /** 检测出的命名规范 */
  testFilePattern?: string
  /** 推荐的断言库（若与框架默认不同） */
  assertionLibrary?: string
}

/** 项目测试上下文（已有测试样例 / 命名 / 目录） */
export interface ProjectTestContext {
  /** 同模块或同包内的已有测试文件路径（最多 N 条） */
  sampleTestFiles: string[]
  /** 样例测试文件原文（用于风格参考），最多 1-2 段 */
  sampleTestSnippets: Array<{path: string; content: string}>
  /** 测试目录推断（__tests__ / test / tests） */
  testDirectoryHint?: string
  /** 测试结构模式 (AAA / BDD / 简单) — 仅推断展示 */
  patternHint?: string
}

/** 单个测试用例生成上下文（输入给 LLM） */
export interface GenerationInput {
  target: TestTarget
  framework: FrameworkDetection
  projectContext: ProjectTestContext
  /** 与目标相关的类型定义/接口/常量片段 */
  typeContext: string
  /** 当前 PR 元信息，用于在 prompt 中标注 */
  prMeta: {
    title: string
    headSha: string
    baseSha: string
  }
}

/** LLM 返回值经后处理后的产物 */
export interface GeneratedTest {
  target: TestTarget
  framework: TestFramework
  /** 生成的测试源代码（已去除 markdown 围栏） */
  code: string
  /** 测试函数/用例数（启发式统计，用于覆盖度展示） */
  caseCount: number
  /** 是否通过基础语法校验 */
  passedStaticCheck: boolean
  /** 校验未通过的原因（若有） */
  staticCheckError?: string
  /** 推断的目标测试文件路径 */
  suggestedTestPath: string
}

/** 完整生成流程的运行结果 */
export interface GenerationRunResult {
  /** 已生成的测试集 */
  tests: GeneratedTest[]
  /** 跳过/失败的目标，附原因 */
  skipped: Array<{target: TestTarget; reason: string}>
  /** 全局警告（如 token 截断、上下文不足等） */
  warnings: string[]
}

/** Delivery 输入 */
export interface DeliveryInput {
  owner: string
  repo: string
  prNumber: number
  headSha: string
  baseSha: string
  /** 提交到 PR 分支或创建新 PR 时使用的源分支 */
  branch?: string
  run: GenerationRunResult
  /** 触发该命令的评论 ID，用于回复 */
  triggerCommentId: number
}

/** Delivery 输出 */
export interface DeliveryOutcome {
  mode: DeliveryMode
  /** 成功完成数（评论数 / 提交文件数 / 创建 PR 数） */
  succeeded: number
  /** 失败/跳过原因 */
  errors: string[]
  /** mode=pr 时填充新 PR 链接 */
  newPrUrl?: string
  /** mode=commit 时填充 commit SHA */
  commitSha?: string
}
