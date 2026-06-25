#!/usr/bin/env bash
# setup-resolve-test.sh — 创建带有 Bot review comments 的测试 PR
# 供手动触发 "@ai-reviewer resolve" 体验 resolve 功能
#
# 用法:
#   ./scripts/setup-resolve-test.sh
#   GITHUB_TOKEN=<pat> ./scripts/setup-resolve-test.sh
#
# 依赖: curl, python3

set -euo pipefail

# ─── 配置 ──────────────────────────────────────────────────────────────────────
OWNER="CodesSentinels"
REPO="ai-reviewer-test"
BRANCH="test/resolve-manual-$(date +%s)"
FILE_PATH="manual-tests/resolve-demo-$(date +%s).ts"
API="https://api.github.com"

# ─── 读取 Token ────────────────────────────────────────────────────────────────
SECRETS_FILE="$(dirname "$0")/../.secrets"
if [[ -z "${GITHUB_TOKEN:-}" && -f "${SECRETS_FILE}" ]]; then
  GITHUB_TOKEN=$(grep -E '^GITHUB_TOKEN=' "${SECRETS_FILE}" | head -1 | cut -d= -f2-)
fi
if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  echo "❌  未找到 GitHub Token。请在 .secrets 中添加 GITHUB_TOKEN=<pat> 或设置环境变量。" >&2
  exit 1
fi

# ─── 工具函数 ──────────────────────────────────────────────────────────────────

