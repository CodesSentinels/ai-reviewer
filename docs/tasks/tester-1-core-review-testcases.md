# 测试人 1 — 核心审查流程：完整测试用例与验证方案

> **负责范围**: PR 自动审查四阶段 + 增量审查 + 跨文件依赖分析 + 文件过滤 + Token 管理
> **测试仓库**: `ai-reviewer-test` (`/Users/anton/Developer/CodesSentinels/ai-reviewer-test`)
> **触发规则**: PR target 到 `main` 或 `test/dev*`；push 到 `main` 或 `test/dev*`

---

## 测试环境说明

| 项 | 值 |
|---|---|
| Workflow 配置 | `.github/workflows/ai-reviewer.yml` |
| 触发分支规则 | PR target: `main` / `test/dev*`；push: `main` / `test/dev*` |
| AI Reviewer 分支解析 | PR 时取 `base_ref`，push 时取 `ref_name` |
| 当前启用功能 | `enable_dependency_analysis: true`, `enable_lint_tools: true`, `enable_shell: true`, `enable_web_search: true` |
| 模型 | heavyBot: `gpt-5.4-mini` |
| path_filters | `**/*.ts`, `**/*.vue`, `**/*.js`, `**/*.md`, `**/*.yml`, `**/*.yaml`, `package.json`；排除 `*.lock`, `node_modules/`, `dist/`, `.output/` |

---

## 1.1 基础 PR 审查流程（P0）

| # | 场景 | 验证点 | 操作步骤 | 预期结果 |
|---|------|--------|----------|----------|
| 1.1.1 | 新建 PR 触发自动审查 | Bot 自动产出摘要评论 + 行级评论 | 从 `test/dev4` 拉出 feature 分支，提交含安全问题的代码，PR 回 `test/dev4` | 1~3 分钟内 Bot 发出顶部摘要 + 行级评论 |
| 1.1.2 | PR 摘要评论格式 | 包含 Walkthrough + Changes 表格 | 检查 Bot 第一条评论 | 含 `Walkthrough`、文件变更表格、`Summary by CodeSentinel` |
| 1.1.3 | 行级评论定位准确 | 评论定位到正确代码行 | 对比评论行号与实际问题行 | 行号 ±2 行内，引用代码片段可对应 |
| 1.1.4 | 发布说明写入 PR 描述 | PR body 末尾出现 release notes | 检查 PR 描述底部 | 含 `Summary by CodeSentinel` 段落 |
| 1.1.5 | `disable_review: true` 跳过行级审查 | 仅有摘要，无行级评论 | 在 workflow 中临时设置 `disable_review: true`，创建新 PR | 有摘要评论，无行级 review comments |
| 1.1.6 | `@codesentinel: ignore` 完全跳过 | 无任何 Bot 评论 | PR body 中加入 `@codesentinel: ignore` | Bot 不产出任何评论 |

### 验证代码 — 案例 1.1.1

```typescript
// utils/insecure-api.ts
import { createServer } from 'http'

export function handleRequest(req: any, res: any) {
  // 安全问题：SQL 注入
  const userId = req.query.id
  const query = `SELECT * FROM users WHERE id = '${userId}'`

  // 安全问题：未验证的 eval
  const code = req.body.expression
  const result = eval(code)

  // 正确性问题：忘记 await
  async function saveData(data: any) {
    fetch('/api/save', { method: 'POST', body: JSON.stringify(data) })
    // 没有 await，调用者无法感知错误
  }

  // 性能问题：循环中创建正则
  function filterItems(items: string[], pattern: string) {
    return items.filter(item => {
      const regex = new RegExp(pattern) // 每次循环都创建
      return regex.test(item)
    })
  }

  res.end(JSON.stringify({ result }))
}
```

### 验证代码 — 案例 1.1.6

PR body 内容：

```
这个 PR 不需要 AI 审查。

@codesentinel: ignore
```

---

## 1.2 增量审查（P0）

