# GitLab 兼容性分析 — 当前技术选型的影响评估

> 分析日期：2026-06-25
> 预计需求时间：2026-08（约两个月后需覆盖 GitLab 场景）

---

## 一、结论

当前技术选型对 GitLab 兼容**影响较大**，GitHub 耦合分布在三个层次，无平台抽象层。改造量中等偏大（核心文件 10+），但技术上完全可行。

---

## 二、三层耦合分析

### 1. 运行时框架 — GitHub Actions 深度绑定

| 依赖 | 影响范围 | 说明 |
|------|---------|------|
| `@actions/core` | ~15 个文件 | 日志（info/warning）、输入参数（getInput）、失败信号（setFailed） |
| `@actions/github` | 5+ 个文件 | `github_context` 获取 PR/repo 上下文 |
| `action.yml` | 入口定义 | 40+ 个输入参数，GitLab 需改为 `.gitlab-ci.yml` 或独立 CLI |

**关键文件：** `main.ts`, `review.ts`, `options.ts`, `inputs.ts`, `bot.ts`, `dependency-analyzer.ts`

### 2. API 层 — Octokit 直接调用，无抽象

| 调用方式 | 涉及文件 | 典型调用 |
|---------|---------|---------|
| `octokit.pulls.*` | review.ts, commenter.ts, review-state.ts | `pulls.get`, `pulls.update` |
| `octokit.repos.*` | review.ts, dependency-analyzer.ts | `repos.getContent`, `repos.compareCommits` |
| `octokit.git.*` | repo-tree.ts | `git.getTree` |
| GraphQL | github/review-thread.ts | GitHub 专有 schema 查询 review threads |

**核心问题：** 所有 GitHub API 调用直接散布在业务逻辑中，没有 Platform/Provider 接口层。

### 3. 数据模型 — GitHub 概念硬编码

- PR review thread、review comment 等 GitHub 特有概念直接作为业务模型
- `src/github/review-thread.ts` 的 GraphQL 查询使用 GitHub 专有 schema
- 评论交互系统（命令系统）依赖 GitHub issue comment / review comment 结构

---

## 三、推荐改造方案

### 分层抽象策略

```
┌─────────────────────────────────┐
│         业务逻辑层               │  ← 不变
│  (review.ts, commands/, etc.)   │
├─────────────────────────────────┤
│       PlatformClient 接口        │  ← 新增抽象层
│  getPR / getDiff / postComment  │
├──────────┬──────────────────────┤
│ GitHub   │   GitLab             │  ← 各自实现
│ Adapter  │   Adapter            │
└──────────┴──────────────────────┘
```

### 具体改造项

| 层 | 改造内容 | 优先级 |
|----|---------|-------|
| **入口层** | 抽出 CLI/SDK 模式，Actions 和 GitLab CI 各做一个 adapter | P0 |
| **API 层** | 定义 `PlatformClient` 接口（getPR、getDiff、postComment、resolveThread 等），GitHub/GitLab 各实现 | P0 |
| **上下文层** | `github_context` → 自定义 `RunContext`，由 adapter 注入 | P0 |
| **日志层** | `@actions/core` 的 info/warning → 通用 logger 封装 | P1 |
| **数据模型** | ReviewThread 等类型泛化，适配 GitLab MR discussion 模型 | P1 |
| **GraphQL** | GitHub GraphQL → GitLab REST API 或 GitLab GraphQL 映射 | P2 |

### GitLab 关键差异点

| GitHub 概念 | GitLab 对应 | 注意事项 |
|------------|------------|---------|
| Pull Request | Merge Request | 字段命名不同，状态机略有差异 |
| Review Comment | MR Discussion Note | GitLab 用 discussion 线程模型 |
| Review Thread | MR Discussion | resolve/unresolve 机制类似但 API 不同 |
| Check Run | Pipeline Job | 状态上报方式不同 |
| `GITHUB_TOKEN` | `CI_JOB_TOKEN` 或 Project Access Token | 权限模型不同 |

---

## 四、当前阶段建议

1. **现阶段不必提前做抽象** — 等真有 GitLab 需求再改造，避免过早设计
2. **新代码有意识解耦** — 新增功能避免直接调用 `octokit`，尽量通过集中的函数间接调用
3. **改造时可分批进行** — 先做入口+API 层抽象（P0），再逐步泛化数据模型（P1/P2）
4. **预估工期** — 完整 GitLab 适配约 2-3 周（含测试），建议提前 1 个月启动
