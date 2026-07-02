

# AI Reviewer 项目整体功能点测试分工（三人）

> **项目性质**: GitHub Action 形式的 AI 代码审查机器人
> **分工原则**: 按功能模块内聚性划分，每人 ~33% 工作量，尽量减少跨人依赖
> **测试方式**: 在 `ai-reviewer-test` 仓库中生成测试代码 → 手动提交创建 PR → 观察 Bot 行为

---

## 0. 总览

| 测试人 | 角色定位 | 覆盖模块 | 工作量占比 |
| :--- | :------- | :------- | :--------- |
| **测试人 1** | 核心审查流程 | PR 自动审查四阶段 + 增量审查 + 跨文件依赖分析 | ~33% |
| **测试人 2** | 命令系统与状态管理 | 命令解析/路由/权限/限流 + resolve + review/pause/resume/配置 | ~33% |
| **测试人 3** | 对话交互与质量控制 | 对话追问 + 噪音控制 + Linter/SAST 集成 | ~33% |

---

## 1. 测试人 1 — 核心审查流程

### 覆盖模块

| 模块 | 源文件 | 功能描述 |
| :--- | :----- | :------- |
| 审查引擎 | `src/review.ts` | 四阶段审查：准备 → 摘要 → 汇总 → 逐文件审查 |
| 双模型架构 | `src/bot.ts` + `src/main.ts` | lightBot（摘要）+ heavyBot（审查） |
| 增量审查 | `src/review.ts` + `src/commenter.ts` | 基于 `last_reviewed_sha` 的增量 diff |
| 跨文件依赖 | `src/dependency-analyzer.ts` | 导入解析 + 修改符号提取 + 引用搜索 |
| 文件过滤 | `src/options.ts` | path_filters 白/黑名单 |
| 摘要与分类 | `src/review.ts` Phase 1-3 | NEEDS_REVIEW / APPROVED 分类 |
| 发布说明 | `src/review.ts` + `src/prompts.ts` | PR 描述自动生成 release notes |

### 测试用例

#### 1.1 基础 PR 审查流程（P0）

| # | 测试场景 | 验证点 | 操作步骤 |
| :-- | :------- | :----- | :------- |
| 1.1.1 | 新建 PR 触发自动审查 | Bot 自动产出摘要评论 + 行级评论 | 创建包含明显问题的 PR |
| 1.1.2 | PR 摘要评论格式 | 包含 Walkthrough + Changes 表格 | 检查顶部评论结构 |
| 1.1.3 | 行级评论定位准确 | 评论定位到正确的代码行 | 对比评论行号与实际问题行 |
| 1.1.4 | 发布说明写入 PR 描述 | PR body 末尾出现 "Summary by CodeSentinel" | 检查 PR 描述 |
| 1.1.5 | `disable_review: true` 跳过审查 | 仅有摘要，无行级评论 | 配置 Action 参数 |
| 1.1.6 | PR 描述含 `@ai-reviewer: ignore` | 完全跳过审查 | 在 PR body 中加关键词 |

#### 1.2 增量审查（P0）

| # | 测试场景 | 验证点 | 操作步骤 |
| :-- | :------- | :----- | :------- |
| 1.2.1 | 首次审查后 push 新 commit | 仅审查新增变更，不重复审查旧代码 | PR 先 push 一次触发审查，再 push 新 commit |
| 1.2.2 | 摘要评论中记录已审查 commit | 含 commit ID 区块 | 检查摘要评论隐藏标签 |
| 1.2.3 | 全量审查（full review 命令） | 从 base 到 HEAD 全部审查 | 通过命令触发 |

#### 1.3 跨文件依赖分析（P1）

| # | 测试场景 | 验证点 | 操作步骤 |
| :-- | :------- | :----- | :------- |
| 1.3.1 | 修改导出函数 | 审查评论提及引用方文件 | 修改被多处引用的函数 |
| 1.3.2 | TypeScript import 解析 | 识别 `import { X } from './module'` | 修改 TS 导出符号 |
| 1.3.3 | Vue/Nuxt composable 引用 | 识别 `useXxx` 在其他组件中的引用 | 修改 composable 文件 |
| 1.3.4 | `enable_dependency_analysis: false` | 不产出跨文件引用摘要 | 关闭依赖分析开关 |
| 1.3.5 | `max_dependency_files` 限制 | 不超过配置的最大扫描文件数 | 设置较小的上限值 |

