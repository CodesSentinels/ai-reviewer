# 迭代四（单元测试生成）— 与迭代二成员 B/C/D 的依赖与协调

> **范围**：本文档说明迭代四（`src/unit-test/`）在已合并的成员 A 命令框架之上的接入方式，
> 以及当成员 B/C/D 后续提交其代码时需要注意的协调点。
>
> **状态**：迭代四的 P0 通路（评论展示）已实现并接入 `feature/unit-test` 分支；P1（提交到分支 / 创建 PR）骨架已实现。
>
> **背景**：截至本文档创建时，`feature/unit-test` 上 **仅** 合入了成员 A 的工作（Webhook 接入、命令解析、路由、权限、help、错误处理）。
> 成员 B（resolve）、成员 C（review / pause / summary / configuration）、成员 D（对话追问 / 噪音控制）尚未提交。

---

## 1. 命令注册边界

迭代四注册了一个新命令：

```
@ai-reviewer generate unit tests [--commit | --pr] [--function NAME] [PATH...]
```

| 项目 | 选择 | 说明 |
| :--- | :--- | :--- |
| 命令名 | `generate unit tests` | 3-token 复合命令，与现有 parser 的 `maxDepth=3` 限制对齐 |
| 注册入口 | `src/unit-test/register.ts` | **独立模块**，不修改 `commands/bootstrap.ts` 与 `commands/handlers/stubs.ts` |
| 注册时机 | `command-handler.ts` 在 `bootstrapCommands()` 之后 | 因 handler 需要 `heavyBot` 闭包，未走 stubs 的统一注册 |
| 幂等 | 内部 `_registered` flag | 同 bootstrapCommands 的 `bootstrapped` flag 行为对齐 |

**对 B/C/D 的影响**：

- ✅ 不与任何 stub 命令冲突。
- ✅ 不会改变 `ALL_STUBS` 的成员顺序，因此 help 输出顺序不受影响。
- ⚠️ B/C/D 在自己的注册路径上沿用 `bootstrap.ts` + `ALL_STUBS` 即可；
   当他们正式上线时，**只需要把对应 stub 替换为真实 handler**，不要碰 unit-test 的注册路径。

---

## 2. 与成员 B（resolve）的关系

| 维度 | 关系 |
| :--- | :--- |
| 命令名空间 | 完全独立（`resolve` vs `generate unit tests`） |
| 共享服务 | 无 |
| 数据模型 | 无 |

**结论**：B 与迭代四 0 依赖、0 冲突。

---

## 3. 与成员 C（审查控制）的关系

成员 C 将提供：

- `@ai-reviewer review` / `full review` / `pause` / `resume` / `summary` / `configuration` 命令
- 公共服务接口 `triggerReview(mode)` 与 `isPaused()`
- 审查状态持久化（已审查的 commit SHA 记录在 summary 评论中）

迭代四的当前实现 **直接调用 octokit**（`octokit.pulls.get` / `listFiles`），没有走 C 的适配层。
理由：
1. 单元测试生成是"用户主动触发的一次性任务"，不需要复用 C 的"增量审查/状态追踪"逻辑。
2. 在 C 尚未提交时保持迭代四可独立工作。

### 3.1 后续可选优化（C 上线后）

| 优化项 | 优先级 | 说明 |
| :--- | :--- | :--- |
| 复用 C 的"PR meta 缓存层" | P2 | 当 C 上线 `triggerReview` 时如果暴露 PR meta 取数，可消除一次 `pulls.get` |
| 尊重 `isPaused()` | P2 | 是否在 pause 时拒绝 `generate unit tests`？建议 **拒绝**（保持 pause 语义一致），具体行为需团队讨论 |
| 接入 C 的"审查摘要评论" | P1 | 迭代四 §3.2「审查面板集成」需要在 summary 评论中注入测试生成入口；C 上线 summary 后再做 |

### 3.2 协调约定

- 迭代四不会触碰 C 的 stubs（`reviewStub` / `fullReviewStub` / `pauseStub` / `resumeStub` / `summaryStub` / `configurationStub`）。
- 当 C 替换 stubs 时，**不需要修改 unit-test 模块的任何文件**。
- 若 C 决定在 dispatcher 之前注入"PR 暂停拦截器"，建议把判断放到 dispatcher 内部（A 的层级），
  迭代四自然透明地受益。

---

## 4. 与成员 D（对话追问 / 噪音控制）的关系

成员 D 将提供：

- 重写或扩展 `review-comment.ts` 为对话式追问
- `postSummaryComment(prNumber, findings)` / `formatComments(findings)` 通用评论渲染
- 噪音控制：评论合并、单次评论数量上限、`<details>` 折叠

### 4.1 迭代四的评论是否进入 D 的去重池？

**不进入**。理由：
- D 的去重对象是"自动审查产生的代码行级评论"。
- 迭代四的评论是"对显式命令的直接回复"，已经走 Reply 层的 `CMD_REPLY_TAG` 幂等机制。

### 4.2 共享渲染工具？

短期 **不共享**。理由：
- 迭代四的 Markdown 渲染（`renderCommentBody`）已涵盖"测试代码块 + 覆盖度表 + 跳过详情"
  这些是测试生成专属布局。
