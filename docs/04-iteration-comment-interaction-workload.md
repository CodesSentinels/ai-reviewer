---
title: 迭代二：评论区交互 — 4人工作量拆分
sidebar_label: 02-1 迭代二工作量拆分
sidebar_position: 5
---

# 迭代二：评论区交互 — 4 人工作量拆分

> **源文档**: [04-iteration-comment-interaction.md](04-iteration-comment-interaction.md)
> **拆分原则**: 按模块内聚、接口清晰、工作量均衡（每人约覆盖 25% 工作项），同时尽量减少跨人依赖。
> **协作约定**: 命令解析器（A）作为入口分发，B/C/D 通过统一的 `CommandHandler` 接口接入。

---

## 0. 总览

| 成员 | 角色定位 | 核心模块 | 工作量占比 |
| :--- | :------- | :------- | :--------- |
| **成员 A** | 平台与命令框架 | Webhook 接入、命令解析、路由、权限、help、错误处理 | ~25% |
| **成员 B** | 状态管理与 resolve | `resolve`、review thread 查询、Bot 评论识别、批量限流 | ~25% |
| **成员 C** | 审查控制与状态持久化 | `review` / `full review` / `pause` / `resume` / `summary` / `configuration` | ~25% |
| **成员 D** | 对话交互与噪音控制 | 追问对话、上下文收集、LLM 调用、汇总评论、噪音控制 | ~25% |

---

## 1. 成员 A — 平台与命令框架（入口层）

### 负责模块
- 2.1 命令系统设计（全部）
- 跨模块的错误处理与反馈基线

### 工作项

| 任务 | 来源 | 优先级 |
| :--- | :--- | :----- |
| Webhook 事件监听（`issue_comment` / `pull_request_review_comment`） | 2.1.3 | P0 |
| 命令解析器（正则提取 `@codesentinel <cmd> <args>`） | 2.1.3 | P0 |
| 命令权限校验（评论者仓库权限） | 2.1.3 | P0 |
| 命令路由分发（CommandHandler 接口 + 注册表） | 2.1.3 | P0 |
| `help` 命令实现 | 2.1.3 | P0 |
| 错误处理与友好反馈（无效命令 / 权限不足 / Bot 权限不足） | 2.1.3 / §5 | P1 |
| 命令注入防护（白名单 + 参数校验） | §5 | P0 |
| 命令响应时延保障（5 秒内确认） | §4 | P0 |

### 对外提供
- `CommandHandler` 注册接口供 B/C/D 接入
- 统一的评论回复工具方法（成功/失败/进度）
- Webhook 事件去重与幂等基线

---

## 2. 成员 B — 状态管理与 resolve

### 负责模块
- 2.2 `@codesentinel resolve`（全部）

### 工作项

| 任务 | 来源 | 优先级 |
| :--- | :--- | :----- |
| 通过 GraphQL 查询 PR 所有 review threads | 2.2.4 | P0 |
| 准确识别 CodeSentinel Bot 发出的评论（过滤逻辑） | 2.2.4 | P0 |
| 排除已 resolved thread | 2.2.2 | P0 |
| 批量调用 `resolveReviewThread`，并发控制 + 限流 | 2.2.4 | P0 |
| Rate Limit 指数退避重试 | §5 | P0 |
| 解决数量统计与结果反馈评论 | 2.2.4 | P1 |
| 部分失败降级处理（成功 N 条，失败 M 条提示） | 2.2.4 | P1 |

### 对外提供
- `resolveAllBotComments(prNumber)` 服务接口（供 C 在新一轮审查前可选调用）

---

## 3. 成员 C — 审查控制与状态持久化

### 负责模块
- 2.4 审查控制命令（全部）

### 工作项

