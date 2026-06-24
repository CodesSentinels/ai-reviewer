#!/usr/bin/env bash
# test-bot-resolve-partial-failure.sh
#
# 流程:
#   1. 创建带有"坏代码"的 PR，触发机器人自动 review
#   2. 等待 codesentinel-review-bot 发出 review comments（真实 thread）
#   3. 取其中 1 条真实 thread ID + 构造 2 个假 thread ID
#   4. 对 3 个 thread 调用 resolveReviewThread mutation
#      → ok=1（真实 thread 成功）failed=2（假 ID 失败）
#   5. 打印 warning 格式，验证是否符合预期
#
# 用法:
#   ./scripts/test-bot-resolve-partial-failure.sh
#
# 依赖: curl, python3

set -euo pipefail

OWNER="CodesSentinels"
REPO="ai-reviewer-test"
BOT_LOGIN="codesentinel-review-bot"
API="https://api.github.com"
MAX_WAIT=300
POLL_INTERVAL=15

# ─── Token ────────────────────────────────────────────────────────────────────
SECRETS_FILE="$(dirname "$0")/../.secrets"
if [[ -z "${GITHUB_TOKEN:-}" && -f "${SECRETS_FILE}" ]]; then
  GITHUB_TOKEN=$(grep -E '^GITHUB_TOKEN=' "${SECRETS_FILE}" | head -1 | cut -d= -f2-)
fi
[[ -z "${GITHUB_TOKEN:-}" ]] && { echo "❌ 未找到 GITHUB_TOKEN" >&2; exit 1; }

# ─── 工具函数 ─────────────────────────────────────────────────────────────────
gh_api() {
  local path="$1"; shift
  local resp http body
  resp=$(curl -s -w $'\n''%{http_code}' \
    -H "Authorization: token ${GITHUB_TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    ${@:+"$@"} "${API}/${path}")
  http=$(printf '%s' "$resp" | tail -1)
  body=$(printf '%s' "$resp" | sed '$d')
  [[ "$http" -lt 200 || "$http" -ge 300 ]] && { echo "❌ HTTP $http (${path}): $body" >&2; return 1; }
  printf '%s' "$body"
}

gh_graphql() {
  curl -s -H "Authorization: token ${GITHUB_TOKEN}" \
    -H "Content-Type: application/json" \
    -X POST -d "$1" "https://api.github.com/graphql"
}

json_get() { python3 -c "import sys,json; d=json.load(sys.stdin); print(${1})"; }

# ─── Step 1: 创建分支 + 推送"坏代码"文件 ──────────────────────────────────────
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 1  创建测试分支和文件"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

DEFAULT_BRANCH=$(gh_api "repos/${OWNER}/${REPO}" | json_get "d['default_branch']")
BASE_SHA=$(gh_api "repos/${OWNER}/${REPO}/git/ref/heads/${DEFAULT_BRANCH}" | json_get "d['object']['sha']")

BRANCH="test/bot-partial-failure-$(date +%s)"
python3 -c "import json,os; print(json.dumps({'ref':'refs/heads/${BRANCH}','sha':'${BASE_SHA}'}))" \
  | gh_api "repos/${OWNER}/${REPO}/git/refs" -X POST -d @- > /dev/null
echo "  ✅ 分支: ${BRANCH}"

FILE_PATH="manual-tests/bot-partial-failure-$(date +%s).ts"
# 明显问题：any 类型、硬编码密码、同步阻塞、未使用变量，容易触发 bot review
FILE_B64=$(python3 -c "
import base64
code = '''// bot partial-failure test — safe to delete
const password = \"hardcoded_secret_123\"   // security issue
const unused = { timeout: 5000 }            // unused variable

export function process(data: any): any {   // any type
  return JSON.parse(data)
}

import { readFileSync } from \"fs\"
export function load(p: string) {           // sync blocking
  return JSON.parse(readFileSync(p, \"utf8\"))
}
'''
print(base64.b64encode(code.encode()).decode())
")

HEAD_SHA=$(
  python3 -c "import json,os; print(json.dumps({
    'message':'test: add bot-partial-failure demo file',
    'content':'${FILE_B64}',
    'branch':'${BRANCH}'
  }))" \
  | gh_api "repos/${OWNER}/${REPO}/contents/${FILE_PATH}" -X PUT -d @- \
  | json_get "d['commit']['sha']"
)
echo "  ✅ 文件: ${FILE_PATH}  commit: ${HEAD_SHA:0:7}"