#### 1.4 文件过滤与限制（P1）

| # | 测试场景 | 验证点 | 操作步骤 |
| :-- | :------- | :----- | :------- |
| 1.4.1 | 二进制文件被默认排除 | 不审查 .png / .zip 等 | PR 中包含图片变更 |
| 1.4.2 | 自定义 path_filters | 仅审查匹配路径的文件 | 配置 `src/**.ts` |
| 1.4.3 | `max_files` 限制 | 超出文件数时显示跳过统计 | PR 含大量文件 |
| 1.4.4 | 锁文件/配置文件排除 | `.lock / .json / .yaml` 不审查 | PR 包含 lockfile 变更 |

#### 1.5 双模型与 Token 管理（P2）

| # | 测试场景 | 验证点 | 操作步骤 |
| :-- | :------- | :----- | :------- |
| 1.5.1 | diff 超出 lightBot Token 限制 | 该文件摘要跳过，统计中有记录 | 提交超大文件变更 |
| 1.5.2 | patch 超出 heavyBot Token 限制 | 仅审查前 N 个 patch，日志记录跳过 | 超大函数变更 |
| 1.5.3 | 并发控制 | 不超过 `openai_concurrency_limit` | 观察日志并发数 |

### 测试代码生成建议

```
test_cases/testing-person-1/
├── code-changes/
│   ├── basic-review.ts          # 含安全/正确性问题，触发基础审查
│   ├── incremental-change.ts    # 两次提交，验证增量
│   ├── cross-file-export.ts     # 导出函数被引用
│   ├── cross-file-import.ts     # 引用方文件
│   └── large-file.ts            # 超大文件测试 Token 限制
└── apply-changes.sh
```

---

## 2. 测试人 2 — 命令系统与状态管理

### 覆盖模块

| 模块 | 源文件 | 功能描述 |
| :--- | :----- | :------- |
| 命令解析 | `src/commands/parser.ts` | 正则提取 `@codesentinel <cmd> <args>` |
| 命令路由 | `src/commands/dispatcher.ts` | 10 步调度流程 |
| 权限校验 | `src/commands/permission.ts` | 仓库权限 → 命令权限映射 |
| 速率限制 | `src/commands/rate-limit.ts` | 按用户维度限流 |
| 幂等处理 | `src/commands/reply.ts` | 同 comment × 同命令不重复执行 |
| help | `src/commands/handlers/help.ts` | 命令用法展示 |
| resolve | `src/commands/handlers/resolve.ts` | 批量解决 Bot 评论 |
| review/full review | `src/commands/handlers/stubs.ts` | 触发增量/全量审查 |
| pause/resume | `src/commands/handlers/stubs.ts` + `src/review-state.ts` | PR 级暂停/恢复 |
| summary | `src/commands/handlers/stubs.ts` | 重新生成摘要 |
| configuration | `src/commands/handlers/stubs.ts` | 展示当前配置 |
| ACK 反馈 | `src/commands/early-reaction.ts` + `src/commands/reaction.ts` | 表情确认 + 进度回帖 |

### 测试用例

#### 2.1 命令解析与路由（P0）

| # | 测试场景 | 验证点 | 操作步骤 |
| :-- | :------- | :----- | :------- |
| 2.1.1 | `@codesentinel help` | 回帖展示所有命令用法 | PR 中评论 |
| 2.1.2 | `@ai-reviewer help` | 别名同样触发 | 使用 `@ai-reviewer` 前缀 |
| 2.1.3 | 无效命令 `@codesentinel xyz` | 回帖提示无效命令 | 输入未注册命令 |
| 2.1.4 | 非 @bot 普通评论 | 无任何响应 | 评论不含 mention |
| 2.1.5 | Bot 自身评论不触发 | 无死循环 | 观察 Bot 回帖后无二次触发 |
| 2.1.6 | 评论中命令大小写 | 大小写不敏感 | `@CodeSentinel HELP` |

