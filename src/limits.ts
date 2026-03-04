/**
 * limits.ts - 模型 Token 限制配置
 *
 * 定义不同 OpenAI 模型的 token 限制常量。
 * 每个模型有三个核心参数：
 * - maxTokens: 模型能处理的最大 token 总数
 * - responseTokens: 预留给模型响应的 token 数
 * - requestTokens: 可用于请求提示词的 token 数（= maxTokens - responseTokens - 100 缓冲）
 */
export class TokenLimits {
  maxTokens: number       // 模型最大 token 数
  requestTokens: number   // 请求可用 token 数（发送给模型的提示词上限）
  responseTokens: number  // 响应预留 token 数（模型回复的上限）
  knowledgeCutOff: string // 模型知识截止日期

  constructor(model = 'gpt-3.5-turbo') {
    this.knowledgeCutOff = '2021-09-01'

    // 根据模型名称设置对应的 token 限制
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
      // 默认值（gpt-3.5-turbo 等其他模型）
      this.maxTokens = 4000
      this.responseTokens = 1000
    }
    // 请求 token 数 = 最大 token 数 - 响应 token 数 - 100（安全余量）
    this.requestTokens = this.maxTokens - this.responseTokens - 100
  }

  string(): string {
    return `max_tokens=${this.maxTokens}, request_tokens=${this.requestTokens}, response_tokens=${this.responseTokens}`
  }
}
