---
title: 项目全面分析报告
sidebar_label: 项目分析
sidebar_position: 0
---

# CodeSentinel AI Reviewer — 项目全面分析报告

> 分析日期：2026-05-06  
> 分支：`chore/analysis-biz`

---

## 一、核心能力

CodeSentinel AI Reviewer 是一个 **GitHub Action 形式的 AI 代码审查机器人**，核心能力分为三层：

### 1.1 智能审查引擎（迭代一，已完成）

| 能力 | 说明 |
|:---|:---|
| **增量 diff 审查** | 仅处理自上次审查 commit 起的新增变更，避免重复审查 |
| **四阶段流水线** | 文件摘要 → 摘要合并 → 深度逐文件审查 → 状态持久化 |
| **行级评论** | 精确到代码行的审查意见，通过 GitHub Review API 提交 |
| **跨文件依赖分析** | 分析被改动符号在其他文件中的引用，辅助评估影响范围 |
| **对话式追问** | 在 review thread 中 @bot 追问，携带完整上下文作答 |
| **PR 摘要生成** | 自动生成 Walkthrough 摘要表格 + 发布说明注入 PR 描述 |
| **状态持久化** | 在摘要评论中以 HTML 注释形式存储 commitId 和摘要，跨运行恢复状态 |
| **AI 工具链** | 集成 Shell 执行工具、Web Search 工具，支持 Analysis Chain 推理步骤展示 |

### 1.2 命令交互框架（迭代二成员 A，已完成）

| 能力 | 说明 |
|:---|:---|
| **命令解析** | 识别 `@codesentinel <cmd> [args]` 格式，支持复合命令（`full review`）和 `kv` 参数 |
| **权限校验** | 5 级权限体系（admin / maintain / write / triage / read），PR 作者豁免机制 |
| **速率限制** | 令牌桶算法，60 秒窗口内最多 10 条命令 |
| **幂等保护** | 通过 HTML 注释标签标记已处理评论，防止重复执行 |
| **help 命令** | 自动聚合已注册命令生成帮助文档 |
| **快速 ACK** | 5 秒内 emoji 表情确认，避免用户等待焦虑 |
| **统一回复工具** | `Reply.ack()` / `success()` / `error()` / `progress()` 标准化反馈 |

### 1.3 平台基础能力

| 能力 | 说明 |
|:---|:---|
| **Token 预算管理** | 适配不同模型（gpt-5.4 / gpt-4.1 / gpt-4o）的上下文限制 |
| **并发控制** | OpenAI 并发 ≤ 6，GitHub API 并发 ≤ 6，使用 `p-limit` |
| **自动重试** | API 失败自动重试（`p-retry`），Octokit 限流退避（`@octokit/plugin-throttling`）|
| **路径过滤** | glob 规则过滤审查文件（PathFilter），支持忽略特定目录 |
| **高度可配置** | `action.yml` 提供 40+ 输入参数，支持自定义系统消息、模型、提示词 |

---

## 二、完整架构

### 2.1 技术栈

| 层次 | 技术 |
|:---|:---|
| **运行环境** | Node.js 20 / GitHub Actions |
| **语言** | TypeScript（strict 模式） |
| **AI SDK** | OpenAI SDK（Responses API，支持多轮对话） |
| **GitHub API** | `@octokit/action` + GraphQL（带重试/限流插件） |
| **打包** | `@vercel/ncc` → 单文件 `dist/index.js` |
| **Token 计数** | `@dqbd/tiktoken`（o200k_base 编码） |
| **测试** | Jest + ts-jest |

### 2.2 目录结构与模块职责

