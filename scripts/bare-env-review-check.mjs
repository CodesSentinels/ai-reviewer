/**
 * bare-env-review-check.mjs — LINT-002：裸环境下的 API-only 审查验收
 *
 * LINT-002 要求「在无外网、空工具缓存和未安装 lint 工具的 GitLab trigger 测试
 * 环境中，API-only 审查仍须通过」。这条断言的对象是**打包产物在裸机上的行为**，
 * 与 GitLab 服务器本身无关——GitLab 只是 secret-bearing 执行面的载体。所以这里
 * 在本地精确复现那个环境，而不是等一次真实 job 日志：
 *
 *   未安装 lint 工具 —— 空的临时 cwd（无 node_modules）+ PATH 只有 node 所在目录
 *   空工具缓存       —— 全新的 HOME / XDG_CACHE_HOME / npm_config_cache
 *   无外网           —— 两层：已知端点（GitLab host、OpenAI base URL）指向
 *                       loopback stub；同时用 --require 往子进程注入
 *                       bare-env-egress-guard.cjs，在 dns.lookup /
 *                       net.connect / tls.connect 上把非 loopback 目标全部
 *                       拒掉并记账。只做第一层是不够的——那只能证明「这两个
 *                       已知端点走了 stub」，操作系统的网络和 DNS 仍然可用，
 *                       代码访问任何别的外部地址验收照样会绿。
 *
 * 比真实 job 日志强的地方有两点：
 *
 *   1. 真实 job 只能事后观察「没发生 lint 活动」「没报连接错误」，这里是主动
 *      堵死出口再看它是否仍然跑完，并且能把每一次被拦下的出网尝试列出来；
 *   2. 第二轮「诱饵」运行会把可执行的假 lint 工具摆到 PATH 上。若审查真去调
 *      工具，诱饵会留下痕迹。没有痕迹才能证明第一轮的通过是「压根没尝试」，
 *      而不是「尝试了、失败了、静默降级了」——后者在真实环境同样显示为绿。
 *
 * 用法：node scripts/bare-env-review-check.mjs（退出码 0 = 通过）
 * 由 scripts/smoke-test.sh 调用，跑在 npm run package 之后。
 */
import {createServer} from 'node:http'
import {spawn} from 'node:child_process'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  statSync,
  rmSync,
  existsSync
} from 'node:fs'
import {tmpdir} from 'node:os'
import {join, dirname} from 'node:path'
import process from 'node:process'

const HEAD_SHA = 'a'.repeat(40)
const BASE_SHA = 'b'.repeat(40)
const PROJECT_ID = 77
const MR_IID = 42
const ORIGINAL_DESCRIPTION = '这是 MR 作者自己写的描述正文'

/** 审查若真去调本地工具，诱饵会被执行——这些名字覆盖 lint 子系统的全部 adapter */
const DECOY_TOOLS = ['eslint', 'biome', 'tsc', 'prettier', 'semgrep', 'ruff', 'npm', 'npx', 'git']

// ═══════════════════════ loopback stub：同时假扮 GitLab 与 OpenAI ═══════════

/**
 * 读请求体。
 *
 * gitbeaker 发 discussions 用的是 multipart/form-data，不是 JSON——第一版按
 * JSON 解析，拿到的是一坨 `------formdata-undici-...` 原文，断言「发布了行级
 * 评论」于是永远为假。这里两种都认。
 */
function requestBody(req) {
  return new Promise(resolve => {
    let raw = ''
    req.on('data', c => (raw += c))
    req.on('end', () => {
      if ((req.headers['content-type'] ?? '').includes('multipart/form-data')) {
        return resolve(parseMultipart(raw))
      }
      try {
        resolve(JSON.parse(raw || '{}'))
      } catch {
        resolve({raw})
      }
    })
  })
}

/** 够用的 multipart 解析：只取 `name="x"` → 值，不处理文件上传 */
function parseMultipart(raw) {
  const fields = {}
  for (const part of raw.split(/--[-\w]+(?:--)?\r\n/)) {
    const m = part.match(/name="([^"]+)"\r\n\r\n([\s\S]*?)\r\n$/)
    if (m != null) fields[m[1]] = m[2]
  }
  return fields
}

/** OpenAI Responses API 形状的回答 */
function openaiResponse(text) {
  return {
    id: 'resp_stub',
    object: 'response',
    created_at: 0,
    model: 'stub',
    status: 'completed',
    output: [
      {
        id: 'msg_stub',
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{type: 'output_text', text, annotations: []}]
      }
    ],
    usage: {input_tokens: 10, output_tokens: 10, total_tokens: 20}
  }
}

