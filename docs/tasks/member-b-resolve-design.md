---
title: 成员 B — resolve 命令设计文档
sidebar_label: 成员 B：resolve 命令
sidebar_position: 6
---

# 成员 B — `@codesentinel resolve` 命令设计文档

> **状态**: ❌ 未实现（Stub 已注册，待替换为真实 handler）
> **优先级**: P0
> **依赖方**: 成员 C（新一轮审查前可选调用 `resolveAllBotComments`）

---

## 1. 功能概述

### 1.1 用户场景

开发者修复完 CodeSentinel 提出的所有问题后，在 PR 评论区输入：

```
@codesentinel resolve
```

Bot 自动将当前 PR 中**所有 CodeSentinel 发出的、尚未解决的** review thread 批量标记为 Resolved，并回复：

```
✅ 已解决 12 条审查意见
```

无需开发者逐条手动点击 GitHub UI 中的 "Resolve conversation" 按钮。

### 1.2 使用价值

| 场景 | 说明 |
|:---|:---|
| **修复后清理** | 开发者提交修复后一键清理旧审查噪音，让人工 reviewer 专注未解决问题 |
| **新轮次审查前** | 成员 C 的 `review` / `full review` 命令可在触发前调用此接口清旧评论 |
| **视觉整洁** | 减少 PR 页面中已处理的折叠 thread 数量，降低认知负担 |

### 1.3 命令签名

```
@codesentinel resolve
```

- **无参数**（该命令不接受任何参数）
- **最低权限**: `write`（已在 stub 中配置：`minPermission: 'write'`）
- **需要 ACK**: 是（`needsAck: true`，dispatcher 会在 5 秒内发出 ⏳ 确认）

---

## 2. 实现细节

### 2.1 完整执行流程

```
用户评论 "@codesentinel resolve"
  │
  ├─→ [dispatcher 负责] 事件校验 / 幂等检查 / 权限校验 / 5秒 ACK
  │
  ▼ handler.execute(ctx) 入口
  │
  ├─→ Step 1: 获取 Bot 自身登录名
  │     └─→ octokit.users.getAuthenticated() 或读 options.botName
  │
  ├─→ Step 2: 分页查询 PR 所有 review threads（GraphQL）
  │     └─→ reviewThreads(first:100, after:cursor) 循环直到 hasNextPage=false
  │
  ├─→ Step 3: 过滤目标 threads
  │     ├─→ isResolved === false
  │     └─→ comments[0].author.login === botLogin
  │
  ├─→ Step 4: 并发批量 resolve（GraphQL mutation）
  │     ├─→ p-limit 并发数 = 6
  │     └─→ 收集成功/失败计数
  │
  ├─→ Step 5: 构造结果消息
  │     ├─→ 全部成功: "✅ 已解决 N 条审查意见"
  │     └─→ 部分失败: "⚠️ 共 N 条，成功 X 条，失败 Y 条"
  │
  └─→ return { message } → dispatcher 调用 reply.success(message, ackId)
```

### 2.2 GraphQL 查询（分页）

设计文档原始查询没有分页支持，PR 可能有 >100 个 review thread，**必须使用 cursor 分页**：

```graphql
query GetReviewThreads(
  $owner: String!
  $repo: String!
  $number: Int!
  $after: String
) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $after) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id          # GraphQL Node ID，传给 resolveReviewThread mutation
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
```

分页循环伪代码：

```typescript
async function fetchUnresolvedBotThreads(ctx, botLogin): Promise<Thread[]> {
  const results: Thread[] = []
  let cursor: string | null = null

  do {
    const data = await octokit.graphql(GET_REVIEW_THREADS, {
      owner: ctx.owner,
      repo: ctx.repo,
      number: ctx.prNumber,
      after: cursor
    })
    const page = data.repository.pullRequest.reviewThreads
    for (const node of page.nodes) {
      if (!node.isResolved && node.comments.nodes[0]?.author?.login === botLogin) {
        results.push(node)
      }
    }
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null
  } while (cursor)

  return results
}
```

### 2.3 GraphQL Mutation（批量 resolve）

