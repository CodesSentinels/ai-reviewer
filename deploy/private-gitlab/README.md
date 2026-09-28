# AI Code Review 运行仓库

> **本仓库内容由发布流程整体写入，请勿手动修改。**
> 手动改动会让审查 job 的完整性自检失败（审查暂停），并在下次发布时被发现。

## 内容

| 路径 | 说明 |
|---|---|
| `.gitlab-ci.yml` | `ai_review_trigger`：由业务项目的 Webhook 触发，执行审查 |
| `dist/gitlab-trigger/` | 审查程序（Node 24） |
| `VERSION.json` | 版本号与构建 revision |
| `SHA256SUMS` | 以上所有文件的 sha256；可用 `sha256sum -c SHA256SUMS` 校验 |

## 工作方式

```
业务项目 Webhook（Merge request events + Comments）
  └─► Pipeline Trigger API（本仓库默认分支）→ ai_review_trigger → 在业务项目 MR 上评论
```

## 一次性配置（Maintainer）

### 1. Runner

在运行 Runner 的机器上：

```bash
# Settings → CI/CD → Runners → New project runner：
#   Tags: ai-reviewer；不勾选 Run untagged jobs；复制生成的 glrt- token
gitlab-runner register \
  --url <本 GitLab 地址> \
  --token <glrt-token> \
  --executor docker \
  --docker-image node:24
```

机器需要能访问：本 GitLab、大模型接口、`node:24` 镜像源。

更换机器：新机器用同样的 `ai-reviewer` 标签注册，再在旧机器上 `gitlab-runner unregister`。

### 2. CI/CD 变量（Settings → CI/CD → Variables）

| 变量 | 属性 | 用途 |
|---|---|---|
| `GITLAB_PAT` | Protected + Masked + Hidden | 读 MR、写评论（`api` scope） |
| `OPENAI_API_KEY` | Protected + Masked + Hidden | 大模型调用 |
| `AI_REVIEWER_BOT_GITLAB_LOGIN` | — | `GITLAB_PAT` 对应账号的用户名，用于忽略 bot 自己的评论 |
| `AI_REVIEWER_OPENAI_BASE_URL` | — | 可选，兼容 OpenAI 协议的模型网关地址 |
| `AI_REVIEWER_OPENAI_LIGHT_MODEL` / `AI_REVIEWER_OPENAI_HEAVY_MODEL` / `AI_REVIEWER_LANGUAGE` | — | 可选 |

### 3. 保护默认分支

Settings → Repository → Protected branches：默认分支的 **Allowed to push** 只保留发布账号，
**Allowed to merge** 设为 No one。

### 4. 接入业务项目

1. Settings → CI/CD → Pipeline trigger tokens：在**本仓库**创建一个 trigger token。
2. 在**业务项目** Settings → Webhooks 新建：
   - URL：`<本 GitLab 地址>/api/v4/projects/<本仓库项目 ID>/ref/<默认分支>/trigger/pipeline?token=<trigger_token>`
   - 勾选 Merge request events、Comments
3. `GITLAB_PAT` 对应账号需要是业务项目的 Developer 或以上。

> trigger token 等同于「让审查器处理任意一个 PAT 可访问项目」的权限，只能出现在 webhook 配置里。
