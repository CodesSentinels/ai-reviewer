---
title: AI Reviewer 系统架构与数据流
sidebar_label: 00 系统架构与数据流
sidebar_position: 3
---

# AI Reviewer 系统架构与数据流

> 本文用 mermaid 图描述 **当前已合并功能**（迭代一智能分析管线 + 迭代二评论区交互）的整体架构、模块分层与各主要链路的数据流。
> 作为全局视图，细节实现见各成员设计文档（[A 命令框架](04-iteration-02-member-a-design.md) / [D 对话与噪音控制](04-iteration-02-member-d-design.md) 等）。

---

## 1. 系统总览

GitHub Action 启动后由 `main.ts` 按事件类型分流：**PR 事件**走自动审查管线，**评论事件**走命令调度。

```mermaid
flowchart TB
    GH["GitHub 事件<br/>pull_request / *_review_comment / issue_comment"] --> MAIN["main.ts · run()"]
    MAIN --> OPT["读取 inputs → Options"]
    MAIN --> RT{"GITHUB_EVENT_NAME?"}

    RT -- "pull_request / _target" --> REV["review.ts · codeReview()<br/>自动审查管线"]
    RT -- "issue_comment / pull_request_review_comment" --> CH["command-handler.ts · handleCommentEvent()"]

    CH --> EARLY["early-reaction 打 👀 ACK"]
    CH --> DISP["commands/dispatcher.ts · dispatchCommentEvent()"]
    DISP -->|command| HANDLERS["命令处理器 (help/resolve/review/...)"]
    DISP -->|fallback_conversation| CONV["conversation.ts · handleConversation()"]
    DISP -->|ignored| STOP["结束"]

    HANDLERS -. "review / full review / summary" .-> REV
    REV --> NC["noise-control.ts 排序/截断/徽标"]
    REV --> CMT["commenter.ts 发布评论 / 摘要 / 描述"]
    CONV --> LLM["bot.ts heavyBot.chat"]
    HANDLERS --> CMT
    CONV --> CMT

    subgraph EXT["外部依赖"]
        OPENAI["OpenAI Responses API"]
        GHAPI["GitHub REST / GraphQL"]
    end
    LLM --> OPENAI
    REV --> OPENAI
    CMT --> GHAPI
    HANDLERS --> GHAPI
```

---

## 2. 模块分层

```mermaid
flowchart TB
    subgraph L0["入口层"]
        MAIN["main.ts"]
    end

    subgraph L1["平台 / 命令框架（成员 A）"]
        CH["command-handler.ts"]
        DISP["commands/dispatcher.ts"]
        PARSER["commands/parser.ts"]
        REG["commands/registry.ts"]
        PERM["commands/permission.ts"]
        RL["commands/rate-limit.ts"]
        REPLY["commands/reply.ts"]
        REACT["commands/(early-)reaction.ts"]
    end

    subgraph L2["命令处理器"]
        HELP["help (A)"]
        RESOLVE["resolve (B)"]
        CCTRL["review/full review/summary<br/>pause/resume/configuration (C)"]
    end

    subgraph L3["审查引擎（迭代一）"]
        REVIEW["review.ts codeReview()"]
        PROMPTS["prompts.ts"]
        INPUTS["inputs.ts"]
        DEP["dependency-analyzer.ts"]
        STATE["review-state.ts"]
        CHANGED["changed-lines.ts"]
    end

    subgraph L4["对话 & 噪音控制（成员 D）"]
        CONV["conversation.ts"]
        NOISE["noise-control.ts"]
    end

    subgraph L5["工具适配 / 基础设施"]
        BOT["bot.ts (OpenAI)"]
        CMT["commenter.ts"]
        OCT["octokit.ts"]
        TOK["tokenizer.ts"]
        TREE["repo-tree.ts"]
        RTHREAD["github/review-thread.ts (B)"]
        LINT["lint/* 编排 + 适配器"]
    end

    MAIN --> CH & REVIEW
    CH --> DISP --> PARSER & REG & PERM & RL & REPLY
    CH --> REACT
    REG --> HELP & RESOLVE & CCTRL
    CCTRL --> REVIEW
    CH --> CONV
    REVIEW --> PROMPTS & INPUTS & DEP & STATE & CHANGED & NOISE & LINT
    CONV --> NOISE
    HELP & RESOLVE & CCTRL & CONV & REVIEW --> CMT
    RESOLVE --> RTHREAD
    REVIEW & CONV --> BOT
    CMT & RTHREAD & PERM & RL --> OCT
    REVIEW & CONV --> TOK
    REVIEW --> TREE
```

