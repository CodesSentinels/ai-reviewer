#!/usr/bin/env bash
# test-e2e-resolve-partial-failure.sh
#
# 端到端验证 resolve 部分失败的机器人回复格式
#
# 前提：测试 repo 的 workflow 已配置 debug_resolve_inject_failures: "2"
#
# 流程:
#   1. 创建含"坏代码"的 PR，触发机器人自动 review（产生真实 thread）
#   2. 等待机器人发出 review comments
#   3. 发出 "@ai-reviewer resolve" 触发 Action
#   4. 等待 Action 完成
#   5. 拉取 PR 上机器人的回复评论，验证部分失败格式
#   6. 自动清理

set -euo pipefail

OWNER="CodesSentinels"
REPO="ai-reviewer-test"
BOT_LOGIN="codesentinel-review-bot"
API="https://api.github.com"
MAX_WAIT_REVIEW=300
MAX_WAIT_ACTION=300
POLL=15

SECRETS_FILE="$(dirname "$0")/../.secrets"
if [[ -z "${GITHUB_TOKEN:-}" && -f "${SECRETS_FILE}" ]]; then
  GITHUB_TOKEN=$(grep -E '^GITHUB_TOKEN=' "${SECRETS_FILE}" | head -1 | cut -d= -f2-)
fi
[[ -z "${GITHUB_TOKEN:-}" ]] && { echo "❌ 未找到 GITHUB_TOKEN" >&2; exit 1; }

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
  [[ "$http" -lt 200 || "$http" -ge 300 ]] && { echo "❌ HTTP $http: $body" >&2; return 1; }
  printf '%s' "$body"
}

gh_graphql() {
  curl -s -H "Authorization: token ${GITHUB_TOKEN}" \
    -H "Content-Type: application/json" \
    -X POST -d "$1" "https://api.github.com/graphql"
}

json_get() { python3 -c "import sys,json; d=json.load(sys.stdin); print(${1})"; }

cleanup() {
  local pr="$1" branch="$2"
  echo ""
  echo "🧹  清理..."
  curl -s -X PATCH -H "Authorization: token ${GITHUB_TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    -d '{"state":"closed"}' "${API}/repos/${OWNER}/${REPO}/pulls/${pr}" > /dev/null \
    && echo "    PR #${pr} 已关闭"
  curl -s -X DELETE -H "Authorization: token ${GITHUB_TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    "${API}/repos/${OWNER}/${REPO}/git/refs/heads/${branch}" > /dev/null \
    && echo "    分支 ${branch} 已删除"
}

# ── Step 1: 创建分支 + 推送坏代码 ─────────────────────────────────────────────
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 1  创建测试 PR"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

DEFAULT_BRANCH=$(gh_api "repos/${OWNER}/${REPO}" | json_get "d['default_branch']")
BASE_SHA=$(gh_api "repos/${OWNER}/${REPO}/git/ref/heads/${DEFAULT_BRANCH}" | json_get "d['object']['sha']")

BRANCH="test/e2e-partial-failure-$(date +%s)"
python3 -c "import json; print(json.dumps({'ref':'refs/heads/${BRANCH}','sha':'${BASE_SHA}'}))" \
  | gh_api "repos/${OWNER}/${REPO}/git/refs" -X POST -d @- > /dev/null

FILE_PATH="manual-tests/e2e-partial-failure-$(date +%s).ts"
FILE_B64=$(python3 -c "
import base64
code = '''// e2e partial-failure test — safe to delete
const password = \"hardcoded_secret_123\"
const unused = { timeout: 5000 }

export function process(data: any): any {
  return JSON.parse(data)
}

import { readFileSync } from \"fs\"
export function load(p: string) {
  return JSON.parse(readFileSync(p, \"utf8\"))
}
'''
print(base64.b64encode(code.encode()).decode())
")

HEAD_SHA=$(
  python3 -c "import json; print(json.dumps({
    'message':'test: add e2e partial-failure demo file',
    'content':'${FILE_B64}',
    'branch':'${BRANCH}'
  }))" | gh_api "repos/${OWNER}/${REPO}/contents/${FILE_PATH}" -X PUT -d @- \
  | json_get "d['commit']['sha']"
)

PR_DATA=$(python3 -c "import json; print(json.dumps({
  'title':'[TEST] e2e resolve partial-failure — safe to close',
  'body':'> 由 test-e2e-resolve-partial-failure.sh 创建，测试完成后自动关闭。',
  'head':'${BRANCH}',
  'base':'${DEFAULT_BRANCH}'
}))" | gh_api "repos/${OWNER}/${REPO}/pulls" -X POST -d @-)

PR_NUMBER=$(echo "${PR_DATA}" | json_get "d['number']")
PR_URL=$(echo "${PR_DATA}" | json_get "d['html_url']")
echo "  ✅ PR #${PR_NUMBER}: ${PR_URL}"

# ── Step 2: 等待 bot review ───────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 2  等待机器人 review（最多 ${MAX_WAIT_REVIEW}s）"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

ELAPSED=0
BOT_THREAD_COUNT=0
THREADS_FILE=$(mktemp)

