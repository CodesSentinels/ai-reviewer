# 成员 A — 平台与命令框架 · Code Review 指南

> **分支**: `feature/cmd`（基于 `main`，+3647 行 / 28 文件）
> **对应设计文档**: [04-iteration-02-member-a-design.md](04-iteration-02-member-a-design.md)
> **对应工作量拆分**: [04-iteration-comment-interaction-workload.md](04-iteration-comment-interaction-workload.md) §1

---

## 目录

- [1. 变更概览](#1-变更概览)
- [2. 整体架构与模块关系](#2-整体架构与模块关系)
- [3. 完整数据流（从 webhook 到评论回复）](#3-完整数据流从-webhook-到评论回复)
- [4. 各模块详解与调用链](#4-各模块详解与调用链)
  - [4.1 入口层改造 main.ts](#41-入口层改造-maints)
  - [4.2 评论事件顶层入口 command-handler.ts](#42-评论事件顶层入口-command-handlerts)
  - [4.3 类型中枢 types.ts](#43-类型中枢-typests)
  - [4.4 命令注册表 registry.ts](#44-命令注册表-registryts)
  - [4.5 启动注册 bootstrap.ts](#45-启动注册-bootstrapts)
  - [4.6 命令解析器 parser.ts](#46-命令解析器-parserts)
  - [4.7 权限校验 permission.ts](#47-权限校验-permissionts)
  - [4.8 速率限制 rate-limit.ts](#48-速率限制-rate-limitts)
  - [4.9 回复工具 reply.ts](#49-回复工具-replyts)
  - [4.10 调度主流程 dispatcher.ts](#410-调度主流程-dispatcherts)
  - [4.11 help 命令 handlers/help.ts](#411-help-命令-handlershelpts)
  - [4.12 B/C/D 占位 handlers/stubs.ts](#412-bcd-占位-handlersstubsts)
  - [4.13 ACK 表情 reaction.ts + early-reaction.ts](#413-ack-表情-reactionts--early-reactionts)
  - [4.14 Bot 名称/图标可配置化](#414-bot-名称图标可配置化)
- [5. action.yml 新增输入](#5-actionyml-新增输入)
- [6. 安全设计](#6-安全设计)
- [7. 幂等与去重](#7-幂等与去重)
- [8. 错误处理策略](#8-错误处理策略)
- [9. 测试覆盖](#9-测试覆盖)
- [10. B/C/D 接入指南](#10-bcd-接入指南)
- [11. 预期 Review 问题 FAQ](#11-预期-review-问题-faq)

---

## 1. 变更概览

| 分类 | 文件 | 行数 | 说明 |
|:-----|:-----|:-----|:-----|
| **新增 · 核心框架** | `src/commands/types.ts` | 143 | 类型中枢：ParsedCommand / CommandContext / CommandHandler / ErrorCode |
| | `src/commands/parser.ts` | 214 | 命令解析器：@bot mention 识别 + 最长前缀匹配 + 安全校验 |
| | `src/commands/registry.ts` | 76 | 单例注册表：命令名 → handler 映射 + 别名支持 |
| | `src/commands/permission.ts` | 89 | 权限查询（带缓存）+ 命令级校验 + PR 作者豁免 |
| | `src/commands/rate-limit.ts` | 109 | 进程内令牌桶（10 次/60s/限流域） |
| | `src/commands/reply.ts` | 197 | 统一评论回复（ACK/成功/失败/进度 四种状态 + 幂等标签） |
| | `src/commands/dispatcher.ts` | 309 | 调度主流程（10 步流水线） |
| | `src/commands/bootstrap.ts` | 30 | 一次性启动注册 |
| | `src/commands/reaction.ts` | 103 | ACK 表情反应封装 |
| | `src/commands/early-reaction.ts` | 85 | Bot 初始化前的提前 ACK |
| **新增 · handler** | `src/commands/handlers/help.ts` | 66 | help 命令（自动聚合 registry） |
| | `src/commands/handlers/stubs.ts` | 95 | 7 个 B/C/D 占位 handler |
| **新增 · 顶层入口** | `src/command-handler.ts` | 53 | 评论事件入口 + fallback 对话透传 |
| **改动 · 已有文件** | `src/main.ts` | +13 | 新增 issue_comment 路由 + early reaction |
| | `src/options.ts` | +6 | commandAckReaction 字段 |
| | `src/commenter.ts` | +4 | bot_name / bot_icon 动态化 |
| | `src/review.ts` | +12 | bot_name 动态化（3 处可见文本） |
| | `action.yml` | +26 | 3 个新输入 |
| **新增 · 测试** | `__tests__/command-*.test.ts` | 831 | 6 个测试套件，182 个测试 |
| **新增 · 文档** | `docs/04-iteration-*.md` | 1257 | 设计文档 + 工作量拆分文档 |

---

## 2. 整体架构与模块关系

```
                          ┌─────────────────────────────────────────────┐
                          │              GitHub Actions Runner           │
                          └─────────────┬───────────────────────────────┘
                                        │
                                        ▼
                              ┌─────────────────┐
                              │    main.ts       │ ← Action 入口
                              │                  │
                              │  1. Options 构造 │
                              │  2. earlyReaction│ ← [NEW] Bot 初始化前打表情
                              │  3. Bot 初始化   │
                              │  4. 事件路由     │
                              └───┬─────────┬────┘
                                  │         │
                     pull_request │         │ issue_comment /
                                  │         │ review_comment
                                  ▼         ▼
                            ┌─────────┐  ┌──────────────────┐
                            │review.ts│  │command-handler.ts │ ← [NEW]
                            │(已有)   │  │                   │
                            └─────────┘  │  bootstrapCmds() │
                                         │  dispatch()      │
                                         │  fallback?       │
                                         └───────┬──────────┘
                                                 │
                              ┌───────────────────┼───────────────────┐
                              │                   │                   │
                              ▼                   ▼                   ▼
                        ┌──────────┐       ┌──────────┐       ┌──────────┐
                        │ parser   │       │dispatcher │       │ reply    │
                        │          │       │(10-step)  │       │          │
                        │ 解析评论 │──────▶│ 调度执行  │──────▶│ 写回评论 │
                        └──────────┘       └─────┬────┘       └──────────┘
                                                 │
                      ┌──────────┬───────────────┼───────────┬──────────┐
                      │          │               │           │          │
                      ▼          ▼               ▼           ▼          ▼
                 ┌─────────┐┌─────────┐   ┌──────────┐ ┌────────┐┌────────┐
                 │registry ││permission│   │rate-limit│ │reaction││handlers│
                 │         ││         │   │          │ │        ││        │
                 │命令查找 ││权限校验  │   │频率限制  │ │表情ACK ││help    │
                 └─────────┘└─────────┘   └──────────┘ └────────┘│stubs  │
                                                                 └────────┘
```

**模块间依赖方向**（从上到下，不允许向上依赖）：

```
types.ts            ← 零依赖，所有模块都引它
  ↑
parser.ts           ← 只依赖 types
registry.ts         ← 只依赖 types
rate-limit.ts       ← 零外部依赖
  ↑
permission.ts       ← 依赖 types + octokit
reply.ts            ← 依赖 types + octokit
reaction.ts         ← 依赖 types + octokit
  ↑
handlers/help.ts    ← 依赖 types + registry
handlers/stubs.ts   ← 依赖 types
  ↑
bootstrap.ts        ← 依赖 handlers + registry
  ↑
dispatcher.ts       ← 依赖 parser + registry + permission + rate-limit + reply
early-reaction.ts   ← 依赖 bootstrap + registry + parser + reaction
  ↑
command-handler.ts  ← 依赖 bootstrap + dispatcher
  ↑
main.ts             ← 依赖 command-handler + early-reaction + options
```

---

## 3. 完整数据流（从 webhook 到评论回复）

以用户在 PR 评论区输入 `@ai-reviewer help` 为例：

```
时间轴
──────────────────────────────────────────────────────────────────────────────

T+0s   用户在 PR #42 评论区发送:  "@ai-reviewer help"
        │
        ▼
T+0s   GitHub 产生 issue_comment 事件（action=created）
       → 触发 .github/workflows/ai-reviewer.yml
       → job.if 条件通过（event.issue.pull_request != null）

T+3~8s Actions Runner 启动，执行 node dist/index.js

T+8s   ┌────────────────── main.ts ──────────────────┐
       │                                              │
       │ [STEP 1] new Options(...)                    │ ← 读取所有 action input
       │   commandAckReaction = "rocket"              │    （包含 command_ack_reaction）
       │                                              │
       │ [STEP 2] options.print()                     │ ← 日志输出所有配置项
       │                                              │
       │ [STEP 3] GITHUB_EVENT_NAME=issue_comment     │
       │   → await tryEarlyReaction("rocket")         │ ← 在 Bot 初始化前打表情
       │                                              │
       └──────────────────┬───────────────────────────┘
                          │
                          ▼
T+8.1s ┌────────── early-reaction.ts ────────────────┐
       │                                              │
       │ [a] 校验事件 = issue_comment ✓               │
       │ [b] payload.action = created ✓               │
       │ [c] payload.issue.pull_request 存在 ✓        │
       │ [d] comment.user.type != Bot ✓               │
       │ [e] bootstrapCommands()                      │ ← 注册 help + 7 个 stub
       │ [f] parse("@ai-reviewer help", {registered}) │ ← 命中 "help" 命令
       │ [g] outcome.kind === 'command' ✓             │
       │ [h] addAckReaction({                         │
       │       commentId: 12345,                      │ ← 用户评论 ID
       │       eventName: "issue_comment",            │
       │       rawReaction: "rocket"                  │
       │     })                                       │
       │     → normalizeReaction("rocket") = "rocket" │ ← 合法值
       │     → octokit.reactions                      │
       │       .createForIssueComment({               │ ← GitHub API
       │         owner, repo, comment_id, content     │
       │       })                                     │
       │                                              │
       └──────────────────┬───────────────────────────┘
                          │
T+8.2s   用户评论上出现 🚀 表情  ← 此时 Bot 还没初始化！
                          │
                          ▼
T+8.3s ┌────────────── main.ts (续) ─────────────────┐
       │                                              │
       │ [STEP 4] new Prompts(...)                    │
       │ [STEP 5] new Bot(lightBot)                   │ ← OpenAI client 构建
       │ [STEP 6] new Bot(heavyBot)                   │ ← 又一个 OpenAI client
       │ [STEP 7] 事件路由                            │
       │   GITHUB_EVENT_NAME = issue_comment          │
       │   → handleCommentEvent({heavyBot,...})        │
       │                                              │
       └──────────────────┬───────────────────────────┘
                          │
                          ▼
T+9s   ┌────────── command-handler.ts ───────────────┐
       │                                              │
       │ [a] bootstrapCommands() ← 幂等，第二次调用   │
       │     内部 bootstrapped=true → 直接 return      │
       │                                              │
       │ [b] dispatchCommentEvent({options})           │ ← 进入主调度
       │                                              │
       └──────────────────┬───────────────────────────┘
                          │
                          ▼
T+9s   ┌──────────── dispatcher.ts ──────────────────┐
       │                                              │
       │ ── 10 步调度流水线 ──                         │
       │                                              │
       │ [STEP 1] 事件类型校验                        │
       │   eventName=issue_comment ✓                  │
       │                                              │
       │ [STEP 2] payload.action 校验                 │
       │   action=created ✓                           │
       │                                              │
       │ [STEP 3] 提取评论元数据                      │
       │   prNumber = 42                              │
       │   comment = {id:12345, body:"@ai-reviewer    │
       │              help", user:{login:"mason"}}     │
       │   prAuthor = "mason"                         │
       │                                              │
       │ [STEP 4] Bot 自评论过滤                      │
       │   comment.user.type != "Bot" ✓               │
       │                                              │
       │ [STEP 5] 命令解析                            │
       │   parse("@ai-reviewer help") →               │
       │   {kind:"command", command:{                  │
       │     name:"help", args:[], kv:{}, raw:"help"  │
       │   }}                                         │
       │                                              │
       │ [STEP 6] 构造 Reply                          │
       │   Reply({owner, repo, issueNumber:42,        │
       │     originalCommentId:12345, commandName:     │
       │     "help"})                                  │
       │                                              │
       │ [STEP 7] 幂等检查                            │
       │   hasBeenProcessed() — 扫描评论区是否已有    │
       │   <!-- codesentinel-cmd-reply:12345:help -->  │
       │   → false (首次) ✓                            │
       │                                              │
       │ [STEP 8] 速率限制                            │
       │   checkRateLimit("mason") → {allowed:true}   │
       │                                              │
       │ [STEP 9] 权限校验                            │
       │   getPermission({owner,repo,                 │
       │     username:"mason"})                        │
       │   → octokit.repos                            │
       │     .getCollaboratorPermissionLevel()         │
       │   → "write"                                  │
       │   canExecute(helpHandler, "write", true)      │
       │   → help.minPermission="read"                │
       │   → permissionAtLeast("write","read")=true   │
       │                                              │
       │ [STEP 10] 执行 handler                       │
       │   helpHandler.needsAck = false               │
       │   → 不发 ACK 评论                            │
       │   helpHandler.execute(ctx)                   │
       │   → buildHelpMessage(registeredCommands)     │
       │   → 返回 {message: "## 支持的命令\n..."}    │
       │                                              │
       │   reply.success(message)                     │
       │   → wrap(message)                            │
       │     生成:                                    │
       │     "<!-- codesentinel-cmd-reply:12345:help   │
       │       -->\n🦉 CodeSentinel · `help`\n\n      │
       │       ## 支持的命令\n..."                     │
       │   → publish(body, null)                      │
       │     → octokit.issues.createComment({         │
       │         owner, repo, issue_number:42, body   │
       │       })                                     │
       │                                              │
       │ return {kind:"executed", command:"help",     │
       │         ok:true}                              │
       │                                              │
       └──────────────────┬───────────────────────────┘
                          │
                          ▼
T+10s  ┌────────── command-handler.ts (续) ──────────┐
       │                                              │
       │ outcome.kind = "executed" → 不走 fallback    │
       │ info("commentEvent dispatcher outcome:       │
       │   {kind:executed,command:help,ok:true}")      │
       │                                              │
       └──────────────────────────────────────────────┘

T+10s  用户在 PR #42 评论区看到 Bot 回复
```

---

## 4. 各模块详解与调用链

### 4.1 入口层改造 `main.ts`

**文件**: `src/main.ts` | **改动**: +13 行

**本次改动点**:

```
                    原 main.ts                              新 main.ts
    ┌──────────────────────────────┐      ┌──────────────────────────────────┐
    │ Options                      │      │ Options                          │
    │ Prompts                      │      │ ─ 新增 commandAckReaction 字段   │
    │ Bot(light)                   │      │ Prompts                          │
    │ Bot(heavy)                   │      │ ★ tryEarlyReaction() ← 新增     │
    │                              │      │ Bot(light)                       │
    │ if pull_request → review     │      │ Bot(heavy)                       │
    │ if review_comment → comment  │      │                                  │
    │                              │      │ if pull_request → review         │
    │                              │      │ if review_comment/issue_comment  │
    │                              │      │   → handleCommentEvent() ← 新增 │
    └──────────────────────────────┘      └──────────────────────────────────┘
```

**关键决策**:

1. `tryEarlyReaction()` 放在 Bot 初始化**之前** — Bot 构造涉及 OpenAI client 创建（耗时），表情反应只需要 octokit（已经可用），提前执行可让用户提前 ~1-2s 看到 ACK
2. `issue_comment` 与 `pull_request_review_comment` 合并进同一分支 — 两种事件走同一套命令框架，仅 payload 结构略有差异（dispatcher 内部适配）

**调用链**:

```
main.ts:run()
  ├─ new Options(..., getInput('command_ack_reaction'))    // L27-49
  ├─ options.print()                                        // L53
  ├─ if (issue_comment || review_comment)                   // L56-61
  │    └─ tryEarlyReaction(options.commandAckReaction)      // → early-reaction.ts
  ├─ new Bot(lightBot)                                      // L74-82
  ├─ new Bot(heavyBot)                                      // L93-101
  └─ if (issue_comment || review_comment)                   // L117-123
       └─ handleCommentEvent({heavyBot, lightBot, ...})     // → command-handler.ts
```

---

### 4.2 评论事件顶层入口 `command-handler.ts`

**文件**: `src/command-handler.ts` | **新增**: 53 行

**职责**: 串联 bootstrap → dispatch → fallback 三步

```typescript
export async function handleCommentEvent(deps): Promise<void> {
  // 1. 注册所有命令（幂等，重复调用安全）
  bootstrapCommands()

  // 2. 调度：解析 + 权限 + 执行
  const outcome = await dispatchCommentEvent({options: deps.options})

  // 3. 若调度结果是 "对话 fallback"，透传给旧的对话式追问
  //    仅 pull_request_review_comment 支持（issue_comment 留给迭代二·成员 D）
  if (outcome.kind === 'fallback_conversation') {
    if (context.eventName === 'pull_request_review_comment') {
      await handleReviewComment(deps.heavyBot, deps.options, deps.prompts)
    }
  }
}
```

**为什么不直接在 main.ts 里写**: 解耦。main.ts 只负责事件路由，命令框架的 bootstrap/dispatch/fallback 逻辑集中在此文件，使后续 B/C/D 接入不需要改 main.ts。

---

### 4.3 类型中枢 `types.ts`

**文件**: `src/commands/types.ts` | **新增**: 143 行

所有命令框架的类型集中声明于此，是唯一的"类型入口"。

**核心类型关系**:

```
  ParseOutcome                          CommandContext
  ├─ kind: 'command'|'conversation'     ├─ command: ParsedCommand
  │         |'none'                     ├─ actor: ActorInfo
  ├─ command?: ParsedCommand            ├─ reply: Reply (interface)
  │   ├─ name: string                   ├─ owner/repo/prNumber
  │   ├─ args: string[]                 └─ options: Options
  │   ├─ kv: Record<string,string>
  │   └─ rawAfter: string               CommandHandler
  └─ error?: {code, detail}             ├─ name / aliases / description
                                        ├─ minPermission: PermissionLevel
   ErrorCode (8 种)                     ├─ needsAck: boolean
   ├─ UNKNOWN_COMMAND                   └─ execute(ctx) → CommandResult
   ├─ INVALID_ARGS
   ├─ FORBIDDEN                         PermissionLevel (6 级)
   ├─ BOT_FORBIDDEN                     admin > maintain > write > triage > read > none
   ├─ NOT_IMPLEMENTED                   PERMISSION_RANK: 数值映射
   ├─ RATE_LIMITED                      permissionAtLeast(actual, required): boolean
   ├─ DUPLICATE
   └─ INTERNAL
```

**设计决策**:
- `Reply` 定义为 interface 而非 class 引用 — 避免 handler 对具体实现的循环依赖
- `PermissionLevel` 使用字面量联合而非 enum — 与 GitHub API 返回值零转换，且 `PERMISSION_RANK` 提供数值比较
- `ErrorCode` 为穷举联合 — dispatcher 的 `extractErrorCode()` 可类型安全地映射

---

### 4.4 命令注册表 `registry.ts`

**文件**: `src/commands/registry.ts` | **新增**: 76 行

单例 `CommandRegistry`，维护命令名 → handler 映射。

```
        register(helpHandler)
             │
             ▼
  handlers Map:  "help" → helpHandler

        register(fullReviewStub)
             │
             ▼
  handlers Map:  "help"        → helpHandler
                 "full review" → fullReviewStub    ← 复合命令名含空格
                 "review"      → reviewStub
                 ...

  getRegisteredNames() → Set{"help","full review","review",...}
                              └─ 传给 parser 做命中检测

  listCommands() → [helpHandler, reviewStub, ...]
                        └─ 按注册顺序，供 help 命令输出
```

**为什么重复注册抛异常**: 防止 B/C/D 不小心注册了同名命令导致覆盖。宁可启动失败也不要行为不确定。

**为什么用单例而非参数传递**: registry 需要在多个模块间共享（parser 需要知道有哪些命令名，help 需要列表），传递会让调用链非常长。单例在 Actions 这种"单次执行"环境下没有生命周期问题。

---

### 4.5 启动注册 `bootstrap.ts`

**文件**: `src/commands/bootstrap.ts` | **新增**: 30 行

```typescript
let bootstrapped = false

export function bootstrapCommands(): void {
  if (bootstrapped) return     // ← 幂等保护
  const reg = getRegistry()
  reg.register(helpHandler)    // ← A 交付
  for (const h of ALL_STUBS) { // ← B/C/D 的 7 个占位
    reg.register(h)
  }
  bootstrapped = true
}
```

**调用时机**: 被两个地方调用
1. `early-reaction.ts` — Bot 初始化前（需要 registry 才能做 parse）
2. `command-handler.ts` — dispatcher 执行前

两次调用由 `bootstrapped` flag 保证幂等。

**B/C/D 接入方式**: 在 `stubs.ts` 中把对应 stub 替换为真实 handler 的 import 即可，不需要改 bootstrap.ts。

---

### 4.6 命令解析器 `parser.ts`

**文件**: `src/commands/parser.ts` | **新增**: 214 行

**解析流程图**:

```
输入: "@ai-reviewer: help"
         │
         ▼
[1] 找 @bot mention ─── "@ai-reviewer" at idx=0
    mentions: ["@ai-reviewer","@codesentinel"]
    大小写不敏感: "@AI-Reviewer" ✓
    前置字符校验: 行首/空白/标点 ✓
         │
         ▼
[2] 提取 mention 后内容 ─── ": help"
    去标点前缀: ": " → " help"
    按换行切分: firstLine="help", rawAfter=""
         │
         ▼
[3] 长度校验 ── firstLine.length ≤ 512 ✓
         │
         ▼
[4] 分词 ── tokens = ["help"]
         │
         ▼
[5] 最长前缀匹配:
    尝试 "help" → registered.has("help") ✓
    → name="help", consumed=1
         │
         ▼
[6] 参数提取 ── argTokens = [] (无参数)
    数量校验: 0 ≤ 16 ✓
         │
         ▼
[7] 字符集校验 ── 逐个 arg 检查
    SHELL_METACHARS_RE: /[`$(){}|&;<>\\'"]/
    SAFE_TOKEN_RE: /^[A-Za-z0-9_\-./:=]+$/
         │
         ▼
[8] kv 拆分 ── 检测 "key=value" 形式
         │
         ▼
返回: {kind:"command", command:{name:"help", raw:"help",
       args:[], kv:{}, rawAfter:""}}
```

**复合命令匹配示例**:

```
输入: "@ai-reviewer full review files=src/"
tokens = ["full", "review", "files=src/"]

尝试 3-token: "full review files=src/" → 未注册
尝试 2-token: "full review"            → 已注册 ✓ → consumed=2
argTokens = ["files=src/"]
```

**三种输出**:

| kind | 触发条件 | 后续处理 |
|:-----|:---------|:---------|
| `none` | 评论不含 @bot mention | dispatcher 返回 ignored |
| `conversation` | 含 @bot 但未匹配任何命令名 | dispatcher 返回 fallback_conversation → 走旧的对话追问 |
| `command` | 匹配到命令（可能带 error） | dispatcher 继续走权限/执行流程 |

**安全校验细节**:

| 校验 | 阈值 | 拒绝示例 | 错误码 |
|:-----|:-----|:---------|:-------|
| 命令行总长 | ≤ 512 字符 | 超长文本 | INVALID_ARGS |
| 单个参数长 | ≤ 128 字符 | 极长文件路径 | INVALID_ARGS |
| 参数个数 | ≤ 16 个 | `a b c d ... q` (17个) | INVALID_ARGS |
| shell 元字符 | 黑名单 | `$(whoami)` / `foo\|bar` | INVALID_ARGS |
| 字符集白名单 | `[A-Za-z0-9_\-./:=]` | `请审查` (CJK) | INVALID_ARGS |

---

### 4.7 权限校验 `permission.ts`

**文件**: `src/commands/permission.ts` | **新增**: 89 行

```
getPermission({owner, repo, username})
   │
   ├─ 缓存命中 → 直接返回
   │
   └─ 缓存未命中
       └─ octokit.repos.getCollaboratorPermissionLevel()
            │
            ├─ 成功 → 返回 "admin"|"maintain"|"write"|"triage"|"read"
            │         存入缓存
            │
            └─ 失败 → warning + 返回 "none" + 存入缓存
                       （不抛异常，降级为最低权限）

canExecute(handler, actualPermission, isPrAuthor)
   │
   ├─ permissionAtLeast(actual, handler.minPermission) → true → 放行
   │
   └─ false → 检查 PR 作者豁免
       │
       └─ isPrAuthor && handler.name ∈ {"help","review","full review","summary"}
            → true → 放行（PR 作者可在自己的 PR 上执行这些"无副作用"命令）
            → false → FORBIDDEN
```

**为什么缓存失败结果**: 避免在同一次 run 中对同一用户重复调 API（比如 dispatcher 和 fallback 都要查权限）。失败存 `none` 是最保守的降级——权限不足时用户会收到 FORBIDDEN 错误码，可自行重试。

**PR 作者豁免列表**: `help`、`review`、`full review`、`summary` 是"只影响自己 PR、无副作用"的命令。`resolve`、`pause`、`resume`、`configuration` 不在列表中——这些可能影响协作状态。

---

### 4.8 速率限制 `rate-limit.ts`

**文件**: `src/commands/rate-limit.ts` | **新增**: 56 行

```
checkRateLimit({platform, projectPath, changeRequestId, actor})
   │
   ├─ rateLimitKey(scope) → 四段各自 encodeURIComponent 后用 ':' 连接
   │
   ├─ 获取或创建 bucket
   │    buckets: Map<key, {timestamps: number[]}>
   │
   ├─ 清理窗口外记录（now - 60_000 之前的 timestamp）
   │
   ├─ bucket.timestamps.length >= 10
   │    → {allowed: false, retryAfterMs: 最早记录 + 60s - now}
   │
   └─ < 10
        → push(now), 返回 {allowed: true}
```

**限流域**（CMD-027）: `platform + project + PR/MR + actor` 四元组，任一维不同即互不影响。早先 key 是裸 actor 名，双平台之后会串桶——同一个人在 GitHub PR 和 GitLab MR 上、在两个项目上、在同一项目的两个 MR 上发命令会互相消耗配额。

**这是保留的进程内 best-effort 防护，当前调用模型下基本不会触发**（CMD-029）。桶只活在单个 Node 进程里，而 GitHub comment 与 GitLab note 是一条事件一个新进程，所以：跨 run / 跨 pipeline 一律不生效（即便 `resource_group` 让 pipeline 串行）；同一条评论的重复投递在 dispatcher 里先被幂等检查拦下，根本走不到限流；不同投递又通常各在各的进程里。

因此它**不负责**重复投递防护——那是 event/note marker 幂等检查的职责，该检查排在限流之前，重复投递也不消耗配额。持续性滥用防护依赖平台自身的 abuse detection。用户可见文案相应不给「N 条 / M 秒」的配额承诺。

---

### 4.9 回复工具 `reply.ts`

**文件**: `src/commands/reply.ts` | **新增**: 197 行

**四种状态与 API 调用**:

```
         ack("正在执行...")        success("结果...")
              │                        │
              ▼                        ▼
     createComment(body)        if ackId?
     → 返回 ackId                  → updateComment(ackId, body)  ← 复用 ACK 评论
                                 else
                                   → createComment(body)         ← 新建评论

         error(code, detail)    progress("进度50%...")
              │                        │
              ▼                        ▼
     同 success 逻辑              updateComment(ackId, body)
     （body 带错误码文案）         ← 更新已有 ACK 评论
```

**评论格式**:

```markdown
<!-- codesentinel-cmd-reply:12345:help -->     ← 幂等标签（HTML 注释，不可见）
🦉 CodeSentinel · `help`                       ← GREETING + 命令名

## 支持的命令                                   ← 命令输出
...
```

**幂等标签设计**: `<!-- codesentinel-cmd-reply:{originalCommentId}:{commandName} -->`

- `originalCommentId` 保证同一条用户评论不会被处理两次
- `commandName` 允许同一评论的不同命令各自有独立标签（当前 parser 只取第一个命令，但预留了扩展性）

**错误码→文案映射** (`formatErrorMessage`):

| 错误码 | 用户看到的文案 |
|:-------|:-------------|
| UNKNOWN_COMMAND | ❓ **未知命令**。发送 `@ai-reviewer help` 查看支持的命令列表。 |
| INVALID_ARGS | ⚠️ **参数不合法**。命令参数仅接受字母、数字以及 `._-/:=` 字符。 |
| FORBIDDEN | 🚫 **权限不足**。执行该命令需要仓库 `write` 及以上权限。 |
| NOT_IMPLEMENTED | 🚧 **命令暂未实现**。该命令已在路线图中，等待实现。 |
| RATE_LIMITED | ⏱️ **请求过于频繁**。本次运行中检测到过多命令请求，请稍后再试。 |
| DUPLICATE | ℹ️ **命令已处理**（重复事件已去重）。 |
| INTERNAL | 💥 **命令执行失败**。错误已记录，请联系维护者。 |

---

### 4.10 调度主流程 `dispatcher.ts`

**文件**: `src/commands/dispatcher.ts` | **新增**: 309 行

这是命令框架的核心——10 步流水线，每一步都可能提前返回。

```
dispatchCommentEvent(deps)
│
├─ [1] 事件类型校验
│   eventName ∉ {issue_comment, review_comment}
│   → return {kind:"ignored", reason:"unsupported event"}
│
├─ [2] action 校验
│   payload.action ≠ "created"
│   → return {kind:"ignored", reason:"action not created"}
│
├─ [3] 提取 PR/评论元数据
│   ┌─ issue_comment:
│   │   prNumber = payload.issue.number
│   │   comment = payload.comment
│   │   没有 head/base SHA（需 handler 自行查）
│   └─ review_comment:
│       prNumber = payload.pull_request.number
│       headSha / baseSha 可直接取
│
├─ [4] Bot 自评论过滤
│   comment.user.type === "Bot" || /\[bot\]$/
│   → return {kind:"ignored", reason:"comment from bot"}
│
├─ [5] 命令解析 (parser.parse)
│   outcome.kind === "none"
│   → return {kind:"ignored", reason:"no bot mention"}
│   outcome.kind === "conversation"
│   → return {kind:"fallback_conversation"}
│
├─ [6] 构造 Reply（此时即便解析有 error 也继续，以便反馈给用户）
│   outcome.error?
│   → reply.error(code, detail)
│   → return {kind:"executed", ok:false, error:code}
│
├─ [7] 幂等检查 (hasBeenProcessed)
│   扫描评论区是否已有 <!-- codesentinel-cmd-reply:{commentId}:{cmd} -->
│   → true → return {kind:"executed", ok:false, error:"DUPLICATE"}
│
├─ [8] 速率限制 (checkRateLimit)
│   → {allowed:false}
│   → reply.error("RATE_LIMITED", "请 N 秒后再试")
│   → return {kind:"executed", ok:false, error:"RATE_LIMITED"}
│
├─ [9] 权限校验
│   registry.get(name) → handler
│   handler 不存在 → reply.error("UNKNOWN_COMMAND")
│   getPermission() + canExecute() → false
│   → reply.error("FORBIDDEN")
│
└─ [10] 执行
    handler.needsAck? → reply.ack("正在执行...")
    handler.execute(ctx)
    → 成功 → reply.success(message)
    → 抛异常 → extractErrorCode(e) → reply.error(code, detail)
    return {kind:"executed", command:name, ok:true/false}
```

**DispatchOutcome 类型**（返回给 command-handler.ts 做 fallback 决策）:

| kind | 含义 | command-handler.ts 行为 |
|:-----|:-----|:----------------------|
| `ignored` | 非命令事件 / 过滤掉 | 不做任何事 |
| `fallback_conversation` | 含 @bot 但不是命令 | 走旧的 handleReviewComment（仅 review_comment） |
| `executed` | 命令已处理（成功或失败） | 不做任何事（reply 已写回） |

---

### 4.11 help 命令 `handlers/help.ts`

**文件**: `src/commands/handlers/help.ts` | **新增**: 66 行

**纯函数 `buildHelpMessage(commands)`** — 与 registry 解耦，便于单测:

```typescript
// 输入: registry.listCommands() 返回的 handler 数组
// 输出: Markdown 表格

## 支持的命令

| 命令 | 描述 | 最低权限 |
| :--- | :--- | :------- |
| `@ai-reviewer review` | 触发增量审查 | `write` |
| `@ai-reviewer full review` | 触发全量审查 | `write` |
| ... |
| `@ai-reviewer help` | 显示所有支持的命令 | `read` |   ← help 排最后

> 🦉 Bot 同时支持 `@ai-reviewer` 与 `@codesentinel` 两个 mention。
```

**handler 配置**:
- `name: "help"`, `minPermission: "read"`, `needsAck: false`
- 执行时调用 `getRegistry().listCommands()` → `buildHelpMessage()`

---

### 4.12 B/C/D 占位 `handlers/stubs.ts`

**文件**: `src/commands/handlers/stubs.ts` | **新增**: 95 行

为 B/C/D 成员预注册 7 个命令占位:

| 命令 | 负责人 | needsAck | minPermission |
|:-----|:-------|:---------|:-------------|
| resolve | B | true | write |
| review | C | true | write |
| full review | C | true | write |
| summary | C | true | write |
| pause | C | false | write |
| resume | C | false | write |
| configuration | C | false | read |

所有 stub 的 `execute()` 统一抛出带 `code: 'NOT_IMPLEMENTED'` 的 Error。dispatcher 的 `extractErrorCode()` 会把它转成 NOT_IMPLEMENTED 错误回复。

---

### 4.13 ACK 表情 `reaction.ts` + `early-reaction.ts`

**文件**: `src/commands/reaction.ts` (103 行) + `src/commands/early-reaction.ts` (85 行)

**`reaction.ts`** — 底层封装:

```
normalizeReaction("rocket")
   │
   ├─ trim + toLowerCase
   ├─ "" / "off" / "none" / "false" → null (禁用)
   ├─ VALID_REACTIONS.includes → "rocket" ✓
   └─ 不合法 → warning + null

addAckReaction({owner, repo, commentId, eventName, rawReaction})
   │
   ├─ normalizeReaction → null → return (禁用)
   │
   └─ content 合法
       ├─ eventName = "issue_comment"
       │    → octokit.reactions.createForIssueComment()
       │
       └─ eventName = "pull_request_review_comment"
            → octokit.reactions.createForPullRequestReviewComment()

       失败 → warning（不抛异常，不阻塞命令执行）
```

**`early-reaction.ts`** — 提前 ACK:

```
tryEarlyReaction(rawReaction)
   │
   ├─ 校验事件类型（非评论事件 → return）
   ├─ 校验 payload.action = "created"
   ├─ 提取 comment（适配两种事件 payload）
   ├─ 过滤 Bot 自评论
   ├─ bootstrapCommands()  ← 注册命令（幂等）
   ├─ parse(comment.body)  ← 快速解析
   ├─ outcome.kind ≠ "command" → return（非命令不打表情）
   └─ addAckReaction(...)  ← 打表情
```

**为什么分两个文件**: `reaction.ts` 是纯工具（可被任何地方调用），`early-reaction.ts` 是编排逻辑（含事件解析，只被 main.ts 调用）。

**为什么 early-reaction 里再调一次 bootstrapCommands**: parser 需要 `registeredCommands` 才能做命中检测。bootstrap 有幂等保护，重复调用无成本。

---

### 4.14 Bot 名称/图标可配置化

**改动文件**: `action.yml` + `commenter.ts` + `reply.ts` + `review.ts` + `handlers/help.ts`

**数据流**:

```
action.yml:
  bot_icon: default '🦉'
  bot_name: default 'CodeSentinel'
       │
       ▼
getInput('bot_icon')  getInput('bot_name')
       │                    │
       ▼                    ▼
commenter.ts:28   COMMENT_GREETING = `${icon}   ${name}`
                  → "🦉   CodeSentinel"
                  → 用于 PR 摘要评论、审查评论的顶部标识

reply.ts:20       GREETING = `${icon} ${name}`
                  → "🦉 CodeSentinel"
                  → 用于命令回复评论的标识

review.ts:507     botName = getInput('bot_name') || 'AI Reviewer'
                  → "Summary by CodeSentinel"
                  → "About CodeSentinel"
                  → "Chat with CodeSentinel Bot"

handlers/help.ts:50  `${getInput('bot_icon')} Bot 同时支持...`
                     → "🦉 Bot 同时支持..."
```

**未改动的（故意保留）**: HTML 注释标签（如 `<!-- This is an auto-generated comment by AI Reviewer -->`）里的 "AI Reviewer" **不做动态替换**。这些标签是 **不可见的定位标识符**，commenter.ts 通过 `.includes(TAG)` 查找已有评论来决定"是更新还是新建"。如果动态化，会导致：
- 修改 bot_name 后找不到旧评论 → 创建重复的 summary 评论
- 多个 bot_name 配置之间互相覆盖

---

## 5. action.yml 新增输入

| 输入名 | 类型 | 默认值 | 说明 |
|:-------|:-----|:-------|:-----|
| `command_ack_reaction` | string | `rocket` | 命令被识别后在用户评论上打的表情。合法值: `+1` / `-1` / `laugh` / `confused` / `heart` / `hooray` / `rocket` / `eyes`。设为空 / `off` / `none` 禁用 |
| `bot_name` | string | `CodeSentinel` | 评论中显示的 Bot 名称 |
| `bot_icon` | string | `🦉` | 评论中显示的 Bot 图标 |

---

## 6. 安全设计

### 6.1 命令注入防护

**三层防御**（`parser.ts`）:

| 层级 | 机制 | 拦截示例 |
|:-----|:-----|:---------|
| L1 shell 元字符黑名单 | `/[`$(){}|&;<>\\'"]/` | `$(whoami)`, `foo|bar`, `\`id\`` |
| L2 字符集白名单 | `/^[A-Za-z0-9_\-./:=]+$/` | `请审查` (CJK), `rm -rf /` (空格在分词阶段已处理，`-rf` 合法但 `/` 需要检查上下文) |
| L3 长度限制 | 行 ≤ 512, arg ≤ 128, count ≤ 16 | 超长 payload |

**防御顺序**: 先检查 shell 元字符（产出更明确的错误信息 `INVALID_ARGS: 参数包含非法字符`），再检查白名单（通用拒绝）。

### 6.2 Bot 自触发防护

`dispatcher.ts` 第 4 步:

```typescript
const actorIsBot =
  comment.user?.type === 'Bot' || /\[bot\]$/i.test(actorLogin)
if (actorIsBot) return {kind:'ignored', reason:'comment from bot'}
```

两种检测互为补充: `type === 'Bot'` 是标准方式，`/\[bot\]$/i` 是容错（某些 GitHub App 的 type 字段不一定是 "Bot"）。

### 6.3 权限模型

```
  命令         所需权限    PR 作者豁免
  help         read        ✓
  configuration read       ✗
  review       write       ✓ (只影响自己 PR)
  full review  write       ✓ (只影响自己 PR)
  summary      write       ✓ (只影响自己 PR)
  resolve      write       ✗ (影响协作者的 review thread)
  pause        write       ✗ (影响自动审查行为)
  resume       write       ✗
```

---

## 7. 幂等与去重

**场景**: GitHub webhook 可能因超时/重试产生重复的 `issue_comment.created` 事件。

**机制** (`reply.ts:hasBeenProcessed`):

```
1. 拿到 (originalCommentId=12345, commandName="help")
2. 计算 tag = "<!-- codesentinel-cmd-reply:12345:help -->"
3. octokit.issues.listComments(per_page=100) — 扫描所有评论
4. 检查是否有评论 body 包含此 tag
5. 有 → return true → dispatcher 返回 DUPLICATE
   无 → return false → 继续执行
```

**tradeoff**: 一期用 listComments 扫描，最多 100 条。如果 PR 评论超过 100 条，可能漏判（false negative）——但此时意味着 PR 活跃度极高，重复执行一次 help 的代价几乎为零。后续可改用 GraphQL 分页查询。

---

## 8. 错误处理策略

| 组件 | 错误处理方式 | 原因 |
|:-----|:------------|:-----|
| `getPermission()` | catch → return "none" + warning | 权限查询失败不应阻塞所有命令，降级为最低权限 |
| `reply.ack()` | catch → return null + warning | ACK 失败后 success/error 会 fallback 到 createComment |
| `reply.publish()` | updateComment 失败 → fallback createComment | ackId 可能已被删除 |
| `addAckReaction()` | catch → warning | 表情只是锦上添花，不应影响命令执行 |
| `tryEarlyReaction()` | 全局 try-catch → info | 整个早期 ACK 失败都不应阻塞主流程 |
| `handler.execute()` | catch → extractErrorCode → reply.error | 统一把 handler 内部错误转成用户可读反馈 |
| `hasBeenProcessed()` | catch → return false + warning | 幂等检查失败时宁可多执行一次 |

**总体原则**: 命令框架的任何组件失败都**不应**阻塞其他命令或主 review 流程。所有 catch 都走 `warning()` 记录 + 降级处理。

---

## 9. 测试覆盖

| 测试文件 | 测试数 | 覆盖模块 | 关键场景 |
|:---------|:-------|:---------|:---------|
| `command-parser.test.ts` | 30 | parser | 大小写、标点容错、复合命令、shell 元字符、超长、CJK、多行 |
| `command-registry.test.ts` | 7 | registry | 注册/查找/别名/重复注册报错/listCommands 顺序 |
| `command-permission.test.ts` | 12 | permission | 各权限等级、缓存、API 失败降级、PR 作者豁免 |
| `command-rate-limit.test.ts` | 3 | rate-limit | 窗口内允许/拒绝/窗口滑动 |
| `command-help.test.ts` | 6 | help handler | Markdown 格式、别名区域、图标、空列表 |
| `command-dispatcher.test.ts` | 13 | dispatcher | 完整 10 步流水线、各种 ignore/error/success 路径 |
| **合计** | **182** | | 所有测试通过 |

**mock 策略**: `@actions/core` 和 `@actions/github` 通过 `jest.mock()` 全局 mock；`octokit` 通过 `jest.fn()` 在各测试中按需设置返回值。dispatcher 测试 mock 了 parser、permission、rate-limit、reply 四个模块的具体函数。

---

## 10. B/C/D 接入指南

### 接入步骤（以成员 B 的 resolve 为例）

```
1. 创建 src/commands/handlers/resolve.ts
   export const resolveHandler: CommandHandler = {
     name: 'resolve',
     description: '...',
     needsAck: true,
     minPermission: 'write',
     async execute(ctx: CommandContext): Promise<CommandResult> {
       // 真实实现: GraphQL 查询 + resolveReviewThread
       // ctx.reply 可用于发送进度: ctx.reply.progress("已处理 3/10...", ackId)
       return {message: "✅ 已解决 10 条意见"}
     }
   }

2. 修改 src/commands/handlers/stubs.ts
   - import {resolveHandler} from './resolve'
   - 把 ALL_STUBS 中的 resolveStub 替换为 resolveHandler

3. 添加测试
   __tests__/command-resolve.test.ts
```

### 可用的上下文 (CommandContext)

```typescript
ctx.command.name     // "resolve"
ctx.command.args     // ["files=src/"]
ctx.command.kv       // {files: "src/"}
ctx.command.rawAfter // 换行后的文本

ctx.owner            // 仓库 owner
ctx.repo             // 仓库名
ctx.prNumber         // PR 编号
ctx.headSha          // PR head commit SHA（issue_comment 时为空）
ctx.baseSha          // PR base commit SHA（issue_comment 时为空）

ctx.actor.login      // 评论者 GitHub 用户名
ctx.actor.permission // "admin"|"maintain"|"write"|"triage"|"read"|"none"
ctx.actor.isPrAuthor // 是否 PR 作者

ctx.commentId        // 原评论 ID
ctx.commentBody      // 原评论全文
ctx.commentNodeId    // GraphQL node ID（review_comment 时有值）

ctx.reply            // Reply 实例，可调用 ack/success/error/progress
ctx.options          // 全局 Options 配置
```

### 注意事项

- handler 的 `execute()` 不需要自己处理权限检查（dispatcher 已做）
- handler 的 `execute()` 不需要自己处理速率限制（dispatcher 已做）
- handler 抛出异常时，dispatcher 会自动转成错误回复
- 如果需要自定义错误码，在 Error 上挂 `code` 属性: `const e = new Error('...'); e.code = 'NOT_IMPLEMENTED'; throw e`
- `needsAck: true` 的命令，dispatcher 会在 execute 前自动发一条 "⏳ 正在执行..." 评论，execute 完成后 reply.success 会更新该评论（而非新建）

---

## 11. 预期 Review 问题 FAQ

### Q1: 为什么 parser 不用正则一步到位，而是分 8 步？

正则方案（如 `/@(ai-reviewer|codesentinel)\s+(\w+)\s*(.*)/`）看起来简洁，但：
- 无法做最长前缀匹配（`full review` vs `full`）
- 无法逐参数做安全校验（正则只能匹配整行）
- 无法区分 `command` / `conversation` / `none` 三种语义
- 错误信息不够具体（超长？非法字符？shell 注入？）

分步方案虽然代码更长，但每一步的意图清晰、可测试、可扩展。

### Q2: 幂等检查用 listComments 扫描，会不会太慢？

单次 API 调用，per_page=100，响应时间通常 < 200ms。对于"检查一个 HTML 注释标签是否存在"这个需求，这是最简方案。更快的方案（如 GraphQL 搜索特定 body 片段）在 GitHub API 中不直接支持。如果 PR 评论超过 100 条，可以改用 paginate 分页查全部。

### Q3: rate-limit 只在进程内，有什么实际意义？

GitHub Actions 中每次 issue_comment 事件会启动一个独立 runner 进程，GitLab note 同理，进程间不共享状态。**当前调用模型下它基本不会触发**：

- 用户连发命令 → 每条一个新进程，桶都是空的，限不住
- 同一条评论重复投递 → dispatcher 里幂等检查排在限流之前，在那一步就返回了（CMD-030）

所以不要把它描述成「防重复投递」或「防 webhook 抖动」。它的实际价值是：

- 防止 **dispatcher 被代码 bug 循环调用**（单进程内确实生效）
- 一旦调用模型变化（单进程处理多条命令、批量回放、常驻进程）立刻有意义
- 占位，为后续引入 Redis/KV 存储做准备（CMD-032 范围内不做）

### Q4: 为什么 reply 的 HTML 标签里用 `codesentinel-cmd-reply` 而不是配置化？

幂等标签是**跨 run 持久化的数据协议**。如果跟着 bot_name 变，改名后 dispatcher 找不到旧标签 → 同一命令被重复执行。标签固定为 `codesentinel-cmd-reply` 是故意的——与 bot_name 解耦。

### Q5: early-reaction 和 dispatcher 对 payload 做了两次几乎相同的解析，能不能合并？

不能。两者的执行时机不同：
- early-reaction 在 **Bot 初始化之前**（此时只有 octokit 可用）
- dispatcher 在 **Bot 初始化之后**（需要 Options 和可能的 Bot 引用）

提取共享函数可以减少代码重复，但会引入"谁先调用谁后调用"的时序耦合。当前的冗余量（~20 行 payload 提取）可接受，且两者的 early-exit 条件略有不同（early-reaction 不做权限/幂等/限流检查）。

### Q6: commandAckReaction 在 action.yml 里配置，如果想 per-repo 覆盖怎么办？

通过 workflow 的 `with:` 覆盖:

```yaml
with:
  command_ack_reaction: eyes   # 覆盖默认的 rocket
```

如果想在运行时动态关闭（比如某个命令不想打表情），当前不支持——reaction 是在 parse 之后、handler 执行之前统一打的。如有需求可在 handler 配置中增加 `skipReaction: boolean`。

### Q7: 为什么 HTML 注释标签里的 "AI Reviewer" 不跟着 bot_name 变？

见 [§4.14](#414-bot-名称图标可配置化) 末尾说明。改了会导致改名后找不到旧评论 → 创建重复 summary 评论。

### Q8: 如果 B/C/D 想给命令添加子命令（如 `review --force`），框架支持吗？

框架已支持。`--force` 会被 parser 当作普通 arg 处理（通过 `args` 数组传给 handler）。handler 在 `execute()` 内部自行解析 args 即可。kv 参数（如 `files=src/`）会被自动拆到 `ctx.command.kv` 中。

### Q9: 如果 PR 被 pause 了，用户发 `@ai-reviewer help` 还能响应吗？

能。pause/resume 只影响**自动审查**（push 触发的 synchronize 事件），不影响命令框架。命令走 issue_comment 事件 → dispatcher → handler，与 review 流程独立。

### Q10: 并发安全？两个人同时发 `@ai-reviewer resolve` 会怎样？

两条 issue_comment 事件 → 两个独立 runner 进程 → 各自独立执行。幂等标签是 per-commentId 的，两个不同评论有不同 ID，不会互相去重。resolve 的具体实现（成员 B 负责）需要考虑 GraphQL resolveReviewThread 的幂等性（已 resolve 的 thread 再 resolve 不会报错）。