---

## 3. 自动审查数据流（`codeReview`）

PR 事件触发，分三阶段：**摘要 → 逐文件审查 → 汇总**。

```mermaid
flowchart TD
    START["pull_request 事件"] --> DIFF["拉取 base..HEAD diff（增量基于 last_reviewed_sha）"]
    DIFF --> FILTER["path_filters 过滤 + maxFiles 限制"]

    subgraph S1["阶段一 · 摘要（lightBot）"]
        FILTER --> SUMF["逐文件 summarizeFileDiff + triage"]
        SUMF --> DEPAN["dependency-analyzer 跨文件引用上下文"]
    end

    subgraph S2["阶段二 · 审查（heavyBot）"]
        DEPAN --> LINT["lint/orchestrator 跑 ESLint/Biome/tsc/Prettier/Semgrep"]
        LINT --> RVW["逐文件 reviewFileDiff（含 shell / web_search → Analysis chain）"]
        RVW --> PARSE["parseReview → {startLine,endLine,comment}"]
        PARSE --> SEV["classifyFindingSeverity + severityBadge"]
        SEV --> COLLECT["收集 findings: Finding[]"]
        COLLECT --> PREP["prepareFindings: 按严重级别排序 + 截断 max_review_comments"]
        PREP --> BUF["bufferReviewComment → submitReview"]
    end

    subgraph S3["阶段三 · 汇总"]
        BUF --> CHGSET["summarizeChangesets / summarizeShort"]
        CHGSET --> RN["release notes → updateDescription（Summary by Bot）"]
        RN --> SUMTAG["SUMMARIZE_TAG 摘要评论"]
        SUMTAG --> COMMITID["记录已审查 commit SHA（增量状态）"]
    end
```

> 噪音控制（§6）已内嵌在阶段二：严重级别以 `severityBadge` 警示框置于每条行级评论顶部，发现按严重级别排序并截断到 `max_review_comments`（默认 20，`≤0` 不限制）。

---

## 4. 评论命令调度数据流（`dispatchCommentEvent`）

```mermaid
flowchart TD
    EV["issue_comment / pull_request_review_comment (created)"] --> BOOT["bootstrapCommands 注册表"]
    BOOT --> FILT{"事件 / payload 校验"}
    FILT -- "非 PR / 非 created" --> IG1["ignored"]
    FILT -- ok --> SELF{"评论作者是 bot?"}
    SELF -- 是 --> IG2["ignored: comment from bot"]
    SELF -- 否 --> PARSE["parser.parse(body)"]

    PARSE -->|none 无 @bot| IG3["ignored: no bot mention"]
    PARSE -->|conversation 命中 @bot 未命中命令| FB["fallback_conversation → handleConversation"]
    PARSE -->|command| IDEM["幂等检查 hasBeenProcessed"]

    IDEM --> RLIM["rate-limit"]
    RLIM --> LOOKUP["registry.get(name)"]
    LOOKUP --> PERMC["权限校验 canExecute"]
    PERMC --> ACK["needsAck → reply.ack(👀/进度)"]
    ACK --> EXEC["handler.execute(ctx)"]
    EXEC --> FBK["reply.success / reply.error"]
```

**命令路由：**

```mermaid
flowchart LR
    EXEC["handler.execute"] --> HELP["help → 帮助信息 (A)"]
    EXEC --> RESOLVE["resolve → 批量 resolveReviewThread (B)"]
    EXEC --> RV["review / full review → triggerReview() → codeReview (C)"]
    EXEC --> PR["pause / resume → PR 状态 (C)"]
    EXEC --> SUM["summary → 重生成摘要 (C)"]
    EXEC --> CFG["configuration → 展示配置 (C)"]
```

---

## 5. 对话式追问数据流（`handleConversation` · 成员 D）

