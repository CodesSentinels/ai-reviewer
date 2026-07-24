# AI Reviewer 在 GitHub 与 GitLab 的运行及交互差异

> 文档版本：v1.4
>
> 编制日期：2026-07-22
>
> 对比范围：长期保留的 GitHub Action 实现 vs 新增的 `gitlab.com/CodesSentinels/ai-reviewer-test` MVP 实现
>
> 关联方案：[GitHub / GitLab 双平台兼容实施方案](./github-to-gitlab-migration-plan.md)

> 已确认的当前项目代码治理方式：**GitHub 为唯一代码主源，GitLab 为单向发布目标**。这只是当前项目的源码/产物分发方式，不是产品运行时依赖。GitHub PR 审查是现有实现；GitLab MR 路径是已确认的目标设计，相关 trigger、adapter 和 CI **尚未实现**，通过 MVP 验收后才进入正式支持。“兼容”表示任一平台可以独立运行，也可以同时启用；不表示评论、审查状态或协作数据在平台之间同步。

## 一、运行架构差异

### 1.0 双平台总体架构

```text
GitHub PR ── GitHub Actions ── GitHub 入口/adapter ─┐
                                                    ├── Shared Review Core ── OpenAI
GitLab MR ── GitLab shared Runner ── GitLab 入口/adapter（@gitbeaker/rest）─┘

以上两条运行路径可单独存在，也可同时存在；运行时互不调用。

当前项目发布链路（独立于上面的运行架构）：
GitHub main ── sync-to-gitlab.yml（单向、受控）──► GitLab main
```

- GitHub 的 `action.yml`、Action inputs、事件入口和 Octokit adapter 继续作为正式功能维护。
- GitLab 新增 `.gitlab-ci.yml`、`TRIGGER_PAYLOAD` 入口和以 `@gitbeaker/rest` 为标准客户端的 GitLab API adapter；原生 `fetch` 仅作为 adapter 内受控 fallback。
- 当前项目的两个产物从同一 GitHub `main` 提交构建并单向发布；GitLab 不反向写回 GitHub，也不在 GitLab 直接合并业务代码。其他部署可以采用自己的受信任构建/发布方式。
- GitHub PR 与 GitLab MR 分别保存 marker、评论和线程状态；同一 commit 同时存在 PR/MR 时也按两个独立审查任务处理。
- GitHub-only 模式不需要任何 GitLab 配置；GitLab-only 模式不需要 GitHub Token/API/workflow。共享的是源码和业务核心，不是在线平台依赖。

### 1.1 当前 GitHub 运行方式

```text
PR 创建 / 新 commit
        │ pull_request_target
        ▼
GitHub Actions workflow
        │ checkout PR head
        │ uses: ./
        ▼
action.yml / dist/index.js
        │ GITHUB_TOKEN + OPENAI_API_KEY
        ▼
GitHub REST / GraphQL API
        │
        ├─ PR summary comment
        ├─ 行级 review comment
        ├─ 回复评论
        └─ resolve review thread

PR 评论 / 行级回复
        │ issue_comment / pull_request_review_comment
        └──────────────► 同一个 GitHub Actions workflow
```

当前 GitHub 形态的特点：

- Workflow 自己就是事件入口，不需要额外 webhook 服务。
- GitHub 自动构造事件上下文，代码通过 `@actions/github` 读取。
- `GITHUB_TOKEN` 由 GitHub Actions 自动提供。
- Action inputs 通过 `with:` 和 `action.yml` 传入。
- 每次 PR 或评论事件对应一次 workflow run。

> 安全说明：当前 workflow 使用 `pull_request_target`，同时 checkout/执行 PR head 并注入密钥，迁移方案已将其列为 P0，必须先止血。本文件只描述现状，不表示认可该做法。

### 1.2 新增的 GitLab MVP 运行方式

