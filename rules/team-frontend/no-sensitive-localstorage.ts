// rules/team-frontend/no-sensitive-localstorage.ts
//
// semgrep --test 样例文件。注释约定与跑法详见同目录 README.md。
// 这里是伪代码，semgrep 只做静态模式匹配。

// ─── 必须命中 ────────────────────────────────────────────

function loginBad1(token: string) {
  // ruleid: no-sensitive-localstorage
  localStorage.setItem('auth_token', token)
}

function loginBad2(pwd: string) {
  // ruleid: no-sensitive-localstorage
  localStorage.setItem('userPassword', pwd)
}

function loginBad3(jwt: string) {
  // ruleid: no-sensitive-localstorage
  localStorage.setItem('JWT', jwt) // 大小写不敏感
}

function loginBad4(key: string) {
  // ruleid: no-sensitive-localstorage
  localStorage.setItem('api-key', key)
}

function loginBad5(key: string) {
  // ruleid: no-sensitive-localstorage
  localStorage.setItem('api_key_v2', key) // 下划线变体
}

function loginBad6(refresh: string) {
  // ruleid: no-sensitive-localstorage
  sessionStorage.setItem('refresh_token', refresh)
}

function loginBad7(cred: string) {
  // ruleid: no-sensitive-localstorage
  window.localStorage.setItem('user_credential', cred)
}

function loginBad8(sid: string) {
  // ruleid: no-sensitive-localstorage
  sessionStorage.setItem('session_id', sid)
}

function loginBad9(secret: string) {
  // ruleid: no-sensitive-localstorage
  localStorage.setItem(`my_secret_v2`, secret) // 模板字面量也算
}

function loginBad10(token: string) {
  // ruleid: no-sensitive-localstorage
  globalThis.localStorage.setItem('access_token', token)
}

// ─── 不应该命中 ──────────────────────────────────────────

// 无害的 key 名
function savePref() {
  // ok: no-sensitive-localstorage
  localStorage.setItem('theme', 'dark')
}

function saveUserPref(json: string) {
  // ok: no-sensitive-localstorage
  localStorage.setItem('user_preferences', json)
}

// "auth" 单独出现不算 —— 故意豁免，避免 isAuthenticated / authProvider 这类 FP
function saveAuthState() {
  // ok: no-sensitive-localstorage
  localStorage.setItem('isAuthenticated', 'true')
}

function saveAuthProvider() {
  // ok: no-sensitive-localstorage
  localStorage.setItem('authProvider', 'google')
}

// 读 / 删 —— 规则只盯 setItem
function readToken() {
  // ok: no-sensitive-localstorage
  return localStorage.getItem('auth_token')
}

function clearToken() {
  // ok: no-sensitive-localstorage
  localStorage.removeItem('auth_token')
}

// 已知漏报（demo 故意保留）：变量形式的 key 当前规则抓不到。
// 修复需要升级到 taint 模式，把"敏感字符串字面量"作为 source、setItem 作为 sink。
function loginVariableKey(token: string) {
  const k = 'auth_token'
  // ok: no-sensitive-localstorage
  localStorage.setItem(k, token)
}
