#!/usr/bin/env node
/**
 * CI-012：验证 GitLab MR verify job 里临时构建出的两个 bundle 确实来自
 * 当前 MR 的 commit，而不是复用/缓存的旧产物。
 *
 * BUILD-010 已经让 `npm run package` 在 dist/SOURCE_SHA、
 * dist/gitlab-trigger/SOURCE_SHA 里写入 `git rev-parse HEAD`——本脚本只是
 * 在 mr_verify job 里读出来，跟 GitLab 原生提供的 CI_COMMIT_SHA 比对。
 *
 * 这个检查只在无密钥的 mr_verify job 里跑，产物本身也从不被
 * ai_review_trigger（有密钥）消费（见 .gitlab-ci.yml 里 mr_verify 没有
 * 任何 needs:/dependencies: 指向它的 artifact），所以这里失败只影响
 * "MR 是否通过验证"，不影响任何有密钥的执行面。
 *
 * 用法：CI_COMMIT_SHA=<sha> node scripts/check-ci-verify-bundle-provenance.js
 */

const fs = require('fs')
const path = require('path')

// 用 cwd 而不是 __dirname 定位 dist/——GitLab job 里脚本总是从仓库根目录
// 运行，这样写也让本脚本能在临时目录里单元测试（见对应 .test.ts）。
const ROOT = process.cwd()

function fail(msg) {
  console.error(`FAIL: ${msg}`)
  process.exit(1)
}

function readSourceSha(relPath) {
  const full = path.join(ROOT, relPath)
  if (!fs.existsSync(full)) {
    fail(`${relPath} 不存在——bundle 可能还没构建（先跑 npm run package）`)
  }
  return fs.readFileSync(full, 'utf8').trim()
}

function main() {
  const commitSha = process.env.CI_COMMIT_SHA
  if (!commitSha) {
    fail('CI_COMMIT_SHA 未设置——本脚本只应在 GitLab CI job 里运行，该变量由平台自动提供')
  }

  const targets = ['dist/SOURCE_SHA', 'dist/gitlab-trigger/SOURCE_SHA']
  for (const rel of targets) {
    const recorded = readSourceSha(rel)
    if (recorded !== commitSha) {
      fail(
        `${rel} 记录的 source commit（${recorded}）与 CI_COMMIT_SHA（${commitSha}）不一致——` +
          `bundle 不是从当前 MR 的这次提交构建出来的`
      )
    }
    console.log(`OK: ${rel} 匹配 CI_COMMIT_SHA (${commitSha})`)
  }
}

main()
