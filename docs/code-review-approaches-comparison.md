# 三种 AI Code Review 方式对比分析

## 概览

| 维度 | 方式一：Claude Code `/review` | 方式二：Claude Code Review Subagent | 方式三：AI Reviewer (GitHub Action) |
|------|------|------|------|
| 运行环境 | 开发者本地终端 | 开发者本地终端 | GitHub Actions Runner (CI) |
| 触发方式 | 手动执行命令 | 手动执行命令 | PR 事件自动触发 |
| AI 模型 | Claude (Anthropic) | Claude (Anthropic) | OpenAI GPT-5.4 系列 |
| 输出位置 | 终端输出 / 本地 | 终端输出 / 本地 | GitHub PR 评论（行级） |
| 代码访问 | 完整本地文件系统 | 完整本地文件系统 | 通过 GitHub API 获取 diff |
| 成本 | Claude API / 订阅费 | Claude API / 订阅费 | OpenAI API 费用 |
| 团队协作 | 仅个人可见 | 仅个人可见 | 团队所有成员可见 |

---

## 方式一：Claude Code `/review` 命令

### 工作原理

Claude Code 内置的 `/review` 技能（skill），在本地终端执行。它会：

1. 检测当前分支与目标分支（通常是 main/master）之间的 diff
2. 使用 `gh pr view` 获取 PR 上下文（如果存在关联 PR）
3. 将 diff 送入 Claude 模型进行审查
4. 支持 `--comment` 参数将结果直接作为 inline PR comments 发布到 GitHub
5. 支持 `--fix` 参数直接修复发现的问题

### 核心特点

- **本地文件系统访问**：可以读取项目中任意文件来理解上下文，不局限于 diff
- **交互式**：可以追问、补充上下文、让它关注特定区域
- **即时反馈**：开发者在编码过程中随时执行，无需等待 CI
- **可选发布**：默认输出到终端，加 `--comment` 才发布到 PR
- **多级别审查**：支持 effort level (low/medium/high/max) 控制审查深度
- **可修复**：`--fix` 模式可以直接应用修复到工作区

### 局限性

- 单人使用，不自动触发
- 依赖开发者主动执行
- 无增量审查（每次都是全量）
- 无法做到全团队统一覆盖

---

## 方式二：通过 Review Skill 创建 Subagent

### 工作原理

通过 Claude Code 的 Agent 工具，使用 `subagent_type: "review"` 或调用 `/code-review` skill 启动一个专门的代码审查子代理：

1. 子代理在独立上下文中运行（不污染主对话）
2. 检查当前分支的 diff
3. 审查代码并返回结果给主代理
4. 主代理可以对结果进行进一步处理或发布

### 核心特点

- **上下文隔离**：子代理有独立的上下文窗口，不消耗主对话的 token
- **可编排**：可以在复杂工作流中作为一个步骤（如：实现功能 → 运行测试 → 审查代码 → 修复问题）
- **并行化**：可以同时启动多个子代理审查不同模块
- **灵活定制**：通过 prompt 控制审查焦点（安全性、性能、风格等）
- **流水线集成**：可与其他自动化工具串联

### 局限性

- 仍是本地执行，依赖开发者触发
- 子代理上下文有限，可能遗漏跨文件关联
- 不直接产出 GitHub 评论（需额外步骤）
- 无增量审查能力

---

## 方式三：AI Reviewer (GitHub Action)

### 工作原理

本项目的实现方式，作为 GitHub Action 在 CI 中自动运行：

1. **自动触发**：PR 创建/更新时自动执行，无需人工干预
2. **双模型架构**：
   - lightBot (gpt-5.4-nano)：快速生成每个文件的摘要 + 变更分类（NEEDS_REVIEW / APPROVED）
   - heavyBot (gpt-5.4-mini)：对需要审查的文件进行深度行级审查
