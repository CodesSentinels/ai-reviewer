# 迭代三 Linter/SAST 集成 — 设计思路 / 架构 / 数据流

> 与 [06-iteration-linter-sast-design.md](./06-iteration-linter-sast-design.md) 互为补充：
> 06 偏 **实现细节与契约**，本文偏 **设计思路、架构视图、流程图**。
>
> 推荐阅读顺序：06 → 07（细节先于鸟瞰更易消化）。
>
> 本文中的图表使用 [Mermaid](https://mermaid.js.org/) 语法，可在 GitHub / mermaid.live
> 直接渲染。

---

## 第一部分 · 设计思路

### 1.1 问题背景

在迭代三之前，`ai-reviewer` 的代码审查完全依赖 LLM：

- LLM 擅长解释业务影响、捕捉跨文件逻辑问题
- 但 LLM **不可靠**于机械可判定的问题（拼写、类型、规则冲突），且每次推理都消耗 token
- 工具（ESLint / Biome / golangci-lint / Semgrep …）在这些机械问题上**确定性强、零成本**，且社区已积累了海量规则

**两者天然互补**。CodeRabbit 商业版的杀手锏正是 "AI + 40 + 工具" 的双重验证。本迭代要复刻这个能力，并搭好可扩展骨架。

### 1.2 设计目标（按优先级）

| # | 目标 | 度量 |
|:--|:-----|:-----|
| 1 | **可扩展骨架**优先于工具数量 | 新加一种语言工具 ≤ 1 个文件改动 |
| 2 | **失败容忍** | 单工具不可用 / 超时 / 解析失败都不阻塞审查 |
| 3 | **聚焦变更** | 仅保留 PR 变更行 ± N 行内的发现，不全文件刷屏 |
| 4 | **零新增 npm 依赖** | 复用 `js-yaml` / `child_process`，避免供应链负担 |
| 5 | **AI 与工具有机融合** | 工具结果注入 Prompt + 评论尾部标注 + 摘要统计表 |

### 1.3 关键决策与权衡

| 决策点 | 选择 | 备选 | 拒绝备选的原因 |
|:-------|:-----|:-----|:---------------|
| 工具调用方式 | 子进程 `execFile` 调 CLI | 通过 npm API 内嵌 | API 版本耦合、不同语言无统一接口、不便扩展到 Go/Python |
| **工具来源** | ai-reviewer **自带**（沙箱安装到 `/tmp`，多策略 dispatcher） | 要求待审查项目把 lint 工具写入 `package.json` | 项目侧零负担；不必为每个想接 ai-reviewer 的项目都开 PR 加 devDependencies |
| 工具发现 → AI 注入 | Prompt 中**条件**注入（杠杆 A） + 评论尾部标注 | 直接发布工具评论 / 总是注入 | 直接发评论会与 AI 评论错位，且 AI 无法交叉验证；总是注入则在无 finding 文件上浪费 ~300 token |
| 变更行过滤 | 在 orchestrator 里统一做 | 让每个适配器自己做 | 过滤逻辑应一次定义；适配器只关心解析 |
| diff 扫描位置 | 上提到 `src/changed-lines.ts`，`review.ts` 一次扫描全文件，按 `addedLines` / `touchedLines` 分发 | 各模块各扫一遍 | 历史上 review/dep-analyzer/diff-filter 三处都有 walker，是真实的 DRY 问题 |
| 跨工具去重 | 在 orchestrator 里做 | 不去重 | ESLint 与 Biome 大量规则重叠，不去重会出现"同一行两条几乎一样的评论" |
| ~~配置文件~~ **已废弃** | **全部走 GitHub Action 输入** | `.codesentinel.yaml` | 消费方零文件原则；workflow 的 `with:` 块比单独 YAML 更易发现；早期 `.codesentinel.yaml` 已删除 |
| 单工具失败处理 | 记入 ToolSummary，继续 | 整体失败 | "缺一个工具就不审查"对用户体验是灾难 |
| ESLint 项目配置缺失 | `detect()` 检测后标 `available=false`（改进 A） | 让 scan 静默返回 0 finding | ESLint 9 Flat Config 不内置规则；不检查会让用户面对"扫描了 N 文件，0 finding"，无从诊断 |
| Phase 1 范围 | JS/TS（ESLint+Biome+Prettier） | 一次铺开所有语言 | 先把骨架打牢；Phase 2-5 复用骨架 |

### 1.4 明确不做什么（反模式清单）

- ❌ 不实现 AST 级深度分析（交给工具自己）
- ❌ 不引入插件系统/动态加载（YAGNI；Phase 2-5 直接编辑 `defaultAdapters()`）
- ❌ 不做工具结果的"自动修复" patch 应用（迭代三只读不写）
- ❌ ~~不在适配器内做"工具自动安装"~~ → **已转为正向需求**：通过 `tool-installer.ts` 的多策略 dispatcher 在沙箱目录内自动安装，待审查项目侧零负担。Docker 镜像方案被取消，原因见 §1.3 决策表中"工具来源"行。
- ✅ ~~不为每个工具引入单独的 GitHub Action 输入~~ → **已转向**：消费方零文件原则下，每工具一个 `enable_<tool>` 输入是唯一可行的覆盖机制。`.codesentinel.yaml` 与 `src/lint/config.ts` 已删除。

---

## 第二部分 · 系统架构

### 2.1 分层架构图

```mermaid
flowchart TB
  subgraph Entry["GitHub Action 入口 — src/main.ts"]
    OPTS["读取 enable_lint_tools 等输入<br/>构建 Options"]
  end

  subgraph Review["审查主流程编排层 — src/review.ts"]
    P0["Phase 0<br/>依赖分析"]
    P0B["Phase 0b<br/>Lint 扫描"]
    P123["Phase 1-3<br/>摘要 / 合并 / 发布说明"]
    P4["Phase 4<br/>逐文件审查"]
  end

  subgraph Lint["Lint 集成层 — src/lint/"]
    direction TB
    API["对外 API<br/>index.ts"]

    subgraph Core["核心模块"]
      direction LR
      ORCH["orchestrator.ts<br/>主控逻辑"]
      FMT["formatter.ts<br/>三种输出格式"]
      DF["diff-filter.ts<br/>变更行 / 去重"]
      LD["language-detector.ts"]
      TS["types.ts"]
    end

    subgraph Adapters["适配器层 — adapters/"]
      direction LR
      EXEC["exec.ts<br/>共享 CLI 封装"]
      ES["EslintAdapter"]
      BI["BiomeAdapter"]
      TS["TscAdapter<br/>(类型错误)"]
      PR["PrettierAdapter<br/>(默认关闭)"]
    end
  end

  subgraph Sandbox["沙箱目录 /tmp/ai-reviewer-lint-tools/<br/>(由 tool-installer.ts 自管，待审查项目侧零负担)"]
    direction LR
    CLI1["node_modules/.bin/eslint<br/>--format json"]
    CLI2["node_modules/.bin/biome check<br/>--reporter=json"]
    CLI3["node_modules/.bin/prettier<br/>--check"]
  end

  Entry --> Review
  P0B --> API
  API --> Core
  API --> Adapters
  ES --> EXEC
  BI --> EXEC
  PR --> EXEC
  EXEC --> CLI1
  EXEC --> CLI2
  EXEC --> CLI3
  P4 -. "formatLintContextForFile<br/>formatToolAttribution" .-> FMT
  Review -. "formatLintSummary" .-> FMT
```

### 2.2 组件职责矩阵（高内聚、低耦合）

| 组件 | 职责（做） | 不做 |
|:-----|:-----------|:-----|
| `types.ts` | 定义所有共享类型 | 任何运行逻辑 |
| `language-detector.ts` | 文件 → 语言枚举 | 工具选择（交给 orchestrator） |
| `diff-filter.ts` | 提取变更行 / 过滤 / 跨工具去重 | 调用工具、IO |
| `orchestrator.ts` | 编排：按 Action 输入选工具 → 跑工具 → 汇总 | 输出格式、Prompt 集成 |
| `formatter.ts` | 三种输出文本生成 | 任何 IO 或工具调用 |
| `adapters/exec.ts` | 子进程封装 + 解析辅助 | 知道任何具体工具 |
| `adapters/<tool>.ts` | 调单个 CLI + 解析输出 → LintResult | 过滤、去重、注入 Prompt |

### 2.3 核心类型契约关系

```mermaid
classDiagram
  class ToolAdapter {
    <<interface>>
    +string name
    +string displayName
    +string[] supportedLanguages
    +string[] fileExtensions
    +bool   defaultEnabled
    +detect() Promise~ToolDetection~
    +scan(files, repoRoot, config) Promise~LintResult[]~
  }

  class EslintAdapter {
    -string resolvedVersion
    +detect() Promise~ToolDetection~
    +scan() Promise~LintResult[]~
  }
  class BiomeAdapter {
    -string resolvedVersion
    +detect() Promise~ToolDetection~
    +scan() Promise~LintResult[]~
  }
  class TscAdapter {
    -string resolvedVersion
    +detect() Promise~ToolDetection~
    +scan() Promise~LintResult[]~
  }
  class PrettierAdapter {
    -string resolvedVersion
    +detect() Promise~ToolDetection~
    +scan() Promise~LintResult[]~
  }

  class ToolDetection {
    +bool   available
    +string version
    +string reason
  }

  class LintResult {
    +string tool
    +string toolVersion
    +string file
    +int    line
    +int    column
    +int    endLine
    +int    endColumn
    +string severity
    +string ruleId
    +string message
    +bool   fixable
    +string category
  }

  class ToolSummary {
    +string tool
    +string toolVersion
    +bool   available
    +string unavailableReason
    +int    errors
    +int    warnings
    +int    infos
    +int    filesScanned
    +int    durationMs
  }

  class LintReport {
    +LintResult[]    results
    +ToolSummary[]   toolSummaries
    +int             durationMs
    +int             filesScanned
  }

  class ChangedLineMap {
    +Map~string, Set~int~~ changedLines
  }

  ToolAdapter <|.. EslintAdapter   : implements
  ToolAdapter <|.. BiomeAdapter    : implements
  ToolAdapter <|.. TscAdapter      : implements
  ToolAdapter <|.. PrettierAdapter : implements

  ToolAdapter ..> ToolDetection    : detect() returns
  ToolAdapter ..> LintResult       : scan() produces

  LintReport "1" o-- "*" LintResult
  LintReport "1" o-- "*" ToolSummary
```

### 2.4 与既有系统的集成点

| 既有模块 | 改动 | 性质 |
|:---------|:-----|:-----|
| `src/review.ts` | 新增 Phase 0b 调 `runLintTools`；评论尾部追加 `🧰 Tools`；摘要尾部追加统计表 | 加法，无破坏 |
| `src/inputs.ts` | 新增字段 `lintContext`；`render()` 处理 `$lint_context` 占位符 | 加法，构造函数尾部参数 |
| `src/prompts.ts` | `reviewFileDiff` 模板中插入 `## Static analysis tool results` 区块 + MANDATORY 指令 | 加法 |
| `src/options.ts` | 新增 `enableLintTools` | 加法 |
| `src/main.ts` | 读取 `enable_lint_tools` 输入 | 加法 |
| `action.yml` | 新增同名输入，默认 `true` | 加法 |

> 🔑 **没有任何字段被删除/重命名**，因此对旧 workflow 完全向后兼容。

---

## 第三部分 · 数据流转

### 3.1 端到端主流程（从触发到 PR 评论）

```mermaid
flowchart TD
  WH["GitHub Webhook<br/>pull_request"] --> MAIN["main.ts<br/>构建 Options<br/>(enable_lint_tools=true)"]
  MAIN --> CR["review.ts :: codeReview()"]
  CR --> DIFF["拉 incrementalDiff<br/>+ targetBranchDiff"]
  DIFF --> PFILT["路径过滤<br/>(path_filters)"]
  PFILT --> PARSE["解析每文件 hunk"]
  PARSE --> FAC["filesAndChanges =<br/>[(filename, content,<br/>fileDiff, patches), ...]"]

  FAC --> P0B["Phase 0b<br/>runLintTools()"]
  FAC --> P0["Phase 0<br/>analyzeDependencies()"]

  P0B --> LR["LintReport"]
  P0 --> DC["DependencyContext"]

  LR --> P123["Phase 1-3<br/>摘要 / 合并 / 发布说明"]
  DC --> P123

  P123 --> P4["Phase 4<br/>doReview() 并行"]

  subgraph Loop["for each filename"]
    direction TB
    L1["ins.lintContext =<br/>formatLintContextForFile()"]
    L2["ins.crossFileContext = ..."]
    L3["heavyBot.chat(prompt)"]
    L4["parseReview(response)"]
    L5["formatToolAttribution()"]
    L6["bufferReviewComment()"]
    L1 --> L2 --> L3 --> L4 --> L5 --> L6
  end

  P4 --> Loop
  Loop --> SUB["commenter.submitReview()<br/>commenter.comment(SUMMARIZE_TAG)<br/>body 含 formatLintSummary()"]
  SUB --> END["GitHub PR 上的评论"]
```

### 3.2 Phase 0b 内部数据流（runLintTools 详图）

```mermaid
flowchart TD
  IN["filesAndChanges<br/>+ toolEnableOverrides (来自 Action 输入)"] --> S2

  S2["Step 1+2<br/>defaultAdapters() 过滤<br/>overrides[adapter.name] ?? adapter.defaultEnabled"]
  S2 --> S3["Step 3<br/>Promise.all 并行检测<br/>safeDetect(adapter, repoRoot)<br/>· 二进制可用性<br/>· 项目侧前置 (改进 A: ESLint 配置文件)"]

  S3 --> S4["Step 4<br/>Promise.all 并行扫描"]

  subgraph PerTool["每个工具独立 try/catch"]
    direction TB
    T1{"detection.<br/>available?"}
    T1 -->|否| T2["toolSummaries[] += {<br/>available:false, reason }"]
    T1 -->|是| T3["targets =<br/>files.filter(ext ∈ adapter.fileExts)"]
    T3 --> T4{"targets.<br/>empty?"}
    T4 -->|是| T5["跳过 + summary 记 0"]
    T4 -->|否| T6["try adapter.scan()"]
    T6 -->|"throw"| T7["warning + raw=[]"]
    T6 -->|"ok"| T8["raw: LintResult[]"]
    T7 --> T9["countSeverities()<br/>summary 入账<br/>allResults += raw"]
    T8 --> T9
  end

  S4 --> PerTool
  PerTool --> S5["Step 5<br/>取 addedLines = patchScans.get(file).addedLines<br/>(预扫描结果，orchestrator 不再 walk)"]
  S5 --> S6["Step 6<br/>filterByChangedLines (tolerance = 3)<br/>·使用 review.ts 预扫描的 addedLines<br/>·orchestrator 不再独立 walk diff"]
  S6 --> S7["Step 7<br/>deduplicateResults()<br/>归一化规则名 + 取高 severity"]
  S7 --> S8["Step 8<br/>sort by (file, line)"]
  S8 --> OUT["LintReport {<br/>results, toolSummaries,<br/>durationMs, filesScanned }"]
```

### 3.3 单工具适配器内部时序（以 ESLint 为例）

```mermaid
sequenceDiagram
  autonumber
  participant O as orchestrator
  participant A as EslintAdapter
  participant I as tool-installer.ts
  participant E as exec.ts
  participant CP as child_process

  Note over O,A: 检测阶段（沙箱安装 + 版本校验 + 项目配置检查）
  O->>A: detect(repoRoot)
  A->>I: ensureToolInstalled({kind:'npm', package:'eslint', version:'^9.15.0'})
  alt 沙箱已有 bin（缓存命中）
    I-->>A: { ok:true, binPath:'/tmp/.../node_modules/.bin/eslint' }
  else 首次安装
    I->>E: runCommand("npm install --no-save eslint@^9.15.0", cwd=/tmp/...)
    E->>CP: execFile spawn (~15s)
    CP-->>E: exitCode 0
    E-->>I: { exitCode:0 }
    I-->>A: { ok:true, binPath:'/tmp/.../node_modules/.bin/eslint' }
  end
  A->>E: runCommand(binPath, ['--version'], cwd=repoRoot)
  E->>CP: execFile spawn
  CP-->>E: stdout "v9.15.0"
  E-->>A: { exitCode:0, stdout }
  A->>A: findEslintConfig(repoRoot)
  A-->>O: { available:true, version:"9.15.0" }

  Note over O,A: 扫描阶段（直接调用沙箱内绝对路径）
  O->>A: scan(files, repoRoot, config)
  A->>E: runCommand(binPath, ['--format','json',...files], cwd=repoRoot)
  E->>CP: execFile spawn
  CP-->>E: stdout JSON [{filePath, messages[]}]<br/>exitCode 1 (有问题但合法)
  E-->>A: { exitCode:1, stdout }
  A->>A: parseJsonSafe(stdout)
  loop 每条 message
    A->>A: 构建 LintResult
    A->>A: classifyCategory(ruleId)
    A->>A: toRelativePath(filePath, repoRoot)
  end
  A-->>O: LintResult[]

  Note over O,I: 失败分支
  alt 沙箱安装失败（npm 错误 / 网络不可达）
    I-->>A: { ok:false, reason:"npm install ... failed (exit=1): ..." }
    A-->>O: { available:false, reason:"bundled ESLint install failed: ..." }
  else 项目无 ESLint 配置
    A-->>O: { available:false, reason:"no ESLint config found in repo ..." }
  else 超时
    CP-->>E: SIGTERM (timeout)
    E-->>A: { timedOut:true }
    A-->>O: { available:false, reason:"timeout" }
  end
```

### 3.4 Phase 4 单文件审查的 lint 集成（含杠杆 A 条件注入）

```mermaid
flowchart TD
  A["filename = utils/cart.ts<br/><br/>lintReport.results 含:<br/>· utils/cart.ts:29 ESLint array-callback-return<br/>· utils/cart.ts:29 Biome lint/suspicious/...<br/>· utils/foo.ts:10  (← 不属于本文件)"]
  A --> B["formatLintContextForFile<br/>(filename, lintReport)"]
  B --> C["filter file === filename<br/>group by tool<br/>render Markdown<br/>truncate 4000 chars"]
  C --> D["ins.lintContext = ..."]
  D --> Cond{"ins.lintContext<br/>非空?"}

  Cond -->|"否 (无 finding)"| E1["prompts.renderReviewFileDiff(ins)<br/><br/>$lint_section → ''<br/>$lint_mandatory_instruction → ''<br/><br/>(节省 ~300 token)"]
  Cond -->|"是 (有 finding)"| E2["prompts.renderReviewFileDiff(ins)<br/><br/>$lint_section → 段头 + $lint_context<br/>$lint_mandatory_instruction → 4 条 MANDATORY 规则<br/><br/>$lint_context 由 inputs.render 填入"]

  E1 --> F["heavyBot.chat(prompt)"]
  E2 --> F
  F --> G{LLM 输出}

  G -->|"看到工具发现 + MANDATORY 指令"| H["29-29:<br/>ESLint reports …<br/>The deeper issue is …<br/>---"]

  H --> I["parseReview(response, patches)"]
  I --> J["reviews = [{<br/>startLine:29,<br/>endLine:29,<br/>comment:'...' }]"]

  J --> K["for each review:"]
  K --> L["formatToolAttribution<br/>(filename, 29, 29, lintReport)"]
  L --> M["筛选: file === filename<br/>∧ 行号范围重叠"]
  M --> N["渲染:<br/>🧰 Tools<br/>🪛 ESLint (9.15.0)<br/>[error] 29-29: ...<br/>(array-callback-return)<br/>🪛 Biome (2.3.13)<br/>[error] 29-29: ...<br/>(lint/suspicious/...)"]
  N --> O["finalComment =<br/>review.comment + '\\n' + attribution"]
  O --> P["commenter.bufferReviewComment<br/>(filename, 29, 29, finalComment)"]
```

> 💡 注意：`formatToolAttribution` 直接消费 `lintReport`，**不经过 LLM**，
> 因此即使在"无 finding 走 E1 路径"的文件上，依然能为有发现的其它文件保留
> 评论尾部的 `🧰 Tools` 卡片 — 杠杆 A 只省 prompt token，不省工具标注能力。

### 3.5 失败 / 容错路径

```mermaid
flowchart TD
  A{"options.enableLintTools<br/>是否为 true ?"}
  A -->|否| SKIP["跳过 Phase 0b<br/>日志: 'lint tools disabled by config'"]
  A -->|是| CALL["try { runLintTools(...) }"]

  CALL -->|"整体抛异常"| CATCH["warning<br/>lintReport = null<br/>继续 Phase 0/1/2/3/4"]
  CALL -->|"正常返回"| OK["lintReport: LintReport"]

  OK --> ADAPT["每个适配器独立失败处理"]

  subgraph FailMatrix["单适配器失败矩阵 (orchestrator 内)"]
    direction TB
    M1["detect() throws<br/>→ safeDetect 捕获<br/>→ {available:false, reason}"]
    M2["detect 命令 ENOENT<br/>→ exec 返回 spawnError<br/>→ available:false"]
    M3["detect 超时 (10s)<br/>→ ETIMEDOUT<br/>→ available:false"]
    M3a["改进 A: ESLint 项目无配置<br/>→ findEslintConfig 返回 null<br/>→ available:false<br/>→ reason: 'no ESLint config found in repo …'"]
    M4["scan() throws<br/>→ try/catch 包裹<br/>→ warning + raw=[]"]
    M5["scan 超时 (60s)<br/>→ exec timed out<br/>→ raw=[] (当作 0 发现)"]
    M6["scan stdout 解析失败<br/>→ parseJsonSafe 返回 null<br/>→ raw=[]"]
  end

  ADAPT --> FailMatrix

  FailMatrix --> SUM["每种情况都生成 ToolSummary<br/>= {available, errors, warnings,<br/>filesScanned, durationMs}"]
  SUM --> VIS["用户在 PR 摘要表中<br/>看到具体原因"]

  CATCH --> CONT["剩余 Phase 仍继续运行"]
  SKIP  --> CONT
  VIS   --> CONT
```

### 3.6 配置加载与生效时序（**Action 输入直传，无文件加载**）

> 早期此处描绘 `.codesentinel.yaml` → `loadConfig` → `ToolsConfig` 的多步加载/校验链。
> 当前版本完全移除该机制（`src/lint/config.ts` 已删除），所有开关都通过
> GitHub Action 输入直接传递。

```mermaid
flowchart TD
  WF[".github/workflows/*.yml<br/>with: enable_eslint: true / false ..."] --> ACT["action.yml 默认值<br/>+ 用户 with: 覆盖"]
  ACT --> M["main.ts<br/>getBooleanInput('enable_eslint') 等 4 个"]
  M --> O["Options.toolEnableOverrides<br/>{eslint: true, biome: true, tsc: true, prettier: false}"]
  O --> R["review.ts → runLintTools({ toolEnableOverrides })"]
  R --> S["orchestrator filter:<br/>adapters.filter(a => overrides[a.name] ?? a.defaultEnabled)"]
  S --> EN["enabled adapters list"]
  EN --> SC["adapter.scan(files, repoRoot)<br/>无 ToolConfig 参数，工具特定选项暂未启用"]
  SC --> RES["LintResult[]"]
```

> 💡 全链路只有 6 个节点 —— 没有 YAML 文件、没有 schema 校验、没有 fallback 树。
> 适配器若需要工具特定选项（如未来 Ruff 规则集），将通过新增 `_<tool>_xxx` 系列
> Action 输入扩展，仍保持消费方零配置文件原则。

### 3.7 单次 diff 扫描的复用拓扑

历史上 `review.ts` / `dependency-analyzer.ts` / `lint/diff-filter.ts` 各自实现了
几乎相同的 unified diff walker。重构后 `src/changed-lines.ts::scanPatch` 单次
walk 同时产出两份语义不同的集合，`review.ts` 在 Phase 0/0b 之前预扫描一次，
两个下游消费者按字段挑取所需。

```mermaid
flowchart TB
  RV["review.ts::codeReview()<br/>（解析 hunk 之后）"]
  RV --> BPS["buildPatchScans(filesAndChanges)<br/>对每文件 fileDiff 调一次 scanPatch"]
  BPS --> PSM["PatchScanMap<br/>file → { addedLines, touchedLines }"]

  PSM -->|"addedLines<br/>(仅 + 行)"| LO["runLintTools({patchScans, ...})<br/>orchestrator 用于 filterByChangedLines"]
  PSM -->|"touchedLines<br/>(+ 与 - 行)"| DA["analyzeDependencies(..., patchScans)<br/>findEnclosingExports 用于<br/>判断作用域内是否被改"]

  LO --> LR["LintReport"]
  DA --> DC["DependencyContext"]
```

> 💡 关键差异：lint 关心"新文件中有哪些行可被工具检查到"（仅 `+`），
> 依赖分析关心"导出函数作用域内有没有任何变更"（`+` 与 `-` 都算）。
> 单次 walk 产出两份集合，比两次 walk 各自产出更经济，也避免了语义漂移。

---

## 第四部分 · 设计回顾

### 4.1 满足的目标

| 目标 | 落地方式 | 证据 |
|:-----|:---------|:-----|
| 可扩展 | `ToolAdapter` 接口 + `defaultAdapters()` 注册表 + 多策略 `installSpec` | Phase 1 已落地 4 个适配器（ESLint/Biome/TypeScript/Prettier）；Phase 2 加 golangci-lint 仅需新增 1 个文件 + 声明 `installSpec.kind = 'binary'` |
| 失败容忍 | 三层 try/catch（safeDetect / scan / runLintTools 整体）+ 改进 A：ESLint 项目无配置时优雅降级 + 沙箱安装失败时优雅降级 | `lint-orchestrator.test.ts` 4 + `lint-eslint-config-detection.test.ts` 7 + `lint-tool-installer.test.ts` 7 |
| **项目侧零负担** | 多策略 `tool-installer.ts` 把 lint 工具装到 ai-reviewer 自管沙箱 `/tmp/ai-reviewer-lint-tools/`；待审查项目无需把工具写入 `package.json`，workflow 也无需 `npm install` 步骤 | `lint-tool-installer.test.ts` 覆盖 npm 策略与 binary 占位 |
| 聚焦变更 | `src/changed-lines.ts::scanPatch` 单次 walk → `review.ts` 预扫描 PatchScanMap → `runLintTools` 与 `analyzeDependencies` 共享 | `lint-diff-filter.test.ts`、`changed-lines.test.ts` 中 added/touched 双语义覆盖通过 |
| 零新增依赖 | 复用 `js-yaml` (require)、`child_process.execFile` | `package.json` 未改 |
| AI ↔ 工具有机融合 | Prompt **条件**注入（杠杆 A） + 评论标注 + 摘要表 三处协同 | `prompts.ts::renderReviewFileDiff` + `formatToolAttribution` + `lint-prompt-injection.test.ts` |

### 4.2 已知局限（留给下一迭代）

1. **Biome 输出位置字段**依赖 2.x 版本的 `line_start`/`column_start`；若 Biome 改版会需要适配
2. **Prettier 仅文件级问题**（行号统一为 1）；若需精确行号要切换到差异比较模式
3. **变更行容忍范围 N=3 写死**；后续可新增一个 `lint_changed_line_tolerance` Action 输入暴露
4. **不并发限制工具数量**；若未来工具数 > 10，需要引入 `pLimit`（与 `openaiConcurrencyLimit` 对齐）
5. **日志级别没有分级**（全部走 `info`/`warning`），后续若调试量大需要分模块日志开关

### 4.3 验收对应

详见 [06-iteration-linter-sast-design.md §11](./06-iteration-linter-sast-design.md) 与
[ai-reviewer-test/docs/07-iteration3-linter-sast-test-case.md §6](../../ai-reviewer-test/docs/07-iteration3-linter-sast-test-case.md)。