```graphql
mutation ResolveThread($threadId: ID!) {
  resolveReviewThread(input: { threadId: $threadId }) {
    thread {
      isResolved
    }
  }
}
```

**并发控制**（使用已有的 `p-limit@4.0.0`）：

```typescript
import pLimit from 'p-limit'

async function batchResolve(threads: Thread[]): Promise<{ok: number; failed: number}> {
  const limit = pLimit(6)   // 与迭代一文件摘要并发数一致
  let ok = 0
  let failed = 0

  await Promise.allSettled(
    threads.map(t =>
      limit(async () => {
        try {
          await octokit.graphql(RESOLVE_THREAD, { threadId: t.id })
          ok++
        } catch {
          failed++
        }
      })
    )
  )
  return { ok, failed }
}
```

> **为什么用 `Promise.allSettled` 而不是 `Promise.all`**：单个 mutation 失败不应中断其他 thread 的解决，降级处理要求逐个计数。

### 2.4 Bot 身份识别

需要知道 Bot 自身的 GitHub 用户名，才能过滤出"Bot 发出的评论"。两种方案：

| 方案 | 实现 | 优劣 |
|:---|:---|:---|
| **运行时查询**（推荐） | `octokit.users.getAuthenticated()` | 准确，但多一次 API 调用；可缓存为模块级变量 |
| **配置读取** | `getInput('bot_name')` | 零 API 调用，但依赖用户配置正确 |

推荐优先读 `getInput('bot_name')`，为空时 fallback 到 `getAuthenticated()`，结果缓存在模块级变量避免重复调用。

### 2.5 结果反馈格式

```typescript
function formatResult(ok: number, failed: number, total: number): string {
  if (failed === 0) {
    return `✅ 已解决 **${ok}** 条 CodeSentinel 审查意见`
  }
  if (ok === 0) {
    return `❌ 解决失败，请检查 Bot 权限（pull-requests: write）`
  }
  return `⚠️ 共 **${total}** 条，成功解决 **${ok}** 条，**${failed}** 条失败（可手动解决）`
}
```

边界情况：

```typescript
if (threads.length === 0) {
  return { message: 'ℹ️ 没有找到待解决的 CodeSentinel 审查意见' }
}
```

### 2.6 错误处理

| 错误场景 | 处理方式 |
|:---|:---|
| GitHub API 限流（429）| octokit throttling 插件自动重试（已在 `octokit.ts` 配置） |
| GraphQL 权限不足 | 捕获异常，`reply.error('BOT_FORBIDDEN')` |
| 单个 thread resolve 失败 | `Promise.allSettled` 降级，计入 failed 计数 |
| PR 不存在 review threads | 返回 "没有找到待解决意见" |
| 获取 Bot 登录名失败 | 抛出错误，由 dispatcher 转为 `INTERNAL` |

---

## 3. 在整体架构中的定位

### 3.1 调用链路

```
GitHub Webhook
  (issue_comment / pr_review_comment)
        │
        ▼
  main.ts
  command-handler.ts
        │
        ▼
  dispatcher.ts  ──── [框架层，成员 A 负责] ────────────────────────
  │  Step 1: 事件类型校验                                           │
  │  Step 2: 提取 PR 元数据                                         │
  │  Step 3: Bot 自评论过滤                                         │
  │  Step 4: 解析命令 "resolve"                                     │
  │  Step 5: 幂等检查（PROCESSED_TAG）                              │
  │  Step 6: 速率限制（令牌桶）                                      │
  │  Step 7: 权限校验（write 级别）                                  │
  │  Step 8: ACK（⏳ 正在执行 resolve…）                            │
  └─────────────────────────────────────────────────────────────────
        │
        ▼ handler.execute(ctx)
  resolve.ts  ──── [业务层，成员 B 负责] ──────────────────────────
  │  获取 botLogin                                                  │
  │  分页 GraphQL 查询 reviewThreads                                │
  │  过滤: !isResolved && author === botLogin                       │
  │  p-limit(6) 并发 resolveReviewThread mutation                   │
  │  构造结果消息                                                    │
  └─────────────────────────────────────────────────────────────────
        │
        ▼ return { message }
  dispatcher.ts → reply.success(message, ackId)
  
        │（对外服务接口）
        ▼
  resolveAllBotComments(prNumber)
        └──→ 成员 C 在 review/full review 命令前可选调用
```

