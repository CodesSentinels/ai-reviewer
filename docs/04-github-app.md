# GitHub App 集成指南

## 背景

GitHub Actions 默认提供的 `GITHUB_TOKEN` 是一个 integration token（身份为 `github-actions[bot]`），存在以下限制：

1. **GraphQL mutation 受限** — 某些操作（如 `resolveReviewThread`）被平台硬限制，无论 `permissions` 字段如何配置都无法执行
2. **Fork PR 权限降级** — 来自 fork 的 PR 触发时，token 自动降级为只读
3. **身份固定** — 所有使用默认 token 的 Action 共享同一个 bot 身份，无法区分

使用 **GitHub App installation token** 可以解决以上所有问题。

## 方案对比

| 方案 | 原理 | 适用场景 |
|------|------|---------|
| **GitHub App**（推荐） | 自定义 App 的 installation token，具有完整 API 权限 | 团队/组织使用，无需管理个人 token |
| **PAT** | 个人 token，有 repo scope | 个人开发测试，快速验证 |
| **默认 GITHUB_TOKEN** | Actions 内置 integration token | 基础 review 功能（无法执行受限 mutation） |

## 方案一：GitHub App（推荐）

### 1. 创建 GitHub App

位置：GitHub → Settings → Developer settings → GitHub Apps → New GitHub App

配置项：

| 字段 | 值 |
|------|------|
| App name | `AI-Reviewer-Bot`（或自定义） |
| Homepage URL | 仓库地址即可 |
| Webhook | **关闭**（取消勾选 Active） |
| Permissions → Repository → Pull requests | **Read & Write** |
| Permissions → Repository → Contents | **Read** |
| Permissions → Repository → Issues | **Read & Write** |
| Where can this app be installed | Only on this account |

### 2. 生成私钥

创建完成后，在 App 设置页底部点击 **Generate a private key**，下载 `.pem` 文件。

记录页面上方显示的 **App ID**（数字）。

### 3. 安装 App 到目标仓库

App 设置页 → Install App → 选择需要 code review 的仓库。

### 4. 配置 Repository Secrets

在需要使用 AI Reviewer 的仓库（消费方）中配置：

| Secret 名称 | 值 |
|-------------|------|
| `APP_ID` | App 的 ID 数字 |
| `APP_PRIVATE_KEY` | `.pem` 文件的全部内容 |

### 5. 修改 Workflow

```yaml
name: Code Review

permissions:
  contents: read
  pull-requests: write
  issues: write

on:
  pull_request:
    types: [opened, synchronize, reopened]
  pull_request_review_comment:
    types: [created]
  issue_comment:
    types: [created]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      # 生成 GitHub App installation token
      - uses: actions/create-github-app-token@v1
        id: bot-token
        with:
          app-id: ${{ secrets.APP_ID }}
          private-key: ${{ secrets.APP_PRIVATE_KEY }}

      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - uses: actions/checkout@v4
      - uses: CodesSentinels/ai-reviewer@main
        env:
          # 使用 App token 替代默认 GITHUB_TOKEN
          GITHUB_TOKEN: ${{ steps.bot-token.outputs.token }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
        with:
          debug: true
          # ... 其他配置
```

使用 GitHub App token 时，ai-reviewer 源码无需任何改动——它通过 `process.env.GITHUB_TOKEN` 读取 token，不感知 token 来源。

## 方案二：PAT

适用于不想创建 App 的快速验证场景。

### 1. 创建 Personal Access Token

GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)

Scope 勾选：`repo`（完整仓库权限）

### 2. 配置 Secret

在消费方仓库中添加 secret `PAT_TOKEN`。

### 3. Workflow 配置