/**
 * 模型回答按提示词内容切换。
 *
 * 深度审查阶段必须回**格式合法且非 LGTM** 的内容，否则一条行级评论都不会产生，
 * 「审查跑完了」就成了空跑——退出码 0 只说明没崩，不说明审查真的产出了东西。
 */
function answerFor(prompt) {
  const p = String(prompt)
  if (p.includes('---new_hunk---')) {
    // 行级审查的输出格式：`startLine-endLine:\n 评论正文\n---`
    return '2-2:\n 这里应该用 const 断言。\n---\n'
  }
  if (p.includes('release notes')) {
    return '- 新增了裸环境验收脚本'
  }
  return '这是模型回答。'
}

const CHANGED_FILE = {
  old_path: 'src/a.ts',
  new_path: 'src/a.ts',
  new_file: false,
  deleted_file: false,
  renamed_file: false,
  diff: '@@ -1,2 +1,3 @@\n const a = 1\n+const b = 2\n export {a}\n'
}

/** 每轮运行一份独立状态，避免上一轮写入的 marker 影响下一轮的幂等判断 */
function newState() {
  return {requests: [], notes: [], discussions: [], description: ORIGINAL_DESCRIPTION}
}

function startStub(getState) {
  return new Promise(resolve => {
    const server = createServer(async (req, res) => {
      const st = getState()
      const path = req.url.split('?')[0]
      const isWrite = req.method === 'POST' || req.method === 'PUT'
      const body = isWrite ? await requestBody(req) : null
      st.requests.push({method: req.method, url: req.url, body})

      const sendJson = (payload, code = 200) => {
        res.writeHead(code, {'content-type': 'application/json'})
        res.end(JSON.stringify(payload))
      }

      // ── OpenAI ──
      if (path.startsWith('/v1/responses')) {
        return sendJson(openaiResponse(answerFor(JSON.stringify(body?.input ?? body ?? ''))))
      }

      // ── GitLab 写操作 ──
      // 必须排在读路由表之前：路由表只按 URL 匹配，POST /notes 会被「列出
      // notes」那条规则截走，写入就永远落不了地（第一版正是这么假绿的）。
      if (isWrite) {
        if (req.method === 'PUT' && /\/merge_requests\/\d+$/.test(path)) {
          // description 必须有状态：updateDescriptionSection 写完会重读校验，
          // 无状态 stub 会让它每次都判定「写入未生效」而空转三轮重试。
          if (typeof body?.description === 'string') st.description = body.description
          return sendJson({iid: MR_IID, description: st.description})
        }
        if (/\/discussions$/.test(path)) {
          st.discussions.push(body)
          return sendJson({id: 'disc-1', notes: [{id: 1, body: body?.body ?? ''}]}, 201)
        }
        if (typeof body?.body === 'string') st.notes.push(body.body)
        return sendJson({id: 1, body: body?.body ?? '', author: {username: 'ai-reviewer'}}, 201)
      }

      // ── GitLab 读操作（顺序敏感：先匹配更具体的路径）──
      const routes = [
        [/\/api\/v4\/user$/, () => ({id: 1, username: 'ai-reviewer', name: 'AI Reviewer'})],
        [
          /\/merge_requests\/\d+\/changes$/,
          () => ({
            diff_refs: {base_sha: BASE_SHA, head_sha: HEAD_SHA, start_sha: BASE_SHA},
            changes: [CHANGED_FILE]
          })
        ],
        [/\/merge_requests\/\d+\/versions$/, () => []],
        [/\/merge_requests\/\d+\/commits/, () => [{id: HEAD_SHA, title: '加一行'}]],
        [/\/merge_requests\/\d+\/discussions/, () => []],
        [/\/merge_requests\/\d+\/notes/, () => []],
        [/\/merge_requests\/\d+\/award_emoji/, () => []],
        [
          /\/merge_requests\/\d+$/,
          () => ({
            iid: MR_IID,
            title: '裸环境验收用 MR',
            description: st.description,
            state: 'opened',
            source_branch: 'feature',
            target_branch: 'main',
            author: {username: 'alice'},
            sha: HEAD_SHA,
            diff_refs: {base_sha: BASE_SHA, head_sha: HEAD_SHA, start_sha: BASE_SHA}
          })
        ],
        [/\/repository\/tree/, () => [{path: 'src/a.ts', type: 'blob'}]],
        [
          /\/repository\/compare/,
          () => ({commits: [{id: HEAD_SHA, title: '加一行'}], diffs: [CHANGED_FILE]})
        ],
        [/\/members\/all\/[^/]+$/, () => ({id: 2, username: 'alice', access_level: 40})],
        [/\/repository\/files\//, () => 'const a = 1\nexport {a}\n']
      ]

      for (const [pattern, handler] of routes) {
        if (!pattern.test(path)) continue
        const payload = handler()
        if (typeof payload === 'string') {
          res.writeHead(200, {'content-type': 'text/plain'})
          return res.end(payload)
        }
        return sendJson(payload)
      }

      sendJson({message: `404 Not Found (bare-env stub): ${path}`}, 404)
    })
    server.listen(0, '127.0.0.1', () => resolve({server, port: server.address().port}))
  })
}

// ═══════════════════════ 裸环境构造与运行 ═══════════════════════════════════

/** 摆一批可执行的假 lint 工具，被调用就往 sentinel 追加一行 */
function plantDecoys(sandbox, sentinel) {
  const bin = join(sandbox, 'decoy-bin')
  mkdirSync(bin, {recursive: true})
  for (const tool of DECOY_TOOLS) {
    writeFileSync(join(bin, tool), `#!/bin/sh\necho "${tool} $*" >> "${sentinel}"\nexit 0\n`, {
      mode: 0o755
    })
  }
  return bin
}

/**
 * 陈旧 bundle 守卫。
 *
 * 这个脚本测的是打包产物，不是 src/。若 dist 比 src 旧，跑出来的绿是上一版
 * 的绿——review 时就踩过一次：源码已加门禁，dist 还是旧逻辑，诱饵照样被调用。
 */
function assertBundleFresh(bundle) {
  if (!existsSync(bundle)) {
    console.log(`FAIL: ${bundle} 不存在——先跑 npm run package`)
    process.exit(1)
  }
  const bundleAt = statSync(bundle).mtimeMs
  const newest = newestMtime(join(process.cwd(), 'src'))
  if (newest > bundleAt) {
    console.log(`FAIL: dist/gitlab-trigger/index.js 比 src/ 旧——先跑 npm run package`)
    console.log(`      bundle: ${new Date(bundleAt).toISOString()}`)
    console.log(`      src   : ${new Date(newest).toISOString()}`)
    process.exit(1)
  }
}

function newestMtime(dir) {
  let newest = 0
  for (const entry of readdirSync(dir, {withFileTypes: true})) {
    const full = join(dir, entry.name)
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(full) : statSync(full).mtimeMs)
  }
  return newest
}

