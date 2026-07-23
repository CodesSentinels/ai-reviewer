---
name: gitlab-migration-plan
description: GitHub↔GitLab 双平台兼容 MVP 项目状态、WBS 结构、P0 安全问题、关键架构决策
metadata:
  type: project
---

# GitHub↔GitLab 双平台兼容 MVP

**Why:** 项目决定保留 GitHub Action 作为正式运行路径，同时新增 GitLab 原生 MR 审查能力（gitlab.com Free SaaS，3 人测试项目 `CodesSentinels/ai-reviewer-test`）。两个平台可独立运行也可同时启用，互不读写状态；GitHub `main` 是唯一代码主源，`sync-to-gitlab.yml` 单向同步到 GitLab（不是产品运行时依赖）。方案文档来源：[[gitlab_migration_docs_source]]。

**How to apply:** 任何涉及 src/ 核心业务逻辑改动，需考虑是否会引入直接的平台依赖（GitHub payload/Octokit/GraphQL）——按计划应收敛到 `IGitPlatform` 抽象层，共享核心不得直接读取平台 payload。

## 当前仓库实扫状态（2026-07-23 验证，与方案文档一致）

- `src/` 约 13.5K 行 TS；**12 个文件含 `octokit.*` 调用**，**30 个文件直接引入 `@actions/core`/`@actions/github`**（已用 grep 复核，与文档数字吻合）。
- 无 `.gitlab-ci.yml`、无 `@gitbeaker/rest` 依赖、无任何 GitLab adapter 代码——GitLab 侧开发尚未开始。
- `.github/workflows/` 现有 4 个：`openai-review.yml`、`combine-prs.yml`、`versioning.yml`、`sync-to-gitlab.yml`（sync 已实现并加固，近期有多次 commit：restore --force push / remove --force / add sync workflow / add docs）。
- **P0 安全漏洞已在当前代码中确认存在**：`.github/workflows/openai-review.yml` 用 `pull_request_target` 触发，第 28-32 行显式 checkout PR head repo/ref，第 38-41 行 `uses: ./` 执行刚 checkout 的（PR 可控的）Action 代码，同时注入 `GITHUB_TOKEN` + `OPENAI_API_KEY`。这正是文档 SEC-001~SEC-005 / WBS S1-S3 描述的"不可信代码在特权上下文执行"问题，必须作为 P0 前置门禁最先修复，且需强制轮换已泄露风险的 OpenAI Key。

## 开发顺序（工作流 S → A → B/D，来自 TODO 文档第 2 章）

1. **工作流 S（P0 止血，0.5-1天+0.5天+0.5-1天）**：停用/改造 `pull_request_target` 直接执行 PR head 的路径；轮换 OpenAI Key；补恶意 PR 回归测试。**未完成前不得继续依赖现有 workflow。**
2. **工作流 A（共享核心与平台抽象，9-16周，关键路径）**：
   - `ExecutionContext`/`ConfigProvider`/`Logger` 平台无关抽象 + GitHub/GitLab 各自实现
   - `IGitPlatform` 收敛现有 47 处 Octokit 调用；GitHub adapter 保留 Octokit/GraphQL，GitLab adapter 以锁定版本 `@gitbeaker/rest` 为标准客户端（原生 `fetch` 仅作 SDK 未覆盖时的受控 fallback），SDK 类型不得泄露到共享层
   - 平台隔离状态/marker（`github:`/`gitlab:` 命名空间，不跨平台同步）
   - repository tree/跨文件依赖分析平台无关化（`repo-tree.ts`/`dependency-analyzer.ts` 需去除 `@actions/*` 依赖）
   - 双入口打包：`package:github`→`dist/index.js`，`package:gitlab`→`dist/gitlab-trigger/index.js`
3. **工作流 B（精简 GitLab CI，2-3天）**：`.gitlab-ci.yml` 只在 MR head 跑无密钥 build/test/package；`versioning.yml`/`combine-prs.yml` 本轮不做 GitLab 等价实现。
4. **工作流 D（GitLab 接入与端到端联调，1.5-2.5周）**：Project Webhook → Pipeline Trigger API → protected `main` 的 `ai-review-trigger` job；全局 `resource_group: ai-reviewer-mvp` 串行执行。

## 关键架构/安全约束（不可降级，来自 0.7 MVP 运行契约）

- GitLab MVP **拒绝 fork MR**；即使同项目 MR，MR head 仍按不可信代码处理，MR Pipeline 永远拿不到业务密钥（PAT/OpenAI Key 只对 protected `main` trigger job 可见）。
- GitLab secret-bearing trigger 强制 `enable_shell=false` + `enable_lint_tools=false`，仓库配置/MR payload/Note payload 均不得重新开启。
- 命令权限用 GitLab access level（Developer+ 大部分命令，Reporter+ 用于 `configuration`，`help` 对可见成员开放），MR 作者豁免 `help`/`review`/`full review`/`summary`，不豁免 `pause`/`resume`/`resolve`。
- GitLab 免费版红线：无 CODEOWNERS、无强制 Approval Rule、无 Project/Group Access Token（用短期个人 PAT 代替）、无 Merge Train/Epic/Roadmap。
- 每次写 note/discussion 前必须重新读取 MR 当前 HEAD SHA，不一致则退出不写旧结果。

## 文档标注的"当前有效"章节

文档 [[gitlab_migration_docs_source]] 中第一~二十章大量标注为"历史/未核验"（针对已作废的自建 EE/JiHu 假设），**只有 0.2、0.5、0.6、0.7、二十一、二十三章及 TODO/runtime-differences 两份文档是当前 gitlab.com Free MVP 的实施依据**，其余章节仅供未来 JiHu 立项时重新核验参考，不能直接拿来配置当前 MVP。
