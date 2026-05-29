/**
 * unit-test/delivery/commit-delivery.ts - 提交到 PR 分支（P1）
 *
 * 对应迭代四 §2.6 方式二「Commit unit tests in branch」。
 *
 * 实现:
 * - 通过 GitHub Contents API（octokit.repos.createOrUpdateFileContents）
 *   将每个 GeneratedTest 写入到 suggestedTestPath。
 * - 已存在的同路径文件：本期采用「先取 sha，强制覆盖」策略；
 *   未来可拓展为"追加 / 合并 describe 块"。
 *
 * 权限要求:
 * - workflow 的 GITHUB_TOKEN 需要 `contents: write`
 * - 安装 GitHub App 时需要 contents: write
 *
 * 与 Member C 的关系:
 * - C 暂未实现 `triggerReview()`，与本模块无强耦合。
 * - 本模块直接调用 octokit，不依赖 C 的适配层。
 */
import {info, warning} from '@actions/core'
import {octokit} from '../../octokit'
import type {DeliveryInput, DeliveryOutcome} from '../types'

export async function commitDelivery(
  input: DeliveryInput
): Promise<DeliveryOutcome> {
  const outcome: DeliveryOutcome = {
    mode: 'commit',
    succeeded: 0,
    errors: []
  }

  if (!input.branch) {
    outcome.errors.push('未指定目标分支')
    return outcome
  }

  for (const test of input.run.tests) {
    if (!test.passedStaticCheck) {
      outcome.errors.push(
        `${test.target.name} 未通过静态校验，跳过提交: ${test.staticCheckError}`
      )
      continue
    }

    try {
      // 先查询同路径是否已有文件，拿到 sha
      let existingSha: string | undefined
      try {
        const existing = await octokit.repos.getContent({
          owner: input.owner,
          repo: input.repo,
          path: test.suggestedTestPath,
          ref: input.branch
        })
        // 仅当目标为普通文件时才取 sha 覆盖。
        // - Array.isArray 时为目录（不应覆盖）
        // - 单一对象但 type 为 'symlink' / 'submodule' 时，以 file 模式写入会破坏符号链接 / 子模块。
        if (
          !Array.isArray(existing.data) &&
          'type' in existing.data &&
          existing.data.type === 'file' &&
          'sha' in existing.data
        ) {
          existingSha = existing.data.sha
        } else if (!Array.isArray(existing.data) && 'type' in existing.data) {
          outcome.errors.push(
            `${test.suggestedTestPath} 已存在但类型为 ${String(
              (existing.data as {type?: string}).type
            )}，已跳过`
          )
          continue
        }
      } catch (e) {
        // 404 → 文件不存在，正常路径
        info(
          `unit-test/commit-delivery: file not exists, will create: ${test.suggestedTestPath}`
        )
      }

      const commitMessage = `test: add unit tests for ${test.target.name}`
      const res = await octokit.repos.createOrUpdateFileContents({
        owner: input.owner,
        repo: input.repo,
        path: test.suggestedTestPath,
        message: commitMessage,
        content: Buffer.from(test.code, 'utf-8').toString('base64'),
        branch: input.branch,
        sha: existingSha
      })
      outcome.succeeded += 1
      outcome.commitSha = res.data.commit.sha ?? outcome.commitSha
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      warning(
        `unit-test/commit-delivery: failed to commit ${test.suggestedTestPath}: ${msg}`
      )
      outcome.errors.push(`${test.suggestedTestPath}: ${msg}`)
    }
  }

  return outcome
}