```text
MR 创建 / HEAD SHA 更新 / MR 评论
        │ Merge Request Hook / Note Hook
        ▼
GitLab Project Webhook
        │ 调用 Pipeline Trigger API
        │ 固定 ref = protected main
        ▼
GitLab main trigger pipeline
        │ TRIGGER_PAYLOAD
        │ Protected PAT + OPENAI_API_KEY
        ▼
ai-review-trigger job（GitLab shared Runner）
        │ 只运行 protected main 中的代码
        │ MR 内容仅作为 API 数据读取
        ▼
GitLab adapter（@gitbeaker/rest）
        │ SDK 未覆盖时才使用 adapter 内受控 fetch
        ▼
GitLab REST API
        │
        ├─ MR summary note
        ├─ 行级 discussion
        ├─ discussion reply
        └─ resolve discussion

普通 MR Pipeline
        └─ 只运行无密钥 build / test / package
```

该方案使用 GitLab 自带共享 Runner，不需要 Kubernetes、云容器、PostgreSQL、Redis 或常驻 Receiver。GitLab 官方支持 Project Webhook 直接触发指定 ref 的 pipeline，并通过 file-type `TRIGGER_PAYLOAD` 提供原始事件：[Pipeline Trigger API](https://docs.gitlab.com/ci/triggers/)。

## 二、核心差异总表

| 维度 | GitHub（保留） | GitLab MVP（新增） | 对使用者的影响 |
|------|-------------|------------|----------------|
| 产品形态 | 仓库内 GitHub Action | GitLab CI trigger job | GitLab 不需要“安装 App”，需要配置 CI、Webhook 和 Trigger token |
| 支持状态 | 已有正式运行路径，完成 P0 安全修复后长期保留 | 新增正式运行路径 | 两个平台均可使用，不存在先后切换关系 |
| 独立运行 | 不需要 GitLab URL、PAT、Webhook、Runner 或 API | 不需要 GitHub Token、API 或 workflow | 可只启用其中一个平台，也可同时启用 |
| 配置入口 | `action.yml` + workflow `with:` | `.gitlab-ci.yml` + Protected CI variables + 项目配置 | 两套入口共存，非敏感业务配置尽量使用同一 schema |
| 自动触发 | `pull_request_target` | Merge Request Hook → Pipeline Trigger API | MR 创建/新 commit 后仍可自动审查 |
| 评论触发 | `issue_comment`、`pull_request_review_comment` | Note Hook → Pipeline Trigger API | 评论命令仍可使用，但会创建一条 trigger pipeline |
| 执行环境 | GitHub-hosted runner | gitlab.com shared Runner | 受 GitLab CI 分钟、排队和 job timeout 影响 |
| 受信任代码 | 当前错误地执行 PR head | 只执行 protected `main` 代码 | GitLab 方案安全边界更清晰 |
| 事件数据 | GitHub context/payload | `$TRIGGER_PAYLOAD` 文件 | 事件适配层必须重写 |
| 平台 API | Octokit REST + GitHub GraphQL | `@gitbeaker/rest` → GitLab REST API，必要时 GraphQL；原生 `fetch` 仅作 adapter 内受控 fallback | 两个平台使用独立 adapter，SDK 类型不进入共享核心；对使用者的评论交互方式不变 |
| 写评论身份 | `GITHUB_TOKEN` 对应 GitHub Actions/bot 上下文 | 评论显示为个人 PAT 所属 GitLab 用户 | MVP 评论不会天然显示成独立 GitLab Bot/App |
| 模型密钥 | GitHub Actions secret | Masked + Hidden + Protected CI variable | 只在 protected `main` trigger pipeline 可用 |
| 平台令牌 | 自动 `GITHUB_TOKEN` | 短期个人 PAT + Pipeline Trigger token | GitLab 需要额外创建、记录和轮换两个 token |
| 顶层评论 | Issue Comment API | MR Notes API | UI 体验相近，底层对象不同 |
| 行级评论 | Pull Request Review Comment | MR Discussion + diff position | GitLab 需要 base/head/start SHA 和新旧路径/行号 |
| 回复线程 | review comment reply | discussion note | 可以继续，但 API 和 ID 类型不同 |
| 解决线程 | GitHub GraphQL `resolveReviewThread` | GitLab Discussions API `resolved=true` | 可以继续，需 GitLab Developer 等权限 |
| 增量审查状态 | PR body/summary comment HTML marker | MR description/summary note marker | 可沿用思路，需要改 GitLab CRUD API |
| 并发 | GitHub `concurrency.group` | GitLab `resource_group: ai-reviewer-mvp` | MVP 全局串行，响应可能比 GitHub 慢 |
| 重试 | GitHub workflow rerun | GitLab pipeline/job Retry | 操作入口改变 |
| fork | 当前 workflow 存在高危处理路径 | MVP 明确拒绝 fork MR | fork 贡献者不能使用自动审查 MVP |
| 免费版限制 | GitHub Actions 配额/权限 | GitLab Free CI 分钟和排队限制 | 功能可用，但每个 Hook 都可能消耗 CI 分钟 |
| 构建入口 | `action.yml` / `dist/index.js` | GitLab trigger CLI：`dist/gitlab-trigger/index.js`（目标设计，尚未实现） | 两个产物必须从同一个 GitHub 主源 commit 构建和验证 |
| 代码发布 | 当前项目从 GitHub `main` 构建 | 当前项目接收 GitHub `main` 单向发布 | 属于当前项目治理，不是产品运行依赖；GitLab 不反向同步 |
| 状态范围 | GitHub PR 内独立保存 | GitLab MR 内独立保存 | 默认不跨平台同步评论、marker、线程或审查结果 |
| 功能承诺 | 现有接口向后兼容 | 审查与命令语义等价 | 平台 UI、链接、身份和格式允许存在差异 |

## 三、GitLab 上如何启用和使用

### 3.1 项目管理员的一次性配置

GitLab 不是通过 Marketplace 安装一个 App，而是在目标项目完成以下配置：

1. 把适配完成的代码和 `.gitlab-ci.yml` 合入并保护 `main`。
2. 配置普通 MR Pipeline，只运行无业务密钥的 build/test/package。
3. 创建专用 Pipeline Trigger token。
4. 创建 Project Webhook，勾选 Merge request events 和 Comments。
5. Webhook URL 指向：

   ```text
   https://gitlab.com/api/v4/projects/<project_id>/ref/main/trigger/pipeline?token=<trigger_token>
   ```

6. 配置以下 CI variables：

   | 变量 | 属性 | 使用范围 |
   |------|------|----------|
   | `GITLAB_PAT` | Masked + Hidden + Protected | protected `main` trigger pipeline |
   | `OPENAI_API_KEY` | Masked + Hidden + Protected | protected `main` trigger pipeline |

7. `ai-review-trigger` job 仅匹配 `CI_PIPELINE_SOURCE=trigger` 且 ref 为 protected default branch。
8. 强制关闭 reviewer 的本地 shell 和自动 lint 工具，避免模型执行仓库代码。
9. 用真实测试 MR 验证自动审查、行级 discussion、评论命令、重复事件和旧 SHA 退出。

### 3.2 开发人员的日常使用

完成适配和管理员配置后，开发人员的操作方式基本不变：

1. 创建或更新 GitLab Merge Request。
2. Webhook 触发 protected `main` pipeline。
3. Pipeline 从 GitLab API 读取 MR diff。
4. AI Reviewer 在 MR Overview 发布摘要，在 Changes 中发布行级 discussion。
5. 用户在 MR 顶层评论或 discussion 回复中输入命令。
6. Note Hook 触发新的 main pipeline，命令结果回复到对应 MR/discussion。

用户不需要手动点击 Run pipeline，也不需要知道 Trigger token。

## 四、评论区交互能否继续运行

结论：**可以在两个平台继续运行。GitHub 路径保留；GitLab 必须新增事件、权限和 API 适配，不能直接使用当前 GitHub 入口。**

### 4.1 功能映射

| 当前交互 | GitHub 实现 | GitLab 目标实现 | GitLab 最低 access level / 触发条件 | MVP 目标状态 |
|----------|-------------|----------------|------------------------------------|--------------|
| 自动增量审查 | PR opened/synchronize/reopened | MR Hook 创建/重新打开/HEAD SHA 更新 | 系统事件；仅同项目 MR | ✅ 可实现 |
| 发布总览摘要 | PR issue comment | MR note | reviewer PAT 内部写入 | ✅ 可实现 |
| 发布行级问题 | review comment | diff discussion | reviewer PAT 内部写入 | ✅ 可实现 |
| 回复行级问题 | `pull_request_review_comment` | Note Hook + discussion note | 按评论内容对应的命令权限；自然语言权限待定义 | ✅ 可实现 |
| 顶层评论命令 | `issue_comment` | MR Note Hook | 按具体命令 | ✅ 可实现 |
| `review` | 命令触发增量审查 | trigger job 调 GitLab adapter | Developer+；MR 作者可豁免 | ✅ 可保留 |
| `full review` | 全量重新审查 | trigger job 读取完整 MR diff | Developer+；MR 作者可豁免 | ✅ 可保留 |
| `summary` | 重新生成 PR 摘要 | 更新/重建 MR summary note | Developer+；MR 作者可豁免 | ✅ 可保留 |
| `pause` / `resume` | 修改 PR body marker | 修改 MR description marker | Developer+；MR 作者不豁免 | ✅ 可保留 |
| `configuration` | 显示 Action inputs | 显示 GitLab ConfigProvider/CI 配置 | Reporter+ | ✅ 可保留，展示字段需调整 |
| `help` | 输出 GitHub 命令帮助 | 输出 GitLab 命令帮助 | 可见项目的成员 | ✅ 可保留，文案需调整 |
| `resolve` | GitHub GraphQL resolve thread | GitLab Discussions API resolve | Developer+；MR 作者不豁免 | ✅ 可保留 |
| 自然语言追问 | PR 顶层/行级评论上下文 | MR 顶层 note/discussion 上下文 | ❓ 尚未在 0.7 确认，不得自行沿用命令豁免 | ⚠️ 可实现，需重写上下文获取逻辑 |
| Emoji/早期反应 | GitHub Reactions API | GitLab Award Emoji API | reviewer PAT 内部写入 | ⚠️ 分别实现，不影响核心审查 |

> 权限基线以迁移方案 [0.7 MVP 运行契约](./github-to-gitlab-migration-plan.md#07-mvp-运行契约实施时不得降级)为准。实现时应由共享权限策略和 GitLab adapter 共同执行，不能在两份文档中维护两套不同默认值。

GitLab 原生支持 MR discussion 的创建、回复和 resolve；行级 discussion 需要提供 diff version 的 `base_sha`、`head_sha`、`start_sha`、路径和行号：[GitLab Discussions API](https://docs.gitlab.com/api/discussions/)。

### 4.2 评论触发示例

当前解析器支持以下文本别名和命令：

```text
@ai-reviewer review
@ai-reviewer full review
@ai-reviewer summary
@ai-reviewer pause
@ai-reviewer resume
@ai-reviewer configuration
@ai-reviewer help
@ai-reviewer resolve
```

也支持把 `@ai-reviewer` 替换为 `@codesentinel`。

GitLab 适配后，可以继续使用相同命令文本。例如在 MR 顶层评论：

```text
@ai-reviewer full review
```

执行链路为：

```text
Note Hook
  → Pipeline Trigger API
  → protected main / ai-review-trigger
  → 解析 TRIGGER_PAYLOAD
  → 校验评论者权限
  → GitLab API 读取 MR
  → 执行 full review
  → 回复 MR note/discussion
```

### 4.3 评论作者和 @mention 的重要差异

GitHub 当前评论通常体现为 Actions/bot 上下文；GitLab MVP 使用个人 PAT，因此评论作者会显示为 **PAT 所属 GitLab 用户**。

当前代码把 `@ai-reviewer`、`@codesentinel` 写成固定解析关键字，但它们不一定是 GitLab 中真实存在的用户名。因此需要在 GitLab 实现中二选一；该选择不改变 GitHub 的现有命令前缀：

1. 推荐：把命令 mention 配置为 PAT 账号的实际 GitLab username，例如 `@mvp-reviewer review`；或
2. 继续把 `@ai-reviewer` 当作纯文本触发关键字，但它在 GitLab UI 中可能不是可点击的真实用户 mention。

MVP 使用个人 PAT 时，应在帮助文案中同时显示：

- 评论实际作者；
- 当前有效命令前缀；
- 该前缀是否为真实 GitLab 用户 mention。

## 五、评论与讨论对象的具体区别

### 5.1 顶层评论

| GitHub | GitLab |
|--------|--------|
| PR 复用 Issue Comment API | MR 使用 Notes API |
| `issue_comment` payload | `Note Hook` payload |
| PR number | MR IID |
| comment ID | note ID |

GitHub 继续使用 PR issue comment；GitLab 的顶层摘要、help、configuration、pause/resume 回复使用 MR note。

### 5.2 行级评论

| GitHub | GitLab |
|--------|--------|
| Pull Request Review Comment | Merge Request Diff Discussion |
| commit/path/line/side | base/head/start SHA + old/new path + old/new line |
| review thread node ID | discussion ID |

GitLab 行级 position 更严格。每次写行级 discussion 前必须获取 MR 最新 diff version；使用旧 SHA 可能返回错误或把评论定位到错误版本。

### 5.3 Thread resolve

GitHub 当前使用 GraphQL `resolveReviewThread`。GitLab 改为 Discussions API：

```text
PUT /projects/:id/merge_requests/:iid/discussions/:discussion_id?resolved=true
```

GitLab 要求 Developer、Maintainer、Owner，或符合条件的变更作者。MVP 计划继续要求 Developer 及以上执行 `resolve`，避免仅依赖作者特例。

## 六、配置方式差异

### 6.1 GitHub

GitHub workflow 通过 `with:` 向 `action.yml` 传参：

```yaml
- uses: ./
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
  with:
    review_comment_lgtm: false
    openai_heavy_model: gpt-5.4-mini
```

### 6.2 GitLab

GitLab 没有 `action.yml` inputs。新增的 `GitLabConfigProvider` 从以下来源读取；GitHub 继续由 `GitHubConfigProvider` 兼容现有 Action inputs：

1. Protected CI variables：只存密钥和少量部署配置；
2. 项目内受版本控制的 reviewer 配置文件：存模型、语言、文件过滤等非敏感配置；
3. trigger payload：只提供本次事件的 project/MR/note/user/SHA 上下文。

不应把完整 Action inputs 原样搬成大量 CI variables。

## 七、状态、并发和重试差异

### 7.1 状态

MVP 不增加数据库。两个平台通过统一状态接口分别保存可见状态，互不覆盖：

- GitHub：继续使用 PR body/summary comment/review thread 中的 marker；
- GitLab：MR description 保存 pause/resume，summary note 保存 reviewed SHA，bot note 保存 event/note ID；
- GitHub event/comment ID 与 GitLab event/note ID 使用平台命名空间，不能混作同一个幂等键。

### 7.2 并发

GitHub 当前按 PR/comment 构造 `concurrency.group`。GitLab MVP 为降低无数据库条件下的竞态，使用一个全局：

```yaml
resource_group: ai-reviewer-mvp
```

因此所有审查和命令串行运行。功能可以保证，但多个 MR 同时操作时等待时间会增加。

### 7.3 重试

- GitHub：从 Actions 页面 rerun workflow。
- GitLab：从 Pipeline/Job 页面 Retry。
- GitLab MVP 不做外部失败队列和自动重放。
- 重试前仍要检查 marker 和当前 HEAD SHA，防止重复评论或旧结果落库。

## 八、双平台用户体验

### GitHub 用户

- 继续通过 GitHub PR、Actions、PR 评论和 review thread 使用现有能力。
- `action.yml` inputs 和现有命令语义保持向后兼容。
- P0 安全修复会改变内部执行边界，但不应删除已有功能。

### GitLab 用户

- 使用 GitLab MR、Pipeline/Job、MR note 和 discussion。
- 评论作者显示为 PAT 用户，而非天然的 App/bot 身份。
- ignored Note Hook 也可能产生一条很快结束的 trigger pipeline。
- 评论响应速度受 GitLab shared Runner 排队影响。
- MVP 全局串行，多 MR 同时评论时需要等待。
- fork MR 在 MVP 中不提供自动审查。
- `@ai-reviewer` 是否是真实可点击 mention，取决于 GitLab 用户名配置。

### 跨平台边界

- GitHub PR 评论不会自动同步到 GitLab MR，GitLab MR 评论也不会回写 GitHub。
- 一个 GitHub PR 审查失败不应阻塞 GitLab MR 审查，反之亦然。
- 两个平台可以对同一 commit 分别审查；结果要求语义等价，但评论 ID、链接、格式和作者身份无需完全一致。
- GitHub adapter 不调用 GitLab API，GitLab adapter 不调用 GitHub API；任一模式启动时不校验另一平台是否存在。
- 当前项目的 GitHub → GitLab 单向发布只负责交付受信任代码/产物，不传输 PR/MR、评论、marker、事件或运行状态。

## 九、当前状态与验收结论

### GitHub 已具备并继续维护

- GitHub Action 审查主流程。
- GitHub PR 顶层评论、行级评论和命令解析。
- review/full review/summary/pause/resume/configuration/help/resolve 命令框架。
- summary、reviewed SHA 和 pause/resume marker 思路。

### GitLab 尚未实现，兼容开发必须完成

- `.gitlab-ci.yml` 的无密钥 MR job 和 protected `main` trigger job。
- `TRIGGER_PAYLOAD` 解析及 GitLab 事件上下文。
- 以锁定版本的 `@gitbeaker/rest` 为标准客户端的 GitLab REST adapter；统一处理 host、PAT、timeout、分页、错误规范化和脱敏，原生 `fetch` 仅作 adapter 内受控 fallback。
- Notes/Discussions/diff position/resolve API。
- GitLab access level 权限映射。
- GitLab 评论身份和命令前缀配置。
- Project Webhook、Trigger token、Protected CI variables。
- GitLab 端到端及恶意 MR 安全测试。

### 双平台兼容验收

- 同一组 fixture 在 GitHub adapter 与 GitLab adapter 上产生语义等价的摘要、行级问题和命令结果。
- GitHub `action.yml` 输入和用户可见命令没有非版本化破坏性变更。
- 两个平台分别通过自动审查、手动命令、行级评论、状态 marker、权限校验、重试和分页测试。
- `@gitbeaker/rest` 通过 host、PAT、timeout、分页、状态码、错误和日志脱敏契约测试；其 SDK 类型不得进入共享核心。
- GitHub/GitLab 任一平台 API、Runner 或凭据故障时，另一平台仍可独立运行。
- GitLab 构建和部署能够追溯到对应的 GitHub 主源 commit。
- **GitHub-only**：不提供任何 GitLab URL、PAT、Webhook、Runner 或变量，GitHub Action 仍能启动并完成全部 GitHub 验收项。
- **GitLab-only**：不提供 GitHub Token，不允许访问 GitHub API，也不依赖 GitHub workflow，GitLab reviewer 仍能启动并完成全部 GitLab 验收项。
- **同时启用**：两边分别处理事件；评论、线程、marker、幂等键和重试状态不跨平台读取或写回。

最终判断：**评论区交互可以在 GitHub 或 GitLab 分别独立启用，也可以同时保留。实现方式是抽取共享审查核心，维护彼此独立的 GitHub Action/Octokit adapter 和以 `@gitbeaker/rest` 为标准客户端的 GitLab trigger/API adapter；原生 `fetch` 仅能作为 GitLab adapter 内受控 fallback。不能把当前 `dist/index.js` 或 `action.yml` 直接放进 GitLab Runner 使用，也不能让任一 adapter 依赖另一平台在线。**
