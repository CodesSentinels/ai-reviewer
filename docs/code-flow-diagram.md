# AI PR Reviewer - 代码运行流程图

## 1. 系统架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│                        GitHub Action 触发                        │
│  (pull_request / pull_request_target / pull_request_review_comment) │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                      main.ts (入口文件)                          │
│                                                                   │
│  1. 解析 Action 输入参数 → Options                                │
│  2. 构建提示词模板 → Prompts                                      │
│  3. 创建 lightBot (摘要) + heavyBot (审查)                       │
│  4. 根据事件类型分发 ──────┐                                      │
└─────────────────────────────┼──────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              │                               │
              ▼                               ▼
   pull_request 事件              pull_request_review_comment
              │                               │
              ▼                               ▼
┌──────────────────────┐        ┌──────────────────────┐
│  review.ts           │        │  review-comment.ts   │
│  codeReview()        │        │  handleReviewComment()│
└──────────────────────┘        └──────────────────────┘
```

## 2. 模块依赖关系

```
main.ts ─────────┬──→ bot.ts ──────→ fetch-polyfill.js
                 │                    options.ts
                 ├──→ options.ts ──→ limits.ts
                 ├──→ prompts.ts ──→ inputs.ts
                 ├──→ review.ts ───┬→ bot.ts
                 │                 ├→ commenter.ts ──→ octokit.ts
                 │                 ├→ inputs.ts
                 │                 ├→ octokit.ts
                 │                 ├→ prompts.ts
                 │                 └→ tokenizer.ts
                 └──→ review-comment.ts ─┬→ bot.ts
                                         ├→ commenter.ts
                                         ├→ inputs.ts
                                         ├→ octokit.ts
                                         ├→ prompts.ts
                                         └→ tokenizer.ts
