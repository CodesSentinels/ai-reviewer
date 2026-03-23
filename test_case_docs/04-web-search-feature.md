# Web Search 功能分析与测试用例

## 功能概述

`enable_web_search` 允许 AI 模型在代码审查过程中搜索互联网，验证外部 API 用法、检查文档、检测已废弃的接口。

## 架构分析

### 配置入口

| 层级 | 文件 | 位置 | 说明 |
|------|------|------|------|
| Action 输入 | `action.yml:234-240` | `enable_web_search` | 默认 `true` |
| 全局选项 | `src/options.ts:41` | `Options.enableWebSearch` | 从 Action 输入读取 |
| Bot 选项 | `src/options.ts:204` | `OpenAIOptions.enableWebSearch` | 传给具体 Bot 实例 |

### 生效范围

| Bot 实例 | 模型 | Web Search | 使用阶段 |
|----------|------|-----------|---------|
| **lightBot** | gpt-4.1-nano | **禁用**（硬编码 `false`） | Phase 1: 文件摘要 |
| **heavyBot** | gpt-4.1-mini | **启用**（跟随配置） | Phase 2-4: 合并/汇总/审查 |

关键代码路径：`main.ts:63-88` — lightBot 始终 `false`，heavyBot 传入 `options.enableWebSearch`。

### API 调用实现

`src/bot.ts:114-118` — 条件性添加 `web_search` 工具：

```typescript
const tools: OpenAI.Responses.Tool[] = []
if (this.enableWebSearch) {
  tools.push({type: 'web_search'})
}
```

使用 OpenAI Responses API（非 Chat Completions API），`web_search` 作为内置工具，模型会在认为需要时自动调用。

### 触发条件

Web Search 不是每次 API 调用都会执行。模型根据 **prompt 指令 + 代码内容** 决定是否调用：

1. **Phase 4 代码审查**（`src/prompts.ts:176-179`）— 明确指示：
   > When reviewing code that uses external libraries, APIs, or frameworks, use web search to verify that the APIs exist, are not deprecated, and are called with correct parameters.

2. **用户评论回复**（`src/prompts.ts:326-328`）— 明确指示：
   > If the comment asks about API behavior, library usage, or best practices, use web search to find and reference current documentation.

3. **Phase 2-3 摘要/发布说明** — 工具可用但无明确指示，模型可能会在内容涉及外部 API 时自主调用。

### 日志

`src/bot.ts:156-166` — 每次 web search 执行会记录日志：
```
[web_search] executed, id: xxx, status: completed
```

## 测试场景矩阵

| # | 场景 | 修改文件 | 触发条件 | 预期 Web Search 行为 |
|---|------|---------|---------|-------------------|
| 1 | 外部库 API 调用 | `utils/api-client.ts` | 使用 axios 配置 | 验证 axios API 参数 |
| 2 | 浏览器 API 兼容性 | `utils/api-client.ts` | `AbortSignal.timeout()` | 验证浏览器兼容性 |
| 3 | Node.js crypto API | `utils/crypto-helper.ts` | 加密算法和参数 | 验证算法名、key/iv 长度 |
| 4 | 已废弃 API 检测 | `utils/crypto-helper.ts` | `createCipher`（已废弃） | 检测废弃状态，建议替代方案 |
| 5 | 第三方 SDK 查询 | `composables/useSupabase.ts` | Supabase 链式查询 | 验证查询方法是否存在 |
| 6 | SDK 版本迁移 | `composables/useSupabase.ts` | Auth/Realtime API | 验证 v2 API 是否正确 |
| 7 | 日期库 API | `utils/date-helper.ts` | day.js 格式化 token | 验证格式化语法和插件用法 |
| 8 | 支付 SDK + Webhook | `server/api/webhook.ts` | Stripe 签名验证 | 验证 constructEvent 参数 |

---

## 场景 1: 外部库 API 调用（axios）

