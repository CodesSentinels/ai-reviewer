/**
 * description-state.test.ts — description 分区状态读写（STATE-008 / STATE-016）
 *
 * 两组事故各自钉死：
 *
 * 1. marker 损坏时毁掉用户内容。旧实现 `indexOf(start)` 配 `lastIndexOf(end)`，
 *    「结束标签在前」会把用户内容复制两份，「两组区块夹着用户段落」会把中间
 *    整段抹掉。
 * 2. pause/resume 与 release notes 并发写同一份 description 互相覆盖。
 *
 * 第 2 组用**有状态的平台替身**验证：只写不回显的静态桩证明不了任何并发行为。
 */
import {describe, expect, test, jest, beforeEach} from '@jest/globals'

const platform = {
  getChangeRequest: jest.fn<(...a: any[]) => Promise<any>>(),
  updateChangeRequestBody: jest.fn<(...a: any[]) => Promise<any>>()
}
jest.mock('../src/platform/git-platform', () => ({getPlatform: () => platform}))

const logs = {info: jest.fn(), warning: jest.fn(), error: jest.fn(), debug: jest.fn()}
jest.mock('../src/platform/logger', () => ({getLogger: () => logs}))

import {setExecCtx} from '../src/platform/run-context'
import type {ExecutionContext} from '../src/platform/execution-context'
import {
  _resetWriteQueues,
  locateSection,
  readSection,
  removeSection,
  updateDescriptionSection,
  writeSection
} from '../src/description-state'

const S = '<!-- rn-start -->'
const E = '<!-- rn-end -->'
const PAUSE_S = '<!-- ps-start -->'
const PAUSE_E = '<!-- ps-end -->'

describe('STATE-008: marker 损坏时绝不改坏用户内容', () => {
  test('正常区块：定位到自己那段', () => {
    const body = `用户A\n${S}\n发布说明\n${E}\n用户B`
    expect(readSection(body, S, E)).toBe('\n发布说明\n')
  })

  test('结束标签出现在开始标签之前 → 判为损坏，不定位', () => {
    const body = `用户A\n${E}\n重要的用户内容\n${S}\n用户B`
    const {location, problem} = locateSection(body, S, E)
    expect(location).toBeNull()
    expect(problem).toBe('end_before_start')
    // 旧实现在这里把「重要的用户内容」复制成了两份
    expect(removeSection(body, S, E)).toBe(body)
    expect(writeSection(body, S, E, '新内容')).toBeNull()
  })

  test('只有开始标签 → 判为未闭合，不动正文', () => {
    const body = `用户A\n${S}\n发布说明\n用户B`
    expect(locateSection(body, S, E).problem).toBe('unterminated')
    expect(removeSection(body, S, E)).toBe(body)
    expect(writeSection(body, S, E, 'x')).toBeNull()
  })

  test('只有结束标签 → 视为不存在，可安全追加', () => {
    const body = `用户A\n${E}\n用户B`
    expect(locateSection(body, S, E).problem).toBe('absent')
    expect(writeSection(body, S, E, '新内容')).toContain('新内容')
  })

  test('两组区块夹着用户段落 → 只改第一组，中间的用户内容必须保住', () => {
    const user = '用户手写的重要段落'
    const body = `${S}\nR1\n${E}\n${user}\n${S}\nR2\n${E}`

    // 旧实现在这里返回空串——用户那段被整段删除
    expect(removeSection(body, S, E)).toContain(user)
    expect(locateSection(body, S, E).problem).toBe('duplicated')

    const updated = writeSection(body, S, E, 'R1-new') as string
    expect(updated).toContain(user)
    expect(updated).toContain('R1-new')
    expect(updated).toContain('R2') // 第二组原样保留
  })

  test('区块不存在 → 追加，且不吞掉原有正文', () => {
    const out = writeSection('用户原有描述', S, E, '发布说明') as string
    expect(out).toContain('用户原有描述')
    expect(out).toContain('发布说明')
  })

  test('读不存在的区块返回 null，与「区块存在但内容为空」区分开', () => {
    expect(readSection('无标签', S, E)).toBeNull()
    expect(readSection(`${S}\n\n${E}`, S, E)).toBe('\n\n')
  })
})

