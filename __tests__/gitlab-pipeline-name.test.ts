import {describe, expect, jest, test} from '@jest/globals'
import {
  RunOutcome,
  buildPipelineName,
  describeTrigger,
  observingLogger,
  renamePipeline
} from '../src/platform/gitlab-pipeline-name'
import {stateMarker} from '../src/state-markers'
import type {Logger} from '../src/platform/logger'

const BOT = 'project_1_bot'
const HEAD = '0aec0f49d8e2b1c3a4f5e6d7c8b9a0f1e2d3c4b5'

function mrHook(attrs: Record<string, unknown>, user = 'alice'): unknown {
  return {
    object_kind: 'merge_request',
    user: {username: user},
    object_attributes: {iid: 15, last_commit: {id: HEAD}, ...attrs}
  }
}

function noteHook(attrs: Record<string, unknown>, user = 'alice'): unknown {
  return {
    object_kind: 'note',
    user: {username: user},
    object_attributes: {action: 'create', note: 'hi', ...attrs},
    merge_request: {iid: 15, last_commit: {id: HEAD}}
  }
}

function silentLogger(): Logger & {lines: string[]} {
  const lines: string[] = []
  return {
    lines,
    info: m => lines.push(`info: ${m}`),
    warning: m => lines.push(`warning: ${m}`),
    error: m => lines.push(`error: ${m}`),
    debug: m => lines.push(`debug: ${m}`)
  }
}

describe('describeTrigger', () => {
  test.each([
    [{action: 'open'}, 'MR 创建'],
    [{action: 'reopen'}, 'MR 重新打开'],
    [{action: 'update', oldrev: 'abc'}, 'push'],
    [{action: 'update'}, 'MR 信息更新'],
    [{action: 'merge'}, 'MR merge']
  ])('MR 事件 %j → %s', (attrs, label) => {
    expect(describeTrigger(mrHook(attrs), [BOT])).toEqual({
      mrIid: 15,
      headSha: HEAD,
      byBot: false,
      label
    })
  })

  test('bot 对 MR 的操作只可能是改描述', () => {
    const t = describeTrigger(mrHook({action: 'update'}, BOT), [BOT])
    expect(t).toMatchObject({byBot: true, label: 'bot 更新 MR 描述'})
  })

  test('bot 身份比较不区分大小写', () => {
    expect(describeTrigger(noteHook({}, 'Project_1_Bot'), [BOT]).byBot).toBe(true)
  })

  test.each([
    [{note: `摘要\n${stateMarker('summarize')}`}, 'bot 发布摘要'],
    [{action: 'update', note: `摘要\n${stateMarker('summarize')}`}, 'bot 更新摘要'],
    [{action: 'update'}, 'bot 更新评论'],
    [{type: 'DiffNote'}, 'bot 发布行级评论'],
    [{}, 'bot 发布评论']
  ])('bot 的 note %j → %s', (attrs, label) => {
    expect(describeTrigger(noteHook(attrs, BOT), [BOT])).toMatchObject({
      mrIid: 15,
      headSha: HEAD,
      byBot: true,
      label
    })
  })

  test.each([
    [{}, '评论'],
    [{type: 'DiffNote'}, '行级评论'],
    [{action: 'update'}, '评论被编辑']
  ])('用户的 note %j → %s', (attrs, label) => {
    expect(describeTrigger(noteHook(attrs), [BOT])).toMatchObject({byBot: false, label})
  })

  test('名字里不带评论正文', () => {
    const t = describeTrigger(noteHook({note: '@ai-reviewer full review <secret>'}), [BOT])
    expect(JSON.stringify(t)).not.toContain('secret')
  })

  test('payload 缺失或不认识的事件', () => {
    expect(describeTrigger(null, [])).toEqual({
      mrIid: null,
      headSha: '',
      byBot: false,
      label: '事件 未知'
    })
    expect(describeTrigger({object_kind: 'push'}, []).label).toBe('事件 push')
  })
})

describe('RunOutcome', () => {
  function outcomeOf(lines: string[], failed = false): string {
    const o = new RunOutcome()
    lines.forEach(l => o.observe(l))
    return o.describe(failed)
  }

  test('审查完成并发布评论', () => {
    expect(
      outcomeOf([
        'Will review from commit: abc',
        'Submitting review for PR #15, delivered: 2, failed: 0, staleSkipped: 0'
      ])
    ).toBe('审查完成，发布 2 条评论')
  })

  test('审查完成但没有新评论', () => {
    expect(outcomeOf(['Will review from the base commit: abc'])).toBe('审查完成，无新评论')
  })

  test('审查中途跳过按跳过报告，并归类原因', () => {
    expect(outcomeOf(['Will review from commit: abc', 'Skipped: files is null'])).toBe(
      '已跳过：无可审查文件'
    )
    expect(outcomeOf(['Skipped: no files to review'])).toBe('已跳过：无可审查文件')
    expect(outcomeOf(['Skipped: review automation is paused for this PR'])).toBe(
      '已跳过：自动审查已暂停'
    )
  })

  test('认不出的跳过原因只报「已跳过」', () => {
    expect(outcomeOf(["Skipped: note action is 'update', not 'create' — ignorable"])).toBe('已跳过')
  })

  test('命令执行结果', () => {
    expect(
      outcomeOf([
        'commentEvent dispatcher outcome: {"kind":"executed","command":"full review","ok":true}'
      ])
    ).toBe('命令 full review 完成')
    expect(
      outcomeOf([
        'commentEvent dispatcher outcome: {"kind":"executed","command":"pause","ok":false}'
      ])
    ).toBe('命令 pause 未完成')
  })

  test('对话式追问与被忽略的评论', () => {
    expect(outcomeOf(['commentEvent dispatcher outcome: {"kind":"fallback_conversation"}'])).toBe(
      '已回复'
    )
    expect(
      outcomeOf(['commentEvent dispatcher outcome: {"kind":"ignored","reason":"no bot mention"}'])
    ).toBe('已跳过：无需处理')
  })

  test('入口直接判断的跳过，以第一个原因为准', () => {
    const o = new RunOutcome()
    o.skip('HEAD 已变化')
    o.observe('Skipped: files is null')
    expect(o.describe(false)).toBe('已跳过：HEAD 已变化')
  })

  test('失败优先于其他结论', () => {
    expect(outcomeOf(['Will review from commit: abc'], true)).toBe('失败')
  })

  test('没有任何信号时报「已处理」', () => {
    expect(outcomeOf(['something else'])).toBe('已处理')
  })
})

