// speech/asr.js —— 语音识别 provider（可替换接口，与 tts.js 同形）
// 实现 = Web Speech API（Android Chrome 良好；iOS Safari / 桌面 Firefox 不支持 → supported=false，
// 页面会显示键盘输入兜底，不会出现"按了没反应"）。
// 注意：不支持时不要 import 即崩，全部经 provider 判定。

let SR = null
function getSR() {
  if (typeof window === 'undefined') return null
  if (SR) return SR
  SR = window.SpeechRecognition || window.webkitSpeechRecognition || null
  return SR
}

export const asrProvider = {
  supported() {
    return !!getSR()
  },

  /**
   * 开始一轮识别。返回 stop()；结束时自动调用 onEnd。
   * @param {{lang?:string, onInterim?:(t:string)=>void, onFinal?:(t:string)=>void, onError?:(e:{kind:string,message:string})=>void}} opts
   */
  start({ lang = 'en-US', onInterim, onFinal, onError, onEnd } = {}) {
    const Ctor = getSR()
    if (!Ctor) return null
    const rec = new Ctor()
    rec.lang = lang
    rec.interimResults = true // 边听边显示，反馈更快
    rec.continuous = false
    rec.maxAlternatives = 1

    let finalText = ''
    rec.onresult = (e) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) {
          finalText += r[0].transcript
          onFinal?.(r[0].transcript)
        } else {
          interim += r[0].transcript
        }
      }
      if (interim) onInterim?.(interim)
    }
    rec.onerror = (e) => {
      const kind = e?.error || 'unknown'
      const msg =
        kind === 'not-allowed' || kind === 'service-not-allowed'
          ? '麦克风权限被拒绝，请允许后重试；也可用下方输入框打字'
          : kind === 'no-speech'
            ? '没有听到声音，再试一次'
            : `识别出错（${kind}）`
      onError?.({ kind, message: msg })
    }
    rec.onend = () => onEnd?.()

    try {
      rec.start()
    } catch {
      onError?.({ kind: 'unknown', message: '无法启动语音识别，请用输入框打字' })
      return null
    }
    return () => {
      try {
        rec.stop()
      } catch {
        /* 已结束 */
      }
    }
  },
}