```mermaid
sequenceDiagram
    actor Dev as 开发者
    participant GH as GitHub
    participant A as dispatcher (A)
    participant D as conversation.ts (D)
    participant CM as Commenter
    participant LLM as heavyBot

    Dev->>GH: 在 Bot 行级评论 thread 内回复 "@ai-reviewer 为什么..."
    GH-->>A: pull_request_review_comment.created
    A->>A: parse → conversation（必须含 @bot）
    A-->>D: fallback_conversation → handleConversation()
    D->>D: isFollowUpQuestion 必须 @bot，排除 bot 自身
    D->>CM: getCommentChain 收集 thread 历史
    D->>GH: compareCommits 取关联文件 diff
    D->>D: truncateConversationChain 截断 + token 预算
    D->>D: countBotTurns 轮次上限 (10)
    D->>LLM: heavyBot.chat(renderComment)
    LLM-->>D: 回复文本（含 Analysis chain）
    D->>CM: reviewCommentReply（前缀真实 @用户名）
    CM->>GH: 发布到 thread
```

---

## 6. 噪音控制数据流（`noise-control.ts` · 成员 D）

```mermaid
flowchart TD
    R["每条解析结果 review.comment"] --> CL["classifyFindingSeverity 关键词分级"]
    CL --> BADGE["severityBadge 生成 GitHub 警示框徽标"]
    BADGE --> F["Finding{path,line,severity,body}"]
    F --> PREP["prepareFindings(dedupe:false)<br/>按严重级别排序 + 截断 max_review_comments"]
    PREP --> POST["逐条 bufferReviewComment"]
    PREP -. "被截断数量" .-> ST["审查状态区 Posted / truncated"]

    F -. "可选工具（默认不在实时管线调用）" .-> DD["dedupeFindings 同类合并"]
    DD --> FC["formatComments 折叠低优先级"]
    FC --> SUMM["postSummaryComment PR 顶部汇总（FINDINGS_SUMMARY_TAG）"]
```

> 当前实时管线把严重级别**分散到每条行级评论**（徽标），不再单独发 PR 顶部汇总评论；`dedupeFindings` / `formatComments` / `postSummaryComment` 作为可选工具保留并有单测覆盖。

---

## 7. 端到端时序（开发者视角）

```mermaid
sequenceDiagram
    actor Dev as 开发者
    participant GH as GitHub
    participant Bot as AI Reviewer

    Dev->>GH: 推送 commits / 开 PR
    GH->>Bot: pull_request 事件
    Bot->>Bot: 摘要 → 审查 → 汇总
    Bot-->>GH: 行级评论（含严重级别徽标）+ PR 摘要 / 描述

    Dev->>GH: @ai-reviewer 在某条评论下追问
    GH->>Bot: pull_request_review_comment
    Bot-->>GH: 带上下文的对话回复

    Dev->>GH: @ai-reviewer resolve
    GH->>Bot: issue_comment
    Bot-->>GH: 批量 resolve threads + 结果反馈

    Dev->>GH: 修复后再推送
    GH->>Bot: pull_request（增量审查 last_reviewed_sha..HEAD）
    Bot-->>GH: 仅审查新增变更
```

---

## 8. 关键支撑模块

| 模块 | 职责 |
| :--- | :--- |
| `bot.ts` | 封装 OpenAI Responses API；支持 web_search / 本地 shell（Analysis chain）与多轮上下文 |
| `commenter.ts` | PR 评论/审查评论/描述的增删改查；评论链组装；增量审查 commit 状态 |
| `octokit.ts` | GitHub REST/GraphQL 客户端（含 retry / throttling） |
| `prompts.ts` / `inputs.ts` | 提示词模板与 `$变量` 渲染容器 |
| `tokenizer.ts` | token 计数，控制各阶段上下文预算 |
| `dependency-analyzer.ts` / `repo-tree.ts` | 跨文件引用与仓库结构上下文 |
| `review-state.ts` / `changed-lines.ts` | 增量审查状态与变更行计算 |
| `lint/*` | Linter/SAST 编排与适配器（ESLint / Biome / tsc / Prettier / Semgrep） |
| `github/review-thread.ts` | review thread 的 GraphQL 查询与批量 resolve（成员 B） |
| `commands/*` | 命令解析 / 注册 / 路由 / 权限 / 限流 / 回复 / 表情（成员 A） |
