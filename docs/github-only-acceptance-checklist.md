# GitHub-only 真实环境验收清单（§15 GitHub-only 列 / §3 验收 ②）

> 目的：把 §15 验收矩阵的 **GitHub-only 列**（当前 0/25）走一遍真实环境。同一轮还能顺带完成 §3 的最
> 后一条（验收 ②）和 §16 的「三种测试模式」之一。
>
> 与 GitLab-only 那轮（Issue #118）的记账口径一致：**只勾有具体证据的格子** ——job 日志行、PR 上的评
> 论、description 内容、API 响应。凭经验推断的不勾。

## 0. 前置确认

本仓库自己就是 GitHub 仓库，不需要额外搭环境。开工前确认三件事：

| 项                                   | 怎么确认                                                               |
| ------------------------------------ | ---------------------------------------------------------------------- |
| `OPENAI_API_KEY` 已配置为仓库 secret | Settings → Secrets and variables → Actions                             |
| workflow 在默认分支上是最新的        | `pull_request_target` 用的是 **base 分支**的 workflow，PR 里改它不生效 |
| `dist/` 是最新的                     | `uses: ./` 跑的是默认分支 checkout 出来的 `dist/index.js`              |

**生效配置**（来自 `.github/workflows/openai-review.yml` 的 `with:` 与 `action.yml` 默认值）——判定时
要按这套预期，别按直觉：

```
debug: true                     日志详细，便于取证
review_comment_lgtm: false      LGTM 不发行级评论
enable_shell / enable_lint_tools: false   本地工具关闭，lint 由低权限 job 提供
enable_web_search: true         （action.yml 默认）
enable_dependency_analysis: true（action.yml 默认）
max_review_comments: 20
max_files: 150
path_filters: 排除 dist/** 与 **/*.lock
bot_github_login: 未配置        →  身份靠 getAuthenticatedLogin()，即 github-actions[bot]
```

---

## 1. 主 PR：一次开销覆盖 12 行

开一个改动**至少两个源文件**、每个文件都有可被挑毛病的新增行的 PR。建议直接用一个真实的小改动，不要
造无意义 diff——`review_simple_changes` 默认 false，太琐碎的改动会被分类器筛掉，反而验不到东西。

| #   | 矩阵行                                | 判定证据                                                                                     |
| --- | ------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1   | 自动增量审查                          | Actions 里 `review` job 跑完；日志出现 `eventKind=pr_opened`                                 |
| 2   | 顶层摘要                              | PR 上出现一条摘要评论，正文含 Walkthrough / Changes                                          |
| 3   | 行级评论                              | PR 的 Files changed 里出现行级评论，位置落在新增行上                                         |
| 4   | Release notes 生成与 description 更新 | PR description 多出 `<!-- ai-reviewer:github:release-notes-start -->` 区块，**且原描述仍在** |
| 5   | reviewed SHA marker                   | 摘要评论源码里含 `ai-reviewer:github:commit-ids-reviewed-start` 与当前 HEAD SHA              |
| 6   | Repository tree / 跨文件依赖分析      | 日志出现依赖分析相关行；摘要或行级评论提到跨文件关联                                         |
| 7   | Web search 开关与工具调用             | 日志里出现 `web_search_call` / analysis chain 段落（默认开启）                               |
| 8   | 禁用 lint/shell 后 API-only 审查      | 日志确认 `enable_shell: false` / `enable_lint_tools: false`，且审查照常完成                  |
| 9   | 不可信代码无法访问密钥                | `lint` job 日志里两次 checkout 都 `persist-credentials: false`；执行 PR 代码那步无凭据       |

> ⚠️ 第 9 行是 §3 验收 ② 的核心。除了看日志，还要确认 `review` job **没有任何 `run:` 步骤**（持密钥
> 面无可注入的执行点）——这条已有单元测试守着，真实环境只需确认 job 结构与预期一致。

**再推一个 commit** 到同一 PR（触发 `synchronize`）：

| #   | 矩阵行                   | 判定证据                                                                                                           |
| --- | ------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| 10  | 自动增量审查（增量部分） | 第二次运行只审新增的 commit，日志出现 `Will review from the last reviewed commit` 一类；摘要评论被更新而非新增一条 |
| 11  | event 幂等               | 对**同一个 HEAD** 点 Re-run all jobs → 日志出现 `already reviewed … skipping`，PR 上不新增任何评论                 |
| 12  | 旧 SHA 退出              | 审查进行中再推一个 commit → 旧那次运行日志出现 `[review-003] HEAD moved`，且不发布旧结果                           |

