---
name: CodeSentinel AI Reviewer 项目记忆
description: 用于 Claude Code 加载项目记忆的入口文件，包含架构、设计、进度和代码审查指南
type: memory
---

# CodeSentinel AI Reviewer — 项目记忆加载器

## 📚 核心文档引用

### 架构与技术
- **[整体架构](./memory/project_architecture.md)** — 技术栈、模块职责、事件路由、四阶段审查流水线、命令框架、B/C/D 接入方式
- **[项目进度](./memory/project_progress.md)** — 当前迭代状态、已完成功能、未来规划

### 需求与设计
- **[代码审查指南](./docs/05-member-a-code-review-guide.md)** — Members A 的代码审查规范
- **[迭代一评论交互设计](./docs/04-iteration-comment-interaction.md)** — 评论交互流程、命令系统
- **[迭代一工作量估算](./docs/04-iteration-comment-interaction-workload.md)** — 功能复杂度评估
- **[迭代二设计](./docs/04-iteration-02-member-a-design.md)** — Member A 迭代二设计文档

### 特性文档
- **[依赖分析](./docs/nuxt-vue-dependency-analysis.md)** — 跨文件依赖分析、Nuxt/Vue 支持
- **[Member B Resolve 设计](./memory/member_b_resolve.md)** — resolve 命令设计与实现

### 测试用例
- **[用例集合](./test_case_docs/)** — 跨文件依赖、别名导入、Nuxt/Vue、Web 搜索等

---

## 🏗️ 项目快速理解

### 项目性质
GitHub Action 形式的 **AI 代码审查机器人**，触发 → 执行 → 退出（无状态一次性运行）。

### 关键能力
1. **PR 自动审查** — 文件摘要 → 摘要合并 → 深度审查 → 行级评论
2. **命令交互系统** — 权限控制 + 速率限制 + 幂等处理 + 10 步调度器
3. **跨文件依赖分析** — TS/JS/Python/Go/Java/Vue 的导入解析与关联
4. **双模型架构** — lightBot（快速摘要）+ heavyBot（深度审查）

### 核心文件地图
```
src/
├── main.ts                  # 事件分发入口
├── review.ts                # 【核心】四阶段审查引擎
├── command-handler.ts       # 命令系统入口
├── dependency-analyzer.ts   # 跨文件依赖分析
└── commands/                # 命令框架
    ├── dispatcher.ts        # 10 步调度器
    ├── handlers/            # 具体命令实现
    └── types.ts             # 接口定义
```

---

## 🔧 打包与运行

### 构建命令
```bash
npm run build              # 编译 TS → lib/
npm run package            # ncc 打包为 dist/index.js
npm run all                # 完整流程：build + format + lint + package + test
```

### 测试命令
```bash
# 运行所有测试
npm test

# 运行集成测试（以 INTEGRATION=true 启动）
INTEGRATION=true npx jest resolve.integration --no-coverage --runInBand

# 运行特定测试文件
npx jest command-dispatcher --no-coverage
```

### 本地调试
```bash
npm run act                 # 使用 act 在本地模拟 GitHub Actions 环境
```

---

## 📋 迭代状态

### 迭代一（已完成）
- ✅ PR 自动审查四阶段流水线
- ✅ 命令交互框架（权限、限流、幂等）
- ✅ help 命令实现
- ✅ Member A 代码审查指南

### 迭代二（进行中）
- 🔄 Member A：命令框架完善、help 优化
- 🔄 Member B：resolve 命令（冲突解决）
- ⏳ Member C/D：其他命令实现（pause、resume、configuration）

---

## 👥 Team 与 接入规范

### B/C/D 命令接入标准流程
1. 创建 `src/commands/handlers/<command>.ts`，实现 `CommandHandler` 接口
2. 更新 `src/commands/handlers/stubs.ts`，替换 stub 引用
3. 添加测试 `__tests__/command-<name>.test.ts`
4. 通过 `ctx.reply` 与用户通信（勿直接调用 GitHub API）

**为什么：** 框架层已处理权限、限流、幂等，handler 只需关注业务逻辑。

---

## 🔐 环境变量与配置

### GitHub Actions 输入参数（40+ 个）
详见 [action.yml](./action.yml)

关键参数示例：
- `OPENAI_API_KEY` — OpenAI API 密钥
- `GITHUB_TOKEN` — GitHub API token（自动提供）
- `openai-model` — 模型选择（默认 gpt-4.0-turbo）
- `max-files` — 单个 PR 最多审查文件数

### 测试环境变量
- `INTEGRATION=true` — 启用集成测试模式

---

## 💡 常见任务速查

| 任务 | 命令 |
|------|------|
| 新增命令 | 见 B/C/D 接入规范 |
| 修改提示词 | 编辑 `src/prompts.ts` |
| 更新依赖分析 | 修改 `src/dependency-analyzer.ts` |
| 调试审查流程 | 修改 `src/review.ts` + 运行 `npm test` |
| 本地测试 | `INTEGRATION=true npx jest <name> --runInBand` |

---

## 📞 获取帮助

- 架构疑问 → 查看 [整体架构](./memory/project_architecture.md)
- 命令系统 → 查看 [10 步调度器](./memory/project_architecture.md#命令交互框架调度器10-步流水线) 和具体 handler
- 依赖分析 → 查看 [特性文档](./docs/nuxt-vue-dependency-analysis.md)
- 进度与规划 → 查看 [项目进度](./memory/project_progress.md)