#### 2.2 权限与限流（P0）

| # | 测试场景 | 验证点 | 操作步骤 |
| :-- | :------- | :----- | :------- |
| 2.2.1 | write 权限用户执行 review | 执行成功 | 有 write 权限的用户发命令 |
| 2.2.2 | read 权限用户执行 review | 回帖 FORBIDDEN | 使用只读权限账号 |
| 2.2.3 | read 权限执行 configuration | 执行成功（minPermission=read） | 只读用户发 configuration |
| 2.2.4 | 短时间内连续命令 | 第 N 次被限流，提示重试时间 | 快速连发多条命令 |
| 2.2.5 | 同一条评论重复处理 | 第二次被判为 DUPLICATE | 通过 Actions 重试观察 |

#### 2.3 resolve 命令（P0）

| # | 测试场景 | 验证点 | 操作步骤 |
| :-- | :------- | :----- | :------- |
| 2.3.1 | 有待解决的 Bot 评论 | 批量 resolve + 统计反馈 | 先让 Bot 审查产出评论，再 resolve |
| 2.3.2 | 无待解决评论 | 回帖"没有找到待解决的审查意见" | resolve 在无评论的 PR 上 |
| 2.3.3 | 部分失败 | 报告成功 N 条、失败 M 条 | 权限不完整时执行 |
| 2.3.4 | 并发控制 + 限流 | 不触发 GitHub API rate limit | 大量评论时观察 |

#### 2.4 审查控制命令（P0）

| # | 测试场景 | 验证点 | 操作步骤 |
| :-- | :------- | :----- | :------- |
| 2.4.1 | `@codesentinel review` | 触发增量审查，产出新评论 | push 新 commit 后执行 |
| 2.4.2 | `@codesentinel full review` | 从 base 全量审查 | 在已审查过的 PR 上执行 |
| 2.4.3 | `@codesentinel summary` | 重新生成 PR 摘要 | 执行后检查顶部摘要更新 |
| 2.4.4 | `@codesentinel pause` | PR 描述写入暂停标记 | 执行后检查 PR body |
| 2.4.5 | pause 状态下 push | 不自动触发审查 | 暂停后 push 新 commit |
| 2.4.6 | `@codesentinel resume` | 恢复审查标记 | 恢复后 push 应触发审查 |
| 2.4.7 | `@codesentinel configuration` | 展示当前配置表格 | 检查回帖格式 |

#### 2.5 ACK 与反馈机制（P1）

| # | 测试场景 | 验证点 | 操作步骤 |
| :-- | :------- | :----- | :------- |
| 2.5.1 | 命令 ACK 表情 | 评论上出现 🚀 表情 | 发送任意有效命令 |
| 2.5.2 | 耗时命令进度反馈 | 先回"正在执行"，完成后更新 | 执行 review 命令 |
| 2.5.3 | 错误反馈格式 | 错误信息清晰，含操作建议 | 触发各种错误场景 |

### 测试代码生成建议

```
test_cases/testing-person-2/
├── code-changes/
│   ├── command-trigger.ts       # 含问题的代码，让 Bot 产出评论供 resolve 测试
│   └── apply-changes.sh
└── test-commands.md             # 命令测试脚本（手动执行的评论序列）
```

**命令测试脚本示例**（在 PR 评论中依次执行）：

```
1. @codesentinel help
2. @codesentinel configuration
3. @codesentinel review
4. @codesentinel resolve
5. @codesentinel pause
6. (push 新 commit → 验证不触发审查)
7. @codesentinel resume
8. (push 新 commit → 验证触发审查)
9. @codesentinel full review
10. @codesentinel summary
11. @codesentinel invalidcmd  (验证错误反馈)
12. 快速连发 5 次 @codesentinel help (验证限流)
```

---

## 3. 测试人 3 — 对话交互与质量控制

### 覆盖模块

