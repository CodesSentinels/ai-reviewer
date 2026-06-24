#!/usr/bin/env bash
# test-bot-resolve-pr223.sh — 通过真实 @ai-reviewer resolve 触发机器人，验证端到端 resolve 流程
#
# 目标 PR: https://github.com/CodesSentinels/ai-reviewer-test/pull/223
#
# 流程:
#   1. 查询 PR #223 上当前机器人（codesentinel-review-bot）的未解决 thread
#   2. 发出 "@ai-reviewer resolve" issue comment 触发 GitHub Action
#   3. 轮询 Actions API 等待对应 workflow run 完成
#   4. 拉取 job 日志，提取 resolve 相关输出行
#   5. 再次查询 thread 状态，对比前后变化
#
# 用法:
#   ./scripts/test-bot-resolve-pr223.sh
#   GITHUB_TOKEN=<pat> ./scripts/test-bot-resolve-pr223.sh
#
# 依赖: curl, python3

set -euo pipefail

# ─── 配置 ──────────────────────────────────────────────────────────────────────
OWNER="CodesSentinels"
REPO="ai-reviewer-test"
PR_NUMBER=223
BOT_LOGIN="codesentinel-review-bot"   # GraphQL 中不含 [bot] 后缀
API="https://api.github.com"
POLL_INTERVAL=10    # 秒
MAX_WAIT=300        # 最长等待 5 分钟

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
  curl -s \
    -H "Authorization: token ${GITHUB_TOKEN}" \
    -H "Content-Type: application/json" \
    -X POST -d "$1" \
    "https://api.github.com/graphql"
}

json_get() {
  python3 -c "import sys,json; d=json.load(sys.stdin); print(${1})"
}

# ─── Step 1: 查询 bot 未解决 thread（触发前状态）──────────────────────────────
echo "🔍  查询 PR #${PR_NUMBER} 上 ${BOT_LOGIN} 的未解决 thread..."

