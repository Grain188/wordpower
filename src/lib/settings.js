// 设置存储：localStorage 单 key 存放（API key 也在内，个人自用明文可接受，README 会提示风险）。
// 提供 get/set/subscribe；Node 测试环境无 localStorage 时回退内存 Map。
// 模型名不在此处：按要求写死在 src/config.js（M2 引入）。

const KEY = 'wp:settings'

export const DEFAULTS = {
  // —— API（用户设置页填写）——
  apiKey: '',
  endpointMode: 'worker', // 'worker' | 'direct'（R2：默认 Worker；直连受 CORS 限制，仅高级选项）
  workerUrl: '',
  chatToken: '', // 可选：Worker 若设了 CHAT_TOKEN 环境变量则需一致
  syncToken: '', // 云端同步口令（须等于 Worker 环境变量 SYNC_TOKEN）
  // 模型覆盖：留空=用 src/config.js 里写死的默认；账号里真实模型名不同时在此填
  visionModel: '',
  textModel: '',
  // —— UI ——
  ui: {
    dark: 'auto', // 'auto' | 'light' | 'dark'
    dailyGoal: 10, // 每日目标词数（5–10 区间内由用户微调）
    micMode: 'hold', // 'hold' 按住说话 | 'tap' 点按（iOS/辅助场景）
    ttsVoice: '', // 首选 TTS voice URI，空=系统默认
  },
  // —— 状态 ——
  onboarded: false, // 首次启动引导是否完成
  lastVersion: '', // 记录上次运行的版本号（用于提示更新/迁移）
}

const memoryStore = new Map()
const store = {
  getItem: (k) => (typeof localStorage !== 'undefined' ? localStorage.getItem(k) : memoryStore.get(k) ?? null),
  setItem: (k, v) => (typeof localStorage !== 'undefined' ? localStorage.setItem(k, v) : memoryStore.set(k, v)),
}

const listeners = new Set()

function deepMerge(base, patch) {
  if (Array.isArray(base) || Array.isArray(patch)) return patch ?? base
  if (typeof base === 'object' && base && typeof patch === 'object' && patch) {
    const out = { ...base }
    for (const k of Object.keys(patch)) out[k] = deepMerge(base[k], patch[k])
    return out
  }
  return patch === undefined ? base : patch
}

function readRaw() {
  try {
    const raw = store.getItem(KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

// 缓存快照：useSyncExternalStore 要求 getSnapshot 返回"只在变化时不同的引用"。
// 若每次调用都 new 一个对象，React 会判定快照持续变化 → 无限重渲染 → 白屏。
let snapshot = null

export function getSettings() {
  if (!snapshot) snapshot = deepMerge(structuredClone(DEFAULTS), readRaw())
  return snapshot
}

/** 局部更新（自动浅层递归合并），并通知订阅者；成功后刷新快照引用 */
export function setSettings(patch) {
  const next = deepMerge(snapshot || getSettings(), patch)
  snapshot = next
  store.setItem(KEY, JSON.stringify(next))
  listeners.forEach((fn) => fn(next))
  return next
}

/** 便捷：改 ui.* 子树，如 setUi({ dailyGoal: 15 }) */
export function setUi(patch) {
  return setSettings({ ui: patch })
}

export function getApiKey() {
  return (getSettings().apiKey || '').trim()
}

export function subscribeSettings(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function resetSettings() {
  snapshot = null // 下次 getSettings 重读默认
  store.setItem(KEY, JSON.stringify(DEFAULTS))
  listeners.forEach((fn) => fn(getSettings()))
}
