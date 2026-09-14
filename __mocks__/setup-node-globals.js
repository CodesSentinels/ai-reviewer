// Jest 27 + Node 18: expose Web Streams globals that undici depends on.
// Required for tests that use the real @octokit/action (integration tests).
const {ReadableStream, WritableStream, TransformStream} = require('stream/web')
if (!global.ReadableStream) global.ReadableStream = ReadableStream
if (!global.WritableStream) global.WritableStream = WritableStream
if (!global.TransformStream) global.TransformStream = TransformStream

// @octokit/auth-action throws at module load time if GITHUB_ACTION is absent.
// Integration tests mock src/octokit entirely (bypassing auth-action), but setting
// this placeholder prevents spurious errors if the module is transitively imported.
if (!process.env.GITHUB_ACTION) {
  process.env.GITHUB_ACTION = 'local'
}


// OpenAI SDK 在构造时要求全局 fetch。Node 18+ 原生提供，但 jest 的
// testEnvironment 沙箱不把它挂到 global 上，构造 Bot 就会抛
// "`fetch` is not defined as a global"。
//
// undici 是 devDependency（显式声明）。此前这里直接 require 一个只是恰好被
// 提升到顶层的间接依赖——依赖升级或换包管理器后测试会直接起不来。
if (!global.fetch) {
  const {fetch, Headers, Request, Response} = require('undici')
  global.fetch = fetch
  global.Headers = Headers
  global.Request = Request
  global.Response = Response
}