3. **四阶段流水线**：
   - Phase 0: 跨文件依赖分析（解析 import/export，追踪影响范围）
   - Phase 1: 并行文件摘要（lightBot 分类筛选）
   - Phase 2: 汇总 + 发布说明生成（heavyBot 合并上下文）
   - Phase 3: 逐 hunk 代码审查（heavyBot 行级评论）
4. **增量审查**：存储已审查的 commit ID，后续 push 只审查新变更
5. **行级评论**：评论精确到代码行，直接出现在 PR diff 视图中
6. **交互式对话**：通过 `@ai-reviewer` 命令进行追问/补充审查
7. **工具增强**：heavyBot 可执行 web_search（验证 API）和 local_shell（检查代码结构）

### 核心特点

- **全自动化**：配置一次，所有 PR 自动覆盖
- **团队可见**：审查结果作为 PR 评论对所有人可见
- **增量审查**：只审查新变更，节省成本和时间
- **智能分类**：轻量模型过滤简单变更，避免不必要的深度审查
- **跨文件分析**：依赖分析模块追踪修改对其他文件的影响
- **可交互**：`@ai-reviewer help` / `@ai-reviewer review` 等命令
- **可配置**：路径过滤、模型选择、语言、审查深度等全部可配置

### 局限性

- 只能看到 diff 和通过 API 获取的文件内容（不能像本地那样自由探索）
- 依赖 GitHub API，受速率限制约束
- 需要管理 OPENAI_API_KEY Secret
- 对私有仓库有 token 权限要求
- 反馈延迟：需等待 Action 执行完成（通常数分钟）

---

## 深度对比分析

### 1. 代码理解深度

| 能力 | `/review` | Subagent | AI Reviewer |
|------|-----------|----------|-------------|
| 读取任意文件 | ✅ 完整文件系统 | ✅ 完整文件系统 | ⚠️ 需 API 调用，有配额 |
| 跨文件依赖追踪 | ✅ 可用 grep/find | ✅ 可用 grep/find | ✅ 内建 dependency-analyzer |
| 执行代码/测试 | ✅ 本地环境 | ✅ 本地环境 | ⚠️ 仅 local_shell (受限) |
| 理解构建配置 | ✅ | ✅ | ⚠️ 有限 |
| 历史 commit 上下文 | ✅ git log | ✅ git log | ⚠️ 仅通过 API |

### 2. 工作流集成

| 能力 | `/review` | Subagent | AI Reviewer |
|------|-----------|----------|-------------|
| CI 自动化 | ❌ | ❌ | ✅ |
| PR Gate (阻塞合并) | ❌ | ❌ | ✅ 可配合 required checks |
| 增量审查 | ❌ | ❌ | ✅ commit ID 追踪 |
| 团队可见性 | ❌ | ❌ | ✅ PR 评论 |
| 行级精准评论 | ⚠️ 需 --comment | ❌ | ✅ |
| 交互式追问 | ✅ 实时对话 | ⚠️ 需重新触发 | ✅ @mention 命令 |

### 3. 成本与效率

| 维度 | `/review` | Subagent | AI Reviewer |
|------|-----------|----------|-------------|
| API 成本/次 | 中（单次全量） | 中（单次全量） | 低-中（分类过滤 + 增量） |
| 人工成本 | 高（需手动触发） | 中（可编排自动化） | 低（全自动） |
| 首次反馈延迟 | 秒级 | 秒级 | 分钟级 |
| 大 PR 处理 | 受上下文窗口限制 | 受上下文窗口限制 | 并行处理 + 智能过滤 |
| 误报率控制 | 可即时调整 | 可调整 prompt | 需修改配置重新运行 |

---

## 适用场景推荐

### 方式一 `/review` 最适合：

- **个人开发者的自审**：提交前快速检查自己的代码
- **小型项目 / 独立开发**：团队小，不需要自动化 review 流程
- **探索式开发**：边写边审，快速迭代
- **敏感代码审查**：不想把代码发送到外部 CI 环境
- **学习场景**：新手开发者在编码时获得即时指导
- **需要深度理解**：复杂架构变更需要 AI 读取大量上下文文件

