import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles/tokens.css'
import './styles/global.css'
import './styles/controls.css'
import './styles/placeholder.css'

// —— SW 更新提示（D13）：新版本激活后浮条引导刷新 ——
function showUpdateToast() {
  const old = document.getElementById('sw-toast')
  if (old) old.remove()
  const el = document.createElement('div')
  el.id = 'sw-toast'
  el.setAttribute('role', 'status')
  Object.assign(el.style, {
    position: 'fixed',
    left: '50%',
    bottom: 'calc(84px + env(safe-area-inset-bottom, 0px))',
    transform: 'translateX(-50%)',
    zIndex: 999,
    background: 'var(--card, #1e1e1e)',
    color: 'var(--text, #f7f7f7)',
    padding: '10px 18px',
    borderRadius: '999px',
    fontSize: '14px',
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    boxShadow: '0 6px 20px rgba(0,0,0,.25)',
    maxWidth: '92vw',
  })
  const span = document.createElement('span')
  span.textContent = '有新版本可用'
  const btn = document.createElement('button')
  btn.textContent = '刷新'
  Object.assign(btn.style, {
    background: 'var(--color-primary, #58cc02)',
    color: '#fff',
    border: 0,
    borderRadius: '999px',
    padding: '6px 16px',
    fontWeight: 800,
    cursor: 'pointer',
  })
  btn.onclick = () => location.reload()
  el.appendChild(span)
  el.appendChild(btn)
  document.body.appendChild(el)
  window.setTimeout(() => el.remove(), 15000)
}

// Service Worker 只在生产构建注册（dev 下会缓存旧代码造成困惑）
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        let firstCtrl = true
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          // 首次激活（controller 从无到有）不打扰；之后的更新提示刷新
          if (!firstCtrl) showUpdateToast()
          firstCtrl = false
        })
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing || reg.waiting
          if (!nw) return
          nw.addEventListener('statechange', () => {
            if (nw.state === 'activated' && navigator.serviceWorker.controller) {
              showUpdateToast()
            }
          })
        })
      })
      .catch((err) => {
        console.warn('[sw] register failed:', err)
      })
  })
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
