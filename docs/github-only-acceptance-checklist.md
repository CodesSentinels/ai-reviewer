# GitHub-only 真实环境验收清单（§15 GitHub-only 列）

> 目的：把 §15 验收矩阵的 **GitHub-only 列**（当前 0/25）走一遍真实环境。
>
> 与 GitLab-only 那轮（Issue #118）的记账口径一致：**只勾有具体证据的格子** ——job 日志行、PR 上的评
> 论、description 内容、API 响应。凭经验推断的不勾。
>
> **每个步骤都标了「对应 §15 行」与「该格能否据此勾选」两列。** 有些矩阵格需要多个步骤同时通过才能勾
> （例如「命令进程内限流与事件幂等」是一个格子，幂等过了但限流没验，那个格子仍然不能勾）——不逐个标出
> 来很容易多勾。

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

## 1. 主 PR：自动审查链路

开一个改动**至少两个源文件**、每个文件都有可被挑毛病的新增行的 PR。建议直接用一个真实的小改动，不要
造无意义 diff——`review_simple_changes` 默认 false，太琐碎的改动会被分类器筛掉，反而验不到东西。

| #   | 对应 §15 行                           | 判定证据                                                                                  | 该格能否据此勾选         |
| --- | ------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------ |
| 1   | 自动增量审查                          | `review` job 跑完；日志出现 `eventKind=pr_opened`                                         | 需 #1 + #10 一起         |
| 2   | 顶层摘要                              | PR 上出现摘要评论，正文含 Walkthrough / Changes                                           | ✅ 可勾                  |
| 3   | 行级评论/discussion                   | Files changed 里出现行级评论，位置落在新增行上                                            | ✅ 可勾                  |
| 4   | Release notes 生成与 description 更新 | description 多出 `<!-- ai-reviewer:github:release-notes-start -->` 区块，**且原描述仍在** | ✅ 可勾                  |
| 5   | reviewed SHA marker                   | 摘要评论源码含 `ai-reviewer:github:commit-ids-reviewed-start` 与当前 HEAD SHA             | ✅ 可勾                  |
| 6   | Repository tree/跨文件依赖分析        | 日志出现依赖分析相关行；摘要或行级评论提到跨文件关联                                      | ✅ 可勾                  |
| 7   | Web search 开关与工具调用             | 日志出现 **`[web_search] executed, id: …, status: …`**（`src/bot.ts:295`）                | ✅ 可勾（见下）          |
| 8   | 禁用 lint/shell 后 API-only 审查      | 日志确认 `enable_shell: false` / `enable_lint_tools: false`，且审查照常完成               | ✅ 可勾                  |
| 9   | 不可信代码无法访问密钥                | 见 §1.2 主动探测                                                                          | 需主动探测，结构证据不够 |

### 1.1 Web search 要精确日志 + 专门构造

`analysis chain` 段落在没有任何工具调用时也可能出现（shell 关闭、空 chain 都会渲染），拿它当证据会误
判。要认的是 `bot.ts` 里这一行：

```
[web_search] executed, id: ws_xxx, status: completed
```

而且模型**不一定会主动搜**。要让它有理由搜，PR 里得包含「需要核对外部最新 API 文档」的代码——比如调用
某个第三方 SDK 的新方法、或用了一个近期有 breaking change 的 API。纯业务逻辑改动大概率不触发。

搜不出来就不勾，注明「未构造出触发搜索的场景」。

### 1.2 第 9 行需要主动探测，不能只看结构

`persist-credentials: false` 和「执行 PR 代码的步骤不带 env 凭据」是**结构证据** ——它们证明配置写对
了，不证明攻击者真的拿不到。

`lint` job 会以 `--repo-root pr` 扫描 PR head，而 eslint 会加载 PR 里的 `eslint.config.js`——**那是
PR 可控的可执行 JS，本来就是已接受的风险边界** （只跑在 GitHub 托管临时 runner 上）。所以可以借它做
一次真正的探测：

在测试 PR 里放一个 `eslint.config.js`，开头加上：

