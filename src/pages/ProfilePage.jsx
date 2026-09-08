import { useEffect, useRef, useState } from 'react'
import { getSettings, setSettings, setUi } from '../lib/settings.js'
import { api, ApiError } from '../api/client.js'
import { exportSnapshot, importSnapshot } from '../db/repo.js'
import { uploadToCloud, downloadFromCloud } from '../api/sync.js'
import { resetDb } from '../db/database.js'
import { ttsProvider, speakEnglish } from '../speech/tts.js'
import { useSettings } from '../hooks/useSettings.js'
import ConfirmDialog from '../components/ConfirmDialog.jsx'
import './ProfilePage.css'

function Section({ title, children, hint }) {
  return (
    <div className="card prof-card">
      <h3 className="h-display prof-title">{title}</h3>
      {children}
      {hint && <p className="prof-hint">{hint}</p>}
    </div>
  )
}

export default function ProfilePage() {
  const settings = useSettings()
  const [key, setKey] = useState(settings.apiKey || '')
  const [mode, setMode] = useState(settings.endpointMode || 'worker')
  const [workerUrl, setWorkerUrl] = useState(settings.workerUrl || '')
  const [chatToken, setChatToken] = useState(settings.chatToken || '')
  const [showKey, setShowKey] = useState(false)
  const [savedAt, setSavedAt] = useState('')
  const [testState, setTestState] = useState('idle') // idle|testing|ok|err
  const [testMsg, setTestMsg] = useState('')
  const [visionModel, setVisionModel] = useState(settings.visionModel || '')
  const [textModel, setTextModel] = useState(settings.textModel || '')

  const [voices, setVoices] = useState([])
  const [confirmClear, setConfirmClear] = useState(false)
  const fileRef = useRef(null)

  // 云端同步
  const [syncToken, setSyncToken] = useState(settings.syncToken || '')
  const [syncBusy, setSyncBusy] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')
  const [confirmSync, setConfirmSync] = useState(null) // 'upload' | 'download'

  // 加载英文语音列表（部分浏览器需等 voiceschanged）
  useEffect(() => {
    if (!ttsProvider.supported()) return
    const load = () => setVoices(ttsProvider.voices())
    load()
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = load
    }
    return () => { window.speechSynthesis && (window.speechSynthesis.onvoiceschanged = null) }
  }, [])

  function save() {
    setSettings({
      apiKey: key.trim(),
      endpointMode: mode,
      workerUrl: workerUrl.trim(),
      chatToken: chatToken.trim(),
      visionModel: visionModel.trim(),
      textModel: textModel.trim(),
    })
    setSavedAt(new Date().toLocaleTimeString())
  }

  const kindText = (e) => {
    if (!(e instanceof ApiError)) return e?.message || '失败'
    const map = {
      auth: '未检测到有效 Key（请确认 sk- 开头、无多余空格；401/403 表示服务端拒绝该 Key）',
      config: e.message,
      model: '模型不可用（模型名写死 src/config.js，请确认账号可调用）',
      network: '网络/CORS 问题，检查 Worker 地址或改用直连试试',
      timeout: '超时，请重试',
      rate: '请求频繁，稍后再试',
      quota: '额度不足',
      server: '上游异常，稍后重试',
    }
    return map[e.kind] || e.message
  }

  async function doTest() {
    if (!key.trim()) { setTestState('err'); setTestMsg('先填 API Key'); return }
    setTestState('testing')
    // 先保存再测：client 只从设置里读 Key/模型/endpoint，避免测到旧值
    setSettings({
      apiKey: key.trim(),
      endpointMode: mode,
      workerUrl: workerUrl.trim(),
      chatToken: chatToken.trim(),
      visionModel: visionModel.trim(),
      textModel: textModel.trim(),
    })
    try {
      await api.complete({ messages: [{ role: 'user', content: 'ping' }], maxTokens: 1, task: 'chat' })
      setTestState('ok')
      setTestMsg('连接正常 ✓')
    } catch (e) {
      setTestState('err')
      setTestMsg(kindText(e))
    }
  }

  async function doExport() {
    const snap = await exportSnapshot()
    const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `wordpower-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function onImportFile(file) {
    if (!file) return
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      const { counts } = await importSnapshot(data)
      alert(`恢复成功：词 ${counts.words} · 打卡 ${counts.checkins} · 复习 ${counts.reviews} · 对话 ${counts.chat_sessions}`)
      location.reload()
    } catch (e) {
      alert(`导入失败：${e?.message || '文件格式不对'}`)
    }
  }

  async function runSync(kind) {
    if (!syncToken.trim()) { setSyncMsg('先填同步口令'); return }
    setSyncBusy(true)
    setSyncMsg('')
    setSettings({ syncToken: syncToken.trim() }) // 先存口令再请求
    try {
      if (kind === 'upload') {
        await uploadToCloud()
        setSyncMsg('已上传到云端 ✓')
      } else {
        const r = await downloadFromCloud()
        if (r.empty) {
          setSyncMsg('云端还没有数据，请先在另一台设备点「上传到云端」')
        } else {
          setSyncMsg('已从云端恢复 ✓ 页面即将刷新')
          setTimeout(() => location.reload(), 900)
        }
      }
    } catch (e) {
      setSyncMsg(`失败：${e.message}`)
    } finally {
      setSyncBusy(false)
    }
  }

  const dark = settings.ui.dark || 'auto'

  return (
    <section className="page">
      <header className="topbar">
        <h1 className="h-display topbar-title">我的</h1>
      </header>
      <div className="pad prof-pad">
        {/* API */}
        <Section
          title="API 设置"
          hint="Key 只存本机。模型默认写死在 src/config.js；账号里模型名不同时，在下方两个框填真实名字并保存即可覆盖。"
        >
          <label className="prof-label">DeepSeek API Key</label>
          <div className="keyrow">
            <input
              className="field" type={showKey ? 'text' : 'password'}
              placeholder="sk-…" value={key}
              onChange={(e) => setKey(e.target.value)}
            />
            <button className="btn btn-ghost" onClick={() => setShowKey(!showKey)}>
              {showKey ? '隐藏' : '显示'}
            </button>
          </div>
          <label className="prof-label">连接方式</label>
          <select className="field" value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="worker">Worker 转发（推荐）</option>
            <option value="direct">直连官方（受 CORS 限制）</option>
          </select>
          {mode === 'worker' && (
            <>
              <label className="prof-label">Worker 地址</label>
              <input
                className="field" type="url" placeholder="https://你的名称.workers.dev"
                value={workerUrl} onChange={(e) => setWorkerUrl(e.target.value)}
              />
              <label className="prof-label">转发口令（可选，Worker 设了 CHAT_TOKEN 才填）</label>
              <input
                className="field" type="password" placeholder="留空 = Worker 未开启校验"
                value={chatToken} onChange={(e) => setChatToken(e.target.value)}
              />
            </>
          )}
          <label className="prof-label">视觉模型（拍照 OCR）</label>
          <input
            className="field" type="text" placeholder="留空=deepseek-v4-flash-vision-exp"
            value={visionModel} onChange={(e) => setVisionModel(e.target.value)}
          />
          <label className="prof-label">文本模型（打标/口语/干扰项）</label>
          <input
            className="field" type="text" placeholder="留空=deepseek-v4-flash"
            value={textModel} onChange={(e) => setTextModel(e.target.value)}
          />
          <div className="prof-actions">
            <button className="btn btn-plain" onClick={doTest} disabled={testState === 'testing'}>
              {testState === 'testing' ? '测试中…' : '测试连接'}
            </button>
            <button className="btn btn-primary" onClick={save}>保存</button>
          </div>
          {testState === 'ok' && <p className="prof-ok">{testMsg}</p>}
          {testState === 'err' && <p className="prof-err">{testMsg}</p>}
          {savedAt && <p className="prof-hint">已保存于 {savedAt}</p>}
        </Section>

        {/* 语音与偏好 */}
        <Section title="语音" hint="朗读用浏览器原生 speechSynthesis，按本机安装的英文语音而定。">
          {ttsProvider.supported() ? (
            <>
              <label className="prof-label">英文语音</label>
              <div className="keyrow">
                <select
                  className="field"
                  value={settings.ui.ttsVoice}
                  onChange={(e) => setUi({ ttsVoice: e.target.value })}
                >
                  <option value="">系统默认</option>
                  {voices.map((v) => (
                    <option key={v.voiceURI} value={v.voiceURI}>
                      {v.name}（{v.lang}）
                    </option>
                  ))}
                </select>
                <button className="btn btn-ghost" onClick={() => speakEnglish('Hello, nice to meet you.')}>
                  🔊 试听
                </button>
              </div>
              <label className="prof-label">麦克风模式（Android Chrome 良好；iOS/桌面 Firefox 请用打字）</label>
              <div className="seg" role="group">
                {[['hold', '按住说话'], ['tap', '点按说话']].map(([v, zh]) => (
                  <button
                    key={v}
                    className={`seg-btn${settings.ui.micMode === v ? ' on' : ''}`}
                    onClick={() => setUi({ micMode: v })}
                  >
                    {zh}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className="prof-hint">当前浏览器不支持 speechSynthesis 语音列表，仍可用系统 TTS。</p>
          )}
        </Section>

        <Section title="偏好">
          <label className="prof-label">每日目标词数</label>
          <div className="stepper">
            <button className="step-btn" onClick={() => setUi({ dailyGoal: Math.max(1, settings.ui.dailyGoal - 1) })}>−</button>
            <b className="num">{settings.ui.dailyGoal}</b>
            <button className="step-btn" onClick={() => setUi({ dailyGoal: Math.min(50, settings.ui.dailyGoal + 1) })}>＋</button>
            <span className="step-tip">建议 5–10 个</span>
          </div>
          <label className="prof-label">深色模式</label>
          <div className="seg" role="group">
            {[['auto', '跟随系统'], ['light', '浅色'], ['dark', '深色']].map(([v, zh]) => (
              <button key={v} className={`seg-btn${dark === v ? ' on' : ''}`} onClick={() => setUi({ dark: v })}>
                {zh}
              </button>
            ))}
          </div>
        </Section>

        {/* 云端同步（Worker + D1） */}
        <Section
          title="云端同步"
          hint="全量同步词库/打卡/对话到你的 Worker+D1。「上传」以本机覆盖云端；「拉取」以云端覆盖本机。手机和电脑各点一次即可互通。"
        >
          <label className="prof-label">同步口令</label>
          <input
            className="field" type="password" placeholder="与 Worker 的 SYNC_TOKEN 相同"
            value={syncToken}
            onChange={(e) => setSyncToken(e.target.value)}
          />
          <div className="prof-actions">
            <button
              className="btn btn-primary" disabled={syncBusy}
              onClick={() => { if (!syncToken.trim()) { setSyncMsg('先填同步口令'); return } setConfirmSync('upload') }}
            >
              上传到云端
            </button>
            <button
              className="btn btn-accent" disabled={syncBusy}
              onClick={() => { if (!syncToken.trim()) { setSyncMsg('先填同步口令'); return } setConfirmSync('download') }}
            >
              从云端拉取
            </button>
          </div>
          {syncBusy && <p className="prof-hint">同步中…</p>}
          {syncMsg && !syncMsg.startsWith('失败') && <p className="prof-ok">{syncMsg}</p>}
          {syncMsg.startsWith('失败') && <p className="prof-err">{syncMsg}</p>}
        </Section>

        {/* 备份 */}
        <Section title="数据备份" hint="iOS 清缓存会连本地数据一起清掉，定期导出 JSON 或直接使用上方云端同步。">
          <div className="prof-actions">
            <button className="btn btn-primary" onClick={doExport}>导出 JSON 备份</button>
            <button className="btn btn-accent" onClick={() => fileRef.current?.click()}>导入备份</button>
            <input
              ref={fileRef} type="file" accept="application/json,.json" hidden
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; f && onImportFile(f) }}
            />
          </div>
          <div className="prof-actions">
            <button className="btn btn-danger-ghost" onClick={() => setConfirmClear(true)}>
              清空全部数据
            </button>
          </div>
        </Section>

        <p className="prof-foot">词力 v0.1 · 纯前端 PWA · 数据在浏览器本地（IndexedDB）</p>
      </div>

      {confirmClear && (
        <ConfirmDialog
          title="清空全部数据？"
          desc="会删除生词、复习记录、打卡、对话与 token 账单（本地设置与 Key 保留）。建议先导出备份。"
          okText="清空"
          onOk={async () => {
            setConfirmClear(false)
            await resetDb()
            location.reload()
          }}
          onCancel={() => setConfirmClear(false)}
        />
      )}

      {confirmSync && (
        <ConfirmDialog
          title={confirmSync === 'upload' ? '上传到云端？' : '从云端拉取？'}
          desc={
            confirmSync === 'upload'
              ? '云端现有的数据会被本机数据整体覆盖。'
              : '本机现有的数据会被云端数据整体覆盖（含词库/复习/打卡/对话），且无法撤销。'
          }
          okText={confirmSync === 'upload' ? '上传' : '拉取并覆盖'}
          danger={confirmSync === 'download'}
          onOk={() => { const k = confirmSync; setConfirmSync(null); runSync(k) }}
          onCancel={() => setConfirmSync(null)}
        />
      )}
    </section>
  )
}
