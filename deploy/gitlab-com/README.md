# AI Code Review 运行仓库（gitlab.com）

> **本仓库内容由 GitHub Actions 整体写入，请勿手动修改。**
> 手动改动会让审查 job 的完整性自检失败（审查暂停），并在下次发布时被覆盖或拒绝。

## 内容

| 路径 | 说明 |
|---|---|
| `.gitlab-ci.yml` | `ai_review_trigger`：由测试项目的 Webhook 触发，执行审查 |
| `dist/gitlab-trigger/` | 审查程序（Node 24） |
| `VERSION.json` | 版本号（`v0.0.0-develop.<短 SHA>`）与构建 revision |
| `SHA256SUMS` | 以上所有文件的 sha256；可用 `sha256sum -c SHA256SUMS` 校验 |

## 工作方式

```
GitHub develop 有新提交
  └─► publish-gitlab-com.yml：构建 → 组装 → Commits API 提交到本仓库 develop

测试项目 Webhook（Merge request events + Comments）
  └─► Pipeline Trigger API（本仓库默认分支）→ ai_review_trigger → 在测试项目 MR 上评论
```

本仓库没有源码，也不接受 MR：不存在构建、测试或执行 MR 代码的 job。

## CI/CD 变量

`GITLAB_PAT`、`OPENAI_API_KEY` 配置为 Protected + Masked，只对受保护的默认分支可见。
