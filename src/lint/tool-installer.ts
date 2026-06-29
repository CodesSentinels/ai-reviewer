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
import {
  type InstallSpec,
  type NpmInstallSpec,
  type PipInstallSpec
} from './types'
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
    case 'pip':
      return await installViaPip(spec)
    case 'binary':
      // Phase 2+ 落地：参考 golangci-lint 等纯静态二进制的发布形态
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

/**
 * 沙箱内 Python 工具的安装目录（与 npm 工具的 node_modules/ 同级）
 *
 * 选 `--target=<dir>` 而非 `--user` 是因为：
 *   - runner 上 `python3 -m pip install --user` 会装到 `~/.local/`，跨 job
 *     不可控，也不便于 actions/cache 单独缓存一个子目录
 *   - --target 让所有 Python 工具集中在沙箱里，与 npm 工具同款的缓存模型
 */
function getPipInstallDir(): string {
  return path.join(getInstallRoot(), 'python-tools')
}

/**
 * 把 npm 风格的 caret/tilde range（`^1.95.0` / `~1.95.0` / `1.95.0`）
 * 转成 pip 兼容的版本约束。pip 不认识 `^` —— 需要展开成 `>=,<` 形式。
 *
 *   ^1.95.0  →  >=1.95.0,<2          （锁主版本）
 *   ~1.95.0  →  >=1.95.0,<1.96       （锁次版本）
 *   1.95.0   →  ==1.95.0             （精确版本）
 *   >=1.95   →  >=1.95               （原样透传，已经是 pip 语法）
 *   *        →  ""                   （任意版本）
 */
export function npmRangeToPipSpecifier(range: string): string {
  const trimmed = range.trim()
  if (trimmed === '' || trimmed === '*' || trimmed === 'latest') return ''

  // 已经是 pip 语法（含 ==, >=, <=, >, <, ~=, !=）：原样返回
  if (/^(==|>=|<=|>|<|~=|!=)/.test(trimmed)) return trimmed

  const caretMatch = trimmed.match(/^\^(\d+)\.(\d+)\.(\d+)$/)
  if (caretMatch != null) {
    const [, major, minor, patch] = caretMatch
    return `>=${major}.${minor}.${patch},<${parseInt(major, 10) + 1}`
  }

  const tildeMatch = trimmed.match(/^~(\d+)\.(\d+)\.(\d+)$/)
  if (tildeMatch != null) {
    const [, major, minor, patch] = tildeMatch
    return `>=${major}.${minor}.${patch},<${major}.${parseInt(minor, 10) + 1}`
  }

  // 形如 `1.95.0` 这种"裸版本号"：pip 视为精确等于
  if (/^\d+\.\d+\.\d+$/.test(trimmed)) return `==${trimmed}`

  // 兜底：原样让 pip 自己尝试（如 `>=1.95,<2` 这类复合 range）
  return trimmed
}

/**
 * pip 策略：跑 `python3 -m pip install --target=<sandbox>/python-tools <pkg><range>`
 *
 * 设计选择：
 *   - 用 `python3 -m pip` 而非全局 `pip`，避免 Python 2/3 残留环境下歧义
 *   - 用 `--target` 把所有依赖装到沙箱目录，console script 落在 bin/
 *   - 不用 venv：venv 启动慢、跨 runner 缓存复杂；--target 同款隔离已足够
 *   - 不用 pipx：pipx 在 ubuntu-latest 默认装了，但跨 runner 行为不一；
 *     我们要的是"可预测、可缓存"，pip --target 是最稳的最小公倍数
 *
 * 失败诊断：
 *   - python3 不存在 → spawnError，returned reason 明确指引
 *   - pip install 失败 → exit 码 + stderr 首行
 *   - 装完但 bin 缺失 → 防御性 false（罕见，但比静默有效）
 */
