// api/ocr.js —— 导入双通道的词条提取（共用同一条确认/去重/入库流水线）
//   A 通道：拍照/选图 → vision（deepseek-v4-flash-vision-exp）
//   B 通道：粘贴文本（安卓本地 OCR 结果等）→ 文本模型结构化
// 省 token：prompt 精炼、单次批量、max_tokens 上限；纯拉丁词表也走 B 通道保证释义质量。

import { api, imageMessage, parseJsonContent, ApiError, modelOf } from './client.js'
import { normalizeWord } from '../lib/words.js'

export const MAX_OCR_ITEMS = 40 // 防一整页 OCR 失控（前端截断）

// 精炼 OCR prompt。DeepSeek json_object 模式要求正文出现 "JSON" 字样。
const OCR_PROMPT = `你是英文生词提取器。识别图片中所有值得背诵的英文生词，忽略中文/水印/无关字符，同词去重。
只输出 JSON：{"words":[{"word":"单词原形小写","phonetic":"英式音标","pos":"词性缩写如 n./v./adj.","meaning_zh":"简明中文释义","cefr_level":"A1|A2|B1|B2|C1|C2","theme":"academic|daily|news|speaking","example_sentence":"含该词的一句话例句"}]}
字段缺失填空字符串，最多 40 词，不要输出其他内容。`

const ANNOTATE_PROMPT = (text) => `整理下面的生词/课文文本为结构化 JSON。重要规则：
1. 只挑"值得背的英文生词"：名词/动词/形容词/副词等实词；跳过基础功能词(a/the/of/and/was/have 之类)与超高频简单词，跳过纯数字、网址、邮箱、人名地名等专有名词。
2. 如果输入是"英文词 + 中文"成对出现的清单（词和释义同行/同格），直接按对采用其中文释义，不要拆错列、不要重译。
3. 没有释义对的生词补一句简明中文释义；词一律小写原形；同词只留一条。
4. 中文课文配词就正常整词，别把单词拆成字母。
只输出 JSON：{"words":[{"word":"","phonetic":"","pos":"","meaning_zh":"","cefr_level":"A1|A2|B1|B2|C1|C2","theme":"academic|daily|news|speaking","example_sentence":""}]}
用户文本：
"""${String(text).slice(0, 4000)}"""`

// 基础功能词/超高频词黑名单（客户端兜底：模型漏跳的在这里再跳一次）
const SKIP_COMMON = new Set(
  [
    'a an the and or nor but so for of to in on at by with from into onto off over under above below per via as if else then than too very just also not no yes yet',
    'i you he she it we they me him her us them my your his its our their this that these those who whom whose which what when where why how',
    'be am is are was were been being do does did doing have has had having can could will would shall should may might must ought need dare',
    'up down out about after before while since until during against between among through within without across along behind beyond',
    'there here some any more most all each every both few other such only own same new old good bad great little big small high low',
    'one two three first second last next much many again once never always often sometimes now then today tomorrow yesterday here there',
  ].join(' ').split(/\s+/)
)

function isJunkWord(word) {
  const w = String(word || '')
  if (!w || w.length > 30 || w.length < 2) return true
  if (/[0-9]/.test(w)) return true // 含数字
  if (/http|www\.|@|_/.test(w)) return true // 网址/邮箱痕迹
  if (SKIP_COMMON.has(w.toLowerCase())) return true
  return false
}

/** 把模型返回项规整成 repo.importWords 可直接吃的结构（容忍 key 变体） */
export function normalizeItem(raw) {
  const w = raw || {}
  const word = String(w.word || w.spelling || '').trim()
  if (!word) return null
  return {
    word,
    phonetic: String(w.phonetic || w.phone || '').trim(),
    pos: String(w.pos || '').trim(),
    meaningZh: String(w.meaning_zh ?? w.meaningZh ?? w.meaning ?? '').trim(),
    cefr: String(w.cefr_level ?? w.cefr ?? '').toUpperCase(),
    theme: String(w.theme ?? '').trim(),
    example: String(w.example_sentence ?? w.example ?? '').trim(),
  }
}

/** 取词数组：兼容直接给数组 / {words:[…]} / {Words:[…]} 等键名变体 */
function wordsOf(parsed) {
  if (Array.isArray(parsed)) return parsed
  if (!parsed || typeof parsed !== 'object') return []
  for (const k of Object.keys(parsed)) {
    if (/word/i.test(k) && Array.isArray(parsed[k])) return parsed[k]
  }
  return []
}

/** 去重 + 噪音过滤 + 截断（ocr/annotate 共用） */
export function normalizeItems(parsed) {
  const seen = new Set()
  const out = []
  for (const raw of wordsOf(parsed).slice(0, MAX_OCR_ITEMS)) {
    const item = normalizeItem(raw)
    if (!item) continue
    const norm = normalizeWord(item.word)
    if (seen.has(norm) || isJunkWord(norm)) continue // 跳过功能词/数字/网址等
    seen.add(norm)
    out.push(item)
  }
  return out
}

/** 修复重试：把上次的"脏输出"交给文本模型整理成合法 JSON（无需重发图片，省 token） */
async function repairJson(rawContent, hint) {
  const { content } = await api.complete({
    model: modelOf('text'),
    messages: [
      {
        role: 'user',
        content: `以下是一段可能夹带说明文字/围栏的模型输出，请提取其中的英文生词数据并只输出合法 JSON：{"words":[{"word":"","phonetic":"","pos":"","meaning_zh":"","cefr_level":"","theme":"","example_sentence":""}]}。没有词就输出 {"words":[]}。\n\n原始输出：\n${String(rawContent).slice(0, 4000)}`,
      },
    ],
    json: false,
    maxTokens: 3600,
    task: 'ocr',
    hint: `${hint}·修复`,
  })
  return parseJsonContent(content, `${hint}·修复`)
}

