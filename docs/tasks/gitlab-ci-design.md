# GitLab CI 开发设计文档（CI-001 ~ CI-013）

## 0. 参考文档

- [兼容开发 TODO List](../github-gitlab-compatibility-todo.md) 第 12 章
- [双平台兼容实施方案](../github-to-gitlab-migration-plan.md) §0.7 MVP 运行契约、§0.8 官方依据、§3.1
- [双入口打包设计文档](./dual-entry-packaging-design.md)（本任务的直接前置依赖）
- [GitLab trigger CLI 设计文档](./gitlab-trigger-cli-design.md) §1（事件流程原图）

---

## 1. 背景与现状

`docs/github-gitlab-compatibility-todo.md` 第 12 章"GitLab CI 开发"（`CI-001~013`）此前全部未开始，仓库根目录不存在 `.gitlab-ci.yml`。

按开发顺序门禁表（TODO §2），本任务属于"顺序 5：双入口打包和 GitLab CI"，排在"顺序 6：GitLab 端到端验收（`REVIEW-*`/`CMD-*`/`WS-*`）"之前，且与之解耦——`.gitlab-ci.yml` 的 `ai_review_trigger` job 脚本只有 `node dist/gitlab-trigger/index.js` 这一行，不关心这个 bundle 内部有没有完整的审查/命令逻辑，因此本任务不阻塞、也不被第 8/9 章阻塞。

### 已确认满足的前置依赖

- **第 11 章（`BUILD-*`）已全部完成**：`dist/index.js`（GitHub）与 `dist/gitlab-trigger/index.js`（GitLab）均可独立启动，各自的 `dist/*/SOURCE_SHA` 正确记录源 commit，`dist/gitlab-trigger/licenses.txt` 已覆盖 `@gitbeaker/rest` 家族依赖（`BUILD-005`，见 `scripts/check-bundle-licenses.js` + `__tests__/bundle-licenses.test.ts`）。
- **第 6 章（GitLab Trigger CLI）已全部完成**：`src/gitlab-trigger.ts` 能正确读取 `TRIGGER_PAYLOAD`、校验结构、拒绝 fork MR（`EVENT-010`）、对无关事件优雅跳过（`EVENT-004`/`EVENT-016/017`）。
- **`LOCAL-001/002/003`、`CFG-002` 已完成**：`GitLabConfigProvider` 对 secret-bearing 执行面强制 `enableShell=false`、`enableLintTools=false`，仓库配置/MR payload/Note payload 均不可覆盖（`src/platform/gitlab-config-provider.ts:142-143`）。
- **GitHub 侧已有同类安全修复可参照**（`SEC-001/003/004/005/006`，`.github/workflows/openai-review.yml`）：固定 checkout 默认分支、`enable_shell`/`enable_lint_tools` 在有密钥 job 里强制关闭、最小 `permissions:`。GitLab 侧的 `CI-*` 设计比 GitHub 现状更进一步——GitHub 目前仍是单一 job（`SEC-002`"无密钥验证面与有密钥执行面分离"尚未做），GitLab 从设计上就是两个 job 分离，不是退而求其次的минимум修复。

### 明确不在本任务范围

- `REVIEW-*`/`CMD-*`（第 8/9 章）：`ai_review_trigger` job 执行的 bundle 内部逻辑，不属于本任务。
- 真实 GitLab 测试项目接入（Webhook/Protected Branch/Protected Variable 的实际配置）：文档中反复提到的 `ai-reviewer-test` 项目尚未接入，本任务交付 `.gitlab-ci.yml` 本身和结构性测试，无法做真实 Pipeline 回放。
- `SYNC-*`（第 13 章）：GitHub → GitLab 的代码单向同步，是让 `ai_review_trigger` job 有可信代码可跑的前置条件，但配置/加固本身是独立任务。

---

## 2. 目标（对应 TODO 条目）