async function installViaPip(spec: PipInstallSpec): Promise<InstallResult> {
  const startedAt = Date.now()
  const root = getInstallRoot()
  const targetDir = getPipInstallDir()
  const binPath = path.join(targetDir, 'bin', spec.binName)

  // 1) 缓存命中
  if (existsSync(binPath)) {
    info(`lint/installer[pip]: cache hit for ${spec.binName} → ${binPath}`)
    return {ok: true, binPath}
  }

  // 2) 沙箱目录初始化
  try {
    if (!existsSync(root)) mkdirSync(root, {recursive: true})
    if (!existsSync(targetDir)) mkdirSync(targetDir, {recursive: true})
  } catch (e) {
    return {
      ok: false,
      reason: `failed to initialize pip sandbox dir ${targetDir}: ${
        e instanceof Error ? e.message : String(e)
      }`
    }
  }

  // 3) 跑 pip install
  const pipSpecifier = npmRangeToPipSpecifier(spec.version)
  const pkgArg =
    pipSpecifier.length > 0 ? `${spec.package}${pipSpecifier}` : spec.package
  info(
    `lint/installer[pip]: installing ${spec.package} (range "${spec.version}" → pip "${pipSpecifier}") → ${targetDir}`
  )
  const result = await runCommand({
    command: 'python3',
    args: [
      '-m',
      'pip',
      'install',
      '--quiet',
      '--disable-pip-version-check',
      '--no-warn-script-location',
      `--target=${targetDir}`,
      pkgArg
    ],
    cwd: root,
    timeoutMs: INSTALL_TIMEOUT_MS,
    env: {
      // 让 Python 在 sys.path 中优先找沙箱目录，确保 console script 能 import 自己
      PYTHONPATH: targetDir,
      PYTHONDONTWRITEBYTECODE: '1'
    }
  })

  const elapsed = Date.now() - startedAt
  if (result.spawnError) {
    warning(
      `lint/installer[pip]: spawn failed after ${elapsed}ms — ${
        result.spawnErrorMessage ?? ''
      }`
    )
    return {
      ok: false,
      reason:
        result.spawnErrorMessage != null &&
        result.spawnErrorMessage.includes('python3')
          ? `python3 not found on runner: ${result.spawnErrorMessage}. ` +
            'ubuntu-latest GitHub-hosted runners ship Python 3 by default — ' +
            'if you are on a self-hosted runner, install Python 3.8+ first.'
          : `failed to invoke python3 -m pip: ${result.spawnErrorMessage ?? ''}`
    }
  }
  if (result.exitCode !== 0) {
    const stderrSnippet =
      result.stderr
        .split('\n')
        .find(l => l.trim().length > 0)
        ?.substring(0, 200) ?? ''
    warning(
      `lint/installer[pip]: pip exit=${result.exitCode} after ${elapsed}ms, stderr_first="${stderrSnippet}", stderr_len=${result.stderr.length}`
    )
    return {
      ok: false,
      reason: `pip install ${pkgArg} failed (exit=${result.exitCode}): ${stderrSnippet}`
    }
  }
  if (!existsSync(binPath)) {
    warning(
      `lint/installer[pip]: ${spec.package} installed (exit=0, ${elapsed}ms) but console script not at ${binPath}`
    )
    return {
      ok: false,
      reason:
        `package ${spec.package} installed but console script not at ${binPath} ` +
        `(unexpected pip --target layout; check that the package declares a console_scripts entry for "${spec.binName}")`
    }
  }

  info(
    `lint/installer[pip]: ${spec.binName} ready at ${binPath} after ${elapsed}ms ` +
      `(stdout_len=${result.stdout.length}, stderr_len=${result.stderr.length})`
  )
  return {ok: true, binPath}
}

/** 仅供测试使用：返回当前沙箱根目录路径 */
export function _getInstallRootForTest(): string {
  return getInstallRoot()
}

/** 仅供测试使用：返回 pip 工具的安装目标目录 */
export function _getPipInstallDirForTest(): string {
  return getPipInstallDir()
}
