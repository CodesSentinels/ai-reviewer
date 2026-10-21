import {safeDiv} from './lib'

/** 平均值：空数组时 values.length 为 0。 */
export function average(values: number[]): number {
  const total = values.reduce((s, v) => s + v, 0)
  return safeDiv(total, values.length)
}