describe('STATE-016: 分区更新 + 冲突重试', () => {
  /** 有状态的平台替身：写入会真的改变后续读到的内容 */
  function statefulPlatform(initial = ''): {get: () => string} {
    let stored = initial
    platform.getChangeRequest.mockImplementation(async () => ({body: stored}))
    platform.updateChangeRequestBody.mockImplementation(async (_o, _r, _n, body: string) => {
      stored = body as string
    })
    return {get: () => stored}
  }

  const coords = {owner: 'o', repo: 'r', changeRequestId: 1}

  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('写入自己的区块并读回校验通过', async () => {
    const store = statefulPlatform('用户描述')
    const out = await updateDescriptionSection({
      ...coords,
      startTag: S,
      endTag: E,
      render: () => '发布说明'
    })

    expect(out).toEqual({ok: true, attempts: 1, changed: true})
    expect(store.get()).toContain('用户描述')
    expect(store.get()).toContain('发布说明')
  })

  test('两个区块交替写入，互不覆盖（pause/resume vs release notes）', async () => {
    const store = statefulPlatform('用户描述')

    await updateDescriptionSection({
      ...coords,
      startTag: PAUSE_S,
      endTag: PAUSE_E,
      render: () => 'state: paused'
    })
    await updateDescriptionSection({
      ...coords,
      startTag: S,
      endTag: E,
      render: () => '发布说明'
    })

    // 关键断言：后写的 release notes 没有抹掉先写的 pause
    expect(store.get()).toContain('state: paused')
    expect(store.get()).toContain('发布说明')
    expect(store.get()).toContain('用户描述')
  })

  test('render 基于最新值：第二次写入能看到第一次的内容', async () => {
    statefulPlatform('')
    await updateDescriptionSection({...coords, startTag: S, endTag: E, render: () => 'v1'})

    const seen: Array<string | null> = []
    await updateDescriptionSection({
      ...coords,
      startTag: S,
      endTag: E,
      render: cur => {
        seen.push(cur)
        return 'v2'
      }
    })

    expect(seen[0]).toContain('v1')
  })

  test('并发覆盖 → 重试后两段内容都在', async () => {
    let stored = '用户描述'
    let writes = 0
    platform.getChangeRequest.mockImplementation(async () => ({body: stored}))
    platform.updateChangeRequestBody.mockImplementation(async (_o, _r, _n, body: string) => {
      writes += 1
      stored = body as string
      // 第一次写入之后，模拟另一方紧接着用旧快照覆盖，把我们的区块冲掉
      if (writes === 1) {
        stored = `用户描述\n\n${PAUSE_S}\nstate: paused\n${PAUSE_E}`
      }
    })

    const out = await updateDescriptionSection({
      ...coords,
      startTag: S,
      endTag: E,
      render: () => '发布说明'
    })

    expect(out.ok).toBe(true)
    if (out.ok) expect(out.attempts).toBe(2) // 第一次被冲掉，第二次成功
    expect(stored).toContain('发布说明')
    expect(stored).toContain('state: paused') // 对方的内容也保住了
  })

  test('持续冲突 → 有限重试后如实报告 conflict，不谎报成功', async () => {
    // 写入永远不落地：读回来的永远是原始内容
    platform.getChangeRequest.mockResolvedValue({body: '用户描述'})
    platform.updateChangeRequestBody.mockResolvedValue(undefined)

    const out = await updateDescriptionSection({
      ...coords,
      startTag: S,
      endTag: E,
      render: () => '发布说明',
      maxAttempts: 3
    })

    expect(out).toEqual({ok: false, attempts: 3, reason: 'conflict'})
    expect(platform.updateChangeRequestBody).toHaveBeenCalledTimes(3)
  })

  test('marker 损坏 → 直接放弃，一次都不写', async () => {
    platform.getChangeRequest.mockResolvedValue({body: `用户A\n${S}\n没有结束标签`})

    const out = await updateDescriptionSection({
      ...coords,
      startTag: S,
      endTag: E,
      render: () => '发布说明'
    })

    expect(out).toEqual({ok: false, attempts: 1, reason: 'corrupted'})
    expect(platform.updateChangeRequestBody).not.toHaveBeenCalled()
    expect(logs.warning.mock.calls.flat().join(' ')).toContain('damaged')
  })

  test('render 返回 null → 跳过，不写', async () => {
    statefulPlatform('用户描述')
    const out = await updateDescriptionSection({
      ...coords,
      startTag: S,
      endTag: E,
      render: () => null
    })

    expect(out).toEqual({ok: false, attempts: 1, reason: 'skipped'})
    expect(platform.updateChangeRequestBody).not.toHaveBeenCalled()
  })

  test('内容无变化 → 不发起写请求（省一次 API，也避免无谓的 description 版本）', async () => {
    statefulPlatform('')
    await updateDescriptionSection({...coords, startTag: S, endTag: E, render: () => 'same'})
    jest.clearAllMocks()

    const stored = `\n\n${S}\nsame\n${E}`
    platform.getChangeRequest.mockResolvedValue({body: stored.trim()})
    const out = await updateDescriptionSection({
      ...coords,
      startTag: S,
      endTag: E,
      render: () => 'same'
    })

    expect(out).toEqual({ok: true, attempts: 1, changed: false})
    expect(platform.updateChangeRequestBody).not.toHaveBeenCalled()
  })

  test('读取失败 → 报 error，不写', async () => {
    platform.getChangeRequest.mockRejectedValue(new Error('boom'))
    const out = await updateDescriptionSection({
      ...coords,
      startTag: S,
      endTag: E,
      render: () => 'x'
    })

    expect(out).toEqual({ok: false, attempts: 1, reason: 'error'})
    expect(platform.updateChangeRequestBody).not.toHaveBeenCalled()
  })
})