```js
// 验收探测：只输出**一行**布尔汇总，绝不输出任何值
//
// 目标是环境变量而不是 Action input：action.yml 一个密钥类 input 都没声明，
// OPENAI_API_KEY / GITHUB_TOKEN 全部由 workflow 的 env: 注入，代码侧也只读
// process.env（bot.ts:189、octokit.ts:18）。探 INPUT_* 是在找不存在的东西。
const fs = require('fs')
const {execFileSync} = require('child_process')

const present = name => {
  const v = process.env[name]
  return v != null && v !== ''
}

const gitCreds = ['.', 'pr', '..'].some(dir => {
  try {
    const keys = execFileSync('git', ['-C', dir, 'config', '--local', '--list', '--name-only'], {
      encoding: 'utf8'
    })
    // 查配置键是否存在，不猜 token 前缀——actions/checkout 常用
    // http.<url>.extraheader 存 Base64 认证头，匹配 ghp_ 之类会漏掉
    return /extraheader|credential\.helper/i.test(keys)
  } catch {
    return false
  }
})

const homeCreds = [`${process.env.HOME}/.git-credentials`, `${process.env.HOME}/.netrc`].some(f => {
  try {
    return fs.statSync(f).size > 0
  } catch {
    return false
  }
})

// 已知业务密钥**逐个**显式判断——不能靠 suspicious 那条截断字符串来判定：
// 环境变量一多，GITLAB_PAT 之类就可能排在 120 字符之外被截掉，
// 于是"没看到"被当成"不存在"。
const businessSecrets = [
  'OPENAI_API_KEY',
  'GITHUB_TOKEN',
  'GITLAB_PAT',
  'GITLAB_TOKEN',
  'CI_JOB_TOKEN'
]
const leaked = businessSecrets.filter(present)

// suspicious 只作诊断线索（可能截断），不参与通过/失败判定
const suspicious = Object.keys(process.env).filter(
  k => /(TOKEN|SECRET|API_?KEY|PASSWORD|CREDENTIAL)/i.test(k) && !businessSecrets.includes(k)
)

// 单行汇总：判定项在最前，诊断信息截断放最后
console.log(
  `[probe] businessSecrets=${leaked.length === 0 ? 'none' : leaked.join(',')} ` +
    `gitCreds=${gitCreds} homeCreds=${homeCreds} ` +
    `suspicious=${suspicious.join(',').slice(0, 120)}`
)

module.exports = []
```

**为什么必须挤成一行**：`console.log` 会污染 ESLint 的 JSON 输出，适配器解析失败后只回显 stdout
的**前 500 字符**（`src/lint/adapters/exec.ts:115`）。分行打印的话，靠后的判定项会落在 500 字符之外
，"确认所有 `[probe]` 行"根本执行不了。

判定：`lint` job 日志里必须出现**这条完整的汇总行**，且前三项全部为

```
businessSecrets=none gitCreds=false homeCreds=false
```

`suspicious` 是诊断线索（会截断），**不参与判定**——它列出的是业务密钥清单之外、名字看着像凭据的变量
，用来发现"我们没想到的那一类"。里面出现可疑名字要人工看一眼，但它为空不代表安全，它非空也不直接算失
败。

**汇总行没出现就不能判定通过**——那说明探测根本没执行到（eslint 没加载配置、或输出被截在更前面），不
是"没发现问题"。

> ⚠️ 探测脚本只打印布尔结果，**绝不能**打印值。Actions 日志对协作者可见，打出来就等于自己把密钥泄了
> 。

---

## 2. 推第二个 commit

| #   | 对应 §15 行  | 判定证据                                                                                          | 该格能否据此勾选 |
| --- | ------------ | ------------------------------------------------------------------------------------------------- | ---------------- |
| 10  | 自动增量审查 | 第二次运行只审新增 commit（日志出现从上次已审 commit 起算的措辞）；摘要评论被**更新**而非新增一条 | 与 #1 合并后 ✅  |
| 11  | event 幂等   | 对**同一 HEAD** 点 Re-run all jobs → 日志出现已审查跳过的措辞，PR 上不新增评论                    | ✅ 可勾          |

### 2.1「旧 SHA 退出」要靠**命令触发**的运行来构造

先排除两条走不通的路：

- **推 commit 打断自动审查**：同一 PR 的 push 事件共用一个 concurrency group 且 `cancel-in-progress`
  为 true，旧 run 会被直接取消，活不到写入门禁
- **re-run 旧 run**：`review.ts:294` 的基线是 `reviewedHeadSha = pr.head.sha`，而 `pr` 来自审查开始
  时的**实时** `getChangeRequest()`，不是事件 payload （REVIEW-003 有意如此——评论触发的运行
  `execCtx.headSha` 固定为空）。 re-run 时它读到的是当前 HEAD 并以此为基线，永远不会 mismatch

可行的是**命令触发**的运行，因为 concurrency 对评论事件的处理不同：

