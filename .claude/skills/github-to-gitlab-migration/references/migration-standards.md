# 双平台兼容改造 · 产出规范

本 reference 定义 `ai-reviewer` 双平台兼容产出的验收规范，只回答「代码、测试和任务是否达标」。任务定位与顺序见主 [SKILL.md](../SKILL.md)。

迁移目标与验收基线：[TODO](../../../../docs/github-gitlab-compatibility-todo.md) · [实施方案](../../../../docs/github-to-gitlab-migration-plan.md) · [运行差异](../../../../docs/github-vs-gitlab-runtime-differences.md)。当前实现事实以源码、`action.yml` 和 `package.json` 为准；仓库规则以根 [CLAUDE.md](../../../../CLAUDE.md) 为准。发现冲突时不要静默选择一方，应报告漂移并只在任务授权范围内同步修正。

## 目录

- [A. 代码与架构规范](#a-代码与架构规范)
- [B. 测试与验收规范](#b-测试与验收规范)
- [C. 文档与追溯规范](#c-文档与追溯规范)
- [完成前自检清单](#完成前自检清单)

---

## A. 代码与架构规范

### A1 平台无关性(共享核心)
- 共享核心(`review.ts`、`commenter.ts`、命令 handler、prompt 构造器、`dependency-analyzer.ts`、`repo-tree.ts` 等)**只读取规范化配置**,不得直接读取:
  - 平台 payload 字段、`GITHUB_EVENT_NAME`、GitHub context、GitLab 原始 payload;
  - `@actions/core` / `@actions/github`(GitHub-only 能力只留在 GitHub adapter);
  - `getInput()` / `getBooleanInput()` / 环境变量直读(只保留在 `GitHubConfigProvider`)。
- 运行 `../scripts/check-platform-boundaries.sh` 做确定性扫描；脚本失败时逐项修复或记录尚未完成的 TODO，不以人工忽略误报代替边界测试。

### A2 adapter 边界
- GitHub adapter 只调 GitHub API;GitLab adapter 只调 GitLab API。**任一 adapter 不引用另一平台的 API/类型/常量**。
- `@gitbeaker/rest` 的实例、请求参数、响应类型、错误类型**只存在于 GitLab adapter/client 层**,不得出现在 `IGitPlatform` 接口或共享业务核心的签名里。
- GitLab 标准客户端是**锁定版本的 `@gitbeaker/rest`**;仅当 SDK 未覆盖某 endpoint 或行为不满足契约时,才在 adapter 内用 Node 24 原生 `fetch` 作 fallback,且必须复用统一认证/超时/脱敏/分页/重试/错误规范化。业务层禁止直接 `fetch`。

### A3 类型边界与错误语义
- PR number、MR IID、comment/note ID、thread node ID、discussion ID 建立**类型边界**,不互相混用。
- 分页、429、5xx、超时、404/409、权限不足有**统一错误语义**,两平台一致。
- payload 缺失、格式错误、事件未知、权限查询失败一律 **fail closed**(退出且不写结果),不 fail open。

### A4 状态与命名空间隔离
- marker 和幂等键必须带 `github:` / `gitlab:` 命名空间;禁止用相同 commit SHA 合并两平台任务状态。
- 写 note/discussion/description 前**重新读取当前 HEAD SHA**;与 payload 不一致则退出,不写旧结果。
- description 更新用「读最新值 → 仅改指定 marker 区域 → 条件写入」,同时保留 pause/resume、release notes 和用户原始内容;版本冲突时重读后有限重试,不用旧快照覆盖。

### A5 安全执行面(不可协商)
- 普通 PR/MR head 执行面**绝不**持有 `OPENAI_API_KEY`、写权限 PAT、同步 Token、Trigger token;用环境变量**允许列表**而非黑名单。
- GitLab secret-bearing trigger **强制** `enable_shell=false`、`enable_lint_tools=false`;仓库配置、MR/Note payload 均不得重新开启。
- secret-bearing job 只运行受保护默认分支代码,不 checkout/执行/加载 MR head 的代码、脚本、依赖或产物。
- 日志脱敏覆盖 Header、URL query、异常对象、环境变量、debug 输出;不打印 token 或带 token 的 URL。

### A6 不删功能
- 保留 `action.yml`、现有 Action inputs、Octokit/GraphQL 能力、评论命令语义。安全修复不得以删除现有 GitHub 功能代替。
- 已声明输入才可读取;代码读取但 `action.yml` 未声明的输入必须正式声明、改内部测试注入或删除,不允许静默读取。

---

## B. 测试与验收规范

### B1 分层测试与三模式覆盖
- 单个内部任务：运行与改动直接相关的单元、契约或架构测试。
- 完成 TODO §15 的一个用户可见功能行：验证以下三种模式，缺一不算该功能完成。
- 跨越阶段门禁或发布前：运行完整 §15 验收矩阵和对应 E2E 故障注入。

三种模式：
- **GitHub-only**:无任何 GitLab URL/PAT/Webhook/Runner/变量,或 GitLab API 不可达时全功能通过;
- **GitLab-only**:无 GitHub Token、阻断 GitHub API、不依赖 GitHub workflow 时全功能通过;
- **同时启用**:同一 commit 的 PR/MR 分别审查,评论/线程/marker/幂等键/重试状态不跨平台读写;一平台故障不影响另一平台。

### B2 语义等价测试
- 同一 fixture 在两平台产生**语义等价**的 summary、行级问题、命令结果、依赖候选、release notes。
- 允许平台 URL、ID、作者、展示格式不同;不允许业务结论不同。

### B3 契约测试(GitLab adapter)
- 覆盖:自定义 host、PAT 注入、timeout、分页、snake_case 响应、429/5xx、401/403、404/409、网络错误、日志脱敏。
- 不得把 SDK 默认行为直接当作 `IGitPlatform` 语义——要为分页/字段/状态码/错误对象建立适配层契约。

### B4 架构测试
- 自动阻止共享核心新增直接平台依赖:GitHub adapter 不依赖 GitLab,GitLab adapter 不依赖 GitHub;共享核心不导入 `@gitbeaker/rest` 或直接调 GitLab `fetch`。

### B5 安全回归测试
- 恶意 PR/MR 修改 reviewer 源码、`dist` bundle、workflow/`.gitlab-ci.yml`、package scripts/依赖/install hooks,均不能读取业务密钥。
- fork MR 被拒;bot/system/self event 不调用模型;API 错误/异常堆栈/debug log 不含 secret。

### B6 幂等与陈旧任务
- MR Hook 幂等键含 project/MR/head SHA;Note Hook 含 project/MR/note/action。重复 payload、job Retry、缺必填字段均不得重复调用模型或回复。
- 旧 SHA pipeline 即使运行也不写旧评论。

---

## C. 文档与追溯规范

### C1 TODO 勾选
- 只有任务实现和对应验证证据完整，且当前请求包含实现/进度回填时，才在 [TODO 文档](../../../../docs/github-gitlab-compatibility-todo.md) 勾选对应 `[ ]`。
- review、诊断、设计讨论、局部实验或未通过门禁的工作不得勾选。
- 完成一个用户可见功能行后，回填 §15 验收矩阵对应单元格。

### C2 待确认项回填
- 若工作解决了[实施方案](../../../../docs/github-to-gitlab-migration-plan.md) §二十二 的待确认项,回填对应模块「状态」(❓ → ✅/⚠️),保持结论与代码一致。

### C3 变更追溯到任务 ID
- 每处改动应可追溯到一个任务 ID(SEC-/ARCH-/CFG-/… 见 [task-index](task-index.md))。改动说明用任务 ID 而非临时描述。
- 产物或构建日志记录源 commit SHA;两个 bundle 可追溯到同一 GitHub 主源 commit。

### C4 记忆索引
- 只有形成需要长期复用的架构结论、已有项目流程明确要求，或用户要求记录时，才在 [MEMORY.md](../../../../memory/MEMORY.md) 增一行索引；迁移进度仍以 TODO 为唯一进度来源，不重复维护状态。

### C5 范围控制
- 遵循项目根 [CLAUDE.md](../../../../CLAUDE.md) 中实际存在的仓库规则。
- 不新建辅助 README、变更日志或重复设计文档；只在 C1–C4 条件满足或用户明确要求时更新已有文档。

### C6 索引一致性
- 修改 TODO 任务前缀或新增任务族后，运行 `../scripts/validate-task-index.sh`，确保 `task-index.md` 与 TODO 一致。

---

## 完成前自检清单

判断一项工作「是否算完成」时逐条过:

1. 共享核心没有新增平台直读(A1)?adapter 边界没被打破、SDK 类型没泄露(A2)?
2. marker/幂等键带命名空间、写前复核 HEAD(A4)?
3. secret-bearing 面无业务密钥、shell/lint 强制关闭(A5)?
4. 已按任务层级运行单元/契约/架构测试；完成功能或跨门禁时三模式测试到位(B1)?
5. 语义等价、契约、架构、安全回归测试到位(B2–B5)?
6. 仅在证据完整且请求授权时勾选 TODO，并按需回填验收矩阵/待确认项(C1–C2)?
7. 改动可追溯到任务 ID(C3)?
8. 平台边界与任务索引脚本通过，或失败项已明确对应未完成任务(A1、C6)?

任一条不满足 → 未完成,继续做,不提前勾选。
