/**
 * private-gitlab-publish.ts - 私有云产物仓库的发布 CLI 入口
 *
 * 由 scripts/publish-private-gitlab.mjs 在内网机器上调用（该脚本负责构建、
 * 去注释、组装和冒烟测试，再把组装目录交给本入口）。产物仓库不主动访问任何
 * 外部源，也不保存能写自己的 token：内容只由这里推送。
 *
 * 流程：
 * 1. 校验组装目录（自己的 SHA256SUMS、必备文件、VERSION.json）
 * 2. 读取目标分支当前 HEAD，下载该 commit 的归档
 * 3. 用归档里的 SHA256SUMS 检测手动改动；有改动时默认拒绝，
 *    PUBLISH_ALLOW_OVERWRITE=true 才覆盖
 * 4. 计算差异；发布前再确认 HEAD 没有移动
 * 5. 用 Commits API 一次性提交（不走 git push）
 *
 * 环境变量（由发布脚本传入）：
 *   PRIVATE_GITLAB_URL / PRIVATE_GITLAB_PROJECT / PRIVATE_GITLAB_BRANCH / PRIVATE_GITLAB_TOKEN
 *   PUBLISH_SOURCE_DIR       组装目录
 *   PUBLISH_DRY_RUN          true = 只读，打印计划
 *   PUBLISH_ALLOW_OVERWRITE  true = 覆盖产物仓库里的手动改动
 */