| 模块 | 源文件 | 功能描述 |
| :--- | :----- | :------- |
| 对话追问 | `src/conversation.ts` | 意图识别 + 历史收集 + LLM 调用 + 轮次控制 |
| 噪音控制 | `src/noise-control.ts` | 去重 + 排序 + 截断 + 严重级别徽标 |
| 评论去重 | `src/review-dedup.ts` | 同议题 AI 评论贪心聚类合并 |
| Linter 集成 | `src/lint/` | ESLint + Biome + tsc + Prettier + Semgrep |
| 工具安装 | `src/lint/tool-installer.ts` | 自动安装 lint 工具 |
| 工具归因 | `src/lint/formatter.ts` | 评论底部"🧰 Tools"卡片 |
| Web 搜索 | `src/bot.ts` (enableWebSearch) | AI 审查时联网验证 API 用法 |
| Shell 执行 | `src/bot.ts` (enableShell) | AI 审查时执行 shell 命令辅助分析 |

### 测试用例

#### 3.1 对话式追问交互（P0）

| # | 测试场景 | 验证点 | 操作步骤 |
| :-- | :------- | :----- | :------- |
| 3.1.1 | `@codesentinel 为什么这样不好？` | Bot 回复，引用该行代码上下文 | 在行级评论中追问 |
| 3.1.2 | 续轮追问 `@codesentinel 怎么改？` | 回复包含修改建议，引用之前对话 | 在同一 thread 继续 |
| 3.1.3 | 不带 @bot 的普通回复 | Bot 不回复 | 在 thread 中直接回复 |
| 3.1.4 | Bot 自身回帖不自触发 | 无无限循环 | 观察 Bot 回复后无二次触发 |
| 3.1.5 | 追问引用文件完整 diff | 回复能感知文件整体变更 | 追问跨行的架构问题 |
| 3.1.6 | 追问引用 PR 摘要 | 回复引用 PR 上下文 | 追问与 PR 目的相关的问题 |

#### 3.2 对话轮次与截断（P1）

| # | 测试场景 | 验证点 | 操作步骤 |
| :-- | :------- | :----- | :------- |
| 3.2.1 | 连续追问达到 10 轮 | 第 11 轮提示"轮次已达上限" | 循环追问 |
| 3.2.2 | 长对话上下文截断 | Bot 仍能正常回复（不报 token 超限） | 每轮发长文本追问 |
| 3.2.3 | 截断后保留最近内容 | 回复引用最近几轮而非很早的对话 | 检查回复关联性 |
| 3.2.4 | issue_comment 对话不支持 | 无响应 | 在 PR 主评论区（非行级）追问 |

#### 3.3 噪音控制（P0）

| # | 测试场景 | 验证点 | 操作步骤 |
| :-- | :------- | :----- | :------- |
| 3.3.1 | 严重级别徽标 | 各评论顶部有对应 emoji + 中文标签 | 检查行级评论格式 |
| 3.3.2 | 级别排序 | critical 评论排在 minor/nit 之前 | 检查评论展示顺序 |
| 3.3.3 | 评论数量截断 | 超过 `max_review_comments`(20) 时截断 | PR 含 25+ 问题 |
| 3.3.4 | 截断保留高优先级 | critical/major 不被截断丢弃 | 检查被保留的评论级别 |
| 3.3.5 | 同类评论合并 | 同一文件同类问题（如 Math.random×2）合并 | 包含多个同类问题 |
| 3.3.6 | `max_review_comments: 0` 不截断 | 所有评论都展示 | 配置无上限 |

#### 3.4 Linter/SAST 集成（P0）

| # | 测试场景 | 验证点 | 操作步骤 |
| :-- | :------- | :----- | :------- |
| 3.4.1 | ESLint 检测结果注入 | AI 评论引用 ESLint 规则 | 包含 ESLint 可检测的问题 |
| 3.4.2 | tsc 类型错误 | AI 评论引用 TypeScript 错误码 | 包含类型不匹配代码 |
| 3.4.3 | Biome 检测 | AI 评论引用 Biome 规则 | 包含 Biome 可检测的问题 |
| 3.4.4 | 工具归因卡片 | 评论底部有"🧰 Tools"段落 | 检查评论格式 |
| 3.4.5 | `enable_lint_tools: false` | 无 lint 相关内容 | 关闭 lint 总开关 |
| 3.4.6 | 单独禁用某工具 | 该工具不运行 | `enable_eslint: false` |
| 3.4.7 | Semgrep SAST 扫描 | 检测出安全漏洞（注入/XSS 等） | `enable_semgrep: true` |