/** A 通道：图片 → 词条（容错解析；失败/无词都先自动用文本模型修复一次） */
export async function extractWordsFromImage(dataUrl, { signal, hint = '拍照识别' } = {}) {
  const { content } = await api.complete({
    model: modelOf('vision'),
    messages: [{ role: 'user', content: imageMessage(dataUrl, OCR_PROMPT) }],
    json: false, // 让容错解析 + 修复逻辑接管
    maxTokens: 3600,
    task: 'ocr',
    signal,
    hint,
  })

  let parsedOk = false
  let items = []
  try {
    items = normalizeItems(parseJsonContent(content, hint))
    parsedOk = true // 解析成功（哪怕 0 词，交给确认页友好提示）
  } catch {
    parsedOk = false
  }

  if (!parsedOk) {
    // 容错解析抛错 → 用文本模型把脏输出整理成合法 JSON（不用重发图片）
    try {
      items = normalizeItems(await repairJson(content, hint))
      parsedOk = true
    } catch {
      parsedOk = false
    }
  }

  if (!parsedOk) {
    const snippet = String(content || '')
      .replace(/\s+/g, ' ')
      .slice(0, 160)
    throw new ApiError(
      'bad',
      `识别结果无法解析（${hint}）。模型返回：${snippet || '（空）'}。可改用「粘贴文本」通道导入`
    )
  }
  return items
}

/** 是否"纯拉丁词表"（无中文、标点少）——仅用于错误降级提示文案 */
export function looksPureLatin(text) {
  return !/[\u4e00-\u9fff]/.test(String(text || ''))
}

/** B 通道：粘贴文本 → 词条（一次批量，禁止一词一请求）。
 *  不用 response_format 强约束（个别模型会因此返回空），改走容错解析；失败自动修复重试一次。 */
export async function annotatePastedText(text, { signal, hint = '文本归档' } = {}) {
  async function oneShot() {
    const { content } = await api.complete({
      model: modelOf('text'),
      messages: [{ role: 'user', content: ANNOTATE_PROMPT(text) }],
      json: false,
      maxTokens: 3600,
      task: 'annotate',
      signal,
      hint,
    })
    return normalizeItems(parseJsonContent(content, hint))
  }

  try {
    return await oneShot()
  } catch {
    // 空内容/解析失败 → 让文本模型把脏输出整理成合法 JSON（一次修复）
    let repaired = []
    try {
      const { content } = await api.complete({
        model: modelOf('text'),
        messages: [{ role: 'user', content: ANNOTATE_PROMPT(text) }],
        json: false,
        maxTokens: 3600,
        task: 'annotate',
        signal,
        hint: `${hint}·重试`,
      })
      repaired = normalizeItems(parseJsonContent(content, `${hint}·重试`))
    } catch {
      throw new ApiError('bad', `${hint}失败：模型连续两次返回空/非法内容。可点「仅存词形（不上传）」先把词收进来`)
    }
    return repaired
  }
}

/** 纯本地降级：从文本里抠词形（无释义），cap 可调（默认 60 保留兼容旧调用） */
export function extractLocalWords(text, max = 60) {
  const tokens = String(text || '')
    .toLowerCase()
    .split(/[^a-zA-Z'’-]+/)
    .filter((t) => /^[a-z][a-z'’-]{1,39}$/.test(t))
  const seen = new Set()
  const items = []
  for (const t of tokens) {
    const norm = normalizeWord(t)
    if (seen.has(norm) || items.length >= max) continue
    seen.add(norm)
    items.push({ word: norm, phonetic: '', pos: '', meaningZh: '', cefr: '', theme: '', example: '' })
  }
  return items
}

/**
 * 成对词表本地解析（Excel/词对文本的兜底与直通路径，零 AI、不限 60）：
 * 每行识别「英文词 + 空格/Tab + 中文释义」，就地保留释义；纯词行退回词形提取。
 */
export function extractWordList(text, max = 600) {
  const seen = new Set()
  const out = []
  const push = (w, zh = '') => {
    const norm = normalizeWord(w)
    if (!norm || seen.has(norm) || isJunkWord(norm) || out.length >= max) return
    seen.add(norm)
    out.push({ word: norm, phonetic: '', pos: '', meaningZh: zh, cefr: '', theme: '', example: '' })
  }
  const lines = String(text || '').split('\n')
  for (const line of lines) {
    const t = line.trim()
    if (!t) continue
    const pair = t.match(/^([A-Za-z][A-Za-z'’\- ]{0,29})\s+(.+)$/)
    if (pair) {
      const w = pair[1].trim()
      let rest = pair[2].trim()
      if (/[\u4e00-\u9fff]/.test(rest)) {
        // 中文释义在 rest 开头；可容忍前面带词性缩写（如 "v. 放弃"）
        const zhMatch = rest.match(/^[A-Za-z.]{0,6}?([\u4e00-\u9fff][^\t]*)/)
        const zh = (zhMatch ? zhMatch[1] : rest).replace(/[。.;；,，、\s]+$/, '').trim()
        if (zh) push(w, zh)
      } else {
        push(w)
      }
    } else {
      // 无中文的行：整行若就是一个词则收下（如纯词列无释义）
      const ws = t.match(/[A-Za-z][A-Za-z'’\-]{1,29}/g)
      if (ws) ws.forEach((w) => push(w))
    }
  }
  return out
}
