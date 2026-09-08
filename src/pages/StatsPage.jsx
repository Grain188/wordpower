import { useEffect, useMemo, useState } from 'react'
import { allCheckins, getStats, recentChatSessions } from '../db/repo.js'
import { estimateThisMonth, formatYuan } from '../api/usage.js'
import { dateKey } from '../lib/dates.js'
import { useSettings } from '../hooks/useSettings.js'
import { sceneOf } from '../api/chat.js'
import { speakSeq } from '../speech/speechUtil.js'
import { FlameIcon } from '../pages/TodayPage.jsx'
import './StatsPage.css'

/* ---------- GitHub 风格热力 ---------- */
const HEAT_DAYS = 17 * 7 // 近 17 周（含本周）

function toLevel(v) {
  if (!v) return 0
  if (v < 3) return 1
  if (v < 6) return 2
  if (v < 10) return 3
  return 4
}

function Heatmap({ data }) {
  // 从「本周一 - 16 周」到「今天」，周一开头排 7 行
  const grid = useMemo(() => {
    const today = new Date()
    const monday = new Date(today)
    monday.setDate(today.getDate() - ((today.getDay() + 6) % 7))
    const start = new Date(monday)
    start.setDate(start.getDate() - (HEAT_DAYS - 7))
    const weeks = []
    for (let w = 0; w < HEAT_DAYS / 7; w++) {
      const col = []
      for (let d = 0; d < 7; d++) {
        const day = new Date(start)
        day.setDate(start.getDate() + w * 7 + d)
        const key = dateKey(day)
        const future = day.getTime() > today.getTime()
        col.push({ key, future, level: future ? 0 : toLevel(data[key] || 0), count: data[key] || 0 })
      }
      weeks.push(col)
    }
    return weeks
  }, [data])

  return (
    <div className="heat">
      <div className="heat-row">
        <div className="heat-dow">
          {['一', '三', '五'].map((d, i) => <span key={d} style={{ gridRow: i * 2 + 1 }}>{d}</span>)}
        </div>
        <div className="heat-grid">
          {grid.map((col, ci) => (
            <div key={ci} className="heat-col">
              {col.map((c) => (
                <span
                  key={c.key}
                  className={`heat-cell l${c.level}${c.future ? ' future' : ''}`}
                  title={c.future ? '' : `${c.key} · ${c.count} 词`}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="heat-legend">
        <span>少</span>
        {[0, 1, 2, 3, 4].map((l) => <span key={l} className={`heat-cell l${l}`} />)}
        <span>多</span>
      </div>
    </div>
  )
}

/* ---------- 掌握率环形图 ---------- */
function MasteryRing({ rate, mastered, total }) {
  const r = 52
  const c = 2 * Math.PI * r
  return (
    <div className="mastery">
      <svg width="150" height="150" viewBox="0 0 150 150" className="num">
        <circle cx="75" cy="75" r={r} fill="none" stroke="var(--line)" strokeWidth="14" />
        <circle
          cx="75" cy="75" r={r} fill="none"
          stroke="var(--color-primary)"
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.min(1, rate / 100))}
          transform="rotate(-90 75 75)"
          style={{ transition: 'stroke-dashoffset 0.5s var(--ease-pop)' }}
        />
        <text x="75" y="82" textAnchor="middle" className="mastery-pct num">{rate}%</text>
      </svg>
      <p className="mastery-sub">掌握率 · {mastered}/{total} 词（标熟或 FSRS ≥21 天）</p>
    </div>
  )
}

export default function StatsPage() {
  const settings = useSettings()
  const [stats, setStats] = useState(null)
  const [heat, setHeat] = useState({})
  const [cost, setCost] = useState(null)
  const [sessions, setSessions] = useState(0)
  const [chats, setChats] = useState([])
  const [refreshSpin, setRefreshSpin] = useState(false)

  async function refreshCost() {
    setRefreshSpin(true)
    try {
      setCost(await estimateThisMonth())
    } finally {
      setRefreshSpin(false)
    }
  }

  useEffect(() => {
    ;(async () => {
      const [st, cks, ses] = await Promise.all([getStats(), allCheckins(), recentChatSessions(999)])
      setStats(st)
      const map = {}
      for (const c of cks) map[c.date] = (c.wordsReviewed || 0) + (c.spokenHits || 0) + (c.flipDone ? 1 : 0)
      setHeat(map)
      setSessions(ses.length)
      setChats(ses.slice(0, 5))
      setCost(await estimateThisMonth())
    })()
  }, [])

  const monthLabel = useMemo(() => {
    const d = new Date()
    return `${d.getFullYear()}年${d.getMonth() + 1}月`
  }, [])

  return (
    <section className="page">
      <header className="topbar">
        <h1 className="h-display topbar-title">统计</h1>
      </header>
      <div className="pad stats-pad">
        {stats && (
          <>
            <div className="card">
              <MasteryRing rate={stats.masteryRate} mastered={stats.mastered} total={stats.total} />
            </div>
            <div className="mini-cards">
              <div className="mini-card">
                <b className="num">{stats.total}</b><span>总词数</span>
              </div>
              <div className="mini-card">
                <b className="num">{stats.dueToday}</b><span>今日到期</span>
              </div>
              <div className="mini-card">
                <b className="num">{stats.knownCount}</b><span>手动标熟</span>
              </div>
              <div className="mini-card">
                <b className="num">{sessions}</b><span>口语场次</span>
              </div>
            </div>
            <div className="card">
              <h3 className="h-display card-title">学习热力 <FlameIcon size={18} /></h3>
              <Heatmap data={heat} />
              <p className="card-sub">近 17 周 · 深色 = 当天复习/开口更多</p>
            </div>
            <div className="card">
              <div className="cost-head">
                <h3 className="h-display card-title">本月 API 花费估算</h3>
                <button className="cost-refresh" onClick={refreshCost} disabled={refreshSpin}>
                  {refreshSpin ? '刷新中…' : '刷新'}
                </button>
              </div>
              <div className="cost-total">
                <b className="num">{cost ? formatYuan(cost.totalYuan) : '—'}</b>
                <span>{monthLabel} · {cost?.calls ?? 0} 次调用</span>
              </div>
              {cost && cost.breakdown.length > 0 && (
                <table className="cost-table num">
                  <thead>
                    <tr><th>模型</th><th>输入</th><th>缓存</th><th>输出</th><th>估算</th></tr>
                  </thead>
                  <tbody>
                    {cost.breakdown.map((b) => (
                      <tr key={b.model}>
                        <td className="cost-model">{b.model}</td>
                        <td>{Math.round(b.promptMiss / 1000)}k</td>
                        <td>{Math.round(b.cacheHit / 1000)}k</td>
                        <td>{Math.round(b.completion / 1000)}k</td>
                        <td>{formatYuan(b.yuan)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="card-sub">按 src/config.js 官方计价表（¥/百万 token）估算，缓存命中按低价计</p>
            </div>

            <div className="card">
              <h3 className="h-display card-title">最近口语会话</h3>
              {chats.length === 0 ? (
                <p className="card-sub">还没有口语记录——去「听说」开一场吧。</p>
              ) : (
                <ul className="chat-history">
                  {chats.map((s) => {
                    const sc = sceneOf(s.scene)
                    const aiLines = (s.rounds || [])
                      .filter((r) => r.role === 'ai' && !r.error && r.content)
                      .map((r) => r.content)
                    return (
                      <li key={s.id} className="chat-his-item">
                        <div className="chat-his-head">
                          <span>{sc.icon} {sc.zh}</span>
                          <span className="num">{new Date(s.startedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                          <span className="tag num">命中 {s.stats?.usedCount ?? 0}/{s.targetWordIds?.length ?? 0}</span>
                          <button
                            className="his-replay"
                            disabled={!aiLines.length}
                            onClick={() => { aiLines.length && speakSeq(aiLines) }}
                          >
                            🔊 重听
                          </button>
                        </div>
                        {s.stats?.feedback && <p className="his-feedback">{s.stats.feedback}</p>}
                      </li>
                    )
                  })}
                </ul>
              )}
              <p className="card-sub">完整转写存在本机 IndexedDB；这里可回看点评与重听 AI 部分。</p>
            </div>
          </>
        )}
        {!stats && <p className="stats-loading">加载中…</p>}
        {settings && !settings.apiKey && (
          <p className="stats-nokey">未配置 API Key —— 拍照/口语调用不会产生费用；配置后可看这里的花费。</p>
        )}
      </div>
    </section>
  )
}
