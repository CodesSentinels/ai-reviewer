/**
 * diff-files.ts — 增量审查：从两份 compare 结果里选出本次要审查的文件
 *
 * GitHub 的 compare 接口最多返回 300 个文件。PR 总共改了 300 个以上时，
 * `base...head` 的文件列表是被截断的；这时如果还拿它去和增量文件列表求交集，
 * 增量里不在这 300 个之内的文件会被当成「已不在 PR 里」而被静默丢掉
 * （实测：一次 push 改 62 个文件，只审了 30 个，其余没有任何提示）。
 *
 * 求交集本来是为了排除「增量里出现、但相对 base 已无差异」的文件（例如改了又改回去）。
 * 目标分支的文件列表被截断时这个判断不可靠，宁可多审，也不能漏审。
 */
import type {DiffFile} from './platform/git-platform'

/** GitHub compare 接口文件列表的硬上限；达到它就认为列表可能被截断 */
export const COMPARE_FILES_CAP = 300

export interface SelectedFiles {
  files: DiffFile[]
  /** 目标分支文件列表可能被截断，已跳过求交集 */
  targetTruncated: boolean
}

export function selectFilesToReview(params: {
  isFirstOrFullReview: boolean
  incrementalFiles: DiffFile[]
  targetBranchFiles: DiffFile[]
}): SelectedFiles {
  const {isFirstOrFullReview, incrementalFiles, targetBranchFiles} = params
  const targetTruncated = targetBranchFiles.length >= COMPARE_FILES_CAP

  if (isFirstOrFullReview) {
    // 首次 / 全量：增量与目标分支是同一份 diff，求交集等价于取目标分支列表
    const inIncremental = new Set(incrementalFiles.map(f => f.filename))
    return {
      files: targetBranchFiles.filter(f => inIncremental.has(f.filename)),
      targetTruncated
    }
  }

  if (targetTruncated) {
    return {files: incrementalFiles, targetTruncated}
  }

  const inTarget = new Set(targetBranchFiles.map(f => f.filename))
  return {
    files: incrementalFiles.filter(f => inTarget.has(f.filename)),
    targetTruncated
  }
}
