# 迭代三：Linter/SAST 工具集成 — 技术实现文档

> **对应产品计划**: `codesentinel-docs/docs/product-plan/05-iteration-linter-sast.md`
>
> **实现位置**: `ai-reviewer/src/lint/`
>
> **交付范围**: Phase 1（JavaScript / TypeScript）+ 可扩展工具集成框架

---

## 1. 设计目标回顾

让 AI 审查结果与静态分析工具结果**交叉验证**：工具命中的问题由 AI 解释业务影响；
工具盲区由 AI 补充逻辑/架构问题；最终评论中标注交叉验证状态。

要点：

- **可扩展**：新增语言工具仅需实现 `ToolAdapter` 接口
- **失败容忍**：单个工具不可用/超时/抛异常都不阻塞整体审查
- **变更行聚焦**：扫描整个文件，但只保留变更行 ± N 行内的发现
- **零额外依赖**：不引入新的 npm 包（YAML 解析复用 `js-yaml`）

---

## 2. 模块结构

```
src/lint/
├── types.ts                # LintResult / ToolAdapter / ToolConfig 等核心类型
├── language-detector.ts    # 文件扩展名 → 语言枚举
├── diff-filter.ts          # 变更行提取 + 结果过滤 + 跨工具去重
├── config.ts               # .codesentinel.yaml 解析
├── orchestrator.ts         # 工具编排：检测 → 选择 → 并行扫描 → 聚合
├── formatter.ts            # 三种输出：Prompt 注入 / PR 摘要表 / 评论标注
├── index.ts                # 对外公开 API
└── adapters/
    ├── exec.ts             # 共享：execFile + JSON 解析 + 版本提取
    ├── eslint.ts           # ESLint 适配器
    ├── biome.ts            # Biome 适配器
    └── prettier.ts         # Prettier 适配器
```

集成点：`src/review.ts` 在 Phase 0b 调用 orchestrator，结果注入 Phase 4 的逐文件审查 Prompt。

---

## 3. 工作流总览

```
                        codeReview() 主流程
                              │
   ┌──────────────────────────┼──────────────────────────┐
   │                          │                          │
   ▼                          ▼                          ▼
Phase 0  增量 diff       Phase 0b  Lint 扫描         Phase 0  依赖分析
 解析 hunk                runLintTools()              analyzeDependencies()
                              │
                              ▼
                       LintReport（results + summaries）
                              │
   ┌──────────────────────────┼──────────────────────────┐
   │                          │                          │
   ▼                          ▼                          ▼
Phase 4 doReview()       PR 摘要评论              逐评论标注
注入 $lint_context       formatLintSummary()       formatToolAttribution()
formatLintContextForFile()
```

### 3.1 详细数据流

```
PR 变更文件列表 (filesAndChanges)
   │
   │ [filename, fileContent, fileDiff, patches[]]
   ▼
┌──────────────────────────────────────────────────────────────────┐
│ 1) loadConfig(repoRoot)                                          │
│    读取 .codesentinel.yaml → ToolsConfig                         │
└──────────────────────────────────────────────────────────────────┘
   │
   ▼
┌──────────────────────────────────────────────────────────────────┐
│ 2) 适配器注册表                                                    │
│    [ESLintAdapter, BiomeAdapter, PrettierAdapter]                │
│      ↓ isToolEnabled(name, ToolsConfig, defaultEnabled)          │
│    enabledAdapters                                               │
└──────────────────────────────────────────────────────────────────┘
   │
   ▼  Promise.all（并行检测）
┌──────────────────────────────────────────────────────────────────┐
│ 3) safeDetect → ToolDetection                                    │
│    跑 `npx <tool> --version`，超时 10s，失败转为 available=false   │
└──────────────────────────────────────────────────────────────────┘
   │
   ▼  Promise.all（并行扫描）
┌──────────────────────────────────────────────────────────────────┐
│ 4) 每个可用工具：                                                  │
│    a. 按 fileExtensions 过滤目标文件                              │
│    b. adapter.scan(targets, repoRoot, toolConfig)                │
│    c. 异常 → 警告 + 视为 0 个发现                                  │
│    → LintResult[] (raw)                                          │
└──────────────────────────────────────────────────────────────────┘
   │
   ▼
┌──────────────────────────────────────────────────────────────────┐
│ 5) 合并 / 过滤 / 排序                                              │
│    a. buildChangedLineMap(filesAndChanges)                       │
│       从每个文件的 unified diff 中提取 + 行号                     │
│    b. filterByChangedLines(allResults, map, tolerance=3)         │
│       仅保留 |line - changed| ≤ 3 的发现                          │
│    c. deduplicateResults(filtered)                               │
│       归一化规则名 + message 前 50 字符 → 跨工具去重               │
│       同位置同问题保留更高 severity                                │
│    d. sort by (file, line)                                       │
└──────────────────────────────────────────────────────────────────┘
   │
   ▼
LintReport {
  results: LintResult[],         // 已过滤 / 去重 / 排序
  toolSummaries: ToolSummary[],  // 每个工具的统计与可用性
  durationMs, filesScanned
}
```