| # | 场景 | 验证点 | 操作步骤 | 预期结果 |
|---|------|--------|----------|----------|
| 1.2.1 | push 新 commit 后增量审查 | 仅审查新增变更 | 先 push commit A 触发审查 → 等完成 → 再 push commit B | commit B 的评论仅针对 B 的变更 |
| 1.2.2 | 摘要评论中记录已审查 commit | 含 commit ID 标签 | 检查摘要评论 HTML 隐藏标签 | 含 `<!-- commit_ids_reviewed -->` 区块，列出已审查 commit SHA |
| 1.2.3 | `full review` 命令全量审查 | 从 base 到 HEAD 全部审查 | 在已审查 PR 上发 `@codesentinel full review` | 评论覆盖从 PR 基准到最新的所有变更 |

### 验证代码 — 案例 1.2.1

**Commit A:**

```typescript
// utils/math.ts
export function add(a: number, b: number): number {
  return a + b
}

export function multiply(a: number, b: number): number {
  return a * b
}
```

**Commit B（在 Bot 审查完 A 后 push）:**

```typescript
// utils/math.ts — 追加
export function divide(a: number, b: number): number {
  return a / b  // 问题：未检查除零
}

export function power(base: number, exp: number): number {
  // 问题：负指数处理不当
  let result = 1
  for (let i = 0; i < exp; i++) {
    result *= base
  }
  return result
}
```

**验证方式:**
- Bot 第二次评论应只涉及 `divide` 和 `power`
- 不应重复提及 `add`/`multiply`
- 摘要评论中 commit IDs 区块应包含 commit A 和 commit B 的 SHA

---

## 1.3 跨文件依赖分析（P1）

| # | 场景 | 验证点 | 操作步骤 | 预期结果 |
|---|------|--------|----------|----------|
| 1.3.1 | 修改导出函数 | 审查评论提及引用方 | 修改被多处 import 的函数签名 | 评论或摘要中出现引用方文件名 |
| 1.3.2 | TypeScript import 解析 | 识别 named import | 修改 TS 导出符号 | 摘要列出引用方文件 |
| 1.3.3 | Vue/Nuxt composable | 识别 `useXxx` 引用 | 修改 composable 的返回类型 | 引用方组件被纳入分析 |
| 1.3.4 | `enable_dependency_analysis: false` | 无跨文件信息 | workflow 中关闭开关，重新触发 | 摘要中无依赖分析段落 |
| 1.3.5 | `max_dependency_files` 限制 | 不超过配置上限 | 设置 `max_dependency_files: 2`，修改被 5 个文件引用的函数 | 最多分析 2 个引用方 |

### 验证代码 — 案例 1.3.1 ~ 1.3.3

**基线文件（PR 基准分支中已存在）：**

```typescript
// utils/formatPrice.ts — 核心工具函数（被多处引用）
export function formatPrice(amount: number, currency: string = "CNY"): string {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency }).format(amount)
}
```

```typescript
// composables/useCart.ts — Composable（引用 formatPrice）
import { ref, computed } from 'vue'
import { formatPrice } from '~/utils/formatPrice'

export function useCart() {
  const items = ref<{ name: string; price: number }[]>([])
  const total = computed(() => items.value.reduce((s, i) => s + i.price, 0))
  const formatted = computed(() => formatPrice(total.value))
  return { items, total, formatted }
}
```

```vue
<!-- components/PriceDisplay.vue — 引用 formatPrice -->
<script setup lang="ts">
import { formatPrice } from '~/utils/formatPrice'
const props = defineProps<{ amount: number }>()
const display = computed(() => formatPrice(props.amount))
</script>
<template><span>{{ display }}</span></template>
```

```vue
<!-- pages/checkout.vue — 引用 useCart -->
<script setup lang="ts">
import { useCart } from '~/composables/useCart'
const { total, formatted } = useCart()
</script>
<template><div>Total: {{ formatted }}</div></template>
```

**PR 中的变更（修改函数签名）：**

```typescript
// utils/formatPrice.ts — 改签名 + 改默认值
export function formatPrice(
  amount: number,
  currency: string = "USD",       // 改默认值: CNY → USD
  locale: string = "en-US"        // 新增参数
): string {
  if (amount < 0) return "N/A"    // 新增: 负数处理
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount)
}
```

```typescript
// composables/useCart.ts — 修改返回类型
import { ref, computed } from 'vue'
import { formatPrice } from '~/utils/formatPrice'

export function useCart() {
  const items = ref<{ name: string; price: number }[]>([])
  const total = computed((): { amount: number; formatted: string } => ({
    amount: items.value.reduce((s, i) => s + i.price, 0),
    formatted: formatPrice(items.value.reduce((s, i) => s + i.price, 0))
  }))
  return { items, total }  // 移除 formatted 单独导出
}
```

