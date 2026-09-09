import { useRef, useState } from 'react'
import { speakEnglish } from '../speech/tts.js'
import { formatDueShort } from '../lib/dates.js'
import { themeZh } from '../lib/words.js'
import './WordRow.css'

const ACT = 132 // 滑出的操作区宽度（3 个按钮）

/**
 * 生词行：内容区 + 左滑露出的 [编辑 | 标熟/回退 | 删除]。
 * 触摸用 Pointer Events 横向拖拽（touch-action: pan-y 保证竖向仍可滚动页面）。
 */
export default function WordRow({
  word,
  recent,
  delayMs,
  onEdit,
  onToggleKnown,
  onAskDelete,
  selectable = false,
  selected = false,
  onToggleSelect,
}) {
  const [open, setOpen] = useState(false)
  const cardRef = useRef(null)
  const startRef = useRef(null)
  const draggingRef = useRef(false)
  const openRef = useRef(false)
  openRef.current = open

  const dueMs = word.due || 0
  // 是否还没学过的新词（FSRS New 状态 / 从未复习）
  const isFresh = !word.fsrs || word.fsrs.state === 0 || !word.lastReviewAt
  // 只有"学过且过了到期日"才算逾期；新词显示"今日新学"而不是刺眼的已到期
  const overdue = !word.known && !isFresh && dueMs < Date.now()

  function onPointerDown(e) {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    startRef.current = { x: e.clientX, y: e.clientY, base: openRef.current ? -ACT : 0 }
    draggingRef.current = false
  }
  function onPointerMove(e) {
    const st = startRef.current
    if (!st) return
    const dx = e.clientX - st.x
    const dy = e.clientY - st.y
    if (!draggingRef.current) {
      // 判定为横向拖拽才开始平移；竖向留给页面滚动
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.2) {
        draggingRef.current = true
        if (cardRef.current) cardRef.current.style.transition = 'none'
      } else if (Math.abs(dy) > 12) {
        startRef.current = null // 用户在纵向滚动，放弃本次
      }
      return
    }
    const raw = st.base + dx
    const t = Math.max(-ACT - 16, Math.min(24, raw))
    if (cardRef.current) cardRef.current.style.transform = `translateX(${t}px)`
  }
  function endDrag(e) {
    const st = startRef.current
    startRef.current = null
    if (cardRef.current) cardRef.current.style.transition = ''
    if (cardRef.current) cardRef.current.style.transform = ''
    if (draggingRef.current && st) {
      const t = st.base + (e.clientX - st.x)
      setOpen(t < -ACT * 0.45)
    }
    draggingRef.current = false
  }

  return (
    <li className={`swipe${open ? ' open' : ''}${word.known ? ' row-known' : ''}${selectable ? ' has-sel' : ''}`}>
      {selectable && (
        <button
          className={`sel-btn${selected ? ' on' : ''}`}
          aria-pressed={selected}
          onClick={(e) => { e.stopPropagation(); onToggleSelect?.(word) }}
        >
          {selected ? '✓' : ''}
        </button>
      )}
      <div className="swipe-actions" aria-hidden="true">
        <button className="sa-btn sa-edit" onClick={() => { setOpen(false); onEdit(word) }}>
          ✏️<span>编辑</span>
        </button>
        <button
          className={`sa-btn ${word.known ? 'sa-back' : 'sa-known'}`}
          onClick={() => { setOpen(false); onToggleKnown(word) }}
        >
          {word.known ? '↩️' : '⭐'}<span>{word.known ? '回退' : '标熟'}</span>
        </button>
        <button className="sa-btn sa-del" onClick={() => { setOpen(false); onAskDelete(word) }}>
          🗑️<span>删除</span>
        </button>
      </div>

      <div
        ref={cardRef}
        className={`word-card${recent ? ' chip-pop' : ''}`}
        style={recent && delayMs ? { animationDelay: `${delayMs}ms` } : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className="wc-top">
          <div className="wc-words">
            <span
              className="cefr-dot"
              style={{ background: `var(--cefr-${(word.cefr || 'unknown').toLowerCase()})` }}
              title={`CEFR ${word.cefr || '未分级'}`}
            />
            <b className="h-display wc-word">{word.word}</b>
            {word.pos && <span className="wc-pos">{word.pos}</span>}
            <span className="wc-phon">{word.phonetic}</span>
          </div>
          <button
            className="wc-say"
            aria-label={`朗读 ${word.word}`}
            onClick={(e) => { e.stopPropagation(); speakEnglish(word.word) }}
          >
            🔊
          </button>
        </div>
        <div className="wc-meaning">{word.meaningZh || <i>（暂无释义，点编辑补充）</i>}</div>
        <div className="wc-meta">
          {/\s/.test(word.word) && <span className="tag tag-phrase">词组</span>}
          {word.theme && <span className="tag">{themeZh(word.theme) || word.theme}</span>}
          {word.known ? (
            <span className="tag tag-energy">已掌握</span>
          ) : (
            <span
              className={`tag${overdue ? ' tag-overdue' : ''}${isFresh ? ' tag-fresh' : ''}`}
            >
              {isFresh ? '今日新学' : overdue ? '已到期' : `复习 ${formatDueShort(dueMs)}`}
            </span>
          )}
        </div>
      </div>
    </li>
  )
}
