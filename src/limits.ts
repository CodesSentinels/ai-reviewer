/**
 * limits.ts - 模型 Token 限制配置
 *
 * 定义不同 OpenAI 模型的 token 限制常量。
 * 每个模型有三个核心参数：
 * - maxTokens: 模型能处理的最大 token 总数
 * - responseTokens: 预留给模型响应的 token 数
 * - requestTokens: 可用于请求提示词的 token 数（= maxTokens - responseTokens - 100 缓冲）
 *
 * 支持的模型（按推荐优先级）：
 * - gpt-4.1: 最强非推理模型，1M 上下文，32K 输出，适合深度代码审查（heavyBot 推荐）
 * - gpt-4.1-mini: 高性价比模型，1M 上下文，32K 输出，适合摘要生成（lightBot 推荐）
 * - gpt-4.1-nano: 超低成本模型，1M 上下文，32K 输出，适合简单分类
 * - gpt-4o: 上一代旗舰模型，128K 上下文，16K 输出
 * - gpt-4o-mini: 上一代轻量模型，128K 上下文，16K 输出
 * - gpt-4-turbo: 128K 上下文的 GPT-4 增强版
 * - 旧模型（gpt-4, gpt-4-32k, gpt-3.5-turbo 等）：保留向后兼容
 */
export class TokenLimits {
  maxTokens: number       // 模型最大 token 数
  requestTokens: number   // 请求可用 token 数（发送给模型的提示词上限）
  responseTokens: number  // 响应预留 token 数（模型回复的上限）
  knowledgeCutOff: string // 模型知识截止日期

  constructor(model = 'gpt-4.1-nano') {
    // ==================== 最新模型（推荐使用） ====================

    if (model === 'gpt-4.1' || model.startsWith('gpt-4.1-2')) {
      // GPT-4.1: 最强非推理模型，1M 上下文，32K 最大输出
      // 价格：$2.00/1M input, $8.00/1M output
      this.knowledgeCutOff = '2024-06-01'
      this.maxTokens = 1047576
      this.responseTokens = 32768
    } else if (model === 'gpt-4.1-mini' || model.startsWith('gpt-4.1-mini-')) {
      // GPT-4.1-mini: 高性价比模型，1M 上下文，32K 最大输出
      // 价格：$0.40/1M input, $1.60/1M output
      this.knowledgeCutOff = '2024-06-01'
      this.maxTokens = 1047576
      this.responseTokens = 32768
    } else if (model === 'gpt-4.1-nano' || model.startsWith('gpt-4.1-nano-')) {
      // GPT-4.1-nano: 超低成本模型，1M 上下文，32K 最大输出
      // 价格：$0.10/1M input, $0.40/1M output
      this.knowledgeCutOff = '2024-06-01'
      this.maxTokens = 1047576
      this.responseTokens = 32768

    // ==================== 上一代模型 ====================

    } else if (model === 'gpt-4o' || model.startsWith('gpt-4o-2')) {
      // GPT-4o: 上一代旗舰模型，128K 上下文，16K 最大输出
      // 价格：$2.50/1M input, $10.00/1M output
      this.knowledgeCutOff = '2023-10-01'
      this.maxTokens = 128000
      this.responseTokens = 4096
    } else if (model === 'gpt-4o-mini' || model.startsWith('gpt-4o-mini-')) {
      // GPT-4o-mini: 上一代轻量模型，128K 上下文，16K 最大输出
      // 价格：$0.15/1M input, $0.60/1M output
      this.knowledgeCutOff = '2023-10-01'
      this.maxTokens = 128000
      this.responseTokens = 4096
    } else if (model === 'gpt-4-turbo' || model.startsWith('gpt-4-turbo-')) {
      // GPT-4 Turbo: 128K 上下文
      this.knowledgeCutOff = '2023-12-01'
      this.maxTokens = 128000
      this.responseTokens = 4096

    // ==================== 旧模型（向后兼容） ====================

    } else if (model === 'gpt-4-32k') {
      this.knowledgeCutOff = '2021-09-01'
      this.maxTokens = 32600
      this.responseTokens = 4000
    } else if (model === 'gpt-3.5-turbo-16k') {
      this.knowledgeCutOff = '2021-09-01'
      this.maxTokens = 16300
      this.responseTokens = 3000
    } else if (model === 'gpt-4') {
      this.knowledgeCutOff = '2021-09-01'
      this.maxTokens = 8000
      this.responseTokens = 2000
    } else if (model === 'gpt-3.5-turbo') {
      this.knowledgeCutOff = '2021-09-01'
      this.maxTokens = 4000
      this.responseTokens = 1000
    } else {
      // 未知模型：使用保守的默认值（与 gpt-4.1-mini 相同）
      this.knowledgeCutOff = '2024-06-01'
      this.maxTokens = 1047576
      this.responseTokens = 32768
    }

    // 请求 token 数 = 最大 token 数 - 响应 token 数 - 100（安全余量）
    this.requestTokens = this.maxTokens - this.responseTokens - 100
  }

  string(): string {
    return `max_tokens=${this.maxTokens}, request_tokens=${this.requestTokens}, response_tokens=${this.responseTokens}`
  }
}
