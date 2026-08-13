#!/usr/bin/env bash
# run-lint-report.sh — 在**无密钥** job 里跑 lint 并产出 JSON 报告（SEC-002）
#
# 由 openai-review.yml 的 `lint` job 调用。该 job checkout 的是 PR head，
# 即不可信代码；本脚本运行在那个执行面上，因此：
#
#   - 绝不读取任何密钥（调用方一条 env secret 都不给）
#   - 只写出 lint-report.json 这一份**数据**，不产出可执行物（SEC-005）
#   - 任何失败都以「空报告」收场并返回 0——静态分析是增强项，
#     不能因为它挂了就把整个 PR 的审查挡住
#
# 报告格式见 src/lint/types.ts 的 LintReport；消费端会用
# src/lint/report-schema.ts 严格校验，这里不必保证内容可信。
set -uo pipefail

OUT="${LINT_REPORT_OUT:-lint-report.json}"
EMPTY_REPORT='{"results":[],"toolSummaries":[],"durationMs":0,"filesScanned":0}'

# 上传端体积门禁（消费端 review.ts 还有一道同样的闸）。
# 报告内容间接受 PR 作者控制，超大 JSON 会拖垮下游解析——两端都设闸，
# 任何一端漏了另一端仍然挡得住。
MAX_BYTES="${LINT_REPORT_MAX_BYTES:-8388608}" # 8 MiB

emit_empty() {
  echo "$EMPTY_REPORT" > "$OUT"
  echo "run-lint-report: emitted empty report ($1)"
  exit 0
}

# 产出后统一过一遍体积闸；超限就换成空报告，绝不把超大文件送过信任边界
enforce_size_limit() {
  [ -f "$OUT" ] || emit_empty "report file missing"
  local size
  size=$(wc -c < "$OUT" | tr -d ' ')
  if [ "$size" -gt "$MAX_BYTES" ]; then
    emit_empty "report too large (${size} > ${MAX_BYTES} bytes)"
  fi
  echo "run-lint-report: report ready (${size} bytes)"
}

command -v node >/dev/null 2>&1 || emit_empty "node not available"

# reviewer 自身的依赖不在这个 checkout 里（这里是 PR 仓库），
# 因此用仓库内已提交的 bundle 无法直接跑 orchestrator。
# MVP 阶段先产出空报告占位：双 job 的**安全骨架**先落地，
# lint 的实际执行留给后续任务（届时在此调用打包好的 lint-only 入口）。
#
# 这样做的理由：安全边界（无密钥面执行 PR 代码、有密钥面只读数据）现在就成立，
# 而不是等 lint 跑通了再一起上，避免把两件事的风险绑在一起。
emit_empty "lint execution not yet wired (SEC-002 skeleton)"

# 真正接上 lint 之后，上面的 emit_empty 会被替换成实际扫描，
# 结尾统一走体积门禁：
# enforce_size_limit
