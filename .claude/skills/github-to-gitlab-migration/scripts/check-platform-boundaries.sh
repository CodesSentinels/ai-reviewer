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

check \
  "@gitbeaker/rest is imported outside the GitLab adapter/client layer" \
  "@gitbeaker/rest" \
  src \
  --glob '!src/gitlab/**'

if [[ -d src/github ]]; then
  check \
    "GitHub adapter imports GitLab implementation" \
    "@gitbeaker/rest|from ['\"][^'\"]*gitlab[^'\"]*['\"]" \
    src/github
fi

if [[ -d src/gitlab ]]; then
  check \
    "GitLab adapter imports GitHub runtime or implementation" \
    "@actions/(core|github)|@octokit/|from ['\"][^'\"]*octokit[^'\"]*['\"]|from ['\"][^'\"]*github[^'\"]*['\"]" \
    src/gitlab
fi

if ((status != 0)); then
  exit "$status"
fi

echo "platform boundary checks passed"
