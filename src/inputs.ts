/**
 * inputs.ts - 提示词模板变量数据容器
 *
 * Inputs 类存储所有用于渲染提示词模板的变量值。
 * 在审查流程中，每个文件会 clone() 一份 Inputs 实例，填充文件相关信息，
 * 然后通过 render() 方法将 $variable 占位符替换为实际值。
 *
 * 支持的模板变量：$system_message, $title, $description, $raw_summary,
 * $short_summary, $filename, $file_content, $file_diff, $patches,
 * $diff, $comment_chain, $comment
 */
export class Inputs {
  systemMessage: string   // OpenAI 系统提示消息
  title: string           // PR 标题
  description: string     // PR 描述（去除发布说明标记后）
  rawSummary: string      // 原始变更摘要（所有文件的合并摘要）
  shortSummary: string    // 精简摘要（用于代码审查上下文）
  filename: string        // 当前处理的文件名
  fileContent: string     // 文件原始内容（base 分支版本）
  fileDiff: string        // 文件完整 diff
  patches: string         // 代码补丁片段（new_hunk + old_hunk 格式）
  diff: string            // 评论相关的 diff 片段
  commentChain: string    // 评论对话链
  comment: string         // 当前用户评论

  constructor(
    systemMessage = '',
    title = 'no title provided',
    description = 'no description provided',
    rawSummary = '',
    shortSummary = '',
    filename = '',
    fileContent = 'file contents cannot be provided',
    fileDiff = 'file diff cannot be provided',
    patches = '',
    diff = 'no diff',
    commentChain = 'no other comments on this patch',
    comment = 'no comment provided'
  ) {
    this.systemMessage = systemMessage
    this.title = title
    this.description = description
    this.rawSummary = rawSummary
    this.shortSummary = shortSummary
    this.filename = filename
    this.fileContent = fileContent
    this.fileDiff = fileDiff
    this.patches = patches
    this.diff = diff
    this.commentChain = commentChain
    this.comment = comment
  }

  /** 深拷贝当前实例，用于并发处理时避免数据竞争 */
  clone(): Inputs {
    return new Inputs(
      this.systemMessage,
      this.title,
      this.description,
      this.rawSummary,
      this.shortSummary,
      this.filename,
      this.fileContent,
      this.fileDiff,
      this.patches,
      this.diff,
      this.commentChain,
      this.comment
    )
  }

  /** 将模板中的 $variable 占位符替换为实际值，生成最终提示词 */
  render(content: string): string {
    if (!content) {
      return ''
    }
    if (this.systemMessage) {
      content = content.replace('$system_message', this.systemMessage)
    }
    if (this.title) {
      content = content.replace('$title', this.title)
    }
    if (this.description) {
      content = content.replace('$description', this.description)
    }
    if (this.rawSummary) {
      content = content.replace('$raw_summary', this.rawSummary)
    }
    if (this.shortSummary) {
      content = content.replace('$short_summary', this.shortSummary)
    }
    if (this.filename) {
      content = content.replace('$filename', this.filename)
    }
    if (this.fileContent) {
      content = content.replace('$file_content', this.fileContent)
    }
    if (this.fileDiff) {
      content = content.replace('$file_diff', this.fileDiff)
    }
    if (this.patches) {
      content = content.replace('$patches', this.patches)
    }
    if (this.diff) {
      content = content.replace('$diff', this.diff)
    }
    if (this.commentChain) {
      content = content.replace('$comment_chain', this.commentChain)
    }
    if (this.comment) {
      content = content.replace('$comment', this.comment)
    }
    return content
  }
}
