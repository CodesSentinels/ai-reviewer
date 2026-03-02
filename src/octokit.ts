/**
 * octokit.ts - GitHub API 客户端
 *
 * 创建带有自动重试和限流功能的 Octokit 实例。
 * 使用插件：
 * - @octokit/plugin-retry: 请求失败时自动重试
 * - @octokit/plugin-throttling: GitHub API 速率限制处理
 *
 * 特殊逻辑：对 POST /pulls/.../reviews 请求不重试（避免重复提交审查）
 *
 * 该实例被 review.ts, commenter.ts, review-comment.ts 等模块共享使用。
 */

import {getInput, warning} from '@actions/core'
import {Octokit} from '@octokit/action'
import {retry} from '@octokit/plugin-retry'
import {throttling} from '@octokit/plugin-throttling'

// 认证 Token：优先使用 Action 输入，其次使用环境变量
const token = getInput('token') || process.env.GITHUB_TOKEN

// 组合 Octokit + 限流插件 + 重试插件
const RetryAndThrottlingOctokit = Octokit.plugin(throttling, retry)

/** 全局共享的 GitHub API 客户端实例 */
export const octokit = new RetryAndThrottlingOctokit({
  auth: `token ${token}`,
  throttle: {
    // 主限流回调：API 配额耗尽时，最多重试 3 次
    onRateLimit: (
      retryAfter: number,
      options: any,
      _o: any,
      retryCount: number
    ) => {
      warning(
        `Request quota exhausted for request ${options.method} ${options.url}
Retry after: ${retryAfter} seconds
Retry count: ${retryCount}
`
      )
      if (retryCount <= 3) {
        warning(`Retrying after ${retryAfter} seconds!`)
        return true
      }
    },
    // 次级限流回调：检测到次级限流时重试，但 POST reviews 除外
    onSecondaryRateLimit: (retryAfter: number, options: any) => {
      warning(
        `SecondaryRateLimit detected for request ${options.method} ${options.url} ; retry after ${retryAfter} seconds`
      )
      // 提交审查的 POST 请求不重试，避免重复提交
      if (
        options.method === 'POST' &&
        options.url.match(/\/repos\/.*\/.*\/pulls\/.*\/reviews/)
      ) {
        return false
      }
      return true
    }
  }
})