**预期 Bot 行为：**
- `formatPrice.ts` 的审查评论中应提及 `PriceDisplay.vue`、`useCart.ts` 作为引用方
- `useCart.ts` 的审查评论中应提及 `checkout.vue` 的 `total` 使用方式可能受影响
- 摘要中应有跨文件影响的段落

---

## 1.4 文件过滤与限制（P1）

| # | 场景 | 验证点 | 操作步骤 | 预期结果 |
|---|------|--------|----------|----------|
| 1.4.1 | 二进制文件排除 | 不审查 .png / .zip | PR 中包含图片 + TS 变更 | 只有 TS 文件被审查 |
| 1.4.2 | 自定义 path_filters | 仅审查匹配路径 | 当前配置已排除 `.css`，提交 `.css` 文件 | `.css` 文件不出现在审查中 |
| 1.4.3 | `max_files` 限制 | 超出时显示跳过统计 | 设置 `max_files: 3`，PR 含 6 个 TS 文件 | 摘要中只审查 3 个文件，记录跳过 |
| 1.4.4 | lock 文件排除 | `.lock` 不审查 | PR 包含 `pnpm-lock.yaml` 变更 | lock 文件不出现在审查中 |

### 验证代码 — 案例 1.4.1

```bash
# 同时提交二进制 + 代码
cp some-image.png assets/logo.png
echo 'export const VERSION = "1.0.0"' > utils/version.ts
git add assets/logo.png utils/version.ts
git commit -m "feat: add logo and version"
```

### 验证代码 — 案例 1.4.3

```bash
# 创建 6 个 TS 文件
for i in $(seq 1 6); do
  cat > "utils/module${i}.ts" << EOF
export function fn${i}(x: number): number {
  // 问题：未处理边界
  return 100 / x
}
EOF
done
git add utils/module*.ts
git commit -m "feat: add 6 modules (test max_files limit)"
```

---

## 1.5 双模型与 Token 管理（P2）

| # | 场景 | 验证点 | 操作步骤 | 预期结果 |
|---|------|--------|----------|----------|
| 1.5.1 | diff 超出 lightBot token | 摘要阶段跳过该文件 | 提交 2000+ 行文件变更 | Actions 日志有 "skip" / "too large" 记录 |
| 1.5.2 | patch 超出 heavyBot token | 仅审查前 N 个 patch | 超大函数变更（4000+ 行） | 审查部分 hunks，日志记录跳过 |
| 1.5.3 | 并发控制 | 不超过 `openai_concurrency_limit` | PR 含 10+ 文件，观察 Actions 日志 | 同一时刻 API 调用数 ≤ 配置 |

### 验证代码 — 案例 1.5.1

```bash
# 生成超大文件
python3 -c "
for i in range(2500):
    print(f'export function fn{i}(x: number): number {{ return x * {i} }}')
" > utils/giant-module.ts
git add utils/giant-module.ts
git commit -m "feat: giant module (token limit test)"
```

---

## 综合端到端脚本

以下脚本覆盖 1.1 + 1.2 + 1.3 的核心验证：

