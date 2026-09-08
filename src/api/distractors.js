// api/distractors.js —— 答错词的「明日干扰项 + 新例句」批量生成（省 token ②）
// 只在答错词上发生；一次请求处理一批；答对词复习走本地抽词，永不调 API。

import { api, modelOf } from './client.js'
import { normalizeWord, pickLocalDistractors } from '../lib/words.js'
import { shuffle } from '../lib/random.js'

const PROMPT = (items) =>
  `为每个英文生词造 3 个中文释义干扰项和 1 个新例句。
规则：干扰项要是"像正确答案的中文词义"但绝不能等于我给出的正确释义（你会在输入里看到 correct_zh）；简短 2-6 字；例句 ≤12 词、含该词、难度贴合 CEFR。
只输出 JSON：{"items":[{"word":"小写单词","distractors":["干扰1","干扰2","干扰3"],"example":"一句话例句"}]}
输入：${JSON.stringify(items)}`

/**
 * 批量生成（一次请求）。
 * @param {Array<{word:string, meaningZh:string}>} wrongWords 本战答错的词
 * @returns {Promise<Map<string,{distractors:string[], example:string}>>} key=wordNorm
 */
export async function generateDistractorBatch(wrongWords) {
  const items = (wrongWords || []).slice(0, 15).map((w) => ({
    word: w.word,
    correct_zh: w.meaningZh || '',
  }))
  if (!items.length) return new Map()
  const { parsed } = await api.complete({
    model: modelOf('text'),
    messages: [{ role: 'user', content: PROMPT(items) }],
    json: true,
    maxTokens: Math.min(2400, 200 + items.length * 120),
    task: 'distractor',
    hint: '干扰项生成',
  })
  const map = new Map()
  for (const it of parsed?.items || []) {
    const norm = normalizeWord(it?.word)
    if (!norm || !it) continue
    const ds = (it.distractors || []).filter((d) => typeof d === 'string' && d.trim() && d.trim() !== it.correct_zh)
    map.set(norm, {
      distractors: ds.slice(0, 3),
      example: String(it.example || '').trim(),
    })
  }
  return map
}

/**
 * 本地搭一题选项：1 正确释义 + 最多 3 个词库干扰项（答对词的复习路径，零 API）。
 * @returns {Array<{text:string, correct:boolean, origin:'local'}>|null} 不足 2 个干扰项返回 null（词库太小）
 */
export function buildLocalOptions(word, pool) {
  const wrong = pickLocalDistractors(pool, { wordNorm: word.wordNorm, meaningZh: word.meaningZh }, 3)
  if (wrong.length < 2) return null
  const options = [
    { text: word.meaningZh, correct: true, origin: 'local' },
    ...wrong.map((w) => ({ text: w.text, correct: false, origin: 'local' })),
  ]
  return shuffle(options)
}