async function runOnce({withDecoys}) {
  const state = newState()
  const {server, port} = await startStub(() => state)
  const base = `http://127.0.0.1:${port}`

  const sandbox = mkdtempSync(join(tmpdir(), 'ai-reviewer-bare-'))
  const home = join(sandbox, 'home')
  const cache = join(sandbox, 'cache')
  const sentinel = join(sandbox, 'tool-invocations.log')
  const egressLog = join(sandbox, 'egress-attempts.log')
  mkdirSync(home, {recursive: true})
  mkdirSync(cache, {recursive: true})

  const payloadPath = join(sandbox, 'payload.json')
  writeFileSync(
    payloadPath,
    JSON.stringify({
      object_kind: 'merge_request',
      project: {id: PROJECT_ID, path_with_namespace: 'group/demo'},
      user: {username: 'alice'},
      object_attributes: {
        iid: MR_IID,
        action: 'open',
        source_project_id: PROJECT_ID,
        target_project_id: PROJECT_ID,
        last_commit: {id: HEAD_SHA}
      }
    })
  )

  // PATH 白名单：只有 node 自己的目录。诱饵轮额外挂一个 bin 目录。
  const nodeDir = dirname(process.execPath)
  const decoyBin = withDecoys ? plantDecoys(sandbox, sentinel) : null
  const bundle = join(process.cwd(), 'dist/gitlab-trigger/index.js')
  assertBundleFresh(bundle)
  const guard = join(process.cwd(), 'scripts/bare-env-egress-guard.cjs')
  const child = spawn(process.execPath, [bundle], {
    cwd: sandbox, // 无 node_modules，无 package.json，无 .git
    env: {
      // 白名单式构造，不继承调用者环境——继承会把本机 PATH、缓存目录、代理设置
      // 和可能存在的 GITHUB_* 一起带进来，「裸环境」就名存实亡了。
      PATH: decoyBin ? `${decoyBin}:${nodeDir}` : nodeDir,
      HOME: home,
      XDG_CACHE_HOME: cache,
      npm_config_cache: cache,
      CI_SERVER_URL: base,
      GITLAB_PAT: 'glpat-bare-env-placeholder',
      TRIGGER_PAYLOAD: payloadPath,
      OPENAI_API_KEY: 'sk-bare-env-placeholder',
      AI_REVIEWER_OPENAI_BASE_URL: `${base}/v1`,
      AI_REVIEWER_BOT_GITLAB_LOGIN: 'ai-reviewer',
      // 真正的断网层：非 loopback 的 DNS 解析与 socket 连接一律拒绝并记账
      NODE_OPTIONS: `--require ${guard}`,
      BARE_ENV_EGRESS_LOG: egressLog
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })

  let out = ''
  child.stdout.on('data', d => (out += d))
  child.stderr.on('data', d => (out += d))
  const code = await new Promise(resolve => {
    const t = setTimeout(() => {
      child.kill('SIGKILL')
      resolve('TIMEOUT')
    }, 180000)
    child.on('close', c => {
      clearTimeout(t)
      resolve(c)
    })
  })

  const invocations = existsSync(sentinel) ? readFileSync(sentinel, 'utf8').trim() : ''
  const egress = existsSync(egressLog) ? readFileSync(egressLog, 'utf8').trim() : ''
  server.close()
  rmSync(sandbox, {recursive: true, force: true})
  return {code, out, invocations, egress, ...state}
}

// ═══════════════════════ 断言 ═══════════════════════════════════════════════

let failed = false
function check(label, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`)
  if (!ok) {
    failed = true
    if (detail) console.log(String(detail).split('\n').slice(0, 25).join('\n'))
  }
}

/** 审查是否真的产出了东西——四件产物缺一不可 */
function assertReviewCompleted(prefix, r) {
  check(`${prefix} 进程正常退出`, r.code === 0, `exit=${r.code}\n${r.out}`)
  check(
    `${prefix} 发布了进度横幅`,
    r.notes.some(n => n.includes('in-progress-start')),
    JSON.stringify(r.notes)
  )
  check(
    `${prefix} 发布了摘要评论并记录已审查 SHA`,
    r.notes.some(n => n.includes('commit-ids-reviewed-start') && n.includes(HEAD_SHA)),
    JSON.stringify(r.notes)
  )
  check(
    `${prefix} 发布了行级评论（走 discussions）`,
    r.discussions.length > 0 && String(r.discussions[0]?.body ?? '').includes('const 断言'),
    JSON.stringify(r.discussions)
  )
  check(
    `${prefix} release notes 写入 description 且保留作者原文`,
    r.description.includes('release-notes-start') &&
      r.description.includes('新增了裸环境验收脚本') &&
      r.description.includes(ORIGINAL_DESCRIPTION),
    r.description
  )
  // 无外网：拦截层的账本必须是空的。
  // 之前这里断言的是「输出里没有 ENOTFOUND/ECONNREFUSED」——那只说明没报错，
  // 成功访问一个别的外部地址反而完全看不出来，方向是反的。
  check(`${prefix} 零非 loopback 出网尝试`, r.egress === '', `被拦下的出口：\n${r.egress}`)
}

async function main() {
  console.log('--- LINT-002 ①：裸环境（无外网 / 空缓存 / 未安装 lint 工具）---')
  const bare = await runOnce({withDecoys: false})
  assertReviewCompleted('裸环境', bare)

  console.log('')
  console.log('--- LINT-002 ②：诱饵对照（PATH 上摆可执行的假 lint 工具）---')
  // 这一轮回答「①的绿是不是因为工具不存在才安静」。若审查真会去调工具，诱饵
  // 会留下痕迹；没有痕迹才说明它压根没尝试，而不是尝试后静默降级——后者在真实
  // GitLab job 里同样显示为绿，只看日志分不出来。
  const decoy = await runOnce({withDecoys: true})
  assertReviewCompleted('诱饵环境', decoy)
  check(
    '诱饵环境 零外部命令调用（LOCAL-001/002、LINT-001）',
    decoy.invocations === '',
    `实际被调用：\n${decoy.invocations}`
  )

  console.log('')
  if (failed) {
    console.log('LINT-002 验收未通过')
    process.exit(1)
  }
  console.log('LINT-002 验收通过：裸环境下 API-only 审查完整跑通，且零本地工具调用')
}

main().catch(e => {
  console.error('LINT-002 验收脚本自身出错:', e)
  process.exit(1)
})
