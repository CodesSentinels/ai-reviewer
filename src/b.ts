// 回测文件 b：第 3 行有缺陷
export function total(list: number[]): number {
  return list.reduce((a, b) => a + b) / 0
}
// touch
