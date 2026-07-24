#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/../../../.." && pwd)"
todo="$repo_root/docs/github-gitlab-compatibility-todo.md"
index="$repo_root/.claude/skills/github-to-gitlab-migration/references/task-index.md"

command -v rg >/dev/null 2>&1 || {
  echo "error: rg is required" >&2
  exit 2
}

[[ -f "$todo" ]] || {
  echo "error: missing TODO document: $todo" >&2
  exit 2
}

[[ -f "$index" ]] || {
  echo "error: missing task index: $index" >&2
  exit 2
}

todo_prefixes="$(
  rg -o '^- \[[ xX]\] `([A-Z]+)-[0-9]+`' --replace '$1' "$todo" | sort -u
)"
index_prefixes="$(
  rg -o '`([A-Z]+)-\*`' --replace '$1' "$index" | sort -u
)"

if [[ "$todo_prefixes" != "$index_prefixes" ]]; then
  echo "task prefix mismatch" >&2
  diff \
    <(printf '%s\n' "$todo_prefixes") \
    <(printf '%s\n' "$index_prefixes") >&2 || true
  exit 1
fi

echo "task index prefixes match TODO"