```

## 3. PR 代码审查流程 (review.ts → codeReview)

```
┌──────────────────────────────────────────────────────────────────┐
│                      codeReview() 主流程                          │
└──────┬───────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────────┐
│  ① 初始化与验证                                                   │
│  ├─ 验证事件类型 (pull_request / pull_request_target)             │
│  ├─ 提取 PR 标题和描述                                            │
│  ├─ 检查是否包含 @ai-reviewer: ignore（是则跳过）                │
│  └─ 查找已有的摘要评论，提取之前的摘要和已审查的 commit IDs        │
└──────┬───────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────────┐
│  ② 增量 Diff 获取（支持增量审查）                                 │
│  ├─ 获取所有 commit ID 列表                                       │
│  ├─ 找到上次审查的最高 commit ID (highestReviewedCommitId)        │
│  ├─ 增量 diff: highestReviewedCommit → HEAD（本次新增变更）       │
│  ├─ 完整 diff: base → HEAD（整个 PR 的变更）                      │
│  └─ 取交集：只审查本次新增且在完整 diff 中存在的文件               │
└──────┬───────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────────┐
│  ③ 文件过滤与 Hunk 解析                                           │
│  ├─ PathFilter 过滤：按 glob 规则筛选/排除文件                    │
│  ├─ 并发获取每个文件的 base 版本内容（GitHub API, githubLimit）    │
│  ├─ splitPatch(): 按 @@ 拆分完整 patch 为独立 hunk               │
│  ├─ patchStartEndLine(): 提取每个 hunk 的起止行号                 │
│  ├─ parsePatch(): 解析为 oldHunk + newHunk（新代码带行号注释）    │
│  └─ 结果: filesAndChanges = [filename, content, diff, patches]   │
└──────┬───────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────────┐
│  ④ 阶段一：摘要 (lightBot, 并发执行)                              │
│  ┌────────────────────────────────────────────────────┐           │
│  │  doSummary(filename, fileContent, fileDiff)        │ × N 文件  │
│  │  ├─ clone Inputs, 填充 filename + fileDiff         │           │
│  │  ├─ 渲染 summarizeFileDiff 提示词                   │           │
│  │  ├─ Token 检查（超限则跳过）                         │           │
│  │  ├─ lightBot.chat() → 获取摘要                      │           │
│  │  └─ 解析 [TRIAGE]: NEEDS_REVIEW / APPROVED         │           │
│  └────────────────────────────────────────────────────┘           │
│  ├─ openaiConcurrencyLimit 控制并发数                              │
│  └─ 结果: summaries = [filename, summary, needsReview]           │
└──────┬───────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────────┐
│  ⑤ 摘要汇总 (heavyBot)                                           │
│  ├─ 每 10 个文件为一批，合并摘要文本                               │
│  ├─ heavyBot.chat(summarizeChangesets) → 去重合并摘要             │
│  ├─ heavyBot.chat(summarize) → 生成最终摘要                       │
│  ├─ heavyBot.chat(summarizeReleaseNotes) → 生成发布说明           │
│  │   └─ commenter.updateDescription() → 写入 PR 描述             │
│  └─ heavyBot.chat(summarizeShort) → 生成精简摘要（审查上下文）    │
└──────┬───────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────────┐
│  ⑥ 阶段二：代码审查 (heavyBot, 并发执行)                          │
│  ├─ 筛选 needsReview=true 的文件                                  │
│  ┌────────────────────────────────────────────────────┐           │
│  │  doReview(filename, fileContent, patches)          │ × N 文件  │
│  │  ├─ clone Inputs, 填充 filename                    │           │
│  │  ├─ Token 预算：计算可打包多少 patch               │           │
│  │  ├─ 逐 patch 处理：                                 │           │
│  │  │   ├─ 获取该范围内的已有评论链 (commentChain)    │           │
│  │  │   ├─ Token 检查，打包 patch + commentChain      │           │
│  │  │   └─ 追加到 ins.patches                         │           │
│  │  ├─ heavyBot.chat(reviewFileDiff) → 获取审查结果   │           │
│  │  ├─ parseReview() → 解析为 Review[] 对象           │           │
│  │  └─ 过滤 LGTM → bufferReviewComment() 缓冲评论    │           │
│  └────────────────────────────────────────────────────┘           │
│  └─ openaiConcurrencyLimit 控制并发数                              │
└──────┬───────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────────┐
│  ⑦ 提交结果                                                      │
│  ├─ commenter.submitReview() → 批量提交 GitHub Review             │
│  │   ├─ 先删除已有的同位置旧评论                                  │
│  │   ├─ 清理 pending review                                       │
│  │   ├─ 创建 review + 所有评论                                    │
│  │   └─ 失败时回退到逐条创建评论                                  │
│  ├─ 更新已审查的 commit ID 列表                                   │
│  └─ commenter.comment() → 发布/更新摘要评论                       │
└──────────────────────────────────────────────────────────────────┘
```

## 4. 评论回复流程 (review-comment.ts → handleReviewComment)

```
┌──────────────────────────────────────────────────────────────────┐
│                  handleReviewComment() 主流程                     │
└──────┬───────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────────┐
│  ① 验证与过滤                                                     │
│  ├─ 验证事件类型 = pull_request_review_comment                    │
│  ├─ 验证 payload 完整（comment, pull_request, repository）        │
│  ├─ 仅处理 action=created（忽略编辑/删除）                        │
│  └─ 排除 Bot 自身的评论（检查 COMMENT_TAG / COMMENT_REPLY_TAG）  │
└──────┬───────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────────┐
│  ② 上下文收集                                                     │
│  ├─ 提取评论信息：user, body, diff_hunk, path                    │
│  ├─ commenter.getCommentChain() → 获取完整对话链                  │
│  └─ 验证对话链包含 Bot 回复 或 用户 @ai-reviewer                 │
└──────┬───────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────────┐
│  ③ Token 预算管理（按优先级逐步填充上下文）                       │
│  ├─ 基础: diff (来自 comment.diff_hunk)                           │
│  ├─ 如果 diff 为空 → 从 GitHub API 获取文件 diff                  │
│  ├─ 计算基础 Token 数                                              │
│  ├─ 如果 Token 超限 → 回复"太大无法处理"并返回                   │
│  ├─ +fileDiff: 如果 Token 预算允许，添加完整文件 diff              │
│  └─ +shortSummary: 如果 Token 预算允许，添加 PR 精简摘要          │
└──────┬───────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────────┐
│  ④ AI 回复                                                        │
│  ├─ heavyBot.chat(renderComment(inputs)) → 生成回复               │
│  └─ commenter.reviewCommentReply() → 发布回复到评论链             │
│      ├─ 在顶级评论下创建回复                                      │
│      └─ 将顶级评论的 COMMENT_TAG 替换为 COMMENT_REPLY_TAG        │
│         （标记已有回复，下次审查时可识别）                          │
└──────────────────────────────────────────────────────────────────┘
```

## 5. Bot 与 OpenAI API 交互流程 (bot.ts)

```
┌──────────────────────────────────────────────────────────────────┐
│  Bot.chat(message, ids)                                           │
│  ├─ 外层：捕获 ChatGPTError，保证不抛异常                         │
│  └─ 内层 chat_():                                                 │
│      ├─ 空消息检查                                                 │
│      ├─ 构建 SendMessageOptions (timeout, parentMessageId)        │
│      ├─ pRetry(api.sendMessage()) → 带重试的 API 调用             │
│      │   └─ 重试次数: options.openaiRetries (默认 3)              │
│      ├─ 记录响应耗时                                               │
│      ├─ 清理响应文本（移除 "with " 前缀）                         │
│      └─ 返回 [responseText, newIds]                               │
│           └─ newIds 包含 parentMessageId 用于后续多轮对话          │
└──────────────────────────────────────────────────────────────────┘
```

## 6. 数据流向图

```
GitHub PR Event
      │
      ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Options    │     │   Prompts    │     │   Inputs     │
