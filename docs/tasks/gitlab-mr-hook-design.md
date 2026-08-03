---
title: GitLab MR Hook 业务规则设计文档（EVENT-006~EVENT-013）
sidebar_label: GitLab MR Hook 业务规则（双平台兼容）
sidebar_position: 9
---

# GitLab MR Hook 业务规则设计文档（EVENT-006 ~ EVENT-013）

> **状态**：✅ 已完成（代码开发 + 单元测试），见 `feat/gitlab-mr-hook-rules` 分支
> **优先级**：P1 —— GitHub↔GitLab 双平台兼容工作流 A 的延续任务
> **依赖**：`createGitLabExecutionContext()`（#62 / PR #63，`feat/execution-context` 分支，尚未合并 main）、`gitlab-trigger.ts`/`gitlab-trigger-validation.ts`（#64 / PR #67，`feat/gitlab-trigger-cli` 分支，尚未合并 main）
> **跟踪 Issue**：[#69](https://github.com/CodesSentinels/ai-reviewer/issues/69)
> **范围**：`EVENT-006`~`EVENT-013`（MR Hook 事件映射确认、fork 拒绝、写前 HEAD 重读的可测试纯函数、幂等键格式）
> **不在本任务范围**：`GLAPI-*`（第7章，真正的 GitLab API 调用）、`STATE-005`（marker 持久化存储）、`EVENT-014`~`EVENT-021`（Note Hook，见 [gitlab-note-hook-design.md](./gitlab-note-hook-design.md)）

---

## 0. 参考文档

- `docs/github-gitlab-compatibility-todo.md` 第 6.2 节（`EVENT-006`~`EVENT-013` 原始条目）
- `docs/tasks/gitlab-trigger-cli-design.md`（EVENT-001~005，本任务的直接前置）
- `docs/tasks/execution-context-design.md`（`ExecutionContext`/`createGitLabExecutionContext` 字段设计）
- 仓库内记忆：`memory/execution_context_migration_project.md`、`memory/gitlab_only_doc_drift_risk.md`

---

## 1. 背景与现状

`src/platform/gitlab-execution-context.ts` 的 `mapMergeRequestAction()` **已经**实现了 `EVENT-006`(MR 创建)/`EVENT-007`(reopen)/`EVENT-008`(HEAD 更新)/`EVENT-009`(纯元数据更新不触发模型) 的事件映射：

```typescript
function mapMergeRequestAction(attrs, changes): EventKind {
  if (attrs.action === 'open') return 'pr_opened'
  if (attrs.action === 'reopen') return 'pr_reopened'
  if (attrs.action === 'update') {
    const headChanged = changes?.last_commit != null || changes?.source_branch != null
    return headChanged ? 'pr_synchronize' : 'metadata_updated'
  }
  return 'unknown'
}
```

本任务对这四条的工作是**补充测试覆盖 + 边界场景确认**（比如 `changes` 字段缺失、`last_commit`/`source_branch` 只变了一个等情况），而不是新写映射逻辑。

真正需要新代码的是 `EVENT-010~013`：

1. **`EVENT-010`（fork 拒绝）**：`src/gitlab-trigger-validation.ts` 已经检测出 `source_project_id !== target_project_id`，但 `src/gitlab-trigger.ts` 目前只打日志，不 reject：

   ```typescript
   if (validation.sourceTargetMismatch) {
     console.log('Note: source_project_id != target_project_id (fork MR) — rejection logic is EVENT-010, not yet implemented')
   }
   ```

2. **`EVENT-011`（同项目 MR 仍按不可信数据处理）**：原则性要求，没有对应代码改动，靠测试固化。

3. **`EVENT-012`（写前重读 HEAD）**：完全没有代码。真正"重新读取 GitLab MR 当前 HEAD"需要调用 GitLab API（`GLAPI-006`），本任务不实现网络调用。

4. **`EVENT-013`（幂等键）**：完全没有代码。键的生成是纯函数，但键与 summary note marker 的比对需要 `GLAPI-007~009`（读取 note）和 `STATE-005`（marker 存储格式），本任务不实现这两块。

---

## 2. 目标（对应 TODO 条目）

| 编号 | 内容 | 本设计如何满足 |
|:---|:---|:---|
| `EVENT-006` | 支持 MR 创建事件 | 第 3.1 节：补充测试，确认既有映射正确 |
| `EVENT-007` | 支持 MR reopen 事件 | 同上 |
| `EVENT-008` | 支持 MR HEAD SHA 更新事件 | 同上，含 `changes` 字段边界场景 |
| `EVENT-009` | 纯元数据更新不调用模型 | 同上 |
| `EVENT-010` | MVP 拒绝 fork MR | 第 3.2 节：`rejectForkMergeRequest()` |
| `EVENT-011` | 同项目 MR 内容仍按不可信数据处理 | 第 3.3 节：不变量测试 |
| `EVENT-012` | 写前重读 HEAD，不一致时退出 | 第 3.4 节：`isHeadStale()` 纯函数，真实读取延后到 GLAPI-006 |
| `EVENT-013` | MR 自动审查幂等键 | 第 3.5 节：`buildMrIdempotencyKey()` |

---

## 3. 设计方案

### 3.1 EVENT-006~009：既有映射的测试补强

不新增业务代码。新增 `__tests__/gitlab-mr-hook-mapping.test.ts`，覆盖：

- `action: 'open'` → `pr_opened`
- `action: 'reopen'` → `pr_reopened`
- `action: 'update'` + `changes.last_commit` 存在 → `pr_synchronize`
- `action: 'update'` + `changes.source_branch` 存在（但 `last_commit` 缺失，比如强制推送场景）→ `pr_synchronize`
- `action: 'update'` + `changes` 为空对象/`undefined` → `metadata_updated`
- `action: 'update'` + `changes` 只含 `title`/`labels`/`assignees` → `metadata_updated`
- `action` 为其他值（如 `close`/`merge`）→ `unknown`（不触发模型，走 `gitlab-trigger.ts` 现有的 `unknown_event` 优雅跳过路径）

### 3.2 EVENT-010：拒绝 fork MR

新增 `src/gitlab-mr-hook-rules.ts`：

```typescript
export interface ForkCheckResult {
  isFork: boolean
  reason?: string
}

export function checkForkMergeRequest(
  sourceProjectId: number,
  targetProjectId: number
): ForkCheckResult {
  if (sourceProjectId !== targetProjectId) {
    return {
      isFork: true,
      reason: `source_project_id(${sourceProjectId}) !== target_project_id(${targetProjectId})`
    }
  }
  return {isFork: false}
}
```

`gitlab-trigger.ts` 在 `sourceTargetMismatch` 为真时改为：打印脱敏日志 + `process.exitCode = 1`（fail closed，语义上不同于"未知事件"的优雅跳过——fork MR 是一个需要人工关注的安全边界，不应该静默 exit 0）。

> **待确认**：fork MR 的退出码语义（fail closed vs 优雅跳过）需要在 PR review 时和团队确认一次，因为这决定了 GitLab CI job 的失败通知频率——如果 fork MR 在实际使用中很常见，可能需要改成优雅跳过 + 告警而不是 job 失败。

### 3.3 EVENT-011：不变量测试

不新增业务代码（本身就没有做区分 source==target 的特殊逻辑）。新增测试用例，明确断言：无论 `sourceTargetMismatch` 是 true 还是 false，`createGitLabExecutionContext()` 后续的字段结构完全一致，不因为"同项目"就跳过任何字段校验。放在 `__tests__/gitlab-mr-hook-rules.test.ts` 里。

### 3.4 EVENT-012：写前 HEAD 重读（纯函数部分）

```typescript
export interface HeadStaleCheck {
  stale: boolean
  eventHeadSha: string
  currentHeadSha: string
}

export function isHeadStale(
  eventHeadSha: string,
  currentHeadSha: string
): HeadStaleCheck {
  return {
    stale: eventHeadSha !== currentHeadSha,
    eventHeadSha,
    currentHeadSha
  }
}
```

`currentHeadSha` 的真实来源（调用 GitLab API 读取 MR 当前 HEAD）是 `GLAPI-006`，本任务不实现。本任务交付的是这个判断函数 + 调用点的**占位设计**：在设计文档里说明未来 `GLAPI-006` 就绪后，应该在"读取 diff/生成审查之前"调用一次 `isHeadStale()`，不一致则退出且不发布任何评论。

### 3.5 EVENT-013：幂等键

```typescript
export function buildMrIdempotencyKey(
  projectId: string,
  mrIid: number,
  headSha: string
): string {
  return `gitlab:${projectId}:${mrIid}:head:${headSha}`
}
```

与 summary note 中 reviewed SHA marker 的比对属于 `STATE-005`，本任务只保证这个函数的输出格式符合 TODO 文档规定的 `gitlab:{project_id}:{mr_iid}:head:{head_sha}`。

---

## 4. 任务拆分

| # | 任务 | 依赖 | 预估工时 |
|:---|:---|:---:|:---:|
| M1 | `EVENT-006~009` 映射测试补强 | 无 | 2h |
| M2 | `checkForkMergeRequest()` + 接入 `gitlab-trigger.ts` | 无 | 3h |
| M3 | `EVENT-011` 不变量测试 | M2 | 1.5h |
| M4 | `isHeadStale()` 纯函数 + 单元测试 | 无 | 2h |
| M5 | `buildMrIdempotencyKey()` + 单元测试 | 无 | 1.5h |
| M6 | fixture 补充（fork MR 各种变体、`changes` 边界场景） | 无 | 2h |
| M7 | 集成测试：CLI 全流程覆盖新增分支 | M2, M4, M5 | 3h |

**合计：约 15h（约 2 个工作日）**

---

## 5. 验收标准

- [x] `EVENT-006~009` 的映射行为有显式测试覆盖，包含此前未覆盖的边界场景
- [x] fork MR 被 `gitlab-trigger.ts` 真正拒绝（非零退出），不再只是打日志
- [x] 同项目 MR 的字段处理路径与 fork MR 检测逻辑无关，测试固化
- [x] `isHeadStale()`/`buildMrIdempotencyKey()` 均为纯函数，不发起网络调用，单元测试覆盖率 100% 分支
- [x] `npm test` 全量回归无新增失败

---

## 6. 风险与未决问题

| 风险/问题 | 说明 | 处理方式 |
|:---|:---|:---|
| fork MR 拒绝的退出码语义未定 | fail closed 还是优雅跳过，影响 CI 通知频率 | PR review 时与团队确认 |
| `EVENT-012`/`EVENT-013` 无法端到端验证 | 依赖 `GLAPI-*`，本任务只能验证纯函数逻辑 | 在 PR 描述中明确说明，避免误以为已端到端可用 |
| `changes` 字段的真实 Webhook 形态未经验证 | 与 `createGitLabExecutionContext` 的既有已知风险一致 | 标注待确认，真实环境接入时复核 |
