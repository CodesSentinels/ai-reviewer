// 回测文件 a：第 4 行有缺陷（由假模型登记）
export function average(list: number[]): number {
  let sum = 0
  for (let i = 0; i <= list.length; i++) sum += list[i]
  return sum / list.length
}
