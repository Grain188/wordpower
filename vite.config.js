import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// M0: Vite 基础配置。
// host:true —— 允许手机在同一局域网通过 http://<电脑IP>:5173 访问，方便真机调试 PWA。
export default defineConfig({
  plugins: [react()],
  server: { host: true, port: 5173 },
  build: {
    // 个人小应用，关闭 chunk 拆分告警噪音
    chunkSizeWarningLimit: 1024,
  },
})