# curl 封装：gh_api <path> [额外 curl 参数...]
gh_api() {
  local path="$1"; shift
  local response http_code body
  response=$(curl -s \
    -w $'\n''%{http_code}' \
    -H "Authorization: token ${GITHUB_TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    ${@:+"$@"} \
    "${API}/${path}")
  http_code=$(printf '%s' "$response" | tail -1)
  body=$(printf '%s' "$response" | sed '$d')
  if [[ "$http_code" -lt 200 || "$http_code" -ge 300 ]]; then
    echo "❌  GitHub API 错误: HTTP $http_code  (${path})" >&2
    echo "   响应: $body" >&2
    return 1
  fi
  printf '%s' "$body"
}

# 从 JSON stdin 提取字段：json_get '.key.sub'
json_get() {
  python3 -c "import sys,json; d=json.load(sys.stdin); print(${1})"
}

# 安全构建 JSON（通过环境变量传值，避免特殊字符转义问题）
# 用法: JSON_KEY1=val1 JSON_KEY2=val2 json_obj key1 key2 ...
json_obj() {
  local keys=("$@")
  python3 - "${keys[@]}" <<'PY'
import sys, json, os
keys = sys.argv[1:]
print(json.dumps({k: os.environ.get('JSON_' + k.upper(), '') for k in keys}))
PY
}

# ─── Step 0: 获取默认分支 ───────────────────────────────────────────────────────
echo "🔍  获取 ${OWNER}/${REPO} 默认分支..."
DEFAULT_BRANCH=$(gh_api "repos/${OWNER}/${REPO}" | json_get "d['default_branch']")
echo "    默认分支: ${DEFAULT_BRANCH}"

# ─── Step 1: 获取基准 SHA ──────────────────────────────────────────────────────
BASE_SHA=$(gh_api "repos/${OWNER}/${REPO}/git/ref/heads/${DEFAULT_BRANCH}" | json_get "d['object']['sha']")
echo "    基准 SHA: ${BASE_SHA:0:7}"

# ─── Step 2: 创建分支 ──────────────────────────────────────────────────────────
echo "🌿  创建分支: ${BRANCH}"
JSON_REF="refs/heads/${BRANCH}" JSON_SHA="${BASE_SHA}" \
  json_obj ref sha | gh_api "repos/${OWNER}/${REPO}/git/refs" -X POST -d @- > /dev/null

# ─── Step 3: 推送测试文件 ──────────────────────────────────────────────────────
echo "📄  推送测试文件: ${FILE_PATH}"

FILE_CONTENT="// Manual test file for @ai-reviewer resolve — safe to delete
// Created: $(date -u +%Y-%m-%dT%H:%M:%SZ)

// ⚠️ 问题 1: 未使用的变量（应该被删除或使用）
const unusedConfig = { timeout: 5000, retries: 3 }

// ⚠️ 问题 2: any 类型滥用（应该使用具体类型）
export function processData(input: any): any {
  return JSON.parse(input)
}

// ⚠️ 问题 3: 同步阻塞操作（应使用异步版本）
import { readFileSync } from 'fs'
export function loadConfig(path: string): object {
  const raw = readFileSync(path, 'utf8')
  return JSON.parse(raw)
}

// ⚠️ 问题 4: 密码硬编码（安全漏洞）
const DB_CONFIG = {
  host: 'localhost',
  password: 'super_secret_password_123'
}

export const greet = (name: string) => \`Hello, \${name}!\`
export const add = (a: number, b: number) => a + b
"

FILE_B64=$(printf '%s' "${FILE_CONTENT}" | base64 -w0)

HEAD_SHA=$(
  JSON_MESSAGE="test: add manual resolve-test demo file" \
  JSON_CONTENT="${FILE_B64}" \
  JSON_BRANCH="${BRANCH}" \
    json_obj message content branch \
  | gh_api "repos/${OWNER}/${REPO}/contents/${FILE_PATH}" -X PUT -d @- \
  | json_get "d['commit']['sha']"
)
echo "    提交: ${HEAD_SHA:0:7}"

# ─── Step 4: 创建 PR ───────────────────────────────────────────────────────────
echo "📬  创建 PR..."

PR_BODY="> ⚠️ 此 PR 由 \`setup-resolve-test.sh\` 自动创建，用于手动体验 resolve 命令，测试完成后可直接关闭。

## 测试步骤

1. 等待此 PR 上出现 Bot 的 review comments（脚本已自动添加）
2. 在 PR 的 **Conversation** 标签页发一条评论：
   \`\`\`
   @ai-reviewer resolve
   \`\`\`
3. 观察 GitHub Actions 是否触发，所有 review thread 是否被批量 resolve

## 预期结果
- Action 触发后打印 \`resolve: ok=N failed=0\`
- PR 上所有 🤖 标注的 review thread 变为 ✅ resolved 状态"

PR_DATA=$(
  JSON_TITLE="[TEST] resolve 命令手动体验 — 可安全关闭" \
  JSON_BODY="${PR_BODY}" \
  JSON_HEAD="${BRANCH}" \
  JSON_BASE="${DEFAULT_BRANCH}" \
    json_obj title body head base \
  | gh_api "repos/${OWNER}/${REPO}/pulls" -X POST -d @-
)

PR_NUMBER=$(echo "${PR_DATA}" | json_get "d['number']")
PR_URL=$(echo "${PR_DATA}"    | json_get "d['html_url']")
echo "    PR #${PR_NUMBER}: ${PR_URL}"

# ─── Step 5: 添加 Bot 风格的 review comments ───────────────────────────────────
echo "💬  添加 Bot review comments..."

add_comment() {
  local line="$1"
  local body="$2"
  JSON_BODY="${body}" \
  JSON_COMMIT_ID="${HEAD_SHA}" \
  JSON_PATH="${FILE_PATH}" \
  JSON_SIDE="RIGHT" \
    python3 - "${line}" <<'PY' \
  | gh_api "repos/${OWNER}/${REPO}/pulls/${PR_NUMBER}/comments" -X POST -d @- > /dev/null
import sys, json, os
line = int(sys.argv[1])
print(json.dumps({
  'body':      os.environ['JSON_BODY'],
  'commit_id': os.environ['JSON_COMMIT_ID'],
  'path':      os.environ['JSON_PATH'],
  'line':      line,
  'side':      os.environ['JSON_SIDE'],
}))
PY
  echo "    ✅ 第 ${line} 行: comment 已添加"
}

add_comment 5 "🤖 **[CodeSentinel]** \`unusedConfig\` 变量声明后从未使用。建议直接删除，或将其作为参数传入相关函数，避免 dead code 积累。

\`\`\`suggestion
// 已删除未使用的 unusedConfig
\`\`\`"

add_comment 9 "🤖 **[CodeSentinel]** 函数签名使用了 \`any\` 类型，会绕过 TypeScript 类型检查，掩盖潜在运行时错误。

建议明确输入输出类型，例如：
\`\`\`typescript
export function processData(input: string): unknown {
  return JSON.parse(input)
}
\`\`\`"

add_comment 15 "🤖 **[CodeSentinel]** \`readFileSync\` 是同步阻塞调用，在 I/O 密集场景中会阻塞事件循环，降低吞吐量。

建议改用异步版本：
\`\`\`typescript
import { readFile } from 'fs/promises'
export async function loadConfig(path: string): Promise<object> {
  const raw = await readFile(path, 'utf8')
  return JSON.parse(raw)
}
\`\`\`"

add_comment 21 "🤖 **[CodeSentinel]** ⚠️ **安全漏洞** — 密码硬编码在源码中，一旦代码库泄露即意味着凭据泄露。

建议改用环境变量：
\`\`\`typescript
const DB_CONFIG = {
  host: process.env.DB_HOST ?? 'localhost',
  password: process.env.DB_PASSWORD
}
\`\`\`

同时建议在 \`.env.example\` 中记录所需变量，配合 [dotenv](https://github.com/motdotla/dotenv) 管理本地开发配置。"

# ─── 完成 ──────────────────────────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════════════════════════"
echo "✅  环境搭建完成！"
echo ""
echo "  PR 地址 : ${PR_URL}"
echo "  分支    : ${BRANCH}"
echo "  文件    : ${FILE_PATH}"
echo ""
echo "  下一步:"
echo "  1. 打开 PR，确认 4 条 review comments 已出现"
echo "  2. 在 PR Conversation 页发评论: @ai-reviewer resolve"
echo "  3. 在 Actions 页观察 workflow 触发和输出"
echo "  4. 回到 PR 确认所有 review thread 已 resolve"
echo ""
echo "  清理（测试完成后）:"
echo "  curl -s -X PATCH -H 'Authorization: token \$GITHUB_TOKEN' \\"
echo "    '${API}/repos/${OWNER}/${REPO}/pulls/${PR_NUMBER}' -d '{\"state\":\"closed\"}'"
echo "  curl -s -X DELETE -H 'Authorization: token \$GITHUB_TOKEN' \\"
echo "    '${API}/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}'"
echo "══════════════════════════════════════════════════════════════════"
