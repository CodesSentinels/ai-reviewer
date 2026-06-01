/**
 * lint/adapters/exec.ts - 工具适配器共享的命令执行辅助函数
 *
 * 所有适配器都通过 `execFile` 调用本地 CLI。封装了：
 * - 超时控制（避免单个工具卡死整个审查）
 * - stdout / stderr / exitCode 捕获
 * - 大输出截断（避免内存爆炸）
 *
 * 注意：使用 execFile（不是 exec）避免 shell 注入风险。
 */

import {info, warning} from '@actions/core'
import {execFile} from 'child_process'

/** 单个命令执行的最大输出（字节）— 防止 10 万级问题文件撑爆内存 */
const MAX_BUFFER_BYTES = 64 * 1024 * 1024 // 64 MB

/** 单个工具默认超时（毫秒） */
export const DEFAULT_TOOL_TIMEOUT_MS = 60_000

export interface RunCommandOptions {
  /** 命令名（如 'eslint'） */
  command: string
  /** 命令参数列表 */
  args: string[]
  /** 工作目录（通常是仓库根） */
  cwd?: string
  /** 超时（毫秒） */
  timeoutMs?: number
  /** 注入的环境变量（合并到 process.env） */
  env?: Record<string, string>
}

export interface RunCommandResult {
  /** 退出码（被信号杀死时为 null） */
  exitCode: number | null
  /** 是否因超时被杀死 */
  timedOut: boolean
  /** 标准输出（UTF-8） */
  stdout: string
  /** 标准错误（UTF-8） */
  stderr: string
  /** 是否出现执行错误（如命令不存在） */
  spawnError: boolean
  /** 执行错误信息 */
  spawnErrorMessage?: string
}

/**
 * 执行子进程命令，捕获 stdout/stderr/exitCode，不抛出异常。
 *
 * Lint 工具按惯例：发现问题时 exitCode != 0，但这不是"失败"；
 * 调用方需根据 stdout 是否能解析出 JSON 来判断真实成功与否。
 */
export async function runCommand(
  options: RunCommandOptions
): Promise<RunCommandResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS

  return await new Promise(resolve => {
    let timedOut = false
    const child = execFile(
      options.command,
      options.args,
      {
        cwd: options.cwd,
        timeout: timeoutMs,
        maxBuffer: MAX_BUFFER_BYTES,
        env: {...process.env, ...(options.env ?? {})},
        windowsHide: true
      },
      (error, stdout, stderr) => {
        if (error != null) {
          // ETIMEDOUT 或 SIGTERM/SIGKILL → 超时
          const errAny = error as NodeJS.ErrnoException & {killed?: boolean}
          if (errAny.code === 'ETIMEDOUT' || errAny.killed === true) {
            timedOut = true
          }
          // ENOENT → 命令不存在
          if (errAny.code === 'ENOENT') {
            resolve({
              exitCode: null,
              timedOut: false,
              stdout: '',
              stderr: '',
              spawnError: true,
              spawnErrorMessage: `command not found: ${options.command}`
            })
            return
          }
        }
        resolve({
          exitCode: child.exitCode,
          timedOut,
          stdout: stdout ?? '',
          stderr: stderr ?? '',
          spawnError: false
        })
      }
    )
  })
}

/**
 * 安全地解析 JSON；失败时记录警告并返回 null
 */
export function parseJsonSafe<T = unknown>(
  raw: string,
  context: string
): T | null {
  if (raw.trim().length === 0) return null
  try {
    return JSON.parse(raw) as T
  } catch (e) {
    warning(
      `lint: failed to parse JSON output from ${context}: ${
        e instanceof Error ? e.message : String(e)
      }`
    )
    info(`lint: raw output (first 500 chars): ${raw.substring(0, 500)}`)
    return null
  }
}

/**
 * 提取 `<tool> --version` 的版本号
 *
 * 兼容多种输出格式：
 * - "v1.2.3" → "1.2.3"
 * - "Tool 1.2.3" → "1.2.3"
 * - "1.2.3" → "1.2.3"
 */
export function extractVersion(rawVersion: string): string {
  const m = rawVersion.match(/v?(\d+\.\d+\.\d+)/)
  return m?.[1] ?? rawVersion.trim().split('\n')[0]
}

/**
 * 构造适配器 detect 失败时的诊断 reason
 *
 * 把 exitCode、cwd、node_modules 是否存在、工具 bin 是否存在、stderr 首行
 * 都带出来，让用户在 PR 摘要表里就能直接判断："是 npm install 没装上"
 * 还是"装了但 cwd 不对"。
 *
 * @param toolName     工具名称（用于探测 node_modules/.bin/<toolName>）
 * @param repoRoot     仓库根目录
 * @param npxResult    `npx --no-install <tool> --version` 的执行结果
 * @param fallbackResult 全局 `<tool> --version` 的执行结果（可选）
 */
export function buildVersionFailureReason(
  toolName: string,
  repoRoot: string,
  npxResult: RunCommandResult,
  fallbackResult?: RunCommandResult
): string {
  if (npxResult.spawnErrorMessage != null) return npxResult.spawnErrorMessage

  // 探测 node_modules 是否真的存在以及工具 bin 是否在其中
  // 用 require('fs') 而非 import 是因为本模块大量使用 child_process，
  // 加少量 fs 不构成额外耦合
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('fs') as typeof import('fs')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require('path') as typeof import('path')

  const hasNodeModules = fs.existsSync(path.join(repoRoot, 'node_modules'))
  const hasBin = fs.existsSync(
    path.join(repoRoot, 'node_modules', '.bin', toolName)
  )

  const stderrSnippet = ((npxResult.stderr || fallbackResult?.stderr) ?? '')
    .split('\n')
    .find(l => l.trim().length > 0)
    ?.substring(0, 120) ?? ''

  const parts = [
    `${toolName} --version failed`,
    `exit=${npxResult.exitCode ?? 'null'}`,
    `cwd=${repoRoot}`,
    `node_modules=${hasNodeModules ? 'yes' : 'NO'}`,
    `${toolName}-bin=${hasBin ? 'yes' : 'NO'}`
  ]
  if (stderrSnippet.length > 0) parts.push(`stderr="${stderrSnippet}"`)

  // node_modules 不存在 → 几乎一定是 workflow 漏了 `npm install`
  // 明确给出可操作建议，避免用户在 cryptic 错误里循环
  if (!hasNodeModules) {
    parts.push(
      'HINT: workflow appears to have not run `npm install` before this ' +
        'action (or checked out the wrong ref). Add `- run: npm install` ' +
        'before the ai-reviewer step. For pull_request_target events, also ' +
        "set `actions/checkout@v4` with `ref: \${{ github.event.pull_request.head.sha }}` " +
        "so the PR branch's devDependencies are installed."
    )
  } else if (!hasBin) {
    parts.push(
      `HINT: node_modules exists but ${toolName} is missing — ensure ` +
        `${toolName} is in package.json devDependencies on the checked-out ref, ` +
        `or add a workflow step to install it (\`npm install --no-save ${toolName}\`).`
    )
  }

  return parts.join('; ')
}
