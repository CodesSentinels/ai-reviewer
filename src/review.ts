/**
 * review.ts - 核心代码审查逻辑（最大的源文件）
 *
 * 本文件包含完整的 PR 代码审查流程，分为两个主要阶段：
 *
 * 【阶段一：摘要阶段】(lightBot)
 *   1. 获取 PR diff（支持增量审查，只审查新提交的变更）
 *   2. 按路径过滤文件
 *   3. 解析每个文件的 patch，提取 hunk 代码片段
 *   4. 并发调用 lightBot 生成文件摘要 + triage 分类(NEEDS_REVIEW/APPROVED)
 *   5. 批量合并摘要，生成最终摘要和发布说明
 *
 * 【阶段二：审查阶段】(heavyBot)
 *   1. 筛选需要审查的文件（排除 triage 为 APPROVED 的文件）
 *   2. 并发调用 heavyBot 对代码 hunk 进行逐行审查
 *   3. 解析 AI 响应，提取行号范围和评论内容
 *   4. 将评论映射到 patch 范围，缓冲后批量提交 GitHub Review
 *
 * 辅助工具函数：
 * - splitPatch(): 将完整 patch 按 @@ 标记拆分为独立 hunk
 * - patchStartEndLine(): 从 @@ 头部提取起止行号
 * - parsePatch(): 将 hunk 解析为 oldHunk/newHunk 格式（新代码带行号注释）
 * - parseReview(): 解析 AI 审查响应为 Review 对象数组
 */

import {error, info, warning} from '@actions/core'
// eslint-disable-next-line camelcase
import {context as github_context} from '@actions/github'
import pLimit from 'p-limit'
import {type Bot} from './bot'
import {
  Commenter,
  COMMENT_REPLY_TAG,
  RAW_SUMMARY_END_TAG,
  RAW_SUMMARY_START_TAG,
  SHORT_SUMMARY_END_TAG,
  SHORT_SUMMARY_START_TAG,
  SUMMARIZE_TAG
} from './commenter'
import {Inputs} from './inputs'
import {octokit} from './octokit'
import {type Options} from './options'
import {type Prompts} from './prompts'
import {getTokenCount} from './tokenizer'

// eslint-disable-next-line camelcase
const context = github_context
const repo = context.repo

/** PR 描述中包含此关键词时跳过审查 */
const ignoreKeyword = '@ai-reviewer: ignore'

/**
 * codeReview - 完整的 PR 代码审查主流程
 *
 * @param lightBot - 轻量模型 Bot（用于摘要和 triage）
 * @param heavyBot - 重量模型 Bot（用于代码审查和汇总）
 * @param options - 全局配置
 * @param prompts - 提示词模板
 */
