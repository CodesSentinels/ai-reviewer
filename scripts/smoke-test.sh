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

check "GitHub bundle (dist/index.js)" \
  "node dist/index.js" \
  "GITHUB_ACTION"

check "GitLab bundle (dist/gitlab-trigger/index.js)" \
  "node dist/gitlab-trigger/index.js" \
  "TRIGGER_PAYLOAD is not set"

if [ "$FAIL" -ne 0 ]; then
  echo "冒烟测试失败"
  exit 1
fi

echo "冒烟测试全部通过"
