#!/usr/bin/env bash
# BUILD-006: 双入口 bundle 的 Node 24 启动冒烟测试。
#
# 两个入口在没有真实事件环境（GITHUB_ACTION/TRIGGER_PAYLOAD 等）时本来就
# 应该以非零退出，所以判定标准不是 exit code 0，而是"确实加载并执行到了
# 已知的错误分支"——用输出文本区分"预期的环境缺失错误"和"bundle 本身
# 加载失败"（比如 Cannot find module / SyntaxError，这类才是真正需要
# fail 的构建问题）。
set -uo pipefail

cd "$(dirname "$0")/.."

FAIL=0

# BUILD-001：确认 tsc 确实把 src/gitlab-trigger.ts 编译进了 lib/（tsconfig.json
# 没有限制 include，理论上会自动覆盖，这里用一次实际检查钉死这个假设）。
echo "--- check: lib/gitlab-trigger.js exists (BUILD-001) ---"
if [ -f lib/gitlab-trigger.js ]; then
  echo "PASS: lib/gitlab-trigger.js 已生成"
else
  echo "FAIL: lib/gitlab-trigger.js 不存在，tsc 编译可能未覆盖 GitLab 入口"
  FAIL=1
fi

echo "--- check: lib/lint-report-entry.js exists (LINT-005) ---"
if [ -f lib/lint-report-entry.js ]; then
  echo "PASS: lib/lint-report-entry.js 已生成"
else
  echo "FAIL: lib/lint-report-entry.js 不存在，tsc 编译可能未覆盖 lint-only 入口"
  FAIL=1
fi

check() {
  local label="$1" cmd="$2" expected_text="$3"
  echo "--- smoke test: ${label} ---"
  local output
  output=$(eval "$cmd" 2>&1)

  if echo "$output" | grep -qE 'Cannot find module|SyntaxError|is not defined|MODULE_NOT_FOUND'; then
    echo "FAIL: 输出包含疑似 bundle 加载失败的信号"
    echo "$output"
    FAIL=1
    return
  fi

  if echo "$output" | grep -qF "$expected_text"; then
    echo "PASS: 已加载并执行到已知错误分支（包含 \"$expected_text\"）"
  else
    echo "FAIL: 输出未包含预期文本 \"$expected_text\""
    echo "实际输出："
    echo "$output"
    FAIL=1
  fi
}

# GITHUB_REPOSITORY 在 GitHub Actions 里总是存在，本地则没有；显式给一个占位值，
# 让断言落在"缺 GITHUB_ACTION"这个真正想验证的分支上，而不是随环境漂移。
check "GitHub bundle (dist/index.js)" \
  "env -u GITHUB_ACTION GITHUB_REPOSITORY=owner/repo node dist/index.js" \
  "GITHUB_ACTION"

# GitLab 入口先解析受信任 client 配置（GLAPI-029），再读事件 payload，
# 因此两个 fail closed 分支分别验证。
check "GitLab bundle (dist/gitlab-trigger/index.js) — 缺凭据" \
  "env -u GITLAB_PAT -u CI_JOB_TOKEN node dist/gitlab-trigger/index.js" \
  "GITLAB_PAT or CI_JOB_TOKEN is required"

check "lint-only bundle (dist/lint-report/index.js) — 缺参数" \
  "node dist/lint-report/index.js --repo-root /nonexistent" \
  "usage: --repo-root"

check "lint-only bundle — 拒绝分支名（只接受 40 位 SHA）" \
  "node dist/lint-report/index.js --repo-root . --base-sha main --head-sha feature --out /dev/null" \
  "must be full 40-char commit SHAs, not refs"

check "GitLab bundle (dist/gitlab-trigger/index.js) — 缺事件 payload" \
  "env -u TRIGGER_PAYLOAD GITLAB_PAT=glpat-smoke-placeholder node dist/gitlab-trigger/index.js" \
  "TRIGGER_PAYLOAD is not set"

if [ "$FAIL" -ne 0 ]; then
  echo "冒烟测试失败"
  exit 1
fi

echo "冒烟测试全部通过"

