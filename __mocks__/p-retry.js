// p-retry 是纯 ESM，ts-jest 的 CommonJS 转译加载不了它。
//
// 生产代码只用它包一层重试；测试里关心的是被包裹逻辑本身的行为，不是重试策略，
// 因此这里直接执行一次。需要验证重试语义的用例应当单独 mock 或走集成测试。
module.exports = async function pRetry(fn, _options) {
  return await fn(1)
}
module.exports.default = module.exports
module.exports.AbortError = class AbortError extends Error {}
