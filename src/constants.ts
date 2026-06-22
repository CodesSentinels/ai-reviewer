/**
 * constants.ts - 全局共享常量
 *
 * 跨多个领域模块（命令解析 / 对话识别 / 文案展示）复用的常量集中在此，
 * 避免同一个值在多处硬编码后发生分叉。
 */

/**
 * bot mention 别名（小写，已带 @）。
 *
 * 命令解析（parser）与对话追问识别（conversation）共用同一份触发别名——
 * 二者必须保持一致，否则会出现「命令能触发但对话不认」之类的隐蔽 bug。
 * 新增/调整别名只改这里一处。
 */
export const BOT_MENTIONS = ['@ai-reviewer', '@codesentinel'] as const

/**
 * 主 mention 别名，用于面向用户的文案/用法示例（help、命令 usage 等）。
 * 取 BOT_MENTIONS 的第一个，保证与触发别名同源。
 */
export const PRIMARY_BOT_MENTION = BOT_MENTIONS[0]
