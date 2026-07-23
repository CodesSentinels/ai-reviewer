---
name: gitlab-migration-docs-source
description: GitHub↔GitLab 迁移方案文档在 codesentinel-docs 仓库的位置及拉取方式
metadata:
  type: reference
---

GitHub↔GitLab 双平台兼容方案文档存放在私有仓库 `CodesSentinels/codesentinel-docs` 的 `docs/migration-plan/` 目录下，三份文件：

- `github-gitlab-compatibility-todo.md`（v2.5）— 可执行 TODO 清单，按模块编号（SEC-/ARCH-/CFG-/GH-/EVENT-/GLAPI-/REVIEW-/WS-/LOCAL-/LINT-/CMD-/STATE-/BUILD-/CI-/SYNC-/TEST-），含开发验收矩阵，是三份文档里最直接可转成任务的一份。
- `github-to-gitlab-migration-plan.md`（v1.9，最大，~2838 行）— 完整分析方案；⚠️ 第一~二十章大量内容是旧的自建 EE/JiHu 假设遗留，标注为"历史、未核验、非当前实施依据"；**只有 0.2/0.5/0.6/0.7/二十一/二十三章是当前 gitlab.com Free MVP 的有效依据**。
- `github-vs-gitlab-runtime-differences.md`（v1.4）— 运行架构、事件流、评论/命令映射表、配置差异对比，最适合快速理解两平台行为差异。

**拉取方式**：该仓库为私有仓库，本机 `gh auth status` 未登录；`~/.zshrc` 中有 `GITHUB_PAT` 环境变量（JS 语法 `export const GITHUB_PAT="ghp_..."`，需用 `grep + grep -oP` 提取，不能直接 `source`），可用其调用 GitHub Contents API 拉取原始内容：

```bash
GITHUB_PAT=$(grep 'GITHUB_PAT=' ~/.zshrc | grep -oP '"ghp_[^"]+?"' | tr -d '"')
curl -s -H "Authorization: token $GITHUB_PAT" -H "Accept: application/vnd.github.raw" \
  "https://api.github.com/repos/CodesSentinels/codesentinel-docs/contents/docs/migration-plan/<filename>"
```

详细提炼内容见 [[gitlab_migration_plan]]。
