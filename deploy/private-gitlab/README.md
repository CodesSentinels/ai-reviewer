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
| `GITLAB_PAT` | Protected + Masked + Hidden | 读 MR、写评论（`api` scope）。可以是个人 PAT、Project Access Token 或 Group Access Token，见下方「bot 凭据」 |
| `OPENAI_API_KEY` | Protected + Masked + Hidden | 大模型调用 |
| `AI_REVIEWER_GITLAB_TOKEN_MAP` | — | 可选，按项目选择 token，见下方「bot 凭据」。设置后不再使用 `GITLAB_PAT`（除非映射表引用它） |
| `AI_REVIEWER_BOT_GITLAB_LOGIN` | — | 可选，`GITLAB_PAT` 对应账号的用户名，用于忽略 bot 自己的评论。不配时从 token 自动识别；设置了 `AI_REVIEWER_GITLAB_TOKEN_MAP` 时忽略 |
| `AI_REVIEWER_OPENAI_BASE_URL` | — | 可选，兼容 OpenAI 协议的模型网关地址 |
| `AI_REVIEWER_OPENAI_LIGHT_MODEL` / `AI_REVIEWER_OPENAI_HEAVY_MODEL` / `AI_REVIEWER_LANGUAGE` | — | 可选 |
| `AI_REVIEWER_MAX_FILES` / `AI_REVIEWER_WARN_FILES` / `AI_REVIEWER_INITIAL_PR_SUMMARY_ONLY` | — | 可选，大型 MR 的处理：最多处理的文件数（默认 150，超出时按优先级处理）、超过多少个文件在摘要里提醒（默认 50）、初始化类 MR 自动审查时是否只出摘要（默认 `true`） |
| `AI_REVIEWER_PIPELINE_TOKEN` | Protected + Masked + Hidden | 可选。**本仓库**的 Project Access Token（**Maintainer**、`api` scope；改名接口不接受 Developer，会返回 403），用于给每条 pipeline 改名，标明它在处理哪个项目的哪个 MR、哪次提交、做了什么（如 `web-app !15 @0aec0f4 · push → 审查完成，发布 1 条评论`、`web-app !15 @0aec0f4 · ↳ bot 发布行级评论 · 已跳过`）。不配置则保持默认名称，不影响审查 |

### bot 凭据：单个 token 或按项目映射

审查器用 token 读 MR、发评论。评论以 token 对应的账号身份发出，bot 身份从 token 自动识别。

**单个 token**：只配 `GITLAB_PAT`。

| token 类型 | 覆盖范围 | 说明 |
|---|---|---|
| Group Access Token | 该 group 及子 group 下的所有项目 | 推荐。group Owner 创建，角色 Developer、scope `api` |
| Project Access Token | 单个项目 | 只接入一个项目时可用 |
| 个人 PAT | 该账号能访问的所有项目 | 评论以个人身份发出，不建议用于生产 |

**按项目映射**：业务项目分布在多个 group，或各项目要用不同 token 时，配 `AI_REVIEWER_GITLAB_TOKEN_MAP`。

1. 每个 token 单独建一个 CI 变量，变量名以 `GITLAB_` 开头，设为 Protected + Masked + Hidden。
2. 在 `AI_REVIEWER_GITLAB_TOKEN_MAP` 里写「项目路径 = 变量名」，每行一条（也可用 `;` 或 `,` 分隔），`#` 开头为注释：

   ```
   group-a/sub          = GITLAB_GAT_A
   group-b/project-x    = GITLAB_PAT_X
   group-b/project-y    = GITLAB_PAT_Y
   ```

- 项目路径按路径段匹配：`group-a/sub` 覆盖 `group-a/sub/app`，但不覆盖 `group-a/subway`。多条命中时取最长的。
- 映射表同时是**项目白名单**：不在表里的项目直接拒绝运行。需要兜底时加一条 `* = GITLAB_PAT`。
- 映射表本身只写变量名，不写 token，所以不需要 Masked。
- 各项目的 token 对应不同的 bot 账号，所以启用映射表后 `AI_REVIEWER_BOT_GITLAB_LOGIN` 不再生效，bot 身份一律从 token 识别。
- 每个 token 对应的账号都要是其项目的 Developer 或以上。

### 3. 保护默认分支

Settings → Repository → Protected branches：默认分支的 **Allowed to push** 只保留发布账号，
**Allowed to merge** 设为 No one。

### 4. 接入业务项目

1. Settings → CI/CD → Pipeline trigger tokens：在**本仓库**创建一个 trigger token。
2. 在**业务项目** Settings → Webhooks 新建：
   - URL：`<本 GitLab 地址>/api/v4/projects/<本仓库项目 ID>/ref/<默认分支>/trigger/pipeline?token=<trigger_token>`
   - 勾选 Merge request events、Comments
3. bot 凭据要能访问该项目：单个 token 时确认它覆盖该项目；按项目映射时在 `AI_REVIEWER_GITLAB_TOKEN_MAP` 里加一条。token 对应账号需要是业务项目的 Developer 或以上。

> trigger token 等同于「让审查器处理任意一个 bot 凭据可访问项目」的权限，只能出现在 webhook 配置里。
> 配置 `AI_REVIEWER_GITLAB_TOKEN_MAP`（不加 `*`）可以把范围收窄到表里列出的项目。
