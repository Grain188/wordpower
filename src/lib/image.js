// 图片工具：EXIF 方向读取 + 长边压缩到 maxSize + dataURL（拍照导入链路，浏览器专用）

const MAX_DEFAULT = 1280 // 任务规定：长边 ≤ 1280
const QUALITY_DEFAULT = 0.88 // 略高保真，保证 OCR 小字清晰

/* ---------- EXIF Orientation 解析（JPEG APP1） ---------- */

function readTiffOrientation(dv, base) {
  const le = dv.getUint16(base, false) === 0x4949 // 'II' little | 'MM' big
  const magic = dv.getUint16(base + 2, le)
  if (magic !== 42) return 1
  const ifd = dv.getUint32(base + 4, le)
  const count = dv.getUint16(base + ifd, le)
  for (let i = 0; i < count; i++) {
    const e = base + ifd + 2 + i * 12
    const tag = dv.getUint16(e, le)
    if (tag === 0x0112) {
      // Orientation：type=3(uint16)，值直接落在 entry 里
      return dv.getUint16(e + 8, le) || 1
    }
  }
  return 1
}

/** 读取 JPEG Orientation（1..8），非 JPEG 或无信息返回 1 */
export function readJpegOrientation(bytes) {
  if (!bytes || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let off = 2
  while (off + 4 <= bytes.length) {
    if (bytes[off] !== 0xff) {
      off++
      continue
    }
    const marker = bytes[off + 1]
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
      off += 2 // 无长度段的标记
      continue
    }
    const len = dv.getUint16(off + 2, false) // 含长度字段自身 2 字节
    if (marker === 0xe1 && off + 4 + 6 <= bytes.length) {
      const p = off + 4
      if (
        bytes[p] === 0x45 && bytes[p + 1] === 0x78 &&
        bytes[p + 2] === 0x69 && bytes[p + 3] === 0x66 &&
        bytes[p + 4] === 0x00 && bytes[p + 5] === 0x00
      ) {
        return readTiffOrientation(dv, p + 6) // 'Exif\0\0' 之后是 TIFF
      }
    }
    off += 2 + len
  }
  return 1
}

/* ---------- 缩放/旋转 → dataURL ---------- */

/** 长边缩放系数（导出便于单测） */
export function calcScale(w, h, maxSize = MAX_DEFAULT) {
  const long = Math.max(w, h)
  return long > maxSize ? maxSize / long : 1
}

function decodeImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片解码失败：格式不支持（如 HEIC），可改用系统 OCR 复制文字后走「粘贴文本」通道'))
    }
    img.src = url
  })
}

/**
 * 压缩（+EXIF 摆正）为 JPEG dataURL。
 * orientation>=5 表示需要旋转 90°，先交换画布宽高再绘制。
 */
export async function compressImageFile(file, { maxSize = MAX_DEFAULT, quality = QUALITY_DEFAULT } = {}) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const orientation = file.type === 'image/jpeg' ? readJpegOrientation(bytes) : 1
  const img = await decodeImage(file)

  const needsRotate = orientation >= 5 && orientation <= 8
  const srcW = needsRotate ? img.naturalHeight : img.naturalWidth
  const srcH = needsRotate ? img.naturalWidth : img.naturalHeight
  const scale = calcScale(srcW, srcH, maxSize)
  const w = Math.max(1, Math.round(srcW * scale))
  const h = Math.max(1, Math.round(srcH * scale))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff' // PNG 透明底转 JPEG 不出现黑块
  ctx.fillRect(0, 0, w, h)

  ctx.save()
  if (needsRotate) {
    ctx.translate(w / 2, h / 2)
    // 5: 镜像+90CW | 6: 90CW | 7: 镜像+90CCW | 8: 90CCW
    const angle = orientation === 6 ? Math.PI / 2 : orientation === 8 ? -Math.PI / 2 : orientation === 5 ? Math.PI / 2 : -Math.PI / 2
    if (orientation === 5 || orientation === 7) ctx.scale(1, -1)
    ctx.rotate(angle)
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2)
  } else {
    ctx.drawImage(img, 0, 0, w, h)
  }
  ctx.restore()

  const url = canvas.toDataURL('image/jpeg', quality)
  return {
    dataUrl: url,
    width: w,
    height: h,
    orientation,
    // JPEG dataURL ≈ 原字节的 4/3（base64），此处只做展示用的粗估
    approxBytes: Math.round(url.length * 0.75),
  }
}
