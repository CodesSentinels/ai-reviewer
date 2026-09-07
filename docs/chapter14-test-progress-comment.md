<!--
这份文件是 §14 自动化测试那个任务组的 **GitHub Issue 进度评论草稿**，不是设计
文档。按项目约定，§14 各批测试提交后不单独开 Issue，等全章收尾再统一开一个、
并只维护一条进度评论。

用法（Issue 尚未创建）：
    gh issue create --title "test: §14 自动化测试（TEST-006/028~033/039/040）" \
      --body-file docs/chapter14-test-progress-comment.md

已创建后要更新那条评论（不要追加新评论）：
    gh api -X PATCH repos/CodesSentinels/ai-reviewer/issues/comments/<id> \
      -F body=@docs/chapter14-test-progress-comment.md

维护约定：
- 提交记录里的 SHA 必须是**完整 40 位、不加反引号**，GitHub 才会自动渲染成
  可点链接；若发生 rebase 需用 `git rev-parse` 重新取新 SHA 覆写，不能留旧值
- 真实环境那八条（TEST-018/019/021/022~026）完成后，把结果并进「已知未完成
  项」并相应上移，不新增小节
-->

## 进度更新

§14 自动化测试的**纯代码部分已全部完成**。TEST-006 / 028 / 029 / 030 / 031 / 032 / 033 / 039 / 040 九条，分七批交付。剩余八条全部阻塞在真实环境，见文末。

### 提交记录

源码提交与其对应的 dist 重打包成对列出。TEST-030 / 033 / 040 三批无源码改动（或只动 `.gitlab-ci.yml`），不需要重打 dist。

- 3f4384ed34ed930334560ec796a031e6d8920fd0 — 文件树契约与缓存隔离（TEST-031/039）
- d238226099ab6d7328f6bc47667778466773cf42 — 重新打包 dist
- 941068e8e7bfab22154e9bc905ef532de33aeb9d — GitLab diff position 四维映射（TEST-006）
- 303bb4dc8f7e0166870c19a46eef548b8462acb8 — 重新打包 dist
- 1151a7433f1b50ea8f18208aa813187bbd2dc1e1 — 依赖分析两平台一致性（TEST-032）
- f168a996542a119b777356a3e4044db44629b59f — 重新打包 dist
- c9e3641e5bae80d929d49506e20063bf1f86a68a — bot/system/self 不调用模型（TEST-028）
- 8a85d8b569ecd8a6d31d37447df3a1ea869d51c0 — 重新打包 dist
- 4ea0d482d5c3fd212a3ea5db04b3a6357e2bd6a6 — Web search 开关到请求体的接线（TEST-030）
- 329b036ac5ffc8a80f54eaa23a668c20ffc06a8a — 密钥出口清单（TEST-029）
- 5f06e43572f4ebbd8a36e96e0c9f5c888baf098e — 重新打包 dist
- 68a0956bfbaacc9e1cabb5606cae66da41adcc6a — release notes 就地更新路径的内容保护（TEST-033）
- 4e09c9645cfc2de6bdb39957f870be7b90e55fd4 — CI 产物来源的行为验收（TEST-040）

### 新增模块

八个测试文件，2739 行 / 131 条用例：

| 文件 | 用例 | 对应项 |
| --- | --- | --- |
| `__tests__/repo-tree-platform-contract.test.ts` | 20 | TEST-031 |
| `__tests__/repo-tree-cache-isolation.test.ts` | 16 | TEST-039 |
| `__tests__/gitlab-diff-position.test.ts` | 17 | TEST-006 |
| `__tests__/dep-analysis-platform-parity.test.ts` | 13 | TEST-032 |
| `__tests__/no-model-call-for-bot-events.test.ts` | 22 | TEST-028 |
| `__tests__/web-search-request-wiring.test.ts` | 12 | TEST-030 |
| `__tests__/secret-egress.test.ts` | 13 | TEST-029 |
| `__tests__/ci-trigger-bundle-provenance.test.ts` | 18 | TEST-040 |

另在 `release-notes-dual-platform.test.ts` 补 3 条 + 1 处断言（TEST-033）。

### 实现要点

**共同发现：既有测试普遍停在「判定层」，接线层和第二个出口没人看。** 纯函数验得很细、某一个出口焊得很死，但「判定的结果有没有真的作用到产物上」「同一类内容还有没有别的出口」几乎没有覆盖。九条里八条挖出了生产缺陷。

**变异验证是本轮最有效的手段**——先把生产代码故意改坏，再看测试红不红。三次都把「看起来有覆盖」和「真的有覆盖」区分开了：

| 变异 | 既有测试 | 新增测试 |
| --- | --- | --- |
| 注释掉 `bot.ts` 的 `sanitizeModelOutput` 调用 | 30 条全绿 | 红 2 条 |
| `writeSection` 就地更新分支退化为整份覆盖 | 21 条全绿（含名字里写着「不覆盖」「用户原始描述保留」的） | 红 4 条 |
| `--is-ancestor` 两个参数写反 | 25 条全绿（字符串存在性断言） | 红 2 条 |

验证后一律用备份文件还原，`git diff -- src` 确认为空。

测试组织上的三处调整：**按出口而不是按函数**组织密钥检查（TEST-029）；给两个平台喂**各自的原生 payload** 而不是同一份已归一化数据，并故意让条目顺序不同（TEST-032）；把内联 shell **从 `.gitlab-ci.yml` 原样抽出来**真跑，而不是在测试里抄一份（TEST-040）。

### 顺带修复

写测试过程中发现并修复的生产缺陷，按严重度排列：

