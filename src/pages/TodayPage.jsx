import { useEffect, useMemo, useRef, useState } from 'react'
import { dueWords, getStreak, setKnown, checkinOf, bumpCheckin } from '../db/repo.js'
import { todayKey } from '../lib/dates.js'
import { useSettings } from '../hooks/useSettings.js'
import FlipCard from '../components/FlipCard.jsx'
import BossBattle from '../components/boss/BossBattle.jsx'
import './TodayPage.css'

const CONFETTI_COLORS = ['var(--color-primary)', 'var(--color-energy)', 'var(--color-accent)', 'var(--color-danger)']

/** 火焰图标（几何 SVG，不用外部图） */
export function FlameIcon({ size = 30, lit = true }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 2c1.6 2.7 5.2 3.9 5.2 8.4 0 4.3-2.3 7.6-5.2 7.6S6.8 14.7 6.8 10.4C6.8 5.9 10.4 4.7 12 2z"
        fill={lit ? 'var(--color-energy)' : 'var(--line)'}
      />
      <path
        d="M12 17.5c-1.9 0-3.2-1.9-3.2-4.6 0-1.9.6-3 1.2-3.9-.1 1.2.6 2.6 1.7 2.6 1 0 1.3-1.5 1.1-2.7 1.5.9 2.4 2.5 2.4 4.6 0 1.6-.7 4-3.2 4z"
        fill="var(--bg-card)"
      />
    </svg>
  )
}

function GoalRing({ done, goal }) {
  const r = 30
  const c = 2 * Math.PI * r
  const pct = Math.min(1, goal > 0 ? done / goal : 0)
  return (
    <div className="ring-wrap">
      <svg width="76" height="76" viewBox="0 0 76 76" className="num">
        <circle cx="38" cy="38" r={r} fill="none" stroke="var(--line)" strokeWidth="8" />
        <circle
          cx="38" cy="38" r={r} fill="none"
          stroke="var(--color-primary)"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          transform="rotate(-90 38 38)"
          style={{ transition: 'stroke-dashoffset 0.4s var(--ease-pop)' }}
        />
      </svg>
      <div className="ring-center">
        <b className="num">{done}</b>
        <span className="num">/{goal}</span>
      </div>
    </div>
  )
}

/** A3：每批最多练 goal 个（每日目标即任务量） */
function sliceSize(total, goal) {
  return Math.min(total, Math.max(1, goal || 10))
}