```bash
#!/usr/bin/env bash
# test_cases/tester-1/run-full-test.sh
#
# 用法:
#   cd /Users/anton/Developer/CodesSentinels/ai-reviewer-test
#   bash test_cases/tester-1/run-full-test.sh
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BRANCH="test/dev1-core-review"

cd "$REPO_ROOT"
echo "工作目录: $(pwd)"

# ====== Phase 1: 基础审查 + 跨文件依赖 ======
echo "==> 创建分支 ${BRANCH}"
git checkout test/dev4 && git pull origin test/dev4
git checkout -b "$BRANCH" 2>/dev/null || git checkout "$BRANCH"

# 基线文件
mkdir -p utils composables components pages

cat > utils/formatPrice.ts << 'EOF'
export function formatPrice(amount: number, currency: string = "CNY"): string {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency }).format(amount)
}
EOF

cat > composables/useCart.ts << 'EOF'
import { ref, computed } from 'vue'
import { formatPrice } from '~/utils/formatPrice'

export function useCart() {
  const items = ref<{ name: string; price: number }[]>([])
  const total = computed(() => items.value.reduce((s, i) => s + i.price, 0))
  const formatted = computed(() => formatPrice(total.value))
  return { items, total, formatted }
}
EOF

cat > components/PriceDisplay.vue << 'EOF'
<script setup lang="ts">
import { formatPrice } from '~/utils/formatPrice'
const props = defineProps<{ amount: number }>()
const display = computed(() => formatPrice(props.amount))
</script>
<template><span>{{ display }}</span></template>
EOF

cat > pages/checkout.vue << 'EOF'
<script setup lang="ts">
import { useCart } from '~/composables/useCart'
const { total, formatted } = useCart()
</script>
<template><div>Total: {{ formatted }}</div></template>
EOF

git add -A
git commit -m "chore: baseline files for cross-file test" || true

# 修改核心函数 + 新增有问题的文件
cat > utils/formatPrice.ts << 'EOF'
export function formatPrice(
  amount: number,
  currency: string = "USD",
  locale: string = "en-US"
): string {
  if (amount < 0) return "N/A"
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount)
}
EOF

cat > composables/useCart.ts << 'EOF'
import { ref, computed } from 'vue'
import { formatPrice } from '~/utils/formatPrice'

export function useCart() {
  const items = ref<{ name: string; price: number }[]>([])
  const total = computed((): { amount: number; formatted: string } => ({
    amount: items.value.reduce((s, i) => s + i.price, 0),
    formatted: formatPrice(items.value.reduce((s, i) => s + i.price, 0))
  }))
  return { items, total }
}
EOF

cat > utils/userInput.ts << 'EOF'
export function sanitize(input: string): string {
  return input.replace(/<script>/g, '')
}

export function buildQuery(table: string, id: string): string {
  return `SELECT * FROM ${table} WHERE id = '${id}'`
}

export async function fetchUser(id: string) {
  const resp = fetch(`/api/users/${id}`)
  return resp
}
EOF

git add -A
git commit -m "feat: update formatPrice + useCart signature, add userInput

Breaking changes:
- formatPrice: 新增 locale 参数，默认货币 CNY → USD
- useCart: total 返回类型从 number 变为 object

新增 utils/userInput.ts（含已知安全问题供审查验证）"

# 推送 + 创建 PR
git push -u origin "$BRANCH"

PR_URL=$(gh pr create \
  --title "[TEST] 测试人1: 核心审查流程 + 跨文件依赖验证" \
  --base test/dev4 \
  --body "$(cat << 'BODY'
## 目的

验证 ai-reviewer 核心审查流程：
- 自动触发审查（1.1.1）
- 摘要格式（1.1.2）
- 行级评论定位（1.1.3）
- 发布说明（1.1.4）
- 跨文件依赖分析（1.3.1 ~ 1.3.3）

## 代码改动

1. `utils/formatPrice.ts` — 改签名（新增 locale 参数，默认值 CNY→USD）
2. `composables/useCart.ts` — 返回类型变更（number → object）
3. `utils/userInput.ts` — 新增（含 SQL 注入 + XSS + 未 await）
4. `components/PriceDisplay.vue` / `pages/checkout.vue` — 引用方（未修改，用于跨文件分析）

## 预期 Bot 行为

1. 摘要评论含 Walkthrough + 文件变更表格
2. 行级评论指出 SQL 注入、XSS、未 await 问题
3. 跨文件分析提及 PriceDisplay.vue / checkout.vue / useCart.ts
4. PR 描述末尾出现 release notes
BODY
)")

echo ""
echo "============================================="
echo "  PR 已创建: ${PR_URL}"
echo "============================================="
echo ""
echo "下一步:"
echo "  1. 等待自动审查完成（约 1~3 分钟）"
echo "  2. 验证 1.1.1 ~ 1.1.4 + 1.3.1 ~ 1.3.3"
echo "  3. 审查完成后执行 Phase 2（增量审查）:"
echo "     bash test_cases/tester-1/run-incremental.sh"
```

