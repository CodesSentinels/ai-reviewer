/**
 * tokenizer.ts - Token 计数工具
 *
 * 使用 tiktoken 库（cl100k_base 编码）对文本进行 token 计数。
 * 该编码与 GPT-3.5/4 使用的编码一致。
 * 在发送 API 请求前，用于检查提示词是否超出模型的 token 限制。
 */
// eslint-disable-next-line camelcase
import {get_encoding} from '@dqbd/tiktoken'

// 初始化 cl100k_base 编码器（GPT-3.5/4 系列模型使用的编码方式）
const tokenizer = get_encoding('cl100k_base')

/**
 * 将输入文本编码为 token ID 数组
 * @param input - 待编码的文本
 * @returns token ID 数组（Uint32Array）
 */
export function encode(input: string): Uint32Array {
  return tokenizer.encode(input)
}

/**
 * 计算输入文本的 token 数量
 * @param input - 待计算的文本
 * @returns token 数量
 */
export function getTokenCount(input: string): number {
  // 移除特殊的结束标记，避免影响 token 计数
  input = input.replace(/<\|endoftext\|>/g, '')
  return encode(input).length
}