```yaml
group: …-${{ github.event.comment.id || 'pr' }} # 评论 run 各占一个 group
cancel-in-progress: ${{ github.event_name != 'pull_request_review_comment' && github.event_name !=
  'issue_comment' }} # 评论事件为 false
```

评论 run 与 push run 分属不同 group，且评论 run 不会被取消。而命令触发的 `codeReview()` 同样走
REVIEW-003 的四道门禁。构造步骤：

1. `@ai-reviewer pause` —— 让后续 push 的自动审查被跳过（`review.ts:283`：`!fromCommand && paused` →
   skip）
2. 推 commit **A**，确认自动审查确实跳过（日志 `review automation is paused`）
3. 评论 `@ai-reviewer full review`，开始审查 A
4. **趁这次运行还在跑**，推 commit **B**
5. B 的自动审查因 paused 被跳过；步骤 3 的评论 run 不会被取消

判定：步骤 3 那次 run 的日志出现 `[review-003] HEAD moved`，且 PR 上**不出现** 基于 A 的摘要/行级评
论。

> 时间窗口取决于 PR 大小和模型耗时。构造不出来就如实不勾，注明原因—— 单元测试有 26 条覆盖
> （`review-head-freshness.test.ts`）。

---

## 3. 命令

在同一个 PR 上依次操作。每条都要确认**两件事**：bot 回复了，且回复内容符合该命令语义。

### 3.1 先跑不依赖增量的四条

| #   | 对应 §15 行     | 评论内容                     | 判定证据                                              | 该格能否据此勾选 |
| --- | --------------- | ---------------------------- | ----------------------------------------------------- | ---------------- |
| 12  | `help`          | `@ai-reviewer help`          | 回复含命令表、权限说明、触发前缀、评论身份            | ✅ 可勾          |
| 13  | `configuration` | `@ai-reviewer configuration` | 回复含「来源」列；`enable_shell` 显示 false           | ✅ 可勾          |
| 14  | `summary`       | `@ai-reviewer summary`       | 摘要评论被重建（内容更新、不新增第二条）              | ✅ 可勾          |
| 15  | `resolve`       | `@ai-reviewer resolve`       | 回复已解决 N 条；Files changed 里 bot 线程变 resolved | ✅ 可勾          |

> `resolve` 需要先有未解决的 bot 行级评论（`#3` 的产物）。若回复「没有找到待解决的审查意见」，说明前
> 面的行级评论没发出来，先回头查。

### 3.2 `review` 与 `full review` 必须有未审增量才验得出来

到这一步 `#10` 已经把最新 HEAD 审完了。此时直接发 `review` 没有任何未审变更， `full review` 也会以
`already been reviewed` 回复——**那只证明命令解析和幂等分支走通了，不证明这两条命令真的完成了增量/全
量审查**。

所以要先制造未审 commit：

| #   | 对应 §15 行        | 操作                            | 判定证据                                                                                        | 该格能否据此勾选 |
| --- | ------------------ | ------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------- |
| 16  | `pause` / `resume` | 评论 `@ai-reviewer pause`       | 回复「已暂停」；description 出现 `state: paused`                                                | 需 #16 + #20     |
| 17  | —                  | 推 commit **A**                 | 日志出现 `review automation is paused`，自动审查跳过；PR 上无新评论                             | 前置步骤         |
| 18  | `review`           | 评论 `@ai-reviewer review`      | **只审 A**（日志显示起点是上次已审 commit，不是 base）；摘要评论里的 reviewed SHA 更新为 A      | ✅ 可勾          |
| 19  | —                  | 推 commit **B**                 | 同 `#17`，自动审查跳过                                                                          | 前置步骤         |
| 20  | `full review`      | 评论 `@ai-reviewer full review` | **从 base 到 B 的完整 diff 被审查**（日志显示起点是 base commit）；不是 `already been reviewed` | ✅ 可勾          |
| 21  | `pause` / `resume` | 评论 `@ai-reviewer resume`      | 回复「已恢复」；description 中 `state: active`                                                  | 与 #16 合并后 ✅ |

> `#20` 若想同时用来构造 §2.1 的旧 SHA 场景（趁它跑的时候推 B'），那次运行会因 HEAD 变化放弃结果
> ——**那不能算 `full review` 通过**。旧 SHA 验完之后要再跑一次干净的 `full review`，证明成功路径。

另有两格由这轮顺带产生：

| #   | 对应 §15 行              | 判定证据                                                                                                            | 该格能否据此勾选 |
| --- | ------------------------ | ------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 22  | pause marker             | `#16` 写入后 description 里的 `ai-reviewer:github:review-state-start` 区块，且用户原描述与 release notes 区块都还在 | ✅ 可勾          |
| 23  | ACK reaction/award emoji | 任一命令评论上出现表情反应                                                                                          | ✅ 可勾          |

