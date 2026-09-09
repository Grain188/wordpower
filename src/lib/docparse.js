// lib/docparse.js —— 文档导入解析（Word/PDF/Excel/TXT → 纯文本 → 走文本模型整理）
// 全部动态 import：只在用户真选了对应类型时才下载对应解析库，不拖慢首屏。
// 说明：旧版二进制 .doc/.xls 无法在浏览器里可靠解析 → 提示另存为新格式。

const DOC_EXTS = new Set(['docx', 'pdf', 'xlsx', 'txt', 'md', 'csv'])
const TEXT_EXTS = new Set(['txt', 'md', 'csv'])

function extOf(name) {
  const i = String(name || '').lastIndexOf('.')
  return i < 0 ? '' : String(name).slice(i + 1).toLowerCase()
}

/** 压缩空白，保留行结构（行内多个空格压成一个） */
function cleanText(raw) {
  return String(raw || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

/** 把一段很长的文本按 3800 字符（行边界）切块，供分批走 annotate（省 token，避免单请求爆长） */
export function splitForAnnotate(text, size = 3800) {
  const src = String(text || '')
  const out = []
  let rest = src
  while (rest.length > size) {
    let cut = rest.lastIndexOf('\n', size)
    if (cut <= 0) cut = rest.lastIndexOf(' ', size)
    if (cut <= 0) cut = size
    out.push(rest.slice(0, cut))
    rest = rest.slice(cut).replace(/^\s+/, '')
  }
  if (rest.trim()) out.push(rest)
  return out
}

/** 把文档解析成可用的行文文本 */
export async function fileToText(file) {
  const name = file?.name || ''
  const ext = extOf(name)
  if (!DOC_EXTS.has(ext)) {
    throw new Error('不支持的格式：请用 Word(.docx)/PDF/.xlsx/纯文本(.txt)。旧版 .doc/.xls 请先在 Office 里“另存为”新格式。')
  }

  // —— TXT/MD/CSV：直接读文本 ——
  if (TEXT_EXTS.has(ext)) {
    const text = cleanText(await file.text())
    if (!text) throw new Error('文件里没有文字内容')
    return { text, note: '' }
  }

  // —— DOCX（mammoth）——
  if (ext === 'docx') {
    const mammoth = await import('mammoth')
    const m = mammoth.default || mammoth
    const res = await m.extractRawText({ arrayBuffer: await file.arrayBuffer() })
    const text = cleanText(res?.value || '')
    if (!text) throw new Error('DOCX 里没解析到文字（可能是扫描件，请改用拍照导入）')
    return { text, note: '' }
  }

  // —— PDF（pdfjs-dist）——
  if (ext === 'pdf') {
    const pdfjsLib = await import('pdfjs-dist')
    const pdfjs = pdfjsLib.default || pdfjsLib
    let worker = null
    try {
      // 让 Vite 把 pdf.worker 打进独立 worker chunk，再以 module worker 方式挂给 pdfjs
      worker = new Worker(new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url), { type: 'module' })
      pdfjs.GlobalWorkerOptions.workerPort = worker
    } catch {
      /* 极少数环境起不了 worker → pdfjs 会用主线程兜底 */
    }
    let doc = null
    try {
      doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
      const parts = []
      for (let p = 1; p <= Math.min(doc.numPages, 80); p++) {
        const page = await doc.getPage(p)
        const tc = await page.getTextContent()
        parts.push(tc.items.map((it) => (it.str || '')).join(' '))
      }
      await doc.destroy().catch(() => {})
      doc = null
      const text = cleanText(parts.join('\n'))
      if (!text) throw new Error('这份 PDF 没有可提取的文字层（扫描版请改用拍照导入通道）')
      return { text, note: 'PDF 按页提取文本' }
    } finally {
      if (doc) await doc.destroy().catch(() => {})
      if (worker) worker.terminate()
    }
  }

  // —— XLSX（SheetJS）——
  if (ext === 'xlsx') {
    const mod = await import('xlsx')
    const XLSX = mod.default || mod
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
    const rows = []
    for (const sheetName of wb.SheetNames.slice(0, 20)) {
      const ws = wb.Sheets[sheetName]
      if (!ws) continue
      const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
      for (const row of grid) {
        if (Array.isArray(row)) {
          const line = row.map((c) => String(c ?? '').trim()).filter(Boolean).join('\t')
          if (line) rows.push(line)
        }
      }
    }
    const text = cleanText(rows.join('\n'))
    if (!text) throw new Error('Excel 里没有内容')
    return { text, note: 'Excel 每行按单元格（制表符）连接，词与中文同格时会被一起识别' }
  }

  throw new Error('该格式暂不支持')
}
