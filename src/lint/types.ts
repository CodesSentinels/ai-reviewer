/**
 * lint/types.ts - Linter/SAST 工具集成的核心类型定义
 *
 * 定义所有工具适配器共享的统一接口和数据结构：
 * - LintResult: 所有工具输出的统一格式
 * - ToolAdapter: 适配器接口契约
 * - ToolConfig: 单个工具的用户配置
 * - ToolsConfig: 整体工具配置（来自 .codesentinel.yaml）
 *
 * 设计原则：
 * - 与 dependency-analyzer 类似，采用纯数据接口 + 函数式编排，便于单元测试
 * - 适配器只负责"调用工具 + 解析输出"，所有过滤/合并/格式化逻辑放在 orchestrator
 */

/** 单条 Lint/SAST 结果 */
export interface LintResult {
  /** 工具名称，如 "ESLint"、"Biome" */
  tool: string
  /** 工具版本，如 "9.15.0" */
  toolVersion: string
  /** 文件路径（相对仓库根） */
  file: string
  /** 起始行号（1-based） */
  line: number
  /** 起始列号（1-based） */
  column: number
  /** 结束行号（默认与 line 相同，单行问题） */
  endLine?: number
  /** 结束列号 */
  endColumn?: number
  /** 严重等级 */
  severity: 'error' | 'warning' | 'info'
  /** 规则 ID，如 "no-unused-vars" */
  ruleId: string
  /** 问题描述 */
  message: string
  /** 修复建议（自然语言） */
  suggestion?: string
  /** 是否可自动修复 */
  fixable: boolean
  /** 分类：quality / security / style / performance */
  category?: 'quality' | 'security' | 'style' | 'performance'
}

/** 工具配置（单个工具） */
export interface ToolConfig {
  /** 是否启用（默认值由适配器决定） */
  enabled?: boolean
  /** 是否使用项目自带的配置文件（如 .eslintrc / biome.json） */
  useProjectConfig?: boolean
  /** 工具特定的扩展配置（如 ruff 的 select 列表） */
  [key: string]: unknown
}

/** 用户工具配置（来自 .codesentinel.yaml 的 tools 区块） */
export interface ToolsConfig {
  [toolName: string]: ToolConfig
}

// ==================== 安装策略（多策略 dispatcher） ====================
//
// 不同语言/工具有不同的发布形态，把"如何获得这个工具的二进制"抽象成一个
// 声明式的 InstallSpec：
//
//   - npm   ：JS/TS 工具（eslint / @biomejs/biome / prettier）
//   - binary：直接从 GitHub Releases 下载预编译压缩包（golangci-lint / ruff /
//             semgrep 等大多数 Phase 2-4 工具）— Phase 2 实现
//   - 后续可加 pip / jar 等
//
// 适配器在自身字段上声明 installSpec，由 src/lint/tool-installer.ts 统一处理：
// 待审查项目无需把工具写入自己的 package.json/devDependencies。

/** npm 包安装策略：调用 `npm install` 把包装到沙箱 node_modules/ */
export interface NpmInstallSpec {
  readonly kind: 'npm'
  /** npm 包名，如 'eslint' / '@biomejs/biome' */
  readonly package: string
  /** 二进制名（出现在 node_modules/.bin/ 下） */
  readonly binName: string
  /** 版本范围，如 '^9.15.0' */
  readonly version: string
}

/**
 * 二进制下载策略（Phase 2+）：从 URL 下载预编译归档并解压
 *
 * 现阶段保留为接口，installer 调用时返回"未实现"。新增 Adapter（如
 * golangci-lint / ruff）时打开实现即可，无需触动 Phase 1 适配器。
 */
