import { useState } from 'react'
import { getSettings, setSettings } from '../lib/settings.js'
import { api, ApiError } from '../api/client.js'
import './Onboarding.css'

/**
 * 首次启动引导（M3）：填 API Key → 测试连接 → 拍第一张图试用。
 * key/Worker 模式只在「测试并继续」通过后保存；跳过则不保存（可离线纯复习）。
 */
export default function Onboarding({ onTryImport, onSkip }) {
  const init = getSettings()
  const [apiKey, setApiKey] = useState(init.apiKey || '')
  const [endpointMode, setEndpointMode] = useState(init.endpointMode || 'worker')
  const [workerUrl, setWorkerUrl] = useState(init.workerUrl || '')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [status, setStatus] = useState('idle') // idle | testing | ok | err
  const [errMsg, setErrMsg] = useState('')

  const kindText = (e) => {
    if (!(e instanceof ApiError)) return e?.message || '未知错误'
    const map = {
      auth: '未检测到有效 Key（若已粘贴请确认 sk- 开头、无多余空格；401/403 代表服务端拒绝该 Key）',
      config: e.message,
      model: '文本模型不可用：请确认账号可调用 deepseek-v4-flash（模型名写死在 src/config.js）',
      network: '网络或 CORS 问题：直连模式会被拦截，请用 Worker 转发地址（下方展开可填）',
      timeout: '连接超时，请重试',
      rate: '请求太频繁，稍等片刻',
      quota: '账户额度/余额不足，请查看 DeepSeek 控制台',
      server: 'DeepSeek 服务暂时异常，稍后重试',
    }
    return map[e.kind] || e.message
  }

  async function doTest() {
    const key = apiKey.trim()
    if (!key) {
      setStatus('err')
      setErrMsg('先填入 DeepSeek API Key')
      return
    }
    setStatus('testing')
    setErrMsg('')
    // 关键：先把表单写进设置再测试 —— client 只从已保存的设置里读 Key，
    // 不先保存会拿空 Key 请求，误报「Key 无效」（而你的 Key 其实没问题）。
    setSettings({ apiKey: key, endpointMode, workerUrl: workerUrl.trim() })
    try {
      // 探活：要求模型真的返回一段内容（只验 HTTP 200 会漏掉"空返回"的坏模型）
      const r = await api.complete({
        messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
        maxTokens: 16,
        task: 'chat',
      })
      if (!(r.content || '').trim()) throw new ApiError('bad', '连接通过但模型返回空内容——请核对「文本模型」名是否真实可用')
      setStatus('ok')
    } catch (e) {
      setStatus('err')
      setErrMsg(kindText(e))
    }
  }

  return (
    <div className="onb">
      <div className="onb-logo" aria-hidden="true">
        <svg viewBox="0 0 64 64" width="56" height="56">
          <circle cx="47" cy="17" r="6.5" fill="#FFC800" />
          <path d="M6 50 L24 27 L32.5 36.5 L40.5 27.5 L58 50 Z" fill="#fff" />
          <path d="M6 50 L58 50 L58 55 L6 55 Z" fill="#46A302" />
        </svg>
      </div>
      <h1 className="h-display onb-title">词力</h1>
      <p className="onb-sub">拍照导入 · FSRS 智能复习 · AI 口语陪练</p>

      {status !== 'ok' ? (
        <div className="onb-card">
          <h2 className="h-display onb-step">第 1 步 · 连接 DeepSeek</h2>
          <label className="onb-label" htmlFor="onb-key">API Key</label>
          <input
            id="onb-key" className="field" type="password" autoComplete="off"
            placeholder="sk-…" value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />

          <button className="onb-link" onClick={() => setShowAdvanced(!showAdvanced)}>
            {showAdvanced ? '收起' : '高级：连接方式（默认 Cloudflare Worker 转发）'}
          </button>
          {showAdvanced && (
            <div className="onb-adv">
              <label className="onb-label">连接方式</label>
              <select
                className="field"
                value={endpointMode}
                onChange={(e) => setEndpointMode(e.target.value)}
              >
                <option value="worker">Worker 转发（推荐）</option>
                <option value="direct">直连官方（受 CORS 限制，一般不适用）</option>
              </select>
              {endpointMode === 'worker' && (
                <>
                  <label className="onb-label">Worker 地址</label>
                  <input
                    className="field" type="url" placeholder="https://你的名称.workers.dev"
                    value={workerUrl}
                    onChange={(e) => setWorkerUrl(e.target.value)}
                  />
                </>
              )}
            </div>
          )}

          {status === 'err' && <p className="onb-err">{errMsg}</p>}

          <button
            className="btn btn-primary btn-block"
            disabled={status === 'testing'}
            onClick={doTest}
          >
            {status === 'testing' ? '连接中…' : '测试并继续'}
          </button>
          <p className="onb-note">
            Key 只存本机浏览器（localStorage）；图片/文字经你配置的转发地址发给 DeepSeek。
          </p>
        </div>
      ) : (
        <div className="onb-card">
          <h2 className="h-display onb-step">第 2 步 · 拍第一张图试用</h2>
          <p className="onb-line">连接成功 ✓ 已记住你的配置</p>
          <button className="btn btn-primary btn-block" onClick={onTryImport}>
            📷 拍第一张图
          </button>
          <button className="btn btn-plain btn-block" onClick={onSkip}>
            稍后再说，先进应用
          </button>
        </div>
      )}

      {status !== 'ok' && (
        <button className="btn btn-plain onb-skip" onClick={onSkip}>
          跳过（可离线浏览，之后在「我的」里补配置）
        </button>
      )}
    </div>
  )
}