```bash
#!/usr/bin/env bash
# test_cases/tester-1/run-incremental.sh
#
# Phase 2: 增量审查验证（在 Bot 完成首次审查后执行）
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BRANCH="test/dev1-core-review"

cd "$REPO_ROOT"
git checkout "$BRANCH"

# 新增文件（仅此部分应被增量审查）
cat > utils/validator.ts << 'EOF'
export function isEmail(email: string): boolean {
  return email.includes('@')
}

export function isPositive(n: number): boolean {
  return n > 0
}

export function parseAge(input: string): number {
  return parseInt(input)
}
EOF

git add utils/validator.ts
git commit -m "feat: add validator utils (incremental review test)"
git push

echo ""
echo "==> 增量 commit 已 push"
echo ""
echo "验证点："
echo "  ✓ Bot 只审查 validator.ts（新文件）"
echo "  ✓ 不重复评论 formatPrice / userInput"
echo "  ✓ 摘要评论更新 commit_ids_reviewed 区块"
echo ""
echo "完成后可执行 full review 验证："
echo "  在 PR 评论区输入: @codesentinel full review"
```

---

## 测试结果记录模板

```markdown
## 测试人 1 — 核心审查流程 测试结果

**测试日期**: 2026-06-__
**测试分支**: test/dev1-core-review
**PR 编号**: #__

### 1.1 基础 PR 审查流程（P0）

| # | 场景 | 结果 | 备注 |
|---|------|------|------|
| 1.1.1 | 新建 PR 触发自动审查 | ✅/❌/⚠️ | |
| 1.1.2 | PR 摘要评论格式 | ✅/❌/⚠️ | |
| 1.1.3 | 行级评论定位准确 | ✅/❌/⚠️ | |
| 1.1.4 | 发布说明写入 PR 描述 | ✅/❌/⚠️ | |
| 1.1.5 | disable_review 跳过审查 | ✅/❌/⚠️ | |
| 1.1.6 | @codesentinel: ignore 跳过 | ✅/❌/⚠️ | |

### 1.2 增量审查（P0）

| # | 场景 | 结果 | 备注 |
|---|------|------|------|
| 1.2.1 | push 新 commit 增量审查 | ✅/❌/⚠️ | |
| 1.2.2 | 摘要记录已审查 commit | ✅/❌/⚠️ | |
| 1.2.3 | full review 全量审查 | ✅/❌/⚠️ | |

### 1.3 跨文件依赖分析（P1）

| # | 场景 | 结果 | 备注 |
|---|------|------|------|
| 1.3.1 | 修改导出函数，提及引用方 | ✅/❌/⚠️ | |
| 1.3.2 | TS import 解析 | ✅/❌/⚠️ | |
| 1.3.3 | Vue composable 引用 | ✅/❌/⚠️ | |
| 1.3.4 | 关闭依赖分析 | ✅/❌/⚠️ | |
| 1.3.5 | max_dependency_files 限制 | ✅/❌/⚠️ | |

### 1.4 文件过滤与限制（P1）

| # | 场景 | 结果 | 备注 |
|---|------|------|------|
| 1.4.1 | 二进制文件排除 | ✅/❌/⚠️ | |
| 1.4.2 | path_filters 过滤 | ✅/❌/⚠️ | |
| 1.4.3 | max_files 限制 | ✅/❌/⚠️ | |
| 1.4.4 | lock 文件排除 | ✅/❌/⚠️ | |

### 1.5 双模型与 Token 管理（P2）

| # | 场景 | 结果 | 备注 |
|---|------|------|------|
| 1.5.1 | 超出 lightBot token | ✅/❌/⚠️ | |
| 1.5.2 | 超出 heavyBot token | ✅/❌/⚠️ | |
| 1.5.3 | 并发控制 | ✅/❌/⚠️ | |
```

---

## 关键提示

1. **分支命名**: feature 分支从 `test/devN` 拉出，PR target 回 `test/devN`，全程不影响 main
2. **AI Reviewer 分支解析**: PR 时取 `base_ref`（即 `test/dev4`），会 checkout ai-reviewer 仓库的 `test/dev4` 分支代码
3. **等待时间**: 首次审查 1~3 分钟，增量审查 ~1 分钟
4. **观察日志**: GitHub Actions → 对应 run → `review` job → step logs 查看跳过文件 / token 超限详情
5. **1.4 / 1.5 需临时改 workflow**: 测试完后记得恢复配置
