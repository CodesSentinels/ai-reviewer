# GitHub / GitLab 双平台兼容开发 TODO List

> 文档版本：v2.6
>
> 修订日期：2026-08-03
>
> 范围：仅记录需要修改代码、测试、构建脚本、GitHub workflow 或 `.gitlab-ci.yml`
> 的开发任务
>
> 来源：[双平台兼容实施方案](./github-to-gitlab-migration-plan.md) ｜
> [运行及交互差异](./github-vs-gitlab-runtime-differences.md)

---

## 1. 开发原则

- GitHub 和 GitLab 必须能够分别独立运行，也可以同时启用。
- GitHub adapter 不调用 GitLab API；GitLab adapter 不调用 GitHub API。
- 不跨平台读取或同步 PR/MR、评论、线程、marker、事件和重试状态。
- 保留 GitHub Action、现有 Action inputs、Octokit/GraphQL 和评论命令功能。
- GitLab secret-bearing job 只运行受保护默认分支中的可信代码，不执行 MR head 代
  码或产物。
- 当前项目的 GitHub → GitLab 单向发布属于 workflow 开发范围，但不是 reviewer 的
  运行时依赖。

---

## 2. 开发顺序与门禁

| 顺序 | 工作流                        | 开发门禁                                     |
| ---- | ----------------------------- | -------------------------------------------- |
| 1    | GitHub P0 安全修复            | 不可信 PR 代码无法接触业务密钥               |
| 2    | 共享核心和平台接口            | 业务层不直接读取平台 payload 或调用平台 API  |
| 3    | GitHub adapter 回归           | GitHub-only 全功能通过                       |
| 4    | GitLab adapter 与 trigger CLI | GitLab 单元和契约测试通过                    |
| 5    | 双入口打包和 GitLab CI        | 两个 bundle 可独立启动                       |
| 6    | GitLab 端到端开发验收         | GitLab-only 全功能通过                       |
| 7    | 双平台隔离验收                | 同时启用时互不读写，单平台故障不影响另一平台 |

---

## 3. P0：GitHub Workflow 安全修复

- [ ] `SEC-001` 重构 `.github/workflows/openai-review.yml`，禁止
      `pull_request_target` checkout 并执行 PR head 中的
      Action、`dist/index.js`、依赖或脚本。
- [ ] `SEC-002` 将无密钥 PR head 验证与有评论写权限/模型密钥的 reviewer 执行面分
      离。
- [ ] `SEC-003` 有密钥 reviewer 固定执行 GitHub 默认分支中的可信代码，只把 PR
      diff 和文件内容作为数据读取。
- [ ] `SEC-004` 普通 PR head job 不得获得 `OPENAI_API_KEY`、写权限 PAT、GitLab
      同步 Token 或其他业务密钥。
- [ ] `SEC-005` 有密钥 job 不得执行 PR job 产生的脚本、依赖、插件或可执行
      artifact。
- [ ] `SEC-006` 在 workflow/job 中显式声明最小 `permissions:`。
- [ ] `SEC-007` 为 fork PR、同项目 PR、机器人 PR 和恶意 PR 增加 workflow 安全测
      试。
- [ ] `SEC-008` 增加日志脱敏工具和测试，覆盖 HTTP Header、URL query、异常对象、
      环境变量和 debug 输出。
- [ ] `SEC-009` 将 `Actions-R-Us/actions-tagger@latest` 固定到审核过的 commit
      SHA，或改为仓库内受控脚本。
- [ ] `SEC-010` 盘点并固定除 `SEC-009` 单列项之外的其余外部 GitHub Action 引用：
      优先固定到审核过的 commit SHA；无法固定 SHA 的引用必须有等价的供应链校验和
      升级流程。

### 验收

- [ ] 修改 Action 源码、`dist/index.js`、workflow、package scripts 和依赖的恶意
      PR 无法读取业务密钥。
- [ ] GitHub 自动审查、摘要、行级评论和评论命令仍可正常运行。
- [ ] 安全修复不以删除现有 GitHub 功能代替。

---

## 4. 共享核心与平台抽象

### 4.1 ExecutionContext

