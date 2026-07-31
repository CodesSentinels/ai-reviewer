/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	// The require scope
/******/ 	var __nccwpck_require__ = {};
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/define property getters */
/******/ 	(() => {
/******/ 		// define getter functions for harmony exports
/******/ 		__nccwpck_require__.d = (exports, definition) => {
/******/ 			for(var key in definition) {
/******/ 				if(__nccwpck_require__.o(definition, key) && !__nccwpck_require__.o(exports, key)) {
/******/ 					Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });
/******/ 				}
/******/ 			}
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/hasOwnProperty shorthand */
/******/ 	(() => {
/******/ 		__nccwpck_require__.o = (obj, prop) => (Object.prototype.hasOwnProperty.call(obj, prop))
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/make namespace object */
/******/ 	(() => {
/******/ 		// define __esModule on exports
/******/ 		__nccwpck_require__.r = (exports) => {
/******/ 			if(typeof Symbol !== 'undefined' && Symbol.toStringTag) {
/******/ 				Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
/******/ 			}
/******/ 			Object.defineProperty(exports, '__esModule', { value: true });
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/compat */
/******/ 	
/******/ 	if (typeof __nccwpck_require__ !== 'undefined') __nccwpck_require__.ab = __dirname + "/";
/******/ 	
/************************************************************************/
var __webpack_exports__ = {};
// ESM COMPAT FLAG
__nccwpck_require__.r(__webpack_exports__);

// EXPORTS
__nccwpck_require__.d(__webpack_exports__, {
  "run": () => (/* binding */ run)
});

;// CONCATENATED MODULE: external "fs"
const external_fs_namespaceObject = require("fs");
;// CONCATENATED MODULE: ./lib/platform/execution-context.js
/**
 * platform/execution-context.ts - 平台无关执行上下文（ARCH-001 / ARCH-002）
 *
 * 业务层（review.ts / commenter.ts / commands/** 等）只允许通过 ExecutionContext
 * 获取"这次运行是谁在哪个平台对哪个 PR/MR 做了什么"，不得直接 import
 * `@actions/github` 或读取 `process.env.GITHUB_EVENT_NAME` / `process.env.TRIGGER_PAYLOAD`。
 * 平台专有细节一律封装进 `raw`，仅供对应 adapter（GitHub adapter / GitLab adapter，
 * ARCH-016+ 任务）内部使用。
 *
 * 参考 docs/tasks/execution-context-design.md 第 3 节。
 */
/** payload 缺失、格式错误或事件未知时抛出（ARCH-006 fail-closed） */
class ExecutionContextError extends Error {
    platform;
    reason;
    constructor(message, 
    // eslint-disable-next-line no-unused-vars
    platform, 
    // eslint-disable-next-line no-unused-vars
    reason) {
        super(message);
        this.platform = platform;
        this.reason = reason;
        this.name = 'ExecutionContextError';
    }
}

;// CONCATENATED MODULE: ./lib/platform/gitlab-execution-context.js
/**
 * platform/gitlab-execution-context.ts - GitLab ExecutionContext 工厂（ARCH-004）
 *
 * ⚠️ 边界说明：GitLab trigger CLI 目前完全不存在（EVENT-001~005 尚未开始），
 * 本文件交付的是类型定义 + 从"已解析 payload 对象"构造 ExecutionContext 的纯函数，
 * 不包含读取 TRIGGER_PAYLOAD 文件、校验 project ID/HEAD SHA、CLI 入口本身——
 * 那些属于 EVENT-002/EVENT-003 任务，届时只需要"解析出 payload JSON 后调用
 * 本文件的函数"，不需要重新设计字段映射。
 *
 * `isBot` 恒为 false：GitLab MVP 使用个人 PAT 身份评论，没有天然的 bot 账号标记；
 * 真正的自反馈过滤需要将 actor.login 与配置好的 PAT 用户名比较，属于 EVENT-018
 * （GitLab adapter 消费层任务），不在 ExecutionContext 构造阶段判断。
 *
 * GitLab Webhook 字段映射依据 GitLab 官方 Webhook events 文档整理，尚未经真实
 * Webhook 验证（ai-reviewer-test 项目尚未接入），EVENT-002 对接真实环境时需要
 * 用真实 payload 复核字段名，如有出入回填 docs/tasks/execution-context-design.md
 * 第 5.1 节。参考该文档第 5 节。
 */

/**
 * 输入为已由 EVENT-002 任务解析出的 GitLab webhook payload 对象
 * （对应 TRIGGER_PAYLOAD 文件反序列化后的 JSON）。本函数不做文件 IO。
 *
 * @throws {ExecutionContextError} payload 缺失/非对象、object_kind 不支持，或缺少必需字段时
 */
function createGitLabExecutionContext(payload) {
    if (payload == null || typeof payload !== 'object') {
        throw new ExecutionContextError('TRIGGER_PAYLOAD is empty or not an object', 'gitlab', 'missing_payload');
    }
    const p = payload;
    const kind = p.object_kind;
    if (kind === 'merge_request') {
        return buildFromMergeRequestHook(p);
    }
    if (kind === 'note') {
        return buildFromNoteHook(p);
    }
    throw new ExecutionContextError(`Unsupported GitLab object_kind: ${String(kind)}`, 'gitlab', 'unknown_event');
}
function buildFromMergeRequestHook(p) {
    const attrs = p.object_attributes;
    const project = p.project;
    if (attrs == null || project == null || attrs.iid == null) {
        throw new ExecutionContextError('merge_request payload missing object_attributes/project/iid', 'gitlab', 'missing_required_field');
    }
    const eventKind = mapMergeRequestAction(attrs, p.changes);
    return {
        platform: 'gitlab',
        projectPath: project.path_with_namespace,
        projectId: String(project.id),
        changeRequestId: attrs.iid,
        eventKind,
        actor: { login: p.user?.username ?? '', isBot: false },
        baseSha: attrs.oldrev ?? '',
        headSha: attrs.last_commit?.id ?? '',
        raw: p
    };
}
function buildFromNoteHook(p) {
    const attrs = p.object_attributes;
    const mr = p.merge_request;
    if (attrs == null || mr == null || attrs.action !== 'create') {
        throw new ExecutionContextError('note payload missing required fields or not a create action', 'gitlab', 'missing_required_field');
    }
    if (attrs.noteable_type !== 'MergeRequest') {
        throw new ExecutionContextError(`Unsupported noteable_type: ${attrs.noteable_type}`, 'gitlab', 'unknown_event');
    }
    return {
        platform: 'gitlab',
        projectPath: p.project?.path_with_namespace ?? '',
        projectId: String(p.project_id ?? p.project?.id ?? ''),
        changeRequestId: mr.iid,
        eventKind: attrs.discussion_id
            ? 'review_comment_created'
            : 'comment_created',
        actor: { login: p.user?.username ?? '', isBot: false },
        baseSha: '',
        headSha: mr.diff_head_sha ?? '',
        comment: {
            kind: attrs.discussion_id ? 'review_thread' : 'top_level',
            id: attrs.id,
            threadId: attrs.discussion_id
        },
        raw: p
    };
}
function mapMergeRequestAction(attrs, changes) {
    if (attrs.action === 'open')
        return 'pr_opened';
    if (attrs.action === 'reopen')
        return 'pr_reopened';
    if (attrs.action === 'update') {
        const headChanged = changes?.last_commit != null || changes?.source_branch != null;
        return headChanged ? 'pr_synchronize' : 'metadata_updated';
    }
    return 'unknown';
}

;// CONCATENATED MODULE: ./lib/gitlab-trigger-validation.js
/**
 * gitlab-trigger-validation.ts - TRIGGER_PAYLOAD 结构校验（EVENT-003）
 *
 * `createGitLabExecutionContext` 已经校验了它需要的字段（object_attributes.iid、
 * project、noteable_type 等），但不读取/校验 source_project_id/target_project_id
 * ——这两个字段只用于 fork 检测（EVENT-010，本任务不实现拒绝逻辑）。本模块只负责
 * "这些字段存不存在、类型对不对"的结构性校验，不做业务判断。
 *
 * 参考 docs/tasks/gitlab-trigger-cli-design.md 第 4 节。
 */
function validateTriggerPayload(payload) {
    if (payload == null || typeof payload !== 'object') {
        return { ok: false, reason: 'payload is not an object' };
    }
    const p = payload;
    if (p.object_kind !== 'merge_request' && p.object_kind !== 'note') {
        // 未知 object_kind 的处理交给 createGitLabExecutionContext 的 unknown_event
        // 分支（EVENT-004 快速退出），这里只做"是不是我们认识的两种事件"的粗过滤
        return { ok: true };
    }
    const project = p.project;
    if (project?.id == null) {
        return { ok: false, reason: 'missing project.id' };
    }
    if (p.object_kind === 'merge_request') {
        const attrs = p.object_attributes;
        if (attrs?.iid == null) {
            return { ok: false, reason: 'missing object_attributes.iid' };
        }
        if (attrs?.source_project_id == null || attrs?.target_project_id == null) {
            return { ok: false, reason: 'missing source_project_id/target_project_id' };
        }
        return {
            ok: true,
            sourceTargetMismatch: attrs.source_project_id !== attrs.target_project_id
        };
    }
    // note
    const attrs = p.object_attributes;
    const mr = p.merge_request;
    if (attrs?.id == null) {
        return { ok: false, reason: 'missing object_attributes.id' };
    }
    if (mr?.iid == null) {
        return { ok: false, reason: 'missing merge_request.iid' };
    }
    return { ok: true };
}

;// CONCATENATED MODULE: ./lib/gitlab-trigger-redact.js
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
function redact(input) {
    return input
        .replace(/glpat-[A-Za-z0-9_-]+/g, 'glpat-***')
        .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ***')
        .replace(/([?&]token=)[^&\s]+/gi, '$1***')
        .replace(/([?&]private_token=)[^&\s]+/gi, '$1***');
}

;// CONCATENATED MODULE: ./lib/gitlab-trigger.js
/**
 * gitlab-trigger.ts - GitLab trigger CLI 入口（EVENT-001/002）
 *
 * 由 protected main 的 ai-review-trigger job 调用（未来，本任务不含该 CI 接入，
 * 见 docs/tasks/gitlab-trigger-cli-design.md 阶段四）。从 file-type CI 变量
 * TRIGGER_PAYLOAD 指向的文件路径读取原始事件 → 解析 JSON → 结构校验 →
 * 构造 ExecutionContext → 打印摘要。
 *
 * 成功路径目前只打印日志，不调用模型、不写 GitLab note/discussion——真正的
 * 审查/评论动作需要 GLAPI-*（GitLab REST API adapter），本任务不实现，见设计
 * 文档第 3 节。
 *
 * 注：不 import @actions/core / @actions/github——GitLab-only 启动不得依赖
 * GitHub 专有运行时（对齐 ARCH-015）。Logger 抽象本身是 ARCH-012~015 的范围，
 * 本文件暂时直接用 console，等 Logger 任务落地后切换。
 */





async function run() {
    const payloadPath = process.env.TRIGGER_PAYLOAD;
    if (payloadPath == null || payloadPath === '') {
        console.error('TRIGGER_PAYLOAD is not set');
        process.exitCode = 1;
        return;
    }
    let raw;
    try {
        raw = (0,external_fs_namespaceObject.readFileSync)(payloadPath, 'utf8');
    }
    catch (e) {
        console.error(`Failed to read TRIGGER_PAYLOAD file: ${redact(String(e))}`);
        process.exitCode = 1;
        return;
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        // 不打印 raw 内容本身——即使只是"JSON 解析失败"也可能包含敏感字段
        console.error('TRIGGER_PAYLOAD content is not valid JSON');
        process.exitCode = 1;
        return;
    }
    const validation = validateTriggerPayload(parsed);
    if (!validation.ok) {
        console.error(`TRIGGER_PAYLOAD failed validation: ${validation.reason}`);
        process.exitCode = 1;
        return;
    }
    if (validation.sourceTargetMismatch) {
        // EVENT-003 只做结构校验 + 记录；是否拒绝 fork MR 是 EVENT-010，不在本任务实现
        console.log('Note: source_project_id != target_project_id (fork MR) — rejection logic is EVENT-010, not yet implemented');
    }
    let execCtx;
    try {
        execCtx = createGitLabExecutionContext(parsed);
    }
    catch (e) {
        if (e instanceof ExecutionContextError && e.reason === 'unknown_event') {
            // EVENT-004：无关事件快速成功退出
            console.log(`Skipped: ${e.message}`);
            return;
        }
        console.error(`Failed to build ExecutionContext: ${redact(e instanceof Error ? e.message : String(e))}`);
        process.exitCode = 1;
        return;
    }
    console.log(`GitLab event validated: platform=${execCtx.platform} eventKind=${execCtx.eventKind} project=${execCtx.projectPath} mr=${execCtx.changeRequestId}`);
    // 真正的审查/评论动作需要 GLAPI-*（GitLab REST API adapter），本任务不实现。
}
// 不用顶层 await（同 main.ts 的既有原因：ts-jest 的 CommonJS 转译不支持顶层
// await，会导致本文件无法被测试 import）。run() 内部已自行处理所有已知错误
// 路径并设置 exitCode，理论上不会 reject；仍加 catch 兜底避免真正的意外异常
// 变成未处理的 Promise rejection。
void (async () => {
    try {
        await run();
    }
    catch (e) {
        console.error(`Unhandled error in gitlab-trigger run(): ${redact(String(e))}`);
        process.exitCode = 1;
    }
})();

module.exports = __webpack_exports__;
/******/ })()
;