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
  summarize: string // 用户自定义的最终摘要提示词
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

$lint_section
## Analysis chain (pre-review reasoning)

$analysis_chain

## Pre-review investigation (MANDATORY)

Before writing any review comments, you MUST use the available tools to investigate the code:

1. **Use shell commands** to read related source files, check how changed functions/variables are
   used elsewhere, verify imports, and understand the broader context. Examples:
   - \`cat <file>\` or \`head -n <N> <file>\` to read files referenced in the diff
   - \`grep -rn "<symbol>" --include="*.ts" --include="*.js"\` to find usages of changed exports
   - \`ls <directory>\` to understand project structure
   - Any other shell command that helps you understand the code context

2. **Use web search** when the code uses external libraries, APIs, or SDKs and you need to
   verify correct usage, check for deprecations, or confirm parameter signatures.

You should perform at least one shell investigation per file being reviewed. The tool call
history will be automatically captured and displayed as an "Analysis chain" in the review
comments, showing your reasoning process to the PR author.

Do NOT skip this step — even if the diff looks straightforward, verify your assumptions
by reading the actual code in the repository.

## IMPORTANT Instructions

Input: New hunks annotated with line numbers and old hunks (replaced code). Hunks represent incomplete code fragments.
Additional Context: PR title, description, summaries, comment chains, and cross-file references.
Task: Investigate using shell/web_search tools first, then review new hunks for substantive issues using provided context and respond with comments if necessary.
Output: Review comments in markdown with exact line number ranges in new hunks. Start and end line numbers must be within the same hunk. For single-line comments, start=end line number. Must use example response format below.
Use fenced code blocks using the relevant language identifier where applicable.
Don't annotate code snippets with line numbers. Format and indent code correctly.
Do not use \`suggestion\` code blocks.
For fixes, use \`diff\` code blocks, marking changes with \`+\` or \`-\`. The line number range for comments with fix snippets must exactly match the range to replace in the new hunk.

- Do NOT provide general feedback, summaries, explanations of changes, or praises
  for making good additions. Do NOT suggest adding validation, comments, documentation,
  or error handling that was not explicitly part of the changes.
- Focus solely on offering specific, objective insights based on the
  given context and refrain from making broad comments about potential impacts on
  the system or question intentions behind the changes.
$lint_mandatory_instruction- **Cross-file impact analysis (MANDATORY)** — When the "Cross-file references" section
  above contains actual references (not "No cross-file references detected"), you MUST
  write a review comment on the changed line (using the same \`startLine-endLine:\\n comment\\n---\`
  output format) that lists ALL affected callers. Rules:
  1. Find the line number in the new hunk where the export signature/value changed.
  2. Write a comment on that exact line range.
  3. List EVERY caller from the cross-file references as a **markdown bullet** — one per line.
     Format each bullet as: \`- \\\`file/path.ts:LINE\\\` — \\\`codeSnippet\\\`\`
  4. NEVER compress callers into a single inline parenthetical like "(e.g., file1.ts:10, file2.ts:20)".
  5. NEVER write cross-file analysis as free-form prose outside the line-range format.
  6. Explain whether existing callers will break or still work, and why.
- When reviewing code that uses external libraries, SDKs, APIs, frameworks,
  browser Web APIs (e.g. AbortSignal, fetch, Intl, IntersectionObserver),
  or Node.js built-in modules (e.g. crypto, fs, stream):
  1. If the API usage looks standard and you are confident it is correct
     for a widely-used, stable API, you may skip web search.
  2. You MUST use web search to verify when:
     a. The library version is very recent (released after your training cutoff)
     b. The API call looks unusual, deprecated, or unfamiliar
     c. Chained/fluent API patterns where method names are easy to confuse
        (e.g. ORM query builders, SDK fluent APIs)
     d. You have any uncertainty about parameter types or signatures
     e. Browser/runtime compatibility is in question
  3. When you do search, include a link to the official documentation
     (e.g. MDN, Node.js docs, npm package docs, SDK reference) in your comment.

If code uses any external library, SDK, or API and you are uncertain about the
API usage, you MUST perform a web search before marking it as LGTM. After
verification, include the documentation link and then respond with LGTM.
If no external API is involved or you are confident the API usage is correct
and there are no issues found on a line range, you MUST respond with the
text \`LGTM!\` for that line range.

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

### Example: Cross-file impact review

Given cross-file references showing \`getUser\` is called by 3 files, and the new hunk is:
\`\`\`
10: export function getUser(id: string, includeProfile: boolean): User {
\`\`\`

You MUST respond using the line-range format with a bulleted caller list:
10-10:
\`getUser\` now requires a second parameter \`includeProfile: boolean\`. The following callers do not pass it:

- \`src/api/auth.ts:42\` — \`getUser(userId)\`
- \`src/api/admin.ts:18\` — \`getUser(req.id)\`
- \`src/controllers/profile.ts:55\` — \`getUser(session.uid)\`

Since the parameter is required, all 3 callers will fail with a TypeScript error. Either make \`includeProfile\` optional or update the callers.
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

Do NOT start your reply with an @mention, a username, or a greeting
(such as "@user" or "Hi") — the bot prepends the correct @mention of the
actual commenter automatically. Just provide the reply content directly.

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

  /**
   * 仅当文件存在工具发现时拼入的"静态分析工具结果"区块。
   * 没有发现时整段连同段头一起从最终 prompt 中移除（杠杆 A，节省 token）。
   */
  lintSection = `## Static analysis tool results (pre-review)

$lint_context

`

  /**
   * 仅当文件存在工具发现时拼入的"静态分析交叉验证 MANDATORY"指令。
   * 没有发现时整段移除，避免空泡然占用 token。
   */
  lintMandatoryInstruction = `- **Static analysis cross-validation (MANDATORY when tool findings exist)** — When the
  "Static analysis tool results" section above contains actual findings (not "No static
  analysis tool results available."), you MUST:
  1. For each tool finding that lands on a changed line, write a review comment on that
     exact line range (using the same \`startLine-endLine:\\n comment\\n---\` format).
  2. In your comment, name which tool reported it (e.g. "ESLint reports …") and explain
     the underlying business or logic impact in your own words — do not just paraphrase
     the tool message.
  3. If you disagree with a tool finding (false positive), still write a comment on that
     line stating "tool finding appears to be a false positive because …" so the author
     can see the cross-validation reasoning.
  4. After cross-validating tool findings, continue to surface logic/architecture issues
     the tools cannot detect — those are still your highest-value contributions.
`

  /**
   * 渲染代码审查提示词
   *
   * 杠杆 A：仅当 inputs.lintContext 非空时，才把"静态分析工具结果"段头 +
   * MANDATORY 指令拼到模板中；无发现的文件完全移除两者，节省 token。
   */
  renderReviewFileDiff(inputs: Inputs): string {
    const hasLintFindings =
      inputs.lintContext != null && inputs.lintContext.trim().length > 0

    let prompt = this.reviewFileDiff
    if (hasLintFindings) {
      prompt = prompt.replace('$lint_section', this.lintSection)
      prompt = prompt.replace(
        '$lint_mandatory_instruction',
        this.lintMandatoryInstruction
      )
    } else {
      prompt = prompt.replace('$lint_section', '')
      prompt = prompt.replace('$lint_mandatory_instruction', '')
    }
    return inputs.render(prompt)
  }
}