describe('buildPipelineName', () => {
  test('用户操作：MR 编号 + 短 SHA + 触发原因 → 结论', () => {
    const t = describeTrigger(mrHook({action: 'update', oldrev: 'x'}), [BOT])
    expect(buildPipelineName(t, '审查完成，发布 1 条评论')).toBe(
      'MR !15 @0aec0f4 · push → 审查完成，发布 1 条评论'
    )
  })

  test('bot 的操作缩进显示', () => {
    const t = describeTrigger(noteHook({type: 'DiffNote'}, BOT), [BOT])
    expect(buildPipelineName(t, '已跳过')).toBe('MR !15 @0aec0f4 · ↳ bot 发布行级评论 · 已跳过')
  })

  test('没有 MR 信息时退回通用前缀', () => {
    expect(buildPipelineName(describeTrigger(null, []), '失败')).toBe('AI 审查 · 事件 未知 → 失败')
  })

  test('超长时截断到 255 个字符', () => {
    const t = {mrIid: 1, headSha: '', byBot: false, label: 'x'.repeat(300)}
    const name = buildPipelineName(t, 'ok')
    expect(name.length).toBe(255)
    expect(name.endsWith('…')).toBe(true)
  })
})

describe('renamePipeline', () => {
  const CI_ENV = {
    CI_SERVER_URL: 'https://gitlab.example.com',
    CI_PROJECT_ID: '41',
    CI_PIPELINE_ID: '1169',
    AI_REVIEWER_PIPELINE_TOKEN: 'tok'
  }

  function fakeClient(put: (...args: any[]) => Promise<unknown>) {
    const configs: any[] = []
    const create = (config: any): any => {
      configs.push(config)
      return {Pipelines: {requester: {put}}}
    }
    return {create, configs}
  }

  test('经 gitbeaker client 调用 pipeline metadata 接口改名', async () => {
    const put = jest.fn<(...args: any[]) => Promise<unknown>>().mockResolvedValue({})
    const client = fakeClient(put)
    const logger = silentLogger()
    await renamePipeline('MR !15 · push → 审查完成', logger, CI_ENV, client.create)

    expect(client.configs).toEqual([
      {
        host: 'https://gitlab.example.com',
        credential: {type: 'pat', value: 'tok'},
        timeoutMS: 10_000
      }
    ])
    expect(put).toHaveBeenCalledWith('projects/41/pipelines/1169/metadata', {
      body: {name: 'MR !15 · push → 审查完成'}
    })
    expect(logger.lines).toEqual([])
  })

  test('没配 token：不调用接口，只记一条 debug 日志', async () => {
    const put = jest.fn<(...args: any[]) => Promise<unknown>>()
    const logger = silentLogger()
    await renamePipeline(
      'n',
      logger,
      {...CI_ENV, AI_REVIEWER_PIPELINE_TOKEN: ' '},
      fakeClient(put).create
    )
    expect(put).not.toHaveBeenCalled()
    expect(logger.lines).toEqual([
      'debug: pipeline name: AI_REVIEWER_PIPELINE_TOKEN is not set, keeping the default name'
    ])
  })

  test('不在 GitLab CI 里：什么都不做', async () => {
    const put = jest.fn<(...args: any[]) => Promise<unknown>>()
    const logger = silentLogger()
    await renamePipeline('n', logger, {AI_REVIEWER_PIPELINE_TOKEN: 'tok'}, fakeClient(put).create)
    expect(put).not.toHaveBeenCalled()
    expect(logger.lines).toEqual([])
  })

  test('接口报错：只记警告，不抛出', async () => {
    const put = jest
      .fn<(...args: any[]) => Promise<unknown>>()
      .mockRejectedValue(new Error('Forbidden'))
    const logger = silentLogger()
    await renamePipeline('n', logger, CI_ENV, fakeClient(put).create)
    expect(logger.lines).toEqual(['warning: pipeline name: rename failed: Forbidden'])
  })

  test('服务地址不合法（如带 token 参数）：经 client 工厂的 host 校验拒绝，只记警告', async () => {
    const logger = silentLogger()
    await renamePipeline('n', logger, {
      ...CI_ENV,
      CI_SERVER_URL: 'https://gitlab.example.com?private_token=x'
    })
    expect(logger.lines).toEqual([
      'warning: pipeline name: rename failed: GitLab host must not carry a token query parameter'
    ])
  })
})

describe('observingLogger', () => {
  test('照常输出，同时把 info / warning 交给 RunOutcome', () => {
    const inner = silentLogger()
    const outcome = new RunOutcome()
    const logger = observingLogger(inner, outcome)
    logger.info('Will review from commit: abc')
    logger.warning('Skipped: files is null')
    logger.error('boom')
    expect(inner.lines).toEqual([
      'info: Will review from commit: abc',
      'warning: Skipped: files is null',
      'error: boom'
    ])
    expect(outcome.describe(false)).toBe('已跳过：无可审查文件')
  })
})
