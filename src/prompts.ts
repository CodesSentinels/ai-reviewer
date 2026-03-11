/**
 * prompts.ts - LLM 提示词模板管理
 *
 * 定义所有与 AI 模型交互的提示词模板，包括：
 * - summarizeFileDiff: 单文件 diff 摘要提示词
 * - triageFileDiff: 变更分类提示词（判断是否需要审查）
 * - summarizeChangesets: 多文件摘要去重合并提示词
 * - reviewFileDiff: 代码审查提示词（核心审查逻辑）
 * - comment: 回复用户评论的提示词
 *
 * 模板中使用 $variable 占位符，由 Inputs.render() 方法替换为实际值
 */
import {type Inputs} from './inputs'

export class Prompts {
  summarize: string             // 用户自定义的最终摘要提示词
  summarizeReleaseNotes: string // 用户自定义的发布说明提示词

  /**
   * 单文件 diff 摘要提示词
   * 要求 AI 在 100 字以内总结文件变更，关注导出函数签名、全局变量等外部接口的变化
   */
  summarizeFileDiff = `## GitHub PR Title

\`$title\`

## Description

\`\`\`
$description
\`\`\`

## Diff

\`\`\`diff
$file_diff
\`\`\`

## Instructions

I would like you to succinctly summarize the diff within 100 words.
If applicable, your summary should include a note about alterations
to the signatures of exported functions, global data structures and
variables, and any changes that might affect the external interface or
behavior of the code.
`
  /**
   * 变更分类提示词（附加在摘要提示词之后）
   * 当 reviewSimpleChanges=false 时启用，要求 AI 判断变更是否需要深度审查：
   * - NEEDS_REVIEW: 涉及逻辑或功能变更，需要审查
   * - APPROVED: 仅格式化、拼写修正等简单变更，可跳过审查
   */
  triageFileDiff = `Below the summary, I would also like you to triage the diff as \`NEEDS_REVIEW\` or
\`APPROVED\` based on the following criteria:

- If the diff involves any modifications to the logic or functionality, even if they
  seem minor, triage it as \`NEEDS_REVIEW\`. This includes changes to control structures,
  function calls, or variable assignments that might impact the behavior of the code.
- If the diff only contains very minor changes that don't affect the code logic, such as
  fixing typos, formatting, or renaming variables for clarity, triage it as \`APPROVED\`.

Please evaluate the diff thoroughly and take into account factors such as the number of
lines changed, the potential impact on the overall system, and the likelihood of
introducing new bugs or security vulnerabilities.
When in doubt, always err on the side of caution and triage the diff as \`NEEDS_REVIEW\`.

You must strictly follow the format below for triaging the diff:
[TRIAGE]: <NEEDS_REVIEW or APPROVED>

Important:
- In your summary do not mention that the file needs a through review or caution about
  potential issues.
- Do not provide any reasoning why you triaged the diff as \`NEEDS_REVIEW\` or \`APPROVED\`.
- Do not mention that these changes affect the logic or functionality of the code in
  the summary. You must only use the triage status format above to indicate that.
`
  /**
   * 多文件摘要合并提示词
   * 将多个文件的独立摘要去重、分组，合并为统一的变更概述
   */
  summarizeChangesets = `Provided below are changesets in this pull request. Changesets
are in chronlogical order and new changesets are appended to the
end of the list. The format consists of filename(s) and the summary
of changes for those files. There is a separator between each changeset.
Your task is to deduplicate and group together files with
related/similar changes into a single changeset. Respond with the updated
changesets using the same format as the input.

$raw_summary
`

  /**
   * 摘要前缀：注入已有的原始摘要内容，供后续提示词使用
   */
  summarizePrefix = `Here is the summary of changes you have generated for files:
      \`\`\`
      $raw_summary
      \`\`\`

`

  /**
   * 精简摘要提示词
   * 生成不超过 500 字的精简摘要，用于在代码审查阶段为 AI 提供上下文
   */
  summarizeShort = `Your task is to provide a concise summary of the changes. This
summary will be used as a prompt while reviewing each file and must be very clear for
the AI bot to understand.

Instructions:

- Focus on summarizing only the changes in the PR and stick to the facts.
- Do not provide any instructions to the bot on how to perform the review.
- Do not mention that files need a through review or caution about potential issues.
- Do not mention that these changes affect the logic or functionality of the code.
- The summary should not exceed 500 words.
`

