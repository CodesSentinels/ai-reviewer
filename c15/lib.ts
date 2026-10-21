/** 约束：b 必须大于 0，否则抛 RangeError（调用方必须自己保证）。 */
export function safeDiv(a: number, b: number): number {
  if (!(b > 0)) throw new RangeError('b must be > 0')
  return a / b
}
