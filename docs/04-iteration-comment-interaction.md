---
title: 迭代二：评论区交互 — Bot 命令与对话式审查
sidebar_label: 02 迭代二：评论区交互
sidebar_position: 4
---

# 迭代二：评论区交互 — Bot 命令与对话式审查

> **迭代目标**: 实现 CodeSentinel Bot 在 PR 评论区的完整交互能力，包括命令系统（如 `@codesentinel resolve`）、对话式追问、增量审查触发等，使 Bot 成为可被开发者"指挥"的智能审查助手。

> **对标功能**: CodeRabbit 商业版 7.1 节 — 对话交互 & 7.3 节 — 评论命令系统

> **前置依赖**: 迭代一（智能分析管线）

---

## 1. 迭代范围

本迭代聚焦于 PR 评论区的人机交互体验：

| 模块         | 能力                 | 说明                                        |
| :----------- | :------------------- | :------------------------------------------ |
| **命令系统** | 评论命令解析与执行   | 通过 `@codesentinel <command>` 触发各类操作 |
| **对话交互** | 上下文对话式追问     | 开发者对某条审查意见追问，Bot 带上下文回答  |
| **审查控制** | 增量/全量审查触发    | 通过评论命令重新触发审查                    |
| **状态管理** | resolve/dismiss 标记 | 批量解决审查意见、管理审查状态              |
| **通知优化** | 评论噪音控制         | 折叠低优先级建议、合并同类评论              |

---

## 2. 功能详细设计

### 2.1 命令系统设计

#### 2.1.1 命令总览

以下为 CodeSentinel Bot 支持的评论命令，按使用频率排序：

| 命令                          | 用途                                     | 优先级 |
| :---------------------------- | :--------------------------------------- | :----- |
| `@codesentinel review`        | 触发增量审查（仅看最新变更）             | P0     |
| `@codesentinel full review`   | 触发全量审查（所有文件从头审查）         | P0     |
| `@codesentinel resolve`       | 将所有 CodeSentinel 审查意见标记为已解决 | P0     |
| `@codesentinel summary`       | 重新生成 PR 摘要                         | P1     |
| `@codesentinel pause`         | 暂停对当前 PR 的自动审核                 | P1     |
| `@codesentinel resume`        | 恢复对当前 PR 的自动审核                 | P1     |
| `@codesentinel configuration` | 显示当前仓库的审查配置                   | P2     |
| `@codesentinel help`          | 显示帮助信息                             | P0     |

#### 2.1.2 命令解析流程

```
GitHub Webhook (issue_comment / pull_request_review_comment)
  │
  ├─→ 事件过滤
  │     ├─→ 是否为 PR 相关评论？
  │     ├─→ 是否包含 @codesentinel 前缀？
  │     └─→ 评论者是否有仓库权限？
  │
  ├─→ 命令解析
  │     ├─→ 提取命令名称
  │     ├─→ 提取命令参数
  │     └─→ 校验命令合法性
  │
  ├─→ 命令路由
  │     ├─→ review / full review → 审查引擎
  │     ├─→ resolve → 状态管理器
  │     ├─→ pause / resume → PR 状态控制
  │     └─→ help / configuration → 信息查询
  │
  └─→ 结果反馈
        ├─→ 评论回复确认
        └─→ 执行结果展示
```

#### 2.1.3 工作项

| 任务             | 说明                                                       | 优先级 |
| :--------------- | :--------------------------------------------------------- | :----- |
| Webhook 事件监听 | 监听 `issue_comment` 和 `pull_request_review_comment` 事件 | P0     |
| 命令解析器       | 正则提取 `@codesentinel` 后的命令与参数                    | P0     |
| 命令权限校验     | 校验评论者是否有权执行该命令                               | P0     |
| 命令路由分发     | 将解析后的命令分发到对应处理器                             | P0     |
| help 命令实现    | 返回格式化的帮助信息                                       | P0     |
| 错误处理与反馈   | 无效命令、权限不足等场景的友好提示                         | P1     |

---

### 2.2 `@codesentinel resolve` 功能

#### 2.2.1 功能描述

这是开发者最高频使用的命令之一。当开发者确认已修复所有审查意见后，通过一条命令批量解决所有 CodeSentinel 发出的 review comments，无需逐条手动点击 "Resolve"。

**使用场景：**

- 开发者修复了审查问题后，一键将所有 CodeSentinel 评论标记为已解决
- 清理 PR 页面，减少视觉噪音，让人工 reviewer 专注于未解决的问题
- 在触发新一轮审查前，先 resolve 旧评论

#### 2.2.2 技术方案

```
@codesentinel resolve
  │
  ├─→ 查询当前 PR 所有 review comments
  │     └─→ 过滤出 CodeSentinel Bot 发出的评论
  │
  ├─→ 过滤未解决的评论
  │     └─→ 排除已经 resolved 的 thread
  │
  ├─→ 批量调用 GitHub API
  │     ├─→ GraphQL: minimizeComment 或 resolveReviewThread
  │     └─→ 并发控制（避免 API Rate Limit）
  │
  └─→ 反馈结果
        └─→ 回复评论："✅ 已解决 N 条审查意见"
```

#### 2.2.3 GitHub API 调用

```graphql
# 查询 PR 的 review threads
query {
	repository(owner: $owner, name: $repo) {
		pullRequest(number: $prNumber) {
			reviewThreads(first: 100) {
				nodes {
					id
					isResolved
					comments(first: 1) {
						nodes {
							author {
								login
							}
						}
					}
				}
			}
		}
	}
}

# 解决 review thread
mutation {
	resolveReviewThread(input: { threadId: $threadId }) {
		thread {
			isResolved
		}
	}
}
```

#### 2.2.4 工作项

| 任务                       | 说明                                 | 优先级 |
| :------------------------- | :----------------------------------- | :----- |
| 实现 PR review thread 查询 | 通过 GraphQL 获取所有 review threads | P0     |
| 实现 Bot 评论过滤          | 准确识别 CodeSentinel Bot 发出的评论 | P0     |
| 实现批量 resolve           | 并发调用 resolveReviewThread，带限流 | P0     |
| 实现结果反馈               | 回复解决数量统计                     | P1     |
| 处理部分失败               | 部分 thread resolve 失败时的降级处理 | P1     |

---

### 2.3 对话式追问交互

#### 2.3.1 功能描述

开发者可以在审查评论的回复中 `@codesentinel` 进行追问，Bot 携带以下上下文进行回答：

- **当前 thread 的完整对话历史**
- **该评论关联的代码行及上下文**
- **PR 的 diff 与描述**
- **仓库相关文件**（继承迭代一的上下文检索能力）

**典型对话场景：**

```
CodeSentinel: ⚠️ 这里使用 map() 应改为 forEach()，因为 URLSearchParams 没有 map 方法
Developer:  @codesentinel 为什么不能用 Array.from() 转换后再 map？
CodeSentinel: Array.from(searchParams) 可以工作，但返回的是 [key, value]
              entry 数组。如果只需要遍历赋值，forEach 更简洁且无额外内存分配。
              如果确实需要 map 的返回值，推荐：
              Array.from(searchParams, ([key, value]) => { params[key] = value })
```

#### 2.3.2 技术方案

```
评论回复事件
  │
  ├─→ 判断是否为追问
  │     ├─→ 是否 @codesentinel 或回复了 Bot 评论
  │     └─→ 是否为 review thread 内的回复
  │
  ├─→ 上下文收集
  │     ├─→ 完整 thread 对话历史
  │     ├─→ 关联代码行及扩展上下文
  │     ├─→ PR diff 与描述
  │     └─→ 仓库相关文件（迭代一能力）
  │
  ├─→ LLM 对话推理
  │     ├─→ 组装对话 Prompt
  │     ├─→ 调用 LLM 生成回答
  │     └─→ 支持 Analysis Chain / Web Query
  │
  └─→ 回复评论
        └─→ 发布到 thread 中
```

#### 2.3.3 工作项

| 任务              | 说明                                 | 优先级 |
| :---------------- | :----------------------------------- | :----- |
| 追问意图识别      | 区分"追问 Bot"与"普通评论"           | P0     |
| Thread 上下文收集 | 获取完整对话历史并格式化             | P0     |
| 代码行上下文关联  | 从 review comment 中提取关联代码位置 | P0     |
| 对话 Prompt 组装  | 将对话历史 + 代码上下文组装为 Prompt | P0     |
| 回复发布          | 将 LLM 回答发布为 thread 回复        | P0     |
| 对话轮次限制      | 防止无限对话消耗资源，设置最大轮次   | P2     |

---

### 2.4 审查控制命令

#### 2.4.1 增量审查（`@codesentinel review`）

触发一次增量审查，仅审查自上次审查以来新增的 diff：

```
@codesentinel review
  │
  ├─→ 查询上次审查的 commit SHA
  ├─→ 获取 last_reviewed_sha..HEAD 的增量 diff
  ├─→ 调用迭代一审查引擎
  └─→ 发布审查结果
```

#### 2.4.2 全量审查（`@codesentinel full review`）

从头审查整个 PR 的所有变更：

```
@codesentinel full review
  │
  ├─→ 获取 base..HEAD 的完整 diff
  ├─→ 调用迭代一审查引擎（忽略历史审查状态）
  └─→ 发布审查结果
```

#### 2.4.3 暂停/恢复（`@codesentinel pause` / `resume`）

```
@codesentinel pause
  │
  ├─→ 在 PR metadata 中标记暂停状态
  ├─→ 后续 push 事件不再自动触发审查
  └─→ 回复："⏸️ 已暂停自动审查。使用 @codesentinel resume 恢复"

@codesentinel resume
  │
  ├─→ 清除暂停状态
  ├─→ 恢复自动审查
  └─→ 回复："▶️ 已恢复自动审查"
```

#### 2.4.4 工作项

| 任务                  | 说明                                 | 优先级 |
| :-------------------- | :----------------------------------- | :----- |
| 增量审查触发          | 基于 last_reviewed_sha 计算增量 diff | P0     |
| 全量审查触发          | 获取完整 diff 并触发审查             | P0     |
| 审查状态持久化        | 记录每次审查对应的 commit SHA        | P0     |
| pause/resume 状态管理 | PR 级别的暂停/恢复状态存储           | P1     |
| summary 重新生成      | 基于当前最新代码重新生成 PR 摘要     | P1     |
| configuration 展示    | 格式化展示当前仓库配置               | P2     |

---

### 2.5 评论噪音控制

#### 2.5.1 功能描述

避免 Bot 评论过多干扰开发者，需要：

- **同类评论合并**：相同类型的问题合并为一条评论
- **低优先级折叠**：Minor/Nit 级别建议默认折叠
- **评论总量限制**：单次审查最多发布 N 条评论（建议 N=20）
- **摘要评论**：在 PR 顶部发布一条汇总评论，概述所有发现

#### 2.5.2 工作项

| 任务         | 说明                                  | 优先级 |
| :----------- | :------------------------------------ | :----- |
| 评论去重     | 相同文件/相同类型问题合并             | P1     |
| 评论数量限制 | 超出限制时按优先级截断                | P1     |
| 汇总评论生成 | PR 级别的审查摘要评论                 | P0     |
| 低优先级折叠 | 使用 `<details>` 标签折叠低优先级建议 | P2     |

---

## 3. 交互流程示例

### 3.1 完整交互时序

```
Developer                     CodeSentinel Bot                GitHub
  │                                │                           │
  │── push commits ──────────────▶│                           │
  │                                │── 自动触发审查 ──────────▶│
  │                                │                           │
  │◀── 发布审查评论 ──────────────│◀── PR comments ───────────│
  │                                │                           │
  │── @codesentinel resolve ─────▶│                           │
  │                                │── 批量 resolve threads ──▶│
  │◀── "✅ 已解决 5 条意见" ──────│                           │
  │                                │                           │
  │── fix code & push ───────────▶│                           │
  │                                │── 增量审查 ──────────────▶│
  │◀── 新审查结果 ────────────────│                           │
  │                                │                           │
  │── @codesentinel 为什么... ───▶│                           │
  │                                │── LLM 对话推理           │
  │◀── 详细解释回复 ──────────────│                           │
  │                                │                           │
  │── @codesentinel pause ───────▶│                           │
  │◀── "⏸️ 已暂停" ──────────────│                           │
```

---

## 4. 验收标准

| 验收项       | 标准                                              |
| :----------- | :------------------------------------------------ |
| 命令解析     | 所有列出的命令均能正确解析和执行                  |
| resolve      | 一条命令能批量解决所有 Bot 发出的 review comments |
| 增量审查     | 仅审查自上次审查以来的新增变更                    |
| 全量审查     | 能从头审查整个 PR 的所有变更                      |
| 对话追问     | 在 review thread 中追问时，Bot 能带上下文回答     |
| pause/resume | 暂停后不再自动审查，恢复后重新启用                |
| 噪音控制     | 单次审查评论数有上限，低优先级建议折叠            |
| 错误处理     | 无效命令、权限不足等场景有友好提示                |
| 响应时间     | 命令响应（非审查）在 5 秒内回复确认               |

---

## 5. 依赖与风险

| 风险                  | 说明                        | 缓解措施                   |
| :-------------------- | :-------------------------- | :------------------------- |
| GitHub API Rate Limit | 批量 resolve 可能触发限流   | 并发控制 + 指数退避重试    |
| Webhook 丢失          | GitHub Webhook 可能偶发丢失 | 支持手动触发兜底           |
| 对话上下文膨胀        | 长对话导致 Token 超限       | 对话历史截断 + 摘要压缩    |
| 命令注入              | 恶意评论可能尝试注入命令    | 严格命令白名单 + 参数校验  |
| Bot 权限不足          | 安装时未授予足够权限        | 检测权限不足时给出明确提示 |
