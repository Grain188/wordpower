// api/distractors.js —— 答错词的「明日干扰项 + 新例句」批量生成（省 token ②）
// 只在答错词上发生；一次请求处理一批；答对词复习走本地抽词，永不调 API。

import { api, modelOf } from './client.js'
import { normalizeWord, pickLocalDistractors } from '../lib/words.js'
import { shuffle } from '../lib/random.js'

const PROMPT = (items) =>
  `For each word below, create 3 Chinese meaning distractors and 1 new example sentence.
Rules: distractors must look like plausible Chinese meanings but NEVER equal the correct meaning (you will see correct_zh); keep each 2-6 Chinese chars; example sentence <=12 words containing the word.
Output ONLY JSON: {"items":[{"word":"lowercase word","distractors":["d1","d2","d3"],"example":"one sentence"}]}
Input: ${JSON.stringify(items)}`

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
    maxTokens: Math.min(1600, 160 + items.length * 90),
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
