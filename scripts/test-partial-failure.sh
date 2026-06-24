#!/usr/bin/env bash
# test-partial-failure.sh — 手动验证 batchResolve 部分失败的 warning 输出格式
#
# 流程:
#   1. 创建分支 → 推文件 → 建 PR → 以当前 Token 身份添加 3 条 review comment
#   2. 通过 GraphQL 获取真实 thread ID（3 条）
#   3. 混入 2 个假 thread ID（PRRT_fake_*）
#   4. 对 5 个 thread 逐一调用 resolveReviewThread mutation
#   5. 汇总并打印结果（预期 ok=3 failed=2）验证 warning 格式
#
# 用法:
#   ./scripts/test-partial-failure.sh
#   GITHUB_TOKEN=<pat> ./scripts/test-partial-failure.sh
#
# 依赖: curl, python3

set -euo pipefail

# ─── 配置 ──────────────────────────────────────────────────────────────────────
OWNER="CodesSentinels"
REPO="ai-reviewer-test"
BRANCH="test/partial-failure-$(date +%s)"
FILE_PATH="manual-tests/partial-failure-$(date +%s).ts"
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

gh_graphql() {
  local query="$1"
  curl -s \
    -H "Authorization: token ${GITHUB_TOKEN}" \
    -H "Content-Type: application/json" \
    -X POST \
    -d "${query}" \
    "https://api.github.com/graphql"
}

json_get() {
  python3 -c "import sys,json; d=json.load(sys.stdin); print(${1})"
}

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

# ─── Step 1: 获取基准 SHA ──────────────────────────────────────────────────────
BASE_SHA=$(gh_api "repos/${OWNER}/${REPO}/git/ref/heads/${DEFAULT_BRANCH}" | json_get "d['object']['sha']")
echo "    默认分支: ${DEFAULT_BRANCH}  SHA: ${BASE_SHA:0:7}"

# ─── Step 2: 创建分支 ──────────────────────────────────────────────────────────
echo "🌿  创建分支: ${BRANCH}"
JSON_REF="refs/heads/${BRANCH}" JSON_SHA="${BASE_SHA}" \
  json_obj ref sha | gh_api "repos/${OWNER}/${REPO}/git/refs" -X POST -d @- > /dev/null

# ─── Step 3: 推送测试文件 ──────────────────────────────────────────────────────
echo "📄  推送测试文件: ${FILE_PATH}"
FILE_CONTENT="// Partial failure manual test — safe to delete
// Created: $(date -u +%Y-%m-%dT%H:%M:%SZ)

export const alpha   = (x: number) => x * 2        // line 4  ← comment A
export const beta    = (x: number) => x + 1        // line 5  ← comment B
export const gamma   = (x: number) => x ** 2       // line 6  ← comment C
"
FILE_B64=$(printf '%s' "${FILE_CONTENT}" | base64 -w0 2>/dev/null || printf '%s' "${FILE_CONTENT}" | base64)

HEAD_SHA=$(
  JSON_MESSAGE="test: add partial-failure demo file" \
  JSON_CONTENT="${FILE_B64}" \
  JSON_BRANCH="${BRANCH}" \
    json_obj message content branch \
  | gh_api "repos/${OWNER}/${REPO}/contents/${FILE_PATH}" -X PUT -d @- \
  | json_get "d['commit']['sha']"
)
echo "    提交: ${HEAD_SHA:0:7}"

# ─── Step 4: 创建 PR ───────────────────────────────────────────────────────────
echo "📬  创建 PR..."
PR_DATA=$(
  JSON_TITLE="[TEST] batchResolve 部分失败手动测试 — 可安全关闭" \
  JSON_BODY="> 此 PR 由 test-partial-failure.sh 自动创建，测试完成后关闭即可。" \
  JSON_HEAD="${BRANCH}" \
  JSON_BASE="${DEFAULT_BRANCH}" \
    json_obj title body head base \
  | gh_api "repos/${OWNER}/${REPO}/pulls" -X POST -d @-
)
PR_NUMBER=$(echo "${PR_DATA}" | json_get "d['number']")
PR_URL=$(echo "${PR_DATA}"    | json_get "d['html_url']")
echo "    PR #${PR_NUMBER}: ${PR_URL}"

