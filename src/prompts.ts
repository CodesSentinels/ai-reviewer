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

/** 本次审查模型实际可用的工具（决定提示词里的调查步骤与 web search 策略） */
export interface ReviewTools {
  shell: boolean
  webSearch: boolean
  /** 只读代码探查工具（read_file / list_directory / search_code），shell 不可用时提供 */
  codeTools?: boolean
}

const INVESTIGATION_WITH_SHELL_HEAD = `## Pre-review investigation (MANDATORY)

Before writing any review comments, you MUST use the available tools to investigate the code:

1. **Use shell commands** to read related source files, check how changed functions/variables are
   used elsewhere, verify imports, and understand the broader context. Examples:
   - \`cat <file>\` or \`head -n <N> <file>\` to read files referenced in the diff
   - \`grep -rn "<symbol>" --include="*.ts" --include="*.js"\` to find usages of changed exports
   - \`ls <directory>\` to understand project structure
   - Any other shell command that helps you understand the code context

`

const INVESTIGATION_WEB_SEARCH_ITEM = `2. **Use web search** when the code uses external libraries, APIs, or SDKs and you need to
   verify correct usage, check for deprecations, or confirm parameter signatures.

`

const INVESTIGATION_WITH_SHELL_TAIL = `You should perform at least one shell investigation per file being reviewed. The tool call
history will be automatically captured and displayed as an "Analysis chain" in the review
comments, showing your reasoning process to the PR author.

Do NOT skip this step — even if the diff looks straightforward, verify your assumptions
by reading the actual code in the repository.
`

const INVESTIGATION_WITHOUT_SHELL = `## Context available for this review

Shell access is not available in this environment: you cannot read other files in the
repository. Base your review on the hunks, summaries, comment chains and cross-file
references provided in this prompt.

- Do NOT claim to have read, searched or run anything that is not shown here.
- If a finding depends on code you cannot see (for example how a function is used
  elsewhere), state that assumption explicitly instead of presenting it as fact.
`

const INVESTIGATION_WITH_CODE_TOOLS = `## Pre-review investigation (MANDATORY)

Before writing any review comments, investigate the code with the read-only tools available
to you (they read the repository through the platform API; nothing is executed):

1. **read_file** — read files referenced by the diff, or the surrounding code of a change
   (use \`start_line\` / \`end_line\` for large files).
2. **search_code** — find where a changed function, type or constant is used elsewhere.
   It searches the default branch, so it does not contain the new code of this change.
3. **list_directory** — understand the project layout.

Investigate whenever a finding depends on code outside the hunks (callers, types, config),
instead of guessing. The tool calls are displayed as an "Analysis chain" in the review
comments.

- Do NOT claim to have read, searched or run anything you did not actually do with these tools.
- If a finding still depends on code you could not see, state that assumption explicitly.
`

const INVESTIGATION_WITHOUT_SHELL_WEB_SEARCH = `- Use web search when the code uses external libraries, APIs, or SDKs and you need to
  verify correct usage, check for deprecations, or confirm parameter signatures. The tool
  call history will be displayed as an "Analysis chain" in the review comments.
`

const WEB_SEARCH_POLICY = `- When reviewing code that uses external libraries, SDKs, APIs, frameworks,
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
`

const WEB_SEARCH_UNAVAILABLE_POLICY = `- Web search is not available. If you are unsure whether an external library, SDK or API
  is used correctly, say so explicitly in the comment instead of asserting that it is
  correct or wrong.

`

/** 按可用工具生成「审查前调查」段：不能要求模型使用它根本调不了的工具 */
export function buildInvestigationSection(tools: ReviewTools): string {
  if (tools.shell) {
    return (
      INVESTIGATION_WITH_SHELL_HEAD +
      (tools.webSearch ? INVESTIGATION_WEB_SEARCH_ITEM : '') +
      INVESTIGATION_WITH_SHELL_TAIL
    )
  }
  const base =
    tools.codeTools === true ? INVESTIGATION_WITH_CODE_TOOLS : INVESTIGATION_WITHOUT_SHELL
  return base + (tools.webSearch ? INVESTIGATION_WITHOUT_SHELL_WEB_SEARCH : '')
}

/** 按可用工具生成 web search 策略段 */
export function buildWebSearchPolicy(tools: ReviewTools): string {
  return tools.webSearch ? WEB_SEARCH_POLICY : WEB_SEARCH_UNAVAILABLE_POLICY
}

export class Prompts {
  summarize: string // 用户自定义的最终摘要提示词
  summarizeReleaseNotes: string // 用户自定义的发布说明提示词

