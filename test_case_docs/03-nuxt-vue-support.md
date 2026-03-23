# Nuxt/Vue 技术栈依赖分析支持

## 问题定义

AI Reviewer 的跨文件依赖分析（`enable_dependency_analysis`）原先仅支持 TS/JS、Python、Go、Java 四种语言。`.vue` 单文件组件（SFC）未被纳入分析范围，导致：

1. **Vue SFC 导入不可见**：`.vue` 文件中 `<script>` 块内的 import 语句无法被解析
2. **Nuxt auto-import 盲区**：Nuxt 约定 `composables/`、`utils/` 等目录下的导出可被自动导入，消费者无需显式 import，现有基于 import 语句的分析无法捕获
3. **Nuxt extends 层不可追踪**：Nuxt 支持 `extends` 多层架构（monorepo layers），base-layer 的导出被主项目使用的关系无法被检测

## 方案设计

### 1. Vue SFC 解析策略

**核心思路**：将 `.vue` 文件归类为 `typescript` 语言，在解析前先提取 `<script>` 块内容。

- 新增 `extractVueScriptContent(content)` 函数，用正则提取所有 `<script>` 块
- `parseImports()` 对 `.vue` 文件先提取 script 再走 `parseTsImports` 流程
- `extractModifiedSymbols()` 对 `.vue` diff 追踪 `<script>` 块边界，忽略 template/style 变更
- `findReferencesInContent()` 对 `.vue` 文件提取 script 块再搜索，避免 template 误匹配

**Vue 编译器宏支持**：

| 宏 | 提取逻辑 |
|---|---------|
| `defineProps<{...}>()` | 提取为 `props` 变量（或赋值变量名） |
| `defineEmits<{...}>()` | 提取为 `emits` 变量（或赋值变量名） |
| `defineExpose({ foo, bar })` | 提取对象字面量中的键名为导出变量 |

### 2. Nuxt Auto-Import 约定检测

新增**步骤 5.1**（位于步骤 5 和 5.5 之间）：

- 判断被修改文件是否在 Nuxt auto-import 源目录下（`composables/`、`utils/`、`components/`、`stores/`）
- 对 auto-import 源文件，扫描所有已获取的 `.vue`/`.ts`/`.js` 文件
- 用 `findReferencesInContent` 检查符号使用，发现则加入依赖图
- 零额外 GitHub API 调用（复用已获取的文件内容）

### 3. Nuxt Extends 支持

**支持范围**：monorepo 内的本地 layer（如 `extends: ['./base-layer']`）

- `isNuxtAutoImportSource()` 使用正则 `/\/(composables|utils|components|stores)\//`，天然匹配 `base-layer/composables/` 等路径
- 主项目对 base-layer 的显式 import（如 `import { logInfo } from '~/base-layer/utils/logger'`）由现有步骤 2-5 处理

**不支持**：npm 包形式的外部 layer（文件不在仓库文件树中）

### 4. 入口文件识别更新

`isEntryPointFile()` 增加 Nuxt 约定入口：
- 文件名：`nuxt.config.ts`、`nuxt.config.js`、`app.vue`
- 目录：`/pages/`、`/layouts/`、`/server/api/`、`/server/routes/`

## 测试场景矩阵

| # | 场景 | 修改文件 | 预期检测到的依赖文件 |
|---|------|---------|-------------------|
| 1 | Composable 显式导入 | `composables/useAuth.ts` | `components/CartSummary.vue` |
| 2 | Composable auto-import | `composables/useCart.ts` | `pages/cart.vue`, `components/CartSummary.vue` |
| 3 | 工具函数引用 | `utils/formatPrice.ts` | `components/ProductCard.vue`, `pages/products/[id].vue` |
| 4 | 组件导入 | `components/ui/BaseButton.vue` | `components/ProductCard.vue`, `components/CartSummary.vue` |
| 5 | Pinia store | `stores/userStore.ts` | `composables/useAuth.ts` |
| 6 | extends 层 composable | `base-layer/composables/useTheme.ts` | `layouts/default.vue`, `components/ProductCard.vue` |
| 7 | extends 层组件 | `base-layer/components/AppHeader.vue` | `layouts/default.vue` |
| 8 | extends 层工具 | `base-layer/utils/logger.ts` | `composables/useAuth.ts`, `stores/userStore.ts` |

## 修改的文件

| 文件 | 修改内容 |
|------|---------|
| `src/repo-tree.ts` | 添加 `.vue` 扩展名、路径解析、`#components/` 别名 |
| `src/dependency-analyzer.ts` | Vue SFC 解析、auto-import 检测、Vue 宏支持、入口文件更新 |
| `__tests__/dependency-analyzer.test.ts` | 新增 Vue/Nuxt 相关测试用例 |

## 已知限制

### 1. 运行时动态组件

通过 import 引用的组件传入 `<component :is>` **已支持**，因为依赖通过 import 建立。
仅以下运行时计算方式无法静态分析：

```vue
<!-- ✅ 可检测 — 依赖通过 import 建立 -->
<script setup>
import MyComp from './MyComp.vue'         // ← import 被解析
const comp = computed(() => MyComp)
</script>
<template>
  <component :is="comp" />
</template>

<!-- ❌ 无法检测 — 无 import，组件名为运行时字符串 -->
<script setup>
const props = defineProps<{ name: string }>()
const comp = computed(() => resolveComponent(props.name))
</script>
<template>
  <component :is="comp" />
</template>
```

### 2. 动态路径 import

静态字符串路径的 `import()` **已支持**（含 `defineAsyncComponent`、路由懒加载等）。
仅模板字符串/变量路径无法解析：

```ts
// ✅ 可检测 — 静态字符串字面量
defineAsyncComponent(() => import('./Heavy.vue'))
const route = { component: () => import('./About.vue') }

// ❌ 无法检测 — 模板字符串，路径包含变量
defineAsyncComponent(() => import(`./components/${name}.vue`))

// ❌ 无法检测 — 变量路径
const path = getComponentPath()
defineAsyncComponent(() => import(path))
```

### 3. Nuxt modules 注入的 composables

Nuxt modules（如 `@nuxtjs/i18n`）在构建时注入的 composable（如 `useI18n()`）不对应仓库内的文件，无法追踪：

```ts
// ❌ 无法检测 — useI18n 由 @nuxtjs/i18n 模块在构建时注入，非文件系统来源
const { t } = useI18n()
```

### 4. npm 包形式的 extends layer

`extends` 指向 npm 包时，layer 文件不在仓库文件树中：

```ts
// ✅ 可检测 — 本地 layer，文件在仓库内
export default defineNuxtConfig({ extends: ['./base-layer'] })

// ❌ 无法检测 — npm 包 layer，文件不在仓库内
export default defineNuxtConfig({ extends: ['@my-org/base-layer'] })
```

### 5. `<script>` 内的 `</script>` 字符串字面量

极少见。当 `<script>` 块内包含 `</script>` 字符串时，正则提取会被截断：

```vue
<script setup>
// ❌ 会导致提取截断
const html = '<script>alert(1)</script>'
</script>
```