#### 3.5 AI 评论去重（P1）

| # | 测试场景 | 验证点 | 操作步骤 |
| :-- | :------- | :----- | :------- |
| 3.5.1 | 同一 lint finding 的多条评论合并 | 合并为一条 | 产出多条指向同一 lint 规则的评论 |
| 3.5.2 | 不同 lint finding 不合并 | 各自保留 | 不同规则违反不会误合并 |
| 3.5.3 | 合并后行号范围扩大 | 覆盖所有相关行 | 检查评论定位 |
| 3.5.4 | 纯 AI 洞察（无 lint）精确行号去重 | 同行合并 | 无 lint 场景 |

#### 3.6 Web 搜索与 Shell（P2）

| # | 测试场景 | 验证点 | 操作步骤 |
| :-- | :------- | :----- | :------- |
| 3.6.1 | Web 搜索验证 API 用法 | Analysis chain 中有 web_search 步骤 | 代码使用冷门 API |
| 3.6.2 | Shell 执行辅助分析 | Analysis chain 中有 shell 步骤 | 代码有依赖相关问题 |
| 3.6.3 | `enable_web_search: false` | 无 web_search 步骤 | 关闭 Web 搜索 |
| 3.6.4 | `enable_shell: false` | 无 shell 步骤 | 关闭 Shell 执行 |

### 测试代码生成建议

```
test_cases/testing-person-3/
├── code-changes/
│   ├── security-issues.ts        # 安全问题集中（critical 级别 + 同类合并）
│   ├── correctness-issues.ts     # 正确性问题（major 级别）
│   ├── style-issues.ts           # 大量低优先级问题（触发截断）
│   ├── conversation-anchor.ts    # 追问对话锚点（有深度的问题）
│   ├── type-errors.ts            # TypeScript 类型错误（tsc 集成）
│   └── lint-violations.ts        # ESLint/Biome 规则违反
└── apply-changes.sh
```

---

## 4. 跨人依赖与协调

### 共享前置条件

| 前置条件 | 负责人 | 说明 |
| :------- | :----- | :--- |
| Bot 已部署并能触发 | 全员确认 | GitHub Action 配置正确 |
| 测试仓库可用 | 全员共享 | `ai-reviewer-test` 仓库 |
| 基础分支可合并 | 测试人 1 先行 | 确认 PR 审查基础流程正常 |

### 执行顺序建议

```
第 1 天: 测试人 1 执行 1.1（基础审查流程），确认 Bot 正常工作
         ↓ 确认后
第 1-2 天: 三人并行各自测试
         测试人 1: 1.2-1.5（增量 + 依赖 + 过滤）
         测试人 2: 2.1-2.5（命令系统全链路）
         测试人 3: 3.3-3.4（噪音控制 + Lint），因为依赖 Bot 先产出评论
第 2-3 天: 测试人 3 执行 3.1-3.2（对话追问），需要 Bot 先产出行级评论作为锚点
```

### 结果汇总格式

每人测试完成后填写：

```markdown
## [测试人 N] 测试结果

| # | 场景 | 结果 | 备注 |
| -- | ---- | ---- | ---- |
| x.x.x | 场景描述 | ✅ 通过 / ❌ 失败 / ⚠️ 部分通过 | 问题描述或截图链接 |
```

---

## 5. 功能点与源码映射总表