| 编号 | 内容 | 本设计如何满足 |
|:---|:---|:---|
| `CI-001` | 新建根目录 `.gitlab-ci.yml` | 第 3.1 节 |
| `CI-002` | 无密钥 MR verify job | 第 3.2 节 `mr_verify` |
| `CI-003` | verify job 只做布尔断言，不展开密钥值 | 第 3.2 节 |
| `CI-004` | MR job 不产生供 trigger job 消费的 artifact | 第 3.2 节 |
| `CI-005` | protected `main` 的 `ai_review_trigger` job | 第 3.3 节 |
| `CI-006` | trigger job 只在 `CI_PIPELINE_SOURCE=trigger` 且 ref 为 default branch 时运行 | 第 3.3 节 |
| `CI-007` | trigger job 执行 `dist/gitlab-trigger/index.js`，不 checkout MR head | 第 3.3 节 |
| `CI-008` | trigger job 不执行 MR 提供的 script/依赖/插件/artifact | 第 3.3 节（`GIT_STRATEGY: clone` + 无 `needs`） |
| `CI-009` | `resource_group: ai-reviewer-mvp` | 第 3.3 节 |
| `CI-010` | ignored payload 快速成功退出 | 已由 `gitlab-trigger.ts`（`EVENT-004`）保证，第 3.4 节验证 |
| `CI-011` | job timeout、有限 retry、脱敏日志 | 第 3.5 节 |
| `CI-012` | MR verify job 验证两个临时 bundle 来自当前 MR 的 `CI_COMMIT_SHA`，且不被 trigger 消费 | 第 3.2 节 |
| `CI-013` | trigger job 只执行仓库内受信任 bundle，校验 `SOURCE_SHA == CI_COMMIT_SHA` | 第 3.3 节 |

---

## 3. 设计方案

### 3.1 CI-001：整体结构

```yaml
stages: [verify, review]

default:
  image: node:24
```

两个 stage 对应两个互斥触发条件的 job，不共用 stage 内的依赖关系（没有 `needs:` 把 `mr_verify` 的产物传给 `ai_review_trigger`，见 `CI-004`/`CI-008`）。

### 3.2 CI-002/003/004/012：`mr_verify`（无密钥）

```yaml
mr_verify:
  stage: verify
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
  script:
    - npm ci
    - npm run build
    - npm test
    - npm run lint
    - npm run package
    - npm run smoke
    - node scripts/check-ci-verify-bundle-provenance.js
    # CI-003：只做布尔断言，不 echo/展开密钥值
    - |
      for VAR in GITLAB_PAT OPENAI_API_KEY CI_JOB_TOKEN; do
        if [ -n "$(eval echo \$$VAR)" ] && [ "$VAR" != "CI_JOB_TOKEN" ]; then
          echo "LEAK: $VAR unexpectedly visible in unprotected MR pipeline" >&2
          exit 1
        fi
      done
      echo "ok: GITLAB_PAT/OPENAI_API_KEY absent from MR pipeline"
  artifacts:
    expire_in: 1h
```

- `CI_JOB_TOKEN` 在任何 pipeline 里都天然存在（GitLab 为每个 job 自动签发，作用域仅限当前 job），不是我们要防的"业务密钥"，断言时排除它，只对 `GITLAB_PAT`/`OPENAI_API_KEY` 这两个显式配置的 Protected Variable 做非空断言。
- `CI-012` 由 `scripts/check-ci-verify-bundle-provenance.js` 完成：读取 `dist/SOURCE_SHA`/`dist/gitlab-trigger/SOURCE_SHA`，断言等于 `$CI_COMMIT_SHA`——证明这次 `mr_verify` 里构建出的两个临时 bundle 确实来自当前 MR 的提交，不是缓存/复用的旧产物。
- `artifacts.expire_in: 1h` + 没有任何后续 job 通过 `needs:`/`dependencies:` 引用它：产物只用于这次验证本身，不会被 `ai_review_trigger` 消费（`CI-004`）。