export default function TodayPage({ openImport, goTab }) {
  const settings = useSettings()
  const goal = Math.max(1, settings.ui.dailyGoal || 10)
  const [deck, setDeck] = useState(null) // 当前这一批
  const [pendingLeft, setPendingLeft] = useState(0) // 今天还有多少到期词没排进批
  const [idx, setIdx] = useState(0)
  const [learned, setLearned] = useState(() => new Set())
  const [reviewsToday, setReviewsToday] = useState(0)
  const [streak, setStreakNum] = useState(0)
  const [pieces, setPieces] = useState([])
  const [phase, setPhase] = useState('deck') // deck | done | battle | result
  const [result, setResult] = useState(null)
  const armedRef = useRef(false)
  const processedRef = useRef(new Set()) // 今天排过批的词 id（防同一批重复进入）
  const flipMarkedRef = useRef(false) // 今天是否已记「翻卡完成」打卡（A2）
  const weekLit = Math.min(7, streak)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [due, st, ck] = await Promise.all([dueWords(), getStreak(), checkinOf(todayKey())])
      if (cancelled) return
      const slice = due.slice(0, sliceSize(due.length, goal))
      processedRef.current = new Set(slice.map((w) => w.id))
      setDeck(slice)
      setPendingLeft(due.length - slice.length)
      setStreakNum(st)
      setReviewsToday(ck?.wordsReviewed || 0)
      armedRef.current = (ck?.wordsReviewed || 0) < goal
    })()
    return () => { cancelled = true }
  }, [goal])

  const todayDone = reviewsToday + learned.size

  // 翻完这一批 → 记一次「今日学习打卡」（A2：只翻卡没打 Boss 也算今天学过）
  useEffect(() => {
    if (deck && deck.length && idx >= deck.length && phase === 'deck' && !flipMarkedRef.current) {
      flipMarkedRef.current = true
      bumpCheckin(todayKey(), { flipDone: 1 }).catch(() => {})
      setPhase('done')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck, idx])

  useEffect(() => {
    if (!deck) return
    if (todayDone >= goal && armedRef.current) {
      armedRef.current = false
      fireConfetti()
    }
  }, [todayDone, goal, deck])

  function fireConfetti() {
    const arr = Array.from({ length: 18 }, (_, i) => ({
      id: i,
      left: 5 + Math.random() * 90,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      delay: Math.random() * 140,
      dur: 850 + Math.random() * 450,
    }))
    setPieces(arr)
    setTimeout(() => setPieces([]), 1500)
  }

  async function markKnown(word) {
    await setKnown(word.id, 1)
    setLearned((prev) => {
      const nx = new Set(prev)
      nx.delete(word.id)
      return nx
    })
    setDeck((arr) => arr.filter((w) => w.id !== word.id))
    setIdx((cur) => Math.max(0, Math.min(cur, (deck?.length || 1) - 2)))
  }

  /** Boss 战结算：同步圆环/打卡，统计还剩多少到期词没排批 */
  async function handleBossFinish(s) {
    setResult(s)
    if (s.ratedWordIds?.length) {
      setLearned((prev) => {
        const nx = new Set(prev)
        s.ratedWordIds.forEach((id) => nx.delete(id))
        return nx
      })
    }
    const [ck, st] = await Promise.all([checkinOf(todayKey()), getStreak()])
    setReviewsToday(ck?.wordsReviewed || 0)
    setStreakNum(st)
    if (s.defeated && armedRef.current) {
      armedRef.current = false
      fireConfetti()
    }
    setPendingLeft(await countPending())
    setPhase('result')
  }

  async function countPending() {
    try {
      const due = await dueWords()
      return due.filter((w) => !processedRef.current.has(w.id) && !w.known).length
    } catch {
      return 0
    }
  }

  /** 开下一批：重新查到期词，跳过已排过批的 */
  async function startNextBatch() {
    const due = await dueWords()
    const fresh = due.filter((w) => !processedRef.current.has(w.id) && !w.known)
    if (!fresh.length) {
      setPendingLeft(0)
      setPhase('done')
      return
    }
    const slice = fresh.slice(0, sliceSize(fresh.length, goal))
    slice.forEach((w) => processedRef.current.add(w.id))
    setLearned(new Set())
    setIdx(0)
    setResult(null)
    setDeck(slice)
    setPendingLeft(fresh.length - slice.length)
    setPhase('deck')
  }

  const cur = deck && deck.length ? deck[idx] : null
  const meta = useMemo(() => ({ total: deck?.length || 0, learned: learned.size }), [deck, learned])

  return (
    <section className="page">
      <header className="topbar">
        <h1 className="h-display topbar-title">今日学习</h1>
        <button className="topbar-icon-btn" aria-label="拍照导入生词" onClick={openImport}>＋</button>
      </header>

      <div className="pad today-pad">
        <div className="today-top">
          <div className="streak-box">
            <span className={streak > 0 ? 'flame-pulse' : ''}>
              <FlameIcon size={34} />
            </span>
            <div className="streak-nums">
              <b className="h-display num streak-days">{streak}</b>
              <span>天连击</span>
            </div>
            {streak > 0 && streak % 7 === 0 && (
              <span className="badge-week chip-pop">🏅 全勤周</span>
            )}
            <div className="mini-flames" aria-hidden="true">
              {Array.from({ length: 7 }, (_, i) => (
                <FlameIcon key={i} size={14} lit={i < weekLit} />
              ))}
            </div>
          </div>
          <GoalRing done={todayDone} goal={goal} />
        </div>

        {pieces.length > 0 && (
          <div className="confetti-layer" aria-hidden="true">
            {pieces.map((p) => (
              <span
                key={p.id}
                className="confetti"
                style={{
                  left: `${p.left}%`,
                  background: p.color,
                  animationDelay: `${p.delay}ms`,
                  animationDuration: `${p.dur}ms`,
                }}
              />
            ))}
          </div>
        )}

        {!deck ? (
          <p className="today-loading">加载中…</p>
        ) : deck.length === 0 && phase === 'deck' ? (
          <div className="ph today-empty">
            <FlameIcon size={44} lit={false} />
            <h2 className="h-display ph-title">
              {pendingLeft > 0 ? '这批已经学完啦' : '今日没有到期的词'}
            </h2>
            <p className="ph-sub">
              {pendingLeft > 0
                ? `今天还有 ${pendingLeft} 个到期词，点下方按钮继续`
                : '新学的词会按 FSRS 排期自动出现；也可以现在拍几张新词充实词库'}
            </p>
            {pendingLeft > 0 ? (
              <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={startNextBatch}>
                练下一批（剩 {pendingLeft} 词）
              </button>
            ) : (
              <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={openImport}>
                ＋ 拍照导入
              </button>
            )}
          </div>
        ) : phase === 'deck' ? (
          <>
            <div className="deck-hint">
              <span className="num">第 {Math.min(idx + 1, meta.total)} / {meta.total} 词</span>
              <span>先看再翻，翻过即学过（评分在 Boss 战）</span>
            </div>
            {cur && (
              <FlipCard
                key={cur.id}
                word={cur}
                onReveal={(w) => setLearned((prev) => new Set(prev).add(w.id))}
                onKnown={markKnown}
              />
            )}
            <div className="deck-nav">
              <button className="btn btn-ghost" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>
                ← 上一张
              </button>
              <button className="btn btn-primary" onClick={() => setIdx(idx + 1)}>
                {idx >= meta.total - 1 ? '完成学习 →' : '下一张 →'}
              </button>
            </div>
            {pendingLeft > 0 && (
              <p className="deck-pending">另有 {pendingLeft} 个到期词在下一批，可稍后再练</p>
            )}
          </>
        ) : phase === 'done' ? (
          <div className="done-panel">
            <span className="done-check ok-pop">⚔️</span>
            <h2 className="h-display">先学完成</h2>
            <p className="ph-sub">
              已翻看 {meta.total} 词 · 接下来是 Boss 战：答对扣血、答错回血并加密复习排期
            </p>
            <button className="btn btn-primary btn-block" onClick={() => setPhase('battle')}>
              进入 Boss 战闯关
            </button>
          </div>
        ) : phase === 'battle' ? (
          <BossBattle words={deck} onFinish={handleBossFinish} />
        ) : (
          <div className="done-panel">
            <span className="done-check ok-pop">{result?.defeated ? '🏆' : '😮‍💨'}</span>
            <h2 className="h-display">
              {result?.defeated ? 'Boss 被击败！' : 'Boss 撑住了'}
            </h2>
            <p className="ph-sub">
              答对 <b className="num">{result?.correct ?? 0}</b> · 答错{' '}
              <b className="num">{result?.wrong ?? 0}</b> · 共{' '}
              <b className="num">{result?.total ?? 0}</b> 词
            </p>
            <p className="ph-sub">
              答错的词已按 FSRS 加密复习排期{result?.wrong ? '，并预生成明日干扰项+例句' : ''}
            </p>
            {pendingLeft > 0 && (
              <button className="btn btn-ghost btn-block" onClick={startNextBatch}>
                练下一批（还剩 {pendingLeft} 个到期词）
              </button>
            )}
            <div className="deck-nav" style={{ width: '100%' }}>
              <button className="btn btn-plain" onClick={() => goTab('library')}>
                去生词本
              </button>
              <button className="btn btn-primary" onClick={() => goTab('stats')}>
                看统计
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