### 3.2 数据流

```
octokit.graphql(GET_REVIEW_THREADS)
  └─→ reviewThreads[].id + isResolved + author.login
        │
        ├─→ filter → 目标 thread 列表
        │
        └─→ p-limit(6) × octokit.graphql(RESOLVE_THREAD)
              └─→ { ok, failed } 统计
                    └─→ ctx.reply.success(formatResult(...))
```

### 3.3 接口契约

| 方向 | 接口 | 消费方 |
|:---|:---|:---|
| **对外提供** | `resolveAllBotComments(ctx \| {owner, repo, prNumber})` | 成员 C（`review` 命令前清旧评论） |
| **消费上游** | `CommandHandler` 接口（`execute(ctx)`） | 成员 A dispatcher |
| **消费基础设施** | `octokit.graphql()` | 已有 octokit 单例 |
| **消费并发工具** | `p-limit@4.0.0` | 已有依赖，无需新增 |

---

## 4. 技术选型

### 4.1 现有框架 vs NestJS

**结论：沿用现有 TypeScript + octokit 框架，不引入 NestJS。**

| 维度 | 现有框架 | NestJS |
|:---|:---|:---|
| **运行模型** | GitHub Action：触发 → 执行 → 退出（无状态，一次性） | 为长驻 HTTP server 设计，需要持久进程 |
| **DI 容器** | 函数式组合，无需 DI | 强制 `@Module / @Injectable` 装饰器体系 |
| **GraphQL 客户端** | `octokit.graphql()` 原生支持，已集成重试+限流 | 需额外引入 `@nestjs/graphql`，反而绕弯 |
| **命令接入** | 实现 `CommandHandler` 接口，一个文件搞定 | 需 AppModule / Provider / Controller 全套 |
| **冷启动** | ~200ms（Node.js + 少量依赖） | NestJS 初始化本身 500ms+，对 Action 来说是纯损耗 |
| **测试** | 现有 jest + 7 个测试文件，直接覆盖 | 需要 `@nestjs/testing` + `Test.createTestingModule` 套件 |
| **新增依赖** | 零（`p-limit` 已有） | `@nestjs/core`, `@nestjs/common`, `reflect-metadata` 等 |

NestJS 的核心价值（DI、路由中间件、守卫、管道、拦截器）全部已由**成员 A 的命令框架**以更轻量的方式实现：

- 路由 → `registry.ts` 命令注册表
- 权限守卫 → `permission.ts`
- 速率限制 → `rate-limit.ts`
- 幂等拦截 → `dispatcher.ts` + `PROCESSED_TAG`
- 统一响应 → `reply.ts`

### 4.2 GraphQL 分页：游标 vs offset

GitHub GraphQL API 只支持**游标分页**（cursor-based），不支持 offset 分页。`reviewThreads(first: 100, after: $cursor)` 是唯一正确方式。

### 4.3 并发策略：p-limit vs 串行

| 策略 | 耗时（20 个 thread） | 风险 |
|:---|:---|:---|
| 串行 | ~20s（每次 ~1s RTT） | 慢，超过 Action 超时风险 |
| `p-limit(6)` | ~3-4s | 与迭代一一致，经过验证 |
| 全并发 | ~1s | 可能触发 GitHub secondary rate limit |

选 `p-limit(6)` 与迭代一文件摘要并发数保持一致，已有实测依据。

---

## 5. 文件结构与接入方式

### 5.1 新增文件

```
src/
  commands/
    handlers/
      resolve.ts          ← 新建（核心 handler）
  github/
    review-thread.ts      ← 建议独立（GraphQL 查询 + mutation，便于单独测试）
```

### 5.2 修改文件

```
src/
  commands/
    bootstrap.ts          ← 将 resolveStub 替换为 resolveHandler（1行改动）
    handlers/
      stubs.ts            ← 移除 resolveStub（或保留但不再注册）
```

### 5.3 resolve.ts 结构

