// gen-icons.mjs —— 纯 Node 生成 PWA 图标 PNG（零依赖：手写 PNG 编码器 + zlib）
// 用法：node scripts/gen-icons.mjs   （package.json 里 npm run icons）
// 内容：绿底圆角方块 + 白色"山峰" + 右上角激励黄圆点（多邻国绿 #58CC02）
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'public', 'icons')
mkdirSync(OUT, { recursive: true })

// ---------- 极简 PNG 编码 ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
const crc32 = (buf) => {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
const encodePNG = (w, h, rgba) => {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const stride = w * 4
  const raw = Buffer.alloc((stride + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0 // filter: None
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---------- 像素绘制（4x 超采样抗锯齿） ----------
const GREEN = [0x58, 0xcc, 0x02, 255]
const GREEN_DARK = [0x46, 0xa3, 0x02, 255]
const YELLOW = [0xff, 0xc8, 0x00, 255]
const WHITE = [0xff, 0xff, 0xff, 255]

// 以单位坐标（0..1）返回某个采样点是否命中形状：返回颜色数组或 null
function sample(px, py, rounded, maskable) {
  // 圆角方块背景（maskable 用全出血方角，避免系统裁圆后露白边）
  const corner = rounded ? 0.22 : 0
  const r = corner
  const cx = px < 0.5 ? px : 1 - px
  const cy = py < 0.5 ? py : 1 - py
  if (cx > 0.5 - r && cy > 0.5 - r) {
    const dx = cx - (0.5 - r)
    const dy = cy - (0.5 - r)
    if (dx * dx + dy * dy > r * r) return null // 圆角外透明
  }
  // 安全区缩放（maskable 内容收进中心 80%）
  const s = maskable ? 0.8 : 1
  const sx = (px - 0.5) / s + 0.5
  const sy = (py - 0.5) / s + 0.5

  // 底部深绿条（山峰脚下）
  if (sy > 0.84 && !rounded) return GREEN_DARK
  // 右上角激励黄圆点
  const dxs = sx - 0.76
  const dys = sy - 0.25
  if (dxs * dxs + dys * dys < 0.085 * 0.085) return YELLOW
  // 白色主峰（折线山脊）
  const ridge = [
    [0.13, 0.83], [0.36, 0.3], [0.5, 0.44], [0.62, 0.32], [0.87, 0.83],
  ]
  const under = (sx, sy) => {
    for (let i = 0; i < ridge.length - 1; i++) {
      const [x1, y1] = ridge[i]
      const [x2, y2] = ridge[i + 1]
      const t = (sx - x1) / (x2 - x1)
      if (t >= -0.001 && t <= 1.001) {
        const edge = y1 + t * (y2 - y1)
        if (sy >= edge) return true
      }
    }
    return false
  }
  if (under(sx, sy)) return WHITE
  return rounded || maskable ? GREEN : GREEN
}

function draw(size, rounded, maskable) {
  const S = 4 // 超采样倍数
  const px = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const acc = [0, 0, 0, 0]
      let n = 0
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const col = sample((x + (sx + 0.5) / S) / size, (y + (sy + 0.5) / S) / size, rounded, maskable)
          if (col) {
            for (let c = 0; c < 4; c++) acc[c] += col[c]
            n++
          }
        }
      }
      const i = (y * size + x) * 4
      if (n > 0) {
        px[i] = Math.round(acc[0] / n)
        px[i + 1] = Math.round(acc[1] / n)
        px[i + 2] = Math.round(acc[2] / n)
        px[i + 3] = Math.round(acc[3] / n)
      }
    }
  }
  return encodePNG(size, size, px)
}

const targets = [
  ['icon-192.png', 192, true, false],
  ['icon-512.png', 512, true, false],
  ['maskable-512.png', 512, false, true],
  ['apple-touch-icon.png', 180, false, false],
]
for (const [file, size, rounded, maskable] of targets) {
  writeFileSync(join(OUT, file), draw(size, rounded, maskable))
  console.log('icon:', file)
}
console.log('done -> public/icons')
