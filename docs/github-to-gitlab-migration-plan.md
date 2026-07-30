# GitHub / GitLab 双平台兼容实施方案

> 代码主源：**GitHub `main`**；兼容目标平台：**gitlab.com SaaS Free**（3 人 MVP，目标项目 `CodesSentinels/ai-reviewer-test`）
>
> 未来候选平台：**JiHu GitLab（版本待未来立项时确认）**（不属于当前实施范围）
>
> 文档版本：v1.9 ｜ 初版日期：2026-07-20 ｜ 修订日期：2026-07-22 ｜ 文档状态：双平台兼容 MVP 实施基线

---

## 0. 文档使用说明

### 0.1 双平台兼容路线

```
当前项目的代码治理/发布链路（不属于产品运行时依赖）
  GitHub main（唯一代码主源）
      │  sync-to-gitlab.yml 单向、受控同步
      ▼
  GitLab main（运行镜像；不反向写回、不直接合并业务代码）

产品运行路径（可独立启用，也可同时启用）
  GitHub PR ── GitHub Action / Octokit adapter ─┐
                                                ├── 共享审查核心 ── OpenAI
  GitLab MR ── GitLab Runner / GitLab adapter（@gitbeaker/rest）─┘

  GitHub-only：不配置任何 GitLab 资源也可完整运行
  GitLab-only：运行时不访问 GitHub API/Token/Workflow 也可完整运行
  同时启用：各自处理本平台事件和状态，不跨平台回写

当前 MVP
  保留并安全修复 GitHub 功能 + 新增 GitLab MR 审查和精简 CI
      ▼
  3 人、同项目 MR（仍按不可信输入处理）双平台兼容验收

未来可选项（本轮不实施）
  历史数据复制 / 权限 / 通知 / 可选 JiHu 评估
```

### 0.2 当前实施基线（务必先读）

| 维度 | 说明 |
|------|------|
| **代码主源** | GitHub `main` 是唯一代码主源；GitLab `main` 仅接收单向同步，不反向写回，不在 GitLab 直接合并业务代码。 |
| **兼容定义** | 同一套代码可在 GitHub 或 GitLab 分别独立运行，也可同时启用；任何一种平台模式都不以另一平台的 API、Token、Webhook、评论或状态数据为运行前提。 |
| **运行平台** | GitHub Action 与 gitlab.com SaaS Free 均受支持，可由各项目按需单独启用或同时启用；本次兼容实现不以双跑为前置条件。GitLab SaaS 滚动更新，不使用自建实例版本号。 |
| **当前范围** | 保留 GitHub PR 审查、评论命令和配置兼容；在 3 人空项目新增 GitLab 能力。不迁 Issue/PR/Release/Wiki 历史。所有 PR/MR 内容均按不可信输入处理。 |
| **运行形态** | GitHub 保留安全修复后的 Action 入口；GitLab MR Pipeline 只运行无密钥的 build/test/package，Project Webhook 在 protected `main` 上启动 `ai-review-trigger` job。两条入口共享审查核心，但使用各自事件和 API adapter。 |
| **认证** | GitHub 继续使用收紧权限后的 `GITHUB_TOKEN` 和独立 OpenAI Key；GitLab 使用短期个人 PAT、独立 OpenAI Key 和 Pipeline Trigger token。两个平台凭据分别存储、轮换和审计。 |
| **安全边界** | MVP 不支持 fork MR；“同项目”也不是代码信任边界。任何执行 MR 分支代码的 job 都必须无 PAT、OpenAI Key、Webhook/Trigger token 等业务密钥；MVP reviewer 禁用本地 shell。 |
| **未来 JiHu** | 不沿用旧的“EE 19.3 → JiHu 18.2”实施假设；启动第二阶段时根据实际源/目标版本重新制定迁移方案。 |


### 0.3 每个分析项的固定结构

```
当前能力                         —— GitHub 当前如何实现
GitLab.com Free（当前实施依据）   —— 当前 MVP 的兼容性 / 是否需改 / 原因
未来 JiHu（未核验、非实施依据）  —— 仅保存历史分析，启动未来立项时重新核验
修改建议           —— 如何改 + 示例
验证方法           —— 如何验证迁移成功
风险等级           —— P0 / 严重 / 高 / 中 / 低
状态              —— ✅ 无需修改 / ⚠️ 建议修改 / ❓ 待确认 / ⏸ 非当前范围
```

> ⛔ **历史资料失效边界**：第一至二十章中仍使用“GitLab EE / JiHu 是否兼容”字段的段落，是旧迁移方案遗留的能力清单，**未按当前 gitlab.com Free 和未来 JiHu 版本逐项重新核验**。其中的 `✅`、`18.2 已含`、`19.3 与 18.2 均支持`等结论一律不是当前实施依据。当前实施只能采用明确标为“GitLab.com Free（当前）”的结论，以及 0.2、0.5、0.6、0.7、二十一和二十三章；未来 JiHu 立项时必须使用届时版本的官方文档重新验证。

### 0.4 本项目实际扫描结论（作为分析依据）

对当前仓库 `CodesSentinels/ai-reviewer` 实扫结果：

| 探测项 | 结果 | 影响模块 |
|--------|------|----------|
| 项目类型 | GitHub **Action**（Node/TS 打包为 `dist/index.js`）| 全局 |
| Workflow 数量 | 4 个：`openai-review.yml`、`combine-prs.yml`、`versioning.yml`、`sync-to-gitlab.yml` | 二、三 |
| 当前仓库定位 | 本地 `origin` 已是 `gitlab.com/CodesSentinels/ai-reviewer` 镜像；代码、`package.json` 和运行时仍是 GitHub Action 形态 | 一、二 |
| 已存在 GitLab 同步 | ✅ `sync-to-gitlab.yml` 配置为从 GitHub `main` 强推到 `gitlab.com/CodesSentinels/ai-reviewer`；仅能证明配置存在，运行状态仍需在 GitHub Actions 核验 | 一、十七 |
| 第三方 Action | `actions/checkout@v3/v4`、`actions/github-script@v6`、`Actions-R-Us/actions-tagger@latest`（**非官方、@latest 浮动 tag**）| 二 |
| 特殊事件 | `pull_request_target`、`pull_request_review_comment`、`issue_comment` | 二、六 |
| Runner 差异 | `versioning.yml` 使用 **`windows-latest`**，但内容仅一个第三方 tagger（纯 Git 操作），**无真实 Windows 依赖，可改 Linux** | 二、十四 |
| Dependabot | ❌ **确认无 `.github/dependabot.yml`**，未启用（`combine-prs` 仅为手动工具，不代表启用 Dependabot）| 九、二十二 |
| GitHub App 认证 | ❌ **未使用**（走 `GITHUB_TOKEN`，`action.yml` 的 `bot_github_login` 仅可选标识）| 十一 |
| GitHub Packages | ❌ **未使用**（`package.json` 为 `private:true`，无 `npm publish`）| 八 |
| GitHub Pages | ❌ **未使用**（无 `deploy-pages`/`gh-pages`）| 十五 |
| Issue / PR 模板 | ❌ **未发现** | 五 |
| Submodule | ❌ 无 `.gitmodules` | 一 |
| Git LFS | ❌ `.gitattributes` 无 LFS 规则（仅 `dist/** -diff linguist-generated`）| 一 |
| CODEOWNERS | ❌ 未发现 | 四 |
| Secrets 引用 | workflow 引用了 `GITHUB_TOKEN`、`OPENAI_API_KEY`、`GITLAB_TOKEN`；变量是否真实存在、权限和过期时间须通过平台设置/API 核验 | 二、十一 |
| 代码规模/耦合 | 约 13.5K 行 TS；12 个文件包含 `octokit.*`，共 47 次调用；3 次直接 GraphQL 调用均在 `src/github/review-thread.ts`；30 个文件直接引入 `@actions/core` 或 `@actions/github` | 二、十一、二十三 |
| 包结构 | 根包之外还有 `tools/review-visualizer` 独立前端包；当前未配置 npm/pnpm workspace | 一、三 |
| GitLab/部署资产 | ❌ 当前无 `.gitlab-ci.yml` 和 GitLab webhook/trigger 配置；MVP 使用 gitlab.com 共享 Runner，不新增 Dockerfile、常驻 Receiver、队列、数据库或云平台部署 | 十、二十三 |

> **扫描边界**：仓库文件无法证明 GitHub/GitLab 的远端分支全集、tag、Branch Protection、Secret、Webhook、成员或 License 设置。此类项目不得写成“已确认”，必须通过平台 API/UI 留存快照后确认。
>
> **计数修订（2026-07-22）**：重新扫描时补计了 `src/commands/early-reaction.ts` 对 `@actions/core` 和 `@actions/github` 的直接依赖，因此相关源码文件数由 29 更正为 30；该文件并非本次修订中新建。

### 0.5 已确认决策及连锁影响（2026-07-20 更新）

> 以下 P0 决策已与业主确认，覆盖本文对应模块的初始判断。

