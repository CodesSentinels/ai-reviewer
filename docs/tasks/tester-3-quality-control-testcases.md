# 测试人 3 — 对话交互与质量控制：完整测试用例与验证方案

> **负责范围**: 对话追问 + 噪音控制 + AI 评论去重 + Linter/SAST 集成 + Web 搜索 + Shell 执行
> **测试仓库**: `ai-reviewer-test` (`/Users/anton/Developer/CodesSentinels/ai-reviewer-test`)
> **触发规则**: PR target 到 `main` 或 `test/dev*`；push 到 `main` 或 `test/dev*`

---

## 测试环境说明

| 项 | 值 |
|---|---|
| Workflow 配置 | `.github/workflows/ai-reviewer.yml` |
| 触发分支规则 | PR target: `main` / `test/dev*`；push: `main` / `test/dev*` |
| 核心源文件 | `src/conversation.ts`, `src/noise-control.ts`, `src/review-dedup.ts`, `src/lint/` |
| 当前启用功能 | `enable_lint_tools: true`, `enable_web_search: true`, `enable_shell: true` |
| 模型 | heavyBot: `gpt-5.4-mini` |
| 相关配置 | `max_review_comments: 20`, `MAX_CONVERSATION_TURNS: 10`, `MAX_CHAIN_CHARS: 12000` |

---

## 3.1 对话式追问交互（P0）

| # | 场景 | 验证点 | 操作步骤 | 预期结果 |
|---|------|--------|----------|----------|
| 3.1.1 | 行级评论追问 | Bot 回复，引用该行代码上下文 | 在 Bot 产出的行级评论 thread 中评论 `@codesentinel 为什么这样不好？` | Bot 回帖引用对应代码行 + 具体解释 |
| 3.1.2 | 续轮追问 | 多轮上下文保持 | 在同一 thread 继续 `@codesentinel 怎么改？` | Bot 回复含修改建议，引用上一轮对话内容 |
| 3.1.3 | 不带 @bot 的回复 | Bot 不触发 | 在 thread 中直接回复（不含 mention） | Bot 无任何响应 |
| 3.1.4 | Bot 自回复不自触发 | 无无限循环 | 等待 Bot 回帖，观察 Actions 日志 | Bot 回帖后无新 workflow run |
| 3.1.5 | 追问引用文件完整 diff | 回复能感知整体变更 | 追问跨行的架构问题（如 "这个重构的整体思路是什么"） | 回复内容涵盖多行变更的上下文 |
| 3.1.6 | 追问引用 PR 摘要 | 回复关联 PR 目的 | 追问 "这个改动和 PR 目标有什么关系" | 回复引用 PR title/description 中的信息 |

### 验证代码 — 案例 3.1.1 ~ 3.1.2

先用以下代码触发 Bot 产出行级评论作为对话锚点：

```typescript
// conversation-anchor.ts — 设计为可追问的代码
export function processPayment(amount: number, userId: string) {
  // 安全问题：金额未做校验
  if (amount) {
    const query = `UPDATE balance SET amount = ${amount} WHERE user = '${userId}'`
    return executeQuery(query)
  }
}

export function generateToken(): string {
  // 安全问题：使用 Math.random 生成 token
  return Math.random().toString(36).slice(2)
}
```

**对话追问流程**（在 Bot 产出的 `processPayment` 评论 thread 中执行）：
1. `@codesentinel 为什么直接拼接 SQL 是个问题？可以具体说说攻击场景吗？`
2. (等 Bot 回复后) `@codesentinel 用参数化查询的话，这段代码应该怎么改？`

---

## 3.2 对话轮次与截断（P1）

| # | 场景 | 验证点 | 操作步骤 | 预期结果 |
|---|------|--------|----------|----------|
| 3.2.1 | 连续追问达 10 轮 | 第 11 轮被拒 | 在同一 thread 循环追问 11 次 | 第 11 次收到 "轮次已达上限" 提示 |
| 3.2.2 | 长对话上下文截断 | Bot 仍能正常回复 | 每轮发 500+ 字长文追问 | Bot 不报 token 超限，回复合理 |
| 3.2.3 | 截断后保留最近内容 | 引用最近几轮 | 第 8 轮追问引用第 7 轮内容 | 回复关联最近对话而非第 1 轮 |
| 3.2.4 | issue_comment 对话不支持 | 无响应 | 在 PR 主评论区（非行级 thread）输入 `@codesentinel 解释一下` | Bot 不回复（仅 pull_request_review_comment 支持对话） |

