// 可播种伪随机 + 洗牌/抽样工具（测验选项乱序可复现、本地干扰项抽样）
export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 就地洗牌；传入 rng 可复现。返回原数组。 */
export function shuffle(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

/** 无放回抽 n 个（浅拷贝），不足则全返 */
export function sampleN(arr, n, rng = Math.random) {
  if (!arr) return []
  const copy = [...arr]
  shuffle(copy, rng)
  return copy.slice(0, Math.max(0, Math.min(n, copy.length)))
}