### 测试点
- 修改 axios 请求配置，引入不存在或已废弃的选项
- AI 应通过 web search 验证 axios API 文档

### 涉及文件
| 文件 | 角色 |
|------|------|
| `utils/api-client.ts` | **被修改文件** — `fetchProducts` 函数 |

### 代码修改方式
为 axios 请求添加不存在的配置属性：

```diff
  const response = await axios.get("/api/products", {
    params: { category: categoryId },
    timeout: 5000,
+   retryCount: 3,
+   retryDelay: 1000,
  })
```

### 预期结果
- AI Review 评论指出 `retryCount` 和 `retryDelay` 不是 axios 原生配置项
- 评论包含 axios 文档链接
- GitHub Actions 日志出现 `[web_search] executed` 记录

---

## 场景 2: 浏览器 API 兼容性（AbortSignal.timeout）

### 测试点
- 使用较新的 Web API，AI 应搜索兼容性信息
- 验证 `AbortSignal.timeout()` 在目标运行环境的支持情况

### 涉及文件
| 文件 | 角色 |
|------|------|
| `utils/api-client.ts` | **被修改文件** — `fetchWithTimeout` 函数 |

### 代码修改方式
修改 timeout 实现，使用新的 API：

```diff
  export async function fetchWithTimeout(url: string, timeoutMs = 5000) {
+   // 使用 AbortSignal.any() 合并多个信号 — 新 API，需验证兼容性
    const response = await fetch(url, {
-     signal: AbortSignal.timeout(timeoutMs),
+     signal: AbortSignal.any([
+       AbortSignal.timeout(timeoutMs),
+       new AbortController().signal,
+     ]),
    })
```

### 预期结果
- AI Review 指出 `AbortSignal.any()` 的浏览器/Node.js 兼容性
- 包含 MDN 文档链接

---

## 场景 3: Node.js crypto API 验证

### 测试点
- 修改加密算法名称或参数长度
- AI 应通过 web search 验证算法参数是否匹配

### 涉及文件
| 文件 | 角色 |
|------|------|
| `utils/crypto-helper.ts` | **被修改文件** — `encryptData` 函数 |

### 代码修改方式
将 AES-256-CBC 改为 AES-128-CBC 但不修改 key 长度（制造 bug）：

```diff
  const key = scryptSync(password, salt, 32) // 256-bit key
  const iv = randomBytes(16)
- const cipher = createCipheriv("aes-256-cbc", key, iv)
+ const cipher = createCipheriv("aes-128-cbc", key, iv)
```

### 预期结果
- AI Review 指出 AES-128 需要 16 字节 key，但代码生成了 32 字节
- 评论包含 Node.js crypto 文档链接

---

## 场景 4: 已废弃 API 检测

### 测试点
- 代码使用已被标记为 deprecated 的 Node.js API
- AI 应检测废弃状态并建议替代方案

### 涉及文件
| 文件 | 角色 |
|------|------|
| `utils/crypto-helper.ts` | **被修改文件** — `legacyEncrypt` 函数 |

### 代码修改方式
新增使用 `crypto.createCipher`（已废弃）的代码，或修改现有函数使其更明显：

```diff
+ // 新增使用废弃 API 的函数
+ export function quickHash(data: string): string {
+   const { createCipher } = require("crypto")
+   const cipher = createCipher("aes-256-cbc", "weak-password")
+   return cipher.update(data, "utf8", "hex") + cipher.final("hex")
+ }
```

### 预期结果
- AI Review 指出 `createCipher` 在 Node.js 10+ 已废弃
- 建议使用 `createCipheriv` 代替
- 包含 Node.js 文档链接

---

## 场景 5: 第三方 SDK 查询方法验证（Supabase）

### 测试点
- 使用不存在的 Supabase 查询方法
- AI 应搜索 Supabase 文档验证 API

### 涉及文件
| 文件 | 角色 |
|------|------|
| `composables/useSupabase.ts` | **被修改文件** — `getProducts` 函数 |