# ─── Step 2: 创建 PR ──────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 2  创建 PR，等待机器人自动 review"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

PR_DATA=$(python3 -c "import json; print(json.dumps({
  'title':'[TEST] bot resolve partial-failure — safe to close',
  'body':'> 由 test-bot-resolve-partial-failure.sh 创建，测试完成后自动关闭。',
  'head':'${BRANCH}',
  'base':'${DEFAULT_BRANCH}'
}))" | gh_api "repos/${OWNER}/${REPO}/pulls" -X POST -d @-)

PR_NUMBER=$(echo "${PR_DATA}" | json_get "d['number']")
PR_URL=$(echo "${PR_DATA}"    | json_get "d['html_url']")
echo "  ✅ PR #${PR_NUMBER}: ${PR_URL}"
echo "  ⏳ 等待机器人 review（最多 ${MAX_WAIT}s）..."

# ─── Step 3: 轮询等待 bot review comments 出现 ────────────────────────────────
ELAPSED=0
BOT_THREADS_JSON=""

while [[ "${ELAPSED}" -lt "${MAX_WAIT}" ]]; do
  sleep "${POLL_INTERVAL}"
  ELAPSED=$((ELAPSED + POLL_INTERVAL))

  THREADS_QUERY=$(python3 -c "
import json
q = '''query {
  repository(owner: \"${OWNER}\", name: \"${REPO}\") {
    pullRequest(number: ${PR_NUMBER}) {
      reviewThreads(first: 20) {
        nodes {
          id isResolved path line
          comments(first: 1) { nodes { author { login } body } }
        }
      }
    }
  }
}'''
print(json.dumps({'query': q}))
")

  THREADS_RESP_FILE=$(mktemp)
  gh_graphql "${THREADS_QUERY}" > "${THREADS_RESP_FILE}"

  BOT_COUNT=$(python3 - "${BOT_LOGIN}" <<PY
import sys, json
bot = sys.argv[1].lower().rstrip('[bot]')
with open('${THREADS_RESP_FILE}') as f:
    data = json.load(f)
nodes = data['data']['repository']['pullRequest']['reviewThreads']['nodes']
count = 0
for n in nodes:
    if n.get('isResolved'):
        continue
    c = n.get('comments', {}).get('nodes', [])
    if not c:
        continue
    author = (c[0].get('author') or {}).get('login', '').lower().rstrip('[bot]')
    if author == bot:
        count += 1
print(count)
PY
)

  echo "  ${ELAPSED}s — 机器人 thread 数: ${BOT_COUNT}"

  if [[ "${BOT_COUNT}" -ge 1 ]]; then
    echo "  ✅ 机器人已发出 ${BOT_COUNT} 条 thread"
    BOT_THREADS_JSON=$(cat "${THREADS_RESP_FILE}")
    break
  fi
done

if [[ -z "${BOT_THREADS_JSON}" ]]; then
  echo "❌ 机器人未在 ${MAX_WAIT}s 内发出 review，清理后退出" >&2
  curl -s -X PATCH -H "Authorization: token ${GITHUB_TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    -d '{"state":"closed"}' \
    "${API}/repos/${OWNER}/${REPO}/pulls/${PR_NUMBER}" > /dev/null
  curl -s -X DELETE -H "Authorization: token ${GITHUB_TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    "${API}/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}" > /dev/null
  exit 1
fi

# ─── Step 4: 取第 1 条真实 bot thread，构造 2 个假 thread ──────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 4  构建 resolve 列表（1 真实 + 2 假）"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

THREAD_INFO_FILE=$(mktemp)
printf '%s' "${BOT_THREADS_JSON}" > "${THREAD_INFO_FILE}"