- 若 D 后续做出"通用代码块折叠/截断工具"，可考虑把迭代四的渲染下沉到该工具上，作为 P2 重构项。

### 4.3 协调约定

- 迭代四不修改 `review-comment.ts`（D 的领地）。
- 迭代四不修改 `commenter.ts` 中的标签常量（`COMMENT_TAG` / `COMMENT_REPLY_TAG` / `SUMMARIZE_TAG` 等）。
- D 接入"对话追问"时可放心扩展 `review-comment.ts`，与 unit-test 模块零交叉。

---

## 5. 共享文件改动清单

迭代四仅对**两个**既有文件做了**新增式**修改：

| 文件 | 改动类型 | 行数 | 与 B/C/D 冲突可能 |
| :--- | :--- | ---: | :--- |
| `src/command-handler.ts` | +2 行 | 一处 import + 一处函数调用 | 极低（A 的入口文件） |

**没有修改**：

- `src/commands/bootstrap.ts`
- `src/commands/handlers/stubs.ts`
- `src/commands/types.ts`
- `src/commands/dispatcher.ts`
- `src/commands/parser.ts`
- `src/commands/permission.ts`
- `src/commands/registry.ts`
- `src/commands/rate-limit.ts`
- `src/commands/reply.ts`
- `src/review-comment.ts`
- `src/commenter.ts`
- 任何现有测试文件

---

## 6. 新增文件清单

```
src/unit-test/
├── types.ts                          # 共享类型
├── change-analyzer.ts                # diff → TestTarget[]
├── framework-detector.ts             # 测试框架探测
├── context-collector.ts              # 源码 / 已有测试 / 类型上下文收集（FsReader 注入）
├── fs-reader.ts                      # 本地文件系统 FsReader 实现
├── prompt-builder.ts                 # Prompt 组装（纯函数）
├── post-processor.ts                 # 代码抽取 + 静态校验
├── generator.ts                      # LLM 调用 + 后处理编排
├── test-path-resolver.ts             # 测试文件路径推断
├── orchestrator.ts                   # 主流程
├── register.ts                       # 命令注册入口
└── delivery/
    ├── index.ts                      # 三种 mode 分发
    ├── comment-delivery.ts           # P0
    ├── commit-delivery.ts            # P1
    └── pr-delivery.ts                # P1

__tests__/
├── unit-test-change-analyzer.test.ts
├── unit-test-framework-detector.test.ts
├── unit-test-test-path-resolver.test.ts
├── unit-test-post-processor.test.ts
├── unit-test-prompt-builder.test.ts
└── unit-test-comment-delivery.test.ts
```

---

## 7. 暂未实现 / 留待后续的事项

| 事项 | 文档位置 | 优先级 | 阻塞依赖 |
| :--- | :--- | :--- | :--- |
| 在 PR summary 评论中注入"测试生成入口" | §3.2 | P1 | 等待成员 C 的 `summary` 命令上线 |
| 提交到分支后的自动回包反馈带 PR 内 commit 跳链 | §2.6 方式二 | P2 | 无 |
| 执行验证（在沙箱中跑测试 → 失败回传 LLM 修复） | §4.2 | P2 | 需要 Actions 运行时的可执行环境，建议放到独立 GitHub Action job 中 |
| 覆盖度分析评论 | §4.3 | P2 | 当前已有简易"用例数"统计，覆盖度需要执行验证支撑 |
| 命令 `--branch=other` 支持指定非 PR head 分支 | §3.1 | P2 | 无 |

---

## 8. 与权限相关的注意事项

| Delivery mode | 所需 GitHub 权限 | 备注 |
| :--- | :--- | :--- |
| `comment` | `pull-requests: write` | 与 A 的 Reply 一致，workflow 默认已满足 |
| `--commit` | `contents: write` + `pull-requests: write` | 当前 action.yml 未默认请求 `contents: write`，使用前需在 workflow 中显式打开 |
| `--pr` | 同上 + 可创建分支 | GitHub App 上线时也需对应权限 |

如果运行环境不满足 commit/pr 权限，会进入 `outcome.errors`，**不会**抛异常或污染评论流。

---

## 9. 测试

新增 7 个测试套件，86 个用例（全部位于纯函数模块；不涉及 GitHub API 实际调用）：

```
__tests__/unit-test-change-analyzer.test.ts        21 cases
__tests__/unit-test-framework-detector.test.ts     12 cases
__tests__/unit-test-test-path-resolver.test.ts      8 cases
__tests__/unit-test-post-processor.test.ts         14 cases
__tests__/unit-test-prompt-builder.test.ts          8 cases
__tests__/unit-test-comment-delivery.test.ts        6 cases (含 mock 的 @actions/core)
__tests__/unit-test-context-collector.test.ts     19 cases (含 mock 的 @actions/core)
```

全套 `npm test` 通过（268 cases，14 suites）。

---

## 10. 致后续接入者

- **B**：你的工作集中在 `commands/handlers/stubs.ts` 的 `resolveStub` 与一个新的 service 模块，
  迭代四不会触碰；放心做。
- **C**：注意 §3 中的两条可选优化，建议你的 `triggerReview` 暴露 PR meta 接口便于复用。
- **D**：注意 §4 中的"渲染工具下沉"P2 重构项；如果你的 `formatComments` 通用性强，
  迭代四后续可以接入。