---

## 4. 需要单独构造

| #   | 对应 §15 行              | 怎么构造                                                  | 该格能否据此勾选                            |
| --- | ------------------------ | --------------------------------------------------------- | ------------------------------------------- |
| 24  | 行级回复/对话上下文      | 在 bot 的**行级评论**下回复 `@ai-reviewer 这里为什么？`   | ✅ 可勾（bot 在同一 thread 内针对该行回复） |
| 25  | 命令进程内限流与事件幂等 | 见下                                                      | ❌ 大概率不能勾                             |
| 26  | 权限校验                 | 用一个**对本仓库只有读权限**的账号发 `@ai-reviewer pause` | ✅ 可勾（回复「权限不足」）                 |

### 4.1 注意矩阵里有**两个**幂等相关的格子

§15 里这是两行，别混：

| 矩阵行                     | 含义                                    | 本轮能否勾       |
| -------------------------- | --------------------------------------- | ---------------- |
| `event 幂等`               | 同一事件重复投递 / rerun 不重复发布结果 | ✅ 由 `#11` 证明 |
| `命令进程内限流与事件幂等` | 命令层的限流 **与** 幂等，两者都要      | ❌ 见下          |

后者要求限流也被验证，而 GitHub 的每条 comment 事件起一个独立 runner 进程，桶从零开始——这正是
`CMD-029` 明确写下的边界，除非能在**一次运行内**制造多条命令，否则限流不会触发。

**所以 `命令进程内限流与事件幂等` 这一格保持不勾**，即使 `#11` 和命令幂等都通过。在矩阵说明里写明：
「事件幂等已验证，进程内限流受 CMD-029 边界限制无法在真实环境构造」。

### 4.2 权限校验要两个方向

GitLab 那轮只验过「权限足够 → 放行」。这次两个方向都要：放行方向是
`#12`、`#13`、`#14`、`#15`、`#16`、`#18`、`#20`、`#21` 八条命令（`#17`、`#19` 是推 commit 的前置步骤
，不算命令），`#26` 是拒绝方向。两个方向都过才勾。

---

### 4.3 两行对 GitHub-only 列不适用

| 矩阵行         | GitHub-only 列                                    |
| -------------- | ------------------------------------------------- |
| 平台状态隔离   | `N/A`（矩阵里本就标 N/A，只有「同时启用」列适用） |
| 单平台故障隔离 | `N/A`（同上）                                     |

这两行不需要在本轮做任何事，保持 `N/A` 不动。

---

## 5. 记账规则

- 逐格勾选 §15 矩阵的 **GitHub-only** 列，**按「该格能否据此勾选」列判断**，不是按步骤数
- 每个勾附上证据出处：Actions run 链接 / 评论链接 / 日志行
- 验不出来的格子**保持空**，并在矩阵上方说明段落里写明原因（照 GitLab-only 那轮的写法）
- 验证用 PR 跑完后关闭不合并；探测用的 `eslint.config.js` 不要合并进默认分支
- 若过程中发现真实 bug，按「当天修复当天合并」开独立分支处理

## 6. 本清单能推进哪些条目

| 条目                                                               | 完成条件                                                                                                                                                                                                                               |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §3 验收 ②「GitHub 自动审查、摘要、行级评论和评论命令仍可正常运行」 | #1+#10（自动审查）、#2（摘要）、#3（行级评论）、**`#12`、`#13`、`#14`、`#15`、`#16`、`#18`、`#20`、`#21` 全部通过**（评论命令：help / configuration / summary / resolve / pause / review / full review / resume 八条）。少任一条都不算 |
| §15 GitHub-only 列                                                 | 逐格按上表判定                                                                                                                                                                                                                         |

**本清单不足以支撑 `TEST-016/017`。** 那两条要的是 GitHub-only「**全功能** 通过」，且需要分别在「无
任何 GitLab 配置」与「GitLab 配置存在但不可达」两种条件下结果一致。本轮跑的是默认环境，既没有刻意清
空 GitLab 变量，也没有注入 GitLab 故障——只能称为「GitHub 核心链路的真实验证」。

`TEST-016/017` 的真实环境对应物需要另外设计：在真实仓库上分别以两种环境变量状态各跑一轮完整功能，比
较结果一致。单元测试侧已有 `github-only-feature-matrix.test.ts`（29 条，14 项能力 × 2 种条件）覆盖。
