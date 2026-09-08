// usage.js —— 「本月 API 花费估算」面板数据源（省 token 硬性要求 A5）
// 费用 = Σ( 输入未命中tokens×input + 缓存命中tokens×cacheHitInput + 输出tokens×output ) / 1e6

import { priceOf } from '../config.js'
import { usageSince } from '../db/repo.js'

/** 本月 1 号 0 点（本地时区） */
export function monthStart(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), 1).getTime()
}

/** 过去 N 天起始（热力/花费近视图用） */
export function daysAgoStart(n, now = new Date()) {
  const d = new Date(now)
  d.setDate(d.getDate() - n)
  return d.getTime()
}

/** 按模型聚合 token 并套官方单价 → 估算金额（¥） */
export function estimateCost(rows) {
  const byModel = {}
  for (const r of rows || []) {
    const m = (byModel[r.model] = byModel[r.model] || {
      promptMiss: 0,
      cacheHit: 0,
      completion: 0,
      calls: 0,
    })
    m.promptMiss += r.promptTokens || 0
    m.cacheHit += r.cacheHitTokens || 0
    m.completion += r.completionTokens || 0
    m.calls += 1
  }
  let totalYuan = 0 // 精确累计，避免逐项取整把小额清零
  const breakdown = Object.entries(byModel).map(([model, t]) => {
    const p = priceOf(model)
    const yuan = (t.promptMiss * p.input + t.cacheHit * p.cacheHitInput + t.completion * p.output) / 1e6
    totalYuan += yuan
    return { model, ...t, yuan: round2(yuan) } // 展示值取整，不影响合计
  })
  return { totalYuan, breakdown }
}

/** 本月估算：直接读 usage 表本月记录 */
export async function estimateThisMonth(now = new Date()) {
  const rows = await usageSince(monthStart(now))
  const est = estimateCost(rows)
  est.calls = rows.length
  return est
}

export function round2(n) {
  return Math.round(n * 100) / 100
}

/** 金额文案：正常 2 位小数；不足 1 分钱按有效数字显示（首日小额也能看见） */
export function formatYuan(n) {
  const v = Number(n) || 0
  if (v > 0 && v < 0.01) return `¥${v.toPrecision(2)}`
  return `¥${round2(v).toFixed(2)}`
}