### 关键常量

```
MAX_CONVERSATION_TURNS = 10   // 单 thread 最多 10 轮 Bot 回复
MAX_CHAIN_CHARS = 12_000      // 对话链超过 12k 字符时截断
```

---

## 3.3 噪音控制（P0）

| # | 场景 | 验证点 | 操作步骤 | 预期结果 |
|---|------|--------|----------|----------|
| 3.3.1 | 严重级别徽标 | 评论顶部有对应 emoji + 中文标签 | 检查 Bot 行级评论格式 | 如 `🚨 严重` / `⚠️ 主要` / `📝 建议` / `💡 微调` |
| 3.3.2 | 级别排序 | critical > major > minor > nit | 多种问题混合的 PR，检查评论发布顺序 | critical 评论排在前，nit 排在后 |
| 3.3.3 | 评论数量截断 | 超过 `max_review_comments`(20) 时截断 | 提交包含 25+ 问题的代码 | 最多 20 条评论，摘要中提示 "N 条评论已省略" |
| 3.3.4 | 截断保留高优先级 | critical/major 不被截断丢弃 | 代码中混入 3 条 critical + 22 条 nit | critical 全部保留，被截断的是低优先级 |
| 3.3.5 | 同类评论合并 | 同文件同类问题去重 | 在同一文件中重复 5 次 `Math.random()` 模式 | 不产出 5 条重复评论，合并为 1~2 条 |
| 3.3.6 | `max_review_comments: 0` | 不截断 | workflow 设置 `max_review_comments: 0` | 所有评论都展示，无截断提示 |

### 验证代码 — 案例 3.3.1 ~ 3.3.5

```typescript
// quality-issues.ts — 混合各级别问题
import { readFileSync } from 'fs'

// ===== Critical 问题 =====
export function login(username: string, password: string) {
  const query = `SELECT * FROM users WHERE name='${username}' AND pwd='${password}'`
  eval(query)  // SQL注入 + eval
}

export function renderHtml(userInput: string) {
  document.innerHTML = userInput  // XSS
}

export function executeCommand(cmd: string) {
  require('child_process').execSync(cmd)  // 命令注入
}

// ===== Major 问题 =====
export async function fetchData(url: string) {
  fetch(url)  // 忘记 await
}

export function divide(a: number, b: number) {
  return a / b  // 未检查除零
}

export function parseConfig(json: string) {
  return JSON.parse(json)  // 未 try-catch
}

// ===== Minor / Nit 问题 =====
export function formatName(first: string, last: string) {
  var fullName = first + ' ' + last  // var → const/let
  return fullName
}

export function getRandomId() { return Math.random().toString(36).slice(2) }
export function getRandomToken() { return Math.random().toString(36).slice(2) }
export function getRandomKey() { return Math.random().toString(36).slice(2) }
export function getRandomValue() { return Math.random().toString(36).slice(2) }
export function getRandomHash() { return Math.random().toString(36).slice(2) }

export function unusedImportDemo() {
  const fs = readFileSync  // 未使用
  return 'hello'
}
```

**验证方式:**
- 检查评论排列顺序：SQL 注入/XSS/命令注入（critical）在前
- 检查 `Math.random` 系列 5 个函数是否被合并为 1~2 条评论
- 统计最终评论数（应 ≤ 20）

---

## 3.4 Linter/SAST 集成（P0）

