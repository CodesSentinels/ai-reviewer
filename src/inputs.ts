/**
 * inputs.ts - 提示词上下文数据容器
 *
 * Inputs 类是一个纯数据容器，持有所有用于渲染 LLM 提示词模板的上下文变量。
 * 提供 render() 方法将模板中的 $variable 占位符替换为实际值。
 * 提供 clone() 方法用于并行处理时创建独立副本，避免数据竞争。
 */
export class Inputs {
  systemMessage: string   // 系统消息（定义 AI 的角色和行为准则）
  title: string           // PR 标题
  description: string     // PR 描述
  rawSummary: string      // 原始摘要（所有文件摘要的汇总，用于后续处理）
  shortSummary: string    // 精简摘要（用于代码审查时提供上下文）
  filename: string        // 当前处理的文件名
  fileContent: string     // 文件原始内容（基准分支的版本）
  fileDiff: string        // 文件的完整 diff
  patches: string         // 打包后的代码变更块（hunk），用于逐段审查
  diff: string            // 当前被评论的 diff 片段
  commentChain: string    // 评论对话链（已有的评论上下文）
  comment: string         // 当前用户的评论内容

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

  /**
   * 创建当前对象的深拷贝
   * 用于并行处理多个文件时，每个任务持有独立的 Inputs 副本
   */
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

  /**
   * 渲染提示词模板：将模板中的 $variable 占位符替换为实际值
   * @param content - 包含 $variable 占位符的提示词模板
   * @returns 替换后的完整提示词
   */
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