```
ai-reviewer/
├── action.yml                    # GitHub Action 定义（40+ 输入参数）
├── src/
│   ├── main.ts                   # 入口：事件分发（pull_request / review_comment）
│   ├── options.ts                # 配置管理（Options 类、PathFilter、OpenAIOptions）
│   ├── inputs.ts                 # 提示词变量模板（24 个变量，render() 渲染）
│   ├── limits.ts                 # 各模型 token 预算常量
│   │
│   ├── review.ts                 # 【核心】PR 代码审查四阶段引擎（~500 行）
│   ├── review-comment.ts         # PR review comment 对话式回复处理
│   ├── command-handler.ts        # 命令系统总入口（事件类型路由）
│   │
│   ├── bot.ts                    # OpenAI Responses API 封装
│   │                             #   - chat()：多轮对话、shell_call、web_search
│   │                             #   - analysisSteps 提取
│   ├── commenter.ts              # GitHub 评论管理
│   │                             #   - 评论 CRUD、标签幂等
│   │                             #   - bufferReviewComment / submitReview
│   │                             #   - 状态标签解析（commitId / rawSummary）
│   ├── prompts.ts                # 5 类 LLM 提示词模板
│   ├── tokenizer.ts              # Token 计数（tiktoken）
│   ├── octokit.ts                # GitHub API 客户端（重试 + 限流）
│   ├── repo-tree.ts              # 仓库文件树缓存 + 导入路径解析
│   ├── dependency-analyzer.ts    # 跨文件依赖分析（TS/JS/Python/Go/Java/Vue）
│   │
│   └── commands/                 # 命令框架（迭代二成员 A）
│       ├── types.ts              # CommandHandler / CommandContext / ErrorCode 接口
│       ├── parser.ts             # 命令解析器（字符白名单、参数限制）
│       ├── registry.ts           # 命令注册表（单例、别名支持）
│       ├── dispatcher.ts         # 调度器（8 步标准流程）
│       ├── permission.ts         # 权限查询与校验（含缓存）
│       ├── rate-limit.ts         # 令牌桶速率限制（60s/10 条）
│       ├── reply.ts              # 统一回复工具（ack/success/error/progress）
│       ├── reaction.ts           # GitHub Reactions API（添加/移除 emoji）
│       ├── early-reaction.ts     # 快速 ACK（5 秒内 emoji 确认）
│       ├── bootstrap.ts          # 命令模块启动注册（单次保护）
│       └── handlers/
│           ├── help.ts           # help 命令（自动聚合注册命令）
│           └── stubs.ts          # 未实现命令的桩（review/full review/resolve/summary/pause/resume/configuration）
│
├── __tests__/                    # 单元测试（7 个测试文件）
├── docs/                         # 设计文档
└── dist/                         # 打包产物（ncc 单文件）
```

### 2.3 核心数据流

#### PR 自动审查流程（`pull_request` 事件）

```
GitHub push → action.yml 触发
    │
    ▼
main.ts：初始化 lightBot（nano）+ heavyBot（mini）
    │
    ▼
review.ts → codeReview()
    │
    ├─ [阶段1] 文件摘要（lightBot，并发 6）
    │    ├─ 获取增量 diff（比较上次审查 commit → HEAD）
    │    ├─ PathFilter 过滤不审查的文件
    │    └─ 逐文件生成 100 字摘要（含可选分类 NEEDS_REVIEW / APPROVED）
    │
    ├─ [阶段2] 摘要合并（heavyBot）
    │    ├─ 每 10 文件一批去重合并
    │    └─ 生成 PR Walkthrough 表格 + 发布说明
    │
    ├─ [阶段3] 深度审查（heavyBot，仅 NEEDS_REVIEW 文件）
    │    ├─ 打包 hunk + 评论链 + 跨文件上下文 → 提示词
    │    ├─ heavyBot.chat() 生成行级评论
    │    └─ bufferReviewComment → submitReview（批量提交）
    │
    └─ [阶段4] 状态持久化
         └─ 更新摘要评论（写入 commitId / rawSummary / shortSummary）
```

#### 命令交互流程（`issue_comment` / `pull_request_review_comment` 事件）

```
评论事件
    │
    ▼
command-handler.ts → dispatchCommentEvent()
    │
    ├─ Step 1-3：事件校验、提取 PR 元数据、过滤 Bot 自评论
    ├─ Step 4：幂等检查（PROCESSED_TAG）
    ├─ Step 5：命令解析（parser.parse）
    │    ├─ command → 命令路径
    │    ├─ conversation → 对话路径（成员 D 实现）
    │    └─ none → 忽略
    ├─ Step 6：权限校验（getPermission + canExecute）
    ├─ Step 7：ACK（emoji 快速回应）
    ├─ Step 8：handler.execute(ctx)
    └─ Step 9：标记 PROCESSED_TAG
```

### 2.4 关键接口定义

```typescript
// 命令处理器接口（B/C/D 接入点）
interface CommandHandler {
  name: string
  aliases?: string[]
  minPermission?: PermissionLevel   // 'admin'|'maintain'|'write'|'triage'|'read'|'none'
  description: string
  usage?: string
  execute(ctx: CommandContext): Promise<CommandResult>
}

// 命令上下文（处理器收到的完整信息）
interface CommandContext {
  command: ParsedCommand            // 解析后的命令（name, args, kv）
  eventName: string
  owner, repo, prNumber, headSha, baseSha: string
  actor: ActorInfo                  // { login, permission, isPrAuthor, isBot }
  commentId, commentBody: string
  reply: Reply                      // 统一回复工具
  options: Options
}
```

