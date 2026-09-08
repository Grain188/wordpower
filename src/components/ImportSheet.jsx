import { useEffect, useRef, useState } from 'react'
import { compressImageFile } from '../lib/image.js'
import {
  extractWordsFromImage,
  annotatePastedText,
  extractLocalWords,
} from '../api/ocr.js'
import { importWords, noteImported } from '../db/repo.js'
import { ApiError } from '../api/client.js'
import { themeZh } from '../lib/words.js'
import './ImportSheet.css'

/**
 * 拍照/粘贴导入向导（全屏层）。
 * 流程：选择来源 → busy → 确认列表（删误识别 / 标已掌握跳过 / 已在词库提示）→ 落库 → done 词 chip 逐个弹入。
 */
export default function ImportSheet({ open, onClose, goTab }) {
  const camRef = useRef(null)
  const fileRef = useRef(null)
  const [phase, setPhase] = useState('pick') // pick | busy | error | confirm | done
  const [busyLabel, setBusyLabel] = useState('')
  const [mode, setMode] = useState('photo') // photo | paste
  const [items, setItems] = useState([])
  const [payload, setPayload] = useState(null) // 供重试：{type:'image',dataUrl} | {type:'text',text}
  const [canDegrade, setCanDegrade] = useState(false)
  const [error, setError] = useState(null)
  const [summary, setSummary] = useState(null)
  const [pickView, setPickView] = useState('main') // main | text
  const [pasteText, setPasteText] = useState('')

  const reset = () => {
    setPhase('pick')
    setItems([])
    setPayload(null)
    setError(null)
    setSummary(null)
    setPickView('main')
    setPasteText('')
    setBusyLabel('')
  }
  useEffect(() => {
    if (open) reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  const errText = (e, channel) => {
    if (!(e instanceof ApiError)) return { title: '出错了', msg: e?.message || '未知错误' }
    const map = {
      auth: { title: 'API Key 未配置或无效', msg: '请到「我的 → API 设置」填写有效的 Key' },
      config: { title: '配置不完整', msg: e.message },
      model: {
        title: channel === 'image' ? '视觉模型暂不可用' : '文本模型暂不可用',
        msg: '模型不存在或账号未开通（模型名写死在 src/config.js）。拍照通道可改用「粘贴文本」通道',
      },
      network: { title: '网络或 CORS 问题', msg: '请检查 Worker 转发地址是否可访问（我的 → API 设置）' },
      timeout: { title: '请求超时', msg: '网络较慢，请重试' },
      rate: { title: '请求太频繁', msg: '稍等片刻再试' },
      quota: { title: '额度不足', msg: '账户余额不足或触发限流，请检查 DeepSeek 账户' },
      server: { title: '上游服务异常', msg: 'DeepSeek 服务暂时不可用，稍后重试' },
    }
    const m = map[e.kind] || { title: '请求失败', msg: e.message }
    return m
  }

  async function runBusy(label, fn) {
    setPhase('busy')
    setBusyLabel(label)
    try {
      await fn()
    } catch (e) {
      const info = errText(e, payload?.type === 'image' ? 'image' : 'text')
      setError(info)
      setCanDegrade(false)
      setPhase('error')
    }
  }

  function toConfirm(list, srcMode) {
    if (!list.length) {
      setError({
        title: '没有识别到可导入的词',
        msg: '图片可换更清晰/对准文字重拍；或改用「粘贴文本」通道',
      })
      setCanDegrade(false)
      setPhase('error')
      return
    }
    setMode(srcMode)
    setItems(list.map((it, i) => ({ ...it, key: i, skip: false, drop: false })))
    setPhase('confirm')
  }

  async function handleFile(file) {
    if (!file) return
    setMode('photo')
    setPayload(null)
    await runBusy('压缩图片…', async () => {
      const { dataUrl } = await compressImageFile(file)
      setPayload({ type: 'image', dataUrl })
      setBusyLabel('AI 识别中…')
      const list = await extractWordsFromImage(dataUrl)
      toConfirm(list, 'photo')
    })
  }

  async function submitPaste() {
    const text = pasteText.trim()
    if (!text) return
    setMode('paste')
    setPayload({ type: 'text', text })
    setCanDegrade(false)
    await runBusy('AI 整理中…', async () => {
      const list = await annotatePastedText(text)
      toConfirm(list, 'paste')
    })
  }

  function degradeToLocal() {
    const list = extractLocalWords(pasteText)
    if (!list.length) {
      setError({ title: '文本里没有英文单词', msg: '请粘贴包含英文单词的内容' })
      setPhase('error')
      return
    }
    toConfirm(list, 'paste')
  }

  async function doImport() {
    const keep = items.filter((i) => !i.skip && !i.drop)
    if (!keep.length) return
    setPhase('busy')
    setBusyLabel('写入生词本…')
    try {
      const res = await importWords(keep, { source: mode === 'photo' ? 'photo' : 'paste' })
      noteImported(res.added.map((a) => a.id))
      setSummary({
        addedWords: res.added.map((a) => a.word),
        duplicated: res.duplicated.length,
        skipped: items.filter((i) => i.skip || i.drop).length,
      })
      setPhase('done')
    } catch (e) {
      const info = errText(e, 'text')
      setError({ ...info, msg: `写入失败：${info.msg}` })
      setPhase('error')
    }
  }

  const keepCount = items.filter((i) => !i.skip && !i.drop).length

  return (
    <div className="sheet-mask" role="dialog" aria-modal="true" aria-label="导入生词">
      <div className="sheet" onDragOver={(e) => { e.preventDefault(); if (phase === 'pick') e.dataTransfer.dropEffect = 'copy' }}
        onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f && phase === 'pick') handleFile(f) }}>
        <div className="sheet-head">
          <h3 className="h-display sheet-title">拍照导入</h3>
          {phase !== 'busy' && (
            <button className="sheet-x" aria-label="关闭" onClick={() => { reset(); onClose() }}>✕</button>
          )}
        </div>

        {phase === 'pick' && pickView === 'main' && (
          <div className="sheet-body">
            <p className="sheet-sub">拍课本/打印材料，或粘贴安卓本地 OCR 的文字，自动整理成词卡</p>
            <div className="pick-grid">
              <button className="pick-card pick-cam" onClick={() => camRef.current?.click()}>
                <span className="pick-icon">📷</span>
                <b>拍照（相机）</b>
                <small>手机优先调起后置相机</small>
              </button>
              <button className="pick-card" onClick={() => fileRef.current?.click()}>
                <span className="pick-icon">🖼️</span>
                <b>相册 / 选图</b>
                <small>桌面端也可直接把图片拖进来</small>
              </button>
              <button className="pick-card pick-paste" onClick={() => setPickView('text')}>
                <span className="pick-icon">⌨️</span>
                <b>粘贴文本</b>
                <small>安卓本地 OCR 结果 / 手动清单</small>
              </button>
            </div>
            <input
              ref={camRef} type="file" accept="image/*" capture="environment" hidden
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) handleFile(f) }}
            />
            <input
              ref={fileRef} type="file" accept="image/*" hidden
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) handleFile(f) }}
            />
          </div>
        )}

        {phase === 'pick' && pickView === 'text' && (
          <div className="sheet-body">
            <textarea
              className="field" autoFocus value={pasteText}
              placeholder={'粘贴英文生词…\n可含中文释义（如：abandon 抛弃；放弃）'}
              onChange={(e) => setPasteText(e.target.value)}
            />
            <div className="sheet-actions">
              <button className="btn btn-plain" onClick={() => setPickView('main')}>返回</button>
              <button className="btn btn-primary" disabled={!pasteText.trim()} onClick={submitPaste}>
                AI 整理成词卡
              </button>
            </div>
          </div>
        )}

        {phase === 'busy' && (
          <div className="sheet-body busy-wrap">
            <div className="spinner" aria-hidden="true" />
            <p>{busyLabel}…</p>
            <p className="sheet-sub">处理只在当前设备/你的 API Key 间进行</p>
          </div>
        )}

        {phase === 'error' && (
          <div className="sheet-body">
            <div className="error-box">
              <b>{error?.title}</b>
              <p>{error?.msg}</p>
            </div>
            <div className="sheet-actions col">
              {payload?.type === 'image' && (
                <button
                  className="btn btn-primary btn-block"
                  onClick={() => runBusy('AI 识别中…', async () => {
                    const list = await extractWordsFromImage(payload.dataUrl)
                    toConfirm(list, 'photo')
                  })}
                >
                  重试
                </button>
              )}
              {payload?.type === 'text' && (
                <>
                  <button className="btn btn-primary btn-block" onClick={() => { setPhase('pick'); setPickView('text') }}>
                    修改文本重试
                  </button>
                  <button className="btn btn-ghost btn-block" onClick={degradeToLocal}>
                    仅存词形（不上传）
                  </button>
                </>
              )}
              {!payload && (
                <button className="btn btn-primary btn-block" onClick={() => { reset(); setPhase('pick') }}>
                  返回
                </button>
              )}
              <button className="btn btn-plain" onClick={() => { reset(); onClose() }}>关闭</button>
            </div>
          </div>
        )}

        {phase === 'confirm' && (
          <div className="sheet-body confirm-body">
            <p className="sheet-sub">共 {items.length} 项 · 保存时将自动跳过词库已有的重复词</p>
            <ul className="confirm-list">
              {items.map((it) => (
                <li
                  key={it.key}
                  className={`confirm-row${it.skip ? ' is-known' : ''}${it.drop ? ' is-drop' : ''}`}
                >
                  <div className="confirm-main">
                    <div className="confirm-wordline">
                      <span
                        className="cefr-dot"
                        style={{ background: `var(--cefr-${(it.cefr || 'unknown').toLowerCase()})` }}
                      />
                      <b className="h-display confirm-word">{it.word}</b>
                      <span className="confirm-phon">{it.phonetic}</span>
                    </div>
                    <div className="confirm-meaning">{it.meaningZh || '（缺释义，可在生词本编辑）'}</div>
                    <div className="confirm-tags">
                      {it.pos && <span className="tag">{it.pos}</span>}
                      {it.theme && <span className="tag">{themeZh(it.theme) || it.theme}</span>}
                    </div>
                  </div>
                  <div className="confirm-ops">
                    <button
                      className={`op-btn${it.skip ? ' op-known' : ''}`}
                      title="已掌握：跳过不入库"
                      onClick={() => setItems((arr) => arr.map((x) => (x.key === it.key ? { ...x, skip: !x.skip, drop: false } : x)))}
                    >
                      {it.skip ? '✓ 已掌握' : '已掌握'}
                    </button>
                    <button
                      className="op-btn op-drop"
                      title="误识别：删除"
                      onClick={() => setItems((arr) => arr.map((x) => (x.key === it.key ? { ...x, drop: !x.drop, skip: false } : x)))}
                    >
                      {it.drop ? '✕ 已删' : '删除'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <div className="sheet-actions">
              <button className="btn btn-plain" onClick={() => { reset(); setPhase('pick') }}>返回</button>
              <button className="btn btn-primary" disabled={keepCount === 0} onClick={doImport}>
                导入 {keepCount} 个新词
              </button>
            </div>
          </div>
        )}

        {phase === 'done' && (
          <div className="sheet-body">
            <div className="done-head">
              <span className="done-check ok-pop">✓</span>
              <h3 className="h-display">入本成功！</h3>
              <p className="sheet-sub">
                新增 <b className="num">{summary.addedWords.length}</b> · 词库已有自动跳过{' '}
                <b className="num">{summary.duplicated}</b> · 已掌握/删除{' '}
                <b className="num">{summary.skipped}</b>
              </p>
            </div>
            <ul className="done-chips">
              {summary.addedWords.slice(0, 12).map((w, i) => (
                <li key={w + i} className="chip chip-pop" style={{ animationDelay: `${i * 30}ms` }}>
                  {w}
                </li>
              ))}
            </ul>
            {summary.addedWords.length > 12 && (
              <p className="sheet-sub">…等共 {summary.addedWords.length} 个新词</p>
            )}
            <div className="sheet-actions">
              <button className="btn btn-plain" onClick={() => { reset(); setPhase('pick') }}>
                再拍一张
              </button>
              <button
                className="btn btn-primary"
                onClick={() => { reset(); onClose(); goTab('library') }}
              >
                去生词本看看
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
