# 单向发布 Workflow 加固设计文档（SYNC-001 ~ SYNC-009）

## 0. 参考文档

- [兼容开发 TODO List](../github-gitlab-compatibility-todo.md) 第 13 章
- [双平台兼容实施方案](../github-to-gitlab-migration-plan.md) §1.8 Mirror Repository、§2.4 `sync-to-gitlab.yml`
- [GitLab CI 开发设计文档](./gitlab-ci-design.md)（消费方——`ai_review_trigger` 信任的 `main` 内容由本任务加固的同步链路产出）

---

## 1. 背景与现状

`docs/github-gitlab-compatibility-todo.md` 第 13 章"单向发布 Workflow 开发"（`SYNC-001~009`）此前全部未开始。`.github/workflows/sync-to-gitlab.yml` 已存在（历史上经过 PR #77 加了 `workflow_dispatch` 手动同步任意分支的能力，PR 见 `dc5817f`/`caaacc4`），当前内容：

```yaml
on:
  push:
    branches: [main, develop]
  workflow_dispatch:
    inputs:
      branch: {required: true, default: 'develop'}   # 无校验，可填任意分支名

jobs:
  sync:
    steps:
      - checkout（fetch-depth: 0，ref 取 inputs.branch 或 github.ref_name）
      - git push gitlab "HEAD:refs/heads/${SYNC_BRANCH}" --force   # 硬编码目标仓库 URL
```

实施方案 §1.8/§2.4 已经把方向定死："GitHub → GitLab 单向同步，长期保留并加固；GitLab `main` 是受保护运行镜像，不接受直接 push/MR 合并，不反向写回 GitHub"。本任务是"加固"，不是重新设计同步机制或换成 GitLab Pull Mirror（那是文档里提到的备选方案，本任务不涉及）。

### 已确认满足的部分

- 目标仓库 URL 是硬编码字面量（`https://oauth2:${GITLAB_TOKEN}@gitlab.com/CodesSentinels/ai-reviewer.git`），不是可被外部输入覆盖的变量——`SYNC-002` 的"固定目标 URL"部分已满足。
- 自动触发（`on.push`）只监听 `main`/`develop`，不含 tag——`SYNC-008` 的自动触发路径已满足。
- 本 workflow 与 `openai-review.yml` 是完全独立的两个文件，互不 `needs`/触发，同步失败不可能连带影响审查 workflow——`SYNC-005` 结构性已满足。
- 只做单向 push，没有任何读取 GitLab 状态并写回 GitHub 的代码路径——`SYNC-006` 结构性已满足。
- `GITLAB_TOKEN`（同步专用、有 GitLab 写权限）只在这个 workflow 里以 secret 形式出现；`src/`（GitLab-only 运行代码）用的是完全不同的 `GITLAB_PAT`/`CI_JOB_TOKEN`，两者不重合——`SYNC-009` 结构性已满足，第 4 节加一条测试钉死。

### 确认的真实缺口

- **`SYNC-003`（concurrency）**：完全缺失，workflow 里没有 `concurrency:` 键。连续两次 push 到同一分支时，两次同步 job 可能并发跑，`--force` push 的完成顺序不保证跟触发顺序一致，存在旧同步覆盖新提交的竞态。
- **`SYNC-004`（push 后 SHA 比对）**：完全缺失，`git push --force` 执行完就算成功，没有任何一步去确认 GitLab 那边真的收到了这次推送的内容。
- **`SYNC-008`（分支白名单，`workflow_dispatch` 路径）**：`on.push.branches` 限制了自动触发，但 `workflow_dispatch.inputs.branch` 是自由文本输入，没有任何校验——手动触发时可以填任意分支名，把仓库里的任何分支（不只是 `main`/`develop`）强推到 GitLab 上同名分支，绕开了"只同步受信任分支"这个约束。

---

## 2. 目标（对应 TODO 条目）

| 编号 | 内容 | 本设计如何满足 |
|:---|:---|:---|
| `SYNC-001` | 审查并加固 workflow | 本文档整体 |
| `SYNC-002` | 固定源/目标仓库与 `main` 分支 | 第 3.1 节（补齐分支白名单） |
| `SYNC-003` | concurrency，防止旧同步覆盖新提交 | 第 3.2 节 |
| `SYNC-004` | push 后自动比较 SHA | 第 3.3 节 |
| `SYNC-005` | 同步失败不影响审查 workflow | 已满足，第 4 节测试锁定 |
| `SYNC-006` | 防止反向触发/同步循环 | 已满足，第 4 节测试锁定 |
| `SYNC-007` | 重复同步幂等 | 已满足（force push 同 SHA 是 no-op），第 4 节测试锁定 |
| `SYNC-008` | tag/其他分支默认不同步，显式白名单 | 第 3.1 节 |
| `SYNC-009` | GitLab reviewer 代码不读同步 Token | 第 4 节测试锁定 |

---

## 3. 设计方案

### 3.1 SYNC-002/008：分支白名单，堵住 `workflow_dispatch` 的自由输入

在 checkout 之前新增一步，`push`/`workflow_dispatch` 两条触发路径统一校验：

```yaml
- name: Validate branch allowlist
  env:
    SYNC_BRANCH: ${{ github.event.inputs.branch || github.ref_name }}
  run: |
    case "$SYNC_BRANCH" in
      main|develop) echo "ok: $SYNC_BRANCH is in sync allowlist" ;;
      *)
        echo "REFUSED: '$SYNC_BRANCH' is not in the sync allowlist (main, develop)" >&2
        exit 1
        ;;
    esac
```