### 3.3 CI-005~009/013：`ai_review_trigger`（有密钥）

```yaml
ai_review_trigger:
  stage: review
  rules:
    - if: '$CI_PIPELINE_SOURCE == "trigger" && $CI_COMMIT_REF_NAME == $CI_DEFAULT_BRANCH'
  variables:
    GIT_STRATEGY: clone
  resource_group: ai-reviewer-mvp
  timeout: 10m
  retry:
    max: 1
    when: [runner_system_failure, stuck_or_timeout_failure]
  script:
    - test -f dist/gitlab-trigger/SOURCE_SHA
    - |
      if [ "$(cat dist/gitlab-trigger/SOURCE_SHA)" != "$CI_COMMIT_SHA" ]; then
        echo "REFUSED: bundle source commit does not match CI_COMMIT_SHA — refusing to run untrusted/stale bundle" >&2
        exit 1
      fi
    - node dist/gitlab-trigger/index.js
```

- `rules` 用 `CI_PIPELINE_SOURCE == "trigger"` 卡死：只有通过 Pipeline Trigger API 发起的 pipeline 才会是这个值，普通 push/MR 事件不会意外触发这个 job（`CI-006`）。`CI_COMMIT_REF_NAME == CI_DEFAULT_BRANCH` 是第二重限制，即使 trigger 调用时传了别的 ref 也会被拦下。
- `GIT_STRATEGY: clone`：强制每次全新 clone，不复用 workspace 里可能残留的其他分支内容；没有任何 `checkout`/`fetch` 指向 MR 分支（`CI-007`）。
- 脚本里没有 `npm ci`/`npm install`/执行 MR 提供的任何 script——`dist/gitlab-trigger/index.js` 是**已经在 `main` 分支上构建好、随代码一起提交/或由独立的 `main` 分支流水线产出**的产物，不在这个 job 里现场 build（`CI-008`）。
- `CI-013` 的信任链：`test "$(cat dist/gitlab-trigger/SOURCE_SHA)" = "$CI_COMMIT_SHA"`——`SOURCE_SHA` 是 `BUILD-010` 在打包时写入的源 commit SHA；这一步验证"当前 job checkout 出来的 `main` commit"和"bundle 记录的构建来源 commit"必须一致，防止 workspace 里出现一份不对应当前 commit 的陈旧/被篡改 bundle。

> **关于"谁来在 `main` 分支上产出 `dist/gitlab-trigger/index.js`"**：本任务不新增一条"push 到 main 时自动 build+commit dist/"的流水线——这属于第 13 章 `SYNC-*`（GitHub → GitLab 单向发布）的职责范围：GitHub 侧 `main` 构建、打包、连同 `dist/` 一起同步到 GitLab `main`。`.gitlab-ci.yml` 只负责"信任已经在 `main` 上的 bundle，并在执行前验证它的来源"，不负责生产它。这条边界写进本设计文档，避免后续任务把两件事的职责搞混。

### 3.4 CI-010：ignored payload 快速退出

不新增业务代码。`gitlab-trigger.ts` 已经实现（`EVENT-004`/`EVENT-016/017`）：无关事件/可忽略事件走 `ignorable_event`，`process.exitCode` 保持 0（成功）。本任务只需要确认 `.gitlab-ci.yml` 不会把这种"正常退出但什么都没做"的 exit 0 误判成失败——`script:` 默认行为就是"exit 0 视为 job 成功"，不需要额外处理，第 4 节的结构测试里会加一条断言防止未来有人在 `ai_review_trigger` 后面加 `set -e` 之外的额外失败判断逻辑。

### 3.5 CI-011：timeout / retry / 脱敏日志

