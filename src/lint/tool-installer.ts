/**
 * lint/tool-installer.ts - 多策略工具安装 dispatcher
 *
 * ai-reviewer 自管 lint 工具，**待审查项目不需要 npm install**。
 *
 * 实现策略：
 *   - npm   ：调用 `npm install` 装到 /tmp/ai-reviewer-lint-tools/node_modules
 *             （Phase 1 落地：eslint / @biomejs/biome / prettier）
 *   - binary：从 URL 下载预编译归档（Phase 2+，留作扩展接口）
 *
 * 幂等性：
 *   - 同一 runner job 内重复调用直接命中缓存（检查 binPath 是否存在）
 *   - 不同 job / 不同 runner 各自首次安装（约 +15s 冷启动）
 *
 * 错误处理：
 *   - npm 不存在 / 网络失败 / 包不存在 → 返回 { ok: false, reason }
 *   - 安装成功但 bin 路径未生成 → 同上（防御策略性差异）
 */

import {info, warning} from '@actions/core'
import {existsSync, mkdirSync, writeFileSync} from 'fs'
import {tmpdir} from 'os'
import * as path from 'path'
import {type InstallSpec, type NpmInstallSpec} from './types'
import {runCommand} from './adapters/exec'

/**
 * 沙箱安装根目录 — 跨 Adapter 共享同一份 node_modules
 *
 * 用 getter 而非顶层常量，让测试可以 mock `os.tmpdir()`。
 */
function getInstallRoot(): string {
  return path.join(tmpdir(), 'ai-reviewer-lint-tools')
}

/** 单次 npm install 的超时（5 分钟，足够覆盖慢镜像） */
const INSTALL_TIMEOUT_MS = 5 * 60_000

export interface InstallResult {
  ok: boolean
  /** 成功时返回工具二进制的绝对路径；调用方用它代替 npx */
  binPath?: string
  /** 失败原因，写入 ToolSummary.unavailableReason */
  reason?: string
}

/**
 * 主入口：按 spec.kind 分发到具体策略实现
 *
 * @param spec 适配器声明的安装方式（来自 ToolAdapter.installSpec）
 */
export async function ensureToolInstalled(
  spec: InstallSpec
): Promise<InstallResult> {
  switch (spec.kind) {
    case 'npm':
      return await installViaNpm(spec)
    case 'binary':
      // Phase 2+ 落地：参考 golangci-lint / ruff / semgrep 的发布形态
      return {
        ok: false,
        reason:
          'binary install strategy not yet implemented (planned for Phase 2+); ' +
          'add downloader in tool-installer.ts when needed'
      }
  }
}

/**
 * npm 策略：在沙箱目录跑 `npm install --no-save <pkg>@<version>`
 *
 * 用 `--legacy-peer-deps` 兜底 ERESOLVE，因为我们的沙箱里只关心
 * 这一个工具，不在乎全局 peer 兼容性。
 */
async function installViaNpm(spec: NpmInstallSpec): Promise<InstallResult> {
  const root = getInstallRoot()
  const binPath = path.join(root, 'node_modules', '.bin', spec.binName)

  // 1) 缓存命中：同一 runner job 内 ai-reviewer 多次调用、或多个 adapter
  //    碰巧依赖同一工具时直接返回
  if (existsSync(binPath)) {
    info(`lint/installer: cache hit for ${spec.binName} → ${binPath}`)
    return {ok: true, binPath}
  }

  // 2) 沙箱目录初始化（首次调用）
  try {
    if (!existsSync(root)) {
      mkdirSync(root, {recursive: true})
    }
    const sandboxPkgJson = path.join(root, 'package.json')
    if (!existsSync(sandboxPkgJson)) {
      writeFileSync(
        sandboxPkgJson,
        JSON.stringify(
          {
            name: 'ai-reviewer-lint-tools',
            private: true,
            version: '0.0.0',
            description:
              'ai-reviewer 内部 lint 工具沙箱（自动管理，请勿手动修改）'
          },
          null,
          2
        ) + '\n'
      )
    }
  } catch (e) {
    return {
      ok: false,
      reason: `failed to initialize sandbox dir ${root}: ${
        e instanceof Error ? e.message : String(e)
      }`
    }
  }

  // 3) 跑 npm install
  // version 缺省时不带 `@<range>`，npm 安装 latest。真实 Action 运行里 version 总会
  // 由 action.yml 的 *_version default 注入；缺省仅出现在未经 Action 的直接调用。
  const installTarget = spec.version
    ? `${spec.package}@${spec.version}`
    : spec.package
  info(`lint/installer: installing ${installTarget} → ${root}`)
  const result = await runCommand({
    command: 'npm',
    args: [
      'install',
      '--no-save',
      '--legacy-peer-deps',
      '--no-audit',
      '--no-fund',
      '--silent',
      installTarget
    ],
    cwd: root,
    timeoutMs: INSTALL_TIMEOUT_MS
  })

  // 4) 错误诊断：把 exit / stderr 首行带回去，便于用户在 PR 摘要里看到原因
  if (result.spawnError) {
    return {
      ok: false,
      reason: `npm not found on runner: ${result.spawnErrorMessage ?? ''}`
    }
  }
  if (result.exitCode !== 0) {
    const stderrSnippet =
      result.stderr
        .split('\n')
        .find(l => l.trim().length > 0)
        ?.substring(0, 200) ?? ''
    return {
      ok: false,
      reason: `npm install ${installTarget} failed (exit=${result.exitCode}): ${stderrSnippet}`
    }
  }
  if (!existsSync(binPath)) {
    warning(
      `lint/installer: ${installTarget} installed but bin not at ${binPath}`
    )
    return {
      ok: false,
      reason: `package installed but bin not at ${binPath} (unexpected layout)`
    }
  }

  info(`lint/installer: ${spec.binName} ready at ${binPath}`)
  return {ok: true, binPath}
}

/** 仅供测试使用：返回当前沙箱根目录路径 */
export function _getInstallRootForTest(): string {
  return getInstallRoot()
}
