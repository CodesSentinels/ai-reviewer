# 迭代三 · Phase 4 增补：Semgrep 规则集导出与自定义指南

> **配套阅读**：[06-iteration-semgrep-design.md](./06-iteration-semgrep-design.md)（架构与默认行为）
>
> **实现位置**：[src/lint/adapters/semgrep.ts](../src/lint/adapters/semgrep.ts) · [action.yml](../action.yml) 中 `semgrep_config` 输入
>
> **目标读者**：希望把 ai-reviewer 接入团队代码规范的工程师；希望脱离 semgrep.dev 实现离线/可控扫描的 SRE

本文回答两个问题：

1. **怎么把 `p/default` 导出成本地文件**（用于离线 runner、固定版本、审计规则真实内容）
2. **怎么把团队代码规范沉淀成 semgrep 自定义规则**（含精度调优与"规范 → 规则"流程）

---

## 1. 背景：本项目当前的规则集来源

ai-reviewer 默认调用：

```bash
semgrep scan --json --config=p/default <files...>
```

`p/default` 是 [Semgrep Registry](https://semgrep.dev/p/default) 上的 ruleset 别名（OWASP Top 10 的精选集）。**首次运行会从 `semgrep.dev` 拉取规则 yaml 缓存到 `~/.semgrep/`，之后命中本地缓存即离线可用**。这带来三个问题：

| 问题 | 影响 |
|:----|:----|
| GitHub Actions runner 每次冷启动 → 仍要联网 | 公司内网/防火墙环境会拉取失败；规则更新引入隐性变更 |
| 看不到规则真实内容 | Review failed PR 时，工程师不知道规则究竟做了什么匹配 |
| 无法在规则集里"夹带"团队私有规则 | 自定义规范只能写到另一个 config，调用方要管理多个 `--config` |

下文给出两条解决路径：**导出 + 私有化**，以及**自定义规则编写**。

---

## 2. 导出 `p/default` 规则集

### 2.1 三种导出方式

| 方式 | 命令 | 产物 | 适用场景 |
|:----|:----|:----|:--------|
| A. `--dump-config` | `semgrep --config=p/default --dump-config` | 单个 JSON（含所有规则展开） | 调试 / 编程消费 |
| B. 缓存目录捞 yaml | 先跑一次扫描 → `cat ~/.semgrep/cache/<hash>` | 原始 yaml 集合 | 想保留 yaml 注释/结构 |
| C. Registry API | `curl https://semgrep.dev/api/registry/rule/p/default` | 单个 yaml | CI 中拉取最新版冻结 |

> 推荐方式 **C**：稳定、可版本化、产物是单文件 yaml 直接喂给 `--config=`。

### 2.2 操作步骤（以本项目为例）

#### 步骤 1：本机或临时 runner 上拉取规则

```bash
# 注：项目用 pip 沙箱安装在 /tmp/ai-reviewer-lint-tools/python-tools/bin/semgrep
# 本机想试可以直接 pipx install semgrep（不污染全局 site-packages）
pipx install semgrep==1.95.0

# 方式 C —— 直接从 Registry 拉 yaml
mkdir -p .semgrep-rules
curl -sSL "https://semgrep.dev/c/p/default" -o .semgrep-rules/p-default.yaml

# 验证：规则数量 + 文件大小（p/default 通常 200~400 条，~500KB）
grep -c '^- id:' .semgrep-rules/p-default.yaml
```

#### 步骤 2：冻结到仓库（推荐 ai-reviewer 这种工具仓库）

```
ai-reviewer/
├── src/lint/adapters/semgrep.ts
└── rules/
    └── semgrep/
        ├── p-default.snapshot.yaml          ← 导出的官方规则
        ├── p-default.snapshot.version.txt   ← 记录拉取时间 + semgrep 版本
        └── custom/                          ← 团队自定义规则（见 §3）
```

`p-default.snapshot.version.txt` 长这样：

```
source: https://semgrep.dev/c/p/default
fetched_at: 2026-05-21T08:30:00Z
semgrep_version: 1.95.0
sha256: <对 yaml 内容做哈希，作为漂移检测基准>
```

#### 步骤 3：让 ai-reviewer 用本地文件

action.yml 已暴露 `semgrep_config`，工作流里：

```yaml
- uses: CodesSentinels/ai-reviewer@v1
  with:
    enable_semgrep: 'true'
    # 路径相对待审仓库根（即 GITHUB_WORKSPACE）
    semgrep_config: 'rules/semgrep/p-default.snapshot.yaml'
```

`semgrep_config` 透传到 `SemgrepAdapter` 构造函数（[semgrep.ts:158-160](../src/lint/adapters/semgrep.ts#L158-L160)），最终作为 `--config=` 的参数。本地路径会绕过 Registry 联网拉取。

### 2.3 与 `--dump-config` 的关系

如果你想看**展开后的规则真实内容**（包含从 ruleset 引用展开后的所有具体规则），用方式 A：

```bash
semgrep --config=p/default --dump-config > rules-flat.json
```

JSON 适合做规则审计脚本（统计有多少条 `pattern` / 多少条 `taint` 模式）。但**生产环境用 yaml**——Semgrep 解析 yaml 更快、报错信息更友好。

### 2.4 漂移检测（防止规则集偷偷变了）

把 `p-default.snapshot.yaml` 放进 CI：每天拉一次最新版，对比 SHA。这部分超出本文档范围，但建议在 `rules/semgrep/` 下加一个 `update-snapshot.sh`：

```bash
#!/usr/bin/env bash
set -euo pipefail
TMP=$(mktemp)
curl -sSL "https://semgrep.dev/c/p/default" -o "$TMP"
NEW_SHA=$(shasum -a 256 "$TMP" | awk '{print $1}')
OLD_SHA=$(grep '^sha256:' rules/semgrep/p-default.snapshot.version.txt | awk '{print $2}')
if [[ "$NEW_SHA" != "$OLD_SHA" ]]; then
  echo "::warning::p/default drifted: $OLD_SHA -> $NEW_SHA"
  exit 1   # 在 CI 里挂掉，强制人工审阅
fi
```

---

## 3. 自定义规则：把团队代码规范变成 Semgrep 规则

### 3.1 规则文件最小骨架

```yaml
rules:
  - id: no-console-log-in-prod-code
    message: 生产代码不要留 console.log，请使用 logger
    severity: WARNING
    languages: [typescript, javascript]
    pattern: console.log(...)
```

字段语义（与本项目 `SemgrepResult` 接口对照——见 [semgrep.ts:55-75](../src/lint/adapters/semgrep.ts#L55-L75)）：

| 字段 | 对应 LintResult 字段 | 备注 |
|:----|:------|:----|
| `id` | `ruleId` | 唯一标识；建议 `team-frontend.<topic>.<rule>` 三段式 |
| `message` | `message` | 评论里直接展示；写"建议怎么改"比"做错了什么"更有用 |
| `severity` | `severity`（经 `mapSemgrepSeverity` 转换）| `ERROR` → `error`；`WARNING` → `warning`；`INFO` → `info` |
| `languages` | —— | 决定 `--config` 加载时对哪些扩展名生效 |
| `pattern` | —— | 匹配主体；详见 §3.2 |
| `metadata.cwe` / `metadata.owasp` | 拼到 `message` 末尾 | 见 `formatVulnTags`，[semgrep.ts:425-444](../src/lint/adapters/semgrep.ts#L425-L444) |
| `fix` | `suggestion` / `fixable` | 写了就成自动修复建议；LLM 会读这个字段生成 PR diff |

### 3.2 Pattern 写法：从粗到细

#### 3.2.1 `pattern`：单条匹配

```yaml
# 命中所有 console.log，不管参数是什么（`...` 是 metavariable，匹配任意表达式）
pattern: console.log(...)
```

#### 3.2.2 `patterns`：组合（AND）

```yaml
# 同时满足：A 是 console.log；B 不在 catch 块里（精度提升 → 减少误报）
patterns:
  - pattern: console.log(...)
  - pattern-not-inside: |
      try { ... } catch (...) { ... }
```

#### 3.2.3 `pattern-either`：候选（OR）

```yaml
patterns:
  - pattern-either:
      - pattern: dangerouslySetInnerHTML={ ... }
      - pattern: $EL.innerHTML = $X
```

#### 3.2.4 metavariable 约束：精度的关键

普通 `$X` 匹配任意表达式；想限定其内容，加 `metavariable-pattern` / `metavariable-regex`：

```yaml
- id: no-direct-dom-html-with-user-input
  message: innerHTML 不能拼接 user input 变量；用 textContent 或 DOMPurify.sanitize
  severity: ERROR
  languages: [typescript, javascript]
  patterns:
    - pattern: $EL.innerHTML = $X
    - metavariable-regex:
        metavariable: $X
        # 经验法则：变量名包含 user/input/query/params/raw 的多半是污染源
        regex: '.*(user|input|query|params|raw|payload).*'
  metadata:
    cwe: "CWE-79: Cross-site Scripting"
    owasp: "A03:2021 - Injection"
```

注意 `metadata` 里的 `cwe` / `owasp` 是给本项目用的——`SemgrepAdapter` 会读取它们并拼到 message 末尾，让 LLM 在 PR 评论里准确说出"这是 XSS / 注入"。

#### 3.2.5 `taint` 模式：跨变量的污点追踪（精度天花板）

```yaml
- id: react-router-param-into-href
  message: 路由参数直接进 anchor href，可能造成 javascript: 协议注入
  severity: ERROR
  mode: taint
  languages: [typescript, javascript]
  pattern-sources:
    - pattern: useParams()
    - pattern: useSearchParams()
  pattern-sinks:
    - pattern: <a href={$X} ... />
  pattern-sanitizers:
    - pattern: sanitizeUrl($X)
```

taint 模式比单纯 `pattern` 强大，但**编译开销也大**——团队规则集别全用 taint，按需。

### 3.3 精度问题：会丢失吗？怎么补？

**会丢失，分两类**：

| 丢失类型 | 表象 | 处理 |
|:--------|:----|:----|
| **假阴性**（漏报） | 等价写法没匹配上（如 `console['log'](...)`、`(0, console.log)(...)`） | 用 `pattern-either` 穷举常见变形；或写 e2e 测试样例（见 §3.4）防止以后改规则又漏 |
| **假阳性**（误报） | 测试代码 / mock 代码也命中 | 加 `pattern-not-inside` / `paths.exclude` / metavariable 约束收窄 |

#### 假阳性常见兜底：`paths`

```yaml
- id: no-console-log-in-prod-code
  paths:
    exclude:
      - "**/*.test.{ts,tsx}"
      - "**/*.stories.{ts,tsx}"
      - "**/__mocks__/**"
      - "**/scripts/**"
  pattern: console.log(...)
```

#### 假阳性收窄：`pattern-not`

```yaml
patterns:
  - pattern: console.log(...)
  - pattern-not: console.log("[debug-allowed]", ...)
```

#### 精度评估建议

每条新规则上线前，**在仓库历史代码上跑一遍**：

```bash
semgrep --config=rules/semgrep/custom/no-console-log.yaml --json . \
  | jq '.results | length'
```

如果命中 0 → 规则没用 / 规则写错了；如果命中几千 → 多半是假阳性，需要收窄。健康区间因仓库而异，但**首次命中 >100 几乎一定要回头改规则**。

### 3.4 "规范 → 规则化"流程

把团队 Wiki 上的"我们约定 XXX"变成可执行规则，建议走这五步：

```
┌────────────────┐   ┌────────────────┐   ┌────────────────┐   ┌────────────────┐   ┌────────────────┐
│ ① 规范文本      │ → │ ② 失败/通过样例 │ → │ ③ 草稿 pattern  │ → │ ④ 历史代码回测  │ → │ ⑤ 灰度上线      │
│   (Wiki 句子)   │   │   (.test.yaml)  │   │   (.yaml)       │   │   (统计命中数)  │   │   (info→warn)   │
└────────────────┘   └────────────────┘   └────────────────┘   └────────────────┘   └────────────────┘
```

#### 步骤 ② 的测试用例文件（与规则同名 `.test.yaml`）

```yaml
# rules/semgrep/custom/no-console-log.test.yaml
rules:
  - id: no-console-log-in-prod-code
# 紧跟其后用 `# ruleid:` 和 `# ok:` 注释样例：
```

```typescript
// rules/semgrep/custom/no-console-log.test.ts

// ruleid: no-console-log-in-prod-code
console.log("hello")

// ok: no-console-log-in-prod-code
logger.info("hello")

// ok: no-console-log-in-prod-code  ← 测试代码豁免
// 文件名实际在 paths.exclude 里
```

跑测试：

```bash
semgrep --test --config rules/semgrep/custom/
```

`--test` 会扫所有同目录的 `.test.<ext>` 文件，并比对 `ruleid:` / `ok:` 注释，输出准确的 P/R 数字。**这是规则迭代必须有的回归基础**。

#### 步骤 ⑤ 的灰度策略

- 新规则首发 `severity: INFO`（本项目映射到 LintResult.severity = `'info'`，多数 PR 评论会被折叠/不阻断）
- 观察一两周，FP 率 < 5% 后升 `WARNING`
- 再观察，升 `ERROR`（PR 评论顶部高亮）

本项目目前没有按 severity 区分阻断/非阻断的逻辑，所以灰度更多体现在"评论噪音"层面。如果未来加入"ERROR 阻断 merge"机制，这条灰度路径就更有意义。

### 3.5 在 ai-reviewer 中启用自定义规则集

#### 单一自定义文件

```yaml
- uses: CodesSentinels/ai-reviewer@v1
  with:
    enable_semgrep: 'true'
    semgrep_config: 'rules/semgrep/custom/no-console-log.yaml'
```

#### 自定义 + p/default 联用

Semgrep 支持多 `--config`，但 ai-reviewer 当前的 `semgrep_config` 输入是**单值**字符串（参见 [adapters/semgrep.ts:262](../src/lint/adapters/semgrep.ts#L262)）。两种方法：

**方法 A**：写一个 wrapper yaml，用 `include` 把多个规则合在一起：

```yaml
# rules/semgrep/combined.yaml
rules:
  - id: __dummy__   # 顶层必须有 rules，且至少一条
    message: placeholder
    severity: INFO
    languages: [generic]
    pattern: __NEVER_MATCH_THIS__
include:
  - rules/semgrep/p-default.snapshot.yaml
  - rules/semgrep/custom/
```

> 注意：Semgrep yaml 的 `include` 仅在部分版本支持，且行为不稳定。**推荐方法 B**。

**方法 B**：建一个目录，里头放多个 yaml，Semgrep 会全部加载：

```
rules/semgrep/active/
├── p-default.snapshot.yaml
├── custom-no-console-log.yaml
└── custom-no-direct-dom-html.yaml
```

```yaml
semgrep_config: 'rules/semgrep/active/'
```

`--config=<dir>` 时 Semgrep 递归加载目录下所有 yaml，结果合并到同一次扫描。

**方法 C**（需要改本项目）：把 `semgrep_config` 升级为支持多值（逗号分隔或 multiline）。改动点：

- [action.yml](../action.yml) `semgrep_config` 输入文档补充
- [src/main.ts:72](../src/main.ts#L72) 解析多值
- [src/lint/adapters/semgrep.ts:262](../src/lint/adapters/semgrep.ts#L262) 把单个 `--config=` 拆成多个

如果需求够强烈，可以在下一个 iteration 立项；目前推荐用方法 B 走目录。

---

## 4. 常见坑

| 现象 | 原因 | 处理 |
|:----|:----|:----|
| `semgrep --config` 指定相对路径但 0 findings | 路径相对的是 `cwd`，不是仓库根；本项目 `cwd=repoRoot`（[orchestrator.ts](../src/lint/orchestrator.ts)），所以写仓库相对路径即可 | 用 `ls` 在 CI 里先 echo 确认文件存在 |
| 自定义规则在本机能跑，CI 跑不到 | CI 拉的是 GITHUB_WORKSPACE 下的待审仓库快照，规则文件没在那个仓库里 | 把规则放进**待审仓库**；或者用 ai-reviewer fork 把规则打进镜像 |
| 命中变多但都集中在一个文件 | 该文件触发了规则的等价模式（多半是测试 fixture） | `paths.exclude` 豁免；或缩小 metavariable |
| `metadata.cwe` 写了但评论里没显示 | 字段名拼写错、或者 `cwe` 写成了对象不是字符串/数组 | 用 `string` / `string[]`；对照 [semgrep.ts:64-73](../src/lint/adapters/semgrep.ts#L64-L73) 接口 |
| 离线 runner 一直拉规则失败 | semgrep 仍尝试 phone home metrics | 本项目已 `SEMGREP_SEND_METRICS=off` + `--disable-version-check` + `--metrics=off`（[semgrep.ts:259-260](../src/lint/adapters/semgrep.ts#L259-L260)）；再失败就是 `--config=p/<name>` 联网，必须切到本地 snapshot |

---

## 5. 小结

- **导出 p/default**：`curl https://semgrep.dev/c/p/default` 拿 yaml，冻结到 `rules/semgrep/p-default.snapshot.yaml`，通过 `semgrep_config` 输入指向本地文件。
- **自定义规则**：从单 `pattern` 起步，按需升级到 `patterns` / `pattern-either` / metavariable 约束 / `taint` 模式，逐步收紧精度。
- **精度治理**：`paths.exclude` 兜底 FP；`pattern-not-inside` 收窄上下文；`--test` + `.test.ts` 文件做规则回归。
- **流程**：规范文本 → 测试样例 → 草稿规则 → 历史代码回测 → 灰度 severity。
- **本项目集成**：单文件直接 `semgrep_config: <path>`；多规则用目录形态。多值 `--config` 需要本项目侧改动，目前不支持。
