// speech/tts.js —— 语音合成 provider（可替换接口，M7 口语复用）
// 接口形状：{ supported, speak(text,opts), stop(), voices() }
// 现阶段实现 = 浏览器 speechSynthesis（免费原生）；日后可换成云端 TTS 而不用改业务代码。

import { getSettings } from '../lib/settings.js'

let cachedVoices = []

function synth() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
    ? window.speechSynthesis
    : null
}

function refreshVoices() {
  const s = synth()
  cachedVoices = s ? s.getVoices() : []
}

// 提前触发 getVoices（部分浏览器需 onvoiceschanged 后才非空）
if (synth()) {
  refreshVoices()
  synth().onvoiceschanged = refreshVoices
}

/** 英文语音列表（可选首选 voice uri 过滤在 speak 里做） */
function voices() {
  if (!cachedVoices.length) refreshVoices()
  return cachedVoices.filter((v) => /^en/i.test(v.lang))
}

function speak(text, { lang = 'en-US', rate = 0.95, pitch = 1, onstart, onend, onerror } = {}) {
  const s = synth()
  if (!s || !text) return false
  const u = new SpeechSynthesisUtterance(String(text))
  u.lang = lang
  u.rate = rate
  u.pitch = pitch
  if (typeof onstart === 'function') u.onstart = onstart
  if (typeof onend === 'function') u.onend = onend
  if (typeof onerror === 'function') u.onerror = onerror
  const preferred = getSettings().ui.ttsVoice
  const list = voices()
  const chosen =
    (preferred && list.find((v) => v.voiceURI === preferred)) ||
    list.find((v) => /^en-(US|GB)/i.test(v.lang)) ||
    list[0]
  if (chosen) u.voice = chosen
  // 连读场景先停掉上一次
  s.cancel()
  s.speak(u)
  return true
}

function stop() {
  const s = synth()
  if (s) s.cancel()
}

export const ttsProvider = { supported: () => !!synth(), speak, stop, voices }

/** 朗读英文单词/例句的便捷入口 */
export function speakEnglish(text) {
  return ttsProvider.speak(text)
}
