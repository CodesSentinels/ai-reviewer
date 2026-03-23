# Nuxt/Vue 跨文件依赖分析

## 功能概述

AI Reviewer 支持对 Nuxt/Vue 项目进行跨文件依赖分析。当 PR 中包含 `.vue` 文件或 Nuxt 约定目录下的文件变更时，自动检测跨文件引用关系，无需额外配置。

## 支持的依赖模式

### 1. Vue SFC 显式导入

检测 `.vue` 文件 `<script>` / `<script setup>` 块中的 import 语句：

```vue
<script setup lang="ts">
import BaseButton from '~/components/ui/BaseButton.vue'
import { useAuth } from '@/composables/auth'
</script>
```

### 2. Nuxt Auto-Import

Nuxt 会自动导入以下目录的导出，消费者无需 import：

| 目录 | 说明 |
|------|------|
| `composables/` | Composable 函数 |
| `utils/` | 工具函数 |
| `components/` | Vue 组件 |
| `stores/` | Pinia store |

```vue
<script setup>
// 无需 import，Nuxt 自动导入 composables/useAuth.ts
const { isLoggedIn } = useAuth()
</script>
```

### 3. Nuxt Extends (多层架构)

支持 monorepo 内的本地 layer：

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  extends: ['./base-layer']
})
```

base-layer 的 `composables/`、`components/`、`utils/` 会被自动合并，修改 base-layer 导出时能检测到主项目中的引用。

### 4. Vue 编译器宏

检测 `<script setup>` 中的编译器宏变更：

- `defineProps` — 组件 props 接口
- `defineEmits` — 组件事件接口
- `defineExpose` — 模板 ref 暴露的绑定

## 路径别名支持

| 别名 | 解析目录 |
|------|---------|
| `@/` | `src/`, `app/`, `lib/`, 根目录 |
| `~/` | `src/`, `app/`, `lib/`, 根目录 |
| `#/` | `src/`, `app/`, `lib/`, 根目录 |
| `#components/` | `components/` |

### 5. 动态导入 / 异步组件

检测 `import()` 动态导入语法（路径为静态字符串字面量时）：

```ts
// defineAsyncComponent
const AsyncComp = defineAsyncComponent(() => import('./MyComponent.vue'))

// 路由懒加载
const routes = [{ component: () => import('./pages/Home.vue') }]
```

### 6. 动态组件

`<component :is="...">` 中使用导入的组件引用时，依赖关系通过 `<script>` 中的 import 语句建立，已被支持：

```vue
<script setup>
import MyComponent from './MyComponent.vue'  <!-- 此 import 被解析 -->
</script>
<template>
  <component :is="MyComponent" />
</template>
```

## 限制

- **运行时动态组件**：`<component :is="variable">` 中 `variable` 为运行时计算值时无法静态分析
- **动态路径 import**：`import(variable)` 路径非字符串字面量时无法解析
- **外部 npm layer**：`extends` 指向 npm 包时，layer 文件不在仓库内，无法分析
- **Nuxt modules 注入的 composables**：非文件系统来源，无法追踪
