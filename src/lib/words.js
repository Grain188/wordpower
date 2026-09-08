// 词工具：归一化 / 常量 / 本地随机抽干扰项（答对词复习不调 API，全靠这里 + 词库）
import { sampleN } from './random.js'

/** 唯一去重键：小写 + 去首尾空格 + 压缩连续空格 */
export function normalizeWord(w) {
  return String(w || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

/**
 * OCR/粘贴内容的粗过滤：只接受拉丁字母开头的词形
 * （E3：客户端先滤掉中文行/数字/乱码，省一次无谓的 API 调用）
 */
const LATIN_RE = /^[a-zA-Z][a-zA-Z'’\- ]{0,39}$/
export function isPlausibleWord(w) {
  return LATIN_RE.test(String(w || '').trim())
}

export const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']

export function validCefr(v) {
  return CEFR_LEVELS.includes(v) ? v : ''
}

export const THEMES = [
  { id: 'academic', zh: '学术' },
  { id: 'daily', zh: '日常' },
  { id: 'news', zh: '新闻' },
  { id: 'speaking', zh: '口语' },
]

export function themeZh(id) {
  return THEMES.find((t) => t.id === id)?.zh ?? ''
}

export function validTheme(v) {
  return THEMES.some((t) => t.id === v) ? v : ''
}

/** 词性粗分组（生词本三维：CEFR × 词性 × 主题） */
export function classifyPos(pos) {
  const p = String(pos || '').toLowerCase()
  if (p.startsWith('adv')) return 'adv'
  if (p.startsWith('adj') || p.startsWith('a.')) return 'adj'
  if (p.startsWith('n')) return 'noun'
  if (p.startsWith('v')) return 'verb'
  if (p.startsWith('prep')) return 'prep'
  if (p.startsWith('conj')) return 'conj'
  if (p.startsWith('pron')) return 'pron'
  return 'other'
}

export const POS_GROUP_ZH = {
  noun: '名词',
  verb: '动词',
  adj: '形容词',
  adv: '副词',
  prep: '介词',
  conj: '连词',
  pron: '代词',
  other: '其他',
}

/**
 * 本地随机抽干扰项：从词库其他词里抽释义文本。
 * @param {Array<{wordNorm:string, meaningZh:string, pos?:string}>} pool 候选池（通常=全部词）
 * @param {{wordNorm:string, meaningZh:string}} target 目标词
 * @param {number} n 需要的干扰项个数
 * @returns {Array<{text:string, origin:'local', wordNorm:string}>}
 */
export function pickLocalDistractors(pool, target, n = 3) {
  const usable = (pool || []).filter(
    (w) =>
      w.wordNorm !== target.wordNorm &&
      w.meaningZh &&
      w.meaningZh !== target.meaningZh
  )
  // 同词性优先（更接近真实混淆项），不足再从全部里补
  const samePos = usable.filter((w) => classifyPos(w.pos) === classifyPos(target.pos))
  const picked = sampleN(samePos.length >= n ? samePos : usable, n)
  return picked.map((w) => ({ text: w.meaningZh, origin: 'local', wordNorm: w.wordNorm }))
}