### 代码修改方式
引入不存在的查询方法：

```diff
  if (category) {
-   query = query.eq("category", category)
+   query = query.eq("category", category).contains("tags", ["featured"])
  }
```

### 预期结果
- AI Review 验证 `.contains()` 是否是正确的 Supabase 方法名
- 可能指出应使用 `.containedBy()` 或 `.cs()`
- 包含 Supabase 文档链接

---

## 场景 6: SDK 版本迁移验证（Supabase Auth v1 → v2）

### 测试点
- 将 v2 的 `signInWithPassword` 回退为 v1 的 `signIn`
- AI 应检测版本不匹配

### 涉及文件
| 文件 | 角色 |
|------|------|
| `composables/useSupabase.ts` | **被修改文件** — `loginUser` 函数 |

### 代码修改方式

```diff
  export async function loginUser(email: string, password: string) {
-   const { data, error } = await supabase.auth.signInWithPassword({
+   const { data, error } = await supabase.auth.signIn({
      email,
      password,
    })
```

### 预期结果
- AI Review 指出 `signIn` 在 Supabase v2 中已移除
- 建议使用 `signInWithPassword`
- 包含 Supabase Auth 迁移文档链接

---

## 场景 7: 日期库 API 验证（day.js）

### 测试点
- 使用错误的 day.js 格式化 token
- AI 应搜索 day.js 文档验证

### 涉及文件
| 文件 | 角色 |
|------|------|
| `utils/date-helper.ts` | **被修改文件** — `formatDate` 函数 |

### 代码修改方式
使用错误的格式化 token（`mm` 是分钟不是月份）：

```diff
  export function formatDate(
    date: string | Date,
-   format = "YYYY-MM-DD HH:mm:ss"
+   format = "YYYY-mm-DD HH:MM:ss"
  ): string {
```

### 预期结果
- AI Review 指出 `mm` 是分钟、`MM` 是月份（day.js 语法）
- 当前修改导致月份和分钟位置互换
- 包含 day.js 格式化文档链接

---

## 场景 8: 支付 SDK Webhook 验证（Stripe）

### 测试点
- 修改 Stripe webhook 签名验证逻辑
- AI 应验证安全关键的 API 用法

### 涉及文件
| 文件 | 角色 |
|------|------|
| `server/api/webhook.ts` | **被修改文件** — webhook 处理函数 |

### 代码修改方式
使用错误的 API 版本格式或跳过签名验证：

```diff
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "sk_test_xxx", {
-   apiVersion: "2024-12-18.acacia",
+   apiVersion: "2024-12-18",
  })
```

### 预期结果
- AI Review 验证 Stripe API 版本字符串格式
- 可能指出需要后缀（如 `.acacia`）或建议使用最新版本
- 包含 Stripe API 版本文档链接

---

## 验证方式

### 确认 Web Search 触发
1. 在 GitHub Actions 日志中搜索 `[web_search] executed`
2. 确认日志中有 `status: completed`

### 确认 Web Search 未触发（对照组）
1. 设置 `enable_web_search: false`
2. 重新触发同一 PR 的 review
3. 确认日志中无 `[web_search]` 记录
4. 对比两次 review 评论的质量差异（无 web search 时不应包含文档链接）

### 确认 Light Bot 不使用 Web Search
1. 无论 `enable_web_search` 为何值
2. Phase 1 的文件摘要日志中不应有 `[web_search]` 记录

---

## 已知限制

1. **模型自主决策**：即使工具可用，模型可能不会每次都调用 web search，取决于代码复杂度和模型判断
2. **仅 Heavy Bot**：Phase 1 文件摘要使用 Light Bot，不触发 web search
3. **无法控制搜索内容**：搜索查询由模型自动生成，无法指定搜索特定文档站点
4. **搜索结果时效性**：依赖搜索引擎索引，极新的 API 可能尚未被收录
5. **计费影响**：每次 web search 调用会增加 API 使用量和延迟
