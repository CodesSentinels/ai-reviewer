---
name: CodeSentinel 开发进度
description: 各迭代模块的完成状态、未完成任务清单、里程碑与跨成员接口契约
type: project
originSessionId: 241598dd-e0dc-4f9d-b926-e93bfc101594
---
# CodeSentinel 开发进度（截至 2026-05-13）

## 完成情况总览
```
迭代一（智能分析管线）    ████████████████████ 100%  ✅ 完成
迭代二-成员A（命令框架）  ████████████████████ 100%  ✅ 完成
迭代二-成员B（resolve）   ░░░░░░░░░░░░░░░░░░░░   0%  🔄 进行中（用户负责）
迭代二-成员C（审查控制）  ░░░░░░░░░░░░░░░░░░░░   0%  ❌ 未开始
迭代二-成员D（对话+噪音） ░░░░░░░░░░░░░░░░░░░░   0%  ❌ 未开始
```

**Why:** 记录此状态用于后续对话快速定位上下文，避免重复分析已完成工作。
**How to apply:** 讨论实现方案时以此为基准，不重复讨论已完成模块。

---

## ✅ 已完成：迭代一（智能分析管线）

| 模块 | 文件 |
|:---|:---|
| PR 增量审查引擎（四阶段流水线） | `review.ts` |
| 行级评论生成与提交 | `commenter.ts` + GitHub Review API |
| PR 摘要生成（Walkthrough + 发布说明） | `prompts.ts` + `commenter.ts` |
| 对话式追问（pull_request_review_comment） | `review-comment.ts` |
| 跨文件依赖分析（TS/JS/Python/Go/Java/Vue） | `dependency-analyzer.ts` |
| OpenAI Responses API 集成（Shell + WebSearch） | `bot.ts` |
| Analysis Chain 推理步骤展示 | `bot.ts` → prompts |
| Token 预算管理 | `limits.ts` + `tokenizer.ts` |
| 增量审查状态持久化 | HTML 注释标签方案 |
| 路径过滤（glob 规则） | `options.ts` → PathFilter |
| 并发控制 + API 重试 | `p-limit` + `p-retry` + octokit 插件 |

## ✅ 已完成：迭代二成员 A（命令框架）

分支：`feature/cmd`（+3647 行 / 28 文件）。框架层已完整，B/C/D 只需实现 handler 接口并替换 stub。

已完成模块：`types.ts` / `parser.ts` / `registry.ts` / `dispatcher.ts` / `permission.ts` / `rate-limit.ts` / `reply.ts` / `reaction.ts` / `early-reaction.ts` / `bootstrap.ts` / `handlers/help.ts` / `handlers/stubs.ts`（7 个占位）

测试：7 个测试文件，182 个测试，全部通过。

---

## 🔄 进行中：迭代二成员 B（resolve 命令）

> 用户当前正在推进此模块，见 `memory/member_b_resolve.md` 追踪详细进度

**需新增文件：**
- `src/commands/handlers/resolve.ts`（核心 handler）
- `src/github/review-thread.ts`（GraphQL 查询 + mutation，建议独立便于测试）

**需修改文件：**
- `src/commands/handlers/stubs.ts`：移除 `resolveStub`
- `src/commands/bootstrap.ts`：将 `resolveStub` 替换为 `resolveHandler`（1 行改动）

**对外提供接口：** `resolveAllBotComments({owner, repo, prNumber, options})` → 供成员 C 在新一轮审查前调用

---

## ❌ 未开始：迭代二成员 C（审查控制命令）

| 任务 | 优先级 |
|:---|:---:|
| `review` 命令：增量审查触发（基于 `last_reviewed_sha`） | P0 |
| `full review` 命令：全量审查触发（base..HEAD） | P0 |
| 审查状态持久化适配层（对接迭代一引擎） | P0 |
| `pause` 命令：暂停自动审查（PR 级元数据） | P1 |
| `resume` 命令：恢复自动审查 | P1 |
| push 事件审查门禁（pause 状态跳过） | P1 |
| `summary` 命令：重新生成摘要 | P1 |
| `configuration` 命令：展示配置 | P2 |
| Webhook 丢失兜底 | P1 |

**对外提供接口：** `triggerReview(mode)` + `isPaused()` 供成员 A 调用

---

## ❌ 未开始：迭代二成员 D（对话交互与噪音控制）

**对话追问（P0）：** 追问意图识别、Thread 历史收集、代码行上下文、Prompt 组装、LLM 调用、回复发布
**噪音控制（P0）：** PR 顶部汇总评论生成
**噪音控制（P1）：** 同类评论合并去重、单次审查评论上限（N=20）
**噪音控制（P2）：** 低优先级 `<details>` 折叠

**对外提供接口：** `postSummaryComment(prNumber, findings)` + `formatComments(findings)` 供成员 C 调用

---

## 里程碑

| 里程碑 | 目标 | 状态 |
|:---|:---|:---|
| **M1 框架就绪** | 第 1 周末 | ✅ 已达成（A 骨架 + B/C/D stubs）|
| **M2 P0 联调** | 第 2 周末 | 🔄 进行中（B 在实现 resolve）|
| **M3 完整功能** | 第 3 周末 | ❌ 未开始 |
| **M4 验收** | 第 4 周 | ❌ 未开始 |

---

## 跨成员接口契约

| 提供方 | 消费方 | 接口 |
|:---|:---|:---|
| A | B/C/D | `CommandHandler` 注册、`ctx.reply` 统一回复工具 |
| B | C（可选） | `resolveAllBotComments()` |
| C | A | `triggerReview()`、`isPaused()` |
| D | C | `postSummaryComment()`、`formatComments()` |
