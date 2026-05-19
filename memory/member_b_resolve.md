---
name: 成员B resolve命令实现进度
description: @codesentinel resolve 命令完整实现记录：技术方案、GraphQL 查询、并发策略、测试用例（已完成）
type: project
originSessionId: 241598dd-e0dc-4f9d-b926-e93bfc101594
---
# 成员 B — `@codesentinel resolve` 实现进度

> **当前状态**: ✅ 实现完成，192 个测试全绿
> **最后更新**: 2026-05-13（编码完成）
> **分支**: `feat/resolveReviewThread`

**Why:** 记录完整技术方案供后续命令实现参考（GraphQL 分页、p-limit 并发、Promise.allSettled 降级模式均可复用）。
**How to apply:** 实现其他命令时参考此文件的并发策略和结果格式化模式。若分支已合并，可归档此文件。

---

## 功能目标

开发者在 PR 评论区输入 `@codesentinel resolve`，Bot 自动批量将所有 CodeSentinel 发出的、尚未 resolved 的 review thread 标记为 Resolved，并回复 `✅ 已解决 N 条审查意见`。

---

## 技术方案

### 核心执行流程
```
handler.execute(ctx) 入口
  ├─ Step 1: 获取 Bot 自身登录名（优先 getInput('bot_name')，fallback getAuthenticated()，模块级缓存）
  ├─ Step 2: 分页查询 PR 所有 review threads（GraphQL cursor 分页，每页 100 条）
  ├─ Step 3: 过滤目标 threads（isResolved === false && author.login === botLogin）
  ├─ Step 4: p-limit(6) 并发批量 resolveReviewThread mutation
  └─ Step 5: 构造结果消息 → return { message }
```

### GraphQL 查询（支持 cursor 分页）
```graphql
query GetReviewThreads($owner: String!, $repo: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $after) {
        pageInfo { hasNextPage, endCursor }
        nodes {
          id
          isResolved
          comments(first: 1) { nodes { author { login } } }
        }
      }
    }
  }
}
```

### GraphQL Mutation
```graphql
mutation ResolveThread($threadId: ID!) {
  resolveReviewThread(input: { threadId: $threadId }) {
    thread { isResolved }
  }
}
```

### 并发策略
- `p-limit(6)`（已有依赖，与迭代一文件摘要并发数一致）
- `Promise.allSettled`（单个失败不中断整体）

### 结果反馈格式
- 全部成功：`✅ 已解决 **N** 条 CodeSentinel 审查意见`
- 部分失败：`⚠️ 共 **N** 条，成功解决 **X** 条，**Y** 条失败（可手动解决）`
- 全部失败：`❌ 解决失败，请检查 Bot 权限（pull-requests: write）`
- 无待解决：`ℹ️ 没有找到待解决的 CodeSentinel 审查意见`

---

## 需新增/修改的文件

| 文件 | 操作 | 说明 |
|:---|:---|:---|
| `src/github/review-thread.ts` | **新建** | GraphQL 查询 + mutation + getBotLogin（便于独立测试）|
| `src/commands/handlers/resolve.ts` | **新建** | 核心 CommandHandler 实现 + resolveAllBotComments 对外接口 |
| `src/commands/handlers/stubs.ts` | **修改** | 移除 resolveStub（或保留但不再注册）|
| `src/commands/bootstrap.ts` | **修改** | 将 resolveStub 替换为 resolveHandler（1 行改动）|
| `__tests__/resolve.test.ts` | **新建** | 单元测试（7 个用例，见下方）|

---

## 任务清单（P0 优先完成）

### P0 任务
- [x] `review-thread.ts`：GraphQL 查询（含 cursor 分页循环）
- [x] `review-thread.ts`：batch resolve + p-limit(6)
- [x] `review-thread.ts`：getBotLogin（优先配置，fallback API）
- [x] `resolve.ts`：handler 主逻辑（execute 函数）
- [x] `resolve.ts`：resolveAllBotComments 对外接口
- [x] `bootstrap.ts`：接入（替换 stub → resolveHandler）
- [x] `__tests__/resolve.test.ts`：单元测试（10 个用例）

### P1 任务
- [x] 结果格式化 + 边界情况处理（0 条 / 全成功 / 部分失败 / 全失败）
- [x] 部分失败降级处理

### 附带改动
- `src/commands/handlers/stubs.ts`：从 ALL_STUBS 移除 resolveStub
- `__mocks__/p-limit.js`：新增全局 CommonJS shim（p-limit@4 为 ESM-only）
- `jest.config.json`：增加 moduleNameMapper 指向 __mocks__/p-limit.js
- `__tests__/command-dispatcher.test.ts`：stub 测试从 resolve → review（因 resolve 已实现）

---

## 测试用例（7 个）
1. 无待解决 thread → 返回 "没有找到" 消息
2. 全部成功 → 返回 "✅ 已解决 N 条"
3. 部分失败 → 返回 "⚠️ 共 N 条，成功 X，失败 Y"
4. 全部失败 → 返回权限不足提示
5. 分页场景（>100 threads）→ GraphQL 被调用 2+ 次，结果合并正确
6. 非 Bot 发的 thread 被过滤 → 不被 resolve
7. 已 resolved thread 被跳过 → isResolved=true 的 thread 不再调用 mutation

---

## 注意事项
- 框架层（dispatcher）已处理：权限校验、幂等检查、速率限制、5 秒 ACK。handler 无需重复处理。
- `needsAck: true`：dispatcher 会在 execute 前自动发 ⏳ ACK，execute 完成后 reply.success 会**更新**该评论（而非新建）
- octokit throttling 插件已配置自动重试 429，无需手动处理限流
- `resolveReviewThread` mutation 对已 resolved 的 thread 重复调用不会报错（幂等）
- ctx.commentNodeId 是 review comment 的 GraphQL node ID（`pull_request_review_comment` 事件时有值，`issue_comment` 时为空），此命令不需要它
