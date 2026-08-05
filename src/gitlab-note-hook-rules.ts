/**
 * gitlab-note-hook-rules.ts - GitLab Note Hook 业务规则（EVENT-018/020）
 *
 * 两个纯函数，不做任何文件/网络 IO：
 * - isSelfNote()：EVENT-018，判断某条 note 是否由配置好的 PAT 账号自己发出
 *   （用于反馈循环过滤）。故意不放进 ExecutionContext 构造阶段（execCtx.actor.isBot
 *   恒为 false）——构造阶段不应依赖"已配置的 PAT 用户名"这个外部配置输入，
 *   呼应 ARCH-002 的字段设计边界。`configuredPatUsername` 的来源本任务先用
 *   环境变量占位（如 GITLAB_BOT_USERNAME），等 ConfigProvider 就绪后再切换，
 *   这是刻意的临时方案，见 docs/tasks/gitlab-note-hook-design.md 第 3.3 节。
 * - buildNoteIdempotencyKey()：EVENT-020，生成幂等键，格式为
 *   `gitlab:{project_id}:{mr_iid}:note:{note_id}:create`；与 marker 存储的
 *   对接属于 STATE-005，不在本文件范围。
 *
 * 参考 docs/tasks/gitlab-note-hook-design.md 第 3.3/3.5 节。
 */

export function isSelfNote(actorLogin: string, configuredPatUsername: string): boolean {
  return actorLogin.toLowerCase() === configuredPatUsername.toLowerCase()
}

export function buildNoteIdempotencyKey(projectId: string, mrIid: number, noteId: number): string {
  return `gitlab:${projectId}:${mrIid}:note:${noteId}:create`
}