### 3.2 评论生成阶段

```
Phase 4 doReview(filename, fileContent, patches)
   │
   ▼
formatLintContextForFile(filename, lintReport)
   │   过滤 results 仅保留 file === filename
   │   按工具分组、生成 "🧰 Tools / 🪛 ESLint (9.x.x)" Markdown
   │   截断到 4000 字符
   │
   ▼
inputs.lintContext = ctx   →  prompts.reviewFileDiff
                              用 $lint_context 占位符替换
   │
   ▼
heavyBot.chat(prompt)
   │
   ▼
parseReview(response, patches)
   │  → review { startLine, endLine, comment }
   │
   ▼
formatToolAttribution(filename, startLine, endLine, lintReport)
   │  找出 line 范围与该评论重叠的工具发现
   │  追加到评论尾部："🧰 Tools / 🪛 Biome (2.x) / [error] 29-29: …"
   │
   ▼
commenter.bufferReviewComment(filename, startLine, endLine, finalComment)
```

### 3.3 PR 摘要评论中的工具统计表

`review.ts` 在最终摘要评论里追加：

```
formatLintSummary(lintReport) →
<details>
<summary>🧰 Static Analysis Summary (3 tools)</summary>

_5 findings on changed lines._

| Tool | Errors | Warnings | Files Scanned | Duration |
|:-----|:------:|:--------:|:-------------:|:---------|
| ESLint 9.15.0 | 2 | 3 | 5 | 1234ms |
| Biome 2.3.13 | 1 | 0 | 5 | 432ms |
| Prettier _unavailable_ | _unavailable_ | 0 | command not found |

</details>
```

---

## 4. 核心类型契约

### 4.1 LintResult

所有适配器输出的统一结构。详见 [src/lint/types.ts](../src/lint/types.ts)。

```typescript
interface LintResult {
  tool: string                    // "ESLint" / "Biome" / "Prettier"
  toolVersion: string             // "9.15.0"
  file: string                    // 相对仓库根
  line: number; column: number    // 1-based
  endLine?: number; endColumn?: number
  severity: 'error' | 'warning' | 'info'
  ruleId: string                  // "no-unused-vars"
  message: string
  suggestion?: string
  fixable: boolean
  category?: 'quality' | 'security' | 'style' | 'performance'
}
```

### 4.2 ToolAdapter

```typescript
interface ToolAdapter {
  readonly name: string                    // 配置 key（小写）
  readonly displayName: string             // 用于评论展示
  readonly supportedLanguages: string[]
  readonly fileExtensions: string[]        // 含点号
  readonly defaultEnabled: boolean         // 用户未配置时的默认值

  detect(): Promise<ToolDetection>
  scan(files, repoRoot, config): Promise<LintResult[]>
}
```

适配器只负责"调用工具 + 解析"。所有过滤/合并/去重/格式化由 orchestrator 与 formatter 处理。

---

## 5. 适配器实现要点

| 适配器 | CLI 调用 | 输出解析 | 默认启用 |
|:-------|:---------|:---------|:---------|
| ESLint | `npx eslint --format json --no-error-on-unmatched-pattern <files>` | JSON 数组，每元素 `{filePath, messages[]}` | ✅ |
| Biome  | `npx biome check --reporter=json <files>` | `{diagnostics: [{category, severity, location.line_start, …}]}` | ✅ |
| Prettier | `npx prettier --check --no-error-on-unmatched-pattern <files>` | stderr 中按行匹配 `[warn] <file>` | ❌（默认关闭） |

通用约定：

- `detect()` 跑 `<tool> --version`，超时 10s
- `scan()` 内部不做变更行过滤，原样返回
- 任何执行错误都通过 stdout/exitCode 体现，不抛异常
- 退出码 ≠ 0 不视为失败（lint 工具按惯例发现问题就返回非零）

---

## 6. 用户配置

`.codesentinel.yaml`（仓库根目录）：

```yaml
tools:
  eslint:
    enabled: true
    useProjectConfig: true     # 默认 true，使用项目自带 .eslintrc / eslint.config.js
  biome:
    enabled: true
  prettier:
    enabled: false             # 与 ESLint 重叠时常关闭
  golangci-lint:               # Phase 2 预留
    enabled: true
  ruff:                        # Phase 3 预留
    enabled: true
    select: ["E", "F", "W", "I", "S"]
  semgrep:                     # Phase 4 预留
    enabled: false
```

加载策略（[src/lint/config.ts](../src/lint/config.ts)）：

- 仓库根缺少配置文件 → 全部使用适配器默认值
- YAML 解析失败 → 警告 + 回退默认值
- 单个工具 `enabled` 字段缺失 → 使用适配器 `defaultEnabled`

