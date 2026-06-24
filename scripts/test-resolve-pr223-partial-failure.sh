#!/usr/bin/env bash
# test-resolve-pr223-partial-failure.sh — 针对 PR #223 验证 resolve 部分失败场景
#
# 目标 PR: https://github.com/CodesSentinels/ai-reviewer-test/pull/223
#
# 流程:
#   1. 获取 PR #223 的 head commit SHA 和变更文件
#   2. 在已有文件上添加 3 条真实 review comments（自动创建 thread）
#   3. GraphQL 查询刚创建的 thread IDs
#   4. 混入 2 个假 thread ID（PRRT_fake_*）
#   5. 对 5 个 thread 逐一调用 resolveReviewThread mutation
#   6. 输出结果：预期 ok=3 failed=2，验证 warning 格式
#
# 用法:
#   ./scripts/test-resolve-pr223-partial-failure.sh
#   GITHUB_TOKEN=<pat> ./scripts/test-resolve-pr223-partial-failure.sh
#
# 依赖: curl, python3

set -euo pipefail

# ─── 配置 ──────────────────────────────────────────────────────────────────────
OWNER="CodesSentinels"
REPO="ai-reviewer-test"
PR_NUMBER=223
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

# ─── Step 1: 获取 PR #223 信息 ─────────────────────────────────────────────────
echo "🔍  获取 PR #${PR_NUMBER} 信息..."
PR_DATA=$(gh_api "repos/${OWNER}/${REPO}/pulls/${PR_NUMBER}")
HEAD_SHA=$(echo "${PR_DATA}" | json_get "d['head']['sha']")
PR_STATE=$(echo "${PR_DATA}" | json_get "d['state']")

if [[ "${PR_STATE}" != "open" ]]; then
  echo "❌  PR #${PR_NUMBER} 状态为 '${PR_STATE}'，需要 open 状态才能添加 review comments。" >&2
  exit 1
fi
echo "    PR #${PR_NUMBER} 状态: ${PR_STATE}  HEAD: ${HEAD_SHA:0:7}"

