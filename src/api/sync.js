// api/sync.js —— 云端一键同步（Worker + D1 全量快照，单用户自用）
// 上传：把 exportSnapshot() 的完整备份 POST 到 <workerUrl>/sync/upload
// 拉取：GET <workerUrl>/sync/download 返回同结构备份 → importSnapshot() 恢复
// 鉴权：请求头 X-Sync-Token 必须等于 Worker 环境变量 SYNC_TOKEN

import { getSettings } from '../lib/settings.js'
import { exportSnapshot, importSnapshot } from '../db/repo.js'

function baseOf() {
  const s = getSettings()
  const url = (s.workerUrl || '').trim().replace(/\/+$/, '')
  if (!url) throw new Error('未配置 Worker 转发地址（云端同步依赖同一个 Worker）')
  return url
}

function tokenOf() {
  const t = (getSettings().syncToken || '').trim()
  if (!t) throw new Error('未填写同步口令（与 Worker 环境变量 SYNC_TOKEN 相同）')
  return t
}

/** 把本机数据全量上传到云端（云端整份覆盖为本次快照） */
export async function uploadToCloud() {
  const snap = await exportSnapshot()
  const res = await fetch(`${baseOf()}/sync/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Sync-Token': tokenOf(),
    },
    body: JSON.stringify(snap),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.error || `上传失败 HTTP ${res.status}`)
  return data
}

/** 从云端拉取快照并恢复本机（本机数据整份被覆盖）；云端为空时返回 { empty:true } */
export async function downloadFromCloud() {
  const res = await fetch(`${baseOf()}/sync/download`, {
    method: 'GET',
    headers: { 'X-Sync-Token': tokenOf() },
  })
  const text = await res.text().catch(() => '')
  if (res.status === 404) return { empty: true }
  if (!res.ok) {
    let msg = `拉取失败 HTTP ${res.status}`
    try { msg = JSON.parse(text).error || msg } catch { /* 忽略 */ }
    throw new Error(msg)
  }
  const snap = JSON.parse(text)
  const { counts } = await importSnapshot(snap)
  return { counts }
}
