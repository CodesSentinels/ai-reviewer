/**
 * gitlab-trigger-redact.ts - 错误日志脱敏（EVENT-005）
 *
 * 只处理字符串形态的错误信息，覆盖当前已知会出现在 gitlab-trigger 错误路径里的
 * token 形态：GitLab PAT（glpat-）、Bearer token、URL query 中的 token 参数。
 * 不是通用脱敏框架——覆盖 HTTP Header/环境变量/异常对象任意嵌套字段是 SEC-008
 * 的范围，不在本任务内。
 *
 * 参考 docs/tasks/gitlab-trigger-cli-design.md 第 6 节。
 */

export function redact(input: string): string {
  return input
    .replace(/glpat-[A-Za-z0-9_-]+/g, 'glpat-***')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ***')
    .replace(/([?&]token=)[^&\s]+/gi, '$1***')
    .replace(/([?&]private_token=)[^&\s]+/gi, '$1***')
}