| 任务 | 来源 | 优先级 |
| :--- | :--- | :----- |
| `@codesentinel review` 增量审查触发（基于 `last_reviewed_sha`） | 2.4.1 / 2.4.4 | P0 |
| `@codesentinel full review` 全量审查触发（base..HEAD） | 2.4.2 / 2.4.4 | P0 |
| 审查状态持久化（每次审查的 commit SHA 记录） | 2.4.4 | P0 |
| 对接迭代一审查引擎（适配层） | 2.4.1 / 2.4.2 | P0 |
| `@codesentinel pause` / `resume` 状态管理（PR 级元数据存储） | 2.4.3 / 2.4.4 | P1 |
| push 事件审查门禁（pause 状态下跳过自动审查） | 2.4.3 | P1 |
| `@codesentinel summary` 重新生成 PR 摘要 | 2.4.4 | P1 |
| `@codesentinel configuration` 配置展示 | 2.4.4 | P2 |
| Webhook 丢失兜底（手动触发能力） | §5 | P1 |

### 对外提供
- `triggerReview(mode: incremental | full)` 给 A 路由调用
- PR 暂停状态查询接口给 A 在自动审查链路上判断

---

## 4. 成员 D — 对话交互与噪音控制

### 负责模块
- 2.3 对话式追问交互（全部）
- 2.5 评论噪音控制（全部）

### 工作项

#### 对话追问（2.3）

| 任务 | 来源 | 优先级 |
| :--- | :--- | :----- |
| 追问意图识别（区分追问 Bot 与普通评论） | 2.3.3 | P0 |
| Thread 完整对话历史收集与格式化 | 2.3.3 | P0 |
| 关联代码行及扩展上下文提取 | 2.3.3 | P0 |
| 对话 Prompt 组装（历史 + 代码 + diff + 仓库上下文） | 2.3.3 | P0 |
| LLM 对话推理调用（复用迭代一 Analysis Chain / Web Query） | 2.3.2 | P0 |
| 回复发布到 thread | 2.3.3 | P0 |
| 对话上下文截断 + 摘要压缩（防 Token 超限） | §5 | P1 |
| 对话轮次上限控制 | 2.3.3 | P2 |

#### 噪音控制（2.5）

| 任务 | 来源 | 优先级 |
| :--- | :--- | :----- |
| PR 顶部汇总评论生成 | 2.5.2 | P0 |
| 同类评论合并去重 | 2.5.2 | P1 |
| 单次审查评论数量上限（建议 N=20，按优先级截断） | 2.5.2 | P1 |
| 低优先级 `<details>` 折叠 | 2.5.2 | P2 |

### 对外提供
- `postSummaryComment(prNumber, findings)` 给 C 在审查完成后调用
- `formatComments(findings)` 通用评论渲染（去重 + 截断 + 折叠）

---

## 5. 跨人依赖与里程碑

### 接口契约（需在 M1 之前对齐）

| 提供方 | 消费方 | 接口 |
| :----- | :----- | :--- |
| A | B / C / D | `CommandHandler` 注册、统一回复工具 |
| C | A | `triggerReview()`、`isPaused()` |
| B | C（可选） | `resolveAllBotComments()`（用于"审查前清旧评论"场景） |
| D | C | `postSummaryComment()`、`formatComments()` |
| D | 迭代一 | LLM 调用、上下文检索复用 |

### 里程碑

| 里程碑 | 时间点 | 交付内容 |
| :----- | :----- | :------- |
| **M1 框架就绪** | 第 1 周末 | A 完成 Webhook + 解析 + 路由骨架；B/C/D 完成接口 stub |
| **M2 P0 联调** | 第 2 周末 | resolve / review / full review / 追问 / 汇总评论 P0 全部打通 |
| **M3 完整功能** | 第 3 周末 | pause/resume/summary/configuration + 噪音控制全部完成 |
| **M4 验收** | 第 4 周 | 对照 §4 验收标准全量回归，覆盖 §5 风险缓解 |

---

## 6. 工作量平衡说明

| 成员 | P0 任务数 | P1 任务数 | P2 任务数 | 复杂度备注 |
| :--- | :-------: | :-------: | :-------: | :--------- |
| A | 6 | 1 | 0 | 框架性工作，接口设计权重高 |
| B | 5 | 2 | 0 | GraphQL + 限流，技术深度集中 |
| C | 4 | 4 | 1 | 命令最多，但单个逻辑较轻 |
| D | 6 | 3 | 2 | 涉及 LLM，调试成本较高 |

四人 P0 任务数接近，B 偏深、C 偏广、D 偏 LLM、A 偏框架，整体均衡。
