// api/scenario.js —— 错词情景对话：情景卡生成（一次文本调用，按词组缓存）
import { api, parseJsonContent, modelOf } from './client.js'
import { getScenarioCache, putScenarioCache } from '../db/repo.js'
import { normalizeWord } from '../lib/words.js'

/** 情景卡生成输出上限（规格：≤300） */
export const SCENARIO_GEN_TOKENS = 300
/** 情景对话每轮回复上限（bilingual JSON + ≤25 词英文） */
export const SCENARIO_REPLY_TOKENS = 140
/** 一局最长 AI 轮数 */
export const SCENARIO_MAX_ROUNDS = 12

export function scenarioGroupKey(words) {
  return words
    .map((w) => normalizeWord(w?.word))
    .sort()
    .join(',')
}

const GEN_PROMPT = (words) => `把以下英文生词编进一段连贯的生活情景剧情，用于"口语对演练习"（用户扮演当事人，AI 扮演 NPC）。
生词：${JSON.stringify(words)}

硬性要求：
1. 必须把每个生词自然编进同一段连贯剧情（时间/地点/人物自洽，有起因经过冲突），严禁像清单一样罗列词汇。
2. 场景优先职场/校园/日常社交等易代入情境。
3. beats 数量 = 生词数量，每个词至少安排一次"必须由用户说出"的出场时机。
4. opening_line 是 NPC 开场白，英文 ≤40 词，要自然带出第一个目标词。

只输出 JSON：{"title":"中文情景标题","scene_brief_cn":"30 字中文剧情简介（开场播报用）","your_role":"用户角色(英文,如 a job candidate)","npc_role":"AI 角色(英文,如 a strict interviewer)","npc_persona":"NPC 人设一句话(英文,影响语气)","opening_line":"英文 ≤40 词开场白","target_words":["仅这 ${words.length} 个词，小写原形"],"beats":[{"beat_cn":"剧情节点中文","must_use":"该节点要用的词"}]}
beats 长度必须等于 ${words.length}，must_use 覆盖全部 target_words。`

function sanitize(scenario, words) {
  const s = scenario || {}
  const norms = words.map((w) => normalizeWord(w?.word))
  const title = String(s.title || '').trim() || '情景练习'
  return {
    title,
    scene_brief_cn: String(s.scene_brief_cn || '').trim(),
    your_role: String(s.your_role || 'yourself').trim(),
    npc_role: String(s.npc_role || 'a friend').trim(),
    npc_persona: String(s.npc_persona || 'friendly').trim(),
    opening_line: String(s.opening_line || '').trim(),
    target_words: norms, // 以实际传入的词为准，防模型丢词
    beats: Array.isArray(s.beats) ? s.beats.slice(0, norms.length + 2) : [],
  }
}

async function generateScenario(words) {
  // 偶发"空返回"：最多重试 3 次（换一点温度），仍失败再抛错（由调用方落本地兜底卡）
  let lastErr = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { content } = await api.complete({
        model: modelOf('text'),
        messages: [
          {
            role: 'user',
            content: GEN_PROMPT(words.map((w) => w.word)),
          },
        ],
        json: false, // 容错解析（不用 json_object，个别模型会空）
        maxTokens: SCENARIO_GEN_TOKENS,
        temperature: attempt === 1 ? 0.9 : 1.1,
        task: 'chat',
        hint: `情景卡生成${attempt > 1 ? `·重试${attempt}` : ''}`,
      })
      if (!content) throw new Error('empty')
      return sanitize(parseJsonContent(content, '情景卡生成'), words)
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr || new Error('情景卡生成失败')
}

/** 本地兜底情景卡：AI 不可用时也保证能用（模板化、可对话） */
export function buildFallbackScenario(words) {
  const norms = words.map((w) => normalizeWord(w?.word))
  const first = norms[0] || 'conversation'
  return {
    title: '错词练习小剧场',
    scene_brief_cn: '你与老友在咖啡馆重逢，聊起近况；把生词自然说进你们的对话。',
    your_role: 'a friend catching up over coffee',
    npc_role: 'an old friend',
    npc_persona: 'warm and curious',
    opening_line: `It has been months since we last met! I remember you were practicing "${first}" back then. How would you use it naturally today?`,
    target_words: norms,
    beats: norms.map((w) => ({ beat_cn: `自然说出 ${w}`, must_use: w })),
  }
}

/** 取情景卡：同一组词已生成过 → 直接返回缓存；AI 失败 → 本地兜底卡（不缓存，下次可再试 AI） */
export async function getOrCreateScenario(words) {
  const key = scenarioGroupKey(words)
  const cached = await getScenarioCache(key)
  if (cached?.payload) return cached.payload
  try {
    const scenario = await generateScenario(words)
    await putScenarioCache(key, scenario).catch(() => {})
    return scenario
  } catch {
    return buildFallbackScenario(words)
  }
}

/** 情景对话 system prompt（对演规则注入） */
export function buildScenarioSystem(scenario) {
  return [
    `We are doing a role-play (English, CEFR B1–B2). I am ${scenario.your_role}; you are ${scenario.npc_role} (persona: ${scenario.npc_persona}).`,
    `Plot: ${scenario.scene_brief_cn} Beats: ${(scenario.beats || [])
      .map((b) => `${b.beat_cn} (use: ${b.must_use})`)
      .join(' | ')}`,
    'Rules:',
    '- Advance the story beat by beat through the conversation.',
    '- Each reply ≤ 2 sentences and ≤ 25 words, always end with ONE short question or a gap waiting for me to speak.',
    '- Use target words naturally: first mention each one yourself as a model, then in a later turn leave a gap for me to say it.',
    '- If I use a target word correctly: praise briefly and move the plot on. If I misuse it: just restate the correct form and continue (do not lecture).',
    '- If the learner keeps missing a word twice, you may add a very short Chinese hint in the "zh" field.',
    '- If I say "exit", wrap up the scene in one line.',
    '- Reply ONLY as JSON: {"en":"...","zh":"中文翻译"}',
  ].join('\n')
}