| # | 场景 | 验证点 | 操作步骤 | 预期结果 |
|---|------|--------|----------|----------|
| 3.4.1 | ESLint 检测结果注入 | AI 评论引用 ESLint 规则 | 包含 ESLint 可检测问题（no-unused-vars、no-undef） | 评论中出现 "ESLint reports…" 或规则名 |
| 3.4.2 | tsc 类型错误 | AI 评论引用 TypeScript 错误码 | 包含类型不匹配代码 | 评论中出现 TS 错误码如 `TS2345` |
| 3.4.3 | Biome 检测 | AI 评论引用 Biome 规则 | 包含 Biome 可检测问题（如不安全的类型断言） | 评论中引用 Biome lint 规则 |
| 3.4.4 | 工具归因卡片 | 评论底部有 "🧰 Tools" 段落 | 检查行级评论末尾 | 含 `🧰 Tools` + 列出参与分析的工具名 |
| 3.4.5 | `enable_lint_tools: false` | 无 lint 相关内容 | workflow 设置 `enable_lint_tools: false` | 评论中无规则引用、无 Tools 卡片 |
| 3.4.6 | 单独禁用某工具 | 该工具不运行 | 设置 `enable_eslint: false` | 无 ESLint 规则引用，但 tsc/Biome 仍有 |
| 3.4.7 | Semgrep SAST 扫描 | 检出安全漏洞 | 设置 `enable_semgrep: true`，代码含注入/XSS | 评论中引用 Semgrep 规则 ID |

### 验证代码 — 案例 3.4.1 ~ 3.4.3

```typescript
// lint-violations.ts — 触发多种 lint 工具
import { readFileSync } from 'fs'

// ESLint: no-unused-vars
const unusedVariable = 42

// ESLint: no-undef (if not tsconfig-configured)
// tsc: TS2304 Cannot find name
function callUndefined() {
  return undeclaredFunction()
}

// tsc: TS2345 类型不匹配
function expectNumber(n: number): number {
  return n * 2
}
const result = expectNumber("hello" as any as number)

// Biome: noExplicitAny
export function unsafeAny(x: any): any {
  return x.foo.bar.baz
}

// Biome: useConst
export function shouldUseConst() {
  let value = 'never reassigned'
  return value
}
```

### 验证代码 — 案例 3.4.7 (Semgrep)

```typescript
// security-semgrep.ts — Semgrep SAST 可检测的安全问题
import express from 'express'
import { execSync } from 'child_process'

const app = express()

// semgrep: javascript.express.security.audit.xss.mustache-escape
app.get('/profile', (req, res) => {
  res.send(`<h1>Welcome ${req.query.name}</h1>`)
})

// semgrep: javascript.lang.security.audit.dangerous-exec
app.post('/run', (req, res) => {
  const output = execSync(req.body.command)
  res.json({ output: output.toString() })
})
```

---

## 3.5 AI 评论去重（P1）

| # | 场景 | 验证点 | 操作步骤 | 预期结果 |
|---|------|--------|----------|----------|
| 3.5.1 | 同一 lint finding 多条评论合并 | 合并为一条 | 同一 lint 规则在连续多行违规 | 合并为一条评论覆盖多行 |
| 3.5.2 | 不同 lint finding 不合并 | 各自保留 | 不同规则违反在相邻行 | 分别产出独立评论 |
| 3.5.3 | 合并后行号范围扩大 | 覆盖所有相关行 | 检查评论的 startLine-endLine | 范围从第一个违规行到最后一个 |
| 3.5.4 | 纯 AI 洞察精确行号去重 | 同行合并 | 无 lint 场景下 AI 对同一行产出多条评论 | 同行评论合并为一条 |

### 验证代码 — 案例 3.5.1 ~ 3.5.3

```typescript
// dedup-scenarios.ts — 触发评论合并
export function processItems(items: string[]) {
  // 连续 5 行相同模式违规 → 应合并
  var item1 = items[0]   // no-var
  var item2 = items[1]   // no-var
  var item3 = items[2]   // no-var
  var item4 = items[3]   // no-var
  var item5 = items[4]   // no-var

  // 不同类型违规 → 不应合并
  eval(item1)                           // no-eval (安全问题)
  console.log(item2)                    // no-console (风格问题)
  return item3 == item4 ? item5 : null  // eqeqeq (正确性问题)
}
```

---

## 3.6 Web 搜索与 Shell 执行（P2）

