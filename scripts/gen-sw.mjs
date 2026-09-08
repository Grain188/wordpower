// gen-sw.mjs —— 构建后生成 Service Worker（唯一来源，避免手写预缓存列表过期）
// 由 `npm run build`（vite build && node scripts/gen-sw.mjs）自动执行：
//   扫描 dist/assets 得到带 hash 的静态资源 → 注入预缓存列表 → 写出 dist/sw.js
// 策略：
//   - 导航请求：网络优先，失败回退缓存中的 index.html（离线可打开应用）
//   - 静态资源(/assets/*)：缓存优先，命中即用（hash 文件名天然防过期）
//   - 版本号变化时 activate 阶段清理旧缓存
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
if (!existsSync(DIST)) {
  console.error('dist 不存在，请先执行 vite build')
  process.exit(1)
}

const assets = []
for (const dir of ['assets', 'icons']) {
  const p = join(DIST, dir)
  if (!existsSync(p)) continue
  for (const f of readdirSync(p)) assets.push(`/${dir}/${f}`)
}

const CORE = ['/', '/index.html', '/manifest.webmanifest', ...assets]

const SW = `// 由 scripts/gen-sw.mjs 自动生成 —— 勿手改
const VERSION = 'wp-v1';
const CORE = ${JSON.stringify(CORE)};

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) =>
      // allSettled：单个资源失败不阻塞安装（字体等可容忍）
      Promise.allSettled(CORE.map((u) => c.add(u).catch(() => {})))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // 跨域（字体等）走网络

  // 页面导航：网络优先，离线回退到已缓存的 index.html
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put('/index.html', copy));
          return res;
        })
        .catch(() => caches.match('/index.html').then((h) => h || Response.error()))
    );
    return;
  }

  // 静态资源：缓存优先，miss 时抓取并写入缓存
  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok && url.pathname.startsWith('/assets/')) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
          }
          return res;
        }).catch(() => Response.error())
    )
  );
});
`

writeFileSync(join(DIST, 'sw.js'), SW)
console.log(`sw.js written (${CORE.length} entries precached)`)
