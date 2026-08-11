# cw-commit 规则覆盖文件模板。
#
# 复制到以下任一路径以生效（同名变量后加载者覆盖先加载者，即仓库级 > 用户级 > 包内默认）：
#   ~/.cw-commit-rules.sh           用户级，对本机所有仓库生效
#   <repo-root>/.cw-commit-rules.sh 仓库级，仅对当前仓库生效，优先级最高
#
# 只需覆盖需要修改的变量，未覆盖的变量沿用包内默认值（见 commit-rules.default.sh）。

# COMMIT_TYPES="feat fix docs style refactor perf test chore revert"
# COMMIT_SCOPES="components pages layout hooks store api styles config deps utils tests docs build ci init demo env i18n perf monitor misc"
# JIRA_PATTERN='CW-[0-9]+'
# SUBJECT_LANGUAGE="中文"
# SUBJECT_MAX_CODEPOINTS=100

# 非 CoinW 项目示例：不遵循 CW-<jira> 分支约定、也不需要 scope 白名单，
# 生成的 commit 格式变为 "type: subject"。
COMMIT_SCOPES=""
JIRA_PATTERN=""
SUBJECT_LANGUAGE="英文"
