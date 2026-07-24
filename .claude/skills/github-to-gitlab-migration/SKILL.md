---
name: github-to-gitlab-migration
description: >-
  ai-reviewer 的 GitHub / GitLab 双平台兼容任务导航与实施流程。用于定位迁移任务、判断开发顺序和门禁、
  查找设计依据，或实施共享核心、GitHub Action/Octokit adapter、GitLab trigger CLI/@gitbeaker/rest
  adapter、双入口打包、GitLab CI/Webhook，以及 review 迁移代码/测试、执行门禁检查、勾选 TODO
  或判断任务是否完成。覆盖 SEC/ARCH/CFG/DEP/GH/EVENT/GLAPI/REVIEW/WS/LOCAL/LINT/CMD/
  STATE/BUILD/CI/SYNC/TEST 任务。
---

# GitHub / GitLab 双平台兼容开发

本 skill 负责在 `ai-reviewer` 中定位、实施和验收 GitHub/GitLab 双平台兼容任务。开始修改代码、测试、workflow、CI，review 迁移产出或勾选任务前，必须完整读取 [产出规范](references/migration-standards.md) 并按其完成分层验证。

## 信息来源与优先级

1. 遵循用户明确指令和根 [CLAUDE.md](../../../CLAUDE.md) 中的仓库规则。
2. 迁移目标、范围和验收基线以以下三份迁移文档为准。
3. 当前实现、输入和依赖事实以源码、`action.yml`、`package.json` 为准。
4. 文档与代码冲突时，报告具体漂移；只在当前任务授权范围内修正，不静默选择或扩大修改范围。

改动前读取与任务相关的章节：

- **[兼容开发 TODO List](../../../docs/github-gitlab-compatibility-todo.md)** — 全部任务项（带 ID）、开发顺序门禁、验收矩阵、完成条件。**这是任务清单入口。**
- **[双平台兼容实施方案](../../../docs/github-to-gitlab-migration-plan.md)** — 逐模块分析、MVP 运行契约（§0.7）、免费版红线（§0.5）、工作分解 WBS（§二十三，工作流 S/A/B/D）。**这是设计与依据入口。**
- **[运行及交互差异](../../../docs/github-vs-gitlab-runtime-differences.md)** — 两平台运行架构、命令权限基线、评论/discussion 对象差异、身份与 @mention 差异。**这是行为对照入口。**

`references/task-index.md` 给出任务 ID 前缀 → WBS 工作流 → 关键源文件的速查映射。

## 不可违背的核心原则（TODO §1 + 方案 §0.7）

1. **平台独立运行**：GitHub 与 GitLab 必须能分别独立运行，也可同时启用。GitHub-only 不需要任何 GitLab URL/PAT/Webhook/Runner/API；GitLab-only 运行时不访问 GitHub Token/API/workflow。
2. **adapter 不跨平台**：GitHub adapter 不调用 GitLab API，GitLab adapter 不调用 GitHub API。任一平台故障不得阻塞另一平台。
3. **状态隔离**：不跨平台读取或同步 PR/MR、评论、线程、marker、事件和重试状态。marker 与幂等键必须带 `github:` / `gitlab:` 命名空间。
4. **共享核心平台无关**：`review.ts`、`commenter.ts`、命令 handler、prompt 构造器等只读取规范化配置，不直接读取平台 payload、`GITHUB_EVENT_NAME`、`@actions/*` 或调用平台 API。`@gitbeaker/rest` 的实例/类型/错误只能存在于 GitLab adapter 层，不得泄露到 `IGitPlatform` 或业务核心。
5. **不删功能**：保留 GitHub Action、现有 Action inputs、Octokit/GraphQL 和评论命令。安全修复不得以删除现有 GitHub 功能代替。
6. **不可信执行面隔离**：GitLab secret-bearing job 只运行受保护默认分支中的可信代码，只把 MR diff/文件内容当作数据读取；绝不执行 MR head 代码、脚本、依赖或产物。

## 开发顺序与门禁（TODO §2，必须按序推进）

| 顺序 | 工作流 | 门禁（未过不得进入下一步） |
|------|--------|----------|
| 1 | GitHub P0 安全修复（`SEC-*`） | 不可信 PR 代码无法接触业务密钥 |
| 2 | 共享核心和平台接口（`ARCH-*` `CFG-*` `DEP-*`） | 业务层不直接读取平台 payload 或调用平台 API |
| 3 | GitHub adapter 回归（`GH-*`） | GitHub-only 全功能通过 |
| 4 | GitLab adapter 与 trigger CLI（`EVENT-*` `GLAPI-*`） | GitLab 单元和契约测试通过 |
| 5 | 双入口打包和 GitLab CI（`BUILD-*` `CI-*`） | 两个 bundle 可独立启动 |
| 6 | GitLab 端到端验收（`REVIEW-*` `CMD-*` `WS-*`） | GitLab-only 全功能通过 |
| 7 | 双平台隔离验收（`STATE-*` `TEST-*`） | 同时启用互不读写，单平台故障不影响另一平台 |