  /**
   * 代码审查提示词（核心）
   *
   * 指导 AI 对代码变更进行逐行审查，包括：
   * - 输入格式说明（new_hunk / old_hunk / comment_chains）
   * - 输出格式要求（行号范围 + 评论内容，用 --- 分隔）
   * - 审查原则（只提实质性问题，不提一般性建议）
   * - 示例输入输出
   */
  reviewFileDiff = `## GitHub PR Title

\`$title\`

## Description

\`\`\`
$description
\`\`\`

## Summary of changes

\`\`\`
$short_summary
\`\`\`

## Cross-file references (auto-detected)

$cross_file_context

## IMPORTANT Instructions

Input: New hunks annotated with line numbers and old hunks (replaced code). Hunks represent incomplete code fragments.
Additional Context: PR title, description, summaries, comment chains, and cross-file references.
Task: Review new hunks for substantive issues using provided context and respond with comments if necessary. If cross-file references are provided, check whether the changes are compatible with how the modified functions/variables are used in other files.
Output: Review comments in markdown with exact line number ranges in new hunks. Start and end line numbers must be within the same hunk. For single-line comments, start=end line number. Must use example response format below.
Use fenced code blocks using the relevant language identifier where applicable.
Don't annotate code snippets with line numbers. Format and indent code correctly.
Do not use \`suggestion\` code blocks.
For fixes, use \`diff\` code blocks, marking changes with \`+\` or \`-\`. The line number range for comments with fix snippets must exactly match the range to replace in the new hunk.

- Do NOT provide general feedback, summaries, explanations of changes, or praises
  for making good additions.
- Focus solely on offering specific, objective insights based on the
  given context and refrain from making broad comments about potential impacts on
  the system or question intentions behind the changes.
- When reviewing code that uses external libraries, APIs, or frameworks,
  use web search to verify that the APIs exist, are not deprecated, and
  are called with correct parameters. If an API is misused, deprecated,
  or does not exist, include a link to the relevant documentation.

If there are no issues found on a line range, you MUST respond with the
text \`LGTM!\` for that line range in the review section.

## Example

### Example changes

---new_hunk---
\`\`\`
  z = x / y
    return z

20: def add(x, y):
21:     z = x + y
22:     retrn z
23:
24: def multiply(x, y):
25:     return x * y

def subtract(x, y):
  z = x - y
\`\`\`

---old_hunk---
\`\`\`
  z = x / y
    return z

def add(x, y):
    return x + y

def subtract(x, y):
    z = x - y
\`\`\`

---comment_chains---
\`\`\`
Please review this change.
\`\`\`

---end_change_section---

### Example response

22-22:
There's a syntax error in the add function.
\`\`\`diff
-    retrn z
+    return z
\`\`\`
---
24-25:
LGTM!
---

## Changes made to \`$filename\` for your review

$patches
`

  /**
   * 回复用户评论的提示词
   *
   * 当用户在 PR review comment 中 @ai-reviewer 或在已有的 bot 对话链中回复时，
   * AI 使用此提示词理解上下文并生成回复。
   * 包含完整的上下文信息：PR 元数据、文件 diff、评论链等
   */
  comment = `A comment was made on a GitHub PR review for a
diff hunk on a file - \`$filename\`. I would like you to follow
the instructions in that comment.

## GitHub PR Title

\`$title\`

## Description

\`\`\`
$description
\`\`\`

## Summary generated by the AI bot

\`\`\`
$short_summary
\`\`\`

## Entire diff

\`\`\`diff
$file_diff
\`\`\`

## Diff being commented on

\`\`\`diff
$diff
\`\`\`

## Instructions

Please reply directly to the new comment (instead of suggesting
a reply) and your reply will be posted as-is.

If the comment contains instructions/requests for you, please comply.
For example, if the comment is asking you to generate documentation
comments on the code, in your reply please generate the required code.

In your reply, please make sure to begin the reply by tagging the user
with "@user".

## Comment format

\`user: comment\`

## Comment chain (including the new comment)

\`\`\`
$comment_chain
\`\`\`

## The comment/request that you need to directly reply to

\`\`\`
$comment
\`\`\`

If the comment asks about API behavior, library usage, or best practices,
use web search to find and reference current documentation.
`

  constructor(summarize = '', summarizeReleaseNotes = '') {
    this.summarize = summarize
    this.summarizeReleaseNotes = summarizeReleaseNotes
  }

  /**
   * 渲染单文件摘要提示词
   * @param inputs - 上下文数据
   * @param reviewSimpleChanges - 是否审查简单变更（false 时附加分类提示词）
   */
  renderSummarizeFileDiff(
    inputs: Inputs,
    reviewSimpleChanges: boolean
  ): string {
    let prompt = this.summarizeFileDiff
    if (reviewSimpleChanges === false) {
      prompt += this.triageFileDiff
    }
    return inputs.render(prompt)
  }

  /** 渲染多文件摘要合并提示词 */
  renderSummarizeChangesets(inputs: Inputs): string {
    return inputs.render(this.summarizeChangesets)
  }

  /** 渲染最终摘要提示词 */
  renderSummarize(inputs: Inputs): string {
    const prompt = this.summarizePrefix + this.summarize
    return inputs.render(prompt)
  }

  /** 渲染精简摘要提示词（用于代码审查上下文） */
  renderSummarizeShort(inputs: Inputs): string {
    const prompt = this.summarizePrefix + this.summarizeShort
    return inputs.render(prompt)
  }

  /** 渲染发布说明提示词 */
  renderSummarizeReleaseNotes(inputs: Inputs): string {
    const prompt = this.summarizePrefix + this.summarizeReleaseNotes
    return inputs.render(prompt)
  }

  /** 渲染回复评论提示词 */
  renderComment(inputs: Inputs): string {
    return inputs.render(this.comment)
  }

  /** 渲染代码审查提示词 */
  renderReviewFileDiff(inputs: Inputs): string {
    return inputs.render(this.reviewFileDiff)
  }
}