# ─── Step 5: 添加 3 条 review comment ─────────────────────────────────────────
echo "💬  添加 3 条 Bot review comments..."

add_comment() {
  local line="$1" body="$2"
  JSON_BODY="${body}" \
  JSON_COMMIT_ID="${HEAD_SHA}" \
  JSON_PATH="${FILE_PATH}" \
  JSON_SIDE="RIGHT" \
    python3 - "${line}" <<'PY' \
  | gh_api "repos/${OWNER}/${REPO}/pulls/${PR_NUMBER}/comments" -X POST -d @- \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['id'])"
import sys, json, os
print(json.dumps({
  'body':      os.environ['JSON_BODY'],
  'commit_id': os.environ['JSON_COMMIT_ID'],
  'path':      os.environ['JSON_PATH'],
  'line':      int(sys.argv[1]),
  'side':      os.environ['JSON_SIDE'],
}))
PY
}

CID_A=$(add_comment 4 "🤖 **[CodeSentinel]** Comment A — alpha 函数可以内联，无需独立定义")
CID_B=$(add_comment 5 "🤖 **[CodeSentinel]** Comment B — beta 函数命名不够描述性，建议重命名")
CID_C=$(add_comment 6 "🤖 **[CodeSentinel]** Comment C — gamma 使用 \`**\` 运算符，兼容性注意 ES2016+")
echo "    ✅ 已添加 comment A(id=${CID_A}) B(id=${CID_B}) C(id=${CID_C})"

