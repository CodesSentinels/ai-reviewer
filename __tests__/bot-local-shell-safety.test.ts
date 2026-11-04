/**
 * bot-local-shell-safety.test.ts — 本地 shell 的超时、输出上限与脱敏
 *
 * 回归：shell 输出此前没有任何脱敏，只在启动子进程前删掉 4 个固定环境变量键。
 * 凭据只要出现在文件或命令输出里，就会原样回到模型上下文。
 */
import {afterEach, describe, expect, test} from '@jest/globals'
import {Bot} from '../src/bot'

const mk = (): any => {
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? 'sk-dummy-for-test'
  return new Bot(
    {openaiModelTemperature: 0, systemMessage: ''} as any,
    {
      model: 'gpt-5.4-mini',
      tokenLimits: {responseTokens: 1000},
      enableWebSearch: false,
      enableShell: true
    } as any
  )
}

const call = (commands: string[], extra: Record<string, unknown> = {}) => ({
  call_id: 'c1',
  action: {commands, ...extra}
})

describe('local shell safety', () => {
  const OLD = {...process.env}
  afterEach(() => {
    process.env = {...OLD}
  })

  test('超时：超过 timeout_ms 的命令被终止并报告 timeout', async () => {
    const out = await mk().runLocalShellCall(call(['sleep 10'], {timeout_ms: 500}))
    expect(out.output[0].outcome).toEqual({type: 'timeout'})
  })

  test('输出上限：默认 4096 字符，超出部分带截断标记', async () => {
    const out = await mk().runLocalShellCall(call(["head -c 20000 /dev/zero | tr '\\0' 'a'"]))
    const s = out.output[0].stdout as string
    expect(s.length).toBeLessThanOrEqual(4096 + 40)
    expect(s).toContain('(truncated)')
  })

  test('max_output_length 被遵守', async () => {
    const out = await mk().runLocalShellCall(
      call(["head -c 5000 /dev/zero | tr '\\0' 'b'"], {max_output_length: 100})
    )
    expect((out.output[0].stdout as string).length).toBeLessThanOrEqual(140)
  })

  test('固定名单与“看起来像密钥”的环境变量都不进入子进程，普通变量保留', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-should-not-leak'
    process.env.GITHUB_TOKEN = 'ghs_test_should_not_leak'
    process.env.MY_SERVICE_TOKEN = 'service-token-value'
    process.env.DEPLOY_SECRET = 'deploy-secret-value'
    process.env.FT_PLAIN_SETTING = 'plain-value'
    const out = await mk().runLocalShellCall(
      call([
        'echo "O=[$OPENAI_API_KEY] G=[$GITHUB_TOKEN] T=[$MY_SERVICE_TOKEN] S=[$DEPLOY_SECRET] P=[$FT_PLAIN_SETTING]"'
      ])
    )
    const s = out.output[0].stdout as string
    expect(s).toContain('O=[] G=[] T=[] S=[]')
    expect(s).toContain('P=[plain-value]')
  })

  test('输出里的 token 形态字符串被脱敏', async () => {
    const out = await mk().runLocalShellCall(
      call([
        "echo 'key=sk-proj-FAKEFAKEFAKEFAKEFAKE1234 gh=ghp_FAKEFAKEFAKEFAKEFAKEFAKEFAKE123456'"
      ])
    )
    const s = out.output[0].stdout as string
    expect(s).not.toContain('sk-proj-FAKEFAKEFAKEFAKEFAKE1234')
    expect(s).not.toContain('ghp_FAKEFAKEFAKEFAKEFAKEFAKEFAKE123456')
    expect(s).toContain('***')
  })

  test('本进程环境里的密钥值（例如被写进文件的凭据）出现在输出里也被脱敏', async () => {
    process.env.SOME_RUNNER_PASSWORD = 'correct-horse-battery-staple'
    const out = await mk().runLocalShellCall(
      call(["echo 'password is correct-horse-battery-staple'"])
    )
    const s = out.output[0].stdout as string
    expect(s).not.toContain('correct-horse-battery-staple')
  })

  test('stderr 同样脱敏', async () => {
    const out = await mk().runLocalShellCall(
      call(["echo 'token=ghp_FAKEFAKEFAKEFAKEFAKEFAKEFAKE123456' 1>&2"])
    )
    expect(out.output[0].stderr as string).not.toContain('ghp_FAKEFAKEFAKEFAKEFAKEFAKEFAKE123456')
  })
})
