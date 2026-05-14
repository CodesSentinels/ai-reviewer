// CommonJS shim for p-limit (ESM-only) in Jest test environment.
// Concurrency is not under test; this shim passes calls through directly.
module.exports = () => fn => fn()
