// cf-worker.js —— Cloudflare Worker（两个用途，一份部署）
//  1) /chat/completions     转发 DeepSeek（补 CORS，解决浏览器直连被拦）
//  2) /sync/upload|download 云端一键同步（全量快照存 D1），需绑定 D1 数据库 + SYNC_TOKEN 环境变量
//
// 部署后需要配置（Dashboard → 该 Worker → Settings）：
//  - Bindings → D1 database：新建数据库 wordpower-sync，绑定变量名 DB
//  - Variables and Secrets → 新增 Secret：SYNC_TOKEN = 你自己设的一串口令
//  - 首次需建表（Worker Console 里执行，或 SQL 控制台）：
//      CREATE TABLE IF NOT EXISTS sync(id TEXT PRIMARY KEY, blob TEXT NOT NULL, updated_at INTEGER NOT NULL);

const CHAT_UP = 'https://api.deepseek.com/chat/completions'
const SYNC_KEY = 'main' // 单用户自用：只存一份快照

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Sync-Token, X-Chat-Token',
  'Access-Control-Max-Age': '86400',
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })

export default {
  async fetch(request, env) {
    // 预检
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

    const url = new URL(request.url)
    const path = url.pathname

    // —— 1) DeepSeek 转发 ——
    if (path === '/chat/completions' && request.method === 'POST') {
      // 可选鉴权：设了 CHAT_TOKEN 环境变量后，请求头 X-Chat-Token 必须一致（防别人把你的
      // Worker 当免费 CORS 转发器）。不设 = 保持开放，兼容应用旧版本。
      if (env.CHAT_TOKEN && request.headers.get('X-Chat-Token') !== env.CHAT_TOKEN) {
        return json({ ok: false, error: 'CHAT_TOKEN 不匹配' }, 401)
      }
      const headers = new Headers(request.headers)
      headers.set('host', new URL(CHAT_UP).host)
      headers.delete('origin')
      const upstream = await fetch(CHAT_UP, { method: 'POST', headers, body: request.body })
      const out = new Response(upstream.body, upstream)
      for (const [k, v] of Object.entries(CORS)) out.headers.set(k, v)
      return out
    }

    // —— 2) 云端同步 ——
    if (path === '/sync/upload' || path === '/sync/download') {
      if (!env.DB) return json({ ok: false, error: 'Worker 未绑定 D1（Settings -> Bindings -> D1）' }, 500)
      if (!env.SYNC_TOKEN) return json({ ok: false, error: 'Worker 未设置 SYNC_TOKEN（Settings -> Variables and Secrets）' }, 500)
      if (request.headers.get('X-Sync-Token') !== env.SYNC_TOKEN) {
        return json({ ok: false, error: '同步口令错误' }, 401)
      }

      if (path === '/sync/upload' && request.method === 'POST') {
        const raw = await request.text()
        let snap = null
        try {
          snap = JSON.parse(raw)
        } catch {
          return json({ ok: false, error: '不是合法 JSON' }, 400)
        }
        if (!snap || snap.app !== 'wordpower') return json({ ok: false, error: '不是词力备份' }, 400)
        const stored = JSON.stringify(snap)
        await env.DB.prepare(
          'INSERT INTO sync(id, blob, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET blob = excluded.blob, updated_at = excluded.updated_at'
        )
          .bind(SYNC_KEY, stored, Date.now())
          .run()
        return json({ ok: true })
      }

      if (path === '/sync/download' && request.method === 'GET') {
        const row = await env.DB.prepare('SELECT blob FROM sync WHERE id = ?').bind(SYNC_KEY).first()
        if (!row) return json({ ok: false, error: '云端还没有数据' }, 404)
        return new Response(row.blob, {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...CORS },
        })
      }
    }

    return json({ ok: false, error: 'Not Found' }, 404)
  },
}
