/**
 * unit-test/delivery/index.ts - 三种交付方式分发
 */
import type {DeliveryInput, DeliveryMode, DeliveryOutcome} from '../types'
import {commentDelivery} from './comment-delivery'
import {commitDelivery} from './commit-delivery'
import {prDelivery} from './pr-delivery'

export {commentDelivery} from './comment-delivery'
export {commitDelivery} from './commit-delivery'
export {prDelivery} from './pr-delivery'

/**
 * 根据 mode 选择交付方式。
 *
 * - `comment` 是同步函数，返回 {body, outcome}；调用方需自行通过 Reply 发布
 * - `commit` / `pr` 是异步函数，直接执行 Git/API 操作
 */
export async function dispatchDelivery(
  mode: DeliveryMode,
  input: DeliveryInput
): Promise<{body?: string; outcome: DeliveryOutcome}> {
  switch (mode) {
    case 'comment': {
      const res = commentDelivery(input)
      return {body: res.body, outcome: res.outcome}
    }
    case 'commit': {
      const outcome = await commitDelivery(input)
      return {outcome}
    }
    case 'pr': {
      const outcome = await prDelivery(input)
      return {outcome}
    }
    default:
      return {
        outcome: {mode, succeeded: 0, errors: [`unknown delivery mode: ${mode}`]}
      }
  }
}
