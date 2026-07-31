---
title: 双入口打包设计文档（BUILD-001~BUILD-010）
sidebar_label: 双入口打包（双平台兼容）
sidebar_position: 11
---

# 双入口打包设计文档（BUILD-001 ~ BUILD-010）

> **状态**：✅ 已完成（BUILD-001~010），见 `feat/dual-entry-packaging` 分支
> **优先级**：P1 —— GitHub↔GitLab 双平台兼容工作流 A 的延续任务，是后续 `.gitlab-ci.yml`（第12章 `CI-*`）落地的前提
> **依赖**：`src/gitlab-trigger.ts`（#64 / PR #67，已存在）
> **跟踪 Issue**：[#71](https://github.com/CodesSentinels/ai-reviewer/issues/71)
> **范围**：`BUILD-001`~`BUILD-010`（双 ncc 构建产线、防覆盖、冒烟测试、产物 SHA 记录）
> **不在本任务范围**：`.gitlab-ci.yml` 本身（`CI-*`，第12章）、`GLAPI-*`（第7章）

---

## 0. 参考文档

- `docs/github-gitlab-compatibility-todo.md` 第 11 章（`BUILD-001`~`BUILD-010` 原始条目）
- `docs/tasks/gitlab-trigger-cli-design.md`（`gitlab-trigger.ts` 的既有实现）
- `package.json`、`action.yml`、`tsconfig.json`

---

## 1. 背景与现状

当前只有一条构建产线：

```json
// package.json
"main": "lib/main.js",
"scripts": {
  "build": "cp node_modules/@dqbd/tiktoken/tiktoken_bg.wasm dist/tiktoken_bg.wasm && tsc",
  "package": "ncc build --license licenses.txt"
}
```

`ncc build`（不带参数）默认读取 `package.json` 的 `main` 字段（`lib/main.js`）作为入口，输出到 `dist/`。`action.yml` 通过 `runs.main: 'dist/index.js'` 让 GitHub Actions runtime 调用它。

`tsconfig.json` **没有** `include`/`files` 限制（只有 `exclude`），`rootDir` 是 `./src`，所以 `src/gitlab-trigger.ts` 已经会被 `tsc` 自动编译成 `lib/gitlab-trigger.js`——`BUILD-001` 不需要新建任何源文件或改 `tsconfig.json`，只是此前没跑过 `npm run build` 去验证这一点（当前 `lib/` 目录下确认没有 `gitlab-trigger.js`，纯粹因为没重新构建过）。

真正缺的是 `package:github`/`package:gitlab` 两个脚本、防止两次 `ncc` 输出互相覆盖、以及冒烟测试。

---

## 2. 目标（对应 TODO 条目）

| 编号 | 内容 | 本设计如何满足 |
|:---|:---|:---|
| `BUILD-001` | GitLab TS 入口编译为 `lib/gitlab-trigger.js` | 第 3.1 节：确认 `tsc` 现状即可满足，补验证测试 |
| `BUILD-002` | `package:github` 生成 `dist/index.js` | 第 3.2 节 |
| `BUILD-003` | `package:gitlab` 生成 `dist/gitlab-trigger/index.js` | 第 3.2 节 |
| `BUILD-004` | 防止两次 ncc 构建互相覆盖 | 第 3.2 节：显式 `-o` 参数 |
| `BUILD-005` | 两个 bundle 的资产复制 | 第 3.3 节 |
| `BUILD-006` | Node 24 启动冒烟测试 | 第 3.4 节 |
| `BUILD-007` | `npm run package` 连续生成两个入口 | 第 3.5 节 |
| `BUILD-008` | `npm run all` 包含双入口构建和测试 | 第 3.5 节 |
| `BUILD-009` | `action.yml` node24 与 GitLab node:24 对齐 | 第 3.6 节（文档确认，非代码改动） |
| `BUILD-010` | 产物记录源 commit SHA | 第 3.7 节 |

---

## 3. 设计方案

### 3.1 BUILD-001：验证 `lib/gitlab-trigger.js` 自动生成

新增测试步骤（不是单元测试，是 npm script 层面的验证）：`npm run build` 后断言 `lib/gitlab-trigger.js` 存在。不改 `tsconfig.json`。

### 3.2 BUILD-002/003/004：双 ncc 产线

`ncc build <entry> -o <outDir>` 支持显式指定入口和输出目录，两条产线互不覆盖：

```json
// package.json scripts
"package:github": "ncc build lib/main.js -o dist --license licenses.txt",
"package:gitlab": "ncc build lib/gitlab-trigger.js -o dist/gitlab-trigger --license licenses.txt"
```

> **注意顺序**：`package:gitlab` 的输出目录 `dist/gitlab-trigger` 是 `package:github` 输出目录 `dist` 的子目录。需要验证 `ncc build ... -o dist/gitlab-trigger` 不会因为父目录已经有 `package:github` 的产物而互相干扰（`ncc` 通常会清空/覆盖目标目录内容，但只影响它自己的输出子目录，不会波及父目录的其他文件——这一点需要在实现时用真实构建验证，不能只凭文档假设）。

### 3.3 BUILD-005：资产复制

现有 `build` 脚本会 `cp tiktoken_bg.wasm dist/tiktoken_bg.wasm`，这是 GitHub 侧 bundle（`bot.ts` 用 `@dqbd/tiktoken` 计算 token）需要的资产。`gitlab-trigger.ts` 当前**不 import** `tiktoken`/OpenAI 相关模块（只做 payload 校验和日志），本任务需要先确认它的 bundle 是否真的需要这份资产——大概率不需要，避免给 GitLab bundle 塞一份用不上的 ~700KB wasm 文件。license 文件（`--license licenses.txt`）两条产线都需要，各自生成到自己的输出目录。

### 3.4 BUILD-006：Node 24 冒烟测试

新增 `__tests__/smoke/` 或独立 shell 脚本，在 CI 里对两个 bundle 分别跑：

```bash
node dist/index.js               # GitHub 侧：预期因缺 GITHUB_EVENT_NAME 等环境变量而非零退出，但不应该是"模块加载错误"
node dist/gitlab-trigger/index.js  # GitLab 侧：预期因缺 TRIGGER_PAYLOAD 而 exit 1，同样不应该是模块加载错误
```

冒烟测试断言的是"Node 能成功加载并执行到已知的错误分支"，不是"退出码为 0"——两个入口在没有真实事件环境时本来就应该以非零退出。需要设计一个明确的判定方式（比如断言 stderr 包含预期的错误信息文本，而不是断言 exit code）。

### 3.5 BUILD-007/008：脚本整合

```json
"package": "npm run package:github && npm run package:gitlab",
"all": "npm run build && npm run format && npm run lint && npm run package && npm test"
```

`all` 本身不用改动逻辑，只要 `package` 已经变成跑两条产线，`all` 自然覆盖。

### 3.6 BUILD-009：版本对齐确认

`action.yml:390` 当前已经是 `runs.using: 'node24'`。本任务不修改 `action.yml`，只在设计文档里记录：未来 `.gitlab-ci.yml`（`CI-*`，不在本任务范围）的 job image 必须使用 `node:24`，与此对齐。这一条更多是给 `CI-*` 任务的前置提醒，不是本任务的代码交付物。

### 3.7 BUILD-010：产物记录源 commit SHA

两个 bundle 各自在构建时写入一个 `SOURCE_COMMIT` 常量或独立文件（比如 `dist/gitlab-trigger/SOURCE_SHA`），内容是构建时的 `git rev-parse HEAD`。这是为后续 `CI-013`（protected trigger job 验证 bundle 记录的 source commit 与 `CI_COMMIT_SHA` 一致）做准备，具体消费逻辑在 `CI-*` 任务里实现，本任务只负责"构建时把 SHA 写进产物"这一步。

---

## 4. 任务拆分

| # | 任务 | 依赖 | 预估工时 |
|:---|:---|:---:|:---:|
| B1 | 验证 `npm run build` 自动生成 `lib/gitlab-trigger.js` | 无 | 0.5h |
| B2 | 新增 `package:github`/`package:gitlab` 脚本 | B1 | 2h |
| B3 | 验证两条产线互不覆盖（真实构建 + 文件对比） | B2 | 1.5h |
| B4 | 确认/裁剪 GitLab bundle 的资产依赖 | B2 | 1h |
| B5 | Node 24 冒烟测试脚本 | B2 | 2h |
| B6 | 整合 `package`/`all` 脚本 | B2 | 0.5h |
| B7 | `BUILD-010` 产物 SHA 写入 | B2 | 1.5h |
| B8 | CI（GitHub Actions，非 GitLab）里跑一次完整双构建验证 | B2~B7 | 1h |

**合计：约 10h（约 1.5 个工作日）**

---

## 5. 验收标准

- [x] `npm run package` 生成 `dist/index.js` 和 `dist/gitlab-trigger/index.js`，两者内容互不干扰
- [x] `node dist/index.js`/`node dist/gitlab-trigger/index.js` 冒烟测试均能加载执行到已知错误分支，不是模块加载错误
- [x] GitLab bundle 不携带不必要的 `tiktoken_bg.wasm` 等资产（除非确认需要）
- [x] 两个 bundle 产物中都能找到构建时记录的 source commit SHA
- [x] `npm run all` 全量跑通，无新增失败

---

## 6. 风险与未决问题

| 风险/问题 | 说明 | 处理方式 |
|:---|:---|:---|
| `ncc build ... -o dist/gitlab-trigger` 是否会清空 `dist/` 父目录 | ✅ 已实测排除：`ncc build` 只写自己的输出文件（`index.js`/`licenses.txt`），不会清空/删除目标目录里的其他内容，两个方向互相 rebuild 多次验证过，互不影响 | 已解决，无需进一步处理 |
| 冒烟测试的"成功"判定标准 | 两个入口在无真实事件环境下本来就非零退出 | ✅ 已解决：`scripts/smoke-test.sh` 断言输出文本——GitHub 侧包含 `GITHUB_ACTION`（Octokit action-auth 因缺少该环境变量抛出的错误），GitLab 侧包含 `TRIGGER_PAYLOAD is not set`；同时排除 `Cannot find module`/`SyntaxError` 等真正的 bundle 加载失败信号 |
| `BUILD-010` 的 SHA 写入格式 | 独立文件 vs bundle 内常量，两种都可行 | ✅ 已解决：选择独立文件，`dist/SOURCE_SHA`/`dist/gitlab-trigger/SOURCE_SHA`，构建时写入 `git rev-parse HEAD` |