# ─── Step 2: 获取变更文件（取第一个用于添加 comments）─────────────────────────
FILES_JSON=$(gh_api "repos/${OWNER}/${REPO}/pulls/${PR_NUMBER}/files")
FILE_PATH=$(echo "${FILES_JSON}" | python3 -c "
import sys, json
files = json.load(sys.stdin)
if not files:
    raise SystemExit('❌ PR 没有变更文件')
print(files[0]['filename'])
")
echo "    目标文件: ${FILE_PATH}"

# ─── Step 3: 添加 3 条真实 review comments ────────────────────────────────────
echo ""
echo "💬  在 ${FILE_PATH} 上添加 3 条 review comments..."

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

CID_A=$(add_comment 4 "🤖 **[CodeSentinel]** [partial-failure-test A] alpha 函数可以内联，无需独立定义")
echo "    ✅ 第 4 行 comment A (id=${CID_A})"

CID_B=$(add_comment 5 "🤖 **[CodeSentinel]** [partial-failure-test B] beta 函数命名不够描述性，建议重命名")
echo "    ✅ 第 5 行 comment B (id=${CID_B})"

CID_C=$(add_comment 6 "🤖 **[CodeSentinel]** [partial-failure-test C] gamma 使用 \`**\` 运算符，需注意 ES2016+ 兼容性")
echo "    ✅ 第 6 行 comment C (id=${CID_C})"

# ─── Step 4: GraphQL 查询新建 thread IDs ──────────────────────────────────────
echo ""
echo "🔗  通过 GraphQL 查询 PR thread IDs（等 1s 让 GitHub 索引同步）..."
sleep 1

THREADS_QUERY=$(python3 -c "
import json
q = 'query { repository(owner: \"${OWNER}\", name: \"${REPO}\") { pullRequest(number: ${PR_NUMBER}) { reviewThreads(first: 50) { nodes { id isResolved path line comments(first: 1) { nodes { databaseId } } } } } } }'
print(json.dumps({'query': q}))
")

THREADS_JSON=$(gh_graphql "${THREADS_QUERY}")

# 用 databaseId 匹配 REST API 返回的数字 comment ID
REAL_IDS=()
REAL_PATHS=()
REAL_LINES=()

while IFS='|' read -r tid tpath tline; do
  REAL_IDS+=("$tid")
  REAL_PATHS+=("$tpath")
  REAL_LINES+=("$tline")
done < <(python3 -c "
import sys, json

data = json.loads('''${THREADS_JSON}''')
target_db_ids = {${CID_A}, ${CID_B}, ${CID_C}}

nodes = data['data']['repository']['pullRequest']['reviewThreads']['nodes']
for n in nodes:
    if n.get('isResolved'):
        continue
    comments = n.get('comments', {}).get('nodes', [])
    if not comments:
        continue
    db_id = comments[0].get('databaseId')
    if db_id in target_db_ids:
        print('{id}|{path}|{line}'.format(**n))
")

echo ""
echo "  找到 ${#REAL_IDS[@]} 条真实 thread："
for i in "${!REAL_IDS[@]}"; do
  echo "    [${i}] ${REAL_IDS[$i]}  ${REAL_PATHS[$i]}:${REAL_LINES[$i]}"
done

if [[ "${#REAL_IDS[@]}" -ne 3 ]]; then
  echo "⚠️  预期找到 3 条 thread，实际 ${#REAL_IDS[@]} 条，继续测试但结果可能与预期不符。"
fi

# ─── Step 5: 混入假 thread ID ─────────────────────────────────────────────────
echo ""
echo "🧪  混入 2 个假 thread ID..."

FAKE_IDS=("PRRT_fake_resolve_fail_001" "PRRT_fake_resolve_fail_002")
FAKE_PATHS=("${FILE_PATH}" "${FILE_PATH}")
FAKE_LINES=("50" "99")

ALL_IDS=("${REAL_IDS[@]+"${REAL_IDS[@]}"}" "${FAKE_IDS[@]}")
ALL_PATHS=("${REAL_PATHS[@]+"${REAL_PATHS[@]}"}" "${FAKE_PATHS[@]}")
ALL_LINES=("${REAL_LINES[@]+"${REAL_LINES[@]}"}" "${FAKE_LINES[@]}")

echo "    共 ${#ALL_IDS[@]} 条 thread（预期 ok=${#REAL_IDS[@]} failed=2）"

# ─── Step 6: 逐一调用 resolveReviewThread ─────────────────────────────────────
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
m = 'mutation { resolveReviewThread(input: { threadId: \"${THREAD_ID}\" }) { thread { isResolved } } }'
print(json.dumps({'query': m}))
")

  RESP=$(gh_graphql "${MUTATION}")
  ERRORS=$(echo "${RESP}" | python3 -c "
import sys, json
d = json.load(sys.stdin)
errs = d.get('errors', [])
if errs:
    print(errs[0].get('message', 'unknown error'))
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

# ─── Step 7: 汇总输出（对照 batchResolve warning 格式）──────────────────────────
echo "──────────────────────────────────────────────────────────"
echo ""
echo "📊  结果汇总: ok=${OK}  failed=${FAILED}  total=${#ALL_IDS[@]}"
echo ""

REAL_COUNT=${#REAL_IDS[@]}
EXPECTED_OK=${REAL_COUNT}
EXPECTED_FAILED=2

if [[ "${FAILED}" -gt 0 ]]; then
  echo "⚠️  batchResolve warning 输出（模拟）:"
  echo "   batchResolve: failed to resolve ${FAILED}/${#ALL_IDS[@]} thread(s):"
  for i in "${!FAILED_LABELS[@]}"; do
    echo "     • ${FAILED_LABELS[$i]}: ${FAILED_ERRORS[$i]}"
  done
  echo ""
fi

echo "══════════════════════════════════════════════════════════════════"
if [[ "${OK}" -eq "${EXPECTED_OK}" && "${FAILED}" -eq "${EXPECTED_FAILED}" ]]; then
  echo "✅  测试通过！部分失败场景验证成功（ok=${OK} failed=${FAILED}）"
else
  echo "⚠️  结果与预期不符（预期 ok=${EXPECTED_OK} failed=${EXPECTED_FAILED}，实际 ok=${OK} failed=${FAILED}）"
fi
echo "══════════════════════════════════════════════════════════════════"
echo ""
echo "  PR: https://github.com/${OWNER}/${REPO}/pull/${PR_NUMBER}"
echo "  已 resolve 的 thread 会在 PR 上显示为已解决状态（可刷新页面确认）"