/**
 * 上面测的是 description-state 模块本身。注入回退验证显示：把
 * commenter.updateDescription 退回「读整份 → 拼 → 整份写回」，那 16 条**一条都
 * 不红**——模块写了但调用方没用上也照样全绿。这里直接验真实调用方。
 */
describe('真实调用方确实走了分区更新（STATE-016 接线）', () => {
  const PAUSE_BLOCK = `${PAUSE_S}\nstate: paused\n${PAUSE_E}`

  beforeEach(() => {
    jest.clearAllMocks()
    setExecCtx({
      platform: 'github',
      projectPath: 'o/r',
      projectId: 'o/r',
      changeRequestId: 42,
      eventKind: 'pr_opened',
      actor: {login: 'someone', isBot: false},
      baseSha: 'b',
      headSha: 'h',
      raw: {}
    } as ExecutionContext)
  })

  /**
   * 关键场景：别人的写入落在我们「读」和「写」之间。
   *
   * 顺序执行时旧实现也不丢内容（getDescription 只剥自己那段），所以顺序用例
   * 证明不了任何东西——必须模拟交错，否则这条测试是空的。
   */
  test('交错写入：render 期间别人写了 pause，我们不能用旧快照把它覆盖掉', async () => {
    let stored = '用户描述'
    let reads = 0
    platform.getChangeRequest.mockImplementation(async () => {
      reads += 1
      const snapshot = stored
      // 第一次读之后、写入之前，另一方写入 pause 区块
      if (reads === 1) stored = `用户描述\n\n${PAUSE_BLOCK}`
      return {body: snapshot}
    })
    platform.updateChangeRequestBody.mockImplementation(async (_o, _r, _n, body: string) => {
      stored = body as string
    })

    const out = await updateDescriptionSection({
      owner: 'o',
      repo: 'r',
      changeRequestId: 42,
      startTag: S,
      endTag: E,
      render: () => '发布说明'
    })

    expect(out.ok).toBe(true)
    // 写前重读拿到了含 pause 的最新正文，两段都保住
    expect(stored).toContain('state: paused')
    expect(stored).toContain('发布说明')
  })

  test('commenter.updateDescription 不会抹掉别人写的区块', async () => {
    let stored = `用户描述\n\n${PAUSE_BLOCK}`
    platform.getChangeRequest.mockImplementation(async () => ({body: stored}))
    platform.updateChangeRequestBody.mockImplementation(async (_o, _r, _n, body: string) => {
      stored = body as string
    })

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const {Commenter} = require('../src/commenter')
    await new Commenter().updateDescription(42, '## 发布说明\n- 改了点东西')

    expect(stored).toContain('state: paused') // 退回整份覆盖时这条会红
    expect(stored).toContain('用户描述')
    expect(stored).toContain('发布说明')
  })

  test('setReviewState 不会抹掉 release notes 区块', async () => {
    const RN =
      '<!-- ai-reviewer:github:release-notes-start -->\n发布说明\n<!-- ai-reviewer:github:release-notes-end -->'
    let stored = `用户描述\n\n${RN}`
    platform.getChangeRequest.mockImplementation(async () => ({body: stored}))
    platform.updateChangeRequestBody.mockImplementation(async (_o, _r, _n, body: string) => {
      stored = body as string
    })

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const {setReviewState} = require('../src/review-state')
    await setReviewState('o', 'r', 42, 'paused')

    expect(stored).toContain('state: paused')
    expect(stored).toContain('发布说明') // 退回整份覆盖时这条会红
    expect(stored).toContain('用户描述')
  })

  test('pause 写入失败时抛错，不静默吞掉（用户下过命令，必须知道没生效）', async () => {
    platform.getChangeRequest.mockResolvedValue({body: '用户描述'})
    platform.updateChangeRequestBody.mockResolvedValue(undefined) // 写了不落地

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const {setReviewState} = require('../src/review-state')
    await expect(setReviewState('o', 'r', 42, 'paused')).rejects.toThrow(/conflict/)
  })
})

