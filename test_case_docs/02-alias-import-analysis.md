# 别名引用分析与修复方案

> 分析日期：2026-03-12
> 关联功能：`enable_dependency_analysis`（跨文件依赖分析）

---

## 1. 问题定义

依赖分析存在两类别名处理缺陷，导致引用关系被遗漏：

| 维度 | 问题 | 影响程度 |
|------|------|----------|
| **符号别名** | `import { foo as bar }` 时搜索 `foo` 找不到 `bar` 的使用 | 引用计数不准 |
| **路径别名** | `@/utils/helper` 在 `resolveImportPath` 中返回 `null` | 整条依赖链断裂 |

---

## 2. 符号别名问题

### 2.1 问题场景

#### ES6 Named Import Alias

```typescript
// utils.ts — 被修改的文件
export function calculateTotal(items) { ... }

// payment.ts — 依赖方
import { calculateTotal as calcTotal } from '../utils'
const result = calcTotal(items)  // ✗ 搜索 "calculateTotal" 找不到 "calcTotal"
```

**分析流程**：
1. `parseImports` 提取 `importedSymbols: ['calculateTotal']` — 正确提取了原始名
2. 依赖图记录 payment.ts 导入了 `calculateTotal`
3. `findReferencesInContent` 搜索 `\bcalculateTotal\b` — 找不到实际使用的 `calcTotal`
4. 引用计数 = 0，依赖关系被遗漏

#### CommonJS Destructure Alias

```typescript
const { processOrder: handleOrder } = require('./orders')
handleOrder(order)  // ✗ 搜索 "processOrder" 找不到 "handleOrder"
```

#### Re-export Alias

```typescript
// utils/index.ts
export { calculateTotal as calc } from './pricing'

// checkout/payment.ts
import { calc } from '../utils'
calc(items)  // ✗ 搜索 "calculateTotal" 找不到 "calc"
```

#### Python Alias

```python
from utils import calculate_total as calc
calc(items)  # ✗ 搜索 "calculate_total" 找不到 "calc"
```

### 2.2 修复方案

**核心思路**：在 `ImportInfo` 中增加 `aliasMap` 字段，记录 `原始名 → 本地别名` 的映射，搜索引用时同时匹配两者。

#### 2.2.1 扩展 ImportInfo 接口

```typescript
// src/dependency-analyzer.ts
export interface ImportInfo {
  importPath: string
  importedSymbols: string[]              // 原始名（保持不变，用于匹配导出符号）
  aliasMap: Record<string, string>       // originalName → localAlias（无别名时为空对象）
  isDefault: boolean
  isNamespace: boolean
}
```

#### 2.2.2 修改解析器保留别名

**TS/JS Named Import**：
```typescript
// import { foo as bar, baz } from './module'
// → importedSymbols: ['foo', 'baz'], aliasMap: { foo: 'bar' }
const parts = s.trim().split(/\s+as\s+/)
const original = parts[0].trim()
if (parts.length > 1) {
  aliasMap[original] = parts[1].trim()
}
```

**CommonJS Destructure**：
```typescript
// const { foo: bar } = require('./module')
// → importedSymbols: ['foo'], aliasMap: { foo: 'bar' }
const parts = s.trim().split(/\s*:\s*/)
```

**Re-export**：
```typescript
// export { foo as bar } from './module'
// → importedSymbols: ['foo'], aliasMap: { foo: 'bar' }
```

**Python**：
```python
# from module import foo as bar
# → importedSymbols: ['foo'], aliasMap: { foo: 'bar' }
```

#### 2.2.3 依赖图存储别名

```typescript
const dependencyGraph = new Map<string, Array<{
  file: string
  symbols: string[]
  aliasMap: Record<string, string>  // 新增
}>>()
```

合并时同步合并 aliasMap：
```typescript
Object.assign(existing.aliasMap, imp.aliasMap)
```

#### 2.2.4 引用搜索扩展

```typescript
// 步骤 6：除原始符号名外，还搜索其在该文件中的别名
const searchSymbols = [...baseSymbols]
for (const sym of baseSymbols) {
  const alias = dep.aliasMap[sym]
  if (alias && !searchSymbols.includes(alias)) {
    searchSymbols.push(alias)
  }
}
```

### 2.3 测试用例

| 测试场景 | 输入 | 期望结果 |
|---------|------|---------|
| ES6 别名 | `import { foo as bar }` | `importedSymbols: ['foo']`, `aliasMap: {foo: 'bar'}` |
| 无别名 | `import { foo, bar }` | `aliasMap: {}` |
| Require 别名 | `const { foo: myFoo } = require(...)` | `aliasMap: {foo: 'myFoo'}` |
| Re-export 别名 | `export { Options as Opts }` | `aliasMap: {Options: 'Opts'}` |
| Python 别名 | `from utils import calc as c` | `aliasMap: {calc: 'c'}` |
| 端到端 | `import { calcTotal as ct }` → 代码中使用 `ct()` | `findReferencesInContent` 能找到 `ct()` 的引用 |

---

## 3. 路径别名问题

### 3.1 问题场景

现代前端框架普遍使用路径别名简化导入：