GitHub Action 输入 `enable_lint_tools`（默认 `true`）是总开关，关闭后整个 Phase 0b 跳过。

---

## 7. 与 review.ts 的集成

[src/review.ts](../src/review.ts) 中新增：

1. **Phase 0b**（依赖分析之前）：
   ```typescript
   if (options.enableLintTools) {
     lintReport = await runLintTools({
       repoRoot: process.cwd(),
       filesAndChanges,
       disabled: false
     })
   }
   ```

2. **Phase 4 `doReview` 内**：
   ```typescript
   if (lintReport != null) {
     const ctx = formatLintContextForFile(filename, lintReport)
     if (ctx.length > 0) ins.lintContext = ctx
   }
   ```

3. **每条评论尾部**：
   ```typescript
   const toolAttribution = formatToolAttribution(
     filename, review.startLine, review.endLine, lintReport
   )
   if (toolAttribution.length > 0) {
     commentWithChain = `${commentWithChain}\n${toolAttribution}`
   }
   ```

4. **最终 PR 摘要评论**：
   ```typescript
   summarizeComment += formatLintSummary(lintReport)
   ```

5. **`Inputs.render()`**：将 `$lint_context` 占位符替换为本次 lint 结果，无值时输出 `"No static analysis tool results available."`。

6. **Prompt 模板**：`prompts.reviewFileDiff` 中新增 `$lint_context` 区块，并在 `## IMPORTANT Instructions` 中加入"静态分析交叉验证（MANDATORY when tool findings exist）"硬性规则，要求 AI：
   - 对每条变更行上的工具发现写一条评论，命名工具并解释业务影响
   - 不同意工具发现时，标注为 false positive 并给出理由
   - 同时仍需指出工具盲区中的逻辑/架构问题

---

## 8. 性能与失败容忍

| 维度 | 措施 |
|:-----|:-----|
| 总耗时 | orchestrator 内 `Promise.all` 并行执行所有可用工具 |
| 单工具超时 | `runCommand` 默认 60 秒（可在适配器内传入 `timeoutMs`） |
| 单工具失败 | 检测失败 → `available=false` 记入 ToolSummary；scan 抛异常 → 警告 + 0 发现 |
| Token 预算 | `formatLintContextForFile` 截断到 4000 字符；不超出后端 token 限制 |
| 缓冲区 | `runCommand` 单次 stdout 上限 64 MB，避免极端大输出 OOM |

---

## 9. 测试

| 测试文件 | 覆盖范围 |
|:---------|:---------|
| [`__tests__/lint-diff-filter.test.ts`](../__tests__/lint-diff-filter.test.ts) | unified diff 行号提取、变更行窗口过滤、跨工具去重（含规则名归一化） |
| [`__tests__/lint-orchestrator.test.ts`](../__tests__/lint-orchestrator.test.ts) | 启用/禁用、不可用工具的 ToolSummary、scan 抛异常的容忍、`disabled=true` 短路 |

执行：`npm test`（与既有 182 个用例合并后总计 194 个用例全部通过）。

---

## 10. 后续扩展（Phase 2 - 5）

新增一种语言的工具支持时：

1. 在 `src/lint/adapters/` 中新增适配器实现 `ToolAdapter`
2. 在 `orchestrator.ts` 的 `defaultAdapters()` 中注册
3. 在 `language-detector.ts` 的 `EXTENSION_TO_LANGUAGE` 中扩展（如已存在可跳过）
4. 在 Docker 镜像层预装对应 CLI（`Dockerfile` 或 GitHub Actions runner setup step）

无需改动 review.ts、prompts.ts、formatter.ts、diff-filter.ts。

| 阶段 | 工具 | 适配器骨架 |
|:-----|:-----|:----------|
| Phase 2 | golangci-lint | `golangci-lint run --out-format=json ./...` → `Issues[]` |
| Phase 3 | Ruff / Bandit | `ruff check --output-format=json` / `bandit -r src/ -f json` |
| Phase 4 | Semgrep | `semgrep scan --json --config=auto` → `results[]` |

---

## 11. 验收对应

| 文档要求 | 实现位置 |
|:---------|:---------|
| 框架可扩展 | `ToolAdapter` 接口 + `orchestrator` 注册表 |
| ESLint / Biome / Prettier 集成 | `src/lint/adapters/*.ts` |
| 变更行过滤 | `diff-filter.ts::filterByChangedLines` |
| 结果注入 LLM Prompt | `Inputs.lintContext` + `$lint_context` 占位符 |
| AI 交叉验证 | `formatToolAttribution` + Prompt 中的 MANDATORY 指令 |
| `.codesentinel.yaml` 配置化 | `config.ts::loadConfig` |
| 性能 ≤ 3 分钟 | 并行执行 + 单工具 60s 默认超时 |
| 错误容忍 | `safeDetect` + scan try/catch + `available=false` 上报 |
