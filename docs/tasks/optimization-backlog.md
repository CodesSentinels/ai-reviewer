# AI Reviewer 优化待办

> 记录讨论中发现的改进项，按优先级排列，后续迭代逐步实现。

---

## OPT-001：评论去重与 Resolved 评论重新打开机制

**优先级：** P1
**涉及文件：** `src/review.ts`, `src/commenter.ts`
**发现日期：** 2026-06-29

### 现状问题

审查时 `getCommentChainsWithinRange` 获取已有评论链注入 AI 上下文，但存在两个缺陷：

1. **不区分 resolved / unresolved 状态** — AI 不知道哪些评论已被用户标记为已解决
2. **无去重机制** — 无论评论状态如何，AI 输出只有"新建评论"一个动作通道

导致以下问题在增量审查和全量审查中都会出现：

| 场景 | 现状行为 | 期望行为 |
|------|---------|---------|
| 同一行已有 **open** 评论，问题相同 | ❌ 重复创建新评论 | 不评论（已有 open thread） |
| 同一行已有 **resolved** 评论，问题复现 | ❌ 创建新评论（用户难以感知旧问题复现） | reopen 原 thread + 追加说明 |
| 同一行已有评论，但发现**不同**的新问题 | ✅ 新建评论（但属巧合，非刻意设计） | 新建评论 |

#### 全量 review 特有场景

全量审查（`/review full`）时所有文件都会被审查，额外触发两种情况：

1. **未修改的代码发现新问题** — AI 因 prompt 调整或上下文差异发现之前遗漏的问题，若该行已有 open 评论会重复
2. **修改过的代码发现新问题** — 修改位置或其他位置暴露新问题，同样缺乏与已有评论的关联判断

### 改进方案

#### 第一步：注入时标注评论状态

- `getCommentChainsWithinRange` 返回值携带 thread ID + `isResolved` 状态
- 注入 AI 上下文时标注：`---comment_chains [RESOLVED]---` 或 `[OPEN]---`
- prompt 中引导 AI 的判断规则：
  - 对 `[OPEN]` 的评论：如果问题相同，不要重复评论
  - 对 `[RESOLVED]` 的评论：如果问题仍存在，标记为需要 reopen

#### 第二步：AI 输出增加动作类型

审查结果增加字段：

```typescript
interface ReviewComment {
  // ...existing fields
  action: 'new' | 'reopen' | 'reply' | 'skip'
  relatedThreadId?: number       // 关联的已有 thread
  sameIssuePersists?: boolean    // AI 判断：同一问题是否仍存在
}
```

#### 第三步：根据 action 分发操作

| action | 操作 |
|--------|------|
| `new` | 创建新评论（当前默认行为） |
| `reopen` | unresolve 原 thread + 追加回复说明问题复现 |
| `reply` | 在已有 open thread 中追加回复 |
| `skip` | 不评论（问题已在 open thread 中覆盖） |

### 注意事项

- AI 判断"同一问题是否仍存在"不 100% 准确，保守策略：高置信度时才 reopen / skip，否则新建评论
- 用户可能在 GitHub UI 直接 resolve/unresolve，不经过命令系统，因此必须从 API 实时读取状态，不能自己维护标记
- 代码行号可能因后续 commit 偏移，需处理行号映射
- 全量审查时评论量大，去重机制对减少噪音尤为重要

---

## OPT-002：审查引擎数据流可视化工具

**优先级：** P2
**涉及目录：** `tools/review-visualizer/`（新建）
**发现日期：** 2026-06-29

### 目标

搭建项目内的持久交互式可视化工具，可调整函数输入参数、实时查看输出变化和数据流经管线的过程，用于辅助理解和测试核心逻辑。

### 技术方案

**Vite + React + React Flow (xyflow)**，直接 import 项目源码函数，通过 Vite alias mock 掉 GitHub Action 运行时依赖。

```
tools/review-visualizer/
├── package.json
├── vite.config.ts
├── src/
│   ├── App.tsx                    # 主布局：左侧控制面板 + 右侧流程图
│   ├── mocks/                     # @actions/core, @actions/github, octokit 的浏览器 mock
│   ├── panels/
│   │   ├── IncrementalReview.tsx   # 增量审查：调 commit 列表、reviewed IDs
│   │   ├── FileIntersection.tsx    # 文件交集：调 targetBranch / incremental 文件列表
│   │   └── DependencyAnalysis.tsx  # 依赖分析：输入 diff → 符号提取 → 引用查找
│   ├── flow/
│   │   ├── ReviewPipeline.tsx      # 四阶段审查管线节点图
│   │   └── nodes/                  # 自定义节点（显示中间数据状态，可展开）
│   └── engine/
│       └── adapters.ts            # 包装核心函数，适配可视化输入输出
```

### Mock 层（一次性工作）

| 依赖 | mock 方式 | 工作量 |
|------|----------|--------|
| `@actions/core` | `info/warning/error` → `console.log` | ~10 行 |
| `@actions/github` | 静态 `context` 对象 | ~10 行 |
| `octokit` | API 调用替换为本地数据输入 | ~20 行 |

