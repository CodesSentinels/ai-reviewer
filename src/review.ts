/**
 * review.ts - 核心代码审查模块
 *
 * PR 代码审查的主要业务逻辑，是整个项目最核心的文件。
 *
 * 整体流程分为四个阶段：
 * 1. 准备阶段：获取增量 diff、过滤文件、解析代码块（hunk）
 * 2. 摘要阶段：使用轻量模型并行生成每个文件的摘要，并进行变更分类（NEEDS_REVIEW / APPROVED）
 * 3. 汇总阶段：使用重量模型合并摘要、生成最终总结和发布说明
 * 4. 审查阶段：使用重量模型对需要审查的文件进行逐段代码审查，生成行级评论
 *
 * 支持增量审查：通过在摘要评论中存储已审查的 commit ID，
 * 后续运行只审查新增的变更，避免重复审查。
 */
import { error, getInput, info, warning } from '@actions/core'
import { execFileSync } from 'child_process'
// eslint-disable-next-line camelcase
import { context as github_context } from '@actions/github'
import pLimit from 'p-limit'
import { type AnalysisStep, type Bot } from './bot'
import {
  Commenter,
  COMMENT_REPLY_TAG,
  RAW_SUMMARY_END_TAG,
  RAW_SUMMARY_START_TAG,
  SHORT_SUMMARY_END_TAG,
  SHORT_SUMMARY_START_TAG,
  SUMMARIZE_TAG
} from './commenter'
import {buildPatchScans} from './changed-lines'
import {
  analyzeDependencies,
  formatCrossFileContext,
  formatDependencySummary,
  type DependencyContext
} from './dependency-analyzer'
import {
  formatLintContextForFile,
  formatLintSummary,
  formatToolAttribution,
  runLintTools,
  type LintReport
} from './lint'
import { Inputs } from './inputs'
import { octokit } from './octokit'
import { type Options } from './options'
import { type Prompts } from './prompts'
import {mergeReviewsByTopic, type Review} from './review-dedup'
import {ensureFixSuggestionHeaders} from './fix-suggestion-header'
import { getRepoFileTree } from './repo-tree'
import { getReviewStateFromBody } from './review-state'
import { getTokenCount } from './tokenizer'

// eslint-disable-next-line camelcase
const context = github_context

/** 跨文件上下文注入的 token 上限 */
const MAX_CROSS_FILE_CONTEXT_TOKENS = 1500
const repo = context.repo

/** 在 PR 描述中添加此关键词可跳过 AI 审查 */
const ignoreKeyword = '@ai-reviewer: ignore'

export interface CodeReviewRunOptions {
  mode?: 'incremental' | 'full'
  source?: 'auto' | 'command'
  summaryOnly?: boolean
}

/**
 * 代码审查主函数
 *
 * @param lightBot - 轻量模型 Bot（用于文件摘要和变更分类）
 * @param heavyBot - 重量模型 Bot（用于深度代码审查和最终摘要）
 * @param options - 全局配置选项
 * @param prompts - 提示词模板
 */