export const codeReview = async (
  lightBot: Bot,
  heavyBot: Bot,
  options: Options,
  prompts: Prompts
): Promise<void> => {
  const commenter: Commenter = new Commenter()

  // 初始化并发限制器，防止同时发起过多请求导致 API 限流
  const openaiConcurrencyLimit = pLimit(options.openaiConcurrencyLimit)
  const githubConcurrencyLimit = pLimit(options.githubConcurrencyLimit)

  // 守卫：仅处理 PR 相关事件
  if (
    context.eventName !== 'pull_request' &&
    context.eventName !== 'pull_request_target'
  ) {
    warning(
      `Skipped: current event is ${context.eventName}, only support pull_request event`
    )
    return
  }
  if (context.payload.pull_request == null) {
    warning('Skipped: context.payload.pull_request is null')
    return
  }

  // 构建 Inputs 对象，收集 PR 的标题和描述，后续作为 prompt 的上下文传递给 AI
  const inputs: Inputs = new Inputs()
  inputs.title = context.payload.pull_request.title
  if (context.payload.pull_request.body != null) {
    inputs.description = commenter.getDescription(
      context.payload.pull_request.body
    )
  }

  // 用户可在 PR 描述中加入 @ai-reviewer: ignore 来主动跳过审查
  if (inputs.description.includes(ignoreKeyword)) {
    info('Skipped: description contains ignore_keyword')
    return
  }

  // gpt-3.5-turbo 对 system message 关注度不够，将其也放入 inputs 以提高效果
  inputs.systemMessage = options.systemMessage

  // 【增量审查机制】
  // 查找 PR 中之前由 bot 发布的摘要评论，从中恢复上次审查的状态
  // 这样在 PR 有新提交时，只需审查新增的变更，而非重新审查整个 PR
  const existingSummarizeCmt = await commenter.findCommentWithTag(
    SUMMARIZE_TAG,
    context.payload.pull_request.number
  )
  let existingCommitIdsBlock = ''
  let existingSummarizeCmtBody = ''
  if (existingSummarizeCmt != null) {
    existingSummarizeCmtBody = existingSummarizeCmt.body
    // 从旧评论中提取之前的摘要内容，用于后续追加
    inputs.rawSummary = commenter.getRawSummary(existingSummarizeCmtBody)
    inputs.shortSummary = commenter.getShortSummary(existingSummarizeCmtBody)
    // 提取已审查过的 commit ID 列表
    existingCommitIdsBlock = commenter.getReviewedCommitIdsBlock(
      existingSummarizeCmtBody
    )
  }

  // 确定增量审查的起点：找到已审查的最新 commit
  const allCommitIds = await commenter.getAllCommitIds()
  let highestReviewedCommitId = ''
  if (existingCommitIdsBlock !== '') {
    highestReviewedCommitId = commenter.getHighestReviewedCommitId(
      allCommitIds,
      commenter.getReviewedCommitIds(existingCommitIdsBlock)
    )
  }

  // 如果没有找到已审查的 commit（首次审查），或者已审查到最新（无新变更），
  // 则从 PR 的 base commit 开始全量审查
  if (
    highestReviewedCommitId === '' ||
    highestReviewedCommitId === context.payload.pull_request.head.sha
  ) {
    info(
      `Will review from the base commit: ${
        context.payload.pull_request.base.sha as string
      }`
    )
    highestReviewedCommitId = context.payload.pull_request.base.sha
  } else {
    info(`Will review from commit: ${highestReviewedCommitId}`)
  }

  // 【获取两组 diff，用于计算需要审查的文件集合】
  // incrementalDiff: 上次审查的 commit → 最新 commit（增量变更）
  const incrementalDiff = await octokit.repos.compareCommits({
    owner: repo.owner,
    repo: repo.repo,
    base: highestReviewedCommitId,
    head: context.payload.pull_request.head.sha
  })

  // targetBranchDiff: PR 目标分支的 base → 最新 commit（完整变更，用于获取完整 patch）
  const targetBranchDiff = await octokit.repos.compareCommits({
    owner: repo.owner,
    repo: repo.repo,
    base: context.payload.pull_request.base.sha,
    head: context.payload.pull_request.head.sha
  })

  const incrementalFiles = incrementalDiff.data.files
  const targetBranchFiles = targetBranchDiff.data.files

  if (incrementalFiles == null || targetBranchFiles == null) {
    warning('Skipped: files data is missing')
    return
  }

  // 取两组 diff 的交集：只审查在增量中有变化的文件，但使用完整 diff 的 patch
  // 这样既实现了增量审查（只看新变更的文件），又保证 patch 上下文完整
  const files = targetBranchFiles.filter(targetBranchFile =>
    incrementalFiles.some(
      incrementalFile => incrementalFile.filename === targetBranchFile.filename
    )
  )

  if (files.length === 0) {
    warning('Skipped: files is null')
    return
  }

  // 按 path_filters 规则（glob 模式）过滤文件，例如排除 dist/**、*.lock 等
  const filterSelectedFiles = []
  const filterIgnoredFiles = []
  for (const file of files) {
    if (!options.checkPath(file.filename)) {
      info(`skip for excluded path: ${file.filename}`)
      filterIgnoredFiles.push(file)
    } else {
      filterSelectedFiles.push(file)
    }
  }

  if (filterSelectedFiles.length === 0) {
    warning('Skipped: filterSelectedFiles is null')
    return
  }

  const commits = incrementalDiff.data.commits

  if (commits.length === 0) {
    warning('Skipped: commits is null')
    return
  }

  // 【解析每个文件的 patch，提取 hunk 代码片段】
  // 返回元组数组: [文件名, 原始文件内容, 完整diff, hunk列表]
  // hunk列表中每项: [起始行号, 结束行号, 格式化后的新旧代码对比字符串]
  const filteredFiles: Array<
    [string, string, string, Array<[number, number, string]>] | null
  > = await Promise.all(
    filterSelectedFiles.map(file =>
      githubConcurrencyLimit(async () => {
        // 获取文件在 base 分支上的原始内容，供 AI 理解变更上下文
        let fileContent = ''
        if (context.payload.pull_request == null) {
          warning('Skipped: context.payload.pull_request is null')
          return null
        }
        try {
          const contents = await octokit.repos.getContent({
            owner: repo.owner,
            repo: repo.repo,
            path: file.filename,
            ref: context.payload.pull_request.base.sha
          })
          if (contents.data != null) {
            if (!Array.isArray(contents.data)) {
              if (
                contents.data.type === 'file' &&
                contents.data.content != null
              ) {
                // GitHub API 返回 base64 编码的文件内容，需要解码
                fileContent = Buffer.from(
                  contents.data.content,
                  'base64'
                ).toString()
              }
            }
          }
        } catch (e: any) {
          // 新文件在 base 分支不存在，获取内容失败是正常的
          warning(
            `Failed to get file contents: ${
              e as string
            }. This is OK if it's a new file.`
          )
        }

        let fileDiff = ''
        if (file.patch != null) {
          fileDiff = file.patch
        }

        // 将完整 patch 拆分为独立的 hunk，逐个解析为新旧代码对比格式
        // 这个格式化后的字符串会直接嵌入到发给 AI 的 prompt 中
        const patches: Array<[number, number, string]> = []
        for (const patch of splitPatch(file.patch)) {
          const patchLines = patchStartEndLine(patch)
          if (patchLines == null) {
            continue
          }
          const hunks = parsePatch(patch)
          if (hunks == null) {
            continue
          }
          const hunksStr = `
---new_hunk---
\`\`\`
${hunks.newHunk}
\`\`\`

---old_hunk---
\`\`\`
${hunks.oldHunk}
\`\`\`
`
          patches.push([
            patchLines.newHunk.startLine,
            patchLines.newHunk.endLine,
            hunksStr
          ])
        }
        if (patches.length > 0) {
          return [file.filename, fileContent, fileDiff, patches] as [
            string,
            string,
            string,
            Array<[number, number, string]>
          ]
        } else {
          return null
        }
      })
    )
  )

  // Filter out any null results
  const filesAndChanges = filteredFiles.filter(file => file !== null) as Array<
    [string, string, string, Array<[number, number, string]>]
  >

  if (filesAndChanges.length === 0) {
    error('Skipped: no files to review')
    return
  }

  let statusMsg = `<details>
<summary>Commits</summary>
Files that changed from the base of the PR and between ${highestReviewedCommitId} and ${
    context.payload.pull_request.head.sha
  } commits.
</details>
${
  filesAndChanges.length > 0
    ? `
<details>
<summary>Files selected (${filesAndChanges.length})</summary>

* ${filesAndChanges
        .map(([filename, , , patches]) => `${filename} (${patches.length})`)
        .join('\n* ')}
</details>
`
    : ''
}
${
  filterIgnoredFiles.length > 0
    ? `
<details>
<summary>Files ignored due to filter (${filterIgnoredFiles.length})</summary>

* ${filterIgnoredFiles.map(file => file.filename).join('\n* ')}

</details>
`
    : ''
}
`

  // update the existing comment with in progress status
  const inProgressSummarizeCmt = commenter.addInProgressStatus(
    existingSummarizeCmtBody,
    statusMsg
  )

  // add in progress status to the summarize comment
  await commenter.comment(`${inProgressSummarizeCmt}`, SUMMARIZE_TAG, 'replace')

  const summariesFailed: string[] = []

  /**
   * doSummary - 对单个文件调用 lightBot 生成摘要
   * 返回: [文件名, 摘要内容, 是否需要深度审查]
   *
   * 当 reviewSimpleChanges=false 时，lightBot 会同时输出 triage 分类：
   *   [TRIAGE]: NEEDS_REVIEW  → 需要 heavyBot 深度审查
   *   [TRIAGE]: APPROVED      → 简单变更，跳过审查阶段
   */
  const doSummary = async (
    filename: string,
    fileContent: string,
    fileDiff: string
  ): Promise<[string, string, boolean] | null> => {
    info(`summarize: ${filename}`)
    const ins = inputs.clone()
    if (fileDiff.length === 0) {
      warning(`summarize: file_diff is empty, skip ${filename}`)
      summariesFailed.push(`${filename} (empty diff)`)
      return null
    }

    ins.filename = filename
    ins.fileDiff = fileDiff

    const summarizePrompt = prompts.renderSummarizeFileDiff(
      ins,
      options.reviewSimpleChanges
    )
    const tokens = getTokenCount(summarizePrompt)

    // token 超限的文件直接跳过，避免 API 报错
    if (tokens > options.lightTokenLimits.requestTokens) {
      info(`summarize: diff tokens exceeds limit, skip ${filename}`)
      summariesFailed.push(`${filename} (diff tokens exceeds limit)`)
      return null
    }

    try {
      const [summarizeResp] = await lightBot.chat(summarizePrompt, {})

      if (summarizeResp === '') {
        info('summarize: nothing obtained from openai')
        summariesFailed.push(`${filename} (nothing obtained from openai)`)
        return null
      } else {
        if (options.reviewSimpleChanges === false) {
          // 从 AI 响应中提取 triage 分类，决定是否需要深度审查
          const triageRegex = /\[TRIAGE\]:\s*(NEEDS_REVIEW|APPROVED)/
          const triageMatch = summarizeResp.match(triageRegex)

          if (triageMatch != null) {
            const triage = triageMatch[1]
            const needsReview = triage === 'NEEDS_REVIEW'

            // 从摘要中移除 triage 标记行，只保留摘要正文
            const summary = summarizeResp.replace(triageRegex, '').trim()
            info(`filename: ${filename}, triage: ${triage}`)
            return [filename, summary, needsReview]
          }
        }
        // 未启用 triage 或未匹配到分类时，默认需要审查
        return [filename, summarizeResp, true]
      }
    } catch (e: any) {
      warning(`summarize: error from openai: ${e as string}`)
      summariesFailed.push(`${filename} (error from openai: ${e as string})})`)
      return null
    }
  }

  // 【并发执行摘要任务】受 maxFiles 限制，超出的文件记入 skippedFiles
  const summaryPromises = []
  const skippedFiles = []
  for (const [filename, fileContent, fileDiff] of filesAndChanges) {
    if (options.maxFiles <= 0 || summaryPromises.length < options.maxFiles) {
      summaryPromises.push(
        openaiConcurrencyLimit(
          async () => await doSummary(filename, fileContent, fileDiff)
        )
      )
    } else {
      skippedFiles.push(filename)
    }
  }

  const summaries = (await Promise.all(summaryPromises)).filter(
    summary => summary !== null
  ) as Array<[string, string, boolean]>

  // 【摘要聚合】将各文件摘要分批（每批10个）发给 heavyBot 进行二次汇总
  // 这样做是为了控制单次请求的 token 量，同时逐步精炼摘要内容
  if (summaries.length > 0) {
    const batchSize = 10
    for (let i = 0; i < summaries.length; i += batchSize) {
      const summariesBatch = summaries.slice(i, i + batchSize)
      for (const [filename, summary] of summariesBatch) {
        inputs.rawSummary += `---
${filename}: ${summary}
`
      }
      const [summarizeResp] = await heavyBot.chat(
        prompts.renderSummarizeChangesets(inputs),
        {}
      )
      if (summarizeResp === '') {
        warning('summarize: nothing obtained from openai')
      } else {
        // 用 heavyBot 的汇总结果替换原始拼接的摘要
        inputs.rawSummary = summarizeResp
      }
    }
  }

  // 基于汇总后的 rawSummary 生成最终的格式化摘要（Walkthrough + Changes 表格 + Poem）
  const [summarizeFinalResponse] = await heavyBot.chat(
    prompts.renderSummarize(inputs),
    {}
  )
  if (summarizeFinalResponse === '') {
    info('summarize: nothing obtained from openai')
  }

  // 生成发布说明并写入 PR 描述
  if (options.disableReleaseNotes === false) {
    const [releaseNotesResponse] = await heavyBot.chat(
      prompts.renderSummarizeReleaseNotes(inputs),
      {}
    )
    if (releaseNotesResponse === '') {
      info('release notes: nothing obtained from openai')
    } else {
      let message = '### Summary by AI Reviewer\n\n'
      message += releaseNotesResponse
      try {
        await commenter.updateDescription(
          context.payload.pull_request.number,
          message
        )
      } catch (e: any) {
        warning(`release notes: error from github: ${e.message as string}`)
      }
    }
  }

  // 生成短摘要，用于后续审查阶段作为 AI 的上下文背景
  const [summarizeShortResponse] = await heavyBot.chat(
    prompts.renderSummarizeShort(inputs),
    {}
  )
  inputs.shortSummary = summarizeShortResponse

  let summarizeComment = `${summarizeFinalResponse}
${RAW_SUMMARY_START_TAG}
${inputs.rawSummary}
${RAW_SUMMARY_END_TAG}
${SHORT_SUMMARY_START_TAG}
${inputs.shortSummary}
${SHORT_SUMMARY_END_TAG}

---

<details>
<summary>About AI Reviewer</summary>

AI Reviewer is an AI-powered code review tool that helps improve code quality.

</details>
`

  statusMsg += `
${
  skippedFiles.length > 0
    ? `
<details>
<summary>Files not processed due to max files limit (${
        skippedFiles.length
      })</summary>

* ${skippedFiles.join('\n* ')}

</details>
`
    : ''
}
${
  summariesFailed.length > 0
    ? `
<details>
<summary>Files not summarized due to errors (${
        summariesFailed.length
      })</summary>

* ${summariesFailed.join('\n* ')}

</details>
`
    : ''
}
`

  // ==================== 阶段二：深度代码审查 ====================
  if (!options.disableReview) {
    // 根据 triage 结果过滤：只审查标记为 NEEDS_REVIEW 的文件
    // 未出现在 summaries 中的文件默认需要审查（?? true）
    const filesAndChangesReview = filesAndChanges.filter(([filename]) => {
      const needsReview =
        summaries.find(
          ([summaryFilename]) => summaryFilename === filename
        )?.[2] ?? true
      return needsReview
    })

    // 被 triage 标记为 APPROVED 的文件，记录到跳过列表用于状态报告
    const reviewsSkipped = filesAndChanges
      .filter(
        ([filename]) =>
          !filesAndChangesReview.some(
            ([reviewFilename]) => reviewFilename === filename
          )
      )
      .map(([filename]) => filename)

    const reviewsFailed: string[] = []
    let lgtmCount = 0
    let reviewCount = 0
    /**
     * doReview - 对单个文件调用 heavyBot 进行深度代码审查
     *
     * 核心逻辑：
     * 1. 预计算 token，确定能装入多少个 patch（避免超出模型上下文窗口）
     * 2. 收集该 hunk 范围内已有的评论链（comment chain），作为对话上下文
     * 3. 将 patches + comment chains 组装到 prompt，发给 heavyBot
     * 4. 解析 AI 响应，将评论缓冲到 commenter，最后批量提交 GitHub Review
     */
    const doReview = async (
      filename: string,
      fileContent: string,
      patches: Array<[number, number, string]>
    ): Promise<void> => {
      info(`reviewing ${filename}`)
      const ins: Inputs = inputs.clone()
      ins.filename = filename

      // 【token 预算计算】先算 prompt 模板本身的 token，再逐个累加 patch
      // 超出 token 限制的 patch 将被跳过
      let tokens = getTokenCount(prompts.renderReviewFileDiff(ins))
      let patchesToPack = 0
      for (const [, , patch] of patches) {
        const patchTokens = getTokenCount(patch)
        if (tokens + patchTokens > options.heavyTokenLimits.requestTokens) {
          info(
            `only packing ${patchesToPack} / ${patches.length} patches, tokens: ${tokens} / ${options.heavyTokenLimits.requestTokens}`
          )
          break
        }
        tokens += patchTokens
        patchesToPack += 1
      }

      // 【组装 prompt】将 patch 和已有评论链拼入 inputs.patches
      let patchesPacked = 0
      for (const [startLine, endLine, patch] of patches) {
        if (context.payload.pull_request == null) {
          warning('No pull request found, skipping.')
          continue
        }
        if (patchesPacked >= patchesToPack) {
          info(
            `unable to pack more patches into this request, packed: ${patchesPacked}, total patches: ${patches.length}, skipping.`
          )
          if (options.debug) {
            info(`prompt so far: ${prompts.renderReviewFileDiff(ins)}`)
          }
          break
        }
        patchesPacked += 1

        // 获取该行范围内已有的 review 评论链，让 AI 了解之前的讨论上下文
        let commentChain = ''
        try {
          const allChains = await commenter.getCommentChainsWithinRange(
            context.payload.pull_request.number,
            filename,
            startLine,
            endLine,
            COMMENT_REPLY_TAG
          )

          if (allChains.length > 0) {
            info(`Found comment chains: ${allChains} for ${filename}`)
            commentChain = allChains
          }
        } catch (e: any) {
          warning(
            `Failed to get comments: ${e as string}, skipping. backtrace: ${
              e.stack as string
            }`
          )
        }
        // 评论链也占 token 预算，超限时丢弃评论链（保留 patch 优先）
        const commentChainTokens = getTokenCount(commentChain)
        if (
          tokens + commentChainTokens >
          options.heavyTokenLimits.requestTokens
        ) {
          commentChain = ''
        } else {
          tokens += commentChainTokens
        }

        ins.patches += `
${patch}
`
        if (commentChain !== '') {
          ins.patches += `
---comment_chains---
\`\`\`
${commentChain}
\`\`\`
`
        }

        ins.patches += `
---end_change_section---
`
      }

      if (patchesPacked > 0) {
        // 【调用 AI 审查并解析结果】
        try {
          const [response] = await heavyBot.chat(
            prompts.renderReviewFileDiff(ins),
            {}
          )
          if (response === '') {
            info('review: nothing obtained from openai')
            reviewsFailed.push(`${filename} (no response)`)
            return
          }
          // 解析 AI 响应为结构化的 Review 对象（行号范围 + 评论内容）
          const reviews = parseReview(response, patches, options.debug)
          for (const review of reviews) {
            // 过滤 LGTM 评论：如果配置不保留 LGTM 评论，则跳过计数但不提交
            if (
              !options.reviewCommentLGTM &&
              (review.comment.includes('LGTM') ||
                review.comment.includes('looks good to me'))
            ) {
              lgtmCount += 1
              continue
            }
            if (context.payload.pull_request == null) {
              warning('No pull request found, skipping.')
              continue
            }

            try {
              reviewCount += 1
              // 缓冲评论，稍后通过 submitReview 批量提交
              await commenter.bufferReviewComment(
                filename,
                review.startLine,
                review.endLine,
                `${review.comment}`
              )
            } catch (e: any) {
              reviewsFailed.push(`${filename} comment failed (${e as string})`)
            }
          }
        } catch (e: any) {
          warning(
            `Failed to review: ${e as string}, skipping. backtrace: ${
              e.stack as string
            }`
          )
          reviewsFailed.push(`${filename} (${e as string})`)
        }
      } else {
        reviewsSkipped.push(`${filename} (diff too large)`)
      }
    }

    const reviewPromises = []
    for (const [filename, fileContent, , patches] of filesAndChangesReview) {
      if (options.maxFiles <= 0 || reviewPromises.length < options.maxFiles) {
        reviewPromises.push(
          openaiConcurrencyLimit(async () => {
            await doReview(filename, fileContent, patches)
          })
        )
      } else {
        skippedFiles.push(filename)
      }
    }

    await Promise.all(reviewPromises)

    statusMsg += `
${
  reviewsFailed.length > 0
    ? `<details>
<summary>Files not reviewed due to errors (${reviewsFailed.length})</summary>

* ${reviewsFailed.join('\n* ')}

</details>
`
    : ''
}
${
  reviewsSkipped.length > 0
    ? `<details>
<summary>Files skipped from review due to trivial changes (${
        reviewsSkipped.length
      })</summary>

* ${reviewsSkipped.join('\n* ')}

</details>
`
    : ''
}
<details>
<summary>Review comments generated (${reviewCount + lgtmCount})</summary>

* Review: ${reviewCount}
* LGTM: ${lgtmCount}

</details>

---

<details>
<summary>Tips</summary>

### Chat with AI Reviewer Bot (\`@ai-reviewer\`)
- Reply on review comments left by this bot to ask follow-up questions. A review comment is a comment on a diff or a file.
- Invite the bot into a review comment chain by tagging \`@ai-reviewer\` in a reply.

### Code suggestions
- The bot may make code suggestions, but please review them carefully before committing since the line number ranges may be misaligned. 
- You can edit the comment made by the bot and manually tweak the suggestion if it is slightly off.

### Pausing incremental reviews
- Add \`@ai-reviewer: ignore\` anywhere in the PR description to pause further reviews from the bot.

</details>
`
    // 将本次审查的最新 commit ID 追加到已审查列表，供下次增量审查使用
    summarizeComment += `\n${commenter.addReviewedCommitId(
      existingCommitIdsBlock,
      context.payload.pull_request.head.sha
    )}`

    // 批量提交所有缓冲的 review 评论到 GitHub（作为一个 PR Review）
    await commenter.submitReview(
      context.payload.pull_request.number,
      commits[commits.length - 1].sha,
      statusMsg
    )
  }

  // 发布/更新摘要评论（包含 rawSummary、shortSummary 和已审查 commit 列表）
  await commenter.comment(`${summarizeComment}`, SUMMARIZE_TAG, 'replace')
}

