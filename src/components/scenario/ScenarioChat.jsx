import { useEffect, useMemo, useRef, useState } from 'react'
import { getOrCreateScenario, buildScenarioSystem, SCENARIO_MAX_ROUNDS } from '../../api/scenario.js'
import { api, parseJsonContent } from '../../api/client.js'
import { speakEnglish } from '../../speech/tts.js'
import { asrProvider } from '../../speech/asr.js'
import { recordSpeakingHit, saveChatSession } from '../../db/repo.js'
import { normalizeWord } from '../../lib/words.js'
import './ScenarioChat.css'

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const inText = (text, norm) => new RegExp(`\\b${esc(norm)}(?:s|es|ed|ing|ly)?\\b`, 'i').test(text || '')

/** 每轮 AI 回复：双语 JSON 一次返回 */
async function scenarioReply(scenario, rounds) {
  const msgs = [{ role: 'system', content: buildScenarioSystem(scenario) }]
  const tail = rounds.slice(-6)
  for (const r of tail) {
    if (r.role === 'user' || r.role === 'ai') {
      msgs.push({ role: r.role === 'user' ? 'user' : 'assistant', content: r.content })
    }
  }
  // 偶发空返回 → 重试一次；解析策略宽容：拿不到 JSON 时直接把模型原话当正文（不误判失败）
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { content } = await api.complete({
        messages: msgs,
        json: false,
        maxTokens: 200,
        temperature: 0.8 + attempt * 0.15,
        task: 'chat',
        hint: attempt > 1 ? '情景对演·重试' : '情景对演',
      })
      const text = String(content || '').trim()
      if (!text) throw new Error('empty')
      // 先试 JSON {en,zh}；解析失败/缺 en 时，把原文当英文正文（避免误伤正常对话）
      try {
        const parsed = parseJsonContent(text, '情景对演')
        const en = String(parsed?.en || '').trim()
        if (en) return { en, zh: String(parsed?.zh || '').trim() }
      } catch {
        /* 落到下方原文兜底 */
      }
      return { en: text.slice(0, 500), zh: '' }
    } catch {
      /* retry */
    }
  }
  throw new Error('NPC 连续两次回复失败，请稍后重试')
}

const LOCAL_PRAISES = [
  'Yes, well said! Keep going.',
  'Exactly — nice one! What else happened?',
  'Great sentence! The scene moves on.',
  'Perfect. Now the next twist...',
]
const LOCAL_FILLERS = [
  'I see. Tell me more.',
  'Interesting — what happened next?',
  'Hmm, that sounds tricky. How did you deal with it?',
  'Right. And how did that make you feel?',
]

/** 本地台词兜底：AI 掉线时也能继续对戏（提示用下一个目标词 / 简单回应推进） */
function localLine(norms, statusRef, aiCount, lastUserText) {
  const s = statusRef.current
  const usedCount = norms.filter((n) => s.get(n)?.used).length
  const nextTarget = norms.find((n) => !s.get(n)?.used)
  if (lastUserText && usedCount > 0) return LOCAL_PRAISES[aiCount % LOCAL_PRAISES.length]
  if (nextTarget) return `Now try to slip "${nextTarget}" naturally into your sentence.`
  return LOCAL_FILLERS[aiCount % LOCAL_FILLERS.length]
}

