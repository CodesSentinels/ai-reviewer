/**
 * octokit.ts - GitHub API 客户端
 *
 * 创建并导出经过增强的 Octokit 实例，用于与 GitHub API 交互。
 * 集成了以下插件：
 * - @octokit/plugin-retry: 自动重试失败的 API 请求
 * - @octokit/plugin-throttling: 处理 GitHub API 速率限制
 *
 * 认证方式：通过 GITHUB_TOKEN 环境变量或 action 输入参数获取令牌
 */
import {getInput, warning} from '@actions/core'
import {Octokit} from '@octokit/action'
import {retry} from '@octokit/plugin-retry'
import {throttling} from '@octokit/plugin-throttling'

// 获取 GitHub 认证令牌（优先使用 action 输入参数，其次使用环境变量）
const token = getInput('token') || process.env.GITHUB_TOKEN

// 组合 Octokit 基础类与 throttling、retry 插件
// @ts-ignore - throttling 插件与 @octokit/action 的类型版本不兼容，运行时正常
const RetryAndThrottlingOctokit = Octokit.plugin(throttling, retry)

// 导出配置好的 Octokit 单例实例
export const octokit = new RetryAndThrottlingOctokit({
  auth: `token ${token}`,
  throttle: {
    // 主要速率限制回调：当 API 配额耗尽时触发
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
      // 最多重试 3 次
      if (retryCount <= 3) {
        warning(`Retrying after ${retryAfter} seconds!`)
        return true
      }
    },
    // 次要速率限制回调：当触发 GitHub 的二级速率限制时
    onSecondaryRateLimit: (retryAfter: number, options: any) => {
      warning(
        `SecondaryRateLimit detected for request ${options.method} ${options.url} ; retry after ${retryAfter} seconds`
      )
      // 对于提交 PR Review 的 POST 请求不重试（避免重复提交审查）
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