> **状态**：✅ 代码已完成（GitHub Issue
> [#62](https://github.com/CodesSentinels/ai-reviewer/issues/62) 跟踪，PR
> [#63](https://github.com/CodesSentinels/ai-reviewer/pull/63) 承载实现
> ，`feat/execution-context` 分支；PR 本身尚未合并 main，Issue #62 状态仍为
> open）
> 。`main.ts`、`command-handler.ts`、`commands/early-reaction.ts`、`review-state.ts`、`repo-tree.ts`、`dependency-analyzer.ts`、`conversation.ts`
> 已迁移。`review.ts`、`commands/dispatcher.ts`、`commenter.ts` 仅做了 `execCtx`
> 签名透传，内部仍保留对 `context`/`repo` 的读取（评估后判定风险过高未随本阶段一
> 并迁移），延后到阶段四处理。

- [x] `ARCH-001` 定义平台无关 `ExecutionContext`。
- [x] `ARCH-002` 上下文至少包含：平台、项目/仓库、PR/MR 编号、事件类型
      、actor、base/head SHA、评论/note/thread ID。
- [x] `ARCH-003` 实现 `GitHubExecutionContext`，兼容现有 GitHub payload 和环境变
      量。
- [x] `ARCH-004` 实现 `GitLabExecutionContext`，支持 MR Hook 和 Note Hook
      payload。
- [x] `ARCH-005` 消除共享业务层对 `GITHUB_EVENT_NAME`、GitHub context 和 GitLab
      原始 payload 字段的直接读取（`review.ts`/`dispatcher.ts`/`commenter.ts` 内
      部仍有残留读取，见上方状态说明，完全消除延后到阶段四）。
- [x] `ARCH-006` payload 缺失、格式错误或事件未知时 fail closed。

### 4.2 ConfigProvider

> **状态**：✅ 核心接口与双平台实现已完成（GitHub Issue
> [#82](https://github.com/CodesSentinels/ai-reviewer/issues/82) 跟踪）
> 。`ConfigProvider` 接口（ARCH-007）、`GitHubConfigProvider`（ARCH-008）
> 、`GitLabConfigProvider`（ARCH-009）、`CONFIG_DEFAULTS` 共享默认值
> 、`validateIntStr`/`validateFloatStr` 数值校验、CFG-002 安全强制覆盖已交付
> 。`main.ts` 已迁移至 `GitHubConfigProvider`，不再直接调用
> `getInput`/`getBooleanInput`。63 项单元测试覆盖双平台默认值一致性、安全覆盖、
> 数值校验边界、ARCH-011 secret 过滤、CFG-003 semgrep 版本对齐、CFG-005 bot 配置
> 透传、CFG-006 未声明输入审计。CFG-005 已完成
> ：`commenter.ts`/`reply.ts`/`review.ts`/`help.ts`/`review-thread.ts` 中的
> `getInput` 已收敛到 `Options` 字段，共享核心不再直读 `@actions/core`。已知缺口
> ：`ConfigError` 在 `main.ts` 中未被 `setFailed` 接住（待修）。

- [x] `ARCH-007` 定义平台无关 `ConfigProvider` 和共享配置 schema。
- [x] `ARCH-008` 实现 `GitHubConfigProvider`，保持现有 `action.yml` inputs、默认
      值和类型转换兼容。
- [x] `ARCH-009` 实现 `GitLabConfigProvider`，读取仓库配置、CI variables 和事件
      上下文。
- [x] `ARCH-010` 明确两平台的配置优先级、必填项、未知字段和错误处理。
- [x] `ARCH-011` 禁止配置输出包含 OpenAI Key、PAT、Trigger token 或其他 secret。
- [x] `CFG-001` **高**：建立面向用户的完整公开配置 schema、GitHub input → GitLab
      配置映射、默认值和敏感性测试，逐项覆盖：
  - 审查行为
    ：`max_files`、`max_review_comments`、`review_simple_changes`、`review_comment_lgtm`、`path_filters`、`disable_review`；
  - 摘要与发布说明
    ：`disable_release_notes`、`summarize`、`summarize_release_notes`；
  - 模型配置
    ：`openai_base_url`、`openai_light_model`、`openai_heavy_model`、`openai_model_temperature`、`openai_retries`、`openai_timeout_ms`、`openai_concurrency_limit`、`system_message`；
  - 输出、交互与诊断
    ：`language`、`command_ack_reaction`、`bot_icon`、`bot_name`、`debug`；
  - 平台无关工具
    ：`enable_web_search`、`enable_dependency_analysis`、`max_dependency_files`；
  - 本地工具：`enable_shell`、`enable_lint_tools`；
  - `enable_eslint`、`enable_biome`、`enable_tsc`、`enable_prettier`、`enable_semgrep`；
  - `eslint_version`、`biome_version`、`tsc_version`、`prettier_version`、`semgrep_version`；
  - `semgrep_config`；
  - GitHub 专用：`bot_github_login`；保留 `github_concurrency_limit` 作为向后兼
    容 input，并规范化为平台 API 并发限制；
  - secret：OpenAI Key、GitHub Token、GitLab PAT 和 Trigger token 只从平台认可的
    secret 来源读取，不进入仓库公开配置。
- [x] `CFG-002` **高**：GitLab secret-bearing trigger 强制覆盖
      `enable_shell=false` 和 `enable_lint_tools=false`；仓库配置、MR payload 和
      Note payload 均不得重新开启。
- [x] `CFG-003` **高**：修复现有 Semgrep 配置漂移：
  - 在 `action.yml` 正式定义 `semgrep_version`（默认 `^1.95.0`），并与 Semgrep
    adapter 和 `CONFIG_DEFAULTS.semgrepVersion` 保持一致；
  - 在 `action.yml` 正式定义 `semgrep_config`，默认值明确为 `p/default`；
  - `main.ts` 只读取已经声明的 Action inputs；
  - 空字符串不得覆盖 `Options`/adapter 的安全默认值；
  - GitHub Action input、GitLab ConfigProvider、`Options`、lint orchestrator 和
    Semgrep adapter 的值保持一致。
- [x] `CFG-004` **中**：定义公开配置到内部规范化字段的转换：
  - `enable_<tool>` 转换为内部 `toolEnableOverrides[tool]`；
  - `<tool>_version` 与唯一的受控默认版本合并后生成内部
    `toolVersionOverrides[tool]`，空字符串不进入 map；
  - `toolEnableOverrides` 和 `toolVersionOverrides` 只作为内部数据结构，不作为
    GitHub/GitLab 面向用户的配置键；
  - 未填写版本时使用 adapter 内置默认版本，空字符串不进入规范化结果
    ；`CONFIG_DEFAULTS.semgrepVersion` 作为唯一默认版本来源供 `action.yml` 和
    GitLabConfigProvider 对齐。
- [x] `CFG-005` **高**：清理共享核心中的 `getInput()`、`getBooleanInput()` 和环
      境变量直读
      ；`review.ts`、`commenter.ts`、`commands/reply.ts`、`commands/handlers/help.ts`、`github/review-thread.ts`
      中的 `getInput` 已收敛到 `Options.botIcon`/`botName`/`botLogin` 字段
      ，`COMMENT_GREETING` 改为 `getCommentGreeting()`/`initBotGreeting()` 延迟
      初始化模式，GitHub 专用读取只保留在 `GitHubConfigProvider` 和
      `octokit.ts`（认证层）。
- [x] `CFG-006` 盘点代码读取但未在 `action.yml` 声明的输入
      ：`debug_resolve_inject_failures` 已在 `action.yml` 正式声明（默认 `'0'`）
      ；`token` 属认证层由 `octokit.ts` 读取，不经过 ConfigProvider；无其他未声
      明输入。

### 4.3 Logger

> **状态**：✅ 代码已完成（GitHub Issue
> [#83](https://github.com/CodesSentinels/ai-reviewer/issues/83) 跟踪）
> 。`src/platform/logger.ts`（接口 + singleton）
> 、`src/platform/github-logger.ts`（GitHubLogger）
> 、`src/platform/gitlab-logger.ts`（GitLabLogger）已交付
> 。`__tests__/logger.test.ts` 10 项单元测试覆盖 singleton、委托、debug 环境变量
> 门控和 ARCH-015 源码回归守卫。

- [x] `ARCH-012` 定义平台无关 `Logger`。
- [x] `ARCH-013` GitHub logger 保留现有 Actions annotation 能力。
- [x] `ARCH-014` GitLab logger 输出脱敏的 job log，不依赖 `@actions/core`。
- [x] `ARCH-015` GitLab-only 启动不得初始化 `@actions/core` 或
      `@actions/github`。

### 4.4 Git 平台接口

> **状态**：接口定义、GitHub adapter、架构测试、遗留迁移已完成（GitHub Issue
> [#86](https://github.com/CodesSentinels/ai-reviewer/issues/86) 跟踪）
> 。`src/platform/git-platform.ts`（IGitPlatform 接口 + 共享类型 +
> GitPlatformError）、`src/platform/github-platform.ts`（GitHubPlatform 实现，含
> GraphQL review-thread 逻辑）已交付。`__tests__/git-platform.test.ts` 29 项单元
> 测试覆盖全部 10 组方法 + 错误语义转换；`__tests__/arch-guard.test.ts` 7 项架构
> 守卫测试。ARCH-018 已完成：9 个遗留文件全部迁移至 `getPlatform()` 调用，
> LEGACY_ALLOWLIST 中不再有 octokit 引用项。ESLint 配置已切换至
> `@typescript-eslint/no-unused-vars`，项目 lint 0 error。
> `batchResolve` P1 修复：`resolveThreads()` 返回 `{failed>0}` 不再被误计为成功，
> 新增 5 条回归测试。剩余 15 个文件仍直接 import `@actions/core`（Logger 迁移目标）
> 或 `@actions/github`（ARCH-005 context 迁移目标）。

- [x] `ARCH-016` 定义 `IGitPlatform` 或等价接口。
- [x] `ARCH-017` 接口覆盖项目、PR/MR、description 读取与条件更新、diff、文件内容
      、顶层评论、行级评论、回复、resolve、reaction 和成员权限。
- [x] `ARCH-018` 将现有 Octokit 调用收敛到 GitHub adapter。（9 个遗留文件已全部
      迁移至 `getPlatform()` 调用，LEGACY_ALLOWLIST 已清除 octokit 引用项）
- [x] `ARCH-019` 将 GitHub GraphQL review-thread 逻辑保留在 GitHub adapter 内。
- [ ] `ARCH-020` 新增以 `@gitbeaker/rest` 为标准客户端的 GitLab REST adapter；只
      有 REST 无法满足时才使用 GitLab GraphQL。
- [x] `ARCH-021` 为 PR number、MR IID、comment/note ID、thread node ID 和
      discussion ID 建立类型边界。
- [x] `ARCH-022` 为分页、429、5xx、超时、404/409 和权限不足定义统一错误语义。
- [x] `ARCH-023` 增加架构测试，阻止共享核心新增直接平台依赖。
- [ ] `ARCH-024` `@gitbeaker/rest` 的实例、请求参数、响应类型和错误类型只能存在
      于 GitLab adapter/客户端层，不得泄露到 `IGitPlatform` 或共享业务核心。

### 4.5 Repository Tree 与跨文件依赖分析

- [x] `DEP-001` **高**：在 `IGitPlatform` 中增加 `listRepositoryTree(ref)` 或等
      价能力；GitLab adapter 使用 Repository Tree API，并支持 recursive 和完整分
      页。（接口已定义，GitLab adapter 实现待 ARCH-020）
- [x] `DEP-002` **高**：保持 `dependency-analyzer` + `repo-tree` 的跨文件依赖分
      析在两个平台语义一致。（测试覆盖：`dep-tree-consistency.test.ts` DEP-002 组）
- [x] `DEP-003` GitHub adapter 使用 Git Tree API 实现 repository tree，保留现有
      recursive 行为；缓存键必须包含
      `platform + project/repository identity + ref`，不得只按 ref 命中。
- [x] `DEP-004` GitLab tree 实现处理空仓库、subgroup 项目、超大仓库、截断响应
      、Unicode 路径和 API 部分失败；两平台均须区分”成功取得空树””响应被截断/不
      完整”和”API 请求失败”，不得统一静默返回空数组。（`gitlab-platform.ts`
      `listRepositoryTree` 已实现；`repo-tree.ts` 移除静默吞错误；测试覆盖：
      `dep-tree-consistency.test.ts` DEP-004 组）
- [x] `DEP-005` 重构 `repo-tree.ts`，移除对 `@actions/core`、`@actions/github`
      和 Octokit 的直接依赖，只保留缓存、过滤、语言识别和 import path 解析。新增
      `TreeFetcher` 接口注入，日志通过 `getLogger()`。GitHub Issue
      [#85](https://github.com/CodesSentinels/ai-reviewer/issues/85) 跟踪。
- [x] `DEP-006` 重构 `dependency-analyzer.ts`，通过平台无关 repository tree/文件
      读取接口获取数据。新增 `FileContentFetcher` 接口注入，28 处日志替换为
      `getLogger()`；`review.ts` 提供 GitHub 适配器。GitHub Issue
      [#85](https://github.com/CodesSentinels/ai-reviewer/issues/85) 跟踪。
- [x] `DEP-007` 保持 `enable_dependency_analysis` 和 `max_dependency_files` 在两
      个平台的配置语义一致。（测试覆盖：`dep-tree-consistency.test.ts` DEP-007 组）
- [x] `DEP-008` 同一 repository tree、changed files 和 diff fixture 在两平台产生
      一致的依赖候选、路径解析、优先级排序和截断结果。（测试覆盖：
      `dep-tree-consistency.test.ts` DEP-008 组）

### 4.6 Entry Orchestrator

> **状态**：✅ 代码已完成（GitHub Issue
> [#84](https://github.com/CodesSentinels/ai-reviewer/issues/84) 跟踪，原缺口
> Issue [#68](https://github.com/CodesSentinels/ai-reviewer/issues/68) 已修复）
> 。`src/platform/orchestrator.ts`（`runOrchestrator` + `dispatchEvent`）和
> `src/platform/exec-ctx-error-handler.ts`（`handleExecCtxError`）已交付
> 。`main.ts` 重写为调用 `runOrchestrator`，`gitlab-trigger.ts` 直接引入
> `exec-ctx-error-handler`（不经过 orchestrator，避免间接拉入 GitHub 依赖）
> 。`__tests__/orchestrator.test.ts` 13 项单元测试 + `gitlab-trigger.test.ts`
> ARCH-015 回归守卫。

- [x] `ARCH-025` 抽取平台无关的运行时编排函数（配置读取 → 构造 ExecutionContext
      → 事件分发 → 调用共享审查/命令核心 → 统一错误处理），供 `main.ts` 和
      `gitlab-trigger.ts` 复用，不各自重复实现。
- [x] `ARCH-026` 统一 `ExecutionContextError` 的处理策略（`unknown_event` → 跳过
      不算失败；其余 → fail closed）为单一函数/模块，两平台入口调用同一实现，日
      志走 Logger 抽象（4.3），不允许分别用不同日志 API 各写一份分支逻辑。
- [x] `ARCH-027` 将
      `pr_opened/pr_synchronize/pr_reopened → codeReview`、`comment_created/review_comment_created → handleCommentEvent`、
      其余 → skip 的事件分发逻辑从 `main.ts` 的 `run()` 中抽出为平台无关函数，供
      GitLab 入口复用。

---

## 5. GitHub 功能兼容开发

### 5.1 Action 入口和输入

- [ ] `GH-001` 保留 `action.yml` 和 `dist/index.js` 入口。
- [ ] `GH-002` 为每个 Action input 建立名称、默认值、类型和敏感性快照测试。
- [ ] `GH-003` 保持 PR opened/synchronize/reopened 自动审查语义。
- [ ] `GH-004` 保持 `issue_comment` 和 `pull_request_review_comment` 入口。
- [ ] `GH-005` 保持 GitHub concurrency/cancel 策略，旧任务不得写入新 PR 状态。

### 5.2 GitHub 评论功能

- [ ] `GH-006` 保持 PR 顶层 summary comment 的查找、创建和更新。
- [ ] `GH-007` 保持行级 review comment 的创建和定位。
- [ ] `GH-008` 保持 review comment reply。
- [ ] `GH-009` 保持 GitHub GraphQL `resolveReviewThread`。
- [ ] `GH-010` 保持 GitHub Reactions API 的 ACK/early reaction。
- [ ] `GH-011` 覆盖 resolved/unresolved thread、分页和部分失败。

### 5.3 GitHub 状态

- [ ] `GH-012` 保持 PR body 中 pause/resume marker。
- [ ] `GH-013` 保持 summary comment 中 reviewed SHA marker。
- [ ] `GH-014` GitHub marker 和幂等键使用 `github:` 命名空间。
- [ ] `GH-015` GitHub adapter 不读取或写入 GitLab marker。

### 5.4 GitHub-only 回归

- [ ] `GH-016` 未提供任何 GitLab URL、PAT、Webhook、Runner 或变量时，GitHub
      Action 可启动。
- [ ] `GH-017` GitLab API 不可达时，GitHub 全功能测试仍通过。

---

## 6. GitLab Trigger CLI 与事件适配

### 6.1 CLI 入口

> **状态**：✅ 代码已完成（GitHub Issue
> [#64](https://github.com/CodesSentinels/ai-reviewer/issues/64) 跟踪；PR
> [#65](https://github.com/CodesSentinels/ai-reviewer/pull/65) 已合并进
> `feat/execution-context` 分支（非 main）；后续以 PR
> [#67](https://github.com/CodesSentinels/ai-reviewer/pull/67) 延续
> ，`feat/gitlab-trigger-cli` 分支，stacked on `feat/execution-context`，尚未合
> 并 main，Issue #64 状态仍为 open；设计文档见
> `docs/tasks/gitlab-trigger-cli-design.md`）。交付
> `src/gitlab-trigger.ts`、`src/gitlab-trigger-validation.ts`、`src/gitlab-trigger-redact.ts` +
> 9 个 fixture + 对应单元/集成测试。成功路径目前只打印摘要日志，不调用模型、不写
> GitLab note/discussion——真正的审查动作需要 `GLAPI-*`（第 7 章），不在本任务范
> 围。`EVENT-006`~`EVENT-021`（MR/Note Hook 具体业务规则）未开始。

- [x] `EVENT-001` 新增 GitLab trigger CLI 源入口。
- [x] `EVENT-002` CLI 从 file-type `TRIGGER_PAYLOAD` 路径读取原始 payload。
- [x] `EVENT-003` CLI 校验 project ID、事件类型、source/target project、MR IID
      和 HEAD SHA。
- [x] `EVENT-004` 无关事件快速成功退出，不调用模型、不写评论。
- [x] `EVENT-005` 所有错误日志脱敏，不输出完整 payload 或 Token。

### 6.2 MR Hook

- [ ] `EVENT-006` 支持 MR 创建事件。
- [ ] `EVENT-007` 支持 MR reopen 事件。
- [ ] `EVENT-008` 支持 MR HEAD SHA 更新事件。
- [ ] `EVENT-009` 标题、label、assignee 等纯元数据更新不调用模型。
- [ ] `EVENT-010` MVP 拒绝 source project 与 target project 不同的 fork MR。
- [ ] `EVENT-011` 同项目 MR 内容仍按不可信数据处理。
- [ ] `EVENT-012` 每次写操作前重新读取当前 MR HEAD；不一致时退出且不写旧结果。
- [ ] `EVENT-013` MR 自动审查幂等键使用
      `gitlab:{project_id}:{mr_iid}:head:{head_sha}`，并与 summary note 中的
      reviewed SHA marker 一起判断；不得依赖未明确进入 `TRIGGER_PAYLOAD` 的
      Webhook Header。

### 6.3 Note Hook

> **已知缺口**：GitHub Issue
> [#66](https://github.com/CodesSentinels/ai-reviewer/issues/66)（open，未修复
> ）——`createGitLabExecutionContext()` 的 `buildFromNoteHook()` 把"note action ≠
> create（正常编辑/删除）"和"payload 真正缺字段"混用同一个
> `missing_required_field` 原因，导致 CLI 对编辑/删除事件 fail closed（非零退出
> ）而非优雅跳过。修复需要拆分出独立的可忽略事件原因，随 `EVENT-016`/`EVENT-017`
> 一并解决。

- [ ] `EVENT-014` 支持 MR 顶层 note 命令。
- [ ] `EVENT-015` 支持 discussion note/reply 命令和对话上下文。
- [ ] `EVENT-016` 只处理 `action=create` 的用户 note。
- [ ] `EVENT-017` 忽略编辑、删除、system note 和非 MR note。
- [ ] `EVENT-018` 忽略 reviewer/PAT 账号自己的 note。
- [ ] `EVENT-019` 不符合严格命令语法的文本不触发命令或模型。
- [ ] `EVENT-020` Note Hook 幂等键固定为
      `gitlab:{project_id}:{mr_iid}:note:{note_id}:create`；只使用
      `TRIGGER_PAYLOAD` body 中可验证的字段，不假定 job 能读取
      `Idempotency-Key`、`X-Gitlab-Event-UUID` 等 Webhook Header。
- [ ] `EVENT-021` 重复 webhook 投递不得重复调用模型或重复回复。

---

## 7. GitLab API Adapter 开发

### 7.1 项目、MR 和仓库内容

- [ ] `GLAPI-001` 按 project ID 或安全编码的项目路径访问 GitLab 项目。
- [ ] `GLAPI-002` 获取 MR 标题、描述、作者、状态、source/target project 和分支。
- [ ] `GLAPI-003` 获取最新 diff version 的 `base_sha`、`head_sha` 和
      `start_sha`。
- [ ] `GLAPI-004` 分页获取 changed files/diffs，处理截断和超大 diff。
- [ ] `GLAPI-005` 按受控 ref/path 读取仓库文件内容。
- [ ] `GLAPI-006` 写操作前检查 MR 仍打开且 HEAD 未变化。

### 7.2 Notes

- [ ] `GLAPI-007` 创建 MR 顶层 summary note。
- [ ] `GLAPI-008` 按平台 marker 查找现有 summary note。
- [ ] `GLAPI-009` 更新既有 summary note，避免重复创建。
- [ ] `GLAPI-010` 创建 help、configuration、pause/resume、命令结果和错误回复
      note。
- [ ] `GLAPI-011` 支持 reviewer 自己创建的 note 的更新/删除。
- [ ] `GLAPI-012` Notes API 覆盖分页、404、权限失败、超时和重试。

### 7.3 Discussions

- [ ] `GLAPI-013` 使用最新 diff version 创建行级 discussion。
- [ ] `GLAPI-014` 正确映射 `old_path/new_path`、`old_line/new_line` 和新增/删除
      文件。
- [ ] `GLAPI-015` 行级位置无法映射时降级为包含文件/行号的顶层 note。
- [ ] `GLAPI-016` 回复指定 discussion。
- [ ] `GLAPI-017` 分页查询 discussions 和 resolved 状态。
- [ ] `GLAPI-018` 使用 Discussions API resolve discussion。
- [ ] `GLAPI-019` 处理旧 diff SHA、已删除 discussion 和部分 resolve 失败。

### 7.4 权限、身份和 Emoji

- [ ] `GLAPI-020` 按用户 ID 查询项目 access level。
- [ ] `GLAPI-021` 权限查询失败时 fail closed。
- [ ] `GLAPI-022` 将 PAT 用户名与命令前缀分开配置。
- [ ] `GLAPI-023` 实现 GitLab Award Emoji ACK；失败不得阻塞核心审查。

### 7.5 API 稳定性

- [ ] `GLAPI-024` 所有 list API 实现并测试分页。
- [ ] `GLAPI-025` 429、5xx 和网络超时使用有上限的退避重试。
- [ ] `GLAPI-026` 401/403 不重试并返回权限诊断。
- [ ] `GLAPI-027` 写操作结合 marker 避免超时重试产生重复内容。
- [ ] `GLAPI-028` 测试 subgroup、URL 编码、Unicode 文件名和重命名文件。
- [ ] `GLAPI-029` 在生产依赖中加入并锁定审核过的 `@gitbeaker/rest` 版本，封装统
      一 GitLab client factory；从受信任配置读取 `host`、PAT 和 timeout，禁止记
      录 token 或带 token 的 URL/Header。
- [ ] `GLAPI-030` GitLab adapter 默认通过 `@gitbeaker/rest` 调用 Projects、Merge
      Requests、Repository Files/Tree、Notes、Discussions、Members 和 Award
      Emoji API。
- [ ] `GLAPI-031` 仅当 `@gitbeaker/rest` 未覆盖所需 REST endpoint 或其行为无法满
      足契约时，才允许在 GitLab adapter 内使用 Node 24 原生 `fetch`；fallback 必
      须复用统一认证、超时、脱敏、分页、重试和错误规范化逻辑，业务层不得直接调用
      `fetch`。
- [ ] `GLAPI-032` 对 `@gitbeaker/rest` 的分页、snake_case 字段、HTTP 状态、超时
      和错误对象建立适配层契约，不能把 SDK 默认行为直接当作 `IGitPlatform` 语义
      。

---

## 8. 审查核心功能开发

### 8.1 自动与增量审查

- [ ] `REVIEW-001` GitHub PR 和 GitLab MR 调用同一共享审查核心。
- [ ] `REVIEW-002` 支持首次审查、增量审查和全量重审所需输入。
- [ ] `REVIEW-003` 只处理最新 HEAD，旧任务不得写摘要或行级评论。
- [ ] `REVIEW-004` 文件过滤、语言、模型、prompt 和忽略规则在两个平台语义一致。
- [ ] `REVIEW-005` 处理超大 diff、二进制、删除文件和无法读取文件。
- [ ] `REVIEW-006` 部分失败时发布明确的部分结果和错误信息。

### 8.2 摘要

- [ ] `REVIEW-007` 自动生成 PR/MR 顶层摘要。
- [ ] `REVIEW-008` 更新既有摘要而不是重复发布。
- [ ] `REVIEW-009` 摘要包含平台隔离的 reviewed SHA marker。
- [ ] `REVIEW-010` `summary` 命令可重新生成摘要。

### 8.3 行级问题

- [ ] `REVIEW-011` 发布 GitHub review comment 和 GitLab diff discussion。
- [ ] `REVIEW-012` 相同位置的未解决问题不重复发布。
- [ ] `REVIEW-013` 已解决问题重新出现时按统一策略重发。
- [ ] `REVIEW-014` 行号映射失败时降级到顶层评论。

### 8.4 自然语言对话

- [ ] `REVIEW-015` 获取 GitHub 顶层/行级对话上下文。
- [ ] `REVIEW-016` 获取 GitLab MR note/discussion 上下文。
- [ ] `REVIEW-017` 确认并实现 GitLab 自然语言追问权限；未确认前 fail closed。
- [ ] `REVIEW-018` reviewer 自身回复不得触发新的对话。

### 8.5 Web Search

- [ ] `WS-001` **高**：将 `web_search` 保留为平台无关的模型能力；共享 Bot/审查核
      心只读取规范化后的 `enable_web_search`；GitHub 和 GitLab 默认值均为
      `true`，两个 ConfigProvider 均完成映射和默认值测试。
- [ ] `WS-002` **高**：GitLab secret-bearing trigger 只接受受信任默认分支配置或
      受保护部署配置中的 `enable_web_search`；MR/Note payload 不得覆盖该开关。
- [ ] `WS-003` `enable_web_search=false` 时不得把 `web_search` tool 传给模型，也
      不得产生 web search analysis step。
- [ ] `WS-004` 明确 web search 不执行 Runner 本地代码；其调用失败、citation 清理
      失败或 analysis step 记录失败不得泄露 secret。
- [ ] `WS-005` GitHub/GitLab 对相同 `enable_web_search` 配置保持相同工具启用语义
      ，允许模型搜索结果本身存在非确定性。

### 8.6 Release Notes

- [ ] `REVIEW-019` **中**：将 release notes 生成保留在共享审查核心，两个平台使用
      相同 prompt、输入和开关语义。
- [ ] `REVIEW-020` 保持 `disable_release_notes` 和 `summarize_release_notes` 的
      GitHub input 行为，并映射到 GitLab ConfigProvider。
- [ ] `REVIEW-021` GitHub adapter 继续更新 PR description 中 reviewer 管理的
      release notes 区域。
- [ ] `REVIEW-022` GitLab adapter 更新 MR description 中 reviewer 管理的 release
      notes 区域。
- [ ] `REVIEW-023` release notes 更新必须使用平台 marker，只替换 reviewer 管理区
      域，不覆盖用户原始描述或另一平台 marker。
- [ ] `REVIEW-024` `disable_release_notes=true` 时完全跳过 release notes 模型调
      用和 description 更新。
- [ ] `REVIEW-025` 同一 fixture 在两平台生成语义等价的 release notes，允许平台格
      式差异。
- [ ] `REVIEW-026` description 更新采用“读取最新值 → 仅修改指定 marker 区域 → 条
      件写入”的流程；pause/resume、release notes 和用户原始内容必须同时保留。
- [ ] `REVIEW-027` description 写入遇到版本冲突或并发修改时重新读取后有限重试；
      不得用旧快照覆盖用户或另一 reviewer marker 的新内容。

### 8.7 本地工具安全

`LOCAL-*` 负责 secret-bearing 执行面的本地工具策略和 API-only 降级；`LINT-*` 负
责 lint 子系统的检测、安装、网络、缓存和扫描行为。

- [ ] `LOCAL-001` GitLab secret-bearing trigger 强制 `enable_shell=false`。
- [ ] `LOCAL-002` GitLab secret-bearing trigger 强制 `enable_lint_tools=false`。
- [ ] `LOCAL-003` 禁用本地工具时仍能完成 API-only 审查。
- [ ] `LINT-001` **高**：`enable_lint_tools=false` 时不得执行 lint adapter 检测
      、网络下载、动态安装、缓存恢复或扫描。
- [ ] `LINT-002` 在无外网、空工具缓存和未安装 lint 工具的 GitLab trigger 测试环
      境中，API-only 审查仍须通过。
- [ ] `LINT-003` 当前 MVP 不为 secret-bearing trigger 实现 lint 工具网络、缓存或
      离线镜像安装策略；未来启用时必须使用独立无密钥执行面重新设计。

---

## 9. 评论命令开发

### 9.1 共用解析和身份

- [ ] `CMD-001` 保留 `@ai-reviewer` 和 `@codesentinel` 文本别名。
- [ ] `CMD-002` GitLab 支持配置真实 PAT 用户 mention 或纯文本前缀。
- [ ] `CMD-003` 共用 parser、registry 和 handler 语义，事件/回复操作位于平台
      adapter。
- [ ] `CMD-004` 命令 mention 必须具有合法文本边界。
- [ ] `CMD-005` 未知命令返回帮助，不执行任意文本或 shell。
- [ ] `CMD-006` system/bot/self note 不进入权限和模型流程。

### 9.2 权限

- [ ] `CMD-007` `review`：Developer+；MR 作者允许。
- [ ] `CMD-008` `full review`：Developer+；MR 作者允许。
- [ ] `CMD-009` `summary`：Developer+；MR 作者允许。
- [ ] `CMD-010` `pause`：Developer+；MR 作者不豁免。
- [ ] `CMD-011` `resume`：Developer+；MR 作者不豁免。
- [ ] `CMD-012` `configuration`：Reporter+。
- [ ] `CMD-013` `help`：可见项目成员。
- [ ] `CMD-014` `resolve`：Developer+；MR 作者不豁免。
- [ ] `CMD-015` 权限比较使用 GitLab access level，不按角色名称字符串猜测。
- [ ] `CMD-016` 权限查询失败、用户不存在或项目不可见时 fail closed。

### 9.3 命令行为

- [ ] `CMD-017` `review` 针对最新 HEAD 执行增量审查。
- [ ] `CMD-018` `full review` 读取完整 MR diff 并执行全量审查。
- [ ] `CMD-019` `summary` 更新或重建 summary note。
- [ ] `CMD-020` `pause` 写入 GitLab MR description marker。
- [ ] `CMD-021` `resume` 移除/更新 pause marker 并保持幂等。
- [ ] `CMD-022` `configuration` 只显示生效后的非敏感配置和来源。
- [ ] `CMD-023` `help` 显示命令、权限、前缀和评论身份。
- [ ] `CMD-024` `resolve` 查询并解决 reviewer 创建的 GitLab discussions。
- [ ] `CMD-025` 每个命令覆盖顶层 note 和 discussion reply。
- [ ] `CMD-026` 每个命令覆盖无权限、重复事件、旧 SHA 和 API 部分失败。

### 9.4 命令速率限制

- [ ] `CMD-027` **中**：将进程内命令限流 key 规范化为
      `platform + project + PR/MR + actor`，避免不同平台、项目、变更和用户相互影
      响。
- [ ] `CMD-028` GitHub comment 和 GitLab note 事件共用平台无关限流接口，但分别从
      规范化事件上下文生成 key。
- [ ] `CMD-029` 明确当前令牌桶只在单次 Node 进程内提供 best-effort 限流；不得声
      称它可以跨 GitLab pipeline 限制连续评论。
- [ ] `CMD-030` GitLab 重复 Note Hook 的主要防护使用 event/note marker 幂等；进
      程内限流不能替代幂等检查。
- [ ] `CMD-031` 为相同/不同平台、project、PR/MR、actor 组合增加限流隔离测试。
- [ ] `CMD-032` 保持本轮不引入 Redis、数据库或持久化限流服务的范围约束。

---

## 10. 状态、幂等、并发与重试

- [ ] `STATE-001` 定义平台无关状态接口和 GitHub/GitLab 两个实现。
- [ ] `STATE-002` GitHub 保留 PR body/summary/review thread marker。
- [ ] `STATE-003` GitLab MR description 保存 pause/resume marker。
- [ ] `STATE-004` GitLab summary note 保存 reviewed SHA marker。
- [ ] `STATE-005` GitLab reviewer note 保存已处理 Note Hook 幂等键 marker；自动
      MR 审查继续使用 summary note 中的 reviewed SHA marker。
- [ ] `STATE-006` marker 和幂等键包含 `github:` 或 `gitlab:` 命名空间。
- [ ] `STATE-007` 禁止通过相同 commit SHA 合并 GitHub PR 和 GitLab MR 的任务状态
      。
- [ ] `STATE-008` marker 缺失或损坏时不得误更新用户评论。
- [ ] `STATE-009` GitLab CI 使用 `resource_group: ai-reviewer-mvp` 保证 MVP 串行
      。
- [ ] `STATE-010` marker 检查和写入在同一串行执行面完成。
- [ ] `STATE-011` 每次写 note/discussion 前重新读取 HEAD SHA。
- [ ] `STATE-012` HEAD 变化时退出且不写旧结果。
- [ ] `STATE-013` GitHub workflow rerun 不重复发布结果。
- [ ] `STATE-014` GitLab job Retry 不重复发布结果。
- [ ] `STATE-015` Webhook 重投、API 超时重试和手动 Retry 使用同一幂等规则。
- [ ] `STATE-016` PR/MR description 状态实现提供 marker 分区解析、最新值读取、条
      件更新和冲突重试，防止 pause/resume 与 release notes 并发覆盖。

---

## 11. 双入口打包开发

- [ ] `BUILD-001` 新增 GitLab TypeScript 入口并编译为 `lib/gitlab-trigger.js`。
- [ ] `BUILD-002` 新增 `package:github`，从 `lib/main.js` 生成 `dist/index.js`。
- [ ] `BUILD-003` 新增 `package:gitlab`，从 `lib/gitlab-trigger.js` 生成
      `dist/gitlab-trigger/index.js`。
- [ ] `BUILD-004` 防止两次 `ncc` 构建互相覆盖。
- [ ] `BUILD-005` 为两个 bundle 复制正确的 `tiktoken_bg.wasm` 和 license 资产，
      并将 `@gitbeaker/rest` 及其传递依赖纳入 GitLab bundle 的许可证与供应链检查
      。
- [ ] `BUILD-006` 为两个 bundle 增加 Node 24 启动冒烟测试。
- [ ] `BUILD-007` 更新 `npm run package`，连续生成两个入口。
- [ ] `BUILD-008` 更新 `npm run all`，包含双入口构建和测试。
- [ ] `BUILD-009` 保持 `action.yml` 的 `node24` 与 GitLab `node:24` 一致。
- [ ] `BUILD-010` 产物或构建日志记录源 commit SHA。

---

## 12. GitLab CI 开发

- [ ] `CI-001` 新建根目录 `.gitlab-ci.yml`。
- [ ] `CI-002` 新增无密钥 MR verify job：从 MR SHA build、test、lint、双入口
      package 和冒烟测试；产物只用于本次验证并在 job 结束后丢弃。
- [ ] `CI-003` MR verify job 只以“是否为空/不可访问”的布尔断言验证
      `GITLAB_PAT`、`OPENAI_API_KEY` 和 Trigger token 不可用，禁止输出、展开或写
      入这些变量的值。
- [ ] `CI-004` MR job 不产生供 protected `main` trigger job 执行的 artifact。
- [ ] `CI-005` 新增 protected `main` 的 `ai-review-trigger` job。
- [ ] `CI-006` trigger job 只允许 `CI_PIPELINE_SOURCE=trigger` 且 ref 为
      protected default branch。
- [ ] `CI-007` trigger job 执行 `dist/gitlab-trigger/index.js`，不 checkout MR
      head。
- [ ] `CI-008` trigger job 不执行 MR 提供的 package script、依赖、插件或
      artifact。
- [ ] `CI-009` 配置 `resource_group: ai-reviewer-mvp`。
- [ ] `CI-010` ignored payload 快速成功退出，不调用模型。
- [ ] `CI-011` 配置 job timeout、有限 retry 和脱敏日志。
- [ ] `CI-012` MR verify job 验证两个临时 bundle 均来自当前 MR 的
      `CI_COMMIT_SHA`，但这些 bundle 不得被 secret-bearing trigger 消费。
- [ ] `CI-013` protected `main` trigger job 只执行仓库中受信任的 GitLab bundle，
      并验证 bundle 记录的 source commit 与该 job 的 `CI_COMMIT_SHA` 一致；不得
      从 MR artifact、cache 或工作区恢复可执行产物。

---

## 13. 单向发布 Workflow 开发

- [ ] `SYNC-001` 审查并加固 `.github/workflows/sync-to-gitlab.yml`。
- [ ] `SYNC-002` 固定源/目标仓库与 `main` 分支，禁止不受控 ref 和目标 URL。
- [ ] `SYNC-003` 增加 concurrency，防止旧同步覆盖新提交。
- [ ] `SYNC-004` push 后自动比较 GitHub/GitLab `main` SHA。
- [ ] `SYNC-005` 同步失败时 job 失败，但不得影响 GitHub Action 审查 workflow。
- [ ] `SYNC-006` 防止 GitLab pipeline 反向触发 GitHub 写入或形成同步循环。
- [ ] `SYNC-007` 重复同步保持幂等。
- [ ] `SYNC-008` tag 和其他分支默认不同步；代码中使用显式白名单。
- [ ] `SYNC-009` GitLab reviewer 运行代码中不得读取同步 Token 或调用 GitHub。

---

## 14. 自动化测试 TODO

### 14.1 单元与契约测试

- [ ] `TEST-001` GitHub payload → `ExecutionContext` fixtures。
- [ ] `TEST-002` GitLab MR Hook → `ExecutionContext` fixtures。
- [ ] `TEST-003` GitLab Note Hook → `ExecutionContext` fixtures。
- [x] `TEST-004` 两平台 ConfigProvider 默认值、优先级和错误测试。
- [ ] `TEST-005` GitHub/GitLab adapter 成功、分页和错误测试。
- [ ] `TEST-006` GitLab diff position 的新增、删除、重命名和旧 SHA 测试。
- [ ] `TEST-007` 所有命令权限和 MR 作者例外测试。
- [ ] `TEST-008` 所有命令 parser/handler 测试。
- [ ] `TEST-009` marker、幂等、反馈循环和陈旧任务测试。
- [ ] `TEST-010` 双入口 bundle 启动测试。
- [ ] `TEST-011` 架构测试：GitHub adapter 不依赖 GitLab，GitLab adapter 不依赖
      GitHub。

### 14.2 语义等价测试

- [ ] `TEST-012` 同一 diff fixture 在两平台产生语义等价 summary。
- [ ] `TEST-013` 同一 diff fixture 在两平台产生语义等价行级问题。
- [ ] `TEST-014` 所有评论命令的业务结果语义等价。
- [ ] `TEST-015` 测试允许平台 URL、ID、作者和展示格式不同。

### 14.3 独立运行与集成故障注入测试

- [ ] `TEST-016` GitHub-only：无任何 GitLab 配置时全功能通过。
- [ ] `TEST-017` GitHub-only：GitLab API 不可达时全功能通过。
- [ ] `TEST-018` GitLab-only：无 GitHub Token 且阻断 GitHub API 时全功能通过。
- [ ] `TEST-019` GitLab-only：停用同步 workflow 后，已部署版本仍可处理 MR。
- [ ] `TEST-020` 同时启用：同一 commit 的 PR/MR 分别审查，不共享状态。
- [ ] `TEST-021` 集成/E2E 故障注入：同时启用时，一个平台的 API、Runner 或凭据故
      障不影响另一平台；该项不作为普通单元测试替代。

### 14.4 安全测试

- [ ] `TEST-022` 恶意 PR/MR 修改 reviewer 源码。
- [ ] `TEST-023` 恶意 PR/MR 修改 `dist` bundle。
- [ ] `TEST-024` 恶意 PR/MR 修改 workflow/`.gitlab-ci.yml`。
- [ ] `TEST-025` 恶意 PR/MR 修改 package scripts、依赖和 install hooks。
- [ ] `TEST-026` 恶意 PR/MR 尝试读取环境、文件系统、artifact 和日志中的 secret。
- [ ] `TEST-027` GitLab fork MR 被拒绝。
- [ ] `TEST-028` bot/system/self event 不调用模型。
- [ ] `TEST-029` API 错误、异常堆栈和 debug log 不包含 secret。
- [ ] `TEST-030` Web search 开关映射、受信任配置来源、禁用时不传 tool 和
      citation 清理测试。
- [ ] `TEST-031` GitHub/GitLab repository tree 的分页、recursive、缓存、错误和大
      仓截断测试。
- [ ] `TEST-032` 跨文件依赖分析在两平台的候选、路径解析、排序和
      `max_dependency_files` 一致性测试。
- [ ] `TEST-033` Release notes 的开关、prompt、平台 marker、description 局部更新
      、并发冲突重试和用户内容保护测试；同时覆盖 pause/resume marker 不被覆盖。
- [ ] `TEST-034` 命令限流复合 key 隔离、单进程窗口和 GitLab Note Hook 幂等协作测
      试。
- [ ] `TEST-035` GitLab trigger 禁用 lint 后不检测、不下载、不安装、不恢复缓存且
      仍可完成审查的测试。
- [ ] `TEST-036` 配置链路测试：
  - `action.yml` 必须声明代码读取的 `semgrep_version` 和 `semgrep_config`；
  - 完整公开配置矩阵中的 GitHub input 与 GitLab 公开配置产生相同的规范化值；
  - `enable_<tool>` 正确转换为内部 `toolEnableOverrides`，`<tool>_version` 正确
    转换为 `resolvedToolVersions`；
  - 未填写或空版本使用唯一受控默认值，空字符串不进入 `resolvedToolVersions`；
  - 空 `semgrep_config` 回退到 `p/default`；
  - 规范化值正确传递到 `Options`、lint orchestrator 和 Semgrep adapter。
- [ ] `TEST-037` 扫描生产代码的所有 Action input 读取点：每个读取值必须已在
      `action.yml` 声明并进入 `GitHubConfigProvider`，共享核心不得直接读取
      Action input。
- [ ] `TEST-038` GitLab 幂等键测试：MR Hook 使用 project/MR/head SHA，Note Hook
      使用 project/MR/note/action；重复 payload、job Retry 和缺少必填字段均不得
      重复调用模型或回复。
- [ ] `TEST-039` Repository tree 缓存隔离测试：相同 ref 的不同平台/项目不能互相
      命中，并分别验证空仓库、截断/不完整响应和 API 失败。
- [ ] `TEST-040` CI 产物来源测试：MR 临时 bundle 只验证不复用，protected trigger
      只接受 source commit 等于当前 `main` `CI_COMMIT_SHA` 的可信 bundle。
- [ ] `TEST-041` `@gitbeaker/rest` 客户端契约测试：覆盖自定义 host、PAT 注入
      、timeout、分页、snake_case 响应、429/5xx、401/403、404/409、网络错误和日
      志脱敏。
- [ ] `TEST-042` 架构测试：共享核心不得导入 `@gitbeaker/rest` 或直接调用 GitLab
      `fetch`；受控原生 `fetch` fallback 只能位于 GitLab adapter/客户端层。

---

## 15. 开发验收矩阵

| 功能                                  | GitHub-only | GitLab-only | 同时启用 |
| ------------------------------------- | ----------- | ----------- | -------- |
| 自动增量审查                          | [ ]         | [ ]         | [ ]      |
| `review`                              | [ ]         | [ ]         | [ ]      |
| `full review`                         | [ ]         | [ ]         | [ ]      |
| `summary`                             | [ ]         | [ ]         | [ ]      |
| `pause` / `resume`                    | [ ]         | [ ]         | [ ]      |
| `configuration`                       | [ ]         | [ ]         | [ ]      |
| `help`                                | [ ]         | [ ]         | [ ]      |
| `resolve`                             | [ ]         | [ ]         | [ ]      |
| 顶层摘要                              | [ ]         | [ ]         | [ ]      |
| 行级评论/discussion                   | [ ]         | [ ]         | [ ]      |
| 行级回复/对话上下文                   | [ ]         | [ ]         | [ ]      |
| ACK reaction/award emoji              | [ ]         | [ ]         | [ ]      |
| Web search 开关与工具调用             | [ ]         | [ ]         | [ ]      |
| Repository tree/跨文件依赖分析        | [ ]         | [ ]         | [ ]      |
| Release notes 生成与 description 更新 | [ ]         | [ ]         | [ ]      |
| 命令进程内限流与事件幂等              | [ ]         | [ ]         | [ ]      |
| 禁用 lint/shell 后 API-only 审查      | [ ]         | [ ]         | [ ]      |
| 权限校验                              | [ ]         | [ ]         | [ ]      |
| reviewed SHA marker                   | [ ]         | [ ]         | [ ]      |
| pause marker                          | [ ]         | [ ]         | [ ]      |
| event 幂等                            | [ ]         | [ ]         | [ ]      |
| 旧 SHA 退出                           | [ ]         | [ ]         | [ ]      |
| 平台状态隔离                          | N/A         | N/A         | [ ]      |
| 单平台故障隔离                        | N/A         | N/A         | [ ]      |
| 不可信代码无法访问密钥                | [ ]         | [ ]         | [ ]      |

---

## 16. 开发完成条件

- [ ] GitHub P0 安全修复及恶意 PR 测试通过。
- [ ] 共享核心不直接依赖平台 payload/API。
- [ ] GitHub Action inputs 和现有功能没有破坏性回退。
- [ ] GitLab trigger CLI、API adapter、Notes、Discussions 和命令全部实现。
- [ ] GitLab adapter 以锁定版本的 `@gitbeaker/rest` 为标准客户端，SDK 类型不泄露
      到共享核心，原生 `fetch` 仅作为 adapter 内受控 fallback。
- [ ] Web search、repository tree、跨文件依赖分析和 release notes 在两个平台的配
      置与功能兼容测试通过。
- [ ] Semgrep 的公开输入、默认值和内部规范化链路不存在未声明输入或空字符串覆盖默
      认值的问题。
- [ ] `toolEnableOverrides`、`resolvedToolVersions` 仅作为内部字段，不暴露为面向
      用户的 GitHub/GitLab 配置键；工具默认版本只有一个受控来源。
- [ ] 命令复合 key 限流与 event/note 幂等协作测试通过，且未引入持久化基础设施。
- [ ] GitLab secret-bearing trigger 不检测、下载、安装或运行 lint 工具。
- [ ] GitHub/GitLab 两个 bundle 可独立构建和启动。
- [ ] GitHub-only、GitLab-only、同时启用三种测试模式全部通过。
- [ ] 两个平台不跨平台读取或写入运行状态。
- [ ] GitLab MR head 和普通 MR job 无法接触业务密钥。
- [ ] MR verify 生成的临时 bundle 不进入高权限执行面；GitLab trigger bundle 与
      protected `main` 的 `CI_COMMIT_SHA` 一致。
- [ ] 单向发布 workflow 可验证 SHA、不会反向同步或形成循环。
- [ ] 第 15 章开发验收矩阵全部完成。

---

_—— 文档结束 ——_