# 取第 1 条真实 bot thread（未 resolved）
read -r REAL_ID REAL_PATH REAL_LINE < <(python3 - "${BOT_LOGIN}" <<PY
import sys, json
bot = sys.argv[1].lower().rstrip('[bot]')
with open('${THREAD_INFO_FILE}') as f:
    data = json.load(f)
nodes = data['data']['repository']['pullRequest']['reviewThreads']['nodes']
for n in nodes:
    if n.get('isResolved'):
        continue
    c = n.get('comments', {}).get('nodes', [])
    if not c:
        continue
    author = (c[0].get('author') or {}).get('login', '').lower().rstrip('[bot]')
    if author == bot:
        print(n['id'], n['path'], n['line'])
        break
PY
)

echo "  真实 thread: ${REAL_PATH}:${REAL_LINE}  (${REAL_ID:0:20}...)"
echo "  假 thread A: ${FILE_PATH}:50  (PRRT_pf_bot_fake_001)"
echo "  假 thread B: ${FILE_PATH}:99  (PRRT_pf_bot_fake_002)"
echo ""
echo "  → resolve 3 条，预期 ok=1 failed=2"

# ─── Step 5: 逐一调用 resolveReviewThread ─────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 5  批量 resolve"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

declare -a IDS=("${REAL_ID}" "PRRT_pf_bot_fake_001" "PRRT_pf_bot_fake_002")
declare -a PATHS=("${REAL_PATH}" "${FILE_PATH}" "${FILE_PATH}")
declare -a LINES=("${REAL_LINE}" "50" "99")

OK=0; FAILED=0
declare -a FAILED_LABELS=()
declare -a FAILED_ERRORS=()

for i in "${!IDS[@]}"; do
  TID="${IDS[$i]}"
  TPATH="${PATHS[$i]}"
  TLINE="${LINES[$i]}"

  MUTATION=$(python3 -c "
import json
print(json.dumps({'query':'mutation { resolveReviewThread(input: { threadId: \"${TID}\" }) { thread { isResolved } } }'}))
")
  RESP=$(gh_graphql "${MUTATION}")
  ERR=$(echo "${RESP}" | python3 -c "
import sys,json
d=json.load(sys.stdin)
errs=d.get('errors',[])
print(errs[0]['message'] if errs else '')
" 2>/dev/null || true)

  if [[ -z "${ERR}" ]]; then
    echo "  ✅ ${TPATH}:${TLINE}"
    OK=$((OK+1))
  else
    echo "  ❌ ${TPATH}:${TLINE}  →  ${ERR}"
    FAILED=$((FAILED+1))
    FAILED_LABELS+=("${TPATH}:${TLINE}")
    FAILED_ERRORS+=("${ERR}")
  fi
done

# ─── Step 6: 输出 warning 格式 ────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 6  batchResolve warning 输出格式验证"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  ok=${OK}  failed=${FAILED}  total=${#IDS[@]}"
echo ""

if [[ "${FAILED}" -gt 0 ]]; then
  echo "  ┌─ warning ─────────────────────────────────────────────"
  echo "  │ batchResolve: failed to resolve ${FAILED}/${#IDS[@]} thread(s):"
  for i in "${!FAILED_LABELS[@]}"; do
    echo "  │   • ${FAILED_LABELS[$i]}: ${FAILED_ERRORS[$i]}"
  done
  echo "  └───────────────────────────────────────────────────────"
fi

# ─── 清理 ────────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "清理测试环境"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

curl -s -X PATCH -H "Authorization: token ${GITHUB_TOKEN}" \
  -H "Accept: application/vnd.github+json" \
  -d '{"state":"closed"}' \
  "${API}/repos/${OWNER}/${REPO}/pulls/${PR_NUMBER}" > /dev/null
echo "  ✅ PR #${PR_NUMBER} 已关闭"

curl -s -X DELETE -H "Authorization: token ${GITHUB_TOKEN}" \
  -H "Accept: application/vnd.github+json" \
  "${API}/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}" > /dev/null
echo "  ✅ 分支 ${BRANCH} 已删除"

# ─── 结论 ────────────────────────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════════════════"
if [[ "${OK}" -eq 1 && "${FAILED}" -eq 2 ]]; then
  echo "✅  验证通过  ok=1 failed=2，warning 格式符合预期"
else
  echo "⚠️  结果与预期不符（预期 ok=1 failed=2，实际 ok=${OK} failed=${FAILED}）"
fi
echo "══════════════════════════════════════════════════════════"