| 功能域 | 功能点 | 核心源文件 | 测试负责人 |
| :----- | :----- | :--------- | :--------- |
| **审查引擎** | PR 自动触发 | `main.ts` → `review.ts` | 测试人 1 |
| | 文件摘要（Phase 1） | `review.ts` doSummary | 测试人 1 |
| | 摘要合并（Phase 2） | `review.ts` batchSize=10 | 测试人 1 |
| | 最终汇总（Phase 3） | `review.ts` summarizeFinalResponse | 测试人 1 |
| | 逐文件审查（Phase 4） | `review.ts` doReview | 测试人 1 |
| | 增量审查 | `review.ts` highestReviewedCommitId | 测试人 1 |
| | 文件过滤 | `options.ts` checkPath | 测试人 1 |
| | 发布说明 | `review.ts` releaseNotesResponse | 测试人 1 |
| **依赖分析** | 导入解析 | `dependency-analyzer.ts` | 测试人 1 |
| | 符号提取 | `dependency-analyzer.ts` ModifiedSymbol | 测试人 1 |
| | 引用搜索 | `dependency-analyzer.ts` SymbolReference | 测试人 1 |
| **命令系统** | 命令解析 | `commands/parser.ts` | 测试人 2 |
| | 命令路由 | `commands/dispatcher.ts` | 测试人 2 |
| | 权限校验 | `commands/permission.ts` | 测试人 2 |
| | 速率限制 | `commands/rate-limit.ts` | 测试人 2 |
| | 幂等处理 | `commands/reply.ts` hasBeenProcessed | 测试人 2 |
| | help | `commands/handlers/help.ts` | 测试人 2 |
| | ACK 反馈 | `commands/early-reaction.ts` | 测试人 2 |
| **状态管理** | resolve | `commands/handlers/resolve.ts` | 测试人 2 |
| | review / full review | `commands/handlers/stubs.ts` | 测试人 2 |
| | pause / resume | `review-state.ts` | 测试人 2 |
| | summary | `commands/handlers/stubs.ts` | 测试人 2 |
| | configuration | `commands/handlers/stubs.ts` | 测试人 2 |
| **对话交互** | 意图识别 | `conversation.ts` isFollowUpQuestion | 测试人 3 |
| | Thread 历史收集 | `conversation.ts` getCommentChain | 测试人 3 |
| | LLM 对话推理 | `conversation.ts` heavyBot.chat | 测试人 3 |
| | 上下文截断 | `conversation.ts` truncateConversationChain | 测试人 3 |
| | 轮次上限 | `conversation.ts` MAX_CONVERSATION_TURNS | 测试人 3 |
| **噪音控制** | 严重级别分类 | `noise-control.ts` classifyFindingSeverity | 测试人 3 |
| | 严重级别徽标 | `noise-control.ts` severityBadge | 测试人 3 |
| | 同类去重 | `noise-control.ts` dedupeFindings | 测试人 3 |
| | 排序 + 截断 | `noise-control.ts` prepareFindings | 测试人 3 |
| | AI 评论去重 | `review-dedup.ts` mergeReviewsByTopic | 测试人 3 |
| **Lint 集成** | ESLint | `lint/adapters/eslint.ts` | 测试人 3 |
| | Biome | `lint/adapters/biome.ts` | 测试人 3 |
| | tsc | `lint/adapters/tsc.ts` | 测试人 3 |
| | Prettier | `lint/adapters/prettier.ts` | 测试人 3 |
| | Semgrep | `lint/adapters/semgrep.ts` | 测试人 3 |
| | 工具安装 | `lint/tool-installer.ts` | 测试人 3 |
| | 工具归因 | `lint/formatter.ts` formatToolAttribution | 测试人 3 |
| **AI 能力** | Web 搜索 | `bot.ts` enableWebSearch | 测试人 3 |
| | Shell 执行 | `bot.ts` enableShell | 测试人 3 |

---

## 6. 工作量平衡说明

| 测试人 | P0 用例数 | P1 用例数 | P2 用例数 | 复杂度备注 |
| :----- | :-------: | :-------: | :-------: | :--------- |
| 测试人 1 | 9 | 8 | 3 | 审查核心流程，需要多次 push + 等待 |
| 测试人 2 | 14 | 3 | 0 | 命令多但单个验证快，评论操作为主 |
| 测试人 3 | 13 | 6 | 4 | 需等 Bot 产出评论后再操作，涉及多工具 |

三人 P0 用例数接近（9/14/13），测试人 2 偏命令操作（执行快但步骤多），测试人 1 偏等待（审查需时间），测试人 3 偏观察（检查格式与内容质量），整体均衡。