/**
 * 复核指出的反向顺序：**我们先校验成功，随后别人用旧快照覆盖**。
 *
 * 原先的并发用例只覆盖「我们被覆盖 → 发现 → 重试」这一种顺序，看不到另一侧：
 * A 写 pause 并校验成功，B 随后用更早读到的快照写 release notes 把 pause 冲掉，
 * B 也校验自己那段成功——两边都报成功，pause 已经丢了。
 *
 * 分两层验证：
 *   1. 同一进程内：串行队列必须让这种交错根本不可能发生（确定性保证）；
 *   2. 跨进程：做不到，如实钉住当前行为，避免哪天误以为已经防住。
 */
describe('STATE-016 反向顺序：先校验成功，再被别人用旧快照覆盖', () => {
  const coords = {owner: 'o', repo: 'r', changeRequestId: 7}
  const RN_S = '<!-- rn2-start -->'
  const RN_E = '<!-- rn2-end -->'

  beforeEach(() => {
    jest.clearAllMocks()
    _resetWriteQueues()
  })

  /**
   * 精确构造复核指出的那个顺序，而不是"并发跑两次看看"：
   *
   *   B 读到旧正文并算好要写的内容 → 卡住
   *   A 完整跑完（写 pause + 校验成功）
   *   B 用旧正文写回 → 冲掉 pause → B 校验自己那段仍在 → 也报成功
   *
   * 没有串行队列时这条必然丢数据；有队列时 B 根本不会在 A 完成前动手。
   * 先前那条"并发发起两次写入"的用例证明不了这一点——两次写入恰好被重试
   * 机制救了回来，去掉队列照样全绿。
   */
  test('构造「先校验成功、再被旧快照覆盖」的确定性交错 → 队列必须挡住', async () => {
    let stored = '用户描述'
    let openGate: () => void = () => {}
    const gate = new Promise<void>(resolve => {
      openGate = resolve
    })

    platform.getChangeRequest.mockImplementation(async () => ({body: stored}))
    platform.updateChangeRequestBody.mockImplementation(async (_o, _r, _n, body: string) => {
      // 只把 release notes 那次写入卡住，让 A 先完整跑完
      if (String(body).includes('发布说明')) await gate
      stored = body as string
    })

    const b = updateDescriptionSection({
      ...coords,
      startTag: RN_S,
      endTag: RN_E,
      render: () => '发布说明'
    })
    // 让 B 先走到"已读旧正文、准备写"的位置
    await new Promise(r => setTimeout(r, 0))

    const a = updateDescriptionSection({
      ...coords,
      startTag: PAUSE_S,
      endTag: PAUSE_E,
      render: () => 'state: paused'
    })
    // 队列生效时 A 会排在 B 后面，此处不能 await a，否则死锁
    await new Promise(r => setTimeout(r, 0))
    openGate()

    const [rb, ra] = await Promise.all([b, a])
    expect(rb.ok).toBe(true)
    expect(ra.ok).toBe(true)
    // 去掉串行队列时，B 会用旧正文把 A 刚写的 pause 冲掉，且双方都报成功
    expect(stored).toContain('state: paused')
    expect(stored).toContain('发布说明')
  })

  test('并发发起两次写入，两段内容都在（重试兜底，不区分队列有无）', async () => {
    let stored = '用户描述'
    platform.getChangeRequest.mockImplementation(async () => {
      // 制造真实的异步间隙：没有它，读写会在同一个微任务里跑完，
      // 交错根本不会发生，测试也就证明不了队列有用
      await new Promise(r => setTimeout(r, 0))
      return {body: stored}
    })
    platform.updateChangeRequestBody.mockImplementation(async (_o, _r, _n, body: string) => {
      await new Promise(r => setTimeout(r, 0))
      stored = body as string
    })

    // 不 await，让两次更新真正并发发起
    const a = updateDescriptionSection({
      ...coords,
      startTag: PAUSE_S,
      endTag: PAUSE_E,
      render: () => 'state: paused'
    })
    const b = updateDescriptionSection({
      ...coords,
      startTag: RN_S,
      endTag: RN_E,
      render: () => '发布说明'
    })
    const [ra, rb] = await Promise.all([a, b])

    expect(ra.ok).toBe(true)
    expect(rb.ok).toBe(true)
    // 关键：后发起的那次没有用旧快照把先落地的那段冲掉
    expect(stored).toContain('state: paused')
    expect(stored).toContain('发布说明')
    expect(stored).toContain('用户描述')
  })

  test('不同 PR/MR 之间不共用队列（各写各的，互不阻塞也互不污染）', async () => {
    // 每个 PR/MR 一份独立存储：写了不落地的桩会触发 3 次重试，
    // 把「一次写入」测成六次，那是桩的问题不是队列的问题
    const stores = new Map<number, string>([
      [1, ''],
      [2, '']
    ])
    platform.getChangeRequest.mockImplementation(async (_o, _r, n: number) => ({
      body: stores.get(n) ?? ''
    }))
    platform.updateChangeRequestBody.mockImplementation(async (_o, _r, n: number, body: string) => {
      stores.set(n, body as string)
    })

    await Promise.all([
      updateDescriptionSection({
        ...coords,
        changeRequestId: 1,
        startTag: S,
        endTag: E,
        render: () => 'x'
      }),
      updateDescriptionSection({
        ...coords,
        changeRequestId: 2,
        startTag: S,
        endTag: E,
        render: () => 'y'
      })
    ])

    expect(stores.get(1)).toContain('x')
    expect(stores.get(2)).toContain('y')
    expect(stores.get(1)).not.toContain('y')
    expect(stores.get(2)).not.toContain('x')
  })

  test('队列中前一个任务抛错，不会卡死后续写入', async () => {
    platform.getChangeRequest
      .mockRejectedValueOnce(new Error('boom'))
      .mockImplementation(async () => ({body: ''}))
    platform.updateChangeRequestBody.mockResolvedValue(undefined)

    const first = updateDescriptionSection({...coords, startTag: S, endTag: E, render: () => 'a'})
    const second = updateDescriptionSection({...coords, startTag: S, endTag: E, render: () => 'b'})

    const [r1, r2] = await Promise.all([first, second])
    expect(r1.ok).toBe(false)
    expect(r2).toBeDefined() // 没有挂起
  })

  test('跨进程无法防护：外部写入在我们校验之后覆盖，我们仍报成功（已知边界）', async () => {
    let stored = `用户描述\n\n${PAUSE_BLOCK_2}`
    platform.getChangeRequest.mockImplementation(async () => ({body: stored}))
    platform.updateChangeRequestBody.mockImplementation(async (_o, _r, _n, body: string) => {
      stored = body as string
    })

    const out = await updateDescriptionSection({
      ...coords,
      startTag: RN_S,
      endTag: RN_E,
      render: () => '发布说明'
    })
    expect(out.ok).toBe(true)
    expect(stored).toContain('state: paused')

    // 模拟另一个**进程**用更早的快照写回（CI 侧未串行时会发生）
    stored = '用户描述\n\n<!-- rn2-start -->\n发布说明\n<!-- rn2-end -->'

    // 这里如实记录当前能力：我们已经返回成功，察觉不到 pause 被冲掉。
    // 要闭合它必须让同一 PR/MR 的写入落在同一串行执行面上——
    // GitLab 侧靠 resource_group 已成立，GitHub 侧的评论事件是故意并行的。
    expect(stored).not.toContain('state: paused')
  })
})

const PAUSE_BLOCK_2 = '<!-- ps-start -->\nstate: paused\n<!-- ps-end -->'
