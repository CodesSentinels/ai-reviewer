/**
 * limits.ts - Token 限制管理
 *
 * 根据 OpenAI 模型名称，定义对应的 Token 限制：
 * - maxTokens: 模型最大上下文窗口
 * - responseTokens: 预留给响应的 Token 数
 * - requestTokens: 可用于请求的 Token 数 (= maxTokens - responseTokens - 100 余量)
 *
 * 支持的模型：gpt-4-32k, gpt-3.5-turbo-16k, gpt-4, gpt-3.5-turbo(默认)
 */
export class TokenLimits {
  maxTokens: number        // 模型最大 Token 容量
  requestTokens: number    // 请求可用的最大 Token 数
  responseTokens: number   // 预留给响应的 Token 数
  knowledgeCutOff: string  // 模型知识截止日期

  /**
   * 根据模型名称自动设置 Token 限制
   * requestTokens 预留了 100 Token 的安全余量
   */
  constructor(model = 'gpt-3.5-turbo') {
    this.knowledgeCutOff = '2021-09-01'
    if (model === 'gpt-4-32k') {
      this.maxTokens = 32600
      this.responseTokens = 4000
    } else if (model === 'gpt-3.5-turbo-16k') {
      this.maxTokens = 16300
      this.responseTokens = 3000
    } else if (model === 'gpt-4') {
      this.maxTokens = 8000
      this.responseTokens = 2000
    } else {
      // 默认值适用于 gpt-3.5-turbo
      this.maxTokens = 4000
      this.responseTokens = 1000
    }
    // 请求 Token = 总容量 - 响应预留 - 100 安全余量
    this.requestTokens = this.maxTokens - this.responseTokens - 100
  }

  /** 格式化输出 Token 限制信息 */
  string(): string {
    return `max_tokens=${this.maxTokens}, request_tokens=${this.requestTokens}, response_tokens=${this.responseTokens}`
  }
}
