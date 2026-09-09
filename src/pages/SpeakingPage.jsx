import { useEffect, useMemo, useRef, useState } from 'react'
import { dueWords, allWords, saveChatSession, recordSpeakingHit, todayWrongWords } from '../db/repo.js'
import { setUi, getApiKey } from '../lib/settings.js'
import { useSettings } from '../hooks/useSettings.js'
import { asrProvider } from '../speech/asr.js'
import { ttsProvider, speakEnglish } from '../speech/tts.js'
import { SCENES, sceneOf, aiReply, buildContext, summarizeChat } from '../api/chat.js'
import { api } from '../api/client.js'
import { speakSeq } from '../speech/speechUtil.js'
import { takeScenarioWords } from '../lib/scenarioIntent.js'
import ScenarioChat from '../components/scenario/ScenarioChat.jsx'
import './SpeakingPage.css'

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 判断一句用户英文里是否用出目标词（容忍常见屈折：-s/-es/-ed/-ing/-ly） */
export function matchesWord(text, norm) {
  return new RegExp(`\\b${esc(norm)}(?:s|es|ed|ing|ly)?\\b`, 'i').test(text)
}

/** 把文本里出现的目标词渲染成黄色高亮片段 */
export function highlightTargets(text, norms) {
  if (!text || !norms?.length) return text
  const re = new RegExp(`\\b(${norms.map(esc).join('|')})(?:s|es|ed|ing|ly)?\\b`, 'gi')
  const out = []
  let last = 0
  let m
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(
      <mark key={m.index} className="hlw">{m[0]}</mark>
    )
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export default function SpeakingPage({ openImport, goTab }) {
  const settings = useSettings()
  const hasKey = !!getApiKey()
  const micMode = settings.ui.micMode || 'hold'
  const canAsr = asrProvider.supported()

  const [phase, setPhase] = useState('scene') // scene | loading | chat | done
  const [scene, setScene] = useState('travel')
  const [targets, setTargets] = useState([]) // {…word, used}
  const [rounds, setRounds] = useState([]) // {role:'user'|'ai', content, zh?}
  const [summary, setSummary] = useState(null)
  const [busy, setBusy] = useState(false) // 等 AI 回复
  const [doneData, setDoneData] = useState(null)

  // 情景对话（错词编剧情）
  const [scenWords, setScenWords] = useState(null) // 传入 ScenarioChat 的词
  const [todayWrongs, setTodayWrongs] = useState([]) // 今日情景（自动入口）
  useEffect(() => {
    // 手动入口：生词本多选后跳转 → 消费意图
    const w = takeScenarioWords()
    if (w && w.length >= 3 && w.length <= 5) setScenWords(w)
    // 自动入口：今日 Boss 错词 ≥3 才出卡
    todayWrongWords().then((list) => {
      if (list && list.length >= 3) setTodayWrongs(list)
    })
  }, [])

  // 麦克风/输入
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [micErr, setMicErr] = useState('')
  const [draft, setDraft] = useState('')
  const stopAsrRef = useRef(null)
  const listeningRef = useRef(false)
  const submittingRef = useRef(false)
  const collectedRef = useRef('')
  const wantSubmitRef = useRef(false)

  // TTS 状态
  const [talking, setTalking] = useState(false)
  const talkingRef = useRef(false)
  const speakFallbackRef = useRef(null)
  const aiEnMark = useRef('')
  const listRef = useRef(null)
  const scrollBottom = () => {
    requestAnimationFrame(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }) })
  }
  useEffect(scrollBottom, [rounds, interim, busy])

  async function pickTargets() {
    // 取今日到期词至多 5 个；不足用"最接近到期"的学习中词补齐
    const due = await dueWords({ limit: 5 })
    if (due.length >= 5) return due
    const normIn = new Set(due.map((w) => w.wordNorm))
    const all = await allWords()
    const rest = all
      .filter((w) => !w.known && !normIn.has(w.wordNorm))
      .sort((a, b) => a.due - b.due)
    return [...due, ...rest].slice(0, 5)
  }

  async function startChat() {
    if (!hasKey) return
    setPhase('loading')
    const picked = await pickTargets()
    if (!picked.length) {
      setPhase('scene')
      alert('词库还是空的：先拍照导入几个词再来练口语')
      return
    }
    setTargets(picked.map((w) => ({ ...w, used: false })))
    setRounds([])
    setSummary(null)
    setDoneData(null)
    setPhase('chat')
    setBusy(true)
    try {
      const greeting = await aiReply(scene, picked, buildContext(scene, picked, []))
      pushRound(picked, { role: 'ai', content: greeting.en, zh: greeting.zh })
      speakAi(greeting.en)
    } finally {
      setBusy(false)
    }
  }
  function pushRound(tgt, r) {
    setRounds((prev) => [...prev, r])
    // 用户开口时探测目标词命中
    if (r.role === 'user') {
      const hits = tgt.filter((w) => !w.used && matchesWord(r.content, w.wordNorm))
      if (hits.length) setTargets((ts) => ts.map((t) => (hits.some((h) => h.wordNorm === t.wordNorm) ? { ...t, used: true } : t)))
    }
  }

  function speakAi(en) {
    stopTalking()
    aiEnMark.current = en
    setTalking(true)
    talkingRef.current = true
    ttsProvider.speak(en, {
      rate: 0.98,
      onend: () => { talkingRef.current = false; setTalking(false) },
      onerror: () => { talkingRef.current = false; setTalking(false) },
    })
    // 兜底结束（个别环境 onend 不可靠）
    window.clearTimeout(speakFallbackRef.current)
    speakFallbackRef.current = window.setTimeout(() => {
      if (talkingRef.current) { talkingRef.current = false; setTalking(false) }
    }, Math.max(2500, en.length * 95))
  }
  function stopTalking() {
    window.clearTimeout(speakFallbackRef.current)
    talkingRef.current = false
    setTalking(false)
    ttsProvider.stop()
  }

  async function sendText(raw) {
    const text = String(raw || '').trim()
    if (!text || busy || submittingRef.current) return
    submittingRef.current = true
    stopTalking()
    setDraft('')
    setInterim('')
    setMicErr('')
    pushRound(targets, { role: 'user', content: text })
    setBusy(true)
    try {
      // 上下文 ≤6 轮；超出后先生成一次摘要并只带最近 4 轮（省 token ④）
      const tgt = targets // 已含 used 标记的最新快照（pushRound 用了 state）
      let msgs = []
      const allR = [...rounds, { role: 'user', content: text }]
      if (allR.length <= 6) {
        msgs = buildContext(scene, tgt, allR)
      } else {
        if (!summary) {
          const older = allR.slice(0, Math.max(0, allR.length - 4))
          const s = await summarizeChat(scene, tgt, older).catch(() => '')
          setSummary(s)
        }
        msgs = buildContext(scene, tgt, allR.slice(-4), summary || undefined)
      }
      const reply = await aiReply(scene, tgt, msgs)
      pushRound(tgt, { role: 'ai', content: reply.en, zh: reply.zh })
      speakAi(reply.en)
    } catch (e) {
      pushRound(targets, {
        role: 'ai',
        content: e?.message || '（AI 回复失败，请重试）',
        zh: '',
        error: true,
      })
    } finally {
      setBusy(false)
      submittingRef.current = false
    }
  }

  /* —— 麦克风：松手/二次点按只发"停止"，等 onEnd 拿到完整 final 再提交 —— */
  function beginListen() {
    if (!canAsr || busy || listeningRef.current) return
    listeningRef.current = true
    wantSubmitRef.current = false
    collectedRef.current = ''
    setListening(true)
    setMicErr('')
    setInterim('')
    stopAsrRef.current = asrProvider.start({
      onInterim: setInterim,
      onFinal: (t) => { collectedRef.current = `${collectedRef.current} ${t}`.trim() },
      onError: ({ message }) => setMicErr(message),
      onEnd: () => {
        listeningRef.current = false
        setListening(false)
        setInterim('')
        if (wantSubmitRef.current && collectedRef.current) {
          sendText(collectedRef.current)
        }
        collectedRef.current = ''
        wantSubmitRef.current = false
      },
    })
  }
  function stopAndSend() {
    if (!listeningRef.current) return
    wantSubmitRef.current = true
    stopAsrRef.current?.()
  }
  function onMicPointerDown(e) {
    e.preventDefault()
    if (micMode === 'tap') {
      listeningRef.current ? stopAndSend() : beginListen()
      return
    }
    beginListen()
  }
  function onMicPointerUp() {
    if (micMode === 'hold') stopAndSend()
  }

  const usedCount = targets.filter((t) => t.used).length
  const aiCount = rounds.filter((r) => r.role === 'ai').length

  /* —— 结算 —— */
  async function finishChat() {
    if (busy) return
    stopTalking()
    setBusy(true)
    try {
      const usedWords = targets.filter((t) => t.used)
      // 口语命中词 → 当天 FSRS 加权（repo 内部三种分支）
      await Promise.allSettled(usedWords.map((w) => recordSpeakingHit(w.id)))
      // 小评：一次文本调用（2-3 句中文点评）
      let feedback = ''
      try {
        const transcript = rounds.filter((r) => r.role === 'user').map((r) => r.content).join(' | ')
        const r = await api.complete({
          messages: [
            { role: 'system', content: '你是口语教练。基于用户真实输出给 2-3 句中文点评（肯定优点+指出 1 个改进点），≤50 词，不输出标题。' },
            { role: 'user', content: `目标词: ${targets.map((t) => t.word).join(', ')}。已正确使用: ${usedWords.map((w) => w.word).join(', ') || '无'}。用户说的话: ${transcript}` },
          ],
          maxTokens: 360,
          task: 'chat',
          hint: '口语点评',
        })
        feedback = r.content.trim()
      } catch {
        feedback = '坚持开口就是赢。下次把没用到的那几个目标词带进句子里试试。'
      }
      const record = {
        scene,
        startedAt: Date.now() - rounds.length * 30000,
        targetWordIds: targets.map((t) => t.id),
        summary,
        rounds,
        stats: { aiCount, usedCount, targetCount: targets.length, feedback },
        doneAt: Date.now(),
      }
      await saveChatSession(record).catch(() => {})
      setDoneData(record.stats)
      setPhase('done')
    } finally {
      setBusy(false)
    }
  }

  /* 重听整场（AI 的英文逐条连放） */
  function replayAll() {
    const seq = rounds.filter((r) => r.role === 'ai' && !r.error).map((r) => r.content)
    speakSeq(seq, () => {})
    void seq
  }

  const aiNorms = useMemo(() => targets.map((t) => t.wordNorm), [targets])

  /* ============================ 渲染 ============================ */
  // 情景对话模式（手动/自动入口共用的整场对演）
  if (scenWords) {
    return (
      <section className="page speak-page">
        <header className="topbar">
          <h1 className="h-display topbar-title">🎭 错词情景对演</h1>
        </header>
        <ScenarioChat words={scenWords} onClose={() => setScenWords(null)} goTab={goTab} />
      </section>
    )
  }

  if (phase === 'scene') {
    return (
      <section className="page">
        <header className="topbar">
          <h1 className="h-display topbar-title">听说</h1>
        </header>
        <div className="pad speak-pad">
          {/* 自动入口：今日 Boss 错词 ≥3 → 今日情景 */}
          {todayWrongs.length >= 3 && (
            <button className="sc-today-card" onClick={() => setScenWords(todayWrongs.slice(0, 5))}>
              <div className="sc-today-title">🎬 今日情景 · 错词入戏</div>
              <p className="sc-today-sub">
                用今天 Boss 战答错的 {todayWrongs.length} 个词编一段剧情对演（取前 5 个）：
                {todayWrongs.slice(0, 5).map((w) => w.word).join(' · ')}
              </p>
            </button>
          )}
          <p className="speak-sub">选个话题，AI 会把词库里今天到期的词（≤5 个）自然编进对话，陪你开口说英文</p>
          <div className="scene-grid">
            {SCENES.map((s) => (
              <button
                key={s.id}
                className={`scene-card${scene === s.id ? ' on' : ''}`}
                onClick={() => setScene(s.id)}
              >
                <span className="scene-icon">{s.icon}</span>
                <b>{s.zh}</b>
              </button>
            ))}
          </div>
          {!hasKey && (
            <p className="speak-warn">还没配置 API Key：去「我的」填好再来练（情景练习也依赖它）</p>
          )}
          <button className="btn btn-primary btn-block" disabled={!hasKey} onClick={startChat}>
            开始对话
          </button>
        </div>
      </section>
    )
  }

  if (phase === 'loading') {
    return (
      <section className="page">
        <div className="pad speak-pad center"><div className="spinner" /><p>挑选今日目标词…</p></div>
      </section>
    )
  }

  if (phase === 'done') {
    return (
      <section className="page">
        <div className="pad speak-pad">
          <div className="done-panel">
            <span className="done-check ok-pop">🎉</span>
            <h2 className="h-display">结算卡</h2>
            <div className="settle-stats">
              <div className="settle-num">
                <b className="num">{doneData?.usedCount ?? 0}</b>
                <span>目标词命中 / {doneData?.targetCount ?? targets.length}</span>
              </div>
              <div className="settle-num">
                <b className="num">{doneData?.aiCount ?? aiCount}</b>
                <span>AI 回合</span>
              </div>
            </div>
            {doneData?.feedback && <p className="feedback-note">{doneData.feedback}</p>}
            <p className="speak-sub">命中的词已按 FSRS 加权（今天直接算"良好"以上）</p>
            <div className="deck-nav" style={{ width: '100%' }}>
              <button className="btn btn-ghost" onClick={replayAll}>重听整场</button>
              <button className="btn btn-primary" onClick={() => goTab('stats')}>完成</button>
            </div>
            <button className="btn btn-plain" onClick={() => setPhase('scene')}>再来一局</button>
          </div>
        </div>
      </section>
    )
  }

  /* chat */
  return (
    <section className="page">
      <header className="topbar">
        <h1 className="h-display topbar-title">{sceneOf(scene).icon} {sceneOf(scene).zh}对话</h1>
        <button className="btn btn-plain" onClick={() => { stopTalking(); stopAsrRef.current?.(); setPhase('scene') }}>结束</button>
      </header>

      {/* 目标词 chips */}
      <div className="target-strip">
        <span className="target-label">目标词</span>
        {targets.map((t) => (
          <span key={t.id} className={`target-chip${t.used ? ' used' : ''}`} title={t.meaningZh}>
            {t.word}{t.used ? '✓' : ''}
          </span>
        ))}
        <span className="num target-count">{usedCount}/{targets.length}</span>
      </div>

      <div className="chat-list" ref={listRef}>
        {rounds.map((r, i) =>
          r.role === 'user' ? (
            <div key={i} className="bubble-row user">
              <div className="bubble bubble-user">{r.content}</div>
            </div>
          ) : (
            <Bubble key={i} r={r} aiNorms={aiNorms} onSpeak={speakAi} talking={talking && aiEnMark.current === r.content} onStop={stopTalking} />
          )
        )}
        {busy && <div className="typing"><i /><i /><i /></div>}
        {interim && <div className="bubble-row user"><div className="bubble bubble-user interim">{interim}…</div></div>}
        {micErr && <p className="mic-err">{micErr}</p>}
      </div>

      {aiCount >= 8 && !doneData && (
        <div className="settle-cta">
          <button className="btn btn-accent btn-block" onClick={finishChat} disabled={busy}>
            ✨ 聊得差不多啦，看看这场的结算
          </button>
        </div>
      )}

      <div className="chat-inputbar">
        <div className="inputrow">
          <input
            className="field chat-input"
            placeholder={busy ? 'AI 正在回复…' : 'type in English 或点麦克风说话'}
            value={draft}
            disabled={busy}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); if (draft.trim()) sendText(draft) } }}
          />
          <button className="send-btn" disabled={busy || !draft.trim()} onClick={() => sendText(draft)}>➤</button>
        </div>
        <div className="microw">
          {canAsr ? (
            <button
              className={`mic-btn${listening ? ' listening' : ''}`}
              aria-label={micMode === 'hold' ? '按住说话' : '点按说话'}
              onPointerDown={onMicPointerDown}
              onPointerUp={onMicPointerUp}
              onPointerLeave={() => { if (micMode === 'hold' && listeningRef.current) stopAndSend() }}
              onContextMenu={(e) => e.preventDefault()}
            >
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <rect x="9" y="2" width="6" height="12" rx="3" />
                <path d="M5 10a7 7 0 0 0 14 0" />
                <path d="M12 19v3" />
              </svg>
            </button>
          ) : (
            <span className="no-asr">此浏览器不支持语音识别，请打字</span>
          )}
          <div className="mic-meta">
            <button className="micmode" onClick={() => setUi({ micMode: micMode === 'hold' ? 'tap' : 'hold' })}>
              {micMode === 'hold' ? '按住说话' : '点按说话'}
            </button>
            <span className="mic-hint">{talking ? 'AI 朗读中 — 轻点打断' : listening ? '听你说话…' : '目标词黄色高亮 = 命中'}</span>
            {talking && (
              <button className="stop-btn" onClick={stopTalking}>⏹ 轻点打断</button>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

function Bubble({ r, aiNorms, onSpeak, talking, onStop }) {
  const [showZh, setShowZh] = useState(false)
  return (
    <div className="bubble-row ai">
      <div className={`bubble bubble-ai${r.error ? ' err' : ''}`} onClick={() => !r.error && onSpeak(r.content)}>
        <div className="ai-text">{highlightTargets(r.content, aiNorms)}</div>
        {r.zh && (
          <>
            <button
              className="zh-toggle"
              onClick={(e) => { e.stopPropagation(); setShowZh(!showZh) }}
            >
              {showZh ? '收起中文 ▲' : '中文翻译 ▼'}
            </button>
            {showZh && <div className="ai-zh">{r.zh}</div>}
          </>
        )}
        {talking && !r.error && (
          <button className="stop-btn inline" onClick={(e) => { e.stopPropagation(); onStop() }}>⏹ 打断</button>
        )}
        <button className="replay-mini" aria-label="重读" onClick={(e) => { e.stopPropagation(); onSpeak(r.content) }}>🔊</button>
      </div>
    </div>
  )
}
