// rules/team-frontend/no-direct-fetch.ts
//
// semgrep --test 的测试样例文件。注释约定与跑法详见同目录 README.md。
//
// 这里写的是伪代码（apiClient / jest / vi 在真实仓库才有），semgrep 只做
// 静态模式匹配，不做类型/解析检查，所以这样写没问题。

import {apiClient} from '@/api/apiClient'

// ─── 应该命中的写法 ────────────────────────────────────────────

async function fetchUserBad() {
  // ruleid: no-direct-fetch
  const res = await fetch('/api/user')
  return res.json()
}

async function fetchUserBadWindow() {
  // ruleid: no-direct-fetch
  const res = await window.fetch('/api/user')
  return res.json()
}

async function fetchUserBadGlobal() {
  // ruleid: no-direct-fetch
  const res = await globalThis.fetch('/api/user')
  return res.json()
}

function postOrderBad(body: unknown) {
  // ruleid: no-direct-fetch
  return fetch('/api/orders', {method: 'POST', body: JSON.stringify(body)})
}

// ─── 不应该命中的写法 ──────────────────────────────────────────

// 用 apiClient — 合规
async function fetchUserGood() {
  // ok: no-direct-fetch
  const data = await apiClient.get('/api/user')
  return data
}

// 仅引用 fetch 标识符（不是调用）— 不命中
function logFetchRef() {
  // ok: no-direct-fetch
  console.log(fetch)
}

// jest.mock 内部用 fetch — 豁免（mock 上下文）
;(function setupJestMock() {
  jest.mock('@/api/client', () => ({
    apiClient: {
      // ok: no-direct-fetch
      get: () => fetch('/mock-url'),
    },
  }))
})()

// vi.mock 内部用 fetch — 豁免
;(function setupVitestMock() {
  vi.mock('@/api/client', () => ({
    apiClient: {
      // ok: no-direct-fetch
      get: () => fetch('/mock-url'),
    },
  }))
})()

// mockImplementation 注入 — 豁免
;(function setupSpyMock() {
  const stub = (globalThis as any).fetch as jest.Mock
  stub.mockImplementation(() => {
    // ok: no-direct-fetch
    return fetch('/replacement')
  })
})()

// 下面这些声明只为让 TS 不报"未定义"——semgrep 不读类型，但你想本地编辑时不挂红
declare const jest: {mock: (m: string, f: () => unknown) => void}
declare const vi: {mock: (m: string, f: () => unknown) => void}