```yaml
- uses: CodesSentinels/ai-reviewer@main
  env:
    GITHUB_TOKEN: ${{ secrets.PAT_TOKEN }}
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

直接用 PAT 替代 `GITHUB_TOKEN`，所有 API 调用（包括 GraphQL mutation）都使用该 token。

## 为什么 ai-reviewer 源码不需要改动

ai-reviewer 通过 `src/octokit.ts` 统一读取 token：

```typescript
const token = getInput('token') || process.env.GITHUB_TOKEN
```

无论 token 来自 GitHub App、PAT 还是默认 GITHUB_TOKEN，octokit 实例的创建方式相同。区别仅在于 token 背后的**身份权限**不同：

| Token 来源 | 身份 | GraphQL mutation |
|---|---|---|
| 默认 GITHUB_TOKEN | `github-actions[bot]` (integration) | 部分受限 |
| GitHub App token | `your-app[bot]` (app installation) | 完整权限 |
| PAT | 个人用户身份 | 完整权限 |

## 未来迁移到 GitLab

本方案不增加 GitLab 迁移负担：

| 层 | GitHub (当前) | GitLab (未来) |
|------|--------------|--------------|
| Token 来源 | `actions/create-github-app-token` step | CI/CD 变量 `$GROUP_ACCESS_TOKEN` |
| API 客户端 | `@octokit/action` | `@gitbeaker/rest` 或 fetch |
| 认证方式 | `GITHUB_TOKEN` env | `GITLAB_TOKEN` env |
| 代码改动 | 无 | 替换 octokit 调用为 GitLab API |

关键点：**ai-reviewer 源码本身不感知 token 来源**。迁移 GitLab 时需要替换的是 API 调用层（octokit → GitLab REST），与 token 生成方式无关。

### GitLab 认证方案对比

| 方式 | 说明 | 适用场景 |
|------|------|---------|
| Project Access Token | 绑定单个项目，自动创建 bot user | 单项目部署 |
| Group Access Token | 绑定组，跨项目复用 | 多项目/组织部署 |
| Service Account (Ultimate) | 独立 bot 用户，不占 license | 企业内网 |

GitLab 没有 GitHub 那种 "integration token 限制 mutation" 的问题，任何有 Developer 权限的 token 都能执行全部 API 操作。

## 架构图

```
┌─────────────────────────────────────────────────────┐
│  GitHub 组织 / 个人账号                               │
│                                                     │
│  ┌───────────────────┐                              │
│  │  GitHub App        │  ← 组织级别创建              │
│  │  "AI-Reviewer-Bot" │                              │
│  └────────┬──────────┘                              │
│           │ 安装到 ↓                                  │
│  ┌────────┴──────────────────────────────────────┐  │
│  │                                               │  │
│  │  消费方仓库 (如 ai-reviewer-test)               │  │
│  │  ├── .github/workflows/ai-reviewer.yml        │  │
│  │  │   ├── actions/create-github-app-token      │  │
│  │  │   │   → 生成 App installation token        │  │
│  │  │   └── CodesSentinels/ai-reviewer           │  │
│  │  │       → 使用 token 执行所有 API 调用         │  │
│  │  └── Secrets: APP_ID, APP_PRIVATE_KEY         │  │
│  │                                               │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │  ai-reviewer (Action 源码)                     │  │
│  │  ├── src/octokit.ts                           │  │
│  │  │   └── 读取 GITHUB_TOKEN env → 创建客户端   │  │
│  │  └── 所有 API 调用通过 octokit 实例执行        │  │
│  │      (不关心 token 是 App/PAT/integration)     │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

## 常见问题

### Q: GitHub App token 和默认 GITHUB_TOKEN 有什么区别？

| | 默认 GITHUB_TOKEN | GitHub App Token |
|---|---|---|
| 身份 | `github-actions[bot]` | `your-app-name[bot]` |
| 本质 | Actions 内置 integration token | 自定义 App 的 installation token |
| GraphQL mutation | 部分被限制 | 完整权限 |
| Fork PR 权限 | 自动降级为只读 | 不受影响 |

### Q: Fork PR 是否支持？

- **GitHub App 方案**：支持。App 安装在目标仓库上，token 由 base repo 的 workflow 生成，不受 fork 限制。
- **PAT 方案**：支持。PAT 是独立认证，不受 fork PR 的 token 降级影响。
- **默认 GITHUB_TOKEN**：部分功能受限（fork PR 自动降级为 read-only）。

### Q: 使用 App token 后评论会显示什么身份？

评论作者会变成 `your-app-name[bot]`（你创建的 App 名称），而不是 `github-actions[bot]`。这使得 code review 评论有独立的 bot 身份标识。