# ─── GitLab bundle 在零 GITHUB_* 环境下必须能跑到事件分发（ARCH-005）──────────
#
# 这是长期挡住 gitlab-trigger 接入审查核心的那个故障：review.ts / commenter.ts
# 在模块级求值 @actions/github 的 context.repo，没有 GITHUB_REPOSITORY 就抛，
# 于是 GitLab 入口在**加载期**崩溃，run() 根本执行不到。
#
# 这里用假 token 跑真实产物：预期走到 getChangeRequest 的 401，而不是加载期崩溃。
echo "--- smoke test: GitLab bundle 在零 GITHUB_* 环境下完成事件分发 ---"
GITLAB_SMOKE_PAYLOAD="$(mktemp)"
cat > "$GITLAB_SMOKE_PAYLOAD" <<'PAYLOAD'
{"object_kind":"merge_request","project":{"id":77,"path_with_namespace":"group/demo"},
 "user":{"username":"alice"},
 "object_attributes":{"iid":42,"action":"open","source_project_id":77,"target_project_id":77,
 "last_commit":{"id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
 "oldrev":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}}
PAYLOAD

GITLAB_SMOKE_OUT="$(env -u GITHUB_REPOSITORY -u GITHUB_EVENT_PATH -u GITHUB_EVENT_NAME \
  -u GITHUB_ACTION -u GITHUB_SERVER_URL -u GITHUB_TOKEN \
  GITLAB_HOST=https://gitlab.invalid GITLAB_PAT=glpat-smoketestplaceholder \
  TRIGGER_PAYLOAD="$GITLAB_SMOKE_PAYLOAD" OPENAI_API_KEY=sk-smoke-test \
  node dist/gitlab-trigger/index.js 2>&1)"
rm -f "$GITLAB_SMOKE_PAYLOAD"

# note 事件走的是另一条分发分支（命令/对话），MR 事件绿不代表它也通——
# 第一版接线就是 MR 通、note 全部静默丢弃。两条都要跑。
GITLAB_NOTE_PAYLOAD="$(mktemp)"
cat > "$GITLAB_NOTE_PAYLOAD" <<'PAYLOAD'
{"object_kind":"note","project":{"id":77,"path_with_namespace":"group/demo"},"project_id":77,
 "user":{"username":"alice"},"merge_request":{"iid":42,"diff_head_sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
 "object_attributes":{"id":9001,"action":"create","note":"@ai-reviewer help",
 "noteable_type":"MergeRequest","system":false}}
PAYLOAD

GITLAB_NOTE_OUT="$(env -u GITHUB_REPOSITORY -u GITHUB_EVENT_PATH -u GITHUB_EVENT_NAME \
  -u GITHUB_ACTION -u GITHUB_SERVER_URL -u GITHUB_TOKEN \
  GITLAB_HOST=https://gitlab.invalid GITLAB_PAT=glpat-smoketestplaceholder \
  TRIGGER_PAYLOAD="$GITLAB_NOTE_PAYLOAD" OPENAI_API_KEY=sk-smoke-test \
  node dist/gitlab-trigger/index.js 2>&1)"
rm -f "$GITLAB_NOTE_PAYLOAD"

if echo "$GITLAB_NOTE_OUT" | grep -q "missing comment body"; then
  echo "FAIL: note 事件被当成「无评论正文」丢弃（comment.body 未填充）"
  FAIL=1
elif echo "$GITLAB_NOTE_OUT" | grep -q "eventKind=comment_created"; then
  echo "PASS: note 事件分发到达命令路径"
else
  echo "FAIL: note 事件未走到命令分发，实际输出："
  echo "$GITLAB_NOTE_OUT" | head -5
  FAIL=1
fi

if echo "$GITLAB_SMOKE_OUT" | grep -q "GITHUB_REPOSITORY"; then
  echo "FAIL: GitLab bundle 仍在向 @actions/github 要 GITHUB_REPOSITORY（加载期崩溃回归）"
  FAIL=1
elif echo "$GITLAB_SMOKE_OUT" | grep -q "eventKind=pr_opened"; then
  echo "PASS: 事件分发到达共享核心（platform=gitlab eventKind=pr_opened）"
else
  echo "FAIL: 未走到事件分发，实际输出："
  echo "$GITLAB_SMOKE_OUT" | head -5
  FAIL=1
fi