while [[ "${ELAPSED}" -lt "${MAX_WAIT_REVIEW}" ]]; do
  sleep "${POLL}"
  ELAPSED=$((ELAPSED + POLL))

  QUERY=$(python3 -c "
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
  gh_graphql "${QUERY}" > "${THREADS_FILE}"
  # 若 GraphQL 返回 errors，跳过本次轮询
  python3 -c "import json; d=json.load(open('${THREADS_FILE}')); assert 'data' in d" 2>/dev/null || { echo "  ${ELAPSED}s — GraphQL 尚未就绪，继续等待..."; continue; }

  BOT_THREAD_COUNT=$(python3 - "${BOT_LOGIN}" <<PY
import sys, json
bot = sys.argv[1].lower().rstrip('[bot]')
with open('${THREADS_FILE}') as f:
    data = json.load(f)
nodes = data['data']['repository']['pullRequest']['reviewThreads']['nodes']
count = sum(
    1 for n in nodes
    if not n.get('isResolved')
    and n.get('comments', {}).get('nodes')
    and (n['comments']['nodes'][0].get('author') or {}).get('login', '').lower().rstrip('[bot]') == bot
)
print(count)
PY
)
  echo "  ${ELAPSED}s — 机器人 thread: ${BOT_THREAD_COUNT}"
  [[ "${BOT_THREAD_COUNT}" -ge 1 ]] && break
done

if [[ "${BOT_THREAD_COUNT}" -eq 0 ]]; then
  echo "❌ 机器人未在 ${MAX_WAIT_REVIEW}s 内发出 review" >&2
  cleanup "${PR_NUMBER}" "${BRANCH}"
  exit 1
fi
echo "  ✅ 机器人发出 ${BOT_THREAD_COUNT} 条 thread"

# ── Step 3: 触发 @ai-reviewer resolve ────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 3  触发 @ai-reviewer resolve"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

TRIGGER_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)
python3 -c "import json; print(json.dumps({'body':'@ai-reviewer resolve'}))" \
  | gh_api "repos/${OWNER}/${REPO}/issues/${PR_NUMBER}/comments" -X POST -d @- \
  | json_get "d['id']" > /dev/null
echo "  ✅ 评论已发出，时间: ${TRIGGER_TIME}"

# ── Step 4: 等待 Action 完成 ──────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 4  等待 Action 完成（最多 ${MAX_WAIT_ACTION}s）"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

ELAPSED=0; RUN_ID=""; RUN_CONCLUSION=""

while [[ "${ELAPSED}" -lt "${MAX_WAIT_ACTION}" ]]; do
  sleep "${POLL}"
  ELAPSED=$((ELAPSED + POLL))

  RUNS=$(gh_api "repos/${OWNER}/${REPO}/actions/runs?event=issue_comment&per_page=10" 2>/dev/null || true)
  RUN_ID=$(echo "${RUNS}" | python3 -c "
import sys, json
from datetime import datetime, timezone
data = json.load(sys.stdin)
trigger = datetime.fromisoformat('${TRIGGER_TIME}'.replace('Z','+00:00'))
for run in data.get('workflow_runs', []):
    created = datetime.fromisoformat(run['created_at'].replace('Z','+00:00'))
    if created >= trigger:
        print(run['id'])
        break
" 2>/dev/null || true)

  if [[ -n "${RUN_ID}" ]]; then
    INFO=$(gh_api "repos/${OWNER}/${REPO}/actions/runs/${RUN_ID}" 2>/dev/null || true)
    STATUS=$(echo "${INFO}" | json_get "d['status']" 2>/dev/null || echo "")
    RUN_CONCLUSION=$(echo "${INFO}" | json_get "d.get('conclusion') or ''" 2>/dev/null || echo "")
    echo "  ${ELAPSED}s — run #${RUN_ID} status=${STATUS} conclusion=${RUN_CONCLUSION:-pending}"
    [[ "${STATUS}" == "completed" ]] && break
  else
    echo "  ${ELAPSED}s — 等待 run 出现..."
  fi
done

# ── Step 5: 检查机器人回复评论 ────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 5  机器人回复内容（等 5s 让评论更新）"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
sleep 5

COMMENTS_FILE=$(mktemp)
gh_api "repos/${OWNER}/${REPO}/issues/${PR_NUMBER}/comments?per_page=50" > "${COMMENTS_FILE}"

python3 - "${BOT_LOGIN}" "${TRIGGER_TIME}" <<PY
import sys, json
from datetime import datetime, timezone
bot = sys.argv[1].lower().rstrip('[bot]')
trigger = datetime.fromisoformat(sys.argv[2].replace('Z','+00:00'))

with open('${COMMENTS_FILE}') as f:
    comments = json.load(f)

found = False
for c in comments:
    created = datetime.fromisoformat(c['created_at'].replace('Z', '+00:00'))
    if created < trigger:
        continue
    author = (c.get('user') or {}).get('login', '').lower().rstrip('[bot]')
    if author != bot:
        continue
    print(f"  作者: {c['user']['login']}")
    print(f"  时间: {c['created_at']}")
    print(f"  链接: {c['html_url']}")
    print(f"  内容:")
    for line in c['body'].splitlines():
        print(f"    {line}")
    found = True

if not found:
    print("  ⚠️  未找到机器人在触发后发出的回复评论")
PY

cleanup "${PR_NUMBER}" "${BRANCH}"

echo ""
echo "════════════════════════════════════════════════"
echo "PR: ${PR_URL}"
echo "════════════════════════════════════════════════"
