// OpenAI 兼容 client（fetch 手写，零 SDK 依赖）。
// 职责：拼 endpoint（Worker/直连切换）、鉴权、超时、错误语义化、JSON 加固解析、token 记账。
// 所有费用信息在落库前就被算好：见 recordUsage 注释 —— 每条响应读 usage 字段记账。

import { MODELS, DEFAULT_BASE_URL, CHAT_PATH, REQUEST_TIMEOUT_MS } from '../config.js'
import { getSettings } from '../lib/settings.js'
import { recordUsage } from '../db/repo.js'

export class ApiError extends Error {
  constructor(kind, message, { status, detail } = {}) {
    super(message)
    this.name = 'ApiError'
    this.kind = kind // 'auth' | 'config' | 'quota' | 'rate' | 'model' | 'bad' | 'network' | 'timeout' | 'cors'
    this.status = status
    this.detail = detail
  }
}

/** 实际使用的模型名：设置里填了覆盖就用覆盖，否则用 config 写死的默认 */
export function modelOf(kind = 'text') {
  const s = getSettings()
  if (kind === 'vision') return (s?.visionModel || '').trim() || MODELS.vision
  return (s?.textModel || '').trim() || MODELS.text
}

const KIND_OF_STATUS = {
  400: 'bad',
  401: 'auth',
  403: 'auth',
  404: 'model', // 模型名不存在/未开通（R1 提示用）
  402: 'quota',
  429: 'rate',
  500: 'server',
  502: 'server',
  503: 'server',
  504: 'server',
}

/** 决定请求发往哪里（导出以便测试） */
export function resolveEndpoint(settings) {
  const mode = settings?.endpointMode || 'worker'
  if (mode === 'direct') return `${DEFAULT_BASE_URL}${CHAT_PATH}`
  const url = (settings?.workerUrl || '').trim().replace(/\/+$/, '')
  if (!url) {
    // R2：Worker 模式下必须填地址；不回退直连（CORS 会让用户误以为是 bug）
    throw new ApiError('config', '未配置 Worker 转发地址（我的 → API 设置）')
  }
  return `${url}${CHAT_PATH}`
}

/** 从杂文里尝试抠出第一个配平的 JSON 块（数组或对象），失败返回 undefined */
function findBalancedJson(raw) {
  const starts = [...raw.matchAll(/[[{]/g)]
  for (const m of starts) {
    const stack = []
    let inStr = false
    let esc = false
    for (let i = m.index; i < raw.length; i++) {
      const ch = raw[i]
      if (inStr) {
        if (esc) esc = false
        else if (ch === '\\') esc = true
        else if (ch === '"') inStr = false
        continue
      }
      if (ch === '"') { inStr = true; continue }
      if (ch === '[' || ch === '{') stack.push(ch)
      else if (ch === ']' || ch === '}') {
        if (!stack.length) break
        const open = stack.pop()
        if ((open === '[' && ch !== ']') || (open === '{' && ch !== '}')) break
        if (!stack.length) {
          const cand = raw.slice(m.index, i + 1)
          try { return JSON.parse(cand) } catch { break }
        }
      }
    }
  }
  return undefined
}

/** 容错解析：直接 JSON → 剥 ``` 围栏 → 从任意杂文里抠配平 JSON 块（LLM 常夹带说明文字） */
export function parseJsonContent(content, hint = '') {
  const raw = String(content || '').trim()
  if (!raw) throw new ApiError('bad', `模型返回空内容（${hint}）`)
  try {
    return JSON.parse(raw)
  } catch { /* 往下走容错路径 */ }
  const fenced = raw.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/)
  if (fenced) {
    try { return JSON.parse(fenced[1].trim()) } catch { /* 继续 */ }
  }
  const found = findBalancedJson(raw)
  if (found !== undefined) return found
  throw new ApiError('bad', `模型未返回合法 JSON（${hint}），已重试仍失败`)
}

/**
 * 工厂：便于测试注入 settings 与 fetch。
 * 生产用默认导出 api = createApiClient()。
 */
export function createApiClient({ settings = getSettings, fetchFn = globalThis.fetch } = {}) {
  async function complete({
    model = modelOf('text'),
    messages,
    json = false,
    maxTokens,
    temperature,
    task = 'chat',
    signal, // 外部可取消（切页/停止生成）
    hint = '',
  } = {}) {
    const s = settings()
    const key = (s.apiKey || '').trim()
    if (!key) throw new ApiError('auth', '未配置 API Key（我的 → API 设置）')

    const url = resolveEndpoint(s)
    const body = {
      model,
      messages,
      stream: false,
      ...(json ? { response_format: { type: 'json_object' } } : {}), // 任务要求 response_format=json_object
      ...(maxTokens ? { max_tokens: maxTokens } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
    }

    // 超时 + 外部取消合并
    const timeoutMs = REQUEST_TIMEOUT_MS
    const timeoutCtrl = new AbortController()
    const timer = setTimeout(() => timeoutCtrl.abort(new DOMException('timeout', 'TimeoutError')), timeoutMs)
    const combined = signal
      ? AbortSignal.any([timeoutCtrl.signal, signal])
      : timeoutCtrl.signal

    let res
    try {
      res = await fetchFn(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
          // 可选：Worker 配了 CHAT_TOKEN 环境变量时需要一致（B6）
          ...((s.chatToken || '').trim() ? { 'X-Chat-Token': s.chatToken.trim() } : {}),
        },
        body: JSON.stringify(body),
        signal: combined,
      })
    } catch (e) {
      if (e?.name === 'TimeoutError' || (timeoutCtrl.signal.aborted && !signal?.aborted)) {
        throw new ApiError('timeout', '请求超时，请重试')
      }
      if (signal?.aborted) throw new ApiError('aborted', '已取消')
      // fetch 的 TypeError ≈ 网络失败或 CORS 拦截（R2 提示给用户）
      throw new ApiError('network', '网络错误或跨域被拦（CORS）：请检查 Worker 地址/网络')
    } finally {
      clearTimeout(timer)
    }

    let data = null
    try {
      data = await res.json()
    } catch {
      /* 非 JSON 响应（网关 502 页等），走 status 分支 */
    }
    if (!res.ok) {
      const msg = data?.error?.message || `HTTP ${res.status}`
      throw new ApiError(KIND_OF_STATUS[res.status] || 'bad', msg, { status: res.status })
    }

    // —— token 记账（省 token A5 的数据来源）——
    const usage = data?.usage
    if (usage) {
      const hit = usage.prompt_cache_hit_tokens || 0
      const miss =
        usage.prompt_cache_miss_tokens ?? (usage.prompt_tokens || 0) - hit
      await recordUsage({
        task,
        model,
        promptTokens: miss,
        cacheHitTokens: hit,
        completionTokens: usage.completion_tokens || 0,
      }).catch(() => {}) // 记账失败不影响主流程
    }

    const content = data?.choices?.[0]?.message?.content ?? ''
    if (json) return { content, parsed: parseJsonContent(content, hint), usage }
    return { content, usage }
  }

  return { complete }
}

/** 生产单例（页面统一用） */
export const api = createApiClient()

/** vision 消息构造：dataUrl 形如 data:image/jpeg;base64,xxx */
export function imageMessage(dataUrl, text) {
  return [
    { type: 'text', text },
    { type: 'image_url', image_url: { url: dataUrl } },
  ]
}
