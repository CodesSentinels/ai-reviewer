// 回测用：路径不命中 path_instructions
export function total(list) {
  let sum = 0
  for (let i = 0; i <= list.length; i++) sum += list[i]
  return sum
}
