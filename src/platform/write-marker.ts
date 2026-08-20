/**
 * platform/write-marker.ts — 写操作幂等 marker（GLAPI-027 / STATE-015）
 *
 * 超时/网络中断时无法区分「请求没到平台」和「平台已写入但响应丢了」。
 * 直接重试后者会产生重复 note/discussion/comment。做法：
 *
 * 1. 写入前给正文追加一个隐藏 marker（HTML 注释，两平台的 Markdown 都不渲染）；
 * 2. 重试前先按 marker 查询已有内容，命中说明上一次其实成功了，直接复用；
 * 3. 返回给共享核心前把 marker 去掉，核心看到的正文与平台无关。
 *
 * 原先只有 GitLab 版（`gitlab-write-marker.ts`）。STATE-015 要求三类重试共用同一
 * 幂等规则，而 GitHub 侧当时只有 `@octokit/plugin-retry` 的**传输层**重试——它会
 * 在网络错误时重发 POST，服务端已成功的话就多出一条评论，且无法事后察觉。
 * 所以把这套 marker 泛化成双平台共用，而不是给 GitHub 再写一份平行实现。
 *
 * 两条不变式：
 *
 * - **marker 唯一标识「一次逻辑写入」，不是「一段正文」**：每次写入由
 *   `newWriteOperationId()` 生成随机 operationId，只在该次调用的重试之间复用。
 *   否则同一 PR/MR 里再次合法发布相同正文时（如两次 pause 回复），重试探测会命中
 *   历史评论并误判为「本次已成功」，导致新评论丢失。
 * - **marker 文本只含受限字符**：projectPath、文件路径、正文等外部内容只以
 *   sha1 摘要形式参与，绝不原样进入 HTML 注释。Git 文件名允许 `>` 甚至 `-->`，
 *   直接拼接会提前闭合注释并让剥离正则失效，把内部标记暴露给用户。
 *
 * marker 带平台命名空间（A4），两平台不混用；也带 PR/MR 编号，便于人工排查。
 */

import {createHash, randomUUID} from 'crypto'
import type {Platform} from './execution-context'

const MARKER_ROOT = 'ai-reviewer'

/** 本平台写 marker 的前缀 */
function markerPrefix(platform: Platform): string {
  return `${MARKER_ROOT}:${platform}:write`
}

/**
 * 匹配本模块生成的 marker（用于剥离）。
 * 各字段字符集受限且由本模块生成，外部内容无法构造出能破坏该格式的 marker。
 */
const MARKER_PATTERN = new RegExp(
  `\\n*<!-- ${MARKER_ROOT}:(?:github|gitlab):write:\\d+:[a-z][a-z0-9-]*:[0-9a-f]{16} -->`,
  'g'
)

export interface WriteMarkerInput {
  /** 写入所在平台，决定 marker 命名空间（A4：两平台 marker 不混用） */
  platform: Platform
  projectPath: string
  changeRequestId: number
  /** 写操作种类，如 'note' / 'discussion' / 'reply'；非法字符会被规范化掉 */
  op: string
  /** 本次逻辑写入的唯一 ID（`newWriteOperationId()`），只在同一调用的重试间复用 */
  operationId: string
  body: string
  /** 区分同类写入的细节（如 `path:line`、discussionId），只参与摘要不进 marker 文本 */
  opDetail?: string
}

/** 为一次逻辑写入生成唯一 ID */
export function newWriteOperationId(): string {
  return randomUUID()
}

/** 把操作种类规范化为受限 slug，保证 marker 文本格式不可被外部内容破坏 */
function normalizeOpKind(op: string): string {
  const slug = op
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return /^[a-z]/.test(slug) ? slug : `op-${slug}`
}

/** 生成幂等 marker */
export function buildWriteMarker(input: WriteMarkerInput): string {
  const kind = normalizeOpKind(input.op)
  // \0 作分隔符：合法的项目路径/文件名/正文都不含它，杜绝字段拼接歧义
  const digest = createHash('sha1')
    .update(
      [
        input.platform,
        input.projectPath,
        String(input.changeRequestId),
        kind,
        input.opDetail ?? '',
        input.operationId,
        input.body
      ].join('\u0000'),
      'utf8'
    )
    .digest('hex')
    .slice(0, 16)
  return `<!-- ${markerPrefix(input.platform)}:${input.changeRequestId}:${kind}:${digest} -->`
}

/** 追加 marker；已包含时保持原样（重试路径可安全重复调用） */
export function appendWriteMarker(body: string, marker: string): string {
  if (body.includes(marker)) return body
  return `${body}\n\n${marker}`
}

/** 判断一段正文是否带指定 marker */
export function hasWriteMarker(body: string | null | undefined, marker: string): boolean {
  if (body == null) return false
  return body.includes(marker)
}

/**
 * 剥离所有本模块的 marker，返回给共享核心的正文不含平台实现细节。
 * 只删 marker 本身与其前置空行，不触碰用户内容里的其他 HTML 注释。
 */
export function stripWriteMarkers(body: string | null | undefined): string {
  if (body == null) return ''
  return body.replace(MARKER_PATTERN, '')
}
