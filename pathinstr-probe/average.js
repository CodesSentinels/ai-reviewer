// 回测用：路径命中 path_instructions
export function average(list) {
  let sum = 0
  for (let i = 0; i <= list.length; i++) sum += list[i]
  return sum / list.length
}