export const codeReview = async (
  lightBot: Bot,
  heavyBot: Bot,
  options: Options,
  prompts: Prompts,
  runOptions: CodeReviewRunOptions = {}
): Promise<void> => {
  const commenter: Commenter = new Commenter()
  const fromCommand = runOptions.source === 'command'
  const reviewMode = runOptions.mode ?? 'incremental'

  // 初始化并发控制器：分别限制 OpenAI 和 GitHub API 的并发数
  const openaiConcurrencyLimit = pLimit(options.openaiConcurrencyLimit)
  const githubConcurrencyLimit = pLimit(options.githubConcurrencyLimit)

  // ==================== 事件验证 ====================
  if (
    context.eventName !== 'pull_request' &&
    context.eventName !== 'pull_request_target' &&
    !fromCommand
  ) {
    warning(
      `Skipped: current event is ${context.eventName}, only support pull_request event`
    )
    return
  }
  if (context.payload.pull_request == null && fromCommand) {
    const issueNumber = context.payload.issue?.number
    if (issueNumber != null) {
      const pr = await octokit.pulls.get({
        owner: repo.owner,
        repo: repo.repo,
        pull_number: issueNumber
      })
      ;(context.payload as any).pull_request = pr.data
    }
  }
  if (context.payload.pull_request == null) {
    warning('Skipped: context.payload.pull_request is null')
    return
  }

  if (
    !fromCommand &&
    getReviewStateFromBody(context.payload.pull_request.body ?? '') === 'paused'
  ) {
    info('Skipped: review automation is paused for this PR')
    return
  }

  // ==================== 填充 PR 基本信息 ====================
  const inputs: Inputs = new Inputs()
  inputs.title = context.payload.pull_request.title
  if (context.payload.pull_request.body != null) {
    inputs.description = commenter.getDescription(
      context.payload.pull_request.body
    )
  }

  // 如果 PR 描述中包含忽略关键词，跳过审查
  if (inputs.description.includes(ignoreKeyword)) {
    info('Skipped: description contains ignore_keyword')
    return
  }

  // 将系统消息加入 inputs（作为额外上下文补充）
  inputs.systemMessage = options.systemMessage

  // ==================== 恢复增量审查状态 ====================
  // 从已有的摘要评论中恢复上次审查的状态
  const existingSummarizeCmt = await commenter.findCommentWithTag(
    SUMMARIZE_TAG,
    context.payload.pull_request.number
  )
  let existingCommitIdsBlock = ''
  let existingSummarizeCmtBody = ''
  if (existingSummarizeCmt != null) {
    existingSummarizeCmtBody = existingSummarizeCmt.body
    // 从摘要评论中恢复原始摘要和精简摘要
    inputs.rawSummary = commenter.getRawSummary(existingSummarizeCmtBody)
    inputs.shortSummary = commenter.getShortSummary(existingSummarizeCmtBody)
    // 提取已审查的 commit ID 区块
    existingCommitIdsBlock = commenter.getReviewedCommitIdsBlock(
      existingSummarizeCmtBody
    )
  }

  // 获取 PR 的所有 commit ID 列表
  const allCommitIds = await commenter.getAllCommitIds()

  // 找到最近一次已审查的 commit ID，作为增量 diff 的起点
  let highestReviewedCommitId = ''
  if (existingCommitIdsBlock !== '') {
    highestReviewedCommitId = commenter.getHighestReviewedCommitId(
      allCommitIds,
      commenter.getReviewedCommitIds(existingCommitIdsBlock)
    )
  }

  // 确定 diff 的起始 commit
  if (reviewMode === 'full') {
    info(
      `Will review full diff from the base commit: ${context.payload.pull_request.base.sha as string
      }`
    )
    highestReviewedCommitId = context.payload.pull_request.base.sha
  } else if (
    highestReviewedCommitId === '' ||
    highestReviewedCommitId === context.payload.pull_request.head.sha
  ) {
    // 首次审查或已是最新：从 base 分支开始
    info(
      `Will review from the base commit: ${context.payload.pull_request.base.sha as string
      }`
    )
    highestReviewedCommitId = context.payload.pull_request.base.sha
  } else {
    // 增量审查：从上次审查的 commit 开始
    info(`Will review from commit: ${highestReviewedCommitId}`)
  }

  // ==================== 获取 diff 数据 ====================

  // 增量 diff：从上次审查的 commit 到最新 commit（仅包含新增变更）
  const incrementalDiff = await octokit.repos.compareCommits({
    owner: repo.owner,
    repo: repo.repo,
    base: highestReviewedCommitId,
    head: context.payload.pull_request.head.sha
  })

  // 全量 diff：从目标分支的 base 到最新 commit（完整变更视图）
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

  // 取两个 diff 的交集：既是整体变更的一部分，又包含新增内容的文件
  const files = targetBranchFiles.filter(targetBranchFile =>
    incrementalFiles.some(
      incrementalFile => incrementalFile.filename === targetBranchFile.filename
    )
  )

  if (files.length === 0) {
    warning('Skipped: files is null')
    return
  }

  // ==================== 文件路径过滤 ====================
  const filterSelectedFiles = []
  const filterIgnoredFiles = []
  for (const file of files) {
    if (!options.checkPath(file.filename)) {
      // 被路径过滤规则排除的文件
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

  // ==================== 解析代码变更块（hunk） ====================
  // 并行获取每个文件的内容和解析 diff patch
  const filteredFiles: Array<
    [string, string, string, Array<[number, number, string]>] | null
  > = await Promise.all(
    filterSelectedFiles.map(file =>
      githubConcurrencyLimit(async () => {
        // 获取文件在基准分支上的原始内容
        let fileContent = ''
        if (context.payload.pull_request == null) {
          warning('Skipped: context.payload.pull_request is null')
          return null
        }
        if (file.status === 'added') {
          info(`skip base content fetch for new file: ${file.filename}`)
        } else {
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
                  fileContent = Buffer.from(
                    contents.data.content,
                    'base64'
                  ).toString()
                }
              }
            }
          } catch (e: any) {
            warning(
              `Failed to get file contents: ${e as string
              }. This is OK if it's a new file.`
            )
          }
        }

        // 提取文件的完整 diff patch
        let fileDiff = ''
        if (file.patch != null) {
          fileDiff = file.patch
        }

        // 将 patch 拆分为独立的 hunk，并解析每个 hunk 的行号范围和内容
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
          // 格式化 hunk 为 AI 可理解的格式（new_hunk + old_hunk）
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

  // 过滤掉没有有效 patch 的文件
  const filesAndChanges = filteredFiles.filter(file => file !== null) as Array<
    [string, string, string, Array<[number, number, string]>]
  >

  if (filesAndChanges.length === 0) {
    error('Skipped: no files to review')
    return
  }

  // ==================== 共享：单次扫描 unified diff，得到每文件的 PatchScan ====================
  // 提供给 Phase 0b（lint）与 Phase 0（依赖分析）复用，避免对同一份 diff
  // 字符串重复 walk。Phase 0b 取 addedLines（lint 窗口过滤），Phase 0 取
  // touchedLines（导出函数作用域内的修改判定）。
  const patchScans = buildPatchScans(filesAndChanges)
  info(`shared: precomputed PatchScan for ${patchScans.size} file(s)`)

  // ==================== 阶段零·B：静态分析工具扫描（Linter/SAST） ====================
  let lintReport: LintReport | null = null
  if (options.enableLintTools) {
    try {
      info('Phase 0b: starting static analysis tool scan (Linter/SAST)')
      lintReport = await runLintTools({
        repoRoot: process.cwd(),
        filesAndChanges,
        patchScans,
        // 取代 .codesentinel.yaml：把 Action 输入收集到的开关传给 orchestrator
        toolEnableOverrides: options.toolEnableOverrides,
        toolVersionOverrides: options.toolVersionOverrides,
        semgrepConfig: options.semgrepConfig,
        disabled: false
      })
      info(
        `Phase 0b: lint scan completed in ${lintReport.durationMs}ms — ${lintReport.results.length} findings on changed lines from ${lintReport.toolSummaries.filter(s => s.available).length} tool(s)`
      )
    } catch (e: any) {
      warning(`Phase 0b: lint scan failed: ${e.message}, skipping`)
      lintReport = null
    }
  } else {
    info('Phase 0b: lint tools disabled by config, skipping')
  }

  // ==================== 阶段零：跨文件依赖分析 ====================
  let dependencyContext: DependencyContext | null = null
  if (options.enableDependencyAnalysis) {
    try {
      info('Phase 0: starting cross-file dependency analysis')
      // 获取仓库文件树（1 次 API 调用，结果缓存）
      const repoFiles = await getRepoFileTree(
        context.payload.pull_request.head.sha
      )
      // 分析依赖关系：解析导入、提取被修改的导出符号、搜索引用
      dependencyContext = await analyzeDependencies(
        filesAndChanges,
        repoFiles,
        options,
        githubConcurrencyLimit,
        patchScans
      )
      info('Phase 0: dependency analysis completed')
    } catch (e: any) {
      warning(`Phase 0: dependency analysis failed: ${e.message}, skipping`)
    }
  }

  // ==================== 构建状态消息 ====================
  let statusMsg = `<details>
<summary>Commits</summary>
Files that changed from the base of the PR and between ${highestReviewedCommitId} and ${context.payload.pull_request.head.sha
    } commits.
</details>
${filesAndChanges.length > 0
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
${filterIgnoredFiles.length > 0
      ? `
<details>
<summary>Files ignored due to filter (${filterIgnoredFiles.length})</summary>

* ${filterIgnoredFiles.map(file => file.filename).join('\n* ')}

</details>
`
      : ''
    }
`

  // 更新摘要评论为"审查进行中"状态
  const inProgressSummarizeCmt = commenter.addInProgressStatus(
    existingSummarizeCmtBody,
    statusMsg
  )

  await commenter.comment(`${inProgressSummarizeCmt}`, SUMMARIZE_TAG, 'replace')

  // ==================== 阶段一：并行文件摘要 ====================
  const summariesFailed: string[] = []

  /**
   * 对单个文件生成摘要
   *
   * 使用轻量模型（lightBot）：
   * 1. 检查 diff token 数是否在限制内
   * 2. 调用 AI 生成 100 字以内的摘要
   * 3. 如果启用分类，解析 [TRIAGE] 标签判断是否需要深度审查
   *
   * @returns [文件名, 摘要内容, 是否需要审查] 三元组，或 null（失败时）
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

    // 渲染摘要提示词
    const summarizePrompt = prompts.renderSummarizeFileDiff(
      ins,
      options.reviewSimpleChanges
    )
    const tokens = getTokenCount(summarizePrompt)

    // 检查 token 是否超出轻量模型的限制
    if (tokens > options.lightTokenLimits.requestTokens) {
      info(`summarize: diff tokens exceeds limit, skip ${filename}`)
      summariesFailed.push(`${filename} (diff tokens exceeds limit)`)
      return null
    }

    // 调用轻量模型生成摘要
    try {
      const [summarizeResp] = await lightBot.chat(summarizePrompt, {})

      if (summarizeResp === '') {
        info('summarize: nothing obtained from openai')
        summariesFailed.push(`${filename} (nothing obtained from openai)`)
        return null
      } else {
        if (options.reviewSimpleChanges === false) {
          // 解析 AI 响应中的分类标签：[TRIAGE]: NEEDS_REVIEW 或 APPROVED
          const triageRegex = /\[TRIAGE\]:\s*(NEEDS_REVIEW|APPROVED)/
          const triageMatch = summarizeResp.match(triageRegex)

          if (triageMatch != null) {
            const triage = triageMatch[1]
            const needsReview = triage === 'NEEDS_REVIEW'

            // 从摘要中移除分类标签行
            const summary = summarizeResp.replace(triageRegex, '').trim()
            info(`filename: ${filename}, triage: ${triage}`)
            return [filename, summary, needsReview]
          }
        }
        // 默认标记为需要审查
        return [filename, summarizeResp, true]
      }
    } catch (e: any) {
      warning(`summarize: error from openai: ${e as string}`)
      summariesFailed.push(`${filename} (error from openai: ${e as string})})`)
      return null
    }
  }

  // 并行执行所有文件的摘要任务（受 maxFiles 和并发限制约束）
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

  // ==================== 阶段二：合并摘要 ====================
  // 将所有文件摘要分批（每批 10 个）发送给重量模型进行去重合并
  if (summaries.length > 0) {
    const batchSize = 10
    for (let i = 0; i < summaries.length; i += batchSize) {
      const summariesBatch = summaries.slice(i, i + batchSize)
      for (const [filename, summary] of summariesBatch) {
        inputs.rawSummary += `---
${filename}: ${summary}
`
      }
      // 调用重量模型合并摘要
      const [summarizeResp] = await heavyBot.chat(
        prompts.renderSummarizeChangesets(inputs),
        {}
      )
      if (summarizeResp === '') {
        warning('summarize: nothing obtained from openai')
      } else {
        inputs.rawSummary = summarizeResp
      }
    }
  }

  // ==================== 阶段三：生成最终摘要和发布说明 ====================

  // 生成最终摘要
  const [summarizeFinalResponse] = await heavyBot.chat(
    prompts.renderSummarize(inputs),
    {}
  )
  if (summarizeFinalResponse === '') {
    info('summarize: nothing obtained from openai')
  }

  const botName = getInput('bot_name') || 'AI Reviewer'

  // 生成发布说明并写入 PR 描述
  if (options.disableReleaseNotes === false) {
    const [releaseNotesResponse] = await heavyBot.chat(
      prompts.renderSummarizeReleaseNotes(inputs),
      {}
    )
    if (releaseNotesResponse === '') {
      info('release notes: nothing obtained from openai')
    } else {
      let message = `### Summary by ${botName}\n\n`
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

  // 生成精简摘要（用于后续代码审查时提供上下文）
  const [summarizeShortResponse] = await heavyBot.chat(
    prompts.renderSummarizeShort(inputs),
    {}
  )
  inputs.shortSummary = summarizeShortResponse

  // 构建最终的摘要评论内容（包含隐藏的状态数据）
  let summarizeComment = `${summarizeFinalResponse}
${RAW_SUMMARY_START_TAG}
${inputs.rawSummary}
${RAW_SUMMARY_END_TAG}
${SHORT_SUMMARY_START_TAG}
${inputs.shortSummary}
${SHORT_SUMMARY_END_TAG}
${dependencyContext != null ? `\n${formatDependencySummary(dependencyContext)}` : ''}
${lintReport != null ? `\n${formatLintSummary(lintReport)}` : ''}
---

<details>
<summary>About ${botName}</summary>

${botName} is an AI-powered code review tool that helps improve code quality.

</details>
`

  // 追加处理统计信息到状态消息
  statusMsg += `
${skippedFiles.length > 0
      ? `
<details>
<summary>Files not processed due to max files limit (${skippedFiles.length
      })</summary>

* ${skippedFiles.join('\n* ')}

</details>
`
      : ''
    }
${summariesFailed.length > 0
      ? `
<details>
<summary>Files not summarized due to errors (${summariesFailed.length
      })</summary>

* ${summariesFailed.join('\n* ')}

</details>
`
      : ''
    }
`

  // ==================== 阶段四：逐文件代码审查 ====================
  if (!options.disableReview && runOptions.summaryOnly !== true) {
    // 筛选出需要审查的文件（分类为 NEEDS_REVIEW 的文件）
    const filesAndChangesReview = filesAndChanges.filter(([filename]) => {
      const needsReview =
        summaries.find(
          ([summaryFilename]) => summaryFilename === filename
        )?.[2] ?? true
      return needsReview
    })

    // 记录因分类为 APPROVED 而跳过审查的文件
    const reviewsSkipped = filesAndChanges
      .filter(
        ([filename]) =>
          !filesAndChangesReview.some(
            ([reviewFilename]) => reviewFilename === filename
          )
      )
      .map(([filename]) => filename)

    const reviewsFailed: string[] = []
    let lgtmCount = 0    // LGTM 评论计数（被过滤掉的）
    let reviewCount = 0   // 实际发布的审查评论计数

    /**
     * 对单个文件执行代码审查
     *
     * 使用重量模型（heavyBot）：
     * 1. 计算当前提示词的 token 数，确定能装入多少个 patch
     * 2. 获取每个 patch 范围内已有的评论链（作为上下文）
     * 3. 将 patch 和评论链打包到提示词中
     * 4. 调用 AI 生成审查评论
     * 5. 解析 AI 响应，提取行号范围和评论内容
     * 6. 过滤 LGTM 评论，将有效评论加入缓冲区
     */
    const doReview = async (
      filename: string,
      fileContent: string,
      patches: Array<[number, number, string]>
    ): Promise<void> => {
      info(`reviewing ${filename}`)
      const ins: Inputs = inputs.clone()
      ins.filename = filename

      // 注入静态分析工具结果（仅当前文件相关的 finding）
      if (lintReport != null) {
        const lintCtx = formatLintContextForFile(filename, lintReport)
        if (lintCtx.length > 0) {
          ins.lintContext = lintCtx
          info(`injected lint context for ${filename}: ${getTokenCount(lintCtx)} tokens`)
        }
      }

      // 注入跨文件引用上下文（在 token 预算内）
      if (dependencyContext != null) {
        const fileAnalysis = dependencyContext.fileAnalyses.get(filename)
        if (fileAnalysis != null && fileAnalysis.references.length > 0) {
          const crossFileCtx = formatCrossFileContext(fileAnalysis)
          if (crossFileCtx.length > 0) {
            const ctxTokens = getTokenCount(crossFileCtx)
            if (ctxTokens <= MAX_CROSS_FILE_CONTEXT_TOKENS) {
              ins.crossFileContext = crossFileCtx
              info(`injected cross-file context for ${filename}: ${ctxTokens} tokens`)
            } else {
              info(`cross-file context too large for ${filename}: ${ctxTokens} tokens, skipping`)
            }
          }
        }
      }

      // 计算基础提示词的 token 数
      let tokens = getTokenCount(prompts.renderReviewFileDiff(ins))

      // 计算在 token 预算内能装入多少个 patch
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

      // 逐个 patch 打包到提示词中
      let patchesPacked = 0
      for (const [startLine, endLine, patch] of patches) {
        if (context.payload.pull_request == null) {
          warning('No pull request found, skipping.')
          continue
        }
        // 检查是否已达到可打包的 patch 上限
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

        // 获取该 patch 行号范围内已有的评论对话链（提供额外上下文）
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
            `Failed to get comments: ${e as string}, skipping. backtrace: ${e.stack as string
            }`
          )
        }

        // 尝试将评论链加入 token 预算（超出则丢弃评论链上下文）
        const commentChainTokens = getTokenCount(commentChain)
        if (
          tokens + commentChainTokens >
          options.heavyTokenLimits.requestTokens
        ) {
          commentChain = ''
        } else {
          tokens += commentChainTokens
        }

        // 将 patch 内容追加到 inputs.patches
        ins.patches += `
${patch}
`
        // 如果有评论链上下文，也追加进去
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

      // 如果成功打包了至少一个 patch，执行审查
      if (patchesPacked > 0) {
        try {
          // 调用重量模型执行代码审查
          const [response, , analysisSteps] = await heavyBot.chat(
            prompts.renderReviewFileDiff(ins),
            {}
          )
          if (response === '') {
            info('review: nothing obtained from openai')
            reviewsFailed.push(`${filename} (no response)`)
            return
          }

          // 格式化 Analysis chain（模型执行的 shell / web_search 步骤）
          info(`[analysis_chain] ${filename}: received ${analysisSteps.length} analysis steps from bot`)
          const analysisChainMd = formatAnalysisChain(
            analysisSteps,
            resolveAnalysisRepositoryUrl()
          )
          info(`[analysis_chain] ${filename}: formatted markdown length=${analysisChainMd.length}, empty=${analysisChainMd === ''}`)

          // 解析 AI 响应，提取结构化的审查评论
          // 然后做**议题级合并去重**：LLM 经常对同一个 tool finding 写出多条
          // 不同角度的评论（行号还可能不同），按"重叠的 tool finding ruleId 集合"
          // 做 key 合并 — 详见 src/review-dedup.ts。
          const rawReviews = parseReview(response, patches, options.debug)
          const fileFindings =
            lintReport?.results.filter(r => r.file === filename) ?? []
          const reviews = mergeReviewsByTopic(
            rawReviews,
            filename,
            fileFindings.map(f => ({
              line: f.line,
              endLine: f.endLine,
              ruleId: f.ruleId
            }))
          )
          let analysisChainAttached = false
          for (const review of reviews) {
            // 过滤 LGTM 评论（如果配置为不保留）
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
              // 每个文件只在第一条评论上附加一次 Analysis chain，避免重复刷屏
              const shouldAttachAnalysisChain =
                analysisChainMd !== '' && !analysisChainAttached
              let commentWithChain = shouldAttachAnalysisChain
                ? `${review.comment}\n\n${analysisChainMd}`
                : review.comment
              if (shouldAttachAnalysisChain) {
                analysisChainAttached = true
              }
              // 附加该评论行号范围内重叠的工具发现（CodeRabbit "🧰 Tools" 风格）
              if (lintReport != null) {
                const toolAttribution = formatToolAttribution(
                  filename,
                  review.startLine,
                  review.endLine,
                  lintReport
                )
                if (toolAttribution.length > 0) {
                  commentWithChain = `${commentWithChain}\n${toolAttribution}`
                }
              }
              // 兜底：模型偶尔会忘记在 ```diff 块前加 🔧 修复建议标头（prompt
              // 里是 MANDATORY 规则，但不是 100% 遵守）。post-process 给裸 diff
              // 块自动加标头。
              commentWithChain = ensureFixSuggestionHeaders(commentWithChain)

              info(`[analysis_chain] ${filename}: comment line ${review.startLine}-${review.endLine}, hasChain=${shouldAttachAnalysisChain}, finalLen=${commentWithChain.length}`)
              // 将审查评论加入缓冲区
              await commenter.bufferReviewComment(
                filename,
                review.startLine,
                review.endLine,
                commentWithChain
              )
            } catch (e: any) {
              reviewsFailed.push(`${filename} comment failed (${e as string})`)
            }
          }
        } catch (e: any) {
          warning(
            `Failed to review: ${e as string}, skipping. backtrace: ${e.stack as string
            }`
          )
          reviewsFailed.push(`${filename} (${e as string})`)
        }
      } else {
        reviewsSkipped.push(`${filename} (diff too large)`)
      }
    }

    // 并行执行所有文件的审查任务
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

    // 追加审查统计信息到状态消息
    statusMsg += `
${reviewsFailed.length > 0
        ? `<details>
<summary>Files not reviewed due to errors (${reviewsFailed.length})</summary>

* ${reviewsFailed.join('\n* ')}

</details>
`
        : ''
      }
${reviewsSkipped.length > 0
        ? `<details>
<summary>Files skipped from review due to trivial changes (${reviewsSkipped.length
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

### Chat with ${botName} Bot (\`@ai-reviewer\`)
- Reply on review comments left by this bot to ask follow-up questions. A review comment is a comment on a diff or a file.
- Invite the bot into a review comment chain by tagging \`@ai-reviewer\` in a reply.

### Code suggestions
- The bot may make code suggestions, but please review them carefully before committing since the line number ranges may be misaligned.
- You can edit the comment made by the bot and manually tweak the suggestion if it is slightly off.

### Pausing incremental reviews
- Add \`@ai-reviewer: ignore\` anywhere in the PR description to pause further reviews from the bot.

</details>
`
    // 将最新的 head commit SHA 添加到已审查列表
    summarizeComment += `\n${commenter.addReviewedCommitId(
      existingCommitIdsBlock,
      context.payload.pull_request.head.sha
    )}`

    // 批量提交所有缓冲的审查评论
    await commenter.submitReview(
      context.payload.pull_request.number,
      commits[commits.length - 1].sha,
      statusMsg
    )
  }

  // summary-only 等跳过审查阶段的场景：保留既有的已审查 commit 记录，
  // 否则 replace 摘要评论会清空增量审查标记，导致下次自动审查从 base 重审
  if (runOptions.summaryOnly === true && existingCommitIdsBlock !== '') {
    summarizeComment += `\n${existingCommitIdsBlock}`
  }

  // 发布最终的摘要评论
  await commenter.comment(`${summarizeComment}`, SUMMARIZE_TAG, 'replace')
}

// ==================== Diff 解析辅助函数 ====================

// ==================== Analysis Chain 格式化 ====================

function formatShellCommandForDisplay(command: string): string {
  return command
    .replace(/\s+&&\s+/g, ' &&\n')
    .replace(/\s+\|\|\s+/g, ' ||\n')
    .replace(/\s+\|\s+/g, ' |\n')
}

/**
 * 将模型执行的分析步骤格式化为 CodeRabbit 风格的 Analysis chain
 *
 * 生成可折叠的 `<details>` 块，包含每个 shell 命令及其输出、web search 调用等，
 * 展示模型在给出审查意见之前的推理/调查过程。
 */
function resolveAnalysisRepositoryUrl(): string {
  const payload = context.payload as Record<string, any>
  const candidates = [
    context.payload.repository?.html_url,
    payload.project?.web_url,
    payload.project?.homepage,
    payload.repository?.homepage,
    process.env.CI_PROJECT_URL,
    process.env.CI_REPOSITORY_URL,
    buildGithubRepositoryUrl(),
    readOriginRemoteUrl()
  ]

  return (
    candidates
      .map(candidate => normalizeRepositoryUrl(candidate))
      .find((candidate): candidate is string => candidate != null) ?? ''
  )
}

function buildGithubRepositoryUrl(): string | undefined {
  const serverUrl = process.env.GITHUB_SERVER_URL?.trim()
  if (
    serverUrl == null ||
    serverUrl === '' ||
    repo.owner === '' ||
    repo.repo === ''
  ) {
    return undefined
  }

  return `${serverUrl.replace(/\/+$/, '')}/${repo.owner}/${repo.repo}`
}

function readOriginRemoteUrl(): string | undefined {
  try {
    const originUrl = execFileSync('git', ['config', '--get', 'remote.origin.url'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
    return originUrl === '' ? undefined : originUrl
  } catch {
    return undefined
  }
}

function normalizeRepositoryUrl(rawUrl: string | undefined): string | undefined {
  if (rawUrl == null) return undefined

  const trimmed = rawUrl.trim()
  if (trimmed === '') return undefined

  const sshLikeMatch = trimmed.match(/^(?:ssh:\/\/)?git@([^/:]+)[:/]([^\s]+)$/)
  if (sshLikeMatch != null) {
    const [, host, path] = sshLikeMatch
    return `https://${host}/${normalizeRepositoryPath(path)}`
  }

  try {
    const parsed = new URL(trimmed)
    const path = normalizeRepositoryPath(parsed.pathname)
    if (path === '') return undefined

    const protocol =
      parsed.protocol === 'http:' || parsed.protocol === 'https:'
        ? parsed.protocol
        : 'https:'

    return `${protocol}//${parsed.host}/${path}`
  } catch {
    return undefined
  }
}

function normalizeRepositoryPath(path: string): string {
  return path
    .trim()
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/, '')
}

function formatAnalysisChain(
  steps: AnalysisStep[],
  repositoryUrl: string
): string {
  info(`[formatAnalysisChain] called with ${steps.length} steps`)
  if (steps.length === 0) return ''

  let chain = '<details>\n<summary>🧩 Analysis chain</summary>\n\n'

  for (let idx = 0; idx < steps.length; idx++) {
    const step = steps[idx]
    // info(`[formatAnalysisChain] step[${idx}]: type=${step.type}, commands=${JSON.stringify(step.commands)}, stdout_len=${step.stdoutLength ?? 0}`)
    if (step.type === 'shell') {
      info(`[formatAnalysisChain] ${JSON.stringify(step)}`)
      for (let cmdIdx = 0; cmdIdx < (step.commands?.length ?? 0); cmdIdx++) {
        const command = step.commands?.[cmdIdx] ?? ''
        const commandOutput = step.commandOutputs?.[cmdIdx]
        chain += `\n🏁 Shell executed:\n`
        chain += `\`\`\`bash\n${formatShellCommandForDisplay(command)}\n\`\`\`\n\n`
        chain += `Repository: ${repositoryUrl}\n`
        if (commandOutput != null) {
          chain += `\nLength of output: ${commandOutput.stdoutLength}\n`
          chain += '\n'
        }
        chain += '---\n\n'
      }
      
    } else if (step.type === 'web_search') {
      chain += `🔍 Web search executed (status: ${step.status ?? 'unknown'})\n\n---\n\n`
    }
  }

  chain += '</details>'
  return chain
}

/**
 * 将完整的 patch 字符串按 @@ hunk 标头拆分为独立的 hunk 数组
 * 每个 hunk 以 @@ -a,b +c,d @@ 开头
 */
const splitPatch = (patch: string | null | undefined): string[] => {
  if (patch == null) {
    return []
  }

  // `,count` is optional in unified diff when count=1 (e.g. `@@ -0,0 +1 @@`)
  const pattern = /(^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@).*$/gm

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
 * 从 hunk 标头中提取旧代码和新代码的起止行号
 * 解析 @@ -oldStart,oldCount +newStart,newCount @@ 格式
 *
 * @returns { oldHunk: { startLine, endLine }, newHunk: { startLine, endLine } }
 */
const patchStartEndLine = (
  patch: string
): {
  oldHunk: { startLine: number; endLine: number }
  newHunk: { startLine: number; endLine: number }
} | null => {
  // `,count` is optional in unified diff when count=1 (e.g. `@@ -0,0 +1 @@`)
  const pattern = /(^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@)/gm
  const match = pattern.exec(patch)
  if (match != null) {
    const oldBegin = parseInt(match[2])
    const oldDiff = match[3] != null ? parseInt(match[3]) : 1
    const newBegin = parseInt(match[4])
    const newDiff = match[5] != null ? parseInt(match[5]) : 1
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
 * 将 unified diff hunk 解析为旧代码和新代码两部分
 *
 * - 以 "-" 开头的行归入 oldHunk（被删除的代码）
 * - 以 "+" 开头的行归入 newHunk（新增的代码），并标注行号
 * - 无前缀的行为上下文行，同时归入两边
 * - 新代码中间部分（跳过首尾 3 行上下文）会标注行号，方便 AI 定位
 */
const parsePatch = (
  patch: string
): { oldHunk: string; newHunk: string } | null => {
  const hunkInfo = patchStartEndLine(patch)
  if (hunkInfo == null) {
    return null
  }

  const oldHunkLines: string[] = []
  const newHunkLines: string[] = []

  let newLine = hunkInfo.newHunk.startLine

  const lines = patch.split('\n').slice(1) // 跳过 @@ 行

  // 移除末尾空行
  if (lines[lines.length - 1] === '') {
    lines.pop()
  }

  // 首尾各 3 行上下文不标注行号（减少噪音）
  const skipStart = 3
  const skipEnd = 3

  let currentLine = 0

  // 检查是否为纯删除操作（没有新增行）
  const removalOnly = !lines.some(line => line.startsWith('+'))

  for (const line of lines) {
    currentLine++
    if (line.startsWith('-')) {
      // 删除的行：归入旧代码
      oldHunkLines.push(`${line.substring(1)}`)
    } else if (line.startsWith('+')) {
      // 新增的行：归入新代码，并标注行号
      newHunkLines.push(`${newLine}: ${line.substring(1)}`)
      newLine++
    } else {
      // 上下文行：同时归入两边
      oldHunkLines.push(`${line}`)
      if (
        removalOnly ||
        (currentLine > skipStart && currentLine <= lines.length - skipEnd)
      ) {
        // 中间部分的上下文行标注行号
        newHunkLines.push(`${newLine}: ${line}`)
      } else {
        // 首尾上下文行不标注行号
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

// ==================== AI 响应解析 ====================

// `Review` 接口与 `mergeReviewsByLineRange` 已抽到 src/review-dedup.ts，便于单元测试

/**
 * 解析 AI 的代码审查响应，提取结构化的评论列表
 *
 * AI 响应格式：
 * ```
 * startLine-endLine:
 * 评论内容...
 * ---
 * startLine-endLine:
 * 评论内容...
 * ---
 * ```
 *
 * 解析后将每条评论映射到实际的 patch 行号范围：
 * - 如果评论的行号完全在某个 patch 内，直接使用
 * - 如果不在任何 patch 内，映射到重叠最大的 patch（并添加说明）
 */
function parseReview(
  response: string,
  patches: Array<[number, number, string]>,
  debug = false
): Review[] {
  const reviews: Review[] = []

  // 清理响应中代码块内的行号前缀
  response = sanitizeResponse(response.trim())

  const lines = response.split('\n')
  const lineNumberRangeRegex = /(?:^|\s)(\d+)-(\d+):\s*$/
  const commentSeparator = '---'

  let currentStartLine: number | null = null
  let currentEndLine: number | null = null
  let currentComment = ''

  /**
   * 存储当前解析的评论
   * 将评论的行号范围映射到实际的 patch 范围
   */
  function storeReview(): void {
    if (currentStartLine !== null && currentEndLine !== null) {
      const review: Review = {
        startLine: currentStartLine,
        endLine: currentEndLine,
        comment: currentComment
      }

      // 查找与评论行号范围重叠最大的 patch
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
          withinPatch =
            intersectionLength === review.endLine - review.startLine + 1
        }

        if (withinPatch) break
      }

      // 如果评论不在任何 patch 内，映射到最佳匹配的 patch
      if (!withinPatch) {
        if (bestPatchStartLine !== -1 && bestPatchEndLine !== -1) {
          review.comment = `> Note: This review was outside of the patch, so it was mapped to the patch with the greatest overlap. Original lines [${review.startLine}-${review.endLine}]

${review.comment}`
          review.startLine = bestPatchStartLine
          review.endLine = bestPatchEndLine
        } else {
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
   * 清理代码块中的行号前缀
   * AI 有时会在 suggestion/diff 代码块中保留行号，需要移除
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

  /** 清理 AI 响应中 suggestion 和 diff 代码块的行号 */
  function sanitizeResponse(comment: string): string {
    comment = sanitizeCodeBlock(comment, 'suggestion')
    comment = sanitizeCodeBlock(comment, 'diff')
    return comment
  }

  // 逐行解析 AI 响应
  for (const line of lines) {
    const lineNumberRangeMatch = line.match(lineNumberRangeRegex)

    if (lineNumberRangeMatch != null) {
      // 遇到新的行号范围标记，保存之前的评论并开始新评论
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
      // 遇到 --- 分隔符，保存当前评论
      storeReview()
      currentStartLine = null
      currentEndLine = null
      currentComment = ''
      if (debug) {
        info('Found comment separator')
      }
      continue
    }

    // 累积评论内容
    if (currentStartLine !== null && currentEndLine !== null) {
      currentComment += `${line}\n`
    }
  }

  // 保存最后一条评论
  storeReview()

  return reviews
}
