/**
 * head-staleness.ts — HEAD 陈旧判定（REVIEW-003 / EVENT-012）
 *
 * 两个消费方、两个插入点，但必须共用同一套语义：
 *
 *   EVENT-012（§6，GitLab trigger）—— 事件分发**之前**判断，陈旧事件根本不进审查
 *   REVIEW-003（§8.1，共享审查核心）—— 每个写入阶段**之前**判断，审查跑到一半
 *                                    HEAD 变了就不写旧结果
 *
 * 原先这个纯函数放在 `gitlab-mr-hook-rules.ts` 里。审查核心是平台无关的，从一个
 * GitLab 专有模块里 import 判定逻辑说不通；各写一份又会让两处语义漂移。
 * 因此挪到这里，原路径继续 re-export，§6 的接线不受影响。
 */

export interface HeadStaleCheck {
  stale: boolean
  /** 本次分析所基于的 HEAD */
  eventHeadSha: string
  /** 写入前重新读到的当前 HEAD */
  currentHeadSha: string
}

/**
 * 比较「分析所基于的 HEAD」与「当前 HEAD」。
 *
 * 只做比较，不做读取——重新读取当前 HEAD 是调用方的事（GitHub 走
 * `getChangeRequest`，GitLab 走 GLAPI-006）。
 *
 * 任一侧为空时判为**不陈旧**：拿不到基准就无从比较，此时拒绝写入会让评论触发的
 * 审查永远发不出结果（GitHub 构造评论事件时 execCtx.headSha 固定留空）。
 * 真正的基准由调用方保证——REVIEW-003 用的是审查开始时读到的 HEAD，不是事件里的。
 */
export function isHeadStale(eventHeadSha: string, currentHeadSha: string): HeadStaleCheck {
  const known = eventHeadSha !== '' && currentHeadSha !== ''
  return {
    stale: known && eventHeadSha !== currentHeadSha,
    eventHeadSha,
    currentHeadSha
  }
}