  /**
   * 单文件 diff 摘要提示词
   * 要求 AI 在 100 字以内总结文件变更，关注导出函数签名、全局变量等外部接口的变化
   */
  summarizeFileDiff = `## Pull/Merge Request Title

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
  reviewFileDiff = `## Pull/Merge Request Title

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

$investigation_section
## IMPORTANT Instructions

Input: New hunks annotated with line numbers and old hunks (replaced code). Hunks represent incomplete code fragments.
Additional Context: PR title, description, summaries, comment chains, and cross-file references.
Task: Review new hunks for substantive issues using the provided context (plus any investigation described above) and respond with comments if necessary.
Output: Review comments in markdown with exact line number ranges in new hunks. Start and end line numbers must be within the same hunk. For single-line comments, start=end line number. Must use example response format below.

**Severity tag (MANDATORY)** — The first line of every comment that reports an issue MUST be a severity tag on its own line: \`[severity: critical]\`, \`[severity: major]\`, \`[severity: minor]\` or \`[severity: nit]\`. Keep the tag in English even when responding in another language. Choose the level by the **consequence** of the issue, not by how it is worded:
- \`critical\` — security vulnerability (injection, XSS, secret exposure, auth bypass), data loss or corruption, or wrong monetary / quantity values.
- \`major\` — incorrect behavior on realistic inputs: wrong results, inverted or always-true conditions, off-by-one / out-of-bounds, unhandled promise or exception, a crash or \`NaN\` / \`undefined\` leaking into results, race conditions.
- \`minor\` — robustness or maintainability issues whose impact is limited or needs unusual inputs.
- \`nit\` — trivial improvements.
Do not add a tag to \`LGTM!\` responses.
Use fenced code blocks using the relevant language identifier where applicable.
Don't annotate code snippets with line numbers. Format and indent code correctly.
Do not use \`suggestion\` code blocks.
For fixes, use \`diff\` code blocks, marking changes with \`+\` or \`-\`. The line number range for comments with fix snippets must exactly match the range to replace in the new hunk.
Fixes MUST address the root cause. Do NOT make an error disappear by substituting a default value (e.g. \`?? 0\`, \`?? '0'\`, \`|| ''\`, an empty \`catch\`) unless that default is genuinely the correct value for the business logic. When input may be missing or invalid, make the fix surface it explicitly (validate and return \`null\` / throw / let the caller decide) instead of silently turning it into a plausible-looking value.

**Fix suggestion block (MANDATORY)** — Every \`diff\` code block that proposes a fix MUST be wrapped in a collapsible HTML \`<details>\` block, mirroring the existing "🧩 Analysis chain" pattern. Exact format:

\`\`\`
<details>
<summary>🔧 Suggested fix</summary>

\\\`\\\`\\\`diff
-old
+new
\\\`\\\`\\\`

</details>
\`\`\`

Rules:
1. \`<summary>\` line MUST contain the 🔧 wrench emoji + the phrase "Suggested fix" (translate to response language — e.g. "🔧 修复建议" for Chinese, "🔧 수정 제안" for Korean; keep the 🔧 icon).
2. There MUST be a blank line between \`<summary>\` and the \`\\\`\\\`\\\`diff\` opening fence (Markdown renderers won't render the code block otherwise).
3. There MUST be a blank line between the closing \`\\\`\\\`\\\`\` and \`</details>\`.
4. Do NOT use the older "\`**🔧 Suggested fix**\`" bold-header format; always use \`<details>\`.

This collapses long diffs by default and keeps PR comments visually clean.

- **Existing comment chains (MANDATORY)** — Comment chains in the \`---comment_chains---\` section
  may carry a status label: \`[OPEN]\` or \`[RESOLVED]\`.
  - \`[OPEN]\`: The issue has not been resolved yet.
    - If the same issue **still exists** in the new hunk: do NOT create a new comment — the open
      thread already captures it. Respond with \`LGTM!\` for that line range.
    - If the issue has been **fixed**: respond with \`LGTM!\` and note that the fix addresses the
      concern raised in the existing thread.
  - \`[RESOLVED]\`: The user marked the thread as resolved.
    - If the same issue **still exists** in the new hunk (regression or unchanged): write a new
      comment explaining that the previously-resolved concern has resurfaced.
    - If the issue is genuinely gone: respond with \`LGTM!\`.
  - No label (legacy / status unavailable): treat as \`[OPEN]\` — avoid duplicating the comment
    if the issue appears identical.
- Do NOT provide general feedback, summaries, explanations of changes, or praises
  for making good additions. Do NOT suggest adding validation, comments, documentation,
  or error handling that was not explicitly part of the changes.
- Focus solely on offering specific, objective insights based on the
  given context and refrain from making broad comments about potential impacts on
  the system or question intentions behind the changes.
- **One comment per issue (MANDATORY)** — Do NOT output two or more separate
  \`startLine-endLine:\` blocks discussing the **same underlying issue**, even if
  their line ranges differ. The "underlying issue" is identified by what lint
  tool finding (e.g. TS2345, no-unused-vars) or what bug they reference.
  Concretely:
  - If you have multiple angles on a single TypeScript error (e.g. "syntax fix"
    + "design concern"), combine them into ONE comment.
  - If a lint tool reports one finding on line 98 and you want to comment on both
    line 98 specifically AND the surrounding 95-100 function, pick ONE line range
    and put all content there. Do NOT split into two \`startLine-endLine:\` blocks.
  - Multiple separate comments on the same file are OK only when they reference
    **different** tool findings or different bugs.
  Rationale: PR reviewers see each \`startLine-endLine:\` block as a separate
  comment thread. Splitting one issue across multiple threads is noise.
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
$web_search_policyIf no external API is involved or you are confident the API usage is correct
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
[severity: major]
There's a syntax error in the add function.

<details>
<summary>🔧 Suggested fix</summary>

\`\`\`diff
-    retrn z
+    return z
\`\`\`

</details>
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
[severity: major]
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
  comment = `A comment was made on a pull/merge request review for a
diff hunk on a file - \`$filename\`. I would like you to follow
the instructions in that comment.

## Pull/Merge Request Title

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

  /**
   * 回复 PR 主评论区（issue_comment）追问的提示词
   *
   * 与 `comment`（行级评论）的区别：上下文是**整个 PR**（标题/描述/摘要/整体 diff +
   * 主评论区对话链），而非单个文件的 diff hunk。并且新增「无关问题友好婉拒」策略。
   */
  commentIssue = `A comment was made in the main conversation (not on a specific
code line) of a pull/merge request. I would like you to reply to it.

## Pull/Merge Request Title

\`$title\`

## Description

\`\`\`
$description
\`\`\`

## Summary generated by the AI bot

\`\`\`
$short_summary
\`\`\`

## PR diff

\`\`\`diff
$file_diff
\`\`\`

## Instructions

You are a code-review assistant for THIS pull request. Reply directly to the
new comment (instead of suggesting a reply) and your reply will be posted as-is.

### Relevance gate (IMPORTANT)

First decide whether the new comment is relevant to this PR, its code changes,
the surrounding codebase, or software engineering in general.

- **Relevant** → answer normally: be accurate, concise, and professional. Ground
  your answer in the PR context above; use web search to verify library/API
  usage or best practices when helpful, and cite official docs.
- **Not relevant** (e.g. chit-chat, personal requests, general trivia, writing a
  poem, or anything unrelated to this PR / codebase / software engineering) →
  do NOT try to answer it. Instead, politely and briefly decline in a friendly
  tone, and in one sentence steer the user back to questions about this PR or its
  code. Keep the decline short (2-3 sentences max). Do not be preachy or robotic.

Do NOT start your reply with an @mention, a username, or a greeting (such as
"@user" or "Hi") — the bot prepends the correct @mention of the actual commenter
automatically. Just provide the reply content directly.

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
`