| # | 场景 | 验证点 | 操作步骤 | 预期结果 |
|---|------|--------|----------|----------|
| 3.6.1 | Web 搜索验证 API 用法 | Analysis chain 含 `web_search` 步骤 | 代码使用最新/冷门 API | 摘要或评论中引用搜索结果 |
| 3.6.2 | Shell 执行辅助分析 | Analysis chain 含 `shell` 步骤 | 代码有依赖版本相关问题 | Actions 日志有 shell 调用记录 |
| 3.6.3 | `enable_web_search: false` | 无 web_search 步骤 | workflow 关闭 web search | Actions 日志无 `[web_search_debug]` |
| 3.6.4 | `enable_shell: false` | 无 shell 步骤 | workflow 关闭 shell | Actions 日志无 shell 调用 |

### 验证代码 — 案例 3.6.1

```typescript
// web-search-trigger.ts — 使用冷门/新 API 触发联网搜索
import { experimental_useOptimistic } from 'react'

export function PaymentForm() {
  // 使用 Stripe Payment Element v3（假设为新发布 API）
  const [optimistic, setOptimistic] = experimental_useOptimistic(null)
  
  // 使用 Web Crypto API 的较新方法
  const key = crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: new Uint8Array(16), iterations: 100000, hash: 'SHA-256' },
    await crypto.subtle.importKey('raw', new TextEncoder().encode('password'), 'PBKDF2', false, ['deriveKey']),
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}
```

---

## 综合端到端脚本

```bash
#!/bin/bash
# setup-3-quality-control.sh — 创建包含多种质量问题的 PR
set -e

REPO_DIR="/Users/anton/Developer/CodesSentinels/ai-reviewer-test"
BRANCH="test/tester3-quality-$(date +%m%d-%H%M)"
TARGET="test/dev4"

cd "$REPO_DIR"
git fetch origin
git checkout -b "$BRANCH" "origin/$TARGET"

mkdir -p quality-tests

# 写入测试文件
cat > quality-tests/conversation-anchor.ts << 'EOF'
export function processPayment(amount: number, userId: string) {
  if (amount) {
    const query = `UPDATE balance SET amount = ${amount} WHERE user = '${userId}'`
    return executeQuery(query)
  }
}

export function generateToken(): string {
  return Math.random().toString(36).slice(2)
}
EOF

cat > quality-tests/quality-issues.ts << 'EOF'
import { readFileSync } from 'fs'

export function login(username: string, password: string) {
  const query = `SELECT * FROM users WHERE name='${username}' AND pwd='${password}'`
  eval(query)
}

export function renderHtml(userInput: string) {
  document.innerHTML = userInput
}

export function executeCommand(cmd: string) {
  require('child_process').execSync(cmd)
}

export async function fetchData(url: string) {
  fetch(url)
}

export function divide(a: number, b: number) {
  return a / b
}

export function formatName(first: string, last: string) {
  var fullName = first + ' ' + last
  return fullName
}

export function getRandomId() { return Math.random().toString(36).slice(2) }
export function getRandomToken() { return Math.random().toString(36).slice(2) }
export function getRandomKey() { return Math.random().toString(36).slice(2) }
export function getRandomValue() { return Math.random().toString(36).slice(2) }
export function getRandomHash() { return Math.random().toString(36).slice(2) }
EOF

cat > quality-tests/lint-violations.ts << 'EOF'
import { readFileSync } from 'fs'

const unusedVariable = 42

function callUndefined() {
  return undeclaredFunction()
}

function expectNumber(n: number): number {
  return n * 2
}
const result = expectNumber("hello" as any as number)

export function unsafeAny(x: any): any {
  return x.foo.bar.baz
}

export function shouldUseConst() {
  let value = 'never reassigned'
  return value
}
EOF

cat > quality-tests/dedup-scenarios.ts << 'EOF'
export function processItems(items: string[]) {
  var item1 = items[0]
  var item2 = items[1]
  var item3 = items[2]
  var item4 = items[3]
  var item5 = items[4]

  eval(item1)
  console.log(item2)
  return item3 == item4 ? item5 : null
}
EOF

git add quality-tests/
git commit -m "test: add quality control test files (tester 3)"
git push origin "$BRANCH"

echo ""
echo "✅ 分支已推送: $BRANCH"
echo ""
echo "下一步:"
echo "  1. 创建 PR: $BRANCH → $TARGET"
echo "  2. 等 Bot 产出行级评论"
echo "  3. 在评论 thread 中进行对话追问测试 (3.1)"
echo "  4. 检查评论格式 (3.3) 和 lint 引用 (3.4)"
```

