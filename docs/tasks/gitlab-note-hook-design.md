---
title: GitLab Note Hook 业务规则设计文档（EVENT-014~EVENT-021，含 #66 修复）
sidebar_label: GitLab Note Hook 业务规则（双平台兼容）
sidebar_position: 10
---

# GitLab Note Hook 业务规则设计文档（EVENT-014 ~ EVENT-021）

> **状态**：设计中，尚未开发
> **优先级**：P1 —— GitHub↔GitLab 双平台兼容工作流 A 的延续任务
> **依赖**：`createGitLabExecutionContext()`（#62 / PR #63）、`gitlab-trigger.ts`（#64 / PR #67）
> **跟踪 Issue**：[#70](https://github.com/CodesSentinels/ai-reviewer/issues/70)（同时修复 [#66](https://github.com/CodesSentinels/ai-reviewer/issues/66)）
> **范围**：`EVENT-014`~`EVENT-021`（Note Hook 命令识别的结构性支持、忽略事件分类修复、幂等键格式）
> **不在本任务范围**：`CMD-*`（第9章，命令真正执行）、`STATE-005`（marker 持久化）、`GLAPI-*`（第7章）、`EVENT-006~013`（MR Hook，见 [gitlab-mr-hook-design.md](./gitlab-mr-hook-design.md)）

> ⚠️ **协作说明**：Issue #66 的 assignee 是 `antonpanov-ux` 和 `linfei0211` 两人。本任务包含修复 #66，动手前需要先跟 `linfei0211` 对齐分工，不要单方面各自开工——具体分工结论应更新回本文档第 7 节。

---

## 0. 参考文档

- `docs/github-gitlab-compatibility-todo.md` 第 6.3 节（`EVENT-014`~`EVENT-021` 原始条目）
- Issue #66（GitLab note 编辑/删除事件被误判 fail closed 的完整复现记录）
- `docs/tasks/gitlab-trigger-cli-design.md`（EVENT-001~005，本任务的直接前置）
- `docs/tasks/gitlab-mr-hook-design.md`（EVENT-006~013，姊妹任务）
- `src/commands/parser.ts`（GitHub 侧既有命令语法规则，`EVENT-019` 需要复用/对齐）

---

## 1. 背景与现状

`src/platform/gitlab-execution-context.ts` 的 `buildFromNoteHook()` 现状：

```typescript
function buildFromNoteHook(p: Record<string, any>): ExecutionContext {
  const attrs = p.object_attributes
  const mr = p.merge_request
  if (attrs == null || mr == null || attrs.action !== 'create') {
    throw new ExecutionContextError(
      'note payload missing required fields or not a create action',
      'gitlab',
      'missing_required_field'
    )
  }
  if (attrs.noteable_type !== 'MergeRequest') {
    throw new ExecutionContextError(
      `Unsupported noteable_type: ${attrs.noteable_type}`,
      'gitlab',
      'unknown_event'
    )
  }
  // ...
  actor: {login: p.user?.username ?? '', isBot: false},
  // ...
}
```

两个已确认问题（详见 Issue #66）：

1. `attrs.action !== 'create'`（编辑、删除已有评论）和"`attrs`/`mr` 字段真正缺失"共用同一个 `missing_required_field` reason，导致 `gitlab-trigger.ts` 对编辑/删除评论 fail closed（exit 1），而不是像 `unknown_event` 那样优雅跳过（exit 0）。
2. `actor.isBot` 恒为 `false`——代码注释里写明"GitLab MVP 使用个人 PAT 身份评论，没有天然的 bot 账号标记"，真正的自反馈过滤（`EVENT-018`）还没做。

`EVENT-014/015/019/020/021` 目前完全没有对应代码。

---

## 2. 目标（对应 TODO 条目）

| 编号 | 内容 | 本设计如何满足 |
|:---|:---|:---|
| `EVENT-014` | 支持 MR 顶层 note 命令 | 第 3.1 节：命令识别的结构性支持 |
| `EVENT-015` | 支持 discussion note/reply 命令和对话上下文 | 同上 |
| `EVENT-016` | 只处理 `action=create` 的用户 note | 第 3.2 节：修复 #66，拆分 ignorable 事件原因 |
| `EVENT-017` | 忽略编辑、删除、system note 和非 MR note | 同上，覆盖 system note / 非 MR note |
| `EVENT-018` | 忽略 reviewer/PAT 账号自己的 note | 第 3.3 节：`isBot` 判断补全 |
| `EVENT-019` | 不符合严格命令语法的文本不触发命令或模型 | 第 3.4 节：复用 `commands/parser.ts` |
| `EVENT-020` | Note Hook 幂等键 | 第 3.5 节：`buildNoteIdempotencyKey()` |
| `EVENT-021` | 重复投递不重复调用 | 第 3.6 节：基于 mock marker 的测试验证 |

---

## 3. 设计方案

### 3.1 EVENT-014/015：命令识别的结构性支持

`ExecutionContext.comment` 字段（`kind: 'top_level' | 'review_thread'`）已经能区分顶层 note 和 discussion note。本任务不新增字段，只确认：

- 顶层 note（`kind: 'top_level'`）→ 对应 `eventKind: 'comment_created'`
- discussion note（`kind: 'review_thread'`，`threadId` 有值）→ 对应 `eventKind: 'review_comment_created'`

真正的命令解析/路由复用 GitHub 侧已有的 `src/commands/dispatcher.ts`/`src/commands/parser.ts`，本任务只保证 GitLab 的 `ExecutionContext` 能提供这两个函数需要的字段，不改动 dispatcher 本身（那属于 `CMD-*`，需要 `IGitPlatform` 才能真正执行命令产生的动作）。

### 3.2 EVENT-016/017：修复 #66——拆分 ignorable 事件

新增一个专门的 `ExecutionContextError.reason`：

```typescript
// execution-context.ts
public readonly reason:
  | 'missing_payload'
  | 'malformed_payload'
  | 'unknown_event'
  | 'missing_required_field'
  | 'ignorable_event'   // 新增：结构合法但业务上不需要处理（如非 create note）
```

`buildFromNoteHook()` 改为：

```typescript
function buildFromNoteHook(p: Record<string, any>): ExecutionContext {
  const attrs = p.object_attributes
  const mr = p.merge_request

  // 结构缺失：真正的校验失败，fail closed
  if (attrs == null || mr == null) {
    throw new ExecutionContextError(
      'note payload missing object_attributes/merge_request',
      'gitlab',
      'missing_required_field'
    )
  }

  // 结构合法但不需要处理：优雅跳过（EVENT-016/017）
  if (attrs.action !== 'create') {
    throw new ExecutionContextError(
      `note action is '${attrs.action}', not 'create' — ignorable`,
      'gitlab',
      'ignorable_event'
    )
  }
  if (attrs.system === true) {
    throw new ExecutionContextError(
      'system note — ignorable',
      'gitlab',
      'ignorable_event'
    )
  }
  if (attrs.noteable_type !== 'MergeRequest') {
    throw new ExecutionContextError(
      `noteable_type '${attrs.noteable_type}' is not MergeRequest — ignorable`,
      'gitlab',
      'ignorable_event'
    )
  }
  // ... 其余不变
}
```

`gitlab-trigger.ts` 的 catch 分支同时对 `unknown_event` 和 `ignorable_event` 做优雅跳过（exit 0），其余 reason 仍然 fail closed：

```typescript
if (e instanceof ExecutionContextError &&
    (e.reason === 'unknown_event' || e.reason === 'ignorable_event')) {
  console.log(`Skipped: ${e.message}`)
  return
}
```

> 覆盖 Issue #66 原始复现场景（`__tests__/fixtures/gitlab-note-hook-non-create.json`）+ 新增 system note / 非 MR note 两种 fixture。

### 3.3 EVENT-018：忽略 reviewer/PAT 自己的 note

`isBot` 目前恒为 `false`。本任务在 `buildFromNoteHook()` 之外新增一个独立函数（不放进 `ExecutionContext` 构造阶段，因为需要"已配置的 PAT 用户名"这个配置输入，而 `ExecutionContext` 构造阶段不应该依赖配置——这是刻意的架构边界，呼应 `ARCH-002` 的字段设计）：

```typescript
export function isSelfNote(actorLogin: string, configuredPatUsername: string): boolean {
  return actorLogin.toLowerCase() === configuredPatUsername.toLowerCase()
}
```

`configuredPatUsername` 的来源本任务先用环境变量占位（比如 `GITLAB_BOT_USERNAME`），等 `ConfigProvider`（4.2）就绪后再切换过去——这一点需要在 PR 描述里显式标注为临时方案。

### 3.4 EVENT-019：命令语法校验

不新写一套语法规则。确认 `src/commands/parser.ts` 导出的解析函数只依赖评论文本本身（不依赖 GitHub 特有的数据结构），可以直接给 GitLab note body 复用；如果发现有 GitHub 专属假设（比如依赖 `@mention` 的 GitHub 用户名格式），本任务需要记录下来但不一定要在本任务内解耦（那可能是 `CMD-003`"共用 parser、registry 和 handler 语义"的范围）。

### 3.5 EVENT-020：Note Hook 幂等键

```typescript
export function buildNoteIdempotencyKey(
  projectId: string,
  mrIid: number,
  noteId: number
): string {
  return `gitlab:${projectId}:${mrIid}:note:${noteId}:create`
}
```

与 TODO 文档规定的格式 `gitlab:{project_id}:{mr_iid}:note:{note_id}:create` 完全对应。

### 3.6 EVENT-021：重复投递测试

不实现真实持久化。用一个内存 `Set<string>`（仅用于测试，不作为生产实现）模拟 marker 存储，验证：同一个 `buildNoteIdempotencyKey()` 输出出现两次时，第二次应该被判定为"已处理过"。生产环境的持久化实现属于 `STATE-005`。

---

## 4. 任务拆分

| # | 任务 | 依赖 | 预估工时 |
|:---|:---|:---:|:---:|
| N1 | 与 `linfei0211` 对齐 #66 分工 | 无，最先做 | - |
| N2 | 新增 `ignorable_event` reason + `buildFromNoteHook()` 重构 | N1 | 3h |
| N3 | `gitlab-trigger.ts` catch 分支更新 | N2 | 1h |
| N4 | fixture 补充（system note、非 MR note、非 create action） | N2 | 2h |
| N5 | `isSelfNote()` + 环境变量占位接入 | 无 | 2h |
| N6 | `buildNoteIdempotencyKey()` + 单元测试 | 无 | 1.5h |
| N7 | `EVENT-021` 重复投递测试（mock marker） | N6 | 2h |
| N8 | `EVENT-019` parser 复用性确认 + 记录发现的 GitHub 专属假设 | 无 | 2h |
| N9 | 集成测试：CLI 全流程覆盖新增分支 | N2, N3, N4 | 3h |

**合计：约 16.5h（约 2 个工作日，不含 N1 协调时间）**

---

## 5. 验收标准

- [ ] Issue #66 复现场景（编辑/删除 note）改为 exit 0 优雅跳过
- [ ] system note、非 MR note 同样优雅跳过，有 fixture 覆盖
- [ ] `isSelfNote()` 有单元测试，且明确标注 PAT 用户名来源是临时环境变量方案
- [ ] `buildNoteIdempotencyKey()` 输出格式与 TODO 文档一致
- [ ] `commands/parser.ts` 复用性有结论（能直接复用 或 记录了需要解耦的 GitHub 专属假设）
- [ ] `npm test` 全量回归无新增失败
- [ ] 与 `linfei0211` 的分工已确认并记录

---

## 6. 风险与未决问题

| 风险/问题 | 说明 | 处理方式 |
|:---|:---|:---|
| PAT 用户名配置来源是临时方案 | 等 `ConfigProvider`（4.2）就绪后需要切换 | PR 描述中显式标注，避免被当成最终方案合并 |
| `EVENT-020`/`EVENT-021` 无法端到端验证 | 依赖 `STATE-005`/`GLAPI-*` | 只验证纯函数 + mock marker，PR 描述中说明边界 |
| `commands/parser.ts` 可能有 GitHub 专属假设 | 影响 `EVENT-019`/未来 `CMD-003` 的复用范围 | 本任务先记录发现，不强行解耦 |

---

## 7. 与 linfei0211 的分工（协调结果占位）

> 待补充：本任务开发前需要先和 `linfei0211` 确认谁负责 `ignorable_event` 的代码修改、谁负责测试覆盖，并把结论写回这里。