```typescript
// src/commands/handlers/resolve.ts

import type { CommandHandler, CommandContext, CommandResult } from '../types'
import { fetchUnresolvedBotThreads } from '../../github/review-thread'
import { batchResolve } from '../../github/review-thread'
import { getBotLogin } from '../../github/review-thread'

export const resolveHandler: CommandHandler = {
  name: 'resolve',
  description: '批量将所有 CodeSentinel 审查意见标记为已解决',
  usage: '@ai-reviewer resolve',
  needsAck: true,
  minPermission: 'write',
  execute
}

async function execute(ctx: CommandContext): Promise<CommandResult> {
  const botLogin = await getBotLogin(ctx.options)
  const threads = await fetchUnresolvedBotThreads(ctx, botLogin)

  if (threads.length === 0) {
    return { message: 'ℹ️ 没有找到待解决的 CodeSentinel 审查意见' }
  }

  const { ok, failed } = await batchResolve(threads)
  return { message: formatResult(ok, failed, threads.length) }
}

/** 对外服务接口（供成员 C 调用） */
export async function resolveAllBotComments(params: {
  owner: string
  repo: string
  prNumber: number
  options: Options
}): Promise<{ ok: number; failed: number }> {
  const botLogin = await getBotLogin(params.options)
  const threads = await fetchUnresolvedBotThreads(params, botLogin)
  return batchResolve(threads)
}
```

### 5.4 bootstrap.ts 接入（1 行改动）

```typescript
// 原来
import {ALL_STUBS} from './handlers/stubs'
// ...
for (const h of ALL_STUBS) { reg.register(h) }

// 改为
import {resolveHandler} from './handlers/resolve'
import {ALL_STUBS} from './handlers/stubs'   // ALL_STUBS 中移除 resolveStub
// ...
reg.register(resolveHandler)
for (const h of ALL_STUBS) { reg.register(h) }
```

---

## 6. 测试策略

### 6.1 单元测试（`__tests__/resolve.test.ts`）

| 用例 | 验证点 |
|:---|:---|
| 无待解决 thread | 返回 "没有找到" 消息 |
| 全部成功 | 返回 "✅ 已解决 N 条" |
| 部分失败 | 返回 "⚠️ 共 N 条，成功 X，失败 Y" |
| 全部失败 | 返回权限不足提示 |
| 分页场景（>100 threads）| GraphQL 被调用 2+ 次，结果合并正确 |
| Bot 自身发的 thread 被过滤 | 非 Bot 发的 thread 不被解决 |
| 已 resolved thread 被跳过 | isResolved=true 的 thread 不再调用 mutation |

### 6.2 集成测试建议

使用 `nock` 或 `msw` mock GitHub GraphQL 端点，验证：
- 分页循环终止条件
- `p-limit(6)` 并发控制（mock 并发计数）
- octokit throttling 插件在 429 时的重试行为

---

## 7. GitHub API 限额说明

| API | 限额 | 说明 |
|:---|:---|:---|
| GraphQL 查询 | 5000 点/小时 | 分页查询每次约 1 点 |
| `resolveReviewThread` mutation | 5000 点/小时 | 每次约 1 点 |
| Secondary rate limit | 约 80 请求/分钟 | p-limit(6) 下不会触发 |

正常 PR 场景（审查意见 <100 条）：总消耗 < 110 点，远低于限额。

---

## 8. 工作量评估

| 任务 | 优先级 | 预估工时 |
|:---|:---|:---|
| `review-thread.ts`：GraphQL 查询（含分页） | P0 | 3h |
| `review-thread.ts`：batch resolve + p-limit | P0 | 2h |
| Bot 身份识别（`getBotLogin`） | P0 | 1h |
| `resolve.ts` handler 主逻辑 | P0 | 2h |
| `resolveAllBotComments` 对外接口 | P0 | 0.5h |
| 结果格式化 + 边界情况处理 | P1 | 1h |
| 部分失败降级 | P1 | 0.5h |
| 单元测试（7 个用例） | P0 | 3h |
| bootstrap 接入 + 联调 | P0 | 1h |
| **合计** | | **~14h（约 2 个工作日）** |
PS. 实际预计7～10个工作日，包括代码审核、模块对接以及技术沟通
