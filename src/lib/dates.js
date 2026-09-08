// 本地日期工具：一律用本地时区字符串 'YYYY-MM-DD' 做打卡/热力 key。
// 注意：不能直接用 toISOString()（UTC 会跨日错位）。

const pad2 = (n) => String(n).padStart(2, '0')

/** 本地日期 key：'2026-02-11' */
export function dateKey(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export function todayKey() {
  return dateKey(new Date())
}

/** 把 'YYYY-MM-DD' 还原为本地 Date（当日 0 点） */
export function keyToDate(key) {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function startOfDay(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0)
}

export function endOfDay(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)
}

/** 纯函数：返回偏移 n 天后的新 Date（不清空时间部分） */
export function addDays(d, n) {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

export function daysAgo(n, from = new Date()) {
  return addDays(from, -n)
}

export function isSameDay(a, b) {
  return dateKey(a) === dateKey(b)
}

export function isToday(ms) {
  return dateKey(new Date(ms)) === todayKey()
}

/** 到期时间的友好文案：已到期/今天/明天/后天/X 天后 */
export function formatDueShort(ms, now = new Date()) {
  const a = startOfDay(new Date(ms)).getTime()
  const b = startOfDay(now).getTime()
  const diffDays = Math.round((a - b) / 86400000)
  if (diffDays <= 0) return '今天'
  if (diffDays === 1) return '明天'
  if (diffDays === 2) return '后天'
  return `${diffDays} 天后`
}
