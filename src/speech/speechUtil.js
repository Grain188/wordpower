// speech/speechUtil.js —— 整场重听等"多句顺序朗读"工具（基于 ttsProvider）
import { ttsProvider } from './tts.js'

let seqId = 0

/** 顺序朗读若干句；任何时刻只有一路在放。stopSpeakingSeq() 可中断。 */
export function speakSeq(lines, { onDone } = {}) {
  const id = ++seqId
  const clean = lines.filter((l) => typeof l === 'string' && l.trim())
  const speakAt = (i) => {
    if (id !== seqId || i >= clean.length) return onDone?.()
    ttsProvider.speak(clean[i], {
      rate: 0.98,
      onend: () => speakAt(i + 1),
      onerror: () => onDone?.(), // 被打断/出错 → 停止整串
    })
  }
  speakAt(0)
}

export function stopSpeakingSeq() {
  seqId++
  ttsProvider.stop()
}
