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

