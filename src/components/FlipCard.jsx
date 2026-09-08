import { useEffect, useState } from 'react'
import { speakEnglish } from '../speech/tts.js'
import './FlipCard.css'

/**
 * Anki 翻卡（今日「先学」用，不计分——评分在 Boss 战）：
 * 正面 单词+音标；点按 → Y 轴 3D 翻转出 释义/词性/例句。
 * 翻到背面时 onReveal 回调一次（今日进度计数用）。
 */
export default function FlipCard({ word, onReveal, onKnown }) {
  const [flipped, setFlipped] = useState(false)

  useEffect(() => {
    setFlipped(false) // 换词自动回到正面
  }, [word.id])

  function toggle() {
    if (!flipped) {
      setFlipped(true)
      onReveal?.(word)
    } else {
      setFlipped(false)
    }
  }

  return (
    <button
      className={`flip-scene${flipped ? ' revealed' : ''}`}
      onClick={toggle}
      aria-label={flipped ? '翻回正面' : '翻开释义'}
    >
      <div className={`flip-inner${flipped ? ' flipped' : ''}`}>
        {/* 正面 */}
        <div className="flip-face flip-front" aria-hidden={flipped}>
          <span
            className="cefr-dot flip-dot"
            style={{ background: `var(--cefr-${(word.cefr || 'unknown').toLowerCase()})` }}
          />
          <b className="h-display flip-word">{word.word}</b>
          <span className="flip-phon">{word.phonetic || '（暂无音标）'}</span>
          <button
            className="flip-say"
            aria-label={`朗读 ${word.word}`}
            onClick={(e) => { e.stopPropagation(); speakEnglish(word.word) }}
          >
            🔊
          </button>
          <span className="flip-hint">点按卡片翻面</span>
        </div>

        {/* 背面 */}
        <div className="flip-face flip-back" aria-hidden={!flipped}>
          <div className="fb-top">
            <b className="h-display fb-word">{word.word}</b>
            {word.pos && <span className="tag">{word.pos}</span>}
          </div>
          <div className="fb-meaning">{word.meaningZh || '（暂无释义）'}</div>
          {word.example && (
            <div className="fb-example">
              <span className="fb-say-s" onClick={(e) => { e.stopPropagation(); speakEnglish(word.example) }} aria-label="朗读例句">
                🔊
              </span>
              {word.example}
            </div>
          )}
          <div className="fb-ops">
            <button
              className="btn btn-ghost fb-known"
              onClick={(e) => { e.stopPropagation(); onKnown?.(word) }}
            >
              ⭐ 这个词我认识（标熟跳过）
            </button>
            <span className="flip-hint">点卡片回正面</span>
          </div>
        </div>
      </div>
    </button>
  )
}