| 框架 | 别名模式 | 示例 |
|------|---------|------|
| Nuxt / Vue | `@/`, `~/`, `#imports` | `import { useAuth } from '@/composables/auth'` |
| Next.js | `@/`（tsconfig paths） | `import { Button } from '@/components/Button'` |
| Vite | 自定义 alias | `import utils from '~/utils'` |
| tsconfig | `paths` 配置 | `import { api } from '@lib/api'` |

**根本原因**：`resolveImportPath` 只处理以 `.` 开头的相对路径，非 `.` 开头的路径直接返回 `null`：

```typescript
// 修复前
if (!importPath.startsWith('.')) {
  return null  // ← @/utils/helper 直接被丢弃
}
```

### 3.2 修复方案

**策略：通用前缀匹配（轻量实用）**

不读取 tsconfig.json 等配置文件，而是对常见别名前缀尝试映射到常见源码目录，再用 `repoFilesSet` 验证路径是否存在。

#### 3.2.1 别名规则定义

```typescript
// src/repo-tree.ts
const PATH_ALIAS_RULES = [
  {prefix: '@/', candidates: ['src/', 'app/', 'lib/', '']},
  {prefix: '~/', candidates: ['src/', 'app/', 'lib/', '']},
  {prefix: '#/', candidates: ['src/', 'app/', 'lib/', '']}
]
```

#### 3.2.2 解析流程

```typescript
export function resolveImportPath(
  importingFile: string,
  importPath: string,
  repoFilesSet: Set<string>
): string | null {
  // 1. 相对路径 → 原有逻辑
  if (importPath.startsWith('.')) {
    return resolveRelativePath(importingFile, importPath, repoFilesSet)
  }

  // 2. 路径别名 → 尝试常见映射
  for (const rule of PATH_ALIAS_RULES) {
    if (importPath.startsWith(rule.prefix)) {
      const stripped = importPath.substring(rule.prefix.length)
      for (const dir of rule.candidates) {
        const resolved = tryResolveWithExtensions(dir + stripped, repoFilesSet)
        if (resolved != null) return resolved
      }
    }
  }

  // 3. npm 包 → null
  return null
}
```

#### 3.2.3 提取公共函数

将扩展名补全逻辑提取为 `tryResolveWithExtensions`，供相对路径和路径别名共用：

```typescript
function tryResolveWithExtensions(
  basePath: string,
  repoFilesSet: Set<string>
): string | null {
  if (repoFilesSet.has(basePath)) return basePath
  for (const ext of ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']) {
    if (repoFilesSet.has(basePath + ext)) return basePath + ext
  }
  for (const idx of ['/index.ts', '/index.tsx', '/index.js', '/index.jsx']) {
    if (repoFilesSet.has(basePath + idx)) return basePath + idx
  }
  return null
}
```

### 3.3 测试用例

| 测试场景 | 输入 | 期望结果 |
|---------|------|---------|
| `@/` → `src/` | `@/utils/helper` | `src/utils/helper.ts` |
| `@/` → `app/` | `@/components/Button` | `app/components/Button.tsx` |
| `~/` 别名 | `~/utils/helper` | `src/utils/helper.ts` |
| `#/` 别名 | `#/utils/helper` | `src/utils/helper.ts` |
| 别名解析失败 | `@/nonexistent` | `null` |
| 别名 + index | `@/utils` | `src/utils/index.ts` |
| npm 包 | `lodash` | `null`（不变） |

---

## 4. 覆盖范围总结

### 修复后的支持矩阵

| 场景 | 修复前 | 修复后 |
|------|--------|--------|
| 直接导入 `import { foo }` | ✓ | ✓ |
| ES6 别名 `import { foo as bar }` | ✗ | ✓ |
| CommonJS 别名 `const { foo: bar } = require(...)` | ✗ | ✓ |
| Re-export 别名 `export { foo as bar }` | ✗ | ✓ |
| Python 别名 `from x import foo as bar` | ✗ | ✓ |
| Namespace 成员 `import * as utils` → `utils.foo()` | ✓ 部分 | ✓ 部分 |
| `@/` 路径别名 | ✗ | ✓ |
| `~/` 路径别名 | ✗ | ✓ |
| `#/` 路径别名 | ✗ | ✓ |
| npm 包路径 | ✗（by design） | ✗（by design） |

### 仍未覆盖的场景

| 场景 | 原因 | 优先级 |
|------|------|--------|
| Barrel file 间接引用 | 需要多跳追踪，见 [竞品分析文档](cross-file-dependency-competitor-analysis.md) | P1 |
| Namespace 解构别名 `const { foo: bar } = utils` | 需要数据流分析 | P2 |
| 自定义 tsconfig paths（非 @/~/# 前缀） | 需要读取 tsconfig.json | P2 |
| 动态导入 `import()` | 运行时才确定路径 | P3 |

---

## 5. 涉及文件

| 文件 | 修改内容 |
|------|---------|
| `src/dependency-analyzer.ts` | `ImportInfo` 增加 `aliasMap`；解析器保留别名；依赖图存储别名；引用搜索扩展 |
| `src/repo-tree.ts` | `resolveImportPath` 支持 `@/~/# ` 路径别名；提取 `tryResolveWithExtensions` |
| `__tests__/dependency-analyzer.test.ts` | 新增 12 个测试用例覆盖符号别名和路径别名 |
