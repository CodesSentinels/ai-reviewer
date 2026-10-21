import {safeDiv} from './lib'

export function average(values: number[]): number {
  const total = values.reduce((s, v) => s + v, 0)
  return safeDiv(total, values.length)
}