export default function ScenarioChat({ words, onClose, goTab }) {
  const wordsMeta = useMemo(
    () =>
      new Map(
        words.map((w) => [
          normalizeWord(w.word),
          { id: w.id, word: w.word, meaningZh: w.meaningZh || '' },
        ])
      ),
    [words]
  )
  const norms = [...wordsMeta.keys()]

  const [phase, setPhase] = useState('gen') // gen | intro | chat | done
  const [genErr, setGenErr] = useState('')
  const [scenario, setScenario] = useState(null)
  const [rounds, setRounds] = useState([])
  const [status, setStatus] = useState(() => {
    const m = new Map()
    norms.forEach((n) => m.set(n, { used: false, demo: false, miss: 0, hinted: false }))
    return m
  })
  const [busy, setBusy] = useState(false)
  const [listening, setListening] = useState(false)
  const [draft, setDraft] = useState('')
  const [endReason, setEndReason] = useState('')
  const statusRef = useRef(status)
  statusRef.current = status
  const listRef = useRef(null)
  const listeningRef = useRef(false)
  const stopAsrRef = useRef(null)
  const collectedRef = useRef('')
  const busyRef = useRef(false)
  const localNotedRef = useRef(false) // AI 掉线降级提示只发一次

  const aiCount = rounds.filter((r) => r.role === 'ai').length

  useEffect(() => {
    getOrCreateScenario(words)
      .then((s) => {
        setScenario(s)
        setPhase('intro')
      })
      .catch((e) => setGenErr(e?.message || '情景生成失败'))
  }, [words])

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [rounds, busy])

  function markSeen(text, role) {
    if (!text) return
    setStatus((prev) => {
      const next = new Map(prev)
      for (const n of norms) {
        if (inText(text, n)) {
          const st = next.get(n)
          if (role === 'ai') next.set(n, { ...st, demo: true })
          if (role === 'user') next.set(n, { ...st, used: true })
        }
      }
      return next
    })
  }

  function speakEn(text) {
    if (text) speakEnglish(text)
  }

  function regenerate() {
    setScenario(null)
    setGenErr('')
    setPhase('gen')
    getOrCreateScenario(words, { force: true })
      .then((s) => {
        setScenario(s)
        setPhase('intro')
      })
      .catch((e) => setGenErr(e?.message || '情景生成失败'))
  }

  async function beginChat() {
    setPhase('chat')
    // NPC 开场白作为第一句 AI（自然示范首个目标词）
    pushRound('ai', { content: scenario.opening_line, zh: '' })
    speakEn(scenario.opening_line)
  }

  function pushRound(role, r) {
    if (role !== 'user') markSeen(r.content, 'ai')
    else markSeen(r.content, 'user')
    setRounds((prev) => [...prev, { role, ...r }])
  }

  async function sendText(raw) {
    const text = String(raw || '').trim()
    if (!text || busyRef.current || phase !== 'chat') return
    busyRef.current = true
    setBusy(true)
    setDraft('')
    try {
      // exit → 直接结算（不调模型）
      if (/^exit$/i.test(text)) {
        doSettle('exit', text)
        return
      }
      pushRound('user', { content: text })
      // 提示计数：用过示范但两轮没说出 → 本地中文提示（不阻塞剧情）
      setStatus((prev) => {
        const next = new Map(prev)
        for (const n of norms) {
          const st = next.get(n)
          if (st.demo && !st.used && !st.hinted) {
            const miss = st.miss + (inText(text, n) ? 0 : 1)
            if (miss >= 2 && !inText(text, n)) {
              next.set(n, { ...st, miss, hinted: true })
              const meta = wordsMeta.get(n)
              const hint = `「${meta.word}」= ${meta.meaningZh || '…'}，试着说它`
              setRounds((prev) => [...prev, { role: 'hint', content: '', zh: hint }])
            } else {
              next.set(n, { ...st, miss })
            }
          }
        }
        return next
      })
      if (rounds.filter((r) => r.role === 'ai').length + 1 >= SCENARIO_MAX_ROUNDS) {
        doSettle('rounds', text)
        return
      }
      const reply = await scenarioReply(scenario, [...rounds, { role: 'user', content: text }])
      pushRound('ai', reply)
      speakEn(reply.en)
    } catch {
      // AI 掉线 → 本地台词兜底，练习不中断（仅首次提示降级）
      if (!localNotedRef.current) {
        localNotedRef.current = true
        pushRound('hint', { content: '', zh: '（AI 回复暂不可用，已切换本地台词继续对戏）' })
      }
      const local = localLine(norms, statusRef, rounds.filter((r) => r.role === 'ai').length, text)
      pushRound('ai', { content: local, zh: '' })
      speakEn(local)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  async function doSettle(reason, lastUserText) {
    setEndReason(reason)
    setPhase('done')
    // ✓ 判定直接扫用户说过的话（不依赖可能滞后的 status 状态）
    const userTurns = [
      ...rounds.filter((r) => r.role === 'user').map((r) => r.content),
      ...(lastUserText ? [lastUserText] : []),
    ]
    const usedSet = new Set()
    for (const ut of userTurns) for (const n of norms) if (inText(ut, n)) usedSet.add(n)
    const used = [...usedSet]
    // ✓ 词当天 FSRS 加权
    await Promise.allSettled(
      used.map((n) => {
        const meta = wordsMeta.get(n)
        return meta?.id ? recordSpeakingHit(meta.id) : Promise.resolve()
      })
    )
    const record = {
      scene: `scen::${scenario?.title || '情景'}`,
      startedAt: Date.now() - rounds.length * 20000,
      targetWordIds: words.map((w) => w.id),
      rounds: [
        ...rounds,
        ...(lastUserText ? [{ role: 'user', content: lastUserText }] : []),
      ],
      stats: {
        usedCount: used.length,
        targetCount: norms.length,
        aiCount: rounds.filter((r) => r.role === 'ai').length,
        scenario: true,
      },
      doneAt: Date.now(),
    }
    await saveChatSession(record).catch(() => {})
  }

  const statusView = (n) => {
    const st = status.get(n)
    const meta = wordsMeta.get(n)
    if (st?.used) return { mark: '✓', txt: '已开口用出', cls: 'ok' }
    if (st?.demo || st?.hinted) return { mark: '⚠️', txt: '听懂未用出', cls: 'warn' }
    return { mark: '❌', txt: '未出现', cls: 'miss' }
  }

  /* —— 麦克风 —— */
  function beginListen() {
    if (!asrProvider.supported() || listeningRef.current || busy) return
    listeningRef.current = true
    collectedRef.current = ''
    setListening(true)
    stopAsrRef.current = asrProvider.start({
      onInterim: () => {},
      onFinal: (t) => { collectedRef.current = `${collectedRef.current} ${t}`.trim() },
      onEnd: () => {
        listeningRef.current = false
        setListening(false)
        if (collectedRef.current) sendText(collectedRef.current)
        collectedRef.current = ''
      },
    })
  }
  function stopListenSend() {
    if (!listeningRef.current) return
    stopAsrRef.current?.()
  }

  if (phase === 'gen') {
    return (
      <div className="sc-root">
        {genErr ? (
          <div className="sc-panel">
            <p className="prof-err">生成失败：{genErr}</p>
            <button className="btn btn-plain" onClick={onClose}>返回</button>
          </div>
        ) : (
          <div className="battle-loading">
            <div className="spinner" />
            <p>AI 正在把这 {norms.length} 个词编成一段剧情…</p>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="sc-root">
      {scenario && phase === 'intro' && (
        <div className="sc-intro">
          <span className="done-check ok-pop">🎭</span>
          <h2 className="h-display">{scenario.title}</h2>
          <p className="sc-brief">{scenario.scene_brief_cn || '（无简介）'}</p>
          <div className="sc-roles">
            <div><b>你：</b>{scenario.your_role}</div>
            <div><b>NPC：</b>{scenario.npc_role}（{scenario.npc_persona}）</div>
          </div>
          <p className="sc-words-note">目标词：{norms.map((n) => n + (wordsMeta.get(n).meaningZh ? ` ${wordsMeta.get(n).meaningZh}` : '')).join(' · ')}</p>
          <button className="btn btn-primary btn-block" onClick={beginChat}>开始入戏</button>
          <button className="btn btn-plain btn-block" onClick={regenerate}>🔄 换一个情景（重新生成）</button>
        </div>
      )}

      {phase === 'chat' && (
        <div className="sc-chat">
          <div className="sc-chat-head">
            <b>{scenario?.title}</b>
            <span className="num">{norms.length} 词 · {aiCount}/{SCENARIO_MAX_ROUNDS} 轮</span>
          </div>
          <div className="chat-list sc-list" ref={listRef}>
            {rounds.map((r, i) =>
              r.role === 'user' ? (
                <div key={i} className="bubble-row user">
                  <div className="bubble bubble-user">{r.content}</div>
                </div>
              ) : r.role === 'hint' ? (
                <div key={i} className="sc-hint">{r.zh}</div>
              ) : (
                <div key={i} className="bubble-row ai">
                  <div className={`bubble bubble-ai${r.error ? ' err' : ''}`}>
                    <div className="ai-text">{r.content}</div>
                    {r.zh && <div className="ai-zh">{r.zh}</div>}
                    {!r.error && (
                      <button className="sc-listen" onClick={() => speakEn(r.content)}>🔊</button>
                    )}
                  </div>
                </div>
              )
            )}
            {busy && <div className="typing"><i /><i /><i /></div>}
          </div>
          <div className="chat-inputbar">
            <div className="inputrow">
              <input
                className="field chat-input"
                placeholder={busy ? 'NPC 思考中…' : 'English 回复（或输入 exit 结束）'}
                value={draft}
                disabled={busy}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    if (draft.trim()) sendText(draft)
                  }
                }}
              />
              <button className="send-btn" disabled={busy || !draft.trim()} onClick={() => sendText(draft)}>➤</button>
            </div>
            <div className="microw">
              {asrProvider.supported() ? (
                <button
                  className={`mic-btn${listening ? ' listening' : ''}`}
                  onPointerDown={(e) => { e.preventDefault(); beginListen() }}
                  onPointerUp={stopListenSend}
                  onContextMenu={(e) => e.preventDefault()}
                >
                  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                    <rect x="9" y="2" width="6" height="12" rx="3" />
                    <path d="M5 10a7 7 0 0 0 14 0" />
                    <path d="M12 19v3" />
                  </svg>
                </button>
              ) : (
                <span className="no-asr">此浏览器不支持语音，请打字</span>
              )}
              <button className="btn btn-plain" onClick={() => doSettle('manual')}>结束对演</button>
            </div>
          </div>
        </div>
      )}

      {phase === 'done' && (
        <div className="done-panel sc-settle">
          <span className="done-check ok-pop">🎬</span>
          <h2 className="h-display">结算 · {scenario?.title}</h2>
          <ul className="sc-status">
            {norms.map((n) => {
              const v = statusView(n)
              return (
                <li key={n} className={`sc-status-${v.cls}`}>
                  <span>{v.mark}</span>
                  <b>{n}</b>
                  <span className="num">{wordsMeta.get(n).meaningZh}</span>
                  <em>{v.txt}</em>
                </li>
              )
            })}
          </ul>
          <p className="sc-epilogue">
            {endReason === 'exit'
              ? '戏已散场，台词都记住了吗？明天错词会再约你一场。'
              : endReason === 'rounds'
                ? '这一场聊得够尽兴——没机会开口的词，明天情景再见。'
                : '下一幕见！把没开口的词再练练，错词池会再约你。'}
          </p>
          <p className="speak-sub">✓ 已用出的词已按 FSRS 加权（≥Good）</p>
          <div className="deck-nav" style={{ width: '100%' }}>
            <button className="btn btn-plain" onClick={onClose}>返回</button>
            <button className="btn btn-primary" onClick={() => goTab('stats')}>看统计</button>
          </div>
        </div>
      )}
    </div>
  )
}
