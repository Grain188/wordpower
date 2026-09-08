import { useEffect, useRef, useState } from 'react'
import {
  allWords,
  getDistractors,
  saveDistractors,
  recordReview,
} from '../../db/repo.js'
import { buildLocalOptions, generateDistractorBatch } from '../../api/distractors.js'
import { GOOD, AGAIN } from '../../db/fsrs.js'
import { speakEnglish } from '../../speech/tts.js'
import { todayKey, dateKey, addDays } from '../../lib/dates.js'
import { shuffle } from '../../lib/random.js'
import BossSprite from './BossSprite.jsx'
import './BossBattle.css'

/**
 * Boss 战（选择题闯关 + FSRS 评分）：
 *  - 看词选释义，答对扣 Boss 15 血，答错 Boss 回血 15 并把词转场"重考队列"
 *  - 每个词只评分一次：答对 Good / 答错 Again（FSRS 自动加密排期）
 *  - 干扰项：本地词库抽词（答对路径）/ 昨日答错时 API 生成的缓存（答错路径）
 *  - 结算后：把答错词一次性批量生成明日干扰项+例句（省 token ②），全程离线可用（失败静默跳过）
 */
export default function BossBattle({ words, onFinish }) {
  const totalWords = words?.length || 0
  const maxHp = Math.min(300, Math.max(90, totalWords * 15))

  const [mainQ, setMainQ] = useState(() => [...(words || [])])
  const [current, setCurrent] = useState(() => words?.[0] || null)
  const [options, setOptions] = useState(null)
  const [optFail, setOptFail] = useState(false)
  const [answered, setAnswered] = useState(false)
  const [picked, setPicked] = useState(-1)
  const [hp, setHp] = useState(maxHp)
  const [rounds, setRounds] = useState(1)
  const [floats, setFloats] = useState([])
  const [hitKey, setHitKey] = useState(0)
  const [victory, setVictory] = useState(false)
  const [stats, setStats] = useState({ correct: 0, wrong: 0 })

  const poolRef = useRef([])
  const retryRef = useRef([])
  const attemptsRef = useRef(new Map())
  const ratedRef = useRef(new Set())
  const wrongMapRef = useRef(new Map())
  const finishedRef = useRef(false)
  const timerRef = useRef(null)
  const seenWordsRef = useRef(new Set())
  const statsRef = useRef({ correct: 0, wrong: 0 }) // 结算读这里（timer 闭包拿不到最新 setStats）

  // 换题：清状态 + 等词库就绪再组选项 + 自动朗读单词
  useEffect(() => {
    if (!current) return
    setOptions(null)
    setOptFail(false)
    setAnswered(false)
    setPicked(-1)
    seenWordsRef.current.add(current.id)
    speakEnglish(current.word)
    let alive = true
    ;(async () => {
      try {
        // 词库池可能还没加载完 → 在这里确保就绪，避免组不出题死等
        if (!poolRef.current || poolRef.current.length === 0) {
          poolRef.current = await allWords()
        }
        // 昨日答错生成缓存优先（明天开战直接用），否则本地抽词（答对路径零 API）
        let opts = null
        const cached = await getDistractors(current.wordNorm)
        if (alive && cached && cached.options && cached.options.length >= 2 && cached.dueDate === todayKey()) {
          opts = shuffle(cached.options.map((o) => ({ ...o })))
        }
        if (alive && !opts) opts = buildLocalOptions(current, poolRef.current)
        if (!alive) return
        if (opts && opts.length >= 2) setOptions(opts)
        else setOptFail(true) // 词库太小/数据异常：给出口而不是无限转圈
      } catch {
        if (alive) setOptFail(true)
      }
    })()
    return () => { alive = false }
  }, [current])

  useEffect(() => () => clearTimeout(timerRef.current), [])

  function pushFloat(text, cls) {
    const id = Date.now() + Math.random()
    setFloats((f) => [...f, { id, text, cls }])
    setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), 1000)
  }

  async function answer(i) {
    if (answered || !options || !options[i] || victory) return
    const opt = options[i]
    setAnswered(true)
    setPicked(i)
    const word = current
    const firstTime = !ratedRef.current.has(word.id)

    if (opt.correct) {
      if (firstTime) {
        ratedRef.current.add(word.id)
        recordReview(word.id, GOOD, 'boss').catch(() => {})
        statsRef.current.correct += 1
        setStats({ ...statsRef.current })
      }
      const nextHp = Math.max(0, hp - 15)
      setHp(nextHp)
      setHitKey((k) => k + 1)
      pushFloat('-15', 'dmg')
      if (nextHp <= 0) {
        setVictory(true)
        clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => finish(true), 1200)
        return
      }
    } else {
      if (firstTime) {
        ratedRef.current.add(word.id)
        recordReview(word.id, AGAIN, 'boss').catch(() => {})
        statsRef.current.wrong += 1
        setStats({ ...statsRef.current })
        wrongMapRef.current.set(word.wordNorm, word)
      }
      const n = attemptsRef.current.get(word.wordNorm) || 0
      attemptsRef.current.set(word.wordNorm, n + 1)
      if (n < 2) retryRef.current.push(word) // 最多重考 2 轮，防死循环
      const nextHp = Math.min(maxHp, hp + 15)
      setHp(nextHp)
      pushFloat('+15', 'heal')
    }

    clearTimeout(timerRef.current)
    // C9：答错且词库里有例句时，多停一会让用户看正确释义+听例句（即时强化）
    const wrongFeedback = !opt.correct
    const pause = wrongFeedback && word.example ? 3200 : wrongFeedback ? 2200 : 1000
    timerRef.current = setTimeout(nextQuestion, pause)
  }

  function nextQuestion() {
    setRounds((r) => r + 1)
    if (mainQ.length > 1) {
      setMainQ((q) => q.slice(1))
      setCurrent(mainQ[1])
    } else if (retryRef.current.length) {
      setMainQ([])
      setCurrent(retryRef.current.shift())
    } else {
      setCurrent(null)
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => finish(false), 400)
    }
  }

  async function finish(defeated) {
    if (finishedRef.current) return
    finishedRef.current = true
    clearTimeout(timerRef.current)
    // 答错词 → 一次批量 API 生成明日干扰项+例句；失败（离线等）静默跳过，下次答错会再触发
    const wrongs = [...wrongMapRef.current.values()]
    if (wrongs.length) {
      try {
        const map = await generateDistractorBatch(wrongs)
        const tomorrow = dateKey(addDays(new Date(), 1))
        for (const word of wrongs) {
          const gen = map.get(word.wordNorm)
          const wrongs3 = (gen?.distractors || []).map((text) => ({ text, correct: false, origin: 'api' }))
          const options4 = [
            { text: word.meaningZh, correct: true, origin: 'local' },
            ...wrongs3,
          ]
          await saveDistractors(word.wordNorm, {
            dueDate: tomorrow,
            options: options4,
            example: gen?.example || word.example || '',
          }).catch(() => {})
        }
      } catch {
        /* 离线/超时：不影响结算 */
      }
    }
    onFinish?.({
      defeated,
      correct: statsRef.current.correct,
      wrong: statsRef.current.wrong,
      total: totalWords,
      seen: seenWordsRef.current.size,
      ratedWordIds: [...ratedRef.current],
    })
  }

  const hpRatio = hp / maxHp
  const hpColor =
    hpRatio > 0.5 ? 'var(--color-primary)' : hpRatio > 0.25 ? 'var(--color-energy)' : 'var(--color-danger)'

  return (
    <div className="battle">
      <div className="battle-head">
        <button className="btn btn-plain" onClick={() => finish(false)} disabled={victory}>
          结束战斗
        </button>
        <span className="num">第 {stats.correct + stats.wrong}/{totalWords} 词已答</span>
      </div>

      {current && options ? (
        <>
          <div className="boss-area">
            <div className="boss-sprite" key={hitKey}>
              <BossSprite hpRatio={hpRatio} size={140} />
            </div>
            {/* 血条 */}
            <div className="hp-bar">
              <div
                className="hp-fill"
                style={{ width: `${Math.max(0, hpRatio * 100)}%`, background: hpColor }}
              />
            </div>
            <div className="hp-text num">{hp} / {maxHp}</div>
            <div className="boss-floats" aria-hidden="true">
              {floats.map((f) => (
                <span key={f.id} className={`bfloat float-up ${f.cls}`}>{f.text}</span>
              ))}
            </div>
            {victory && <div className="boss-victory ok-pop">💥 击败！</div>}
          </div>

          <div className="q-card">
            <div className="q-wordline">
              <span
                className="cefr-dot"
                style={{ background: `var(--cefr-${(current.cefr || 'unknown').toLowerCase()})` }}
              />
              <b className="h-display q-word">{current.word}</b>
              <span className="q-phon">{current.phonetic}</span>
              <button className="q-say" onClick={() => speakEnglish(current.word)} aria-label="再听一遍">🔊</button>
            </div>
            <p className="q-tip">选出正确的释义</p>
            <div className="q-options">
              {options.map((o, i) => {
                let cls = 'q-opt'
                if (answered) {
                  if (o.correct) cls += ' right'
                  else if (i === picked) cls += ' wrong shake'
                  else cls += ' dim'
                }
                return (
                  <button
                    key={i}
                    className={cls}
                    disabled={answered}
                    onClick={() => answer(i)}
                  >
                    {answered && o.correct && <span className="q-mark ok-pop">✓</span>}
                    {answered && i === picked && !o.correct && <span className="q-mark">✕</span>}
                    {o.text}
                  </button>
                )
              })}
            </div>
            {options.length < 4 && (
              <p className="q-tip warn">词库还小，干扰项不足 4 个（可先导入更多词）</p>
            )}
            {answered && picked >= 0 && options[picked] && !options[picked].correct && (
              <div className="wrong-feedback">
                <b className="wf-title">记住它：{current.word} {current.phonetic || ''}</b>
                <div className="wf-meaning">{current.meaningZh}</div>
                {current.example ? (
                  <div className="wf-example">
                    <span className="fb-say-s" onClick={() => speakEnglish(current.example)} aria-label="朗读例句">🔊</span>
                    {current.example}
                  </div>
                ) : (
                  <span className="wf-noexample">（该词暂无例句，可在生词本补）</span>
                )}
              </div>
            )}
          </div>
        </>
      ) : current && optFail ? (
        <div className="battle-end">
          <span className="done-check ok-pop">🤔</span>
          <h3 className="h-display">这题组不出来</h3>
          <p className="ph-sub">
            干扰项要从「词库其他词」里抽，词太少（或这个词没有释义）就出不了题。
            先去生词本再导入/补充几个词，回来继续打 Boss。
          </p>
          <button className="btn btn-primary btn-block" onClick={() => finish(false)}>
            结束本场（保留已答成绩）
          </button>
        </div>
      ) : current && !options ? (
        <div className="battle-loading"><div className="spinner" />准备题目…</div>
      ) : (
        <div className="battle-end">
          <span className="done-check ok-pop">{victory ? '🏆' : '😮‍💨'}</span>
          <h3 className="h-display">
            {victory ? 'Boss 被击败！' : 'Boss 撑住了…'}
          </h3>
          <p className="ph-sub">答对 {stats.correct} · 答错 {stats.wrong} · 共 {totalWords} 词</p>
        </div>
      )}
    </div>
  )
}