/**
 * splitPatch - 将完整的 unified diff patch 按 @@ 标记拆分为独立的 hunk 片段
 * 每个 hunk 以 "@@ -old,len +new,len @@" 开头
 */
const splitPatch = (patch: string | null | undefined): string[] => {
  if (patch == null) {
    return []
  }

  const pattern = /(^@@ -(\d+),(\d+) \+(\d+),(\d+) @@).*$/gm

  const result: string[] = []
  let last = -1
  let match: RegExpExecArray | null
  while ((match = pattern.exec(patch)) !== null) {
    if (last === -1) {
      last = match.index
    } else {
      result.push(patch.substring(last, match.index))
      last = match.index
    }
  }
  if (last !== -1) {
    result.push(patch.substring(last))
  }
  return result
}

/**
 * patchStartEndLine - 从 @@ 头部解析 old/new hunk 的起止行号
 * 格式: @@ -oldStart,oldLen +newStart,newLen @@
 */
const patchStartEndLine = (
  patch: string
): {
  oldHunk: {startLine: number; endLine: number}
  newHunk: {startLine: number; endLine: number}
} | null => {
  const pattern = /(^@@ -(\d+),(\d+) \+(\d+),(\d+) @@)/gm
  const match = pattern.exec(patch)
  if (match != null) {
    const oldBegin = parseInt(match[2])
    const oldDiff = parseInt(match[3])
    const newBegin = parseInt(match[4])
    const newDiff = parseInt(match[5])
    return {
      oldHunk: {
        startLine: oldBegin,
        endLine: oldBegin + oldDiff - 1
      },
      newHunk: {
        startLine: newBegin,
        endLine: newBegin + newDiff - 1
      }
    }
  } else {
    return null
  }
}

