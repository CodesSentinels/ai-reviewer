# 任务 ID 速查：前缀 → WBS 工作流 → 关键源文件

跨三份文档的映射。任务条目全文见 [TODO List](../../../../docs/github-gitlab-compatibility-todo.md)；设计依据见 [实施方案](../../../../docs/github-to-gitlab-migration-plan.md)（章节/WBS）；行为对照见 [运行差异](../../../../docs/github-vs-gitlab-runtime-differences.md)。

| ID 前缀 | 主题 | TODO 章节 | WBS 工作流 | 方案依据章节 | 关键源文件 |
|---------|------|-----------|-----------|--------------|-----------|
| `SEC-*` | GitHub workflow P0 安全止血 | §3 | S1–S3（前置门禁） | §1.9, §2.1, §2.10, §21.1 | `.github/workflows/openai-review.yml` |
| `ARCH-*` | ExecutionContext / ConfigProvider / Logger / IGitPlatform | §4.1–4.4 | A1, A2, A4 | §2.17, §10.2, §11.1, §11.2 | `src/main.ts`, `src/options.ts`, `src/inputs.ts`, `src/octokit.ts`, `src/github/review-thread.ts` |
| `CFG-*` | 公开配置 schema / GitHub input↔GitLab 映射 / Semgrep 漂移 / 规范化 | §4.2 | A1, A7 | §0.7, §2.13 | `action.yml`, `src/options.ts`, `src/inputs.ts`, `src/lint/` |
| `DEP-*` | Repository tree / 跨文件依赖分析 | §4.5 | A2 | §2.17 | `src/dependency-analyzer.ts`, `src/repo-tree.ts` |
| `GH-*` | GitHub adapter 回归（入口/评论/状态/回归） | §5.1–5.4 | A2, A3, A5, A6 | §2.17, §6, §11 | `src/main.ts`, `src/commenter.ts`, `src/github/` |
| `EVENT-*` | GitLab trigger CLI / MR Hook / Note Hook | §6.1–6.3 | A5 | §0.7, §10.3 | 新增 `src/gitlab-trigger.ts`, GitLab event 规范化 |
| `GLAPI-*` | GitLab API adapter（项目/MR/Notes/Discussions/权限/Emoji/稳定性） | §7.1–7.5 | A2, A4 | §5, §11.1, §11.2 | 新增 GitLab adapter/client (`@gitbeaker/rest`) |
| `REVIEW-*` | 共享审查核心 / 摘要 / 行级问题 / 对话 / Release notes | §8.1–8.6 | A5, A6 | §0.7, §六 | `src/review.ts`, `src/prompts.ts`, `src/bot.ts` |
| `WS-*` | Web Search 平台无关能力 | §8.5 | A6 | §0.7 | `src/bot.ts`, ConfigProvider |
| `LOCAL-*` `LINT-*` | 本地工具安全 / API-only 降级 | §8.7 | A7 | §0.7, §2.10 | `src/bot.ts`, `src/lint/`, `action.yml` |
| `CMD-*` | 评论命令解析/权限/行为/限流 | §9.1–9.4 | A6 | §0.7, §四 | `src/command-handler.ts`, `src/commands/` |
| `STATE-*` | 状态/幂等/并发/重试 | §10 | A3 | §0.7, §七, §10.3 | 平台状态接口, marker 实现 |
| `BUILD-*` | 双入口打包 | §11 | A9 | §2.17 | `package.json`, `action.yml`, 构建脚本 |
| `CI-*` | GitLab CI（MR verify job / trigger job） | §12 | B1, D1–D3 | §3.1, §10.3 | 新增 `.gitlab-ci.yml` |
| `SYNC-*` | 单向发布 workflow 加固 | §13 | B（保留） | §1.8, §2.4 | `.github/workflows/sync-to-gitlab.yml` |
| `TEST-*` | 单元/契约/语义等价/独立运行/安全测试 | §14 | A8, D3 | §二十三验收 | `__tests__/` |

## 开发门禁顺序（对应 TODO §2）

```
1. SEC-*  (工作流 S，前置门禁)
2. ARCH-* CFG-* DEP-*  (工作流 A：共享核心)
3. GH-*  (GitHub adapter 回归)
4. EVENT-* GLAPI-*  (GitLab adapter + trigger CLI)
5. BUILD-* CI-*  (双入口打包 + GitLab CI)
6. REVIEW-* CMD-* WS-* LOCAL-* LINT-*  (GitLab 端到端)
7. STATE-* TEST-*  (双平台隔离验收)
```

## WBS 工期参考（方案 §二十三，单人串行经验值）

- 工作流 S（P0 止血）：约 1.5–2.5 天，**前置门禁**。
- 工作流 A（共享核心 + 双 adapter + 双入口，关键路径）：约 9–16 周。
- 工作流 B（精简 MR CI + 项目接入）：约 2–3 天 + 迭代。
- 工作流 D（GitLab 接入配置与端到端联调）：约 1.5–2.5 周（= §21.7，与 A2–A4 可并行，工期只计一次）。

## 验收矩阵（TODO §15）

每个功能项必须在 **GitHub-only / GitLab-only / 同时启用** 三列全部通过。平台状态隔离和单平台故障隔离仅在「同时启用」列有效（其余为 N/A）。