通过 `vite.config.ts` 的 `resolve.alias` 统一重定向，源码无需修改。

### 首期覆盖范围（对应 1.3 跨文件依赖分析测试）

管线节点：

```
diff patch [可编辑] → extractModifiedSymbols → symbols[]
Vue SFC [可编辑]   → extractVueScriptContent → script content → parseImports → imports[]
                                                                      ↓
引用方文件 [可编辑]                                    findReferencesInContent → references[]
                                                                      ↓
                                                        formatCrossFileContext → 输出预览
```

- 每个节点可展开查看中间状态（如 parseImports 逐条列出匹配结果）
- 函数级别输入/输出可视化，不深入正则内部过程

### 后续扩展

- 增量审查管线（commit ID 解析 → diff 起点决定 → 文件交集）
- 四阶段审查全流程（prepare → summary → aggregate → review）
- PathFilter 交互式调试（输入 glob 规则 + 文件路径列表 → 实时看过滤结果）

---

## OPT-003：Issue #28 — 设计缺陷与文档问题

**来源：** [GitHub Issue #28](https://github.com/CodesSentinels/ai-reviewer/issues/28)
**发现日期：** 2026-06-29

> 以下按原 issue 的分类整理，优先级标注沿用原 issue 的评级。

### I. 安全缺陷（Critical）

| ID | 问题 | 优先级 | 涉及文件 |
|----|------|--------|---------|
| 28-S1 | Shell 命令注入 — `enable_shell=true` 时 bot 可执行 AI 请求的任意 shell 命令，攻击者可在 PR diff 中嵌入恶意指令 | 🔴 Critical | `runLocalShellCommand()` |
| 28-S2 | `runLocalShellCommand()` 无命令白名单，GitHub Actions runner 可访问 secrets | 🔴 Critical | `action.yml`, shell 执行逻辑 |

### II. 设计缺陷（Major）

| ID | 问题 | 优先级 | 涉及文件 |
|----|------|--------|---------|
| 28-D1 | "In Review" 状态未清除 — `addInProgressStatus()` 无对应 `removeInProgressStatus()` 调用，出错时 PR 永久标记为审查中 | 🟠 Major | `src/review.ts`, `src/commenter.ts` |
| 28-D2 | 评论删除后缓存未失效 — 删除操作后缓存未清除，同一 Action run 内幂等检查失败 | 🟠 Major | `src/commenter.ts` |
| 28-D3 | God Function — `codeReview()` 830 行，嵌套闭包，混合 diff 解析/过滤/摘要/提交，难以测试 | 🟠 Major | `src/review.ts` |
| 28-D4 | API 错误掩盖 — 空响应记录为 "nothing obtained" 而非实际错误 | 🟠 Major | `src/review.ts` |
| 28-D5 | 死代码 — `chat_()` 中 `setFailed()` 不可达（`this.client` 不会为 null） | 🟡 Minor | bot 相关文件 |
| 28-D6 | 输入校验缺失 — token 参数无校验，非数字字符串导致 NaN | 🟠 Major | `src/options.ts` |
| 28-D7 | `issue_comment` 对话回复功能硬编码跳过，无跟踪 issue | 🟡 Minor | `src/main.ts` |
| 28-D8 | HTML 评论标签硬编码 bot 名称 — 配置修改后幂等检测失效 | 🟠 Major | `src/commenter.ts` |
| 28-D9 | 竞态条件 — 并发 Action run 可因删除-创建序列无保护而产生重复评论 | 🟠 Major | `src/commenter.ts` |

### III. 代码质量问题

| ID | 问题 | 优先级 |
|----|------|--------|
| 28-Q1 | GitHub API 处理中过多 `any` 类型 | 🟡 Minor |
| 28-Q2 | 进程内限流在无状态环境中无实际作用 | 🟡 Minor |
| 28-Q3 | 正则缓存无清理机制 | 🟡 Minor |
| 28-Q4 | 路径过滤产生过多日志 | 🟡 Minor |

### IV. 文档问题

| ID | 问题 | 优先级 |
|----|------|--------|
| 28-DOC1 | 架构图遗漏命令系统 | 🟠 Major |
| 28-DOC2 | 新功能（shell 执行、依赖分析、web 搜索）未更新 README | 🟠 Major |
| 28-DOC3 | `action.yml` 默认值与 `options.ts` 默认值不一致 | 🟠 Major |
| 28-DOC4 | `enable_shell` 缺少安全警告 | 🔴 Critical |
| 28-DOC5 | workflow 示例缺少 `issue_comment` 事件 | 🟠 Major |

### 处理建议

1. **立即处理**：28-S1、28-S2、28-DOC4（安全相关）
2. **近期迭代**：28-D1、28-D2、28-D3、28-D8、28-D9（影响可靠性）
3. **后续优化**：其余 Major/Minor 项

---

<!-- 新增优化项请追加在此分隔线之后，格式参照 OPT-001 -->