### 2.5 状态持久化机制

评论状态通过 HTML 注释标签嵌入到 GitHub PR 的摘要评论中：

```html
<!-- SUMMARIZE_TAG -->
...可见的摘要内容...
<!-- RAW_SUMMARY_START_TAG -->原始摘要（隐藏）<!-- RAW_SUMMARY_END_TAG -->
<!-- SHORT_SUMMARY_START_TAG -->精简摘要（隐藏）<!-- SHORT_SUMMARY_END_TAG -->
<!-- COMMIT_ID_START_TAG -->abc123, def456<!-- COMMIT_ID_END_TAG -->
```

下次 Action 运行时解析标签恢复状态，仅审查新增的 commit diff。

---

## 三、完成情况总览

### 3.1 已完成功能

#### 迭代一：智能分析管线（✅ 全部完成）

| 模块 | 状态 | 说明 |
|:---|:---:|:---|
| PR 增量审查引擎（四阶段流水线） | ✅ | `review.ts` |
| 行级评论生成与提交 | ✅ | `commenter.ts` + GitHub Review API |
| PR 摘要生成（Walkthrough + 发布说明） | ✅ | `prompts.ts` + `commenter.ts` |
| 对话式追问（pull_request_review_comment） | ✅ | `review-comment.ts` |
| 跨文件依赖分析 | ✅ | `dependency-analyzer.ts`（支持 TS/JS/Python/Go/Java/Vue）|
| OpenAI Responses API 集成（Shell + WebSearch）| ✅ | `bot.ts` |
| Analysis Chain 推理步骤展示 | ✅ | `bot.ts` → prompts |
| Token 预算管理 | ✅ | `limits.ts` + `tokenizer.ts` |
| 增量审查状态持久化 | ✅ | HTML 注释标签方案 |
| 路径过滤（glob 规则）| ✅ | `options.ts` → PathFilter |
| PR 描述更新（写入发布说明）| ✅ | `commenter.ts` → updateDescription |
| 并发控制 + API 重试 | ✅ | `p-limit` + `p-retry` + octokit 插件 |

#### 迭代二成员 A：命令框架（✅ 全部完成）

| 模块 | 状态 | 说明 |
|:---|:---:|:---|
| Webhook 事件监听（issue_comment / pr_review_comment）| ✅ | `main.ts` + `command-handler.ts` |
| 命令解析器（复合命令、kv 参数、白名单校验）| ✅ | `commands/parser.ts` |
| 命令注册表（别名、防重复）| ✅ | `commands/registry.ts` |
| 调度器（8 步标准流程）| ✅ | `commands/dispatcher.ts` |
| 权限校验（5 级 + PR 作者豁免）| ✅ | `commands/permission.ts` |
| 速率限制（令牌桶 60s/10 条）| ✅ | `commands/rate-limit.ts` |
| 统一回复工具 | ✅ | `commands/reply.ts` |
| GitHub Reactions API 封装 | ✅ | `commands/reaction.ts` |
| 快速 ACK（5 秒 emoji 确认）| ✅ | `commands/early-reaction.ts` |
| help 命令 | ✅ | `commands/handlers/help.ts` |
| 幂等保护（PROCESSED_TAG）| ✅ | `commands/dispatcher.ts` |
| 命令注入防护（字符白名单 + 参数长度限制）| ✅ | `commands/parser.ts` |
| 单元测试（7 个测试文件）| ✅ | `__tests__/` |

---

### 3.2 未完成功能

#### 迭代二成员 B：resolve 命令（❌ 未实现）

| 任务 | 优先级 | 说明 |
|:---|:---:|:---|
| GraphQL 查询 PR 所有 review threads | P0 | 识别 Bot 发出的评论 |
| Bot 评论过滤逻辑 | P0 | 排除非 CodeSentinel 评论 |
| 批量调用 `resolveReviewThread` mutation | P0 | 并发控制 + 限流 |
| 指数退避重试 | P0 | 应对 GitHub Rate Limit |
| 解决数量统计与结果反馈 | P1 | "✅ 已解决 N 条审查意见" |
| 部分失败降级处理 | P1 | 成功 N 条 / 失败 M 条提示 |

> **接口约定**：需对外提供 `resolveAllBotComments(prNumber)` 供成员 C 调用（新一轮审查前清旧评论）

---

#### 迭代二成员 C：审查控制命令（❌ 未实现）

