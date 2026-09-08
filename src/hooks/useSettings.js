// 轻量 hook：让组件订阅 localStorage 设置变化（配合 settings.js 的 subscribe）
import { useSyncExternalStore } from 'react'
import { getSettings, subscribeSettings } from '../lib/settings.js'

export function useSettings() {
  return useSyncExternalStore(subscribeSettings, getSettings)
}