/**
 * parsePatch - 将 hunk 解析为 oldHunk（原始代码）和 newHunk（新代码，带行号注释）
 *
 * 处理逻辑：
 * - '-' 开头的行 → 旧代码（加入 oldHunk）
 * - '+' 开头的行 → 新代码（加入 newHunk，带行号前缀如 "42: "）
 * - 无前缀的行 → 上下文行（同时加入两侧）
 * - 前3行和后3行的上下文不加行号，减少 AI 的注意力分散
 */
const parsePatch = (
  patch: string
): {oldHunk: string; newHunk: string} | null => {
  const hunkInfo = patchStartEndLine(patch)
  if (hunkInfo == null) {
    return null
  }

  const oldHunkLines: string[] = []
  const newHunkLines: string[] = []

  let newLine = hunkInfo.newHunk.startLine

  const lines = patch.split('\n').slice(1) // Skip the @@ line

  // Remove the last line if it's empty
  if (lines[lines.length - 1] === '') {
    lines.pop()
  }

  // Skip annotations for the first 3 and last 3 lines
  const skipStart = 3
  const skipEnd = 3

  let currentLine = 0

  const removalOnly = !lines.some(line => line.startsWith('+'))

  for (const line of lines) {
    currentLine++
    if (line.startsWith('-')) {
      oldHunkLines.push(`${line.substring(1)}`)
    } else if (line.startsWith('+')) {
      newHunkLines.push(`${newLine}: ${line.substring(1)}`)
      newLine++
    } else {
      // context line
      oldHunkLines.push(`${line}`)
      if (
        removalOnly ||
        (currentLine > skipStart && currentLine <= lines.length - skipEnd)
      ) {
        newHunkLines.push(`${newLine}: ${line}`)
      } else {
        newHunkLines.push(`${line}`)
      }
      newLine++
    }
  }

  return {
    oldHunk: oldHunkLines.join('\n'),
    newHunk: newHunkLines.join('\n')
  }
}