| # | 问题 | 修法 |
| --- | --- | --- |
| 1 | 密钥经命令失败回帖进入**公开评论** | `Reply.publish()` 收口脱敏 |
| 2 | 两个 adapter 脱敏强弱**双向**不对称 | 统一到 `redactForLog` |
| 3 | `SOURCE_SHA` 未校验格式即交给 git，来源校验变成**恒真** | git 调用前先卡 `^[0-9a-fA-F]{40}$` |
| 4 | GitHub PAT 身份下自评论无过滤，命令可形成**反馈循环** | 共享 dispatcher 复用 `isOwnAuthor` |
| 5 | 候选排序随平台条目顺序漂移，两平台分析**不同文件集** | `sortByProximity` 加路径字典序兜底 |
| 6 | 文件树截断状态在链路上四处丢失 | `DirectoryLister` 契约改为 `{files, truncated}` 等四处 |
| 7 | `diff_refs` 不完整时发出注定被拒的请求 | 提前判死走 GLAPI-015 顶层降级 |
| 8 | CI `dependencies` 省略导致两条防线合成一条 | 显式 `dependencies: []` |
| 9 | release notes 就地更新路径的用户内容保护是空的 | 补一组三条 + 原有用例加断言 |

前三条展开：

**1. 密钥进公开评论。** `dispatcher.ts` 把任意 handler 异常的 message 原样交给 `reply.error(code, detail)`，渲染成「详情: …」贴出去。这条路一次 Logger 都没经过，SEC-008 的日志门禁管不到。PR/MR 评论比日志更糟：对所有人可见且一直留着。修在 `publish()` 收口处而不是 `error()` 里，理由与 SEC-008 当初把脱敏放在 Logger 层而非各调用点相同。

**2. 脱敏双向不对称。** GitHub 的 `toGitPlatformError` 原本是裸的 `String(e)`；改用 `redactForLog` 后补的对称性用例又暴露出 GitLab 的 `normalizeGitLabError` 用的是窄实现（只认 glpat- / Bearer / `?token=` / `?private_token=` 四种，漏掉 OpenAI key 与 GitHub token 形态）。

**3. 来源校验恒真。** git 的 rev 参数接受完整 revision 语法，`HEAD` / 分支名 / `HEAD~1` / 短 SHA 全部放行——尤以 `HEAD` 为甚：在 trigger job 的 clone 里它解析成 `CI_COMMIT_SHA` 自己，自己是自己的祖先，两道校验一道不剩，日志还照打 `ok: ... is a real ancestor`。CI-013 要保的「产物来源可追溯到本分支真实历史」直接归零。另加结构门禁断言格式校验的位置早于 `git cat-file` 与 `git merge-base`。

第 5 条的具体表现（同一个 PR、`max_dependency_files=2`）：

```
GitHub : ['src/utils/index.ts', 'src/数据/模型.ts']
GitLab : ['src/utils/index.ts', 'src/api/login.ts']
```

两平台分析不同文件、给出不同审查结论，且不报任何错。

### 文档订正

TEST-040 原文写「source commit **等于** `CI_COMMIT_SHA`」，那是 2026-08-18 真实环境验证之前的旧语义——精确相等在「先算 HEAD 再提交」的流程下永远无法自洽，已于 PR #119 改为祖先链校验。CI-013 与 §12 状态说明都已是新语义，只有这条测试项没跟上，本次一并改正。

### 测试

全量 **108 suites / 2462 passed**（9 skipped）。`tsc --noEmit`、`eslint`、`prettier`、`npm run smoke` 均通过。

涉及源码改动的批次另逐一确认了修复代码进入对应 bundle：GitHub adapter 的只进 `dist/index.js`、GitLab adapter 的只进 `dist/gitlab-trigger/index.js`、共享核心的两个都进，与架构门禁一致。

### 已知未完成项

**§14 剩余八条全部阻塞在真实环境，不是遗漏：**

- `TEST-018` / `019` / `021` — 需要真实双平台环境
- `TEST-022`~`026` — 需要真实 GitLab 项目设置。真正把密钥挡在恶意 MR 之外的是 Protected variables 与受保护默认分支两项**项目设置**，仓库里没有任何投影；攻击者改自己分支的 `.gitlab-ci.yml` 后仓库内的结构校验统统可以删掉。五条结构相同，只勾其中几条不自洽（论证见 f36ca99cc4a674d1d193e0f9f4d5ba7f371bc042）

**两项挂起，等真实环境时一并验：**

- **GitLab 重命名文件的 `old_path` 映射**（GLAPI-014 记录在案的已知简化）。`ReviewCommentDraft` 只有一个 `path` 字段，adapter 只能把 `old_path` 填成与 `new_path` 相同的值，对改名文件与 GitLab 语义不符，最坏情况是该文件的行级评论退化成顶层 note（内容不丢，但没了行号锚点）。GitLab 会不会拒绝无法在本地断定，猜错反而会改坏现在能用的路径，故未动实现——`gitlab-diff-position.test.ts` 钉住了当前映射，将来修正时那条会先红。建议在真实 GitLab 上开一个「改名 + 改内容」的 MR 验证后再决定。
- **§15 验收矩阵「Repository tree / 跨文件依赖分析」行**未打勾：本轮交付的是单元/契约测试，不是真实环境端到端，而该表表头明确要求勾必须有 job 日志/API 证据支持。

**一处测试基础设施问题：** `gitlab-trigger-dispatch.integration.test.ts` 在全量并发下偶发 5s 超时（并发争用时跑到 11.3s，单独跑 1.5s / 15 条全过）。本轮出现两次，重跑均全绿，与改动无关。是否单独放宽 timeout 待定。
