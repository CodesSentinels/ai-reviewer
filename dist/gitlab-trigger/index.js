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
/**
 * payload 缺失、格式错误或事件未知时抛出（ARCH-006 fail-closed）。
 *
 * `ignorable_event` 与 `unknown_event` 都应被调用方（gitlab-trigger.ts）当作
 * 优雅跳过（exit 0）处理，区别在于语义：`unknown_event` 是"完全不认识的
 * object_kind"，`ignorable_event` 是"认识这个事件类型，但结构合法且业务上
 * 明确不需要处理"（如 note 编辑/删除、system note、非 MR note，见 EVENT-016/017、
 * Issue #66）。拆分出独立 reason 是为了和真正的校验失败（`missing_required_field`，
 * 仍应 fail closed）区分开。
 */
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
 * 真正的自反馈过滤需要将 actor.login 与配置好的 PAT 用户名比较（EVENT-018，
 * 见 `gitlab-note-hook-rules.ts` 的 `isSelfNote()`），故意不放进 ExecutionContext
 * 构造阶段判断——构造阶段不应依赖外部配置输入（呼应 ARCH-002 的字段设计边界）。
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
    // 结构缺失：真正的校验失败，fail closed（区别于下面的 ignorable_event）
    if (attrs == null || mr == null) {
        throw new ExecutionContextError('note payload missing object_attributes/merge_request', 'gitlab', 'missing_required_field');
    }
    // 结构合法但业务上不需要处理：优雅跳过（EVENT-016/017，修复 Issue #66——
    // 此前这三种情形跟"字段真正缺失"共用 missing_required_field，导致
    // gitlab-trigger.ts 对编辑/删除评论等 fail closed 而非优雅跳过）
    if (attrs.action !== 'create') {
        throw new ExecutionContextError(`note action is '${attrs.action}', not 'create' — ignorable`, 'gitlab', 'ignorable_event');
    }
    if (attrs.system === true) {
        throw new ExecutionContextError('system note — ignorable', 'gitlab', 'ignorable_event');
    }
    if (attrs.noteable_type !== 'MergeRequest') {
        throw new ExecutionContextError(`noteable_type '${attrs.noteable_type}' is not MergeRequest — ignorable`, 'gitlab', 'ignorable_event');
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

;// CONCATENATED MODULE: ./lib/platform/gitlab-logger.js
/**
 * platform/gitlab-logger.ts - GitLab CI Logger（ARCH-014）
 *
 * 输出到 stdout/stderr，不 import @actions/core（ARCH-015）。
 * GitLab CI job log 天然支持 ANSI 颜色，但 MVP 阶段只输出纯文本。
 */
class GitLabLogger {
    info(msg) {
        // eslint-disable-next-line no-console
        console.log(msg);
    }
    warning(msg) {
        // eslint-disable-next-line no-console
        console.warn(`[WARNING] ${msg}`);
    }
    error(msg) {
        // eslint-disable-next-line no-console
        console.error(`[ERROR] ${msg}`);
    }
    debug(msg) {
        if (process.env.AI_REVIEWER_DEBUG === 'true') {
            // eslint-disable-next-line no-console
            console.log(`[DEBUG] ${msg}`);
        }
    }
}

;// CONCATENATED MODULE: ./lib/platform/logger.js
/**
 * platform/logger.ts - 平台无关 Logger 接口（ARCH-012）
 *
 * 定义统一的日志接口，替换共享核心中对 @actions/core info/warning/error 的直接依赖。
 * 入口文件（main.ts / gitlab-trigger.ts）在启动时调用 setLogger() 设置平台实现，
 * 共享核心通过 getLogger() 或便捷函数（logger.info 等）输出日志。
 *
 * ARCH-015：GitLab-only 启动不得初始化 @actions/core，因此 GitLabLogger
 * 不 import @actions/core，只使用 console。
 */
/**
 * 控制台 Logger（默认 fallback）。
 * 在 setLogger() 调用前或未初始化时使用，保证日志不会丢失。
 */
const consoleLogger = {
    // eslint-disable-next-line no-console
    info: (msg) => console.log(msg),
    // eslint-disable-next-line no-console
    warning: (msg) => console.warn(msg),
    // eslint-disable-next-line no-console
    error: (msg) => console.error(msg),
    // eslint-disable-next-line no-console
    debug: (msg) => console.log(`[DEBUG] ${msg}`)
};
let _logger = (/* unused pure expression or super */ null && (consoleLogger));
/** 设置全局 Logger 实例（入口文件调用） */
function setLogger(logger) {
    _logger = logger;
}
/** 获取当前 Logger 实例 */
function getLogger() {
    return _logger;
}
/** 重置为默认 console logger（仅供测试使用） */
function resetLogger() {
    _logger = consoleLogger;
}

;// CONCATENATED MODULE: ./lib/platform/exec-ctx-error-handler.js
/**
 * platform/exec-ctx-error-handler.ts — ExecutionContextError 统一处理（ARCH-026）
 *
 * 从 orchestrator.ts 拆出，确保 gitlab-trigger.ts 可以单独引入，
 * 不间接拉入 commenter/review/command-handler 等 GitHub 侧依赖（ARCH-015）。
 */

/**
 * ExecutionContextError 统一处理（ARCH-026）。
 *
 * @returns 'skip' 表示无关事件可跳过，'fatal' 表示需要 fail closed
 */
function handleExecCtxError(e, logger, 
// eslint-disable-next-line no-unused-vars
onFailed) {
    if (e instanceof ExecutionContextError &&
        (e.reason === 'unknown_event' || e.reason === 'ignorable_event')) {
        // unknown_event：完全不认识的事件；ignorable_event：认识但业务上不需要处理
        // 的事件（note 编辑/删除、system note、非 MR note，见 EVENT-016/017、Issue #66）。
        // 两者都优雅跳过（skip），不应 fail closed。
        logger.warning(`Skipped: ${e.message}`);
        return 'skip';
    }
    if (e instanceof ExecutionContextError) {
        onFailed(`Failed to build ExecutionContext: ${e.message}`);
    }
    else if (e instanceof Error) {
        onFailed(`Failed to build ExecutionContext: ${e.message}, backtrace: ${e.stack}`);
    }
    else {
        onFailed(`Failed to build ExecutionContext: ${e}`);
    }
    return 'fatal';
}

;// CONCATENATED MODULE: ./lib/gitlab-trigger-validation.js
/**
 * gitlab-trigger-validation.ts - TRIGGER_PAYLOAD 结构校验（EVENT-003）
 *
 * `createGitLabExecutionContext` 已经校验了它需要的字段（object_attributes.iid、
 * project、noteable_type 等），但不读取/校验 source_project_id/target_project_id
 * ——这两个字段只用于 fork 检测。本模块只负责"这些字段存不存在、类型对不对"的结构性
 * 校验，不做业务判断；实际的 fork 拒绝逻辑（EVENT-010）在
 * `gitlab-mr-hook-rules.ts` 的 `checkForkMergeRequest()` + `gitlab-trigger.ts` 里。
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

;// CONCATENATED MODULE: ./lib/gitlab-mr-hook-rules.js
/**
 * gitlab-mr-hook-rules.ts - GitLab MR Hook 业务规则（EVENT-010/012/013）
 *
 * 三个纯函数，不做任何文件/网络 IO：
 * - checkForkMergeRequest()：EVENT-010，判断 MR 是否来自 fork（source_project_id
 *   != target_project_id），供 gitlab-trigger.ts 决定是否 fail closed 拒绝。
 * - isHeadStale()：EVENT-012，比较"事件里的 headSha"与"重新读取到的当前 headSha"
 *   是否一致；真正重新读取 GitLab MR 当前 HEAD 属于 GLAPI-006，本函数只做比较。
 * - buildMrIdempotencyKey()：EVENT-013，生成幂等键，格式为
 *   `gitlab:{project_id}:{mr_iid}:head:{head_sha}`；与 summary note marker 的比对
 *   属于 STATE-005，不在本文件范围。
 *
 * 参考 docs/tasks/gitlab-mr-hook-design.md 第 3.2/3.4/3.5 节。
 */
function checkForkMergeRequest(sourceProjectId, targetProjectId) {
    if (sourceProjectId !== targetProjectId) {
        return {
            isFork: true,
            reason: `source_project_id(${sourceProjectId}) !== target_project_id(${targetProjectId})`
        };
    }
    return { isFork: false };
}
function isHeadStale(eventHeadSha, currentHeadSha) {
    return {
        stale: eventHeadSha !== currentHeadSha,
        eventHeadSha,
        currentHeadSha
    };
}
function buildMrIdempotencyKey(projectId, mrIid, headSha) {
    return `gitlab:${projectId}:${mrIid}:head:${headSha}`;
}

;// CONCATENATED MODULE: ./lib/gitlab-trigger.js
/**
 * gitlab-trigger.ts - GitLab trigger CLI 入口（EVENT-001/002）
 *
 * 由 protected main 的 ai-review-trigger job 调用。从 file-type CI 变量
 * TRIGGER_PAYLOAD 指向的文件路径读取原始事件 → 解析 JSON → 结构校验 →
 * 构造 ExecutionContext → 打印摘要。
 *
 * 成功路径目前只打印日志，不调用模型、不写 GitLab note/discussion——真正的
 * 审查/评论动作需要 GLAPI-*（GitLab REST API adapter），不在本任务实现。
 *
 * 不 import @actions/core / @actions/github（ARCH-015）。
 * 使用 Logger 抽象（ARCH-012）和 handleExecCtxError（ARCH-026）。
 */








const logger = new GitLabLogger();
async function run() {
    // 初始化 GitLab Logger（ARCH-014）
    setLogger(logger);
    const payloadPath = process.env.TRIGGER_PAYLOAD;
    if (payloadPath == null || payloadPath === '') {
        logger.error('TRIGGER_PAYLOAD is not set');
        process.exitCode = 1;
        return;
    }
    let raw;
    try {
        raw = (0,external_fs_namespaceObject.readFileSync)(payloadPath, 'utf8');
    }
    catch (e) {
        logger.error(`Failed to read TRIGGER_PAYLOAD file: ${redact(String(e))}`);
        process.exitCode = 1;
        return;
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        logger.error('TRIGGER_PAYLOAD content is not valid JSON');
        process.exitCode = 1;
        return;
    }
    const validation = validateTriggerPayload(parsed);
    if (!validation.ok) {
        logger.error(`TRIGGER_PAYLOAD failed validation: ${validation.reason}`);
        process.exitCode = 1;
        return;
    }
    if (validation.sourceTargetMismatch) {
        // EVENT-010：fork MR 是需要人工关注的安全边界，fail closed 而非优雅跳过
        // （区别于 unknown_event 的 exit 0 语义）——见 docs/tasks/gitlab-mr-hook-design.md 第 3.2 节。
        const attrs = parsed.object_attributes;
        const forkCheck = checkForkMergeRequest(attrs.source_project_id, attrs.target_project_id);
        logger.error(`Rejected: fork MR not supported (MVP) — ${redact(forkCheck.reason ?? '')}`);
        process.exitCode = 1;
        return;
    }
    let execCtx;
    try {
        execCtx = createGitLabExecutionContext(parsed);
    }
    catch (e) {
        // ARCH-026：统一 ExecCtxError 处理
        const result = handleExecCtxError(e, logger, (msg) => {
            logger.error(redact(msg));
            process.exitCode = 1;
        });
        if (result === 'skip')
            return; // 无关事件，成功退出
        return; // fatal，exitCode 已设置
    }
    logger.info(`GitLab event validated: platform=${execCtx.platform} eventKind=${execCtx.eventKind} project=${execCtx.projectPath} mr=${execCtx.changeRequestId}`);
    // 真正的审查/评论动作需要 GLAPI-*，本任务不实现。
    // 待 GLAPI 就绪后，此处调用 runOrchestrator 或 dispatchEvent。
}
// 不用顶层 await（同 main.ts 的既有原因）
void (async () => {
    try {
        await run();
    }
    catch (e) {
        logger.error(`Unhandled error in gitlab-trigger run(): ${redact(String(e))}`);
        process.exitCode = 1;
    }
})();

module.exports = __webpack_exports__;
/******/ })()
;