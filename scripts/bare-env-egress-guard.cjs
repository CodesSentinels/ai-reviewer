/**
 * bare-env-egress-guard.cjs — 裸环境验收的出口拦截层
 *
 * 由 bare-env-review-check.mjs 通过 `NODE_OPTIONS=--require` 注入被测子进程。
 *
 * 为什么需要它：把 GitLab / OpenAI 的地址指向 loopback，只能证明「这两个已知
 * 端点走了 stub」，证明不了「没有出网」——操作系统的网络和 DNS 仍然可用，代码
 * 若访问任何别的外部地址，验收照样会绿。所以这里在子进程里真正把出口堵死：
 *
 *   dns.lookup / dns.promises.lookup —— 非 loopback 主机名直接解析失败
 *   net.Socket.prototype.connect     —— 非 loopback 目标直接拒绝
 *   tls.connect                      —— 同上（它内部虽然也走 net，但入口另算）
 *
 * undici（Node 内置 fetch，gitbeaker 与 openai SDK 都用它）最终落到
 * net.connect，因此这一层能覆盖到。
 *
 * 每次拦截都追加一行到 `BARE_ENV_EGRESS_LOG` 指向的文件。验收脚本断言该文件
 * 为空——不是「没看到连接错误」，而是「没有任何非 loopback 出口尝试」。
 */
const net = require('net')
const tls = require('tls')
const dns = require('dns')
const fs = require('fs')

const LOG = process.env.BARE_ENV_EGRESS_LOG

function record(what) {
  if (LOG) {
    try {
      fs.appendFileSync(LOG, `${what}\n`)
    } catch {
      // 记不下来也不能影响被测进程的行为
    }
  }
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', ''])

function isLoopback(host) {
  if (host == null) return true // unix socket / 无主机名，不是网络出口
  const h = String(host)
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
  return LOOPBACK_HOSTS.has(h) || h.startsWith('127.')
}

// ── DNS ──────────────────────────────────────────────────────────────────────
const realLookup = dns.lookup
dns.lookup = function (hostname, options, callback) {
  if (!isLoopback(hostname)) {
    record(`dns.lookup ${hostname}`)
    const cb = typeof options === 'function' ? options : callback
    const err = Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), {
      code: 'ENOTFOUND',
      errno: -3008,
      syscall: 'getaddrinfo',
      hostname
    })
    if (typeof cb === 'function') return process.nextTick(() => cb(err))
    throw err
  }
  return realLookup.apply(this, arguments)
}

const realLookupPromise = dns.promises.lookup
dns.promises.lookup = async function (hostname, ...rest) {
  if (!isLoopback(hostname)) {
    record(`dns.promises.lookup ${hostname}`)
    throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), {
      code: 'ENOTFOUND',
      hostname
    })
  }
  return realLookupPromise.call(this, hostname, ...rest)
}

// ── socket ───────────────────────────────────────────────────────────────────

/** connect() 的重载很多：(options[,cb]) / (port[,host][,cb]) / (path[,cb]) */
function hostOf(args) {
  const [first, second] = args
  if (first != null && typeof first === 'object') {
    return first.path != null ? null : first.host
  }
  return typeof second === 'string' ? second : null
}

function guardConnect(realConnect, label) {
  return function (...args) {
    const host = hostOf(args)
    if (!isLoopback(host)) {
      record(`${label} ${host}`)
      const err = Object.assign(new Error(`connect ECONNREFUSED ${host} (bare-env egress guard)`), {
        code: 'ECONNREFUSED',
        address: host
      })
      // 交给调用方的错误通道，不直接 throw——同步抛会绕过上层的重试/降级逻辑，
      // 那样测出来的就不是"断网下的真实行为"了。
      const self = this
      process.nextTick(() => {
        if (typeof self?.emit === 'function') self.emit('error', err)
      })
      return this
    }
    return realConnect.apply(this, args)
  }
}

net.Socket.prototype.connect = guardConnect(net.Socket.prototype.connect, 'net.connect')

const realTlsConnect = tls.connect
tls.connect = function (...args) {
  const host = hostOf(args)
  if (!isLoopback(host)) {
    record(`tls.connect ${host}`)
    const socket = new net.Socket()
    process.nextTick(() => {
      socket.emit(
        'error',
        Object.assign(new Error(`connect ECONNREFUSED ${host} (bare-env egress guard)`), {
          code: 'ECONNREFUSED',
          address: host
        })
      )
    })
    return socket
  }
  return realTlsConnect.apply(this, args)
}