import {execFileSync} from 'child_process'
import {mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'fs'
import {tmpdir} from 'os'
import {join} from 'path'
import {
  REQUIRED_DIST_FILES,
  SUMS_FILE,
  checkAgainstManifest,
  hashFiles,
  isClean,
  listFsFiles,
  parseDistVersion,
  planSync
} from './dist-sync/manifest'
import type {SyncAction} from './dist-sync/manifest'
import {GitLabLogger} from './platform/gitlab-logger'
import {createGitLabClient, validateGitLabHost} from './platform/gitlab-client'
import type {GitLabApi} from './platform/gitlab-client'

const API_TIMEOUT_MS = 300_000

// GitLabLogger 在输出边界做脱敏（SEC-008），与审查 bundle 同一套日志约定
const logger = new GitLabLogger()
const log = (msg: string): void => logger.info(msg)
const fail = (msg: string): void => logger.error(msg)

class PublishError extends Error {}

function requireEnv(name: string): string {
  const v = (process.env[name] ?? '').trim()
  if (v === '') throw new PublishError(`${name} is required`)
  return v
}

function envFlag(name: string): boolean {
  return (process.env[name] ?? '').trim().toLowerCase() === 'true'
}

interface PublishConfig {
  host: string
  project: string
  branch: string
  token: string
  sourceDir: string
  dryRun: boolean
  allowOverwrite: boolean
}

function loadConfig(): PublishConfig {
  return {
    host: validateGitLabHost(requireEnv('PRIVATE_GITLAB_URL')),
    project: requireEnv('PRIVATE_GITLAB_PROJECT'),
    branch: requireEnv('PRIVATE_GITLAB_BRANCH'),
    token: requireEnv('PRIVATE_GITLAB_TOKEN'),
    sourceDir: requireEnv('PUBLISH_SOURCE_DIR'),
    dryRun: envFlag('PUBLISH_DRY_RUN'),
    allowOverwrite: envFlag('PUBLISH_ALLOW_OVERWRITE')
  }
}

type CommitActions = NonNullable<Parameters<GitLabApi['Commits']['create']>[3]>

function buildCommitActions(actions: SyncAction[], sourceDir: string): CommitActions {
  return actions.map(a =>
    a.action === 'delete'
      ? {action: 'delete', filePath: a.path}
      : {
          action: a.action,
          filePath: a.path,
          encoding: 'base64',
          content: readFileSync(join(sourceDir, a.path)).toString('base64')
        }
  )
}

function describeActions(actions: SyncAction[]): string {
  return actions.map(a => `  ${a.action.padEnd(6)} ${a.path}`).join('\n')
}

/** 下载目标分支指定 commit 的归档并解开，返回仓库根目录 */
async function downloadTree(
  api: GitLabApi,
  cfg: PublishConfig,
  sha: string,
  workDir: string
): Promise<string> {
  const archive = Buffer.from(
    await (await api.Repositories.showArchive(cfg.project, {fileType: 'tar', sha})).arrayBuffer()
  )
  const extractDir = join(workDir, 'current')
  mkdirSync(extractDir)

  // 空树（例如只有初始空提交的新仓库）GitLab 返回 0 字节归档。空归档不能直接
  // 当成「仓库为空」——网络截断也会得到空响应——用文件树 API 再确认一次。
  if (archive.length === 0) {
    const tree = await api.Repositories.allRepositoryTrees(cfg.project, {
      ref: sha,
      perPage: 1,
      maxPages: 1
    })
    if (tree.length > 0) throw new PublishError(`empty archive for non-empty ${cfg.branch}@${sha}`)
    return extractDir
  }

  const tarPath = join(workDir, 'current.tar')
  writeFileSync(tarPath, archive)
  execFileSync('tar', ['-xf', tarPath, '-C', extractDir])
  // GitLab 归档固定带一层 `<project>-<sha>-<sha>/` 顶层目录
  const [top, ...rest] = readdirSync(extractDir)
  if (top == null || rest.length > 0) {
    throw new PublishError('unexpected archive layout from GitLab')
  }
  return join(extractDir, top)
}

async function headOf(api: GitLabApi, cfg: PublishConfig): Promise<string> {
  const branch = await api.Branches.show(cfg.project, cfg.branch)
  const id = branch.commit?.id
  if (typeof id !== 'string' || id === '')
    throw new PublishError(`cannot resolve ${cfg.branch} HEAD`)
  return id
}

async function run(): Promise<void> {
  const cfg = loadConfig()

  // 1. 校验组装目录
  const incomingFiles = listFsFiles(cfg.sourceDir)
  if (!isClean(checkAgainstManifest(cfg.sourceDir, incomingFiles))) {
    throw new PublishError(`${cfg.sourceDir} does not match its own ${SUMS_FILE}`)
  }
  const missingRequired = REQUIRED_DIST_FILES.filter(f => !incomingFiles.includes(f))
  if (missingRequired.length > 0) {
    throw new PublishError(`assembled tree is missing: ${missingRequired.join(', ')}`)
  }
  const version = parseDistVersion(readFileSync(join(cfg.sourceDir, 'VERSION.json'), 'utf8'))
  log(`publishing ${version.tag} (revision ${version.revision}) → ${cfg.project}@${cfg.branch}`)

  const api = createGitLabClient({
    host: cfg.host,
    credential: {type: 'pat', value: cfg.token},
    timeoutMS: API_TIMEOUT_MS
  })

  const workDir = mkdtempSync(join(tmpdir(), 'ai-reviewer-publish-'))
  try {
    // 2. 当前内容
    const head = await headOf(api, cfg)
    const currentDir = await downloadTree(api, cfg, head, workDir)
    const currentFiles = listFsFiles(currentDir)

    // 3. 手动改动检测
    const check = checkAgainstManifest(currentDir, currentFiles)
    const drift = check.bootstrap
      ? []
      : [
          ...check.modified.map(f => `modified ${f}`),
          ...check.missing.map(f => `missing  ${f}`),
          ...check.extra.map(f => `extra    ${f}`)
        ]
    if (check.bootstrap) log(`first publish: ${cfg.branch} has no ${SUMS_FILE} yet`)
    if (drift.length > 0) {
      const listed = drift.map(d => `  ${d}`).join('\n')
      if (!cfg.allowOverwrite) {
        throw new PublishError(
          `${cfg.branch} has manual changes (refusing to overwrite; set --allow-overwrite after review):\n${listed}`
        )
      }
      log(`overwriting manual changes:\n${listed}`)
    }

    // 4. 差异
    const actions = planSync(
      hashFiles(currentDir, currentFiles),
      hashFiles(cfg.sourceDir, incomingFiles)
    )
    if (actions.length === 0) {
      log(`up to date: ${cfg.branch}@${head} already matches ${version.tag}`)
      return
    }
    log(`planned changes (${actions.length}):\n${describeActions(actions)}`)

    if (cfg.dryRun) {
      log('dry run: not committing')
      return
    }

    // 下载与比对期间分支被移动过，则差异不可信
    const headNow = await headOf(api, cfg)
    if (headNow !== head) {
      throw new PublishError(`${cfg.branch} moved during publish (${head} → ${headNow}); rerun`)
    }

    // 5. 一次性提交
    const message = [
      `release: ai-reviewer ${version.tag}`,
      '',
      `revision: ${version.revision}`,
      drift.length > 0 ? `overwrote manual changes:\n${drift.join('\n')}` : ''
    ]
      .join('\n')
      .trim()
    const commit = await api.Commits.create(
      cfg.project,
      cfg.branch,
      message,
      buildCommitActions(actions, cfg.sourceDir)
    )
    log(`committed ${commit.id} to ${cfg.branch}: ${version.tag}`)
  } finally {
    rmSync(workDir, {recursive: true, force: true})
  }
}

// 不用顶层 await（同 main.ts / gitlab-trigger.ts 的既有原因）
void (async (): Promise<void> => {
  try {
    await run()
  } catch (e) {
    if (e instanceof PublishError) fail(e.message)
    else
      fail(
        `Unhandled error in private-gitlab-publish: ${e instanceof Error ? e.message : String(e)}`
      )
    process.exitCode = 1
  }
})()