# ─── Step 6: GraphQL 获取真实 thread ID ────────────────────────────────────────
echo ""
echo "🔗  通过 GraphQL 获取真实 thread IDs..."
REPO_ID_QUERY=$(python3 -c "
import json
q = '''query {
  repository(owner: \"${OWNER}\", name: \"${REPO}\") {
    pullRequest(number: ${PR_NUMBER}) {
      reviewThreads(first: 10) {
        nodes { id path line comments(first:1) { nodes { body } } }
      }
    }
  }
}'''
print(json.dumps({'query': q}))
")

THREADS_JSON=$(gh_graphql "${REPO_ID_QUERY}")

# 解析真实 thread IDs、path、line、body
python3 - <<PY
import json, sys

data = json.loads('''${THREADS_JSON}''')
nodes = data['data']['repository']['pullRequest']['reviewThreads']['nodes']

print(f"  找到 {len(nodes)} 条真实 thread：")
for n in nodes:
    body_snippet = n['comments']['nodes'][0]['body'][:50] if n['comments']['nodes'] else ''
    print(f"    {n['id']}  {n['path']}:{n['line']}  \"{body_snippet}\"")
PY

# 提取 thread IDs 数组（兼容 bash 3.x）
REAL_IDS=()
while IFS= read -r line; do REAL_IDS+=("$line"); done < <(python3 -c "
import json
data = json.loads('''${THREADS_JSON}''')
for n in data['data']['repository']['pullRequest']['reviewThreads']['nodes']:
    print(n['id'])
")

REAL_PATHS=()
while IFS= read -r line; do REAL_PATHS+=("$line"); done < <(python3 -c "
import json
data = json.loads('''${THREADS_JSON}''')
for n in data['data']['repository']['pullRequest']['reviewThreads']['nodes']:
    print(n['path'])
")

REAL_LINES=()
while IFS= read -r line; do REAL_LINES+=("$line"); done < <(python3 -c "
import json
data = json.loads('''${THREADS_JSON}''')
for n in data['data']['repository']['pullRequest']['reviewThreads']['nodes']:
    print(n['line'])
")

# ─── Step 7: 构建混合 thread 列表（真实 + 假）────────────────────────────────────
echo ""
echo "🧪  构建混合 thread 列表（${#REAL_IDS[@]} 条真实 + 2 条假 ID）..."

# 假 thread（无效 ID，resolve 必定失败）
FAKE_IDS=("PRRT_fake_partial_failure_001" "PRRT_fake_partial_failure_002")
FAKE_PATHS=("${FILE_PATH}" "${FILE_PATH}")
FAKE_LINES=("50" "99")
FAKE_BODIES=("🤖 [假 thread A] 不存在的审查意见" "🤖 [假 thread B] 不存在的审查意见")

ALL_IDS=("${REAL_IDS[@]}" "${FAKE_IDS[@]}")
ALL_PATHS=("${REAL_PATHS[@]}" "${FAKE_PATHS[@]}")
ALL_LINES=("${REAL_LINES[@]}" "${FAKE_LINES[@]}")
ALL_BODIES=("${FILE_PATH}:4 Comment A" "${FILE_PATH}:5 Comment B" "${FILE_PATH}:6 Comment C" "${FAKE_BODIES[@]}")

echo "    共 ${#ALL_IDS[@]} 条 thread（预期 ok=3 failed=2）"

# ─── Step 8: 逐一调用 resolveReviewThread mutation ─────────────────────────────
echo ""
echo "⚙️   开始批量 resolve..."
echo "──────────────────────────────────────────────────────────"

OK=0
FAILED=0
declare -a FAILED_LABELS=()
declare -a FAILED_ERRORS=()

for i in "${!ALL_IDS[@]}"; do
  THREAD_ID="${ALL_IDS[$i]}"
  PATH_VAL="${ALL_PATHS[$i]}"
  LINE_VAL="${ALL_LINES[$i]}"

  MUTATION=$(python3 -c "
import json
m = '''mutation { resolveReviewThread(input: { threadId: \"${THREAD_ID}\" }) { thread { isResolved } } }'''
print(json.dumps({'query': m}))
")

  RESP=$(gh_graphql "${MUTATION}")
  ERRORS=$(echo "${RESP}" | python3 -c "
import sys,json
d=json.load(sys.stdin)
errs = d.get('errors', [])
if errs:
    print(errs[0].get('message','unknown error'))
" 2>/dev/null || true)

  if [[ -z "${ERRORS}" ]]; then
    echo "  ✅ ${PATH_VAL}:${LINE_VAL}"
    OK=$((OK + 1))
  else
    LABEL="${PATH_VAL}:${LINE_VAL}"
    echo "  ❌ ${LABEL}  →  ${ERRORS}"
    FAILED=$((FAILED + 1))
    FAILED_LABELS+=("${LABEL}")
    FAILED_ERRORS+=("${ERRORS}")
  fi
done

# ─── Step 9: 汇总输出（模拟 batchResolve warning 格式）────────────────────────────
echo "──────────────────────────────────────────────────────────"
echo ""
echo "📊  结果汇总: ok=${OK}  failed=${FAILED}  total=${#ALL_IDS[@]}"
echo ""

if [[ "${FAILED}" -gt 0 ]]; then
  echo "⚠️  batchResolve warning 输出（模拟）:"
  echo "   batchResolve: failed to resolve ${FAILED}/${#ALL_IDS[@]} thread(s):"
  for i in "${!FAILED_LABELS[@]}"; do
    echo "     • ${FAILED_LABELS[$i]}: ${FAILED_ERRORS[$i]}"
  done
fi

# ─── 清理 ──────────────────────────────────────────────────────────────────────
echo ""
echo "🧹  清理测试环境..."
curl -s -X PATCH \
  -H "Authorization: token ${GITHUB_TOKEN}" \
  -H "Accept: application/vnd.github+json" \
  -d '{"state":"closed"}' \
  "${API}/repos/${OWNER}/${REPO}/pulls/${PR_NUMBER}" > /dev/null
echo "    ✅ PR #${PR_NUMBER} 已关闭"

curl -s -X DELETE \
  -H "Authorization: token ${GITHUB_TOKEN}" \
  -H "Accept: application/vnd.github+json" \
  "${API}/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}" > /dev/null
echo "    ✅ 分支 ${BRANCH} 已删除"

echo ""
echo "══════════════════════════════════════════════════════════════════"
if [[ "${OK}" -eq 3 && "${FAILED}" -eq 2 ]]; then
  echo "✅  测试通过！部分失败场景验证成功（ok=3 failed=2）"
else
  echo "⚠️  结果与预期不符（预期 ok=3 failed=2，实际 ok=${OK} failed=${FAILED}）"
fi
echo "══════════════════════════════════════════════════════════════════"
