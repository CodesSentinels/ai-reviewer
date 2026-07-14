# GitHub → GitLab 单向同步方案

## 概述

每次 GitHub `main` 分支有新提交时，通过 GitHub Actions 自动将代码强制推送到 GitLab 镜像仓库，保持两端代码完全一致。

- **源仓库**：`github.com/CodesSentinels/ai-reviewer`
- **目标仓库**：`gitlab.com/CodesSentinels/ai-reviewer`
- **触发条件**：push 到 `main` 分支
- **同步方向**：单向（GitHub → GitLab），GitLab 端不应有独立提交

---

## Workflow 文件

路径：`.github/workflows/sync-to-gitlab.yml`

```yaml
name: Sync to GitLab

on:
  push:
    branches:
      - main

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Push to GitLab
        env:
          GITLAB_TOKEN: ${{ secrets.GITLAB_TOKEN }}
        run: |
          git remote add gitlab https://oauth2:${GITLAB_TOKEN}@gitlab.com/CodesSentinels/ai-reviewer.git
          git push gitlab main --force
```

### 关键参数说明

| 参数 | 说明 |
|------|------|
| `fetch-depth: 0` | 拉取完整 git 历史，避免 shallow clone 导致 push 失败 |
| `oauth2:${GITLAB_TOKEN}` | GitLab HTTPS 认证标准格式，Token 通过环境变量注入不暴露在日志 |
| `--force` | 强制覆盖 GitLab 端，确保镜像与 GitHub 完全一致 |

---

## 前置配置

### 1. GitLab Access Token

在 GitLab 创建 Personal Access Token 或 Project Access Token：

- 路径：`gitlab.com → User Settings → Access Tokens`
- 所需权限：`write_repository`
- 建议设置过期时间并定期轮换

### 2. GitHub Secret

将 GitLab Token 存为 GitHub 仓库 Secret：

```bash
# 使用 gh CLI
gh secret set GITLAB_TOKEN --repo CodesSentinels/ai-reviewer
```

或通过网页：`GitHub 仓库 → Settings → Secrets and variables → Actions → New repository secret`，名称填 `GITLAB_TOKEN`。

### 3. GitLab 分支保护设置

GitLab 默认保护 `main` 分支禁止 force push，需通过 API 开启：

```bash
curl --request PATCH \
  --header "PRIVATE-TOKEN: <your-gitlab-token>" \
  --header "Content-Type: application/json" \
  --data '{"allow_force_push": true}' \
  "https://gitlab.com/api/v4/projects/CodesSentinels%2Fai-reviewer/protected_branches/main"
```

确认返回 `"allow_force_push": true` 即成功。

---

## 常见问题

### `[remote rejected] main -> main (pre-receive hook declined)`

GitLab 分支保护禁止 force push，执行上方 API 调用开启 `allow_force_push`。

### `! [rejected] main -> main (fetch first)`

GitLab 端存在 GitHub 没有的提交，需加 `--force`。单向镜像场景不应在 GitLab 直接提交代码。

### `fatal: Authentication failed`

检查：
1. GitHub Secret `GITLAB_TOKEN` 是否正确设置
2. GitLab Token 是否已过期
3. Token 是否有 `write_repository` 权限

---

## 验证同步状态

```bash
# 查看最近一次 workflow 运行结果
gh run list --repo CodesSentinels/ai-reviewer --workflow sync-to-gitlab.yml --limit 5

# 查看失败日志
gh run view <run-id> --repo CodesSentinels/ai-reviewer --log-failed
```
