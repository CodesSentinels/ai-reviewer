/**
 * tokenizer.ts - Token 计数工具
 *
 * 使用 tiktoken 的 cl100k_base 编码器（GPT-3.5/4 兼容）
 * 在发送请求前计算 Token 数量，确保不超出模型限制。
 * 被 review.ts 和 review-comment.ts 广泛使用。
 */

// eslint-disable-next-line camelcase
import {get_encoding} from '@dqbd/tiktoken'

// 初始化 cl100k_base 编码器（GPT-3.5-turbo 和 GPT-4 使用的编码方案）
const tokenizer = get_encoding('cl100k_base')

/** 将文本编码为 Token 数组 */
export function encode(input: string): Uint32Array {
  return tokenizer.encode(input)
}

/** 计算文本的 Token 数量（移除 endoftext 特殊标记后） */
export function getTokenCount(input: string): number {
  input = input.replace(/<\|endoftext\|>/g, '')
  return encode(input).length
}