- `ai_review_trigger` 的 `timeout: 10m` + `retry: {max: 1, when: [runner_system_failure, stuck_or_timeout_failure]}`——只在"跑失败的是 runner 本身"或者"卡死超时"这两类基础设施性故障时重试一次，不对业务逻辑失败（比如 `dist/gitlab-trigger/index.js` 自身抛错）做重试，避免陈旧 pipeline 因为重试机制被反复执行（呼应 `TEST-040`/`0.7` 契约里的陈旧任务处理）。
- 日志脱敏依赖 `gitlab-trigger.ts` 自身已有的 `redact()`（`gitlab-trigger-redact.ts`）——CLI 内部的错误日志已经脱敏，`.gitlab-ci.yml` 层面不需要、也不应该再对 stdout 做二次处理（二次处理反而可能引入新的转义/截断 bug）。`mr_verify` 的密钥断言脚本本身设计上就不 echo 密钥值（见 3.2）。

---

## 4. 任务拆分与测试

- `.gitlab-ci.yml` 本身，纯配置。
- `scripts/check-ci-verify-bundle-provenance.js`：`CI-012` 的校验脚本，纯 Node 脚本，不依赖 GitLab 环境即可单元测试（把 `CI_COMMIT_SHA` 作为参数/环境变量注入）。
- `__tests__/gitlab-ci-config.test.ts`：用已有依赖 `js-yaml` 解析 `.gitlab-ci.yml`，做结构性断言（见第 5 节），替代无法在没有真实 GitLab 项目时做的端到端验证。这类测试属于 `TEST-040`（CI 产物来源测试）的一部分，本任务顺带交付。

---

## 5. 验收标准

- CI Lint 语法层面：`js-yaml` 能无错解析（结构测试的前置断言）。
- 结构性断言（`gitlab-ci-config.test.ts`）覆盖：
  - `mr_verify`/`ai_review_trigger` 的 `rules` 互斥（`CI_PIPELINE_SOURCE` 不可能同时等于 `merge_request_event` 和 `trigger`）。
  - `mr_verify` 没有 `needs:`/`dependencies:` 指向任何会消费它 artifact 的 job；`ai_review_trigger` 没有 `needs:`/`dependencies:` 指向 `mr_verify`。
  - `ai_review_trigger` 的 `script` 中不包含 `npm ci`/`npm install`/`npm run build`/`npm run package` 等构建动作，只有 provenance 校验 + `node dist/gitlab-trigger/index.js`。
  - `ai_review_trigger` 配置了 `resource_group`。
  - `mr_verify` 的 `script` 中包含针对 `GITLAB_PAT`/`OPENAI_API_KEY` 的存在性断言，且断言逻辑不包含 `echo $GITLAB_PAT`/`echo $OPENAI_API_KEY` 这类会展开密钥值的写法。
- `npm run build && npm run package && npm run smoke` 仍然全部通过（不因新增文件影响既有构建产线）。

---

## 6. 风险与未决问题

- **无法端到端验证**：没有真实 GitLab 测试项目，`CI_PIPELINE_SOURCE=trigger`、Protected Variable 的实际生效行为只能依据 GitLab 官方文档（已在 `github-to-gitlab-migration-plan.md` §0.8 引用）推导，未经真实 Pipeline 回放。接入 `ai-reviewer-test` 项目后需要补一轮真实验证，届时如与文档假设有出入，需回填本设计文档。
- **谁构建 `main` 分支上的 `dist/gitlab-trigger/index.js`**：本任务明确界定为第 13 章 `SYNC-*` 的职责（见 3.3 节说明），但 `SYNC-*` 目前也未开始，这中间存在一个"配置已就绪、但没有东西真正把 bundle 放到 GitLab `main` 上"的空档，需要在第 13 章开工时明确衔接。
- **Trigger token 的实际配置**：`.gitlab-ci.yml` 不包含 Trigger token 本身（按 0.7 契约它只应出现在 GitLab Project Webhook 的 URL 配置里，不是 CI/CD 变量），因此这部分无法在代码里体现或测试，只能在真实项目接入时靠人工配置 checklist 保证。
