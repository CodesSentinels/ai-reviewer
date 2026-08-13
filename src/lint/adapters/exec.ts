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

import {info, warning} from '../../actions-log'
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
export async function runCommand(options: RunCommandOptions): Promise<RunCommandResult> {
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
export function parseJsonSafe<T = unknown>(raw: string, context: string): T | null {
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
