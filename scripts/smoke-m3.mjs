// M3 冒烟：图片 EXIF/缩放 + OCR 归一化/截断 + 本地词形降级（纯函数，不碰网络/Canvas）
// 运行：npm run smoke
import assert from 'node:assert/strict'
import { readJpegOrientation, calcScale } from '../src/lib/image.js'
import {
  normalizeItems,
  looksPureLatin,
  extractLocalWords,
  MAX_OCR_ITEMS,
} from '../src/api/ocr.js'

/** 构造带指定 EXIF Orientation 的最小 JPEG 字节（little-endian TIFF APP1） */
function jpegWithOrientation(orientation) {
  const tiff = Buffer.alloc(26)
  tiff.write('II', 0, 'ascii')
  tiff.writeUInt16LE(42, 2)
  tiff.writeUInt32LE(8, 4) // IFD0 偏移
  tiff.writeUInt16LE(1, 8) // entry 数
  tiff.writeUInt16LE(0x0112, 10) // Orientation tag
  tiff.writeUInt16LE(3, 12) // type SHORT
  tiff.writeUInt32LE(1, 14) // count
  tiff.writeUInt16LE(orientation, 18) // value
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiff])
  const app1 = Buffer.alloc(4)
  app1[0] = 0xff
  app1[1] = 0xe1
  app1.writeUInt16BE(payload.length + 2, 2) // 段长含长度字段自身
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, payload, Buffer.from([0xff, 0xd9])])
}

// —— EXIF（E3：竖拍照片方向修正）——
assert.equal(readJpegOrientation(jpegWithOrientation(6)), 6, 'orientation=6')
assert.equal(readJpegOrientation(jpegWithOrientation(8)), 8, 'orientation=8')
assert.equal(readJpegOrientation(jpegWithOrientation(1)), 1, 'orientation=1')
assert.equal(readJpegOrientation(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), 1, 'PNG → 1')
assert.equal(readJpegOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xd9])), 1, '无 APP1 → 1')

// —— 缩放 ——
assert.equal(calcScale(1600, 900, 1280), 0.8, '长边超限等比缩')
assert.equal(calcScale(1000, 800, 1280), 1, '短于上限不放大')
assert.equal(calcScale(5000, 300, 1280), 0.256, '超宽图按长边')

// —— OCR 项归一化 + 去重 + 截断 ——
const items = normalizeItems({
  words: [
    { word: 'Hello', meaning_zh: '你好', cefr_level: 'B1', theme: 'daily' },
    { word: 'hello', meaning_zh: '重复小写', pos: 'intj.' }, // 同词去重
    { word: '  ', meaning_zh: '空词应丢' },
    { word: 'vague', meaning: '模糊的', cefr_level: 'C1' }, // 容忍 key 变体
  ],
})
assert.equal(items.length, 2)
assert.equal(items[0].meaningZh, '你好')
assert.equal(items[0].cefr, 'B1')
assert.equal(items[1].cefr, 'C1', 'cefr_level/cefr 变体都接受')
assert.equal(items[1].meaningZh, '模糊的')

// 50 个纯字母不同词（w0 会撞"含数字=噪音"过滤，这里生成无数字的）
const lettersOf = (n) => {
  let s = ''
  let v = n
  do {
    s = String.fromCharCode(97 + (v % 26)) + s
    v = Math.floor(v / 26) - 1
  } while (v >= 0)
  return s
}
const many = normalizeItems({
  words: Array.from({ length: 50 }, (_, i) => ({ word: lettersOf(i + 26), meaning_zh: `义${i}` })),
})
assert.equal(many.length, MAX_OCR_ITEMS, '超过 40 个截断')

// —— 粘贴文本判定 / 本地降级 ——
assert.equal(looksPureLatin('abandon\ncherish'), true)
assert.equal(looksPureLatin('abandon 抛弃'), false, '含中文 → 非纯拉丁')
const local = extractLocalWords('abandon 抛弃 cherish 珍惜 3apple well-known')
// 连字符词整体保留（well-known）；数字被当成分隔符（3apple → apple）
assert.deepEqual(local.map((x) => x.word), ['abandon', 'cherish', 'apple', 'well-known'])
assert.ok(local.every((x) => !x.meaningZh), '降级项无释义（等用户在生词本补）')

// —— 容错 JSON 解析（模型夹带杂文/围栏也能抠出 JSON）——
import { parseJsonContent } from '../src/api/client.js'
assert.deepEqual(parseJsonContent('{"ok":1}'), { ok: 1 }, '纯 JSON')
assert.deepEqual(parseJsonContent('```json\n{"ok":2}\n```'), { ok: 2 }, '整段围栏')
assert.deepEqual(
  parseJsonContent('好的，识别结果如下：\n{"words":[{"word":"hello"}]}\n希望有帮助！'),
  { words: [{ word: 'hello' }] },
  '杂文夹 JSON'
)
assert.deepEqual(parseJsonContent('prefix [1,2,3] suffix'), [1, 2, 3], '数组块')
assert.throws(() => parseJsonContent('完全没有 json'), undefined, '真无 JSON 抛错')
assert.equal(normalizeItems([{ word: 'array-mode', meaningZh: 'x' }]).length, 1, '直接数组也接受')
assert.equal(normalizeItems({ Words: [{ word: 'caps', meaningZh: 'x' }] }).length, 1, '大小写键兼容')

// —— 文档导入：长文本分块（docparse 纯函数）——
import { splitForAnnotate } from '../src/lib/docparse.js'
const longText = Array.from({ length: 2000 }, (_, i) => `token${i} alpha beta`).join('\n')
const segs = splitForAnnotate(longText)
assert.ok(segs.length > 1, '长文本应分多块')
assert.ok(segs.every((s) => s.length <= 3800), '每块不超上限')
assert.ok(segs[0].startsWith('token0'), '第一块以开头开始')
assert.ok(segs[segs.length - 1].includes('token1999'), '末块包含结尾内容')

// —— 词表本地配对（Excel 直通路径）——
import { detectPairs } from '../src/lib/docparse.js'
import { extractWordList } from '../src/api/ocr.js'
const pairText = ['apple\t苹果', 'banana\t香蕉', 'cherry\t樱桃', 'quick\t迅速的', 'bright\t明亮的'].join('\n')
assert.equal(detectPairs(pairText), true, '成对词表被识别')
assert.equal(detectPairs('This is a normal sentence with no Chinese here.'), false, '正文不是词对表')
const wl = extractWordList(pairText)
assert.equal(wl.length, 5)
assert.equal(wl[0].word, 'apple')
assert.equal(wl[0].meaningZh, '苹果', '保留中文释义')
const big = Array.from({ length: 80 }, (_, i) => `word${i}\t义${i}`).join('\n')
assert.ok(extractWordList(big).length === 80, '超过 60 也不截断（上限 600）')

console.log('✅ M3 smoke: 图片/OCR 纯函数全部断言通过')