> 第 12 行不好构造（要卡在审查窗口内）。推不出来就不勾，如实标注「未构造出场景」——GitLab 那轮对
> `EVENT-012` 陈旧分支就是这么记的。

---

## 2. 命令：7 条评论

在同一个 PR 上依次评论。每条命令都要确认**两件事**：bot 回复了，且回复内容符合该命令语义。

| #   | 命令            | 评论内容                     | 判定证据                                                                 |
| --- | --------------- | ---------------------------- | ------------------------------------------------------------------------ |
| 13  | `help`          | `@ai-reviewer help`          | 回复含命令表、权限说明、触发前缀、评论身份                               |
| 14  | `configuration` | `@ai-reviewer configuration` | 回复含「来源」列；`enable_shell` 显示 false                              |
| 15  | `pause`         | `@ai-reviewer pause`         | 回复「已暂停」；description 出现 `review-state-start` 且 `state: paused` |
| 16  | `review`        | `@ai-reviewer review`        | **在 paused 状态下**才会真正触发增量审查                                 |
| 17  | `resume`        | `@ai-reviewer resume`        | 回复「已恢复」；description 中 `state: active`                           |
| 18  | `summary`       | `@ai-reviewer summary`       | 摘要评论被重建                                                           |
| 19  | `full review`   | `@ai-reviewer full review`   | 触发全量审查；若当前 HEAD 已审过则回复 already been reviewed             |
| 20  | `resolve`       | `@ai-reviewer resolve`       | 回复已解决 N 条；Files changed 里的 bot 线程变成 resolved                |

> `resolve` 需要先有未解决的 bot 行级评论（第 3 行的产物）。若回复「没有找到待解决的审查意见」，说明
> 前面的行级评论没发出来，先回头查。

**顺序有讲究**：`pause` → `review` → `resume`。`review` 只在暂停状态下真正执行（CMD-017），顺序错了
会看到「Review finished / 增量审查系统不重复审查」那段说明，那不是失败。

---

## 3. 需要单独构造的 5 行

| #   | 矩阵行                        | 怎么构造                                                  | 判定证据                                                      |
| --- | ----------------------------- | --------------------------------------------------------- | ------------------------------------------------------------- |
| 21  | 行级回复 / 对话上下文         | 在 bot 的**行级评论**下回复 `@ai-reviewer 这里为什么？`   | bot 在同一 thread 内回复，内容针对该行                        |
| 22  | 权限校验（拒绝方向）          | 用一个**对本仓库只有读权限**的账号发 `@ai-reviewer pause` | 回复「权限不足」。GitLab 那轮只验过放行方向，这次两个方向都要 |
| 23  | 命令进程内限流                | 同一次运行内连发命令触发限流                              | ⚠️ 见下方说明                                                 |
| 24  | ACK reaction                  | 任意命令评论                                              | 该评论上出现表情反应（`command_ack_reaction` 默认值）         |
| 25  | 平台状态隔离 / 单平台故障隔离 | N/A（GitHub-only 列不适用）                               | —                                                             |

> **第 23 行大概率验不出来，如实不勾。** GitHub 的每条 comment 事件起一个独立 runner 进程，桶从零开
> 始——这正是 `CMD-029` 明确写下的边界。除非能在**一次运行内**制造多条命令，否则限流不会触发。GitLab
> 那轮也是因此不勾的。

---

## 4. 记账规则

- 逐格勾选 §15 矩阵的 **GitHub-only** 列，只勾有证据的
- 每个勾附上证据出处：Actions run 链接 / 评论链接 / 日志行
- 验不出来的格子**保持空**，并在矩阵上方的说明段落里写明原因（照 GitLab-only 那轮的写法：「某某没有
  构造出场景，故不打勾」）
- 验证用 PR 跑完后关闭不合并；若过程中发现真实 bug，按「当天修复当天合并」开独立分支处理

## 5. 顺带能推进的条目

| 条目                                               | 条件           |
| -------------------------------------------------- | -------------- |
| §3 验收 ②                                          | 第 1、9 行通过 |
| `TEST-016/017` 的真实环境对应物                    | 第 1~9 行通过  |
| §16「三种测试模式全部通过」的 GitHub-only 那一模式 | 本清单整体通过 |