/** AI 审查评论的解析结果 */
interface Review {
  startLine: number  // 评论起始行号
  endLine: number    // 评论结束行号
  comment: string    // 评论内容
}

/**
 * parseReview - 解析 AI 审查响应文本为结构化的 Review 对象数组
 *
 * AI 响应格式为：
 *   startLine-endLine:
 *   评论内容...
 *   ---
 *
 * 本函数：
 * 1. 清理代码块中的行号前缀（sanitizeCodeBlock）
 * 2. 逐行解析行号范围和评论内容
 * 3. 将评论映射到最近的 patch 范围（如果评论超出 patch 边界）
 */
function parseReview(
  response: string,
  patches: Array<[number, number, string]>,
  debug = false
): Review[] {
  const reviews: Review[] = []

  // 先清理 AI 响应中代码块内的行号前缀（AI 可能把 prompt 中的行号带到建议代码中）
  response = sanitizeResponse(response.trim())

  const lines = response.split('\n')
  // AI 响应格式: "startLine-endLine:" 后跟评论内容，"---" 分隔不同评论
  const lineNumberRangeRegex = /(?:^|\s)(\d+)-(\d+):\s*$/
  const commentSeparator = '---'

  let currentStartLine: number | null = null
  let currentEndLine: number | null = null
  let currentComment = ''

  /**
   * storeReview - 将当前解析中的评论保存到 reviews 数组
   * 关键逻辑：AI 返回的行号可能超出 patch 范围，需要映射到最近的 patch
   */
  function storeReview(): void {
    if (currentStartLine !== null && currentEndLine !== null) {
      const review: Review = {
        startLine: currentStartLine,
        endLine: currentEndLine,
        comment: currentComment
      }

      // 【评论行号→patch 范围映射】
      // GitHub Review API 要求评论必须在 diff 的 patch 范围内
      // 这里找到与评论行号重叠最大的 patch，将评论映射过去
      let withinPatch = false
      let bestPatchStartLine = -1
      let bestPatchEndLine = -1
      let maxIntersection = 0

      for (const [startLine, endLine] of patches) {
        const intersectionStart = Math.max(review.startLine, startLine)
        const intersectionEnd = Math.min(review.endLine, endLine)
        const intersectionLength = Math.max(
          0,
          intersectionEnd - intersectionStart + 1
        )

        if (intersectionLength > maxIntersection) {
          maxIntersection = intersectionLength
          bestPatchStartLine = startLine
          bestPatchEndLine = endLine
          // 完全包含在 patch 内则无需映射
          withinPatch =
            intersectionLength === review.endLine - review.startLine + 1
        }

        if (withinPatch) break
      }

      // 评论超出 patch 范围时，映射到最佳匹配的 patch 并添加说明
      if (!withinPatch) {
        if (bestPatchStartLine !== -1 && bestPatchEndLine !== -1) {
          review.comment = `> Note: This review was outside of the patch, so it was mapped to the patch with the greatest overlap. Original lines [${review.startLine}-${review.endLine}]

${review.comment}`
          review.startLine = bestPatchStartLine
          review.endLine = bestPatchEndLine
        } else {
          // 完全没有重叠的 patch，兜底映射到第一个 patch
          review.comment = `> Note: This review was outside of the patch, but no patch was found that overlapped with it. Original lines [${review.startLine}-${review.endLine}]

${review.comment}`
          review.startLine = patches[0][0]
          review.endLine = patches[0][1]
        }
      }

      reviews.push(review)

      info(
        `Stored comment for line range ${currentStartLine}-${currentEndLine}: ${currentComment.trim()}`
      )
    }
  }

  /**
   * sanitizeCodeBlock - 清理代码块中的行号前缀
   * AI 在生成 suggestion/diff 代码块时，可能会保留 prompt 中的行号前缀（如 "42: "）
   * 这些行号在代码建议中是多余的，需要移除以保持代码可直接应用
   */
  function sanitizeCodeBlock(comment: string, codeBlockLabel: string): string {
    const codeBlockStart = `\`\`\`${codeBlockLabel}`
    const codeBlockEnd = '```'
    const lineNumberRegex = /^ *(\d+): /gm

    let codeBlockStartIndex = comment.indexOf(codeBlockStart)

    while (codeBlockStartIndex !== -1) {
      const codeBlockEndIndex = comment.indexOf(
        codeBlockEnd,
        codeBlockStartIndex + codeBlockStart.length
      )

      if (codeBlockEndIndex === -1) break

      const codeBlock = comment.substring(
        codeBlockStartIndex + codeBlockStart.length,
        codeBlockEndIndex
      )
      const sanitizedBlock = codeBlock.replace(lineNumberRegex, '')

      comment =
        comment.slice(0, codeBlockStartIndex + codeBlockStart.length) +
        sanitizedBlock +
        comment.slice(codeBlockEndIndex)

      codeBlockStartIndex = comment.indexOf(
        codeBlockStart,
        codeBlockStartIndex +
          codeBlockStart.length +
          sanitizedBlock.length +
          codeBlockEnd.length
      )
    }

    return comment
  }

  function sanitizeResponse(comment: string): string {
    comment = sanitizeCodeBlock(comment, 'suggestion')
    comment = sanitizeCodeBlock(comment, 'diff')
    return comment
  }

  // 【逐行解析状态机】遇到 "N-M:" 开始新评论，遇到 "---" 结束当前评论
  for (const line of lines) {
    const lineNumberRangeMatch = line.match(lineNumberRangeRegex)

    if (lineNumberRangeMatch != null) {
      // 遇到新的行号范围，先保存之前的评论，再开始新的
      storeReview()
      currentStartLine = parseInt(lineNumberRangeMatch[1], 10)
      currentEndLine = parseInt(lineNumberRangeMatch[2], 10)
      currentComment = ''
      if (debug) {
        info(`Found line number range: ${currentStartLine}-${currentEndLine}`)
      }
      continue
    }

    if (line.trim() === commentSeparator) {
      storeReview()
      currentStartLine = null
      currentEndLine = null
      currentComment = ''
      if (debug) {
        info('Found comment separator')
      }
      continue
    }

    if (currentStartLine !== null && currentEndLine !== null) {
      currentComment += `${line}\n`
    }
  }

  storeReview()

  return reviews
}
