/**
 * fetch-polyfill.js - Node.js Fetch API 垫片
 *
 * 在 Node.js 环境中填充全局 fetch API（fetch, Headers, Request, Response）。
 * chatgpt 库依赖全局 fetch，而旧版 Node.js 不内置 fetch，
 * 因此通过 node-fetch 库提供兼容性支持。
 * 仅在 globalThis.fetch 不存在时填充，避免覆盖原生实现。
 *
 * 由 bot.ts 在文件顶部导入，确保在 ChatGPTAPI 初始化前完成填充。
 */
import fetch, {Headers, Request, Response} from 'node-fetch'

if (!globalThis.fetch) {
  globalThis.fetch = fetch
  globalThis.Headers = Headers
  globalThis.Request = Request
  globalThis.Response = Response
}