| 决策项 | 结论 | 连锁影响 |
|--------|------|----------|
| 代码治理方式 | **GitHub `main` 为唯一代码主源，单向同步到 GitLab** | 保留并加固 `sync-to-gitlab.yml`；GitLab `main` 只作运行镜像，禁止反向同步和直接合并业务代码 |
| 本项目 Action 形态 | **保留 GitHub Action，并新增 GitLab 原生审查入口** | 触发[工作流 A](#二十三工作分解wbs)：抽取共享核心，GitHub adapter 作为正式支持实现保留，新增 GitLab 事件/API adapter |
| 是否经过自建 EE | **当前不经过** | 当前直接使用 gitlab.com Free；未来是否迁 JiHu 另立方案 |
| **License 级别** | **免费版（Free）** | ⛔ **多项 EE/Premium/Ultimate 功能不可用**，见下方「免费版能力红线」 |
| **部署形态** | **不自建，使用公网 GitLab** | ✅ 免去数据库/Redis/对象存储/SMTP/备份运维（[模块十八、十九](#十八数据库如迁移-gitlab-server)大幅简化）；⚠️ 引入 SaaS 特有约束 |

#### ✅ 术语澄清（2026-07-21 修订）

**已确认为 gitlab.com SaaS 免费版**（非自建 EE）。原「EE 19.3.0-pre」表述作废——`19.3.0-pre` 是自建实例版本号，gitlab.com SaaS 滚动更新、无此版本号。**结论：**
- 基础设施（数据库/Redis/对象存储/SMTP/备份）**由 gitlab.com 托管，[模块十八、十九](#十八数据库如迁移-gitlab-server)整块免除**。
- 功能集按 **gitlab.com Free tier** 计（见免费版红线）。
- **数据合规已确认：允许代码托管公网 gitlab.com**，无保密障碍。

#### ⛔ 免费版能力红线（受影响模块需降级方案）

| 功能 | 免费版状态 | 替代/影响 | 模块 |
|------|-----------|-----------|------|
| Merge Request Approval | ⚠️ Free 可做可选 approval，但不能配置强制 approval rule | 仅靠 Protected Branch + "全部 thread resolved" 近似强制 | [4.8](#48-approval-rule) |
| CODEOWNERS | ❌ gitlab.com Free 不提供 Code Owners 功能 | 靠人工约定或升级 Premium/Ultimate | [4.9](#49-codeowners) |
| Merge Train | ❌ 不可用 | 无队列合并，串行手动合并 | [3.11](#311-merge-train) |
| Epic / Roadmap / Iteration | ❌ 不可用 | 仅 Milestone + Issue Board 做规划 | [15.2](#152-epic)/[5.6](#56-roadmap)/[15.4](#154-iteration) |
| 安全扫描（SAST/DAST/依赖/容器）| ⚠️ 各 analyzer、报告、MR widget 和门禁的套餐不同 | MVP 不实施；正式期逐项核对套餐，不能以“模板存在”等同于完整可用 | [模块九](#九security) |
| Code Quality / License 合规门禁 | ❌ 不可用 | — | [模块九](#九security) |
| SCIM 自动开号 | ❌ 不可用 | 手工建号或 SaaS Group SAML（有限）| [12.6](#126-scim) |

> **权限模块（[模块四](#四权限系统)）的迁移策略因此改变**：原设想的"用 Approval Rule + CODEOWNERS 复刻 GitHub required review"在免费版**行不通**，只能用 **Protected Branch + Pipeline must succeed + All threads resolved** 三件套近似。若团队强依赖多人强制审批，这是一个**功能缺口**，需业主接受或考虑升级 License。

#### ✅ SaaS 化带来的简化与新约束

| 方面 | 变化 |
|------|------|
| 基础设施（[模块十八/十九](#十八数据库如迁移-gitlab-server)）| ✅ **整块免除**：DB/Redis/对象存储/SMTP/备份均由 gitlab.com 托管。工作流 C 不再含运维搭建 |
| Runner（[模块十四](#十四runner)）| ⚠️ 可用 gitlab.com **共享 Runner（有免费额度上限）**，超额需绑信用卡或自建 Runner。CI 量大时仍建议自建 Runner 接入 |
| GitHub Importer（[17.1](#171-gitlab-importer--github-import)）| ✅ SaaS 到 github.com 网络可达，Importer 通路顺畅 |
| 数据主权 | ✅ 已确认允许代码托管公网 gitlab.com；正式迁移扩大数据范围时仍需重新做数据分类检查 |
| Project/Group Access Token（[11.7](#117-project-token--118-group-token)）| ❌ gitlab.com Free 不作为可用能力；MVP 使用个人 PAT。自建 GitLab 的可用性另行评估 |

### 0.6 测试阶段范围与决策（2026-07-20 确认，走「最小可用/MVP」路线）

> 首轮仅做 **3 人双平台兼容验证**，不追求历史数据迁移。以下决策**大幅收窄**本文的实施范围。

| 决策项 | 结论 | 连锁影响 |
|--------|------|----------|
| 测试目标位置 | `https://gitlab.com/CodesSentinels/ai-reviewer-test` | MVP 代码、精简 CI 和 Webhook 均只作用于此空项目；`versioning.yml`、`combine-prs.yml` 不做 GitLab 等价实现，GitHub 侧 `sync-to-gitlab.yml` 保留并加固 |
| 测试人数 | **最多 3 人** | ✅ 在当前 Free 席位约束内；权限/SCIM/SSO 测试期可手工处理，创建项目前再核对当时额度 |
| AI Reviewer 调 GitLab 身份 | **个人 PAT** | PAT 配为 Masked + Hidden + Protected CI 变量（`api` scope），仅供 protected `main` trigger pipeline 使用，不进入普通 MR Pipeline |
| OpenAI Key | **兼容改造前强制轮换** | 现有 key 曾进入高风险 `pull_request_target` workflow，不能继续作为安全基线；GitHub 与 GitLab 分别使用受控凭据，旧 key 作废 |
| 历史数据迁移 | **不迁，空项目直接开跑** | ✅ **工作流 C 测试期整体推迟**（Issue/PR/Release/Wiki 均不迁）|
| 通知渠道 | **不需要** | ✅ [模块十三](#十三通知)测试期整体跳过 |
| MR 来源 | **仅同项目 MR，不接受 fork MR；MR 内容仍按不可信处理** | MR Pipeline 无业务密钥；reviewer 固定运行受保护 `main` 的已发布镜像，只读取 MR 数据 |
| 审查与评论事件入口 | **Project Webhook → Pipeline Trigger API** | MR/Note Hook 直接触发 protected `main` pipeline；`TRIGGER_PAYLOAD` 为 file-type 变量，job 内过滤事件并执行审查 |

#### ✅ 测试阶段「不做」清单（明确排除，避免范围蔓延）

- 数据迁移（工作流 C）：Issue / PR / Release / Wiki / Label / Milestone —— 空项目直接开跑
- 通知：Slack / Lark / Email（SMTP）
- 权限映射：Team→Subgroup、多人 Approval、CODEOWNERS（免费版本就受限）
- GitLab 等价实现：`versioning.yml`（windows tagger）、`combine-prs.yml` 本轮不移植；`sync-to-gitlab.yml` 作为长期单向同步链路保留并加固
- Dependabot→Renovate、Packages、Pages、安全扫描
- JiHu 降级迁移（第二阶段，本轮暂忽略版本问题）

#### 🎯 测试阶段「要做」清单（即 MVP 关键路径）

- **工作流 A（双平台兼容改造）**——核心工作量，见 [二十三、工作分解](#二十三工作分解wbs)
- **工作流 B（精简版）**：`.gitlab-ci.yml` 只在 MR head 上运行无密钥的 build/test/package，统一使用 Node 24
- **工作流 D（GitLab 接入与端到端联调）**：将 A5/A9 产物接入 protected `main` 的 `ai-review-trigger` job，配置 Project Webhook/Trigger 并验证真实 MR/Note Hook
- 在 `ai-reviewer-test` 建空项目、推代码、提测试 MR 验证

### 0.7 MVP 运行契约（实施时不得降级）

| 维度 | 已确定基线 |
|------|------------|
| 运行形态 | 不部署常驻 Receiver/worker。Project Webhook URL 指向 GitLab Pipeline Trigger API 的 protected `main` ref；`ai-review-trigger` job 使用仓库中该 `main` commit 的代码和 Node 24 image 运行。 |
| 事件载荷 | webhook 触发 pipeline 后，原始 payload 由 GitLab 以 file-type `TRIGGER_PAYLOAD` 提供；job 必须先解析、校验 project ID、事件类型、source/target project ID 和 HEAD SHA。 |
| MR 事件 | 仅在 MR 创建、重新打开或 HEAD SHA 变化时自动审查；标题、label、assignee 等元数据更新不触发模型调用。 |
| 陈旧任务 | MVP 使用全局 `resource_group: ai-reviewer-mvp` 串行执行。写 note/discussion 前再次读取当前 HEAD，SHA 不一致则直接退出，不写旧结果。 |
| 命令权限 | `review`、`full review`、`summary`、`pause`、`resume`、`resolve` 默认要求 GitLab Developer 及以上；`configuration` 要求 Reporter 及以上；`help` 对可见项目的成员开放。MR 作者仅豁免 `help`、`review`、`full review`、`summary`，不豁免状态修改和 resolve。 |
| 自事件过滤 | 忽略 PAT 账号自己的 note、system note、非 `action=create` note 和不符合严格命令语法的文本，防止 bot 评论形成反馈循环。 |
| 去重与状态 | 不新增数据库。自动审查继续用 summary note 中的 reviewed SHA marker；pause/resume 继续用 MR description marker；命令处理成功后写入 event/note ID marker。全局 `resource_group` 保证检查与写 marker 串行。 |
| 限流与成本 | 本轮仅保证功能可用，不设置每日预算、持久化限流或额外成本门禁；保留当前单次 job 内的命令限流。正式使用前必须另行评估。 |
| 密钥 | OpenAI Key 强制轮换；PAT/OpenAI Key 为 Protected CI variables；Trigger token 只放在项目 webhook URL。普通 MR Pipeline 对这些密钥始终不可见。 |
| GitHub 兼容 | `action.yml`、GitHub Action 入口、Octokit/GraphQL adapter 和现有命令语义继续正式支持；P0 安全修复不得以删除既有用户功能代替。 |
| 双入口 | GitHub 使用 Action 入口 `dist/index.js`；GitLab 使用独立 trigger CLI `dist/gitlab-trigger/index.js`。当前项目要求两个产物可追溯到同一 GitHub 主源 commit，但任一产物部署后均不依赖另一平台在线。 |
| 平台隔离 | GitHub PR 与 GitLab MR 的评论、线程、marker、事件 ID 和重试状态分别存储并带平台命名空间；默认不做跨平台评论或状态同步。 |
| 运行时独立 | GitHub 模式不得要求 GitLab URL、PAT、Webhook、Runner 或 GitLab API；GitLab 模式不得要求 GitHub Token、GitHub API 或 GitHub workflow。缺少另一平台全部配置时，当前平台仍须正常启动和完成审查。 |
| 代码同步 | GitHub `main` 是当前项目的唯一代码主源；`sync-to-gitlab.yml` 仅用于把受信任代码/产物单向发布到 GitLab，不属于 reviewer 的运行时依赖。GitLab 禁止反向同步、禁止直接合并业务代码，并保护目标 `main`。其他项目可采用自己的发布方式。 |
| 功能等价 | 自动审查、手动命令、摘要、行级评论、pause/resume、权限和增量状态在两个平台语义等价；平台 UI、链接、评论格式及作者身份允许不同。 |
| 故障隔离 | GitHub 与 GitLab 分别认证、执行和重试；adapter 不调用另一平台 API，任一平台 API、Runner、Webhook 或凭据故障不得阻塞另一平台。 |

### 0.8 当前平台约束的官方依据

以下结论于 2026-07-21 核对；GitLab.com 为滚动服务，实施前仍应复查：

- [Merge request approvals](https://docs.gitlab.com/user/project/merge_requests/approvals/)：Free 支持可选 approval，强制 required approvals 需要更高套餐。
- [Project access tokens](https://docs.gitlab.com/user/project/settings/project_access_tokens/)：GitLab.com 的 Project Access Token 需要 Premium/Ultimate；当前 Free MVP 使用个人 PAT。
- [Code Owners](https://docs.gitlab.com/user/project/codeowners/)：Code Owners 属于 Premium/Ultimate。
- [Merge request pipelines](https://docs.gitlab.com/ci/pipelines/merge_request_pipelines/)：fork MR 的 pipeline/变量边界不同，在父项目运行 fork 代码存在 secret 风险。
- [CI/CD variables](https://docs.gitlab.com/ci/variables/)：Protected Variable 通常只对 protected branch/tag 可用；MR Pipeline 访问 protected resources 还要求 source/target branch 均受保护、属于同一项目且触发者具有目标分支权限。因此本 MVP 不以 MR Pipeline 取得 Protected Variable 为架构前提。
- [Trigger pipelines with the API](https://docs.gitlab.com/ci/triggers/)：Project Webhook 可直接调用指定 ref 的 Pipeline Trigger URL；原始 webhook payload 通过 file-type `TRIGGER_PAYLOAD` 传入 job。当前 MVP 因此无需外部 HTTP Receiver。
- [Roles and permissions](https://docs.gitlab.com/user/permissions/)：命令授权必须按 GitLab access level 映射；“项目成员”不是足够精确的授权条件。
- [Webhooks](https://docs.gitlab.com/user/project/integrations/webhooks/)：优先使用 GitLab 提供的稳定 webhook message/idempotency 标识处理重试和重复投递。
- [GitHub Actions secure use](https://docs.github.com/en/actions/reference/security/secure-use)：`pull_request_target` 等特权触发器不得 checkout 并执行不可信 PR 代码；当前 GitHub workflow 的止血属于迁移前 P0。
- [Secret detection](https://docs.gitlab.com/user/application_security/secret_detection/)：不同 secret detection 机制和能力的套餐要求需分别确认。

---

## 一、代码仓库（含历史未核验能力清单）

> 本章至第二十章保留了旧方案的逐项能力资料，便于未来追溯，但所有标为“GitLab EE / JiHu”的字段均处于**历史、未核验**状态。除非条目明确写为“GitLab.com Free（当前）”并附当前依据，否则不得据此配置当前 MVP，也不得据此断言未来 JiHu 兼容。

### 1.1 Repository（仓库本体）

**当前能力**：业务代码和自动化仍按 GitHub Action 运行，`package.json` 仍声明 `git+https://github.com/CodesSentinels/ai-reviewer.git`；但本次实扫工作区的 `origin` 已指向 `git@gitlab.com:CodesSentinels/ai-reviewer.git`。因此当前状态是“GitHub 业务源/运行平台 + GitLab 镜像”，不能笼统写成仅由 GitHub 托管。

**GitLab.com Free 是否兼容**：✅ 完全兼容。Git 协议无差异。GitHub URL 继续作为代码主源元数据；GitLab 用 **Group/Subgroup** 层级对应 GitHub Org，当前 gitlab.com 命名空间已是 `CodesSentinels`，MVP 目标项目为 `gitlab.com/CodesSentinels/ai-reviewer-test`。

**未来 JiHu 注意事项**：Git 层一致，无差异；命名空间层级与 gitlab.com 相同。

**修改建议**：
- 命名空间映射：`CodesSentinels`(GitHub Org) → `CodesSentinels`(gitlab.com 现有命名空间)，MVP 仓库置于其下的 `ai-reviewer-test`。
- 保留 `package.json` 的 GitHub `repository.url`，并在文档或 `homepage`/自定义元数据中补充 GitLab 运行镜像地址，避免把镜像误标成代码主源。

**验证方法**：`git clone https://gitlab.com/CodesSentinels/ai-reviewer-test.git` 成功；`git log --oneline | wc -l` 提交数与 GitHub 源一致；`git rev-parse HEAD` 两端 commit SHA 相同。

**风险等级**：低

**状态**：✅ 保留 GitHub 主源元数据，补充 GitLab 镜像说明

---

### 1.2 Branch（分支）

**当前能力**：当前工作区只获取到本地 `main` 与 `origin/main`。GitHub 远端是否还有其他分支无法仅从当前镜像确认，须用 GitHub API 或 `git ls-remote` 核验；默认分支为 `main`。

**GitLab EE 是否兼容**：✅ 兼容。`git push --all` 或镜像可完整搬迁所有分支。

**JiHu 是否兼容**：✅ 兼容。

**修改建议**：兼容模式只要求 GitHub `main` 单向同步到 GitLab `main`。保留并加固 `sync-to-gitlab.yml`：固定目标项目和分支、使用最小权限凭据、启用并发互斥、同步后核对 SHA，并禁止 GitLab 反向同步或直接修改目标 `main`。如未来确需同步 tag 或其他分支，应显式增加白名单，不使用会意外删除引用的无边界 `--mirror`。

**验证方法**：`git branch -r` 两端分支列表 diff 为空。

**风险等级**：低

**状态**：⚠️ 建议修改（迁移方式调整）

---

### 1.3 Tag（标签）

**当前能力**：仓库存在 `versioning.yml`，配置为在 GitHub Release 发布/编辑时由 `Actions-R-Us/actions-tagger` 维护浮动 tag；当前工作区未获取到 tag，不能据此断言 GitHub 远端已有 tag 或 Release。

**GitLab EE 是否兼容**：✅ Git tag 兼容。`git push --tags` / `--mirror` 可迁移。但 **`actions-tagger` 是 GitHub Action，无 GitLab 等价**，需用 CI 脚本替代（见 [2.18](#218-第三方-action--marketplace-action)）。

**JiHu 是否兼容**：✅ tag 兼容。

**修改建议**：`--mirror` 已含 tag。浮动 tag 逻辑迁到 `.gitlab-ci.yml`：
```yaml
retag-latest:
  stage: release
  rules:
    - if: '$CI_COMMIT_TAG =~ /^v\d+/'
  script:
    - MAJOR=$(echo "$CI_COMMIT_TAG" | cut -d. -f1)
    - git tag -f "$MAJOR" "$CI_COMMIT_TAG"
    - git push -f "https://oauth2:${CI_PUSH_TOKEN}@${CI_SERVER_HOST}/${CI_PROJECT_PATH}.git" "$MAJOR"
```

**验证方法**：`git tag | sort` 两端一致；触发一次 release 验证浮动 tag 更新。

**风险等级**：中（浮动 tag 逻辑需重写）

**状态**：⚠️ 建议修改

---

### 1.4 Protected Branch（保护分支）

**当前能力**：仓库文件无法证明 GitHub Branch Protection 是否已配置，也无法确认 require PR/status check/review 的具体规则；实施前须通过 GitHub Settings 或 API 导出当前规则。

**GitLab EE 是否兼容**：✅ 有对应能力，但**模型不同**：GitLab 为 Project → Settings → Repository → Protected branches，控制项为 `Allowed to push/merge/force push`，并配合 Push Rules（EE）。GitHub 的「require status check」在 GitLab 由 **Merge Request 的 Pipeline must succeed** + **All threads resolved** 设置承担。**保护规则不会随 Git 数据自动迁移，须手工/API 重建。**

**未来 JiHu（未核验）**：历史资料曾判断具备 Protected branches 与基本 Push Rules，但该版本断言已经作废；未来立项时须按目标版本、License 和官方文档逐项确认。

**修改建议**：用 API 重建：
```bash
curl --request POST --header "PRIVATE-TOKEN: $TOKEN" \
  "https://gitlab.example.com/api/v4/projects/$PID/protected_branches" \
  --data "name=main&push_access_level=0&merge_access_level=40&allow_force_push=false"
```
并在 Project → Merge requests 勾选 `Pipelines must succeed`、`All threads must be resolved`。

**验证方法**：非授权用户 `git push origin main` 被拒；未过 pipeline 的 MR 无法合并。

**风险等级**：中

**状态**：⚠️ 建议修改

---

### 1.5 Default Branch（默认分支）

**当前能力**：默认 `main`。

**GitLab EE 是否兼容**：✅ Project → Settings → Repository → Default branch 设置。

**JiHu 是否兼容**：✅ 兼容。

**修改建议**：导入后确认默认分支为 `main`（GitLab 新建空项目默认亦为 `main`，导入时一般保留源默认分支）。
```bash
curl --request PUT --header "PRIVATE-TOKEN: $TOKEN" \
  "https://gitlab.example.com/api/v4/projects/$PID" --data "default_branch=main"
```

**验证方法**：Web 界面仓库首页默认展示 `main`；`git remote show origin` 的 HEAD 指向 main。

**风险等级**：低

**状态**：✅ 无需修改（确认即可）

---

### 1.6 Submodule（子模块）

**当前能力**：本项目**无** `.gitmodules`。

**GitLab EE 是否兼容**：✅（不适用）。若未来引入，GitLab 支持 submodule，但跨主机 submodule URL 需同步改写。

**JiHu 是否兼容**：✅（不适用）。

**修改建议**：无。若日后新增，需将 `.gitmodules` 中 `github.com` URL 改为 GitLab 地址，并确保 CI 中 `GIT_SUBMODULE_STRATEGY: recursive`。

**验证方法**：`test -f .gitmodules && echo has || echo none` → none。

**风险等级**：低

**状态**：✅ 无需修改

---

### 1.7 Git LFS

**当前能力**：本项目**未启用 LFS**（`.gitattributes` 无 `filter=lfs`）。

**GitLab EE 是否兼容**：✅ 支持 LFS（需服务端启用并配置 Object Storage）。

**JiHu 是否兼容**：✅ 支持。

**修改建议**：当前无需处理。若未来启用，迁移须单独 `git lfs fetch --all` + `git lfs push --all`，`--mirror` **不会**自动搬运 LFS 对象。

**验证方法**：`git lfs ls-files` 为空即无需处理。

**风险等级**：低

**状态**：✅ 无需修改

---

### 1.8 Mirror Repository（镜像仓库）

**当前能力**：`sync-to-gitlab.yml` 实为一种「单向 push 镜像」（CI force push main）。

**GitLab EE 是否兼容**：✅ GitLab 原生支持 **Push Mirror / Pull Mirror**（Settings → Repository → Mirroring repositories），比 CI force push 更稳。EE 支持双向。

**未来 JiHu（未核验）**：历史资料曾判断支持 Push/Pull Mirror；未来立项时按目标版本和 License 重新确认。

**修改建议**：长期保持 **GitHub → GitLab 单向同步**，只能选择一个同步执行者：优先沿用并加固 `sync-to-gitlab.yml`；若未来改用 GitLab Pull Mirror，应先停用该 workflow，禁止两条同步链路并存。
- GitHub `main` 是唯一代码主源，所有业务代码变更通过 GitHub PR 合入。
- GitLab `main` 是受保护运行镜像，不接受直接 push/MR 合并，不反向写回 GitHub。
- 同步任务固定源/目标项目与 `main`，使用最小权限 token、并发互斥和 SHA 校验；失败时停止部署 GitLab 新版本，但不影响 GitHub Action。

**验证方法**：镜像状态显示 `successfully`；最后一次同步 commit 与源一致。

**风险等级**：中（force push 或双同步执行者可能覆盖历史，必须固定方向并防止回环）

**状态**：⚠️ 建议修改

---

### 1.9 Fork

**当前能力**：`openai-review.yml` 使用 `pull_request_target`，随后 checkout PR head、执行 PR 中的本地 Action，并注入 `GITHUB_TOKEN` 与 `OPENAI_API_KEY`。这不是普通兼容性问题，而是特权上下文执行不可信代码的 **P0 密钥泄漏风险**；攻击者可通过修改 Action 代码、依赖或脚本读取/外传密钥。该问题独立于 GitLab 迁移，必须先止血。

**GitLab EE 是否兼容**：✅ GitLab 支持 Fork，但**跨平台 fork 关系不迁移**（fork 树需重建）。GitLab 的 fork MR 与 GitHub fork PR 语义一致。

**JiHu 是否兼容**：✅ 兼容。

**修改建议**：
1. 迁移工作开始前立即停用当前危险路径：不得在 `pull_request_target` 中 checkout/执行 PR head；若无法立即完成权限分离，临时禁用该 workflow 或限制为仅处理可信 base-branch 代码。
2. GitHub 过渡期采用两阶段信任分离：无密钥的 `pull_request` job 检查 PR head；需要写评论/密钥的 job 固定执行默认分支代码，并把 PR diff/文件内容仅作为数据读取。
3. GitLab MVP 不接受 fork MR；即使是同项目 MR，MR head 仍按不可信代码处理。Project Webhook 触发 protected `main` 上的 `ai-review-trigger` job，该 job 使用 main 代码并把 MR payload/diff 仅作为数据处理；PAT/OpenAI Key 不进入普通 MR Pipeline。
4. 正式期若开放 fork，仍沿用外部受信任执行面，不在 fork 或 MR 提供的 CI 配置/代码环境中注入业务密钥。

**验证方法**：构造修改 Action、`dist/index.js`、依赖脚本和 `.gitlab-ci.yml` 的恶意 PR/MR，确认这些代码只能进入无业务密钥的 job；secret-bearing reviewer 固定使用默认分支制品，且 fork MR 被拒绝。必须轮换曾进入现有危险 workflow 的 OpenAI Key、验证旧 key 失效，并复核 GitHub token 权限和历史 workflow run。

**风险等级**：**P0 / 严重**

**状态**：⛔ 迁移前必须止血；见 WBS S1–S3

---

### 1.10 Archive（归档）

**当前能力**：GitHub 可将仓库设为只读 Archived。

**GitLab EE 是否兼容**：✅ Project → Settings → General → Advanced → Archive project（只读）。

**JiHu 是否兼容**：✅ 兼容。

**修改建议**：双平台兼容期间 **不得归档 GitHub**，因为 GitHub 是代码主源且 GitHub Action 继续正式运行。只有未来另行批准终止兼容模式时，才重新评估归档任一平台。

**验证方法**：GitHub 保持可正常 PR/merge，GitLab `main` 可运行但拒绝非同步身份直接写入。

**风险等级**：低

**状态**：⏸ 兼容模式不归档任何运行平台

---

### 1.11 Template Repository（模板仓库）

**当前能力**：本项目非模板仓库。

**GitLab EE 是否兼容**：✅ GitLab 用 **Project templates**（实例级/Group 级自定义模板）实现，机制不同但能力对等。

**JiHu 是否兼容**：✅ 兼容。

**修改建议**：不适用。若需要，可在 Group 设置 Custom project templates。

**验证方法**：N/A。

**风险等级**：低

**状态**：✅ 无需修改

---

### 1.12 多包仓库 / Monorepo

**当前能力**：根目录是 AI Reviewer 主包，另有 `tools/review-visualizer/package.json` 独立前端包。当前未声明 npm/pnpm workspace，因此不是标准 workspace monorepo，但也不能按“单体单包”处理。

**GitLab EE 是否兼容**：✅ 支持大仓；EE 有 CI `rules:changes`、`workflow:rules` 做路径触发。

**JiHu 是否兼容**：✅ 兼容。

**修改建议**：MVP 明确只构建/测试根包；`tools/review-visualizer` 暂不进入关键 pipeline。正式期若需要统一管理，再增加 workspace 定义，并用 `rules:changes:paths` 做增量 pipeline。

**验证方法**：N/A。

**风险等级**：低

**状态**：✅ 无需修改

---

### 1.13 Git Attributes

**当前能力**：`.gitattributes` = `dist/** -diff linguist-generated=true`（标记 `dist/` 为生成物、diff 折叠）。

**GitLab EE 是否兼容**：⚠️ 部分兼容。`-diff` 生效；但 **`linguist-generated` 是 GitHub Linguist 专有**，GitLab 语言检测走自身规则，该属性**在 GitLab 无效果**（不影响功能，仅语言统计/diff 折叠表现不同）。

**JiHu 是否兼容**：⚠️ 同 EE，`linguist-generated` 无效。

**修改建议**：保留文件（`-diff` 仍有用）。若需在 GitLab MR 中折叠 `dist/` diff，改用：
```
dist/** -diff
dist/** linguist-generated=true   # GitLab 忽略此行，保留仅为兼容 GitHub 期
```
GitLab 侧可通过 `.gitlab/` 无对应「生成物折叠」精确等价物，接受差异即可。

**验证方法**：MR 中查看 `dist/` 文件 diff 是否折叠（`-diff` 生效）。

**风险等级**：低

**状态**：⚠️ 建议修改（可接受差异，非阻塞）

---

### 1.14 Git Ignore

**当前能力**：`.gitignore`（1943 字节，标准 Node 忽略规则）。

**GitLab EE 是否兼容**：✅ 完全兼容，Git 原生文件，无平台差异。

**JiHu 是否兼容**：✅ 兼容。

**修改建议**：无。

**验证方法**：`git status` 忽略行为一致。

**风险等级**：低

**状态**：✅ 无需修改

---

### 1.15 Git Hooks（服务端钩子）

**当前能力**：本项目**无自定义服务端 hook**（GitHub 不开放服务端 hook；客户端 hook 未纳入版本库）。

**GitLab EE 是否兼容**：✅ GitLab 支持 **Server Hooks**（`custom_hooks/`，需服务器文件系统权限）与 EE **Push Rules**（正则校验 commit message、文件名、防止 secret 等）。

**JiHu 是否兼容**：✅ 支持 Server Hooks 与 Push Rules。

**修改建议**：当前不适用。若需强制 commit 规范，优先用 EE/JiHu 的 **Push Rules**（UI 可配，无需服务器权限）替代脚本 hook。

**验证方法**：N/A（若配置 Push Rules，用违规 commit 验证被拒）。

**风险等级**：低

**状态**：✅ 无需修改

---

## 二、GitHub Actions

> 核心结论：GitHub Actions 与 GitLab CI **没有自动转换器**，需**人工重写为 `.gitlab-ci.yml`**。本项目 4 个 workflow 的语义各不相同，逐一分析。

### 2.1 workflow — `openai-review.yml`

**当前能力**：触发于 `pull_request_target` / `pull_request_review_comment` / `issue_comment`，checkout PR head repo，装 ripgrep，跑 PR 中的本地 Action（`uses: ./`），同时注入 `GITHUB_TOKEN`+`OPENAI_API_KEY`。该组合允许 PR 代码在特权上下文读取密钥，属于需要立即处理的 P0；复杂 `concurrency.group` 与 `cancel-in-progress` 是次要迁移问题。

**GitLab EE 是否兼容**：⚠️ 需重写。差异：
- **本 Action 依赖 GitHub 事件与 GitHub API**（Octokit、review threads、`pull_request_target`）。增加 GitLab 兼容后，GitHub adapter 继续保留，同时新增 GitLab MR API adapter（这是最大工作量，见 [2.17](#217-github-action-的保留与双平台兼容改造)）。
- `concurrency` → GitLab `resource_group` + `interruptible`（语义不完全等价）。
- `issue_comment` 命令交互 → GitLab **MR/Issue comment webhook + Pipeline trigger** 或 GitLab 系统的 note 事件。

**未来 JiHu（未核验）**：预计仍需重写事件和 MR API 适配；具体 CI/MR API 能力不得沿用旧版本断言，须在未来立项时确认。

**修改建议**：见 [1.9](#19-fork) 先完成 GitHub 止血，再按 [2.17](#217-github-action-的保留与双平台兼容改造) 实施 GitLab 信任分离。MR Pipeline 骨架只能包含无业务密钥的验证 job：
```yaml
mr-verify:
  stage: test
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event" && $CI_MERGE_REQUEST_SOURCE_PROJECT_ID == $CI_MERGE_REQUEST_TARGET_PROJECT_ID'
  interruptible: true
  script:
    - npm ci
    - npm test
    - npm run build
```

> 该 job 会执行 MR head，因此**不得拥有**个人 PAT、OpenAI Key、Pipeline Trigger token 或其他业务密钥，也不得产生供高权限 job 直接执行的脚本/可执行制品。AI review 不在 MR Pipeline 内运行：Project Webhook 直接触发 protected `main` 上的 `ai-review-trigger` job；job 从 file-type `TRIGGER_PAYLOAD` 读取事件，通过 GitLab API 获取 MR IID、SHA、diff 与文件内容后调用模型和写 discussion。它不 checkout、`npm install`、运行 MR head，也不消费 MR job 产生的可执行 artifact。

**验证方法**：在 GitLab 提交同时修改 `.gitlab-ci.yml`、`dist/index.js` 和 package scripts 的测试 MR，确认 MR job 环境没有业务密钥；webhook-triggered pipeline 的 `CI_COMMIT_REF_NAME=main` 且代码 SHA 来自 protected `main`，并可完成行级 discussion；日志记录 main commit SHA 和被审查 MR SHA。

**风险等级**：**P0 / 严重（当前 GitHub 暴露）**；高（GitLab 核心业务逻辑改造）

**状态**：⚠️ 建议修改

---

### 2.2 workflow — `combine-prs.yml`

**当前能力**：`workflow_dispatch` 手动触发，用 `actions/github-script` 分页拉 PR、按 `dependabot` 分支前缀合并绿色 PR 到一个组合分支。

**GitLab EE 是否兼容**：⚠️ 需重写。`workflow_dispatch` → GitLab **`workflow: rules` + manual pipeline / trigger with variables**（Run pipeline 带变量）。`github-script`/Octokit → GitLab REST API 脚本。

**JiHu 是否兼容**：⚠️ 同 EE。

**修改建议**：改为 CI 手动 job + `curl` GitLab API 脚本（列 MR、判 pipeline 状态、创建组合分支）。若 combine 仅服务于 Dependabot，可评估用 GitLab **Dependency Proxy + Renovate** 或 GitLab 原生依赖更新替代整套逻辑。

**验证方法**：手动触发 pipeline，验证组合分支生成且仅含绿色 MR。

**风险等级**：中

**状态**：⚠️ 建议修改

---

### 2.3 workflow — `versioning.yml`

**当前能力**：`release: [published, edited]` 触发，`windows-latest`，跑 `Actions-R-Us/actions-tagger@latest` 维护浮动 major tag。

**GitLab EE 是否兼容**：⚠️ 需重写。`release` 事件 → GitLab **Release**（`release` pipeline rule / tag pipeline）。`windows-latest` → 需 Windows Runner（多数场景可改用 Linux，见 [2.11](#211-runs-on--windows-latest)）。第三方 tagger Action 无等价，用脚本替代（见 [1.3](#13-tag标签)）。

**JiHu 是否兼容**：⚠️ 同 EE。

**修改建议**：见 [1.3](#13-tag标签) 的 `retag-latest` job，触发条件改为 `$CI_COMMIT_TAG`。

**验证方法**：打 `v2.1.0` tag，验证 `v2` 浮动 tag 被更新。

**风险等级**：中

**状态**：⚠️ 建议修改

---

### 2.4 workflow — `sync-to-gitlab.yml`

**当前能力**：push main 时 force push 到 gitlab.com。

**GitLab EE 是否兼容**：✅ 此 workflow 是已确认方案的长期代码同步入口之一，不删除；GitLab 不成为代码主源。

**JiHu 是否兼容**：同上。

**修改建议**：保留并加固该文件：只响应 GitHub `main` 的受信任 push；固定 GitLab 项目/ref；使用专用最小权限 token；配置 concurrency；push 后验证两端 SHA；禁止将 GitLab webhook 或 mirror 配成反向写回。若改用 GitLab Pull Mirror，必须先停用此 workflow，确保只有一个同步执行者。

**验证方法**：GitHub `main` 合入后 GitLab `main` 收到同一 SHA；GitLab 直接 push/MR merge 被保护规则拒绝；重复同步幂等；同步失败不会修改 GitHub。

**风险等级**：中（遗留会造成覆盖事故）

**状态**：⚠️ 必须保留并加固（长期单向同步）

---

### 2.5 job

**当前能力**：GitHub `jobs.<id>`，`runs-on`，`needs` 编排。

**GitLab EE / JiHu 是否兼容**：⚠️ 概念对应但语法不同。GitLab job 属于某 `stage`，用 `needs:` 实现 DAG。均支持。

**修改建议**：
```yaml
build:  { stage: build,  script: [npm run build] }
test:   { stage: test,   needs: [build], script: [npm test] }
```

**验证方法**：Pipeline 图显示 job 依赖关系正确。

**风险等级**：低 ｜ **状态**：⚠️ 建议修改

---

### 2.6 step

**当前能力**：GitHub `steps:`（`uses:` / `run:`）。

**GitLab EE / JiHu 是否兼容**：⚠️ GitLab **无 step 级 `uses`**，一个 job 的 `script:` 是命令数组，无内置「组合动作」概念。`uses:` 型步骤须替换为等价命令或 `image` 内工具。

**修改建议**：`uses: actions/checkout` → GitLab 自动 checkout（默认行为）；其它 `uses` 逐个用命令替换。

**验证方法**：job 日志逐命令执行成功。

**风险等级**：中 ｜ **状态**：⚠️ 建议修改

---

### 2.7 matrix

**当前能力**：GitHub `strategy.matrix`。

**GitLab EE / JiHu 是否兼容**：✅ GitLab 支持 `parallel:matrix`。

**修改建议**：
```yaml
test:
  parallel:
    matrix:
      - NODE: ["18", "20", "22"]
  image: node:$NODE
  script: [npm test]
```

**验证方法**：pipeline 生成对应并行 job 数。

**风险等级**：低 ｜ **状态**：⚠️ 建议修改

---

### 2.8 cache

**当前能力**：`actions/cache`（key + path）。本项目 workflow 未显式用 cache（npm 装依赖临时性）。

**GitLab EE / JiHu 是否兼容**：✅ GitLab `cache:` 原生支持（`key` / `paths` / `policy`）。

**修改建议**：
```yaml
cache:
  key: { files: [package-lock.json] }
  paths: [node_modules/, .npm/]
```

**验证方法**：二次 pipeline 命中缓存，日志显示 `Restoring cache`。

**风险等级**：低 ｜ **状态**：⚠️ 建议修改

---

### 2.9 artifact

**当前能力**：`actions/upload-artifact` / `download-artifact`。

**GitLab EE / JiHu 是否兼容**：✅ GitLab `artifacts:` 原生（`paths` / `expire_in` / `reports`），跨 job 自动传递。

**修改建议**：
```yaml
build:
  artifacts:
    paths: [dist/]
    expire_in: 1 week
```

**验证方法**：下游 job 自动获得 `dist/`；UI 可下载。

**风险等级**：低 ｜ **状态**：⚠️ 建议修改

---

### 2.10 secret

**当前能力**：GitHub repo/org secrets：`GITHUB_TOKEN`（自动）、`OPENAI_API_KEY`、`GITLAB_TOKEN`。

**GitLab.com Free / 未来 JiHu 是否兼容**：⚠️ GitLab 支持 **CI/CD Variables**（masked / protected / 支持 Group 级共享），但 Protected Variable 不能解决“MR head 代码与密钥同处一个 job”的信任问题。差异：
- `GITHUB_TOKEN`（自动注入）→ GitLab 自动提供 **`CI_JOB_TOKEN`**（通常不足以完成全部 MR discussion 写操作）；当前 gitlab.com Free MVP 的 protected `main` trigger job 使用短期个人 PAT。Project/Group Access Token 不属于当前 Free 方案。
- Secrets **不随仓库迁移**，须手工/API 重建。
- Protected Variable 默认只对 protected branch/tag 可用；MR Pipeline 只有在 source/target branch 均受保护、属于同一项目且触发者有目标分支权限时才可能访问。普通 feature branch MR 不满足该条件，不能把“Protected”写成 reviewer MR job 获得密钥的方案。

**修改建议**：
- MR Pipeline 只执行 build/test/package，不配置或引用个人 PAT、`OPENAI_API_KEY`、Pipeline Trigger token；该约束同时应用于同项目与 fork MR。
- 个人 PAT、`OPENAI_API_KEY` 设为 Masked + Hidden + Protected CI variables，仅对 protected `main` trigger pipeline 可用；该 pipeline 不得 checkout/执行 MR head 或消费其可执行 artifact。
- Pipeline Trigger token 只配置在 Project Webhook URL，不能作为普通 CI 变量传给 MR Pipeline；定期轮换并记录 owner/到期日。
- reviewer 进程采用环境变量**允许列表**；不得依赖当前仅删除 `OPENAI_API_KEY`/`GITHUB_TOKEN` 的黑名单。
- MVP 将 `enable_shell=false`、`enable_lint_tools=false` 作为 secret-bearing trigger job 的强制配置。

**验证方法**：禁止打印 secret。恶意 MR 同时修改 CI、reviewer、package scripts 和依赖，确认 MR job 环境中业务密钥均为空；protected `main` trigger job 可完成最小 API 调用且日志不含 token；旧 OpenAI Key 已失效；trigger job 的 ref/SHA 来自 main，且 `enable_shell=false`、`enable_lint_tools=false`。

**风险等级**：**P0 / 严重**（令牌语义与代码信任边界）｜ **状态**：⛔ 必须按信任分离方案实施

---

### 2.11 `runs-on` / windows-latest

**当前能力**：`openai-review`/`combine-prs` 用 `ubuntu-latest`，`versioning` 用 **`windows-latest`**。

**GitLab.com Free / 未来 JiHu 是否兼容**：⚠️ GitLab 无与 `windows-latest` 完全相同的默认语义。`ubuntu-latest` → 指定 Linux 容器镜像。当前 `action.yml` runtime 是 Node 24，MVP 统一使用 `node:24`，避免 CI 与打包运行时漂移。tagger 逻辑纯 Git 操作，可改 Linux。

**修改建议**：全部改 Linux runner；用 `tags:` 选择 runner。
```yaml
default:
  image: node:24
```

**验证方法**：所有 job 在 Linux runner 成功；无 Windows 依赖残留。

**风险等级**：中 ｜ **状态**：⚠️ 建议修改

---

### 2.12 environment

**当前能力**：`openai-review.yml` 声明 `permissions`，未用 GitHub Environments（部署环境）。

**GitLab EE / JiHu 是否兼容**：✅ GitLab `environment:` 原生（更强，含 Review App、审批、保护环境）。

**修改建议**：如需部署环境：
```yaml
deploy:
  environment: { name: production, url: https://app.example.com }
```

**验证方法**：GitLab Operate → Environments 出现对应环境。

**风险等级**：低 ｜ **状态**：✅ 无需修改（当前未用）

---

### 2.13 variables

**当前能力**：`combine-prs` 用 `env` + `$GITHUB_ENV` 传变量；`workflow_dispatch.inputs`。

**GitLab EE / JiHu 是否兼容**：✅ GitLab `variables:`（全局/job 级）；`$GITHUB_ENV` 追加变量 → GitLab **`dotenv` artifacts**（`artifacts:reports:dotenv`）。`inputs` → pipeline 变量 / `spec:inputs`（较新版本）。

> ⚠️ `spec:inputs` / `include:inputs` 的可用性取决于届时平台版本。当前 MVP 保守使用 pipeline variables；未来 JiHu 重新核验。

**修改建议**：
```yaml
setvars:
  script: [echo "BRANCH_PREFIX=dependabot" >> build.env]
  artifacts: { reports: { dotenv: build.env } }
```

**验证方法**：下游 job 读到变量值正确。

**风险等级**：中（`spec:inputs` 版本差异）｜ **状态**：❓ 待确认（JiHu inputs 支持度）

---

### 2.14 permissions

**当前能力**：`openai-review.yml` 声明 `contents: read` / `pull-requests: write`（GITHUB_TOKEN 细粒度权限）。

**GitLab EE / JiHu 是否兼容**：⚠️ **无逐权限声明的直接等价**。GitLab 中 job 权限由 **`CI_JOB_TOKEN` 的 scope + Access Token 角色**决定，不能在 YAML 内声明 `pull-requests: write`。需通过 Access Token 角色（如 Developer/Maintainer）授权。

**修改建议**：当前 gitlab.com Free MVP 使用专用测试账号的短期**个人 PAT**（`api` scope），配为 Masked + Hidden + Protected 变量，仅注入 protected `main` trigger pipeline，不进入 MR Pipeline。限定测试账号只加入 `ai-reviewer-test`，设置最短可接受有效期；不要把个人日常账号的长期 PAT 用于自动化。若未来升级 GitLab.com Premium/Ultimate 或迁入支持该能力的自建实例，再切换为 Project Access Token。

**验证方法**：MR 评论 API 调用返回 200/201；越权操作被拒。

**风险等级**：中 ｜ **状态**：⚠️ 建议修改

---

### 2.15 workflow_call / reusable workflow

**当前能力**：本项目**未使用** reusable workflow。

**GitLab EE / JiHu 是否兼容**：✅ GitLab 用 **`include:`**（local/project/remote/template）+ **`extends:`** + **CI components**（EE 较新）实现复用。

> ⚠️ **CI/CD Components Catalog** 的可用性取决于平台版本和套餐。当前 MVP 保守使用 `include:` + `extends:`；未来 JiHu 重新核验。

**修改建议**：不适用。若需要：
```yaml
include:
  - project: 'codes-sentinels/ci-templates'
    file: '/templates/node.yml'
```

**验证方法**：include 的 job 出现在 pipeline。

**风险等级**：低 ｜ **状态**：✅ 无需修改（当前未用）

---

### 2.16 cron

**当前能力**：本项目 workflow **无 `schedule:`（cron）**（`versioning` 由 release 触发）。

**GitLab EE / JiHu 是否兼容**：✅ GitLab **Pipeline Schedules**（UI 配置 cron，非 YAML）。

**修改建议**：不适用。若需要：CI/CD → Schedules → New schedule（`0 2 * * *`）。**注意 cron 定义在 UI/API，不在 `.gitlab-ci.yml`**，迁移时需手工重建。

**验证方法**：Schedules 列表显示下次运行时间；到点触发。

**风险等级**：低 ｜ **状态**：✅ 无需修改（当前未用）

---

### 2.17 GitHub Action 的保留与双平台兼容改造

> 这是本次兼容改造**最高风险、最大工作量**的部分，单列。目标不是删除 GitHub Action，而是抽取共享核心并增加 GitLab 入口。

**当前能力**：本仓库不是普通应用，而是一个 GitHub Action（`action.yml` + `dist/index.js`）。核心逻辑深度依赖 GitHub 事件模型、Action runtime 与 Octokit API：`pull_request_target`、review threads、`issue_comment` 命令、`@actions/core`、`@actions/github`、`@octokit/action`。本次实扫发现 30 个源码文件直接引入 `@actions/core` 或 `@actions/github`，因此改造范围显著大于 47 处 `octokit.*` 调用。

**GitLab EE 是否兼容**：❌ **不能直接运行**。GitLab CI 无 `action.yml` 概念，无 Octokit 事件。要在 GitLab 生态提供同等 AI review 能力，需：
1. 建立平台无关的运行上下文、配置、日志与错误接口，再将 Action 输入/GitHub context 与 GitLab CI/webhook 映射到该接口；
2. 将 Octokit 调用收敛到正式支持的 **GitHub adapter**，并新增以锁定版本的 `@gitbeaker/rest` 为标准客户端的 **GitLab REST/GraphQL adapter**（MR notes、discussions、diff、成员权限）；只有 SDK 未覆盖所需 REST endpoint 或行为不满足契约时，才允许在 GitLab adapter 内使用 Node 24 原生 `fetch`，业务核心不得直接依赖任一平台 payload/API 或 SDK 类型；
3. MR Pipeline 仅做无密钥 build/test/package；Project Webhook 使用 Pipeline Trigger token 调用 GitLab Trigger API，固定 ref 为 protected `main`；
4. `ai-review-trigger` job 读取 file-type `TRIGGER_PAYLOAD`，在 job 内区分 Merge Request Hook 与 Note Hook，校验项目/fork/事件/权限并做 marker 去重；
5. trigger job 使用 protected `main` 当前 commit 的仓库代码和 Node 24 image，仅通过 GitLab API 把 MR diff/文件内容作为数据读取，不 checkout 或执行 MR head；
6. 个人 PAT/OpenAI Key 是 Masked + Hidden + Protected CI variables，仅供 protected `main` trigger pipeline 使用；MVP 强制 `enable_shell=false`、`enable_lint_tools=false`，环境采用允许列表；
7. 禁止 trigger job 执行或加载 MR Pipeline 产生的脚本、依赖、插件或可执行 artifact。
8. 保留 `action.yml`、GitHub Action 入口、Action inputs、Octokit/GraphQL 能力和现有命令语义；安全修复后的 GitHub 路径必须与 GitLab 路径共同进入回归矩阵。
9. 生成两个可追溯构建产物：GitHub Action 入口 `dist/index.js` 与 GitLab trigger CLI `dist/gitlab-trigger/index.js`，二者来自同一 GitHub 主源 commit。

建议将现有单入口 `ncc build` 拆为显式脚本，避免第二次构建覆盖 GitHub Action 产物：

```json
{
  "scripts": {
    "package:github": "ncc build lib/main.js -o dist --license licenses.txt",
    "package:gitlab": "ncc build lib/gitlab-trigger.js -o dist/gitlab-trigger --license licenses-gitlab.txt",
    "package": "npm run package:github && npm run package:gitlab"
  }
}
```

实施时还必须把 `tiktoken_bg.wasm` 等非 JS 运行资产复制到两个入口实际查找的位置，将 `@gitbeaker/rest` 及其传递依赖纳入 GitLab bundle 的 license/供应链检查，并在 CI 中分别执行两个 bundle 的启动冒烟测试；以上脚本是目标设计，当前仓库尚未实现 `lib/gitlab-trigger.js`。

**JiHu 是否兼容**：❌ 同 EE，需同样重构；GitLab/JiHu API 基本一致。

**修改建议**：已确认改造为 GitHub/GitLab 双平台审查工具，按上述 1–9 重构。MVP 仅接受同项目 MR，但所有 PR/MR 内容仍按不可信输入处理；GitLab fork MR 明确拒绝。不得用“同项目受信任分支”替代执行面隔离。

**验证方法**：GitHub PR 在完成 P0 安全修复后继续通过现有输入和命令完成审查；GitLab MR Pipeline 能在无业务密钥环境 build/test/package，trigger pipeline 的 ref/SHA 和 CI 配置来自 protected `main`；同一 fixture 在两个 adapter 上产生语义等价结果；恶意 PR/MR 无法读取密钥或改变受信任执行代码；GitLab fork MR 被拒绝。

**风险等级**：**高**

**状态**：⚠️ 已确认需要改造，按 WBS 实施

---

### 2.18 第三方 Action / Marketplace Action

**当前能力**：`actions/checkout`（官方）、`actions/github-script`（官方）、`Actions-R-Us/actions-tagger@latest`（**第三方 + 浮动 tag**）。

**GitLab EE / JiHu 是否兼容**：❌ **所有 Action 在 GitLab 均无法运行**（无 Action runtime）。逐一映射：

| GitHub Action | GitLab 等价 | 改造方式 |
|---------------|-------------|----------|
| `actions/checkout` | GitLab 内置自动 checkout | GitHub workflow 保留；GitLab CI 无需声明 |
| `actions/github-script`（Octokit）| 无 | GitHub workflow 保留；GitLab adapter 调 GitLab API |
| `Actions-R-Us/actions-tagger`（第三方）| 无 | GitHub 侧先固定版本并评估替换；GitLab 等价能力若启用则用受控脚本（[1.3](#13-tag标签)）|

> ⚠️ `@latest` 浮动 tag 供应链风险高，兼容改造时应收敛为固定版本/SHA 或自控脚本。

**修改建议**：见上表；`glab` CLI 可简化 API 调用。

**验证方法**：GitHub workflow 的 `uses:` 均固定到受控版本/SHA；`.gitlab-ci.yml` 不引用 GitHub Action runtime；启用的等价脚本产出相同结果。

**风险等级**：中 ｜ **状态**：⚠️ 建议修改

---

## 三、CI/CD

> GitHub Actions 的能力已在模块二分析「从 GitHub 视角」并继续保留；本模块从新增 GitLab CI 运行路径逐项确认。

### 3.1 `.gitlab-ci.yml`

**当前能力**：GitHub 用 `.github/workflows/*.yml`（多文件）。GitLab 用**单一 `.gitlab-ci.yml`** 为入口（可 `include` 拆分）。

**GitLab EE 是否兼容**：⚠️ 需新建。GitHub workflow 无法自动转换，须人工编写。

**JiHu 是否兼容**：⚠️ 同 EE。语法基本一致。

**修改建议**：仓库根新建 `.gitlab-ci.yml`：
```yaml
stages: [verify, package, review]
default:
  image: node:24

verify:
  stage: verify
  script: [npm ci, npm run build, npm test]

package:
  stage: package
  needs: [verify]
  script: [npm ci, npm run build, npm run package]
  artifacts:
    paths: [dist/]

# ai-review job 只有在 A1-A6 完成后加入，并通过 rules 拒绝 fork MR。
```

**验证方法**：CI Lint（CI/CD → Editor → Validate）通过；首个 pipeline 绿。

**风险等级**：中 ｜ **状态**：⚠️ 建议修改

---

### 3.2 Pipeline

**当前能力**：GitHub「workflow run」。

**GitLab EE / JiHu**：✅ 对应「Pipeline」，触发源更丰富（push/MR/tag/schedule/api/trigger）。

**修改建议**：用 `workflow:rules` 控制何时创建 pipeline，避免重复（push + MR 双触发）：
```yaml
workflow:
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
    - if: '$CI_COMMIT_BRANCH == "main"'
```

**验证方法**：MR 与 main push 各产生预期 pipeline，无重复。

**风险等级**：低 ｜ **状态**：⚠️ 建议修改

---

### 3.3 Stage

**当前能力**：GitHub 无强 stage 概念（靠 `needs`）。

**GitLab EE / JiHu**：✅ `stages:` 顺序执行，同 stage 并行。

**修改建议**：见 3.1 的 `stages`。

**验证方法**：pipeline 图按 stage 顺序展示。

**风险等级**：低 ｜ **状态**：✅ 无需修改（新体系）

---

### 3.4 Job

同 [2.5](#25-job)。✅ 兼容需重写 ｜ **状态**：⚠️ 建议修改

### 3.5 Cache

同 [2.8](#28-cache)。✅ 原生支持 ｜ **状态**：⚠️ 建议修改

### 3.6 Artifact

同 [2.9](#29-artifact)。✅ 原生支持 ｜ **状态**：⚠️ 建议修改

---

### 3.7 Dependency（job 依赖 / 依赖产物）

**当前能力**：GitHub `needs:` + artifact 传递。

**GitLab EE / JiHu**：✅ `needs:`（DAG）+ `dependencies:`（控制 artifact 下载范围）。

**修改建议**：
```yaml
test: { needs: [build], dependencies: [build] }
```

**验证方法**：job 只下载所需 artifact，日志确认。

**风险等级**：低 ｜ **状态**：⚠️ 建议修改

---

### 3.8 Include

**当前能力**：GitHub reusable workflow（本项目未用）。

**GitLab.com Free（当前）/未来 JiHu**：当前方案只使用实施时在 gitlab.com Free 验证通过的 `include:` 形式；未来 JiHu 的具体支持范围未核验。

**修改建议**：拆分复用 CI 时使用。

**验证方法**：合并后的 pipeline 含 include 内容（CI Editor → View merged YAML）。

**风险等级**：低 ｜ **状态**：✅ 无需修改（当前未用）

---

### 3.9 Child Pipeline / 3.10 Parent Pipeline

**当前能力**：GitHub 无原生父子 pipeline（本项目未用）。

**GitLab EE / JiHu**：✅ `trigger:` + `include`（`strategy: depend`）实现父子 pipeline。均支持。

**修改建议**：monorepo 场景才需要，当前不适用：
```yaml
child:
  trigger: { include: [child-ci.yml], strategy: depend }
```

**验证方法**：父 pipeline 触发子 pipeline 且状态联动。

**风险等级**：低 ｜ **状态**：✅ 无需修改（当前未用）

---

### 3.11 Merge Train

**当前能力**：GitHub 无（GitHub 的 Merge Queue 见 3.12 对照）。

**GitLab EE 是否兼容**：✅ EE **Merge Trains**（Premium/Ultimate 功能）。**依赖 License 分级。**

**JiHu 是否兼容**：⚠️ JiHu 亦按 Premium/Ultimate（专业版/旗舰版）分级，**需确认 JiHu 授权级别**是否含 Merge Trains。功能存在但 gated。

**修改建议**：如需，Project → Settings → Merge requests → Enable merged results pipelines + Merge trains（需相应 License）。本项目当前无强需求，可暂缓。

**验证方法**：连续合并 MR 时形成 merge train 队列。

**风险等级**：中（License 依赖）｜ **状态**：❓ 待确认（License 级别）

---

### 3.12 Merge Queue

**当前能力**：GitHub Merge Queue（若启用；本项目 `combine-prs` 是自制近似，非原生 queue）。

**GitLab EE / JiHu**：⚠️ GitLab **无「Merge Queue」这一名词**，对应能力即 **Merge Trains**（见 3.11）。语义映射非一一对应。

**修改建议**：用 Merge Trains 承接；或保留精简版 combine 脚本。

**验证方法**：同 3.11。

**风险等级**：中 ｜ **状态**：❓ 待确认

---

### 3.13 Environment / 3.14 Deployment / 3.15 Review App

**当前能力**：本项目未做部署（Action 类项目）。

**历史 GitLab EE / 未来 JiHu（未核验）**：历史资料记录了 `environment:`、`on_stop` 和 Review Apps；当前 MVP 不实施，未来使用前须按版本和套餐重新核验，不能沿用旧版本断言。

**修改建议**：当前不适用。若日后部署：
```yaml
review:
  environment: { name: review/$CI_COMMIT_REF_SLUG, on_stop: stop_review }
```

**验证方法**：MR 页出现 Review App 链接，可访问。

**风险等级**：低 ｜ **状态**：✅ 无需修改（当前未用）

---

### 3.16 Runner / 3.17 Docker Runner / 3.18 Shell Runner / 3.19 Kubernetes Runner

**当前能力**：GitHub 用托管 `ubuntu-latest`/`windows-latest`。

**GitLab.com Free / 未来 JiHu**：✅ MVP 使用 gitlab.com 共享 Runner；有额度与排队约束。只有未来自建 GitLab/JiHu 或需要更强隔离时才部署专用 Runner。

**修改建议**：MVP 使用 `node:24` 容器镜像且不配置 runner tags。未来如需专用 Docker Runner，再按新版 token 注册：
```bash
gitlab-runner register --url https://gitlab.example.com \
  --token glrt-xxxx --executor docker --docker-image node:24
```

**验证方法**：Runner 在 Admin/Project → CI/CD → Runners 显示 online；跑通一个 pipeline。

**风险等级**：中（额度/未来自建运维）｜ **状态**：✅ MVP 使用共享 Runner

---

## 四、权限系统

### 4.1 Organization → Group

**当前能力**：GitHub Org `CodesSentinels`。

**GitLab EE / JiHu**：⚠️ 对应 **Group**（支持多级 Subgroup，比 Org 更灵活）。权限模型：Org owner/member → Group **Owner/Maintainer/Developer/Reporter/Guest** 五级角色。**语义不一一对应，需映射。**

**修改建议**：建 Group `codes-sentinels`，制定角色映射表（见 4.5）。

**验证方法**：Group 成员列表与角色符合预期。

**风险等级**：中 ｜ **状态**：⚠️ 建议修改

---

### 4.2 Repository → Project

**当前能力**：GitHub repo 权限（admin/maintain/write/triage/read）。

**GitLab EE / JiHu**：⚠️ Project 继承 Group 角色 + Project 级角色。GitHub 5 档 → GitLab 5 档，但**含义不同**（如 GitLab Maintainer≈GitHub admin）。

**修改建议**：映射表：

| GitHub | GitLab 角色 |
|--------|-------------|
| Admin | Owner / Maintainer |
| Maintain | Maintainer |
| Write | Developer |
| Triage | Reporter |
| Read | Guest / Reporter |

**验证方法**：抽样成员验证可执行操作范围一致。

**风险等级**：中 ｜ **状态**：⚠️ 建议修改

---

### 4.3 Team → Group/Subgroup

**当前能力**：GitHub Teams（嵌套团队 + 权限）。

**GitLab EE / JiHu**：⚠️ 无「Team」独立实体，用 **Subgroup + 成员角色**近似。GitHub team mention（`@org/team`）无直接等价。

**修改建议**：将 Team 建为 Subgroup，成员按角色加入；文档记录 Team→Subgroup 映射。

**验证方法**：Subgroup 成员及继承权限正确。

**风险等级**：中 ｜ **状态**：⚠️ 建议修改

---

### 4.4 Member

**当前能力**：GitHub 用户账号。

**GitLab EE / JiHu**：⚠️ **用户不自动迁移**。需在 GitLab 建号（或 SSO 自动开通），并在导入时做 **user mapping**（email 匹配）。跨平台 email 不一致会导致贡献者关联失败。

**修改建议**：迁移前导出 GitHub 成员+email 清单；GitLab 侧预建账号或配 SSO；导入工具启用 email 映射。

**验证方法**：Issue/MR/commit 作者正确关联到 GitLab 用户，非 `Ghost User`。

**风险等级**：**高**（映射错误影响历史归属）｜ **状态**：⚠️ 建议修改

---

### 4.5 Permission

见 4.1–4.4 综合。**状态**：⚠️ 建议修改

---

### 4.6 Protected Branch

见 [1.4](#14-protected-branch保护分支)。**状态**：⚠️ 建议修改

---

### 4.7 Protected Tag

**当前能力**：GitHub 用 branch/tag protection rules（tag 保护较弱）。

**GitLab EE / JiHu**：✅ **Protected Tags**（Settings → Repository → Protected tags），可按通配符（`v*`）限制谁能建/删 tag。

**修改建议**：
```bash
curl --request POST --header "PRIVATE-TOKEN: $TOKEN" \
  "$API/projects/$PID/protected_tags" --data "name=v*&create_access_level=40"
```

**验证方法**：非授权用户推 `v*` tag 被拒。

**风险等级**：低 ｜ **状态**：⚠️ 建议修改

---

### 4.8 Approval Rule

**当前能力**：GitHub PR required reviewers / required approvals。

**GitLab.com Free 是否兼容**：⚠️ Free 用户可以做可选 approval，但 approval 不阻止合并；强制审批数量、审批人规则和 Code Owner approval 需要 Premium/Ultimate。

**未来 JiHu 注意事项**：按届时版本和 License 重新确认。

**修改建议**：当前 Free 仅把 approval 作为人工审查信号，不作为强制门禁；用 Protected Branch、Pipelines must succeed 和 All threads resolved 近似约束。升级 Premium/Ultimate 后才配置强制 Approval Rule。

**验证方法**：Free 下验证未 approval 仍可合并，但未通过 pipeline 或仍有 unresolved thread 时不可合并，并把该功能缺口纳入验收签字。

**风险等级**：中（License）｜ **状态**：⚠️ Free 存在功能缺口，已确认

---

### 4.9 CODEOWNERS

**当前能力**：本项目**未发现 CODEOWNERS 文件**。

**GitLab.com Free 是否兼容**：❌ Code Owners 属于 Premium/Ultimate；当前 Free 不能把“文件可识别但不强制”作为可用能力。

**未来 JiHu 注意事项**：按届时版本和 License 重新确认。

**修改建议**：当前不适用。若引入，注意 GitLab CODEOWNERS 用 GitLab 用户名/Group（`@codes-sentinels/team`），非 GitHub handle。

**验证方法**：当前不适用；升级套餐并引入 CODEOWNERS 后再验证 owner 识别与强制审批。

**风险等级**：低 ｜ **状态**：✅ 无需修改（当前未用）

---

## 五、Issue

### 5.1 Issue

**当前能力**：GitHub Issues。

**GitLab EE / JiHu**：✅ GitLab Issues 对等。可用 **GitHub Importer** 或 **Direct Transfer** 迁移，保留标题/正文/作者/时间。

**修改建议**：用 GitLab 内置 GitHub 导入（见 [模块十七](#十七迁移工具)）。注意**跨引用（#123）编号可能变化**，导入器会尽量重写引用。

**验证方法**：Issue 数量、状态（open/closed）、正文一致；抽样核对。

**风险等级**：中 ｜ **状态**：⚠️ 建议修改

---

### 5.2 Comment

**当前能力**：Issue/PR 评论。

**GitLab EE / JiHu**：✅ 迁移为 GitLab notes。作者映射依赖 user mapping（见 4.4）。

**修改建议**：导入时确保成员已建号；否则归入导入者名下并加「originally by @x」前缀。

**验证方法**：评论顺序、作者、时间抽样一致。

**风险等级**：中 ｜ **状态**：⚠️ 建议修改

---

### 5.3 Label

**当前能力**：GitHub labels（颜色 + 名称）。

**GitLab EE / JiHu**：✅ GitLab Labels（Project 级 + Group 级，支持 scoped label `key::value` 为 EE 特性）。导入器迁移基础 label。

**修改建议**：基础 label 自动迁移；可选升级为 scoped labels（`status::in-progress`，EE/JiHu 均支持）。

**验证方法**：label 名称、颜色、关联 issue 一致。

**风险等级**：低 ｜ **状态**：⚠️ 建议修改

---

### 5.4 Milestone

**当前能力**：GitHub Milestones（含到期日、进度）。

**GitLab EE / JiHu**：✅ Milestones（Project + Group 级）。导入器支持。

**修改建议**：确认导入后里程碑的 due date 与关联 issue 数正确。

**验证方法**：milestone 列表 + 进度条与 GitHub 对照。

**风险等级**：低 ｜ **状态**：⚠️ 建议修改

---

### 5.5 Project（看板）

**当前能力**：GitHub Projects（新版 Projects v2 / 经典 Projects）。

**GitLab EE / JiHu**：⚠️ 对应 **Issue Boards**，但 **GitHub Projects v2 的自定义字段/视图不自动迁移**（导入器一般不含 Projects v2）。需手工重建看板。

**修改建议**：手工在 GitLab 建 Issue Board（按 label 分列）。Projects v2 数据需 API 手动导出后映射，或接受不迁移。

**验证方法**：Board 列与卡片布局符合预期。

**风险等级**：中（自定义数据丢失）｜ **状态**：❓ 待确认（是否用 Projects v2）

---

### 5.6 Roadmap

**当前能力**：GitHub 无原生 Roadmap（靠 Projects）。

**GitLab EE 是否兼容**：✅ **Roadmap**（基于 Epic，**Premium/Ultimate gated**，Group 级）。

**未来 JiHu（未核验）**：Roadmap 是否可用取决于届时版本和 License，当前不作兼容承诺。

**修改建议**：迁移后如需，用 Epic + Roadmap 重建。数据无法从 GitHub 直迁。

**验证方法**：Group → Roadmap 展示 Epic 时间线。

**风险等级**：低 ｜ **状态**：❓ 待确认（License + 是否需要）

---

### 5.7 Assignee

**当前能力**：GitHub issue assignee。

**GitLab EE / JiHu**：✅ 支持 assignee（EE 支持多 assignee）。依赖 user mapping。

**修改建议**：确保成员已映射，否则 assignee 丢失。

**验证方法**：抽样 issue 的 assignee 正确。

**风险等级**：中 ｜ **状态**：⚠️ 建议修改

---

### 5.8 Mention

**当前能力**：`@user` / `@org/team` mention。

**GitLab EE / JiHu**：⚠️ `@user` 兼容（需用户名映射）；`@org/team` → `@group`。**历史评论里的旧 mention 文本不会自动改写用户名**，可能失效。

**修改建议**：接受历史 mention 文本原样；新评论使用 GitLab 用户名。

**验证方法**：新 `@user` 能触发通知。

**风险等级**：低 ｜ **状态**：⚠️ 建议修改

---

### 5.9 Template（Issue 模板）

**当前能力**：`.github/ISSUE_TEMPLATE/`（本项目未发现，需确认）。

**GitLab EE / JiHu**：⚠️ GitLab 用 **`.gitlab/issue_templates/*.md`**，路径与格式不同，**不自动转换**。

**修改建议**：若有 GitHub 模板，移动并改名：
```
.github/ISSUE_TEMPLATE/bug.md → .gitlab/issue_templates/Bug.md
```

**验证方法**：新建 Issue 时下拉出现模板。

**风险等级**：低 ｜ **状态**：❓ 待确认（是否有 issue 模板）

---

## 六、Pull Request → Merge Request

### 6.1 Pull Request → Merge Request

**当前能力**：GitHub PR。

**GitLab EE / JiHu**：✅ 对应 **Merge Request**。**已合并/已关闭 PR 可由导入器迁移为 MR**（含 diff、评论）；但**开放中的 PR 迁移后需重新验证分支状态**。

**修改建议**：用导入器；迁移窗口尽量减少 open PR（先合或先关）。

**验证方法**：MR 列表数量、状态、diff 与 GitHub 对照。

**风险等级**：中 ｜ **状态**：⚠️ 建议修改

---

### 6.2 Draft

**当前能力**：GitHub Draft PR。

**GitLab EE / JiHu**：✅ **Draft MR**（标题前缀 `Draft:`）。导入的 draft 状态一般保留。

**修改建议**：无特殊；确认 draft 标记保留。

**验证方法**：draft MR 无法合并且有标记。

**风险等级**：低 ｜ **状态**：✅ 无需修改

---

### 6.3 Review / 6.4 Approve / 6.5 Dismiss Review

**当前能力**：GitHub review（approve/request changes/comment）、dismiss。

**GitLab EE / JiHu**：⚠️ **Review 历史通常不完整迁移**（导入器对 review 状态支持有限）。GitLab 有 Approve；Request changes 语义用「unresolved threads / blocking」近似。Dismiss → 重置 approval。

**修改建议**：接受历史 review 状态可能丢失（评论文本一般在）；新流程用 GitLab Approvals + threads。

**验证方法**：新 MR 上 approve/reset 流程正常。

**风险等级**：中（历史 review 丢失）｜ **状态**：⚠️ 建议修改

---

### 6.6 Requested Reviewer

**当前能力**：GitHub 请求指定 reviewer。

**GitLab EE / JiHu**：✅ MR **Reviewers** 字段（较新版本），依赖 user mapping。

**修改建议**：新 MR 用 Reviewers；历史请求关系可能不迁移。

**验证方法**：可指定 reviewer 并收到通知。

**风险等级**：低 ｜ **状态**：⚠️ 建议修改

---

### 6.7 Auto Merge

**当前能力**：GitHub auto-merge（满足条件自动合并）。

**历史 GitLab EE / 未来 JiHu（未核验）**：Auto-merge 的名称、行为和套餐可能随版本变化；当前 MVP 不依赖该能力，未来使用前重新核验。

**修改建议**：MR 页勾选 Auto-merge。

**验证方法**：pipeline 绿后 MR 自动合并。

**风险等级**：低 ｜ **状态**：✅ 无需修改

---

### 6.8 Squash Merge / 6.9 Rebase Merge / 6.10 Merge Commit

**当前能力**：GitHub 三种合并策略。

**GitLab EE / JiHu**：✅ 全支持。**Squash**（MR 勾选）、**Fast-forward/Rebase**（Settings → Merge method → Fast-forward）、**Merge commit**（默认）。

> ⚠️ GitLab 的合并方式是 **Project 级设置**（Merge method: Merge commit / Merge commit with semi-linear / Fast-forward），与 GitHub 的「每次 PR 选择」略不同。

**修改建议**：Settings → Merge requests → Merge method 按团队习惯设定；Squash 可设为 default/opt-in。

**验证方法**：各策略合并后 commit 历史形态符合预期。

**风险等级**：低 ｜ **状态**：⚠️ 建议修改（设置项对齐）

---

## 七、Release

### 7.1 Release

**当前能力**：GitHub Releases（`versioning.yml` 监听 release 事件）。

**GitLab EE / JiHu**：✅ GitLab **Releases**（关联 tag + release notes + assets + evidence）。**GitHub Release 由导入器迁移**，但需核对 assets。

**修改建议**：导入器迁移 release；CI 中用 `release:` 关键字或 `release-cli` 自动建 release：
```yaml
release_job:
  rules: [{ if: '$CI_COMMIT_TAG' }]
  script: [echo release]
  release: { tag_name: '$CI_COMMIT_TAG', description: 'Release $CI_COMMIT_TAG' }
```

**验证方法**：Deployments → Releases 列表与 GitHub 对照。

**风险等级**：中 ｜ **状态**：⚠️ 建议修改

---

### 7.2 Tag

见 [1.3](#13-tag标签)。**状态**：⚠️ 建议修改

---

### 7.3 Binary / 7.4 Asset

**当前能力**：GitHub Release 附带二进制 asset。

**GitLab EE / JiHu**：⚠️ GitLab Release 的 asset 是**链接**（links），大文件应存 **Package Registry / Generic Package**，Release 再挂链接。**GitHub 上传的二进制 asset 不一定被导入器自动搬运，需手工迁移大文件。**

**修改建议**：手工下载 GitHub release assets → 上传到 GitLab Generic Package → Release 挂 link：
```bash
curl --header "PRIVATE-TOKEN: $TOKEN" --upload-file ./app.tar.gz \
  "$API/projects/$PID/packages/generic/app/1.0.0/app.tar.gz"
```

**验证方法**：Release 页 asset 可下载且校验和一致。

**风险等级**：中 ｜ **状态**：❓ 待确认（是否有二进制 asset）

---

### 7.5 Release Note

**当前能力**：GitHub release notes（含自动生成）。

**GitLab EE / JiHu**：✅ Release description（Markdown）。GitLab 支持从 tag message / MR 自动生成 changelog（`changelog` API）。

**修改建议**：迁移文本；可选启用 GitLab Changelog（`.gitlab/changelog_config.yml`）。

**验证方法**：release note 内容一致。

**风险等级**：低 ｜ **状态**：⚠️ 建议修改

---

## 八、Packages

> 本项目为私有 Action，`package.json` 标 `"private": true`，**当前未发布到任何 registry**（需确认）。

### 8.1 Container Registry

**当前能力**：GitHub Container Registry（ghcr.io）——本项目未发现使用。

**GitLab EE / JiHu**：✅ 内置 **Container Registry**（需服务端启用 + Object Storage）。镜像**不自动迁移**，需 `docker pull` ghcr → `docker push` GitLab registry。

**修改建议**：
```bash
docker pull ghcr.io/codessentinels/img:tag
docker tag ... registry.gitlab.example.com/codes-sentinels/ai-reviewer/img:tag
docker push registry.gitlab.example.com/codes-sentinels/ai-reviewer/img:tag
```

**验证方法**：GitLab Registry 显示镜像；可 pull。

**风险等级**：中 ｜ **状态**：❓ 待确认（是否用容器镜像）

---

### 8.2 Package Registry（npm / Maven / PyPI / NuGet / Composer）

**当前能力**：本项目 `private: true`，**未发布 npm 包**（需确认）。

**GitLab EE / JiHu**：✅ 内置 **Package Registry** 支持 npm/Maven/PyPI/NuGet/Composer/Generic 等。**已发布包不自动迁移**，需重新发布或脚本搬运。

**修改建议**：若用 GitHub Packages，逐类型重新发布到 GitLab：
```bash
# npm 示例
npm config set @codes-sentinels:registry https://gitlab.example.com/api/v4/projects/$PID/packages/npm/
npm publish
```

**验证方法**：`npm install @scope/pkg` 从 GitLab 成功拉取。

**风险等级**：中 ｜ **状态**：❓ 待确认（是否发布包）

---

## 九、Security

> GitHub 原生安全能力与 GitLab **机制完全不同**，是「重建」而非「迁移」。多数 GitLab 安全扫描为 **Ultimate gated**。

### 9.1 Secret（Secrets 管理）

见 [2.10](#210-secret) + [模块十一](#十一api)。**状态**：⚠️ 建议修改

---

### 9.2 Dependabot

**当前能力**：确认没有 `.github/dependabot.yml`；`combine-prs.yml` 的默认 `dependabot` 分支前缀只是手动组合工具配置，不代表已启用 Dependabot。

**GitLab EE / JiHu**：❌ **无 Dependabot**。对应能力：
- **Dependency Scanning**（Ultimate，报告漏洞依赖）；
- **依赖自动升级** → 用 **Renovate**（自建 bot）或 GitLab 的依赖更新（有限）。

**修改建议**：MVP 不引入 Renovate，也不迁移 combine workflow；正式阶段若确有依赖自动升级需求，再单独评估 Renovate。

**验证方法**：MVP 确认没有自动依赖更新 job；正式引入后再验证 Renovate MR。

**风险等级**：低 ｜ **状态**：✅ MVP 不适用

---

### 9.3 CodeQL

**当前能力**：GitHub CodeQL（若启用；本项目未发现 codeql workflow）。

**GitLab.com Free / 未来 JiHu**：❌ 无 CodeQL。GitLab SAST 的 analyzer、报告、MR widget 与门禁能力必须按具体套餐逐项核对，不能概括为“Free 扫描 job 都可跑、只是没有面板”。

**修改建议**：MVP 已排除安全扫描。正式期先核对当时套餐文档，再决定使用 GitLab 模板或独立开源扫描 job。

**验证方法**：正式启用后分别验证 analyzer 是否运行、artifact 是否生成、MR widget/门禁是否对当前套餐可见。

**风险等级**：低 ｜ **状态**：❓ 待确认（是否用 CodeQL）

---

### 9.4 Secret Scan

**当前能力**：GitHub Secret Scanning（若启用）。

**GitLab.com Free / 未来 JiHu**：⚠️ Secret Detection 包含不同机制，各机制套餐要求并不相同；pipeline secret detection、push protection 和响应能力必须分别核对当前官方文档。

**修改建议**：MVP 不启用；正式期按套餐选择可用机制，不假设 include 模板在 Free 下提供完整 pipeline 扫描和 MR 展示。

**验证方法**：提交含假 token 的分支，扫描告警。

**风险等级**：低 ｜ **状态**：⚠️ 建议修改

---

### 9.5 SAST / 9.6 DAST / 9.7 License Scan / 9.8 Container Scan

**当前能力**：GitHub 无原生 DAST/License（靠 Marketplace）；本项目未发现。

**GitLab.com Free / 未来 JiHu**：⚠️ 各扫描器、报告解析、MR widget 和合规门禁的套餐不同，必须逐项核验；模板存在不等于当前 Free 套餐获得完整功能。

**修改建议**：MVP 不执行。正式期确认套餐后再按需 include，以下仅为语法示意，不是当前交付：
```yaml
include:
  - template: Security/SAST.gitlab-ci.yml
  - template: Security/Container-Scanning.gitlab-ci.yml
  - template: Security/DAST.gitlab-ci.yml
  - template: Security/License-Scanning.gitlab-ci.yml
```

**验证方法**：正式启用后验证 analyzer、artifact、MR 展示和门禁各自符合所购套餐；MVP 不执行。

**风险等级**：低（MVP）/ 中（正式期 License 依赖）｜ **状态**：⏸ MVP 不实施

---

## 十、Webhook

### 10.1 事件映射

**当前能力**：GitHub webhook（push/PR/issue/...）。

**GitLab EE / JiHu**：⚠️ 有对应事件，但**事件名与 payload 结构不同**，**webhook 不随仓库迁移，须重建**。

| GitHub 事件 | GitLab 事件 |
|-------------|-------------|
| Push | Push Hook |
| Pull Request | Merge Request Hook |
| Issues | Issue Hook |
| workflow_run / check | Pipeline Hook / Job Hook |
| Release | Release Hook |
| Deployment | Deployment Hook |

**修改建议**：Settings → Webhooks 重建，勾选对应事件；**接收端解析逻辑需适配 GitLab payload**（字段名如 `object_kind`、`object_attributes`）。

**验证方法**：Webhook「Test」发送 + 接收端 200；实际事件触发验证。

**风险等级**：中 ｜ **状态**：⚠️ 建议修改

---

### 10.2 Webhook Payload 是否一致

**当前能力**：GitHub payload 结构（`action`、`pull_request`、`repository`...）。

**GitLab EE / JiHu**：❌ **不一致**。GitLab 用 `object_kind`、`object_attributes`、`project`、`user` 等。**GitLab 入口必须新增 payload 适配，GitHub payload 实现继续保留。**本项目 AI Reviewer 是事件 payload 的重度消费者（见 [2.17](#217-github-action-的保留与双平台兼容改造)）。

**修改建议**：为每类事件编写 GitLab payload 适配层；参考 GitLab Webhook 文档字段。

**验证方法**：对每种事件抓取真实 payload，单测覆盖字段映射。

**风险等级**：**高** ｜ **状态**：⚠️ 建议修改

---

<a id="mvp-trigger"></a>

### 10.3 MVP GitLab Webhook → Pipeline Trigger（评论命令必需）

**当前能力**：GitHub Actions 会直接为 PR 更新、`issue_comment` / `pull_request_review_comment` 创建 workflow run；GitLab Note Hook 本身不会创建 MR Pipeline，但 GitLab 官方支持让 Project Webhook 直接调用 Pipeline Trigger API，并把原始 payload 作为 file-type `TRIGGER_PAYLOAD` 交给 job。

**MVP 目标架构（已确认使用 GitLab 自带 Runner，无外部基础设施）**：

1. 在项目中创建专用 Pipeline Trigger token；Project Webhook URL 使用 GitLab 官方 webhook trigger 形式，目标 project 为 `ai-reviewer-test`，固定 ref 为 protected `main`：`https://gitlab.com/api/v4/projects/<project_id>/ref/main/trigger/pipeline?token=<trigger_token>`；
2. Webhook 勾选 Merge request events 与 Comments；两类事件都会创建 `CI_PIPELINE_SOURCE=trigger` 的 main pipeline；
3. `.gitlab-ci.yml` 中 `ai-review-trigger` 只匹配 trigger pipeline，使用 Node 24，在 protected `main` checkout 上运行；原始 payload 从 `$TRIGGER_PAYLOAD` 文件读取；
4. job 首先校验 project ID、事件类型和 source/target project ID。拒绝 fork；MR Hook 只在 MR 创建、重新打开或 HEAD SHA 变化时继续，其他元数据 update 成功退出且不调用模型；
5. Note Hook 只处理 `noteable_type=MergeRequest`、`object_attributes.action=create` 且严格命中命令语法的用户 note；忽略 system note、PAT 账号自己的 note、编辑事件和普通文本；
6. job 使用 GitLab API 按 user ID 读取 access level，按 [0.7](#07-mvp-运行契约实施时不得降级) 执行权限矩阵；查询失败时 fail closed；
7. MVP 使用全局 `resource_group: ai-reviewer-mvp` 将所有 `ai-review-trigger` job 串行化。自动 review 前检查 summary note 的 reviewed SHA；命令执行前检查 event/note ID marker；成功后写 marker，重复事件直接退出；
8. 写 note/discussion 前重新读取 MR 当前 HEAD SHA；与 payload SHA 不一致则退出，不发布旧结果；
9. PAT/OpenAI Key 为 Masked + Hidden + Protected variables，只在 protected `main` trigger pipeline 可用。Trigger token 只存在于 Project Webhook URL；普通 MR Pipeline 不可访问这些密钥；
10. job 强制 `enable_shell=false`、`enable_lint_tools=false`，不得 checkout MR head、运行 MR 脚本、安装 MR 依赖或消费 MR Pipeline 的可执行 artifact；
11. GitLab pipeline/job 自身作为任务运行记录；失败通过 GitLab UI 手工 retry。MVP 不建设外部队列、数据库、自动失败重放、持久化限流或预算系统。

CI 目标骨架：

```yaml
ai-review-trigger:
  stage: review
  image: node:24
  rules:
    - if: '$CI_PIPELINE_SOURCE == "trigger" && $CI_COMMIT_REF_PROTECTED == "true" && $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH'
  resource_group: ai-reviewer-mvp
  interruptible: true
  variables:
    ENABLE_SHELL: "false"
    ENABLE_LINT_TOOLS: "false"
  script:
    - node dist/gitlab-trigger/index.js "$TRIGGER_PAYLOAD"
```

> 变量名和 CLI 路径以 A1/A5 实际实现为准。job 必须在应用层再次校验 payload project ID 和 MR source/target project ID；不能只依赖 webhook 配置或 CI `rules`。

**安全边界**：trigger pipeline 的 Git ref、CI 配置和可执行代码必须来自 protected `main`，MR 内容只作为 API 数据读取。Trigger token、PAT、OpenAI Key 分别管理和轮换；任何普通 MR Pipeline 都不得获得它们。

**验证方法**：MR/Note Hook 能创建 main trigger pipeline，`TRIGGER_PAYLOAD` 可读取；普通 MR Pipeline 无业务密钥；重复 Hook 只产生一次业务响应；编辑评论、bot/system note 和 MR 元数据更新不调用模型；非目标项目、fork MR 和权限不足命令被忽略/拒绝；连续推送两个 SHA 时旧 pipeline 即使运行也不写旧评论；恶意 MR 修改 CI、reviewer、依赖和脚本不能改变 main trigger job 的执行代码。

**风险等级**：**高** ｜ **状态**：⚠️ MVP 必做

---

## 十一、API

### 11.1 REST API

**当前能力**：项目用 `@octokit/action` 调 GitHub REST API（v3）。

**GitLab.com Free / 未来 JiHu**：❌ 端点/字段完全不同（`/repos/{owner}/{repo}/...` → `/projects/{id}/...`），所有业务 API 调用需重写。当前只以 gitlab.com 实际 API 为 MVP 契约；未来 JiHu 启动时再跑契约测试，不提前假设版本兼容。

**修改建议**：抽象业务平台接口，GitLab adapter 使用锁定版本的 `@gitbeaker/rest` 作为标准 REST 客户端，并通过统一 client factory 注入受信任的 host、PAT 和 timeout。仅当 SDK 未覆盖所需 REST endpoint 或行为无法满足契约时，允许在 adapter/客户端层使用 Node 24 原生 `fetch` 作为受控 fallback；fallback 必须复用认证、超时、脱敏、分页、重试和错误规范化逻辑。`@gitbeaker/rest` 的实例、请求/响应类型和错误类型不得泄露到 `IGitPlatform` 或共享业务核心。用真实 gitlab.com 测试项目做契约测试。

**验证方法**：契约测试覆盖所用端点、自定义 host、PAT 注入、timeout、分页、snake_case 响应、429/5xx、401/403、404/409、网络错误和日志脱敏；架构测试阻止共享核心导入 `@gitbeaker/rest` 或直接调用 GitLab `fetch`。

**风险等级**：**高** ｜ **状态**：⚠️ 建议修改

---

### 11.2 GraphQL

**当前能力**：项目用 GitHub GraphQL 做 `resolveReviewThread`（见 action.yml 注释）等。

**GitLab.com Free / 未来 JiHu**：⚠️ GitLab GraphQL schema 与 GitHub 完全不同；discussion resolve 可优先采用当前稳定的 GitLab REST/GraphQL 能力。未来 JiHu 通过契约测试确认，不以旧的 18.2 schema 预先限制当前实现。

**修改建议**：重写 GraphQL 查询/mutation 为 GitLab schema（如 `discussionToggleResolve`）。

**验证方法**：resolve/unresolve discussion 在 GitLab MR 生效。

**风险等级**：**高** ｜ **状态**：⚠️ 建议修改

---

### 11.3 Webhook API

见 [模块十](#十webhook)。**状态**：⚠️ 建议修改

---

### 11.4 OAuth

**当前能力**：GitHub OAuth App（若用于登录/授权）。

**GitLab EE / JiHu**：✅ GitLab OAuth Applications（Instance/Group/User 级），流程兼容 OAuth2 标准，但 **client id/secret 与回调需重建**。

**修改建议**：GitLab Admin → Applications 建 OAuth App，更新 client 配置与回调 URL。

**验证方法**：OAuth 授权登录成功拿到 token。

**风险等级**：中 ｜ **状态**：❓ 待确认（是否用 OAuth）

---

### 11.5 PAT（个人访问令牌）

**当前能力**：GitHub PAT（classic / fine-grained）。

**GitLab EE / JiHu**：✅ **Personal Access Token**（scopes：`api`/`read_repo`/`write_repo` 等）。**令牌不迁移，须新建。**

**修改建议**：为每个自动化场景新建对应 scope 的 PAT；轮换旧 GitHub PAT。

**验证方法**：用新 PAT 调 API/克隆成功。

**风险等级**：中 ｜ **状态**：⚠️ 建议修改

---

### 11.6 Deploy Token

**当前能力**：GitHub deploy keys（只读/读写 SSH key）。

**GitLab EE / JiHu**：✅ **Deploy Tokens**（HTTPS，可访问 repo/registry/package）+ **Deploy Keys**（SSH）。二者略有差异。

**修改建议**：只读克隆用 Deploy Key（SSH）或 Deploy Token；registry 拉取用 Deploy Token。

**验证方法**：用 deploy token/key 克隆/拉取成功且权限受限。

**风险等级**：低 ｜ **状态**：⚠️ 建议修改

---

### 11.7 Project Token / 11.8 Group Token

**当前能力**：GitHub 无直接等价（GitHub App / fine-grained PAT 近似）。

**GitLab.com Free / 未来自建 GitLab**：⚠️ Project/Group Access Token 可绑定项目/组机器人身份，但 **gitlab.com 上需要 Premium/Ultimate，当前 Free MVP 不可作为前提**。自建 GitLab 的可用性取决于实例配置和版本。

**修改建议**：当前使用专用测试账号的短期个人 PAT。未来升级 GitLab.com 套餐或迁入支持该能力的自建实例后，再切换到 Project Access Token（`api` scope + 最低可用角色）。

**验证方法**：用该 token 评论 MR 成功；过期策略生效。

**风险等级**：中 ｜ **状态**：⏸ 当前 Free MVP 不适用；未来阶段确认

---

## 十二、SSO

> SSO 是**实例级/Group 级配置**，与仓库数据无关；**须在搭建 GitLab 时同步规划**，否则用户无法登录。

### 12.1 LDAP

**当前能力**：GitHub EE 可接 LDAP（github.com SaaS 不支持 LDAP，用 SSO/SCIM）。

**GitLab EE 是否兼容**：✅ 内置 LDAP 集成（`gitlab.rb` 配置），支持用户同步、Group 同步。

**JiHu 是否兼容**：✅ 支持 LDAP，且对国内 AD 兼容性良好。

**修改建议**：`/etc/gitlab/gitlab.rb`：
```ruby
gitlab_rails['ldap_enabled'] = true
gitlab_rails['ldap_servers'] = { 'main' => { 'host' => 'ldap.example.com', 'base' => 'dc=example,dc=com', ... } }
```
`gitlab-ctl reconfigure`。

**验证方法**：LDAP 账号登录成功；Group 成员按 LDAP 同步。

**风险等级**：中 ｜ **状态**：❓ 待确认（是否用 LDAP）

---

### 12.2 SAML

**当前能力**：GitHub Org SAML SSO（若用）。

**GitLab EE / JiHu**：✅ 支持 SAML（Instance 或 Group SAML）。**IdP 配置需重建**（entity id、ACS URL、证书）。

**修改建议**：`gitlab.rb` 配 `omniauth` + `saml`；IdP 侧添加 GitLab 为 SP。

**验证方法**：SAML 登录跳转 IdP 并成功回跳建立会话。

**风险等级**：中 ｜ **状态**：❓ 待确认（是否用 SAML）

---

### 12.3 OIDC / 12.4 OAuth

**当前能力**：GitHub 作为 OAuth/OIDC provider 或 consumer。

**GitLab EE / JiHu**：✅ 支持 OIDC/OAuth（作为 provider 与 client）。配置需重建。

**修改建议**：`omniauth_providers` 配置 OIDC/OAuth；更新回调 URL。

**验证方法**：OIDC 登录成功；token 校验通过。

**风险等级**：中 ｜ **状态**：❓ 待确认

---

### 12.5 2FA

**当前能力**：GitHub 2FA（TOTP/WebAuthn），可 Org 强制。

**GitLab EE / JiHu**：✅ 支持 2FA（TOTP/WebAuthn），可 Instance/Group 强制。**用户的 2FA 密钥不迁移，需重新绑定。**

**修改建议**：Group → Settings → 强制 2FA；通知用户迁移后重新绑定。

**验证方法**：开启后无 2FA 用户被要求绑定。

**风险等级**：中（用户体感）｜ **状态**：⚠️ 建议修改

---

### 12.6 SCIM

**当前能力**：GitHub Org SCIM 自动开号（Enterprise + SAML）。

**GitLab EE 是否兼容**：✅ SCIM（Group SAML SCIM，**Premium/Ultimate gated**，SaaS 与自建配置不同）。

**JiHu 是否兼容**：⚠️ SCIM 支持依 License；需确认 JiHu 旗舰版及自建 SCIM 支持度。

**修改建议**：如需自动开号，配 SCIM token + IdP 推送。否则用 LDAP 同步替代。

**验证方法**：IdP 新增用户后 GitLab 自动创建账号。

**风险等级**：中 ｜ **状态**：❓ 待确认（License + 是否用 SCIM）

---

## 十三、通知

### 13.1 Email

**当前能力**：GitHub 事件邮件通知。

**GitLab EE / JiHu**：✅ 内置邮件通知（需配 SMTP）。**须在 `gitlab.rb` 配置 SMTP，否则无邮件。**

**修改建议**：
```ruby
gitlab_rails['smtp_enable'] = true
gitlab_rails['smtp_address'] = "smtp.example.com"
gitlab_rails['gitlab_email_from'] = "gitlab@example.com"
```

**验证方法**：`gitlab-rails console` 发测试邮件收到；MR 事件触发邮件。

**风险等级**：中 ｜ **状态**：⚠️ 建议修改

---

### 13.2 Slack

**当前能力**：GitHub Slack App / webhook。

**GitLab EE / JiHu**：✅ **Slack notifications integration** + **GitLab for Slack app**。**需重新授权/配置**。JiHu 侧 Slack 可达性视网络环境。

**修改建议**：Project → Settings → Integrations → Slack，配 webhook URL + 勾选事件。

**验证方法**：push/MR 事件推送到 Slack 频道。

**风险等级**：低 ｜ **状态**：❓ 待确认（是否用 Slack）

---

### 13.3 Lark（飞书）

**当前能力**：GitHub 无原生 Lark，靠第三方 Action/webhook。

**GitLab EE / JiHu**：⚠️ GitLab 无内置 Lark 集成；用 **Webhook** 或 CI 脚本调飞书机器人 API。**JiHu 对国内飞书更友好（网络可达）**。

**修改建议**：Integrations → Webhooks 或 CI 中 `curl` 飞书自定义机器人：
```bash
curl -X POST "$LARK_WEBHOOK" -H 'Content-Type: application/json' \
  -d '{"msg_type":"text","content":{"text":"Pipeline 完成: '"$CI_PIPELINE_URL"'"}}'
```

**验证方法**：事件触发飞书群收到消息。

**风险等级**：中 ｜ **状态**：❓ 待确认（是否用 Lark）

---

### 13.4 Webhook

见 [模块十](#十webhook)。**状态**：⚠️ 建议修改

---

### 13.5 System Hook

**当前能力**：GitHub 无完全等价（Org 级 webhook 近似）。

**GitLab EE / JiHu**：✅ **System Hooks**（Admin 级，全实例事件：用户创建、项目创建、成员变更等）。

**修改建议**：如需全局审计/自动化，Admin → System Hooks 配置。

**验证方法**：创建项目触发 system hook。

**风险等级**：低 ｜ **状态**：✅ 无需修改（按需）

---

## 十四、Runner

### 14.1 Runner 注册方式

**当前能力**：GitHub 托管 runner（`runs-on`）+ self-hosted runner（token 注册）。

**GitLab.com Free / 未来 JiHu**：✅ 当前直接使用 SaaS 共享 Runner，无注册动作。未来专用 Runner 使用 `glrt-` authentication token；届时按目标平台文档执行。

**修改建议**：先在 UI 建 Runner 拿 `glrt-` token 再注册（见 [3.16](#316-runner--317-docker-runner--318-shell-runner--319-kubernetes-runner)）。

**验证方法**：Runner online 且能领取 job。

**风险等级**：低 ｜ **状态**：✅ MVP 无需注册

---

### 14.2 Runner Token

**当前能力**：GitHub self-host runner registration token。

**历史 GitLab EE / 未来 JiHu（未核验）**：Runner authentication token 流程可能随版本变化；当前 MVP 使用 gitlab.com shared Runner，不依据旧版本结论配置自建 Runner。

**修改建议**：妥善保管 token；用 Runner config 的 `[[runners]]` 段管理。

**验证方法**：token 注册成功；无 deprecation 警告。

**风险等级**：低 ｜ **状态**：⚠️ 建议修改

---

### 14.3 共享 Runner / 14.4 专用 Runner

**当前能力**：GitHub 托管（共享）+ self-host（专用）。

**GitLab EE / JiHu**：✅ **Shared Runners**（实例级，Admin 配）+ **Project/Group Runners**（专用）。

**修改建议**：MVP 使用 Shared Runner 并监控额度；正式期只有在额度、性能或隔离要求触发时才建设专用 Runner，并用 `tags:` 精确调度。

**验证方法**：带 tag 的 job 落到对应 runner。

**风险等级**：低 ｜ **状态**：⚠️ 建议修改

---

### 14.5 Autoscaling Runner

**当前能力**：GitHub 无内置 autoscaling（第三方 ARC 等）。

**历史 GitLab EE / 未来 JiHu（未核验）**：Runner autoscaling 方案和弃用状态随版本变化；当前 MVP 不使用自建或 autoscaling Runner，未来立项时重新选型。

**修改建议**：推荐 **K8s + GitLab Runner Helm chart** 做弹性伸缩。

**验证方法**：高并发 pipeline 时 runner pod 自动扩容。

**风险等级**：中 ｜ **状态**：❓ 待确认（是否需 autoscaling）

---

### 14.6 Docker Executor / 14.7 Kubernetes Executor

见 [3.16-3.19](#316-runner--317-docker-runner--318-shell-runner--319-kubernetes-runner)。**状态**：⚠️ 建议修改

---

## 十五、项目管理

### 15.1 Project

见 [1.1](#11-repository仓库本体) / [4.2](#42-repository--project)。**状态**：⚠️ 建议修改

### 15.2 Epic

**当前能力**：GitHub 无原生 Epic（Projects 近似）。

**GitLab EE 是否兼容**：✅ **Epics**（Group 级，**Premium/Ultimate gated**）。

**未来 JiHu（未核验）**：Epic 是否可用取决于届时版本和 License，当前不作兼容承诺。

**修改建议**：如需层级规划用 Epic，数据无法从 GitHub 直迁，手工重建。

**验证方法**：Group → Epics 可创建并挂 issue。

**风险等级**：低 ｜ **状态**：❓ 待确认（License + 是否需要）

---

### 15.3 Roadmap

见 [5.6](#56-roadmap)。**状态**：❓ 待确认

### 15.4 Iteration

**当前能力**：GitHub 无原生 Iteration（Projects 迭代字段近似）。

**GitLab EE 是否兼容**：✅ **Iterations**（Group 级 sprint，**Premium/Ultimate gated**）。

**JiHu 是否兼容**：⚠️ 需 License。

**修改建议**：如做 Scrum sprint 用 Iterations，手工建。

**验证方法**：Iteration cadence 生成周期。

**风险等级**：低 ｜ **状态**：❓ 待确认

---

### 15.5 Milestone

见 [5.4](#54-milestone)。**状态**：⚠️ 建议修改

### 15.6 Board

见 [5.5](#55-project看板)。**状态**：❓ 待确认

### 15.7 Wiki

**当前能力**：GitHub Wiki（独立 Git 仓库）。

**GitLab EE / JiHu**：✅ GitLab Wiki（同为独立 Git 仓库）。**导入器可迁移 Wiki**，或手工 `git clone` wiki 仓库后推到 GitLab wiki。

**修改建议**：
```bash
git clone https://github.com/CodesSentinels/ai-reviewer.wiki.git
git push --mirror https://gitlab.example.com/codes-sentinels/ai-reviewer.wiki.git
```

**验证方法**：Wiki 页面数量与内容一致。

**风险等级**：低 ｜ **状态**：❓ 待确认（是否有 Wiki）

---

### 15.8 Snippet

**当前能力**：GitHub Gist（账号级，非仓库内）。

**GitLab EE / JiHu**：✅ **Snippets**（Project 级 + 个人级）。**Gist 不自动迁移**，需手工搬运。

**修改建议**：如有重要 Gist，手工复制到 GitLab Snippet。

**验证方法**：Snippet 内容可访问。

**风险等级**：低 ｜ **状态**：❓ 待确认（是否用 Gist）

---

### 15.9 Pages

**当前能力**：GitHub Pages（本项目未发现使用）。

**GitLab EE / JiHu**：✅ **GitLab Pages**（需服务端启用 + 配域名）。**不自动迁移**，需在 CI 加 `pages` job。

**修改建议**：
```yaml
pages:
  stage: deploy
  script: [mkdir public && cp -r site/* public/]
  artifacts: { paths: [public] }
  rules: [{ if: '$CI_COMMIT_BRANCH == "main"' }]
```

**验证方法**：`https://<group>.gitlab-pages.example.com/<project>` 可访问。

**风险等级**：低 ｜ **状态**：❓ 待确认（是否用 Pages）

---

## 十六、开发体验

### 16.1 VSCode

**当前能力**：GitHub + VSCode（GitHub Pull Requests 扩展、Copilot 等）。

**GitLab EE / JiHu**：✅ **GitLab Workflow** VSCode 扩展（MR、pipeline、issue）。**需配置 GitLab 实例 URL + PAT**。GitHub 专属扩展不适用。

**修改建议**：团队安装 GitLab Workflow 扩展，配 instance URL 与 PAT。

**验证方法**：VSCode 内可查看/操作 MR 与 pipeline。

**风险等级**：低 ｜ **状态**：⚠️ 建议修改

---

### 16.2 JetBrains

**当前能力**：JetBrains + GitHub 集成。

**GitLab EE / JiHu**：✅ JetBrains 内置 **GitLab 集成**（Merge Request 支持）+ 第三方插件。配 URL + token。

**修改建议**：Settings → Version Control → GitLab，配 server + token。

**验证方法**：IDE 内可浏览 MR。

**风险等级**：低 ｜ **状态**：⚠️ 建议修改

---

### 16.3 Git Credential

**当前能力**：GitHub PAT / credential helper / gh CLI。

**GitLab EE / JiHu**：✅ 标准 Git credential helper；`glab` CLI 对应 `gh`。**需更新缓存的 GitHub 凭据为 GitLab。**

**修改建议**：`git config --global credential.helper`；清理旧 GitHub 凭据；安装 `glab`。

**验证方法**：`git push` 到 GitLab 免密（凭据缓存生效）。

**风险等级**：低 ｜ **状态**：⚠️ 建议修改

---

### 16.4 SSH

**当前能力**：GitHub 上传 SSH 公钥。

**GitLab EE / JiHu**：✅ 用户 Settings → SSH Keys 上传公钥。**公钥不迁移，用户需重新添加。** SSH 端口可能非 22（自建常用 22 或自定义）。

**修改建议**：通知用户添加公钥到 GitLab；确认 SSH host/port。

**验证方法**：`ssh -T git@gitlab.example.com` 返回 Welcome。

**风险等级**：低 ｜ **状态**：⚠️ 建议修改

---

### 16.5 HTTPS / 16.6 Git Clone / 16.7 Git Fetch / 16.8 Git Push

**当前能力**：GitHub HTTPS/SSH clone/fetch/push。

**GitLab EE / JiHu**：✅ 完全兼容，仅 remote URL 改变。

**修改建议**：更新 remote：
```bash
git remote set-url origin https://gitlab.example.com/codes-sentinels/ai-reviewer.git
```
批量场景可脚本遍历所有本地克隆。

**验证方法**：clone/fetch/push 均成功。

**风险等级**：低 ｜ **状态**：⚠️ 建议修改（remote URL）

---

## 十七、迁移工具

### 17.1 GitLab Importer / GitHub Import

**当前能力**：N/A（GitHub 侧）。

**GitLab EE / JiHu**：✅ **内置 GitHub Importer**（New Project → Import → GitHub），迁移 repo + issue + PR/MR + label + milestone + release + wiki + PR 评论。**依赖 GitHub PAT + 网络可达 github.com**。

> ⚠️ **JiHu/自建实例访问 github.com 的网络可达性需确认**（国内网络）。若不可达，改用 **API 迁移 / 中转**。

**修改建议**：首选 GitHub Importer（EE 侧执行，因 EE 可能网络更好）；JiHu 侧再从 EE 用 Direct Transfer。

**验证方法**：导入报告无 failed；抽样核对各实体。

**风险等级**：中 ｜ **状态**：⚠️ 建议修改（首选方案）

---

### 17.2 Git Mirror

见 [1.8](#18-mirror-repository镜像仓库)。用于 Git 数据层持续同步。**状态**：⚠️ 建议修改

---

### 17.3 API Migration

**当前能力**：N/A。

**GitLab EE / JiHu**：✅ 用 REST API 脚本迁移 GitHub Importer 覆盖不到的部分（Projects v2、release assets、自定义字段）。

**修改建议**：对导入器缺口编写补全脚本。

**验证方法**：目标实体数量对齐源。

**风险等级**：中 ｜ **状态**：⚠️ 建议修改

---

### 17.4 第三方迁移工具

**当前能力**：N/A。

**GitLab EE / JiHu**：`node-gitlab-2-github` 反向工具、`congregate`（GitLab 官方大规模迁移工具）等。

**修改建议**：大规模多项目可评估 **Congregate**；单项目用内置 Importer 即可。

**验证方法**：工具报告 + 抽样。

**风险等级**：中 ｜ **状态**：❓ 待确认（规模决定）

---

### 17.5 推荐方案（结论）

| 阶段 | 数据 | 推荐工具 | 理由 |
|------|------|----------|------|
| 当前 MVP | `main` 测试代码 | 推送到空项目 `ai-reviewer-test` | 不迁历史，最小化变量 |
| 正式 GitHub → gitlab.com | repo/issue/MR/release/wiki/label/milestone | GitLab 内置 GitHub Importer + API 补全 | 测试通过后另行执行 |
| 未来 gitlab.com → JiHu | 未定 | 启动时重新评估 Direct Transfer/导出/API | 不预设版本和工具兼容性 |

---

## 十八、数据库（如迁移 GitLab Server）

> **非当前实施范围。** 当前使用 gitlab.com SaaS，无权也无需操作 PostgreSQL、Redis、对象存储或实例备份。本模块仅保留通用风险提示；未来 JiHu 立项时必须按当时实际版本重写，不能直接执行下列旧版本示例。

### 18.0 关键结论：高→低版本禁止物理恢复

**当前能力**：N/A。

**历史 GitLab EE / 未来 JiHu（未核验）**：不得预设跨产品、跨版本物理恢复可行。若未来涉及自建 GitLab/JiHu，必须依据源/目标确切版本的官方备份恢复矩阵制定方案；当前 SaaS MVP 不执行物理恢复。

**修改建议**：通用原则是禁止将高版本 backup 恢复到低版本。未来迁移时先核对双方官方支持矩阵，再选择 Direct Transfer、导出/API 或同版本 backup/restore；本文不预先承诺 Direct Transfer 一定支持届时的跨发行版组合。

**验证方法**：Direct Transfer 完成后目标实体校验。

**风险等级**：**高** ｜ **状态**：⏸ 非当前范围，未来重新立项

---

### 18.1 PostgreSQL

**当前能力**：N/A。

**历史 GitLab EE / 未来 JiHu（未核验）**：PostgreSQL 要求与确切 GitLab/JiHu 版本绑定。未来如涉及物理迁移，必须使用目标版本官方要求重新设计；当前 SaaS MVP 不建设或迁移 PostgreSQL。

**修改建议**：同版本才 `gitlab-backup`；跨版本用 Direct Transfer。备份：
```bash
gitlab-backup create SKIP=uploads,artifacts,registry  # DB 部分
```

**验证方法**：restore 后 `gitlab-rake gitlab:check`。

**风险等级**：高 ｜ **状态**：❓ 待确认

---

### 18.2 Redis

**当前能力**：N/A。

**GitLab EE / JiHu**：⚠️ 缓存/队列，**不需迁移数据**（重建即可），但需版本与配置一致。

**修改建议**：新实例部署 Redis，无需搬数据。

**验证方法**：`gitlab-ctl status redis` 正常。

**风险等级**：低 ｜ **状态**：✅ 无需修改（重建）

---

### 18.3 Object Storage / 18.4 Uploads / 18.5 Artifacts / 18.6 Registry

**当前能力**：N/A。

**GitLab EE / JiHu**：⚠️ 大对象（LFS、uploads、CI artifacts、容器镜像）存于本地磁盘或对象存储（S3 兼容）。**须与 DB 一致迁移**。Direct Transfer 会搬运关联对象；物理迁移需同步对象存储 bucket。

**修改建议**：统一用 **S3 兼容对象存储**（MinIO/云 OSS），迁移时 bucket 同步（`rclone`/`aws s3 sync`）。Registry 镜像见 [8.1](#81-container-registry)。

**验证方法**：附件/artifact/镜像可下载；无 404。

**风险等级**：中 ｜ **状态**：❓ 待确认（是否自建 + 对象存储方案）

---

## 十九、备份

### 19.1 备份方式

**当前能力**：GitHub 由平台负责（Enterprise 可 backup utilities）。

**GitLab EE / JiHu**：✅ `gitlab-backup create`（DB + repo + uploads + artifacts）+ **单独备份配置**（`/etc/gitlab/gitlab-secrets.json`、`gitlab.rb`）。

**修改建议**：
```bash
gitlab-backup create CRON=1                 # 数据
cp /etc/gitlab/gitlab-secrets.json /backup/ # 密钥（必须！否则加密数据不可用）
cp /etc/gitlab/gitlab.rb /backup/
```
配置定时（cron）+ 异地存储。

**验证方法**：备份文件生成；定期演练恢复。

**风险等级**：中 ｜ **状态**：⚠️ 建议修改（切换前必做）

---

### 19.2 恢复方式

**当前能力**：N/A。

**GitLab EE / JiHu**：✅ `gitlab-backup restore`。**版本必须一致**（见 [18.0](#180-关键结论高低版本禁止物理恢复)）。

**修改建议**：恢复到**同版本** GitLab；先恢复 secrets 再 restore。

**验证方法**：`gitlab-rake gitlab:check`；抽样访问。

**风险等级**：高 ｜ **状态**：⚠️ 建议修改

---

### 19.3 Rollback（回滚）

**当前能力**：GitHub 与 GitLab 均为正式运行路径，不存在把整个系统“切回”单一平台的动作。

**GitLab EE / JiHu**：见 [模块二十一](#二十一双平台兼容实施步骤) 各步隔离方案 + [21.99 平台故障隔离](#2199-平台故障隔离总纲)。

**修改建议**：分别提供 GitHub Action 与 GitLab Webhook/trigger 的启停开关；平台故障时只停用对应入口。代码始终以 GitHub `main` 为准，GitLab 状态不反写 GitHub。

**验证方法**：分别演练 GitHub 故障和 GitLab 故障，确认另一平台可继续运行；演练同步失败并确认 GitHub 主源未被修改。

**风险等级**：中 ｜ **状态**：⚠️ 建议修改

---

## 二十、兼容性矩阵

> 状态图例：✅ 无需修改 ｜ ⚠️ 建议修改 ｜ ❓ 待确认 ｜ ⏸ 非当前范围。风险：P0/严重/高/中/低。当前决策以 gitlab.com Free MVP 为准；未来 JiHu 列仅作提示，不代表已完成目标版本认证。

| 功能 | GitHub | gitlab.com Free（当前） | 未来 JiHu | 是否修改 | 风险 | 状态 |
|------|--------|----------------|-------------|----------|------|------|
| Repository | repo | Project ✅ | ✅ | URL 元数据 | 低 | ⚠️ |
| Branch | 分支 | ✅ | ✅ | 迁移方式 | 低 | ⚠️ |
| Tag | tag+tagger | ✅ tag / 脚本 | ✅ | 浮动 tag 重写 | 中 | ⚠️ |
| Protected Branch | protection rule | ✅ 模型不同 | ✅ 逐项确认 | API 重建 | 中 | ⚠️ |
| Default Branch | main | ✅ | ✅ | 确认 | 低 | ✅ |
| Submodule | 无 | ✅ | ✅ | 否 | 低 | ✅ |
| Git LFS | 未用 | ✅ | ✅ | 否 | 低 | ✅ |
| Mirror Repo | CI force push | ✅ Push/Pull Mirror | ✅ | 改镜像 | 中 | ⚠️ |
| Fork | fork | ✅ 关系重建 | ✅ | 重建 | 低 | ⚠️ |
| Archive | archive | ✅ | ✅ | 否 | 低 | ✅ |
| Template Repo | 未用 | ✅ 机制不同 | ✅ | 否 | 低 | ✅ |
| 多包结构 | 根包 + review-visualizer | ✅ | 待未来确认 | MVP 仅构建根包 | 低 | ⚠️ |
| Git Attributes | linguist | ⚠️ 部分 | ⚠️ 部分 | 可接受差异 | 低 | ⚠️ |
| Git Ignore | ✅ | ✅ | ✅ | 否 | 低 | ✅ |
| Git Hooks | 无 | ✅ Server Hook/Push Rule | ✅ | 否 | 低 | ✅ |
| GH Actions workflow | 4 个 | ❌ 重写 CI | ❌ 重写 | 全重写 | 高 | ⚠️ |
| Action: checkout | 官方 | 内置 checkout | 内置 | 删除 | 低 | ⚠️ |
| Action: github-script | Octokit | ❌ 无 | ❌ 无 | 改 API 脚本 | 中 | ⚠️ |
| Action: actions-tagger | 第三方@latest | ❌ 无 | ❌ 无 | 脚本替代 | 中 | ⚠️ |
| pull_request_target | 特权事件 + 执行 PR head + secrets | ❌ 禁止复刻；改 protected `main` trigger job | ⚠️ 重新评估 | 先止血，再做信任分离 | P0 | ⛔ |
| windows-latest | 托管 | ⚠️ 自备 Win Runner | ⚠️ | 改 Linux | 中 | ⚠️ |
| matrix | strategy | ✅ parallel:matrix | ✅ | 语法 | 低 | ⚠️ |
| cache | actions/cache | ✅ | ✅ | 语法 | 低 | ⚠️ |
| artifact | upload-artifact | ✅ | ✅ | 语法 | 低 | ⚠️ |
| secret | repo secret | ✅ CI Variable | ✅ | 重建 | 中 | ⚠️ |
| environment | 未用 | ✅ | ✅ | 否 | 低 | ✅ |
| variables | env/$GITHUB_ENV | ✅ dotenv | ⚠️ spec:inputs 确认 | 语法 | 中 | ❓ |
| permissions | GITHUB_TOKEN scope | ⚠️ 无逐权限 YAML | ⚠️ | Token 角色 | 中 | ⚠️ |
| reusable workflow | 未用 | ✅ include/extends | ✅ | 否 | 低 | ✅ |
| cron schedule | 未用 | ✅ UI Schedule | ✅ | 否 | 低 | ✅ |
| .gitlab-ci.yml | (需新建) | ✅ | ✅ | 新建 | 中 | ⚠️ |
| Pipeline/Stage/Job | workflow run | ✅ | ✅ | 重写 | 低-中 | ⚠️ |
| Child/Parent Pipeline | 未用 | ✅ | ✅ | 否 | 低 | ✅ |
| Merge Train | 无 | ✅ Premium | ⚠️ License | 按需 | 中 | ❓ |
| Merge Queue | queue/自制 | ⚠️ = Merge Train | ⚠️ | 语义映射 | 中 | ❓ |
| Review App | 未用 | ✅ | ✅ | 否 | 低 | ✅ |
| Runner | 托管 | ✅ MVP 用 SaaS 共享 Runner | 待未来确认 | Node 24 镜像 | 中 | ⚠️ |
| Docker/K8s Executor | - | ✅ | ✅ | 部署 | 中 | ⚠️ |
| Organization | Org | Group ✅ 映射 | ✅ | 映射 | 中 | ⚠️ |
| Team | Team | ⚠️ Subgroup | ⚠️ | 映射 | 中 | ⚠️ |
| Member | 用户 | ⚠️ user mapping | ⚠️ | 建号/映射 | 高 | ⚠️ |
| Permission | 5 档 | ⚠️ 5 档含义不同 | ⚠️ | 映射表 | 中 | ⚠️ |
| Protected Tag | 弱 | ✅ | ✅ | API 建 | 低 | ⚠️ |
| Approval Rule | required review | ✅ Premium | ⚠️ License | 配置 | 中 | ❓ |
| CODEOWNERS | 未用 | ✅ Premium approval | ⚠️ License | 否 | 低 | ✅ |
| Issue | issue | ✅ | ✅ | 导入 | 中 | ⚠️ |
| Comment | 评论 | ✅ notes | ✅ | 导入+映射 | 中 | ⚠️ |
| Label | label | ✅ | ✅ | 导入 | 低 | ⚠️ |
| Milestone | milestone | ✅ | ✅ | 导入 | 低 | ⚠️ |
| Project(看板) | Projects v2 | ⚠️ Board 不全迁 | ⚠️ | 手工重建 | 中 | ❓ |
| Roadmap | 无 | ✅ Premium | ⚠️ License | 手工 | 低 | ❓ |
| Assignee | assignee | ✅ | ✅ | 映射 | 中 | ⚠️ |
| Mention | @user | ⚠️ 历史文本 | ⚠️ | 映射 | 低 | ⚠️ |
| Issue Template | ❌ 无 | 不适用 | 不适用 | 否 | 低 | ✅ |
| Pull Request | PR | ✅ MR | ✅ | 导入 | 中 | ⚠️ |
| Draft | draft | ✅ | ✅ | 否 | 低 | ✅ |
| Review/Approve/Dismiss | review | ⚠️ 历史不全迁 | ⚠️ | 新流程 | 中 | ⚠️ |
| Requested Reviewer | reviewer | ✅ | ✅ | 映射 | 低 | ⚠️ |
| Auto Merge | auto-merge | ✅ | ✅ | 否 | 低 | ✅ |
| Squash/Rebase/Merge Commit | 三种 | ✅ Project 设置 | ✅ | 设置对齐 | 低 | ⚠️ |
| Release | release | ✅ | ✅ | 导入+CI | 中 | ⚠️ |
| Release Binary/Asset | asset | ⚠️ 需手工搬 | ⚠️ | 手工 | 中 | ❓ |
| Release Note | note | ✅ | ✅ | 迁移 | 低 | ⚠️ |
| Container Registry | ❌ 未使用 | ✅ | ✅ | 否 | 低 | ✅ |
| Package Registry | ❌ 未发布(private) | ✅ | ✅ | 否 | 低 | ✅ |
| Secret (mgmt) | secret | ✅ CI Var | ✅ | 重建 | 中 | ⚠️ |
| Dependabot | ❌ 未启用 | 不适用 | 不适用 | 否 | 低 | ✅ |
| CodeQL | ❌ 未使用 | 不适用 | 不适用 | 否 | 低 | ✅ |
| Secret Scan | 未确认 | ⚠️ Secret Detection | ⚠️ | include | 低 | ⚠️ |
| SAST/DAST/License/Container Scan | 未用 | ✅ Ultimate | ⚠️ License | include | 中 | ❓ |
| Webhook 事件 | GH 事件 | ⚠️ 名/结构不同 | ⚠️ | 重建 | 中 | ⚠️ |
| Webhook Payload | GH 结构 | ❌ 不一致 | ❌ | 适配层 | 高 | ⚠️ |
| REST API | Octokit v3 | GitLab API v4；adapter 标准客户端为锁定版本的 `@gitbeaker/rest`，原生 `fetch` 仅作受控 fallback | 未来按目标版本重新核验 | 双 adapter | 高 | ⚠️ |
| GraphQL | GH schema | ❌ 不同 | ❌ | 全重写 | 高 | ⚠️ |
| OAuth | GH OAuth | ✅ 重建 | ✅ | 重建 | 中 | ❓ |
| PAT | GH PAT | ✅ | ✅ | 新建 | 中 | ⚠️ |
| Deploy Token/Key | deploy key | ✅ | ✅ | 新建 | 低 | ⚠️ |
| Project/Group Token | 无直接 | ❌ Free 不可用 | 待实例确认 | MVP 用短期个人 PAT | 中 | ⚠️ |
| LDAP/SAML/OIDC | EE SSO | ✅ | ✅ | 重建 | 中 | ❓ |
| 2FA | 支持 | ✅ 需重绑 | ✅ | 用户重绑 | 中 | ⚠️ |
| SCIM | Org SCIM | ✅ Premium | ⚠️ License | 配置 | 中 | ❓ |
| Email | 平台 | ✅ SaaS 托管；MVP 不测试通知 | 待未来确认 | 当前不改 | 低 | ⏸ |
| Slack | GH App | ✅ 重配 | ❓ 网络 | 重配 | 低 | ❓ |
| Lark | 第三方 | ⚠️ webhook | ⚠️ 更友好 | 脚本 | 中 | ❓ |
| System Hook | 近似 | ✅ | ✅ | 按需 | 低 | ✅ |
| Runner 注册 | token | ⚠️ glrt- | ⚠️ 一致 | 重新注册 | 中 | ⚠️ |
| Autoscaling Runner | 第三方 | ✅ K8s | ✅ | 按需 | 中 | ❓ |
| Wiki | wiki repo | ✅ | ✅ | git 搬运 | 低 | ❓ |
| Snippet/Gist | Gist | ✅ 手工 | ✅ | 手工 | 低 | ❓ |
| Pages | 未用 | ✅ 需启用 | ✅ | CI job | 低 | ❓ |
| VSCode/JetBrains | GH 扩展 | ✅ GitLab 扩展 | ✅ | 换扩展+配 | 低 | ⚠️ |
| SSH Key | 用户上传 | ✅ 需重加 | ✅ | 用户重加 | 低 | ⚠️ |
| Clone/Fetch/Push | HTTPS/SSH | ✅ | ✅ | remote URL | 低 | ⚠️ |
| Epic/Iteration | 无 | ✅ Premium | ⚠️ License | 手工 | 低 | ❓ |
| **本项目 Action 本体** | Action（正式保留） | ❌ 不能直接跑，需新增 GitLab 入口 | 待未来确认 | 共享核心 + 双 adapter/双入口 | 高 | ⚠️ |
| gitlab.com→JiHu | - | 非当前范围 | 待目标版本确认 | 未来重新立项 | 高 | ⏸ |

---

## 二十一、双平台兼容实施步骤

> 当前执行的是双平台兼容 MVP，不是用 GitLab 替换 GitHub，也不是正式历史数据迁移。「负责人」为角色占位，实施前须指派实名。「耗时」为经验估算，随规模浮动。

```
GitHub P0 止血 → 确认远端设置 → 创建 SaaS 测试项目 → 建立受控单向同步
            → 双平台兼容改造 → 无密钥 MR CI → 配置 Webhook/Trigger/main job 与 PAT/Key
            → GitHub PR + GitLab MR 双平台联调 → 兼容模式发布与持续运行
            →（可选、另行批准）历史数据复制 / JiHu 评估
```

### 21.1 准备阶段

- **目的**：先完成当前 GitHub workflow 的 P0 止血：禁止 `pull_request_target` checkout/执行 PR head；无法立即完成信任分离时临时禁用危险 workflow，并**强制轮换**曾进入该 workflow 的 OpenAI Key。随后盘点仓库资产，通过 GitHub/GitLab API 或 UI 快照确认远端分支、tag、Branch Protection、Secret 名称、Webhook 和成员，锁定 gitlab.com Free MVP 边界。
- **负责人**：DevOps 架构师 + 项目负责人。
- **耗时**：3–5 天。
- **风险**：**P0 / 严重**——在止血前继续运行现有 workflow 可能泄漏密钥和仓库写权限。
- **验证方法**：恶意 fork PR/PR head 不能在 secret-bearing 上下文执行；相关 key 已轮换；资产清单评审通过，待确认列表全部有结论。
- **回滚方案**：止血期间保留无密钥 build/test；不得以恢复危险 workflow 作为回滚方式。

### 21.2 创建 GitLab SaaS 测试项目

- **目的**：在 gitlab.com 创建私有空项目 `CodesSentinels/ai-reviewer-test`，手工加入最多 3 名测试成员；不搭建数据库、Redis、对象存储、SMTP 或自建 Runner。
- **负责人**：项目 Owner / DevOps。
- **耗时**：0.5 天。
- **风险**：低——重点是项目可见性和成员角色误配。
- **验证方法**：项目 URL、可见性、成员及角色经过双人复核。
- **回滚方案**：测试项目不承载历史数据，可停用后重建。

### 21.3 推送测试代码

- **目的**：按已确认 MVP 决策，把当前 `main` 代码推到空测试项目；不导入 Issue/PR/Release/Wiki，不把 `--mirror` 作为本阶段前提。
- **负责人**：DevOps。
- **耗时**：0.5–1 天（单仓库）。
- **风险**：低——主要风险是误推到正式镜像项目。
- **验证方法**：测试项目 `main` HEAD 与选定源 commit SHA 一致；remote URL 指向 `ai-reviewer-test`。
- **回滚方案**：测试项目不含真实协作数据，可重新创建；GitHub 保持不变。

### 21.4 双平台兼容改造与精简 CI

- **目的**：按[工作流 A](#工作流-a双平台兼容改造产品代码与契约测试)建立共享核心、保留 GitHub adapter 并新增 GitLab adapter；编写 Node 24 `.gitlab-ci.yml`。GitHub workflow 继续正式维护；`versioning.yml`、`combine-prs.yml` 本轮不实现 GitLab 等价版本，`sync-to-gitlab.yml` 则作为单向同步链路保留并加固。
- **负责人**：DevOps + 后端开发。
- **耗时**：直接引用 WBS：工作流 A 约 9–16 周，工作流 B 的无密钥 MR CI 约 2–3 天，工作流 D 约 1.5–2.5 周。这里是汇总展示；21.7 对应工作流 D，**不得再次累加工期**。
- **风险**：高——CI 是「不中断」第一优先级。
- **验证方法**：build/test/package 全绿；MR job 中 PAT/OpenAI Key/Trigger token 均为空；trigger pipeline 固定在 protected `main`，可读取 `TRIGGER_PAYLOAD` 并为同项目测试 MR 产生 discussion。
- **回滚方案**：GitHub 与 GitLab 路径独立启停；GitLab 适配未通过时保持安全修复后的 GitHub workflow 正常服务，禁止恢复原 `pull_request_target` + PR head + secrets 组合。

### 21.5 使用 GitLab.com 共享 Runner

- **目的**：MVP 使用 gitlab.com 共享 Runner 和 `node:24` 镜像；记录额度消耗。自建 Runner 推迟到正式阶段评估。
- **负责人**：DevOps。
- **耗时**：0.5 天。
- **风险**：低-中——受共享额度和排队时间影响。
- **验证方法**：pipeline 成功调度；Node 版本为 24；根包测试通过。
- **回滚方案**：测试继续保留 GitHub Actions；额度不足时再提出自建 Runner 决策。

### 21.6 轮换并配置测试密钥/Trigger

- **目的**：创建新的 `OPENAI_API_KEY`，将新 key 和短期个人 PAT 配为 Masked + Hidden + Protected CI variables；创建专用 Pipeline Trigger token 并仅配置到 Project Webhook URL；立即作废旧 OpenAI Key。普通 MR Pipeline 不得访问这些密钥；当前 gitlab.com Free 不创建 Project/Group Access Token。
- **负责人**：DevOps（密钥经手最小化）。
- **耗时**：0.5 天。
- **风险**：中——密钥泄露/缺失。
- **验证方法**：不输出密钥；旧 OpenAI Key 调用失败；MR Pipeline 证明业务密钥为空；protected `main` trigger job 通过受控 API 请求验证新 key/PAT 可用；Trigger token 只能启动指定项目/ref 的 pipeline；记录 token owner 和到期日。
- **回滚方案**：只能切换到另一枚新生成并受控保存的 key，不得恢复旧 key；安全 GitHub workflow 如仍需模型访问，使用独立 key。

### 21.7 配置 Webhook → Pipeline Trigger

- **WBS 对应关系**：本步骤就是[工作流 D](#工作流-dgitlab-接入配置与端到端联调mvp-必做)的实施步骤，不是工作流 D 之外的额外 1.5–2.5 周；产品代码、CLI 和打包分别由 A5/A9 交付，本步骤只做接入配置与端到端联调。
- **目的**：按 [10.3](#mvp-trigger) 配置 Project Webhook，将 Merge Request/Note Hook 直接发送到 GitLab Pipeline Trigger URL；实现 protected `main` 上的串行 `ai-review-trigger` job。无需外部 Receiver、worker 服务、数据库或队列。
- **负责人**：DevOps + 后端。
- **耗时**：1.5–2.5 周（工作流 D 的同一估算；包含已打包 CLI 的 CI 接入、resource group、Webhook/Trigger/变量配置和真实端到端测试，不包含 A5/A9 产品代码与打包开发）。
- **风险**：高——Trigger token 泄漏、ref 配置错误或 payload 校验缺失可能造成越权/重复调用。
- **验证方法**：Webhook 可触发 main pipeline；`TRIGGER_PAYLOAD`、目标项目/fork/权限检查、marker 去重、旧 SHA 退出、UI retry 和真实命令全链路通过；恶意 MR 不能改变 trigger job 的代码、命令或依赖。
- **回滚方案**：可保留完成信任分离后的安全 GitHub 事件入口并行；禁止恢复会执行 PR head 的特权 workflow。

### 21.8 可选历史数据复制：Issue（MVP 不执行）

- **目的**：如确有查阅需要，用 Importer 将 issue/comment/label/milestone 复制到 GitLab（[模块五](#五issue)）；该副本不改变 GitHub 的主协作平台地位。
- **负责人**：项目管理 + DevOps。
- **耗时**：0.5–1 天。
- **风险**：中——user mapping 错误影响归属。
- **验证方法**：数量、状态、作者抽样一致。
- **回滚方案**：GitHub Issue 保持权威数据源和既有读写策略；删除或标记 GitLab 副本，不做双向同步。

### 21.9 可选历史数据复制：PR → MR（MVP 不执行）

- **目的**：如确有查阅需要，将历史 PR 复制为 GitLab MR（[模块六](#六pull-request--merge-request)）；不把开放 PR 的协作流程切到 GitLab。
- **负责人**：DevOps。
- **耗时**：0.5–1 天。
- **风险**：中——review 历史不全、open PR 状态。
- **验证方法**：MR 数量/状态/diff 抽样一致。
- **回滚方案**：GitHub PR 始终为权威协作记录；删除或标记 GitLab 历史副本。

### 21.10 可选历史数据复制：Release（MVP 不执行）

- **目的**：如确有分发需要，复制 release 并手工复制 asset（[模块七](#七release)）；GitHub Release 仍是主源发布记录。
- **负责人**：DevOps。
- **耗时**：0.5–1 天。
- **风险**：中——二进制 asset 遗漏。
- **验证方法**：release 列表 + asset 校验和一致。
- **回滚方案**：GitHub Release 保留。

### 21.11 联调

- **目的**：分别完成 GitHub-only、GitLab-only 和同时启用三种端到端验证；MVP 不验证通知。GitLab 与 GitHub 的核心审查结果做抽样对比。
- **负责人**：全体。
- **耗时**：3–7 天。
- **风险**：中。
- **验证方法**：先在无任何 GitLab 配置时完成 GitHub PR 全量回归；再在无 GitHub Token/API/workflow 的环境提同项目测试 MR，确认 AI review/discussion/命令/pipeline 全链路通过；最后同时启用两边，确认事件、评论、marker 和重试状态不跨平台读写。另构造 fork MR 验证 trigger job 拒绝处理，确认普通 MR Pipeline 无业务密钥、旧 SHA 不写评论、bot/system note 和元数据更新不调用模型，权限矩阵和 marker 去重通过。
- **回滚方案**：分别停用故障平台的自动触发，另一平台继续服务；GitHub 始终是代码主源。

### 21.12 兼容模式灰度（MVP 验收后）

- **目的**：保持 GitHub 正常服务，在 GitLab 测试项目逐步开放 MR 自动审查；观察两个平台的功能等价性和故障隔离。
- **负责人**：项目负责人 + DevOps。
- **耗时**：1–2 周（观察窗口）。
- **风险**：中。
- **验证方法**：GitHub PR 无功能回退；GitLab MR 的摘要、行级 discussion 和命令通过；两边状态互不覆盖。
- **回滚方案**：仅关闭 GitLab Webhook/trigger，GitHub Action 继续运行；不改变代码同步方向。

### 21.13 兼容模式正式启用

- **目的**：宣布 GitHub Action 与 GitLab MR reviewer 均为正式支持路径；GitHub 保持唯一代码主源，`sync-to-gitlab.yml` 保持单向同步。
- **负责人**：项目负责人。
- **耗时**：1 天（提前通告）。
- **风险**：中——需避免使用者误在 GitLab 直接开发或期待评论自动同步。
- **验证方法**：GitHub PR 与 GitLab MR 验收矩阵全绿；GitLab `main` 与 GitHub `main` SHA 一致；GitLab 保护规则拒绝非同步写入。
- **回滚方案**：见 [21.99](#2199-平台故障隔离总纲)。

### 21.14 双平台观察

- **目的**：分别监控 Actions/pipeline 成功率、Runner 排队、API 报错、同步延迟和功能差异。
- **负责人**：运维 + DevOps。
- **耗时**：1–2 周。
- **风险**：低-中。
- **验证方法**：关键指标平稳；任一平台故障时另一平台仍可运行；无 P1 功能回退。
- **回滚方案**：关闭故障平台触发入口并修复，不归档仓库、不反转同步方向。

### 21.15 进入双平台维护期

- **目的**：结项并进入双平台维护；建立共享核心、两个 adapter 和两个构建入口的回归要求。如需历史数据复制或 JiHu，另行立项。
- **负责人**：项目负责人。
- **耗时**：1–2 天。
- **风险**：低。
- **验证方法**：验收清单全绿；文档明确 GitHub 主源、GitLab 镜像和平台支持边界。
- **回滚方案**：按平台独立停用/恢复；兼容模式存续期间不下线 GitHub。

---

### 21.99 平台故障隔离总纲

| 触发条件 | 回滚动作 | 前置保障 |
|----------|----------|----------|
| GitHub Actions 大面积失败 | 暂停 GitHub 自动触发并修复；GitLab MR reviewer 继续运行 | 两个平台凭据和执行入口隔离 |
| GitLab CI/Webhook 大面积失败 | 暂停 GitLab Webhook/trigger；GitHub Action 继续运行 | GitHub 路径已完成 S1–S3 安全修复 |
| 代码同步不一致 | 停止向 GitLab 发布新版本，按 GitHub `main` SHA 修复单向同步 | GitHub 始终为唯一代码主源；GitLab 不反向写回 |
| 平台评论/状态异常 | 仅停用对应平台 adapter，修复后依据本平台 marker 重试 | marker、事件 ID、评论 ID 使用平台命名空间 |
| 未来 JiHu 评估失败 | 保持现有 GitHub 主源 + gitlab.com 兼容运行方式 | JiHu 阶段另建回滚方案；禁止高→低物理恢复 |

**故障隔离黄金法则**：**不反转同步方向，不用一个平台的状态覆盖另一个平台，不以恢复不安全 workflow 作为回滚。** GitHub 在兼容模式中始终保持 active，因为它同时是代码主源和正式运行平台。

---

## 二十二、待确认事项

> 凡无法从代码/配置确定的信息，一律列此，**不猜测**。按优先级排列。**2026-07-21 更新**：区分代码扫描事实与远端平台设置。

### ✅ 已确认 / 已排除（本轮闭环，不再阻塞）

| # | 事项 | 结论 |
|---|------|------|
| 1 | 本项目 Action 目标形态 | ✅ **保留 GitHub Action并新增 GitLab 原生入口**；共享核心、两个正式 adapter、两个构建入口（工作流 A）|
| 2 | 当前是否经过自建 EE | ✅ **不经过**；直接使用 gitlab.com Free 测试项目 |
| 3 | JiHu 是否属于当前范围 | ✅ **不属于**；未来启动时重新确认源/目标版本和迁移路径 |
| 4 | License 级别 | ✅ **免费版（Free）**——见 [0.5 免费版红线](#05-已确认决策及连锁影响2026-07-20-更新)|
| 5 | 自建还是 SaaS | ✅ **公网 gitlab.com SaaS**——当前阶段免除数据库/Redis/对象存储/SMTP等自建基础设施 |
| 6 | 测试范围 | ✅ **3 人 / 空项目 / 不迁历史 / 无通知**——见 [0.6](#06-测试阶段范围与决策2026-07-20-确认走最小可用mvp-路线)|
| 7 | AI Reviewer 认证身份 | ✅ **个人 PAT**（`api` scope，Masked + Hidden + Protected，仅供 protected `main` trigger pipeline）|
| 8 | OpenAI Key | ✅ **迁移前强制轮换**；旧 key 失效，新 key 为 Protected CI variable，仅供 protected `main` trigger pipeline |
| 9 | GitHub App 认证 | ✅ **未使用**（走 GITHUB_TOKEN）|
| 10 | Dependabot | ✅ **未启用**（无 `dependabot.yml`）→ 测试期不引入 Renovate |
| 11 | GitHub Packages / Pages | ✅ **均未使用** |
| 12 | Issue / PR 模板 | ✅ **无** |
| 13 | Git LFS / Submodule | ✅ 均未使用；仓库另含 `tools/review-visualizer` 独立包，但未配置 workspace |
| 14 | CODEOWNERS | ✅ **未使用**（且免费版无强制审批能力）|
| 15 | `windows-latest` 是否真需 Windows | ✅ **不需要**（纯 Git 操作可改 Linux）；且测试期不迁 `versioning.yml` |
| 16 | MVP Token 类型 | ✅ gitlab.com Free 使用短期个人 PAT；Project/Group Access Token 不可作为 Free 前提 |
| 17 | MVP MR 来源与信任边界 | ✅ 仅接收同项目 MR、拒绝 fork；但同项目 MR 内容仍按不可信输入处理，MR Pipeline 永不持有业务密钥 |
| 18 | 审查/评论入口 | ✅ Project Webhook 直接调用 Pipeline Trigger API，固定 ref 为 protected `main`；payload 通过 `TRIGGER_PAYLOAD` 进入串行 job |
| 19 | Protected Variable 使用方式 | ✅ 不依赖普通 feature-branch MR Pipeline；PAT/OpenAI Key 仅对 protected `main` trigger pipeline 可用 |
| 20 | 审查任务执行平台 | ✅ 不部署外部服务；使用 gitlab.com 共享 Runner 和 GitLab pipeline/job 记录，无 Kubernetes、云容器、PostgreSQL 或 Redis |
| 21 | 成本与流量阈值 | ✅ MVP 暂不设置每日预算、持久化限流或额外并发阈值；仅以全局 `resource_group` 串行保证功能，正式使用前再评估 |

### ⏸ 测试阶段推迟（进入正式迁移再确认）

22. 组织成员清单及 email——正式迁移做 user mapping 时需要（[4.4](#44-member)，测试期 3 人手工加）
23. Team / 权限结构如何映射 Group/Subgroup + 角色（[模块四](#四权限系统)，免费版能力受限）
24. Webhook 下游消费方（除本 Action 外是否还有其它系统接 GitHub webhook，[模块十](#十webhook)）
25. Open PR / 进行中 review 在正式迁移窗口如何处理
26. 历史数据迁移范围（Issue/PR/Release/Wiki——测试期不迁，正式期确认）
27. 是否有其它仓库一并迁移（本方案以单仓库为样本）
28. Runner：正式期是否继续用 gitlab.com 共享额度，还是自建接入

### ✅ 已确认（2026-07-20 补充闭环）

29. **数据主权 / 合规** → ✅ **允许代码托管公网 gitlab.com**，无保密障碍
30. **部署形态** → ✅ **确认为 gitlab.com SaaS**（非自建 EE）

### ⏸ 第二阶段才处理

31. **JiHu 第二阶段**：正式启动前根据当时实际版本重新设计，不继承旧的 EE 19.3→JiHu 18.2 假设

### ❓ 远端设置待核验（部分会阻塞正式迁移）

32. GitHub/GitLab 远端分支与 tag 全集、默认分支及 Branch Protection 规则。
33. GitHub Secret、Webhook、成员、Release、Open PR 和 Secret Scanning 的实际配置；只记录名称/状态，不导出 secret 值。

---

## 二十三、工作分解（WBS）

> 基于已确认决策（GitHub 主源 + 双平台兼容改造 + gitlab.com 免费版 + 3 人测试 MVP）。估算为单人经验值，随人力浮动。**关键路径 = 工作流 A**。

### 阶段一：测试验证 MVP（当前目标）

#### 工作流 S：现有 GitHub 安全止血（P0 前置门禁）

| # | 工作项 | 验收标准 | 估算 |
|---|--------|----------|------|
| S1 | 停用 `pull_request_target` checkout/执行 PR head 的路径；改为无密钥 `pull_request` 验证，或在完成两阶段权限分离前临时禁用 `openai-review.yml` | fork/恶意 PR head 不能在含 `GITHUB_TOKEN`、`OPENAI_API_KEY` 的上下文执行 | 0.5–1 天 |
| S2 | 强制轮换曾进入危险 workflow 的 OpenAI Key；复核历史 workflow run，并收紧 GitHub token/workflow permissions | 新 key 生效且仅为 protected `main` CI variable，旧 key 失效；run/权限快照留档 | 0.5 天 |
| S3 | 增加恶意 PR 回归用例：修改 Action、`dist/index.js`、依赖和脚本尝试读取密钥 | 测试证明 secret-bearing 执行面只运行默认分支代码 | 0.5–1 天 |

**S1–S3 是后续迁移工作的前置门禁；未通过时不得继续依赖现有 AI review workflow。**

#### 工作流 A：双平台兼容改造（产品代码与契约测试）

> 依据 [2.17](#217-github-action-的保留与双平台兼容改造)。实扫规模：约 13.5K 行 TS；**12 个文件包含 `octokit.*`，共 47 次调用**（旧式 `@octokit/action` 风格，无 `.rest` 命名空间）；**3 次直接 GraphQL 调用均位于 `src/github/review-thread.ts`**，`src/commands/handlers/resolve.ts` 只调用其封装；另有 **30 个文件直接引入 `@actions/core` 或 `@actions/github`**。因此 WBS 同时覆盖 API、运行上下文、输入配置和 Action 日志语义，不能只做 Octokit 替换。

| # | 工作项 | 依据 | 估算 |
|---|--------|------|------|
| A1 | 建平台无关 `ExecutionContext` / `ConfigProvider` / `Logger`；分别实现 `GitHubExecutionContext` 与 `GitLabExecutionContext`，保持 Action inputs 向后兼容，并消除业务层对平台 payload 的直接读取 | `src/main.ts`、`src/options.ts`、`src/inputs.ts` | 1–2 周 |
| A2 | 建 `IGitPlatform` 业务抽象层，把 47 处 Octokit 调用按 PR/MR、diff、thread/discussion、comment/note、成员权限和仓库内容能力收敛；GitHub adapter 保留 Octokit，GitLab adapter 以锁定版本的 `@gitbeaker/rest` 为标准客户端，统一处理 host/PAT/timeout、分页、错误和脱敏，原生 `fetch` 仅作 adapter 内受控 fallback；SDK 类型不得进入共享接口 | [octokit.ts](../src/octokit.ts)、`package.json` | 1–2 周 |
| A3 | 实现平台隔离的状态接口：GitHub 保留 PR body/summary/review marker，GitLab 使用 MR description/summary note/event marker；所有幂等键带平台命名空间，默认不跨平台同步 | [模块十一 11.1](#111-rest-api)、[0.7](#07-mvp-运行契约实施时不得降级) | 2–3 周 |
| A4 | 保留 GitHub GraphQL review-thread 实现，并新增 GitLab discussion 查询/resolve 实现；两者共同覆盖分页、已解决状态和部分失败 | `src/github/review-thread.ts` | 1 周 |
| A5 | 保留 GitHub Action 事件入口；实现 GitLab 事件规范化和 trigger CLI 产品代码，解析 file-type `TRIGGER_PAYLOAD`、区分 MR/Note Hook、仅在 HEAD SHA 变化时执行并在写评论前复核 HEAD；不包含 Webhook/token/CI 环境接入 | `src/main.ts` / `src/review.ts` | 1–2 周 |
| A6 | 共享命令解析与命令语义；分别适配 GitHub 权限/评论/reaction 和 GitLab access level/note/award emoji，并实现各自 bot/system/self-event 过滤和 fail-closed | `src/commands/` | 1–2 周 |
| A7 | lint/shell 安全改造——GitLab secret-bearing trigger job 强制关闭 shell/lint；GitHub 保留 annotation 能力但完成 P0 信任分离；平台特有输出只能位于对应 adapter | `src/bot.ts`、`src/lint/`、`action.yml` | 3–5 天 |
| A8 | 双平台单元与契约测试——同一 fixture 验证语义等价；覆盖 GitHub-only（无任何 GitLab 配置）、GitLab-only（无 GitHub Token/API）、同时启用、payload、分页、权限、行级定位、平台 marker 幂等、旧 SHA、反馈循环、`@gitbeaker/rest` 客户端契约和 adapter 禁止跨平台/跨层调用；真实 Webhook、CI variable、Runner 与恶意 MR 端到端验证归工作流 D | `__tests__/` | 1–2 周 |
| A9 | 改造打包工具链：增加 `package:github` / `package:gitlab`，分别生成 `dist/index.js` 和 `dist/gitlab-trigger/index.js`；防止构建互相覆盖，复制 WASM/license 等运行资产，将 `@gitbeaker/rest` 及其传递依赖纳入 GitLab bundle 的 license/供应链检查，并在 CI 校验两个 bundle 可启动且来自同一源 commit | `package.json`、`action.yml`、构建脚本 | 2–3 天 |

**工作流 A 合计约 9–16 周（单人串行估算）——这是整个测试阶段的关键路径。该估算不包含工作流 D 的 GitLab 项目接入和真实端到端联调。**

#### 工作流 B（精简版）：CI 与接入

| # | 工作项 | 估算 |
|---|--------|------|
| B1 | 编写 Node 24 `.gitlab-ci.yml`——MR head 在无业务密钥环境执行 build/test、`package:github`、`package:gitlab` 和双 bundle 冒烟测试；显式跳过 fork MR；不得把 MR 产物交给 protected `main` trigger job 执行 | 2–3 天 |
| B2 | 在 `ai-reviewer-test` 建空项目，推代码，保护 `main` | 0.5 天 |
| B3 | 配置短期个人 PAT 和轮换后的 OpenAI Key 为 Masked + Hidden + Protected variables；创建 Trigger token 和 Project Webhook | 0.5–1 天 |
| B4 | 提恶意测试 MR，验证无密钥 MR CI 与 protected `main` trigger job 分离，并完成 discussion 闭环 | 迭代 |

> 测试期不为 GitLab 实现 `versioning.yml`（windows tagger）和 `combine-prs.yml` 的等价能力；`sync-to-gitlab.yml` 不迁移到 GitLab，而是在 GitHub 端作为长期单向同步入口保留并加固。

#### 工作流 D：GitLab 接入配置与端到端联调（MVP 必做）

> 工作流 D 以 A5 交付的 trigger CLI 和 A9 交付的产物为输入，不重复实现产品代码或单元/契约测试。它与 21.7 是同一工作量的 WBS/步骤两种视图，工期只能计算一次。

| # | 工作项 | 估算 |
|---|--------|------|
| D1 | 将 A5/A9 产物接入 protected `main` trigger job，配置 `TRIGGER_PAYLOAD` 文件传递、目标项目/fork 校验和事件过滤的真实环境验证 | 3–5 天 |
| D2 | 配置全局 `resource_group`、CI rules、UI retry 和脱敏日志；验证 A3/A5 实现的 marker 去重与写前 HEAD 复核在真实 pipeline 中生效 | 2–4 天 |
| D3 | 配置 Project Webhook → Trigger API、protected variables 和 main trigger job；在不提供 GitHub Token/API 的环境完成 GitLab-only 验收，并覆盖重复投递、权限矩阵、旧 SHA、反馈循环、越权、恶意 MR 与密钥不可达；同时启用时验证不跨平台读写 | 2–3 天 |

**工作流 D 合计约 1.5–2.5 周（单人串行估算），可与 A2–A4 由不同人员并行，但必须在命令系统验收前完成。**

### 阶段二：双平台正式支持（测试通过后启动）

- 发布 GitHub/GitLab 功能兼容矩阵和平台专用配置指南。
- 建立两个 adapter、两个入口产物和 GitHub → GitLab 单向同步的持续回归。
- 历史 Issue/PR/Release/Wiki 复制、通知和 GitLab 版遗留 workflow 均为可选后续项，不是双平台运行的前置条件。

### 阶段三：可选 JiHu 迁移（未来重新立项）

- 不继承旧的 EE 19.3→JiHu 18.2 版本假设；以启动时的 gitlab.com 导出能力、JiHu 目标版本和官方支持矩阵重新设计。

---

## 附录 A：交付物清单

| 交付物 | 说明 |
|--------|------|
| 本方案文档 | 逐模块分析 + 兼容矩阵 + 步骤 + 待确认 |
| GitHub Action 入口 | 保留 `action.yml`、Action inputs 和 GitHub 事件入口；完成 P0 信任分离并保持用户功能向后兼容 |
| `.gitlab-ci.yml` | Node 24；MR head 仅执行无业务密钥的 build/test/package；protected `main` 提供 `CI_PIPELINE_SOURCE=trigger` 的串行 `ai-review-trigger` job |
| 平台上下文与配置层 | 业务核心不直接依赖平台；`GitHubExecutionContext`/`GitHubConfigProvider` 与 GitLab 对应实现均为正式支持路径 |
| 双平台 API 适配层 | GitHub adapter 保留 Octokit/GraphQL 能力；GitLab REST/GraphQL adapter 以锁定版本的 `@gitbeaker/rest` 为标准客户端，原生 `fetch` 仅作 adapter 内受控 fallback；二者共用不暴露 SDK 类型的业务接口 |
| 双入口构建产物 | `package:github` 生成 GitHub `dist/index.js`，`package:gitlab` 生成 GitLab `dist/gitlab-trigger/index.js`；包含所需 WASM/license 资产、`@gitbeaker/rest` 及其传递依赖的 license/供应链检查和启动冒烟测试，均可追溯到同一 GitHub 主源 commit |
| 单向同步链路 | 加固后的 `sync-to-gitlab.yml`；GitHub `main` → GitLab `main`，包含最小权限、并发互斥、SHA 校验和禁止反向同步约束 |
| Webhook/Trigger 配置 | MR/Note Project Webhook 指向固定 protected `main` 的 Trigger API；记录 trigger owner、目标 project/ref 和轮换日，不记录 token 值 |
| Trigger CLI | 读取 `TRIGGER_PAYLOAD`，完成项目/fork/事件/权限校验、bot/system/self-event 过滤、marker 去重、旧 SHA 退出和脱敏日志 |
| 平台隔离状态 marker | GitHub 保留 PR marker；GitLab 使用 MR description/summary note/event marker；幂等键带平台命名空间，不跨平台覆盖 |
| 密钥清单 | 分别记录 GitHub/GitLab 凭据的 owner/scope/到期日和轮换方式，不包含密钥值；证明普通不可信 PR/MR 执行面均不可访问业务密钥 |
| MVP 验收 checklist | GitHub P0 修复及功能回归；GitHub-only 无 GitLab 配置可运行；GitLab-only 无 GitHub Token/API/workflow 可运行；同时启用时不跨平台读写；另含 GitLab trigger 全链路、同 fixture 语义等价、平台状态隔离、单平台故障隔离、当前项目单向发布 SHA 一致，以及恶意 PR/MR 密钥不可达 |
| 可选历史数据附录 | 命名空间/角色映射、Issue/PR/Release/Wiki 复制、通知和 GitLab 版遗留 workflow；不作为双平台运行前置条件 |

## 附录 B：文档维护

- 本文位于 [docs/github-to-gitlab-migration-plan.md](./github-to-gitlab-migration-plan.md)。
- 每完成一个[待确认事项](#二十二待确认事项)，回填对应模块的「状态」（❓→✅/⚠️）。
- 建议在 [记忆索引](../memory/MEMORY.md) 增加本文入口，便于团队检索。

*—— 文档结束 ——*
