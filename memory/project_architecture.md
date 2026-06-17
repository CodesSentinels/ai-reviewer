---
name: CodeSentinel 整体架构
description: CodeSentinel AI Reviewer 项目的完整技术架构、模块职责、核心数据流与关键设计决策
type: project
originSessionId: 241598dd-e0dc-4f9d-b926-e93bfc101594
---
# CodeSentinel AI Reviewer — 整体架构

## 项目性质
GitHub Action 形式的 AI 代码审查机器人。触发 → 执行 → 退出（无状态一次性运行）。
入口：`dist/index.js`（`@vercel/ncc` 单文件打包）

## 技术栈
- 运行环境：Node.js 20 / GitHub Actions
- 语言：TypeScript（strict 模式）
- AI SDK：OpenAI SDK（Responses API，支持多轮对话）
- GitHub API：`@octokit/action` + GraphQL（带重试/限流插件）
- 测试：Jest + ts-jest
- Token 计数：`@dqbd/tiktoken`（o200k_base 编码）

## 双模型架构
- **lightBot（gpt-5.4-nano）**：文件摘要、变更分类（成本优化）
- **heavyBot（gpt-5.4-mini）**：摘要合并、深度审查、对话追问（质量保障）

## 核心目录结构
```
src/
├── main.ts                   # 入口：事件分发
├── options.ts                # 配置管理（40+ 输入参数）
├── review.ts                 # 【核心】PR 代码审查四阶段引擎
├── review-comment.ts         # review comment 对话式回复
├── command-handler.ts        # 命令系统总入口
├── bot.ts                    # OpenAI Responses API 封装
├── commenter.ts              # GitHub 评论管理（CRUD、标签幂等）
├── prompts.ts                # 5 类 LLM 提示词模板
├── octokit.ts                # GitHub API 客户端（重试+限流）
├── repo-tree.ts              # 仓库文件树缓存 + 导入路径解析
├── dependency-analyzer.ts    # 跨文件依赖分析（TS/JS/Python/Go/Java/Vue）
└── commands/                 # 命令框架（迭代二成员 A）
    ├── types.ts              # CommandHandler / CommandContext / ErrorCode 接口
    ├── parser.ts             # 命令解析器
    ├── registry.ts           # 命令注册表（单例）
    ├── dispatcher.ts         # 调度器（10 步标准流程）
    ├── permission.ts         # 权限查询与校验（含缓存）
    ├── rate-limit.ts         # 令牌桶速率限制（60s/10 条）
    ├── reply.ts              # 统一回复工具（ack/success/error/progress）
    ├── reaction.ts           # GitHub Reactions API
    ├── early-reaction.ts     # 快速 ACK（Bot 初始化前）
    ├── bootstrap.ts          # 命令模块启动注册（幂等）
    └── handlers/
        ├── help.ts           # help 命令（已完成）
        └── stubs.ts          # 未实现命令的桩（B/C/D 待替换）
```

## 事件路由（main.ts）
- `pull_request` / `pull_request_target` → `codeReview()` → `review.ts`
- `issue_comment` / `pull_request_review_comment` → `handleCommentEvent()` → `command-handler.ts`

## PR 自动审查四阶段流水线（review.ts）
1. **文件摘要**（lightBot，并发 6）：增量 diff → PathFilter 过滤 → 逐文件 100 字摘要 + NEEDS_REVIEW 分类
2. **摘要合并**（heavyBot）：每 10 文件一批 → PR Walkthrough 表格 + 发布说明
3. **深度审查**（heavyBot，仅 NEEDS_REVIEW 文件）：hunk + 评论链 + 跨文件上下文 → 行级评论 → submitReview
4. **状态持久化**：更新摘要评论（写入 commitId / rawSummary / shortSummary）

## 命令交互框架调度器（10 步流水线）
1. 事件类型校验
2. action=created 校验
3. 提取 PR/评论元数据
4. Bot 自评论过滤
5. 命令解析（parser.parse）→ kind: command / conversation / none
6. 构造 Reply（若有 parse error 直接反馈）
7. 幂等检查（PROCESSED_TAG）
8. 速率限制（令牌桶）
9. 权限校验（getPermission + canExecute）
10. 执行 handler.execute(ctx)

## 状态持久化机制（无数据库）
状态以 HTML 注释嵌入 GitHub PR 摘要评论中：
- `SUMMARIZE_TAG`：摘要评论定位标识
- `COMMIT_ID_START_TAG`...：已审查 commit SHA 列表
- `RAW_SUMMARY_START_TAG`...：原始摘要（隐藏）
- `codesentinel-cmd-reply:{commentId}:{cmd}`：命令幂等标签

## 命令权限模型
- 5 级：admin > maintain > write > triage > read > none
- PR 作者豁免：`help`、`review`、`full review`、`summary` 可在自己 PR 上执行
- `resolve`、`pause`、`resume`、`configuration` 不豁免

## B/C/D 接入方式（标准步骤）
1. 创建 `src/commands/handlers/<command>.ts`，实现 `CommandHandler` 接口
2. 修改 `src/commands/handlers/stubs.ts`，将对应 stub 替换为真实 handler 的 import
3. 添加测试 `__tests__/command-<name>.test.ts`
4. handler 通过 `ctx.reply` 与用户通信，不直接调 octokit.issues.createComment

**Why:** 框架层（A）已处理权限、限流、幂等，handler 只需专注业务逻辑。
**How to apply:** 接入新命令时严格遵循此流程，不绕过框架直接操作 GitHub API。
