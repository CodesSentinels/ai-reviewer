/**
 * platform/run-context.ts — 当前运行的执行上下文（ARCH-005 context 迁移）
 *
 * 解决的问题：`review.ts` / `commenter.ts` / `commands/dispatcher.ts` 长期直接
 * `import {context} from '@actions/github'`，且在**模块级**求值 `context.repo`。
 * 而 `context.repo` 在没有 `GITHUB_REPOSITORY` 时会抛：
 *
 *   context.repo requires a GITHUB_REPOSITORY environment variable like 'owner/repo'
 *
 * 于是 GitLab 入口只要 import 到共享核心，**模块加载阶段就崩**，run() 根本
 * 执行不到。这是 gitlab-trigger.ts 迟迟接不上审查核心的真正原因。
 *
 * 沿用代码库既有的注入模式（setPlatform / setLogger / setStateNamespace）：
 * 入口在启动时 setExecCtx 一次，共享核心通过 getExecCtx() 读归一化坐标，
 * 不再触碰任何平台 SDK。
 *
 * 为什么用模块级单例而不是逐层传参：仓库坐标在一次运行内是恒定的，属于典型的
 * 环境量；而 Commenter 在十几处被构造，把它塞进构造函数会牵动大量无关调用点。
 * 这与 setPlatform/setLogger 的取舍一致。
 */

import type {ExecutionContext} from './execution-context'

let current: ExecutionContext | null = null

/** 入口在启动时调用一次（main.ts / gitlab-trigger.ts） */
export function setExecCtx(ctx: ExecutionContext): void {
  current = ctx
}

/**
 * 读取当前执行上下文。
 *
 * 未设置时抛错而不是返回 null——共享核心的每一处调用都依赖它拿事件坐标，
 * 静默返回空值只会把「没初始化」变成后面某处莫名其妙的 undefined。
 */
export function getExecCtx(): ExecutionContext {
  if (current == null) {
    throw new Error(
      'run context is not initialized — the entry point must call setExecCtx() ' +
        'before invoking the shared review core'
    )
  }
  return current
}

/** 是否已初始化（供过渡期的兼容分支判断，不用于业务决策） */
export function hasExecCtx(): boolean {
  return current != null
}

/** 仅供测试重置，避免用例之间互相污染 */
export function resetExecCtx(): void {
  current = null
}

/**
 * 把 projectPath 拆成平台 API 需要的 (owner, repo) 二元组。
 *
 * 两个平台的 adapter 都按 `${owner}/${repo}` 还原完整路径，因此**从最后一个
 * 斜杠**切分才是通用解：
 *
 *   GitHub  "octo/demo"                  → owner="octo",            repo="demo"
 *   GitLab  "group/subgroup/project"     → owner="group/subgroup",  repo="project"
 *
 * 按第一个斜杠切会把 GitLab 的 subgroup 项目切错（见 gitlab-platform.ts 的
 * projectPath 拼接注释）。
 */
export function repoCoordsOf(ctx: ExecutionContext): {owner: string; repo: string} {
  const projectPath = ctx.projectPath
  const idx = projectPath.lastIndexOf('/')
  if (idx <= 0 || idx === projectPath.length - 1) {
    throw new Error(`invalid projectPath: "${projectPath}" (expected "owner/repo")`)
  }
  return {owner: projectPath.slice(0, idx), repo: projectPath.slice(idx + 1)}
}

/**
 * 同上，但从模块级上下文取。
 *
 * 手里已经有 execCtx 的调用方（dispatcher、review）应当直接用 repoCoordsOf(ctx)——
 * 显式传参优于隐式单例；本函数只服务于拿不到 execCtx 的位置（如 Commenter，
 * 它在十几处被构造，签名里没有 execCtx）。
 */
export function getRepoCoords(): {owner: string; repo: string} {
  return repoCoordsOf(getExecCtx())
}