│ (配置解析)   │     │ (提示词模板) │     │ (模板变量)   │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                    │                    │
       │    ┌───────────────┼────────────────────┘
       │    │               │
       ▼    ▼               ▼
┌─────────────────────────────────┐
│  Inputs.render(prompt_template) │  ← 变量替换: $title, $diff, ...
│  → 最终提示词                   │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│  Bot.chat(prompt, ids)          │
│  ├─ ChatGPTAPI.sendMessage()    │  ← OpenAI API 调用
│  └─ pRetry (自动重试)          │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│  Response 解析                   │
│  ├─ 摘要: 提取 [TRIAGE] 标记   │
│  └─ 审查: parseReview() 解析    │
│      行号范围 + 评论内容         │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│  Commenter → GitHub API         │
│  ├─ 摘要评论 (issue comment)    │
│  ├─ 审查评论 (review comments)  │
│  ├─ PR 描述更新 (release notes) │
│  └─ 评论回复 (review replies)   │
└─────────────────────────────────┘
```

## 7. 增量审查机制

```
首次审查:
  base ─────────────────────────────→ HEAD
  │         完整 diff                  │
  └────────── 审查所有文件 ────────────┘

后续推送 (增量审查):
  base ─── ... ─── lastReviewed ──── HEAD
  │                 │                  │
  │   已审查区域     │   增量 diff      │
  │                 └──── 只审查新变更 ─┘
  │
  └─ 完整 diff (取交集确保文件仍在 PR 中)

Commit ID 追踪:
  <!-- commit_ids_reviewed_start -->
  <!-- abc123 -->
  <!-- def456 -->    ← 隐藏在摘要评论的 HTML 注释中
  <!-- commit_ids_reviewed_end -->
```

## 8. Token 管理策略

```
┌──────────────────────────────────────────────────┐
│  模型 Token 限制 (limits.ts)                      │
│                                                    │
│  gpt-4-32k:        max=32600  resp=4000  req=28500│
│  gpt-3.5-turbo-16k: max=16300  resp=3000  req=13200│
│  gpt-4:            max=8000   resp=2000  req=5900 │
│  gpt-3.5-turbo:    max=4000   resp=1000  req=2900 │
│                                                    │
│  requestTokens = maxTokens - responseTokens - 100  │
│                                     ↑ 安全余量     │
└──────────────────────────────────────────────────┘

摘要阶段: Token 检查
  if getTokenCount(prompt) > lightTokenLimits.requestTokens → 跳过

审查阶段: 贪心打包
  1. 计算基础 prompt Token 数
  2. 逐个 patch 检查：能装下就装，装不下就停止
  3. 评论链也做 Token 检查，超限则丢弃

评论回复: 按优先级填充
  基础 prompt → +fileDiff(如果够) → +shortSummary(如果够)
```
