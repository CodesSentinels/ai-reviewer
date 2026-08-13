#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/../../../.." && pwd)"
cd "$repo_root"

command -v rg >/dev/null 2>&1 || {
  echo "error: rg is required" >&2
  exit 2
}

status=0

check() {
  local label="$1"
  local pattern="$2"
  shift 2

  local output
  output="$(rg -n --glob '*.ts' "$pattern" "$@" 2>/dev/null || true)"
  if [[ -n "$output" ]]; then
    echo "FAIL: $label" >&2
    echo "$output" >&2
    status=1
  fi
}

shared_paths=(
  src/review.ts
  src/commenter.ts
  src/command-handler.ts
  src/commands
  src/prompts.ts
  src/dependency-analyzer.ts
  src/repo-tree.ts
)

check \
  "shared core imports GitHub runtime or Octokit" \
  "from ['\"]@actions/(core|github)['\"]|from ['\"][.]{1,2}/octokit['\"]|@octokit/" \
  "${shared_paths[@]}"

check \
  "shared core reads GitHub context, Action inputs, or platform event variables" \
  "GITHUB_EVENT_NAME|github_context|context[.]payload|get(Boolean|Multiline)?Input[(]" \
  "${shared_paths[@]}"

# 只匹配真实的 import/require，避免命中文档注释里对 SDK 的说明性提及。
# 本仓库的 GitLab adapter/client 层是 src/platform/gitlab-*.ts（GLAPI-029/031）。
check \
  "@gitbeaker/rest is imported outside the GitLab adapter/client layer" \
  "(from|require\()\s*['\"]@gitbeaker/" \
  src \
  --glob '!src/gitlab/**' \
  --glob '!src/platform/gitlab-*.ts'

# adapter 层文件按路径直接列出（rg 的多个正向 --glob 是 OR 关系，不能用来收窄范围）。
check \
  "GitHub adapter imports GitLab implementation" \
  "@gitbeaker/rest|from ['\"][^'\"]*gitlab[^'\"]*['\"]" \
  src/platform/github-*.ts

check \
  "GitLab adapter imports GitHub runtime or implementation" \
  "(from|require\()\s*['\"](@actions/(core|github)|@octokit/[^'\"]*|[^'\"]*octokit[^'\"]*|[^'\"]*github-[^'\"]*)['\"]" \
  src/platform/gitlab-*.ts

# GLAPI-031：GitLab HTTP 调用只能经统一 client factory，adapter 不得绕过去裸 fetch。
check \
  "GitLab adapter calls native fetch instead of the unified client" \
  "\\bfetch\\(" \
  src/platform/gitlab-*.ts src/gitlab-trigger.ts

if ((status != 0)); then
  exit "$status"
fi

echo "platform boundary checks passed"
