// 回测驱动：在 runner 里以 GitHub Action 的方式运行 dist/index.js。
//  - pull_request（opened/synchronize/reopened）：用原生事件载荷直接跑一次审查
//  - pull_request labeled 且标签形如 replay-<id> 或 replay-<起>-<止>：把对应的人工评论
//    重放成 issue_comment / pull_request_review_comment 事件（issue_comment 只会运行默认分支的
//    workflow，所以分支上测不到，只能在 runner 里构造事件）
const fs = require('fs')
const path = require('path')
const {spawnSync} = require('child_process')
const yaml = require('js-yaml')

const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
const cfgPath = '.github/regress/config.json'
const cfg = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, 'utf8')) : {}
const api = async (url, init = {}) => {
  const r = await fetch(`https://api.github.com${url}`, {
    ...init,
    headers: {authorization: `Bearer ${process.env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json'}
  })
  if (!r.ok) throw new Error(`${url} → ${r.status}`)
  return r.json()
}

function inputEnv() {
  const action = yaml.load(fs.readFileSync('action.yml', 'utf8'))
  const env = {}
  for (const [k, v] of Object.entries(action.inputs)) {
    if (v.default != null) env[`INPUT_${k.replace(/ /g, '_').toUpperCase()}`] = String(v.default)
  }
  const forced = {
    debug: 'true',
    openai_base_url: 'http://127.0.0.1:18080/v1',
    enable_shell: 'false',
    enable_web_search: 'false',
    enable_lint_tools: 'false',
    ...(cfg.inputs || {})
  }
  for (const [k, v] of Object.entries(forced)) env[`INPUT_${k.toUpperCase()}`] = String(v)
  return env
}

function runAction(eventName, eventPath, title) {
  console.log(`::group::${title}`)
  const r = spawnSync('node', ['dist/index.js'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      ...inputEnv(),
      OPENAI_API_KEY: 'stub-key',
      GITHUB_EVENT_NAME: eventName,
      GITHUB_EVENT_PATH: eventPath
    }
  })
  console.log('::endgroup::')
  console.log(`RESULT ${title}: exit=${r.status}`)
  return r.status
}

async function main() {
  if (process.env.GITHUB_EVENT_NAME !== 'pull_request') return
  if (['opened', 'synchronize', 'reopened'].includes(event.action)) {
    process.exit(runAction('pull_request', process.env.GITHUB_EVENT_PATH, `pr ${event.action} @${event.pull_request.head.sha.slice(0, 7)}`) || 0)
  }
  if (event.action !== 'labeled') return
  const m = /^replay-(\d+)(?:-(\d+))?$/.exec(event.label.name)
  if (!m) return
  const [from, to] = [Number(m[1]), Number(m[2] || m[1])]
  const repo = process.env.GITHUB_REPOSITORY
  const num = event.pull_request.number
  const issue = await api(`/repos/${repo}/issues/${num}`)
  const repository = await api(`/repos/${repo}`)
  const comments = [
    ...(await api(`/repos/${repo}/issues/${num}/comments?per_page=100`)).map(c => ({c, kind: 'issue_comment'})),
    ...(await api(`/repos/${repo}/pulls/${num}/comments?per_page=100`)).map(c => ({c, kind: 'pull_request_review_comment'}))
  ]
    .filter(x => x.c.id >= from && x.c.id <= to && x.c.user.type !== 'Bot')
    .sort((a, b) => a.c.id - b.c.id)
  console.log(`replaying ${comments.length} comment(s) in [${from}, ${to}]`)
  for (const {c, kind} of comments) {
    const payload =
      kind === 'issue_comment'
        ? {action: 'created', issue, comment: c, repository, sender: c.user}
        : {action: 'created', pull_request: event.pull_request, comment: c, repository, sender: c.user}
    const p = path.join(process.env.RUNNER_TEMP, `event-${c.id}.json`)
    fs.writeFileSync(p, JSON.stringify(payload))
    runAction(kind, p, `${kind} ${c.id}: ${c.body.split('\n')[0].slice(0, 60)}`)
  }
}
main().catch(e => {
  console.error(e)
  process.exit(1)
})