THREADS_QUERY=$(python3 -c "
import json
q = '''query {
  repository(owner: \"${OWNER}\", name: \"${REPO}\") {
    pullRequest(number: ${PR_NUMBER}) {
      reviewThreads(first: 50) {
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

BEFORE_JSON_FILE=$(mktemp)
gh_graphql "${THREADS_QUERY}" > "${BEFORE_JSON_FILE}"

BEFORE_UNRESOLVED=$(python3 - "${BOT_LOGIN}" <<PY
import sys, json
bot = sys.argv[1].lower().rstrip('[bot]')
with open('${BEFORE_JSON_FILE}') as f:
    data = json.load(f)
nodes = data['data']['repository']['pullRequest']['reviewThreads']['nodes']
count = 0
for n in nodes:
    if n.get('isResolved'):
        continue
    comments = n.get('comments', {}).get('nodes', [])
    if not comments:
        continue
    author = (comments[0].get('author') or {}).get('login', '')
    if author.lower().rstrip('[bot]') == bot:
        count += 1
        body = comments[0].get('body','')[:60].replace('\n',' ')
        print(f"  未解决: {n['path']}:{n['line']}  \"{body}\"")
print(f'__count__={count}')
PY
)

BOT_UNRESOLVED_COUNT=$(echo "${BEFORE_UNRESOLVED}" | grep '__count__=' | cut -d= -f2)
echo "${BEFORE_UNRESOLVED}" | grep -v '__count__'
echo "    机器人未解决 thread 数: ${BOT_UNRESOLVED_COUNT}"
echo ""

# ─── Step 2: 发出 @ai-reviewer resolve 触发 Action ────────────────────────────
echo "📣  在 PR #${PR_NUMBER} 上发出 @ai-reviewer resolve 评论..."

TRIGGER_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)

COMMENT_ID=$(python3 -c "
import json, os
print(json.dumps({'body': '@ai-reviewer resolve'}))
" | gh_api "repos/${OWNER}/${REPO}/issues/${PR_NUMBER}/comments" \
    -X POST -d @- | json_get "d['id']")

echo "    评论已创建 (id=${COMMENT_ID})，触发时间: ${TRIGGER_TIME}"
echo "    PR 地址: https://github.com/${OWNER}/${REPO}/pull/${PR_NUMBER}"
echo ""

# ─── Step 3: 轮询等待 workflow run 出现并完成 ─────────────────────────────────
echo "⏳  等待 GitHub Actions workflow 触发（最多 ${MAX_WAIT}s）..."

ELAPSED=0
RUN_ID=""
RUN_URL=""

while [[ "${ELAPSED}" -lt "${MAX_WAIT}" ]]; do
  sleep "${POLL_INTERVAL}"
  ELAPSED=$((ELAPSED + POLL_INTERVAL))

  RUNS_JSON=$(gh_api "repos/${OWNER}/${REPO}/actions/runs?event=issue_comment&per_page=10" 2>/dev/null || true)

  RUN_ID=$(echo "${RUNS_JSON}" | python3 -c "
import sys, json
from datetime import datetime, timezone

data = json.load(sys.stdin)
trigger = datetime.fromisoformat('${TRIGGER_TIME}'.replace('Z','+00:00'))

for run in data.get('workflow_runs', []):
    created = datetime.fromisoformat(run['created_at'].replace('Z','+00:00'))
    if created >= trigger and run.get('name') in ('Code Review', 'AI Code Review'):
        print(run['id'])
        break
" 2>/dev/null || true)

  if [[ -n "${RUN_ID}" ]]; then
    RUN_URL=$(echo "${RUNS_JSON}" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for run in data.get('workflow_runs', []):
    if str(run['id']) == '${RUN_ID}':
        print(run['html_url'])
        break
" 2>/dev/null || true)
    echo "    找到 run #${RUN_ID}: ${RUN_URL}"
    break
  fi

  echo "    ${ELAPSED}s — 等待 run 出现..."
done

if [[ -z "${RUN_ID}" ]]; then
  echo "❌  ${MAX_WAIT}s 内未找到对应 workflow run。可能原因：" >&2
  echo "   • workflow 未配置 issue_comment 触发" >&2
  echo "   • Action 被并发控制取消" >&2
  echo "   • 评论用户不在允许列表中" >&2
  exit 1
fi

# ─── Step 4: 等待 run 完成 ────────────────────────────────────────────────────
echo ""
echo "⏳  等待 run #${RUN_ID} 完成..."

ELAPSED=0
RUN_STATUS=""
RUN_CONCLUSION=""

while [[ "${ELAPSED}" -lt "${MAX_WAIT}" ]]; do
  sleep "${POLL_INTERVAL}"
  ELAPSED=$((ELAPSED + POLL_INTERVAL))

  RUN_INFO=$(gh_api "repos/${OWNER}/${REPO}/actions/runs/${RUN_ID}" 2>/dev/null || true)
  RUN_STATUS=$(echo "${RUN_INFO}" | json_get "d['status']" 2>/dev/null || echo "unknown")
  RUN_CONCLUSION=$(echo "${RUN_INFO}" | json_get "d.get('conclusion') or ''" 2>/dev/null || echo "")

  echo "    ${ELAPSED}s — status=${RUN_STATUS} conclusion=${RUN_CONCLUSION:-pending}"

  if [[ "${RUN_STATUS}" == "completed" ]]; then
    break
  fi
done

echo ""
if [[ "${RUN_STATUS}" != "completed" ]]; then
  echo "⚠️  run 未在 ${MAX_WAIT}s 内完成，当前状态: ${RUN_STATUS}"
  echo "   日志: ${RUN_URL}"
else
  echo "    run 完成: ${RUN_CONCLUSION}"
fi

# ─── Step 5: 获取 job 日志，提取 resolve 相关行 ────────────────────────────────
echo ""
echo "📋  提取 resolve 相关日志..."

JOBS_JSON=$(gh_api "repos/${OWNER}/${REPO}/actions/runs/${RUN_ID}/jobs" 2>/dev/null || true)
JOB_ID=$(echo "${JOBS_JSON}" | python3 -c "
import sys, json
data = json.load(sys.stdin)
jobs = data.get('jobs', [])
if jobs:
    print(jobs[0]['id'])
" 2>/dev/null || true)

if [[ -n "${JOB_ID}" ]]; then
  LOG_RAW=$(curl -sL \
    -H "Authorization: token ${GITHUB_TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    "${API}/repos/${OWNER}/${REPO}/actions/jobs/${JOB_ID}/logs" 2>/dev/null || true)

  echo "──────────────────────────────────────────────────────────"
  echo "${LOG_RAW}" | grep -iE \
    'resolve|batchResolve|thread|failed|warning|ok=|resolve_token|permission|not accessible' \
    | sed 's/^[0-9T:Z. ]*\(##\[.*\]\)\?//' \
    | head -40 || echo "  （未找到相关日志行）"
  echo "──────────────────────────────────────────────────────────"
else
  echo "  ⚠️  无法获取 job 日志"
fi

# ─── Step 6: 对比触发前后 thread 状态 ────────────────────────────────────────
echo ""
echo "🔍  查询触发后 thread 状态..."

AFTER_JSON_FILE=$(mktemp)
gh_graphql "${THREADS_QUERY}" > "${AFTER_JSON_FILE}"

AFTER_SUMMARY=$(python3 - "${BOT_LOGIN}" <<PY
import sys, json
bot = sys.argv[1].lower().rstrip('[bot]')
with open('${BEFORE_JSON_FILE}') as f:
    before = json.load(f)
with open('${AFTER_JSON_FILE}') as f:
    after = json.load(f)

def get_threads(data):
    return data['data']['repository']['pullRequest']['reviewThreads']['nodes']

def is_bot(node):
    comments = node.get('comments', {}).get('nodes', [])
    if not comments:
        return False
    author = (comments[0].get('author') or {}).get('login', '')
    return author.lower().rstrip('[bot]') == bot

before_nodes = {n['id']: n for n in get_threads(before)}
after_nodes  = {n['id']: n for n in get_threads(after)}

newly_resolved = 0
for tid, node in after_nodes.items():
    if not is_bot(node):
        continue
    before_node = before_nodes.get(tid)
    if before_node and not before_node['isResolved'] and node['isResolved']:
        newly_resolved += 1
        body = ''
        comments = node.get('comments', {}).get('nodes', [])
        if comments:
            body = comments[0].get('body', '')[:50].replace('\n', ' ')
        print(f"  ✅ 已解决: {node['path']}:{node['line']}  \"{body}\"")

still_unresolved = sum(
    1 for n in after_nodes.values()
    if is_bot(n) and not n['isResolved']
)

print(f'__newly_resolved__={newly_resolved}')
print(f'__still_unresolved__={still_unresolved}')
PY
)

echo "${AFTER_SUMMARY}" | grep -v '__'

NEWLY=$(echo "${AFTER_SUMMARY}" | grep '__newly_resolved__=' | cut -d= -f2)
REMAINING=$(echo "${AFTER_SUMMARY}" | grep '__still_unresolved__=' | cut -d= -f2)

# ─── 最终报告 ─────────────────────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════════════════════════"
echo "📊  结果报告"
echo "    触发前机器人未解决 thread: ${BOT_UNRESOLVED_COUNT}"
echo "    本次成功 resolve:         ${NEWLY}"
echo "    仍未解决:                 ${REMAINING}"
echo "    Action 结论:              ${RUN_CONCLUSION:-unknown}"
echo "    Run 地址:                 ${RUN_URL}"
echo ""
if [[ "${NEWLY}" -gt 0 && "${REMAINING}" -eq 0 ]]; then
  echo "✅  全部 bot thread 已解决！"
elif [[ "${NEWLY}" -gt 0 && "${REMAINING}" -gt 0 ]]; then
  echo "⚠️  部分解决：resolve 了 ${NEWLY} 条，仍有 ${REMAINING} 条未解决"
elif [[ "${BOT_UNRESOLVED_COUNT}" -eq 0 ]]; then
  echo "ℹ️  触发前就没有未解决的 bot thread，resolve 命令应返回「没有找到待解决的审查意见」"
else
  echo "❌  bot thread 未被 resolve（可能是 token 权限问题或 bot_github_login 不匹配）"
  echo "   提示：检查 workflow 日志中是否有 'Resource not accessible by integration'"
  echo "   解决方案：在 workflow 中启用 resolve_token 参数（经典 PAT，repo 权限）"
fi
echo "══════════════════════════════════════════════════════════════════"