### 方式二 Subagent 最适合：

- **自动化编码流水线**：实现功能 → 自审 → 修复 → 提交的完整循环
- **专项审查**：针对安全性、性能、可访问性等特定维度的审查
- **大型变更拆分审查**：对不同模块并行启动审查子代理
- **代码生成后验证**：AI 生成代码后，另一个 AI 审查其输出
- **需要上下文隔离**：不希望审查内容污染当前对话

### 方式三 AI Reviewer (GitHub Action) 最适合：

- **团队协作项目**：需要所有 PR 统一审查标准
- **开源项目**：外部贡献者的 PR 需要自动初审
- **合规性要求**：需要审查记录留存在 PR 历史中
- **大型仓库**：利用增量审查和智能分类节省成本
- **CI/CD 集成**：作为合并前的 quality gate
- **多语言项目**：dependency-analyzer 支持 TS/JS/Python/Go/Java
- **持续集成环境**：需要可重复、无人干预的审查流程

---

## 组合使用建议

最佳实践是**组合使用**，而非选择单一方案：

```
开发阶段          审查方式                    目的
─────────────────────────────────────────────────────────
编码中            /review (本地)              即时自审，快速修正
功能完成          Subagent (本地)             系统性自审 + 自动修复
推送 PR           AI Reviewer (CI)            团队级全自动审查
收到评论          @ai-reviewer (PR comment)   交互式深入讨论
```

### 推荐的渐进式采用路径

1. **起步**：先用 `/review` 培养 AI code review 习惯
2. **进阶**：在复杂任务中用 Subagent 做流水线自审
3. **团队化**：部署 AI Reviewer Action 实现全团队覆盖
4. **优化**：根据团队反馈调整 Action 配置（过滤规则、审查深度、语言等）

---

## 技术架构对比

### 方式一 & 二：本地执行

```
Developer Terminal
    │
    ├── Claude Code CLI
    │       │
    │       ├── git diff (本地)
    │       ├── 读取文件 (本地文件系统)
    │       ├── 执行命令 (本地 shell)
    │       │
    │       └── Claude API (Anthropic)
    │               │
    │               └── 审查结果 → 终端 / --comment → GitHub
    │
    └── [可选] gh pr create / push
```

### 方式三：CI 执行

```
GitHub PR Event
    │
    ├── GitHub Actions Runner
    │       │
    │       ├── ai-reviewer Action
    │       │       │
    │       │       ├── GitHub API (获取 diff, 文件内容)
    │       │       ├── Dependency Analyzer (跨文件分析)
    │       │       │
    │       │       ├── lightBot (gpt-5.4-nano) ─── 文件摘要 + 分类
    │       │       ├── heavyBot (gpt-5.4-mini) ─── 深度审查 + 汇总
    │       │       │       ├── web_search (验证 API)
    │       │       │       └── local_shell (检查代码)
    │       │       │
    │       │       └── GitHub API (发布行级评论)
    │       │
    │       └── PR Comment: 摘要 + 逐行审查意见
    │
    └── @ai-reviewer 命令 → 交互式对话
```

---

## 总结

| 如果你需要... | 推荐方式 |
|--------------|---------|
| 最快的反馈循环 | `/review` |
| 最深度的代码理解 | `/review` 或 Subagent（本地文件系统访问） |
| 团队统一覆盖 | AI Reviewer (GitHub Action) |
| 全自动无人干预 | AI Reviewer (GitHub Action) |
| 可编排的自动化流水线 | Subagent |
| 审查记录留存 | AI Reviewer (GitHub Action) |
| 成本效率最优 | AI Reviewer（增量审查 + 分类过滤） |
| 处理超大 PR | AI Reviewer（并行 + 分片） |
| 开发中即时指导 | `/review` |