| 任务 | 优先级 | 说明 |
|:---|:---:|:---|
| `review` 命令：增量审查触发 | P0 | 基于 `last_reviewed_sha` 计算增量 |
| `full review` 命令：全量审查触发 | P0 | 获取 base..HEAD 完整 diff |
| 审查状态持久化适配层 | P0 | 对接迭代一审查引擎 |
| `pause` 命令：暂停自动审查 | P1 | PR 级元数据存储暂停状态 |
| `resume` 命令：恢复自动审查 | P1 | 清除暂停状态 |
| push 事件审查门禁 | P1 | pause 状态下跳过自动审查 |
| `summary` 命令：重新生成摘要 | P1 | 基于当前最新代码重新生成 |
| `configuration` 命令：展示配置 | P2 | 格式化展示仓库审查配置 |
| Webhook 丢失兜底 | P1 | 支持手动触发 |

> **接口约定**：需对外提供 `triggerReview(mode)` 和 `isPaused()` 供成员 A 调用

---

#### 迭代二成员 D：对话交互与噪音控制（❌ 未实现）

**对话追问（2.3）：**

| 任务 | 优先级 | 说明 |
|:---|:---:|:---|
| 追问意图识别（区分追问 Bot 与普通评论）| P0 | `issue_comment` 场景 |
| Thread 完整对话历史收集与格式化 | P0 | |
| 关联代码行及扩展上下文提取 | P0 | |
| 对话 Prompt 组装 | P0 | 历史 + 代码 + diff + 仓库上下文 |
| LLM 对话推理调用（复用迭代一能力）| P0 | |
| 回复发布到 thread | P0 | |
| 对话上下文截断 + 摘要压缩 | P1 | 防 Token 超限 |
| 对话轮次上限控制 | P2 | |

**噪音控制（2.5）：**

| 任务 | 优先级 | 说明 |
|:---|:---:|:---|
| PR 顶部汇总评论生成 | P0 | 概述所有发现 |
| 同类评论合并去重 | P1 | 相同文件/类型问题合并 |
| 单次审查评论数量上限（N=20）| P1 | 按优先级截断 |
| 低优先级 `<details>` 折叠 | P2 | Minor/Nit 建议折叠 |

> **接口约定**：需对外提供 `postSummaryComment(prNumber, findings)` 和 `formatComments(findings)` 供成员 C 调用

---

### 3.3 进度热力图

```
迭代一（智能分析管线）    ████████████████████ 100%  ✅ 完成
迭代二-成员A（命令框架）  ████████████████████ 100%  ✅ 完成
迭代二-成员B（resolve）   ░░░░░░░░░░░░░░░░░░░░   0%  ❌ 未开始
迭代二-成员C（审查控制）  ░░░░░░░░░░░░░░░░░░░░   0%  ❌ 未开始
迭代二-成员D（对话+噪音） ░░░░░░░░░░░░░░░░░░░░   0%  ❌ 未开始
```

---

### 3.4 里程碑参考

| 里程碑 | 目标 | 交付内容 |
|:---|:---|:---|
| **M1 框架就绪** | 第 1 周末 | A 完成骨架（✅ 已达成）；B/C/D 完成接口 stub（✅ 已达成）|
| **M2 P0 联调** | 第 2 周末 | resolve / review / full review / 追问 / 汇总评论 P0 打通 |
| **M3 完整功能** | 第 3 周末 | pause/resume/summary/configuration + 噪音控制全部完成 |
| **M4 验收** | 第 4 周 | 对照验收标准全量回归 |

---

## 四、关键设计决策

### 4.1 双模型架构

- **轻量模型（lightBot，gpt-5.4-nano）**：文件摘要、变更分类（成本优化）
- **重量模型（heavyBot，gpt-5.4-mini）**：摘要合并、深度审查、对话追问（质量保障）

### 4.2 无数据库的状态持久化

状态全部以 HTML 注释形式存储在 GitHub 评论中，无需额外数据库或存储服务，GitHub Action 开箱即用。代价是状态操作需要读写评论 API，且格式为文本，容量有限。

### 4.3 命令框架的可扩展性

`CommandHandler` 接口设计使 B/C/D 成员可以独立注册命令，无需修改核心框架代码，通过 `bootstrapCommands()` 集中启动。

### 4.4 Token 预算策略

- 跨文件上下文上限：1500 tokens（控制 prompt 膨胀）
- 每批摘要合并：10 个文件（平衡质量与速本）
- `shortSummary` vs `rawSummary`：精简版用于每文件审查上下文，原始版存档

---

*本文档由 Claude Code 自动分析生成，基于源码及 docs/ 目录下设计文档。*