  /** 审查时模型实际可用的工具；缺省按「都可用」，与既有行为一致 */
  readonly tools: ReviewTools

  constructor(
    summarize = '',
    summarizeReleaseNotes = '',
    tools: ReviewTools = {shell: true, webSearch: true}
  ) {
    this.summarize = summarize
    this.summarizeReleaseNotes = summarizeReleaseNotes
    this.tools = tools
  }

  /**
   * 渲染单文件摘要提示词
   * @param inputs - 上下文数据
   * @param reviewSimpleChanges - 是否审查简单变更（false 时附加分类提示词）
   */
  renderSummarizeFileDiff(inputs: Inputs, reviewSimpleChanges: boolean): string {
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

  /** 渲染 PR 主评论区（issue_comment）追问回复提示词 */
  renderCommentIssue(inputs: Inputs): string {
    return inputs.render(this.commentIssue)
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
    const hasLintFindings = inputs.lintContext != null && inputs.lintContext.trim().length > 0

    let prompt = this.reviewFileDiff
      .replace('$investigation_section', buildInvestigationSection(this.tools))
      .replace('$web_search_policy', buildWebSearchPolicy(this.tools))
    if (hasLintFindings) {
      prompt = prompt.replace('$lint_section', this.lintSection)
      prompt = prompt.replace('$lint_mandatory_instruction', this.lintMandatoryInstruction)
    } else {
      prompt = prompt.replace('$lint_section', '')
      prompt = prompt.replace('$lint_mandatory_instruction', '')
    }
    return inputs.render(prompt)
  }
}