---

## 测试结果记录模板

### 3.1 对话式追问交互（P0）

| # | 场景 | 结果 | 备注 |
|---|------|------|------|
| 3.1.1 | 行级评论追问 | ✅/❌/⚠️ | |
| 3.1.2 | 续轮追问 | ✅/❌/⚠️ | |
| 3.1.3 | 不带 @bot 不触发 | ✅/❌/⚠️ | |
| 3.1.4 | Bot 自回复不循环 | ✅/❌/⚠️ | |
| 3.1.5 | 引用文件完整 diff | ✅/❌/⚠️ | |
| 3.1.6 | 引用 PR 摘要 | ✅/❌/⚠️ | |

### 3.2 对话轮次与截断（P1）

| # | 场景 | 结果 | 备注 |
|---|------|------|------|
| 3.2.1 | 10 轮限制 | ✅/❌/⚠️ | |
| 3.2.2 | 长上下文截断 | ✅/❌/⚠️ | |
| 3.2.3 | 截断保留最近 | ✅/❌/⚠️ | |
| 3.2.4 | issue_comment 不支持 | ✅/❌/⚠️ | |

### 3.3 噪音控制（P0）

| # | 场景 | 结果 | 备注 |
|---|------|------|------|
| 3.3.1 | 严重级别徽标 | ✅/❌/⚠️ | |
| 3.3.2 | 级别排序 | ✅/❌/⚠️ | |
| 3.3.3 | 评论截断(20) | ✅/❌/⚠️ | |
| 3.3.4 | 截断保留高优先级 | ✅/❌/⚠️ | |
| 3.3.5 | 同类合并 | ✅/❌/⚠️ | |
| 3.3.6 | 不截断(max=0) | ✅/❌/⚠️ | |

### 3.4 Linter/SAST 集成（P0）

| # | 场景 | 结果 | 备注 |
|---|------|------|------|
| 3.4.1 | ESLint 结果注入 | ✅/❌/⚠️ | |
| 3.4.2 | tsc 类型错误 | ✅/❌/⚠️ | |
| 3.4.3 | Biome 检测 | ✅/❌/⚠️ | |
| 3.4.4 | 工具归因卡片 | ✅/❌/⚠️ | |
| 3.4.5 | lint 总开关关闭 | ✅/❌/⚠️ | |
| 3.4.6 | 单独禁用工具 | ✅/❌/⚠️ | |
| 3.4.7 | Semgrep SAST | ✅/❌/⚠️ | |

### 3.5 AI 评论去重（P1）

| # | 场景 | 结果 | 备注 |
|---|------|------|------|
| 3.5.1 | 同 lint 合并 | ✅/❌/⚠️ | |
| 3.5.2 | 不同 lint 不合并 | ✅/❌/⚠️ | |
| 3.5.3 | 合并行号范围 | ✅/❌/⚠️ | |
| 3.5.4 | 纯 AI 同行去重 | ✅/❌/⚠️ | |

### 3.6 Web 搜索与 Shell（P2）

| # | 场景 | 结果 | 备注 |
|---|------|------|------|
| 3.6.1 | Web 搜索触发 | ✅/❌/⚠️ | |
| 3.6.2 | Shell 执行 | ✅/❌/⚠️ | |
| 3.6.3 | 关闭 web search | ✅/❌/⚠️ | |
| 3.6.4 | 关闭 shell | ✅/❌/⚠️ | |

---

## 关键提示

1. **测试顺序**：先执行 3.3/3.4（噪音控制 + Lint），因为 Bot 需要先产出行级评论后才能进行 3.1（对话追问）
2. **等待时间**：每次 PR 创建 / push 后需等待 1~3 分钟让 Bot 完成审查
3. **Actions 日志**：3.2（轮次限制）、3.6（Web/Shell）需要查看 GitHub Actions 运行日志确认
4. **配置切换**：3.3.6、3.4.5、3.4.6、3.6.3、3.6.4 需要临时修改 workflow 配置，测试后恢复
5. **对话测试依赖**：3.1 和 3.2 依赖 Bot 先产出行级评论（由 3.3/3.4 的 PR 自动触发），建议在同一 PR 中先等审查完再开始追问