放在拿到 `GITLAB_TOKEN` 之前——白名单校验失败时 job 直接退出，后续 checkout/push 步骤都不会执行，`workflow_dispatch` 不再能同步任意分支。`push` 触发路径本来就只有 `main`/`develop` 能走到这一步，这条检查对它是纯粹的冗余保险，不改变行为。

### 3.2 SYNC-003：concurrency

```yaml
concurrency:
  group: sync-to-gitlab-${{ github.event.inputs.branch || github.ref_name }}
  cancel-in-progress: true
```

按目标分支分组——`main`、`develop` 各自的同步互不影响，同一个分支如果短时间内触发了两次（连续 push、或 push 后紧接着手动 dispatch 同一分支），先跑的那个会被取消，只有最后一次触发的会真正跑完、推送。避免"旧的那次跑得比新的那次慢，最后把新内容覆盖回旧内容"。

### 3.3 SYNC-004：push 后 SHA 比对

```yaml
- name: Verify GitLab received the pushed SHA
  env:
    GITLAB_TOKEN: ${{ secrets.GITLAB_TOKEN }}
    SYNC_BRANCH: ${{ github.event.inputs.branch || github.ref_name }}
  run: |
    LOCAL_SHA=$(git rev-parse HEAD)
    GITLAB_SHA=$(curl -sf --header "PRIVATE-TOKEN: ${GITLAB_TOKEN}" \
      "https://gitlab.com/api/v4/projects/CodesSentinels%2Fai-reviewer/repository/branches/${SYNC_BRANCH}" \
      | jq -r '.commit.id')
    if [ "$GITLAB_SHA" != "$LOCAL_SHA" ]; then
      echo "SYNC FAILED: GitLab $SYNC_BRANCH is at $GITLAB_SHA, expected $LOCAL_SHA" >&2
      exit 1
    fi
    echo "OK: GitLab $SYNC_BRANCH confirmed at $LOCAL_SHA"
```

用 GitLab REST API（`GET /projects/:id/repository/branches/:branch`）读回 GitLab 那边这个分支当前的 HEAD commit，跟本地刚推送的 `HEAD` 比对。不一致就让 job 失败——这是第 12 章 `ai_review_trigger` 信任链的上游保证：`CI-013` 校验"bundle 记录的 source commit 等于当前 `CI_COMMIT_SHA`"，前提是 GitLab `main` 上的内容确实等于 GitHub `main` 推送时的内容，本步骤就是在验证这个前提。

`jq` 在 GitHub-hosted `ubuntu-latest` runner 上预装，不需要额外安装步骤。

---

## 4. 任务拆分与测试

- `.github/workflows/sync-to-gitlab.yml`：加白名单校验、`concurrency`、SHA 校验三步，不改动已有的 checkout/push 逻辑。
- `__tests__/workflow-security.test.ts`：复用已有的 workflow 解析基础设施（`loadWorkflows()`），新增 `SYNC-*` 相关 describe 块：
  - `sync-to-gitlab.yml` 配置了 `concurrency`（`SYNC-003`）。
  - `workflow_dispatch.inputs.branch` 前面存在一个校验分支白名单的 step（用正则匹配脚本里出现 `main|develop` 形式的 case 语句，防止有人删掉这一步）。
  - `sync-to-gitlab.yml` 里不存在任何 `needs:`/触发关系指向 `openai-review.yml`，反之亦然（`SYNC-005`/`SYNC-006` 结构性锁定）。
- 新增一条跨仓库守卫：`src/` 下不得出现 `GITLAB_TOKEN`（区别于 `GITLAB_PAT`/`CI_JOB_TOKEN`）——放进 `arch-guard.test.ts`，跟 `ARCH-005`（禁止读 `execCtx.raw`）那类"防止敏感字符串误用"的守卫是同一种模式（`SYNC-009`）。

---

## 5. 验收标准

- `.github/workflows/sync-to-gitlab.yml` 能被 `js-yaml` 解析，`concurrency`/校验 step/`SYNC-004` 校验 step 均存在。
- 新增的 workflow-security 测试全部通过。
- `arch-guard.test.ts` 的 `GITLAB_TOKEN` 守卫测试通过（当前 `src/` 下确实不存在这个字符串，测试锁定这一事实）。
- `npx tsc --noEmit`/`npm run lint`/`npx jest` 全量通过，不影响既有测试。

---

## 6. 风险与未决问题

- ~~**无法端到端验证**~~：**2026-08-18 已接入真实环境**（Issue #118）。当天
  向 `develop` 合并了 6 次真实 PR，`sync-to-gitlab.yml` 每次都在几十秒内成功
  把内容同步到 GitLab，`SYNC-004` 的 SHA 比对逻辑（`curl`/`jq` 调用真实
  GitLab REST API）全部真实跑通，未发现与脚本假设有出入的地方。
- **"GitLab 直接 push/MR merge 被保护规则拒绝"**：本次验证已用真实
  `ai-reviewer` 项目配置过 Protected Branch（临时把 `develop` 设为
  protected，用于承接 `ai_review_trigger`，详见 Issue #118）；`develop`→`main`
  发布路径由于历史分支分叉尚未走过，仍待后续任务处理。
- **`SYNC-006`"防止 GitLab pipeline 反向触发 GitHub 写入"**：当前架构下没有任何代码路径尝试这么做，本任务不新增代码，只加测试固化"现状如此"；如果未来有人往 `gitlab-platform.ts`/`gitlab-trigger.ts` 里加了调用 GitHub API 的代码，这条防线要靠 `arch-guard.test.ts` 一类的架构测试才能拦住，而不是本设计文档能覆盖的范围——留给后续任务补测试。