export interface BinaryInstallSpec {
  readonly kind: 'binary'
  /**
   * URL 模板，可包含 {version} / {os} / {arch} 占位符。
   * 例：'https://github.com/golangci/golangci-lint/releases/download/v{version}/golangci-lint-{version}-{os}-{arch}.tar.gz'
   */
  readonly urlPattern: string
  readonly version: string
  /** 解压后二进制相对归档根的路径 */
  readonly binPathInArchive: string
  /** （可选）按 os-arch 索引的 sha256 校验值 */
  readonly sha256?: Record<string, string>
}

/** 适配器声明的安装方式 */
export type InstallSpec = NpmInstallSpec | BinaryInstallSpec

/** 工具检测结果 */
export interface ToolDetection {
  /** 工具是否在执行环境中可用 */
  available: boolean
  /** 工具版本（可用时） */
  version?: string
  /** 不可用时的诊断信息 */
  reason?: string
}

/**
 * 工具适配器接口
 *
 * 所有具体工具（ESLint、Biome、Prettier 等）必须实现此接口。
 * 新增语言工具支持时，仅需新增一个实现，并注册到 orchestrator。
 */
export interface ToolAdapter {
  /** 工具名称（唯一标识，与 ToolsConfig 中的 key 对应） */
  readonly name: string

  /** 工具显示名称（用于评论展示） */
  readonly displayName: string

  /** 支持的语言列表，如 ['javascript', 'typescript'] */
  readonly supportedLanguages: string[]

  /** 支持的文件扩展名（含点号），用于快速过滤候选文件 */
  readonly fileExtensions: string[]

  /** 默认是否启用 */
  readonly defaultEnabled: boolean

  /**
   * 工具安装方式声明
   *
   * detect() 内部会调用 `tool-installer.ts::ensureToolInstalled(this.installSpec)`，
   * 把工具装到 ai-reviewer 自管的沙箱目录。**待审查项目无需自行 install。**
   *
   * 多策略 dispatcher 设计 → 参见 types.ts 中 InstallSpec 的注释。
   */
  readonly installSpec: InstallSpec

  /**
   * 检测工具在当前执行环境中是否可用
   *
   * 实现要求：
   * - 调用 `<tool> --version` 或类似命令
   * - 检查项目侧的必要前置（如 ESLint 9 的 `eslint.config.js`），缺失视为不可用
   * - 失败时返回 { available: false, reason }，不抛异常
   * - 限制超时（建议 ≤ 5 秒）
   *
   * @param repoRoot 仓库根目录（绝对路径），用于检查项目侧的工具配置文件
   */
  detect(repoRoot: string): Promise<ToolDetection>

  /**
   * 执行扫描
   *
   * @param files 要扫描的文件列表（绝对路径或相对仓库根的路径）
   * @param repoRoot 仓库根目录（绝对路径）
   * @param config 来自 `.codesentinel.yaml` 的工具配置
   * @returns 扁平化的 LintResult 列表（不做变更行过滤，由 orchestrator 处理）
   */
  scan(
    files: string[],
    repoRoot: string,
    config: ToolConfig
  ): Promise<LintResult[]>
}

/**
 * 单个文件在 diff 中的变更行集合
 *
 * 类型定义已上提到 src/changed-lines.ts；此处 re-export 以保持现有 import 路径兼容。
 */
export type {ChangedLineMap} from '../changed-lines'

/** Lint 阶段最终输出 */
export interface LintReport {
  /** 所有过滤后的 lint 结果（仅包含变更行附近的问题） */
  results: LintResult[]
  /** 各工具的汇总统计 */
  toolSummaries: ToolSummary[]
  /** 总耗时（毫秒） */
  durationMs: number
  /** 扫描的文件数 */
  filesScanned: number
}

/** 单个工具的统计信息 */
export interface ToolSummary {
  tool: string
  toolVersion: string
  /** 该工具是否在本次执行中可用 */
  available: boolean
  /** 不可用原因（available=false 时） */
  unavailableReason?: string
  errors: number
  warnings: number
  infos: number
  filesScanned: number
  /** 工具执行耗时（毫秒） */
  durationMs: number
}