`SEC-*`（工作流 S / 方案 §21.1 / WBS S1–S3）是高权限接入的**前置门禁**。未完成 P0 止血时：

- 不得启用、部署或依赖 secret-bearing reviewer；
- 不得接入真实业务密钥或执行高权限端到端验证；
- 可以并行开发不接触密钥的平台接口、纯函数、adapter 和单元/契约测试，但不得把这些工作描述为已跨过安全门禁。

## 安全红线

安全实现与验收细节统一见 [产出规范 §A5/B5](references/migration-standards.md)。任务导航阶段至少确认：不可信 PR/MR 执行面无业务密钥、secret-bearing job 只运行受保护默认分支代码、GitLab 本地 shell/lint 强制关闭、fork MR fail closed。

## 关键技术决策（照此实现，勿另起方案）

- **GitLab 客户端**：标准客户端是**锁定版本的 `@gitbeaker/rest`**，经统一 client factory 注入受信任 host/PAT/timeout。仅当 SDK 未覆盖某 REST endpoint 或行为不满足契约时，才在 adapter 内使用 Node 24 原生 `fetch` 作受控 fallback（复用统一认证/超时/脱敏/分页/重试/错误规范化）。业务层不得直接 `fetch`。
- **双入口**：GitHub `dist/index.js`（`package:github`，从 `lib/main.js`）；GitLab `dist/gitlab-trigger/index.js`（`package:gitlab`，从 `lib/gitlab-trigger.js`）。防止两次 `ncc` 互相覆盖，两个 bundle 都要复制 `tiktoken_bg.wasm` 和 license 资产。
- **GitLab 事件入口**：Project Webhook → Pipeline Trigger API，固定 ref 为 protected `main`；原始 payload 经 file-type `TRIGGER_PAYLOAD` 传入。无外部 Receiver/队列/数据库。
- **并发**：GitLab MVP 用全局 `resource_group: ai-reviewer-mvp` 串行；GitHub 保留 `concurrency.group`。
- **幂等键**：MR 自动审查 `gitlab:{project_id}:{mr_iid}:head:{head_sha}`；Note Hook `gitlab:{project_id}:{mr_iid}:note:{note_id}:create`。只用 `TRIGGER_PAYLOAD` body 中可验证的字段，不依赖 Webhook Header。
- **命令权限**：按 GitLab access level 映射（不按角色名字符串猜测）。`review`/`full review`/`summary` 允许 MR 作者豁免；`pause`/`resume`/`resolve` 不豁免；`configuration` 需 Reporter+；`help` 对可见成员开放。权限查询失败一律 fail closed。
- **写操作前**：重新读取当前 HEAD SHA，与 payload 不一致则退出且不写旧结果；description 更新用「读最新值 → 仅改指定 marker 区域 → 条件写入」，保护 pause/resume、release notes 和用户原始内容。

## 工作方式

1. **定位任务**：从 TODO 文档找到任务 ID，用 `references/task-index.md` 找到对应 WBS 工作流和源文件，读方案文档的对应模块理解**依据**，读差异文档理解**两平台行为对照**。
2. **核对现状**：检查对应源码、`action.yml`、依赖和测试，区分“现有实现”与“目标设计”；发现漂移时明确报告。
3. **确认门禁**：判断任务是否会接触真实密钥、高权限 workflow/CI 或部署。P0 未完成时，只允许前述隔离开发。
4. **实现**：按 [产出规范](references/migration-standards.md) 执行，并持续检查 GitHub-only、GitLab-only、同时启用是否会串平台状态。
5. **分层测试**：内部任务运行相关单元/契约/架构测试；完成功能行时验证三模式；跨阶段门禁或发布前运行完整 §15 矩阵和 E2E 故障注入。
6. **勾选与回填**：仅当当前请求包含实现/进度回填且验收证据完整时勾选 TODO。review、诊断、局部实验不勾选；解决方案 §二十二待确认项时再回填对应状态。

## 范围约束（勿超范围）

MVP **不做**：历史数据迁移（Issue/PR/Release/Wiki）、通知渠道、Team→Subgroup 权限映射、多人 Approval、CODEOWNERS、Dependabot→Renovate、Packages/Pages、安全扫描、`versioning.yml`/`combine-prs.yml` 的 GitLab 等价实现、JiHu 迁移、Redis/数据库/持久化限流。`sync-to-gitlab.yml` 作为长期单向同步链路保留并加固（`SYNC-*`），不反向同步、不形成循环。
