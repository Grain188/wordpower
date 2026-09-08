// api/chat.js —— 口语陪练的模型侧逻辑（双语一次返回 D4 + 上下文 ≤6 轮摘要压缩 省token④）
import { api, modelOf } from './client.js'

export const SCENES = [
  { id: 'travel', zh: '旅行', icon: '✈️', topic: 'traveling, airports, hotels and sightseeing' },
  { id: 'campus', zh: '校园', icon: '🎓', topic: 'college life, classes and study habits' },
  { id: 'work', zh: '工作', icon: '💼', topic: 'work, meetings and office life' },
  { id: 'daily', zh: '日常', icon: '☕', topic: 'daily life, food and hobbies' },
  { id: 'free', zh: 'AI 自由发挥', icon: '🧭', topic: '' },
]
export function sceneOf(id) {
  return SCENES.find((s) => s.id === id) || SCENES[0]
}

/** 每轮回复 token 上限：要求正文 ≤3 句 30 词，JSON 壳 + 中文翻译留余量 */
export const CHAT_MAX_TOKENS = 200

/**
 * system prompt：话题 + 目标词注入 + 行为约束。
 * targets: [{word, phonetic, meaningZh, used:boolean}]
 */
export function buildSystem(scene, targets) {
  const s = sceneOf(scene)
  const lines = targets
    .map((w, i) => `${i + 1}. ${w.word} ${w.phonetic ? `/${w.phonetic}/ ` : ''}（${w.meaningZh || '?'}）${w.used ? '[已用过]' : ''}`)
    .join('\n')
  return [
    'You are an English conversation partner at CEFR B1–B2 level. Keep all English simple and natural.',
    s.topic ? `Today we talk about: ${s.topic}.` : 'No fixed topic: freely pick something fun and ask me about it.',
    'Target words to weave in naturally this chat (prefer the ones marked 未用过):',
    lines,
    'Rules:',
    '- Each reply ≤ 3 sentences and ≤ 30 words. Always end with ONE short question to keep me talking.',
    '- If I misuse a target word, do NOT interrupt or lecture — just restate the correct form naturally in your reply.',
    '- Reply ONLY as JSON: {"en":"your english reply","zh":"中文翻译"}',
  ].join('\n')
}

/** 组装上下文：≤6 轮直接带；超出用此前生成的摘要 + 最近 4 轮（省 token ④） */
export function buildContext(scene, targets, recentRounds, summaryText) {
  const msgs = [{ role: 'system', content: buildSystem(scene, targets) }]
  if (summaryText) {
    msgs.push({
      role: 'user',
      content: `[此前对话摘要，背景信息，不需要回应] ${summaryText}`,
    })
  }
  for (const r of recentRounds) {
    msgs.push({
      role: r.role === 'user' ? 'user' : 'assistant',
      content: r.content, // 只带英文正文，压缩体积
    })
  }
  return msgs
}

/** 一轮 AI 回复：一次请求返回 {en, zh}（D4，避免二次翻译请求） */
export async function aiReply(scene, targets, msgs) {
  const { parsed } = await api.complete({
    model: modelOf('text'),
    messages: msgs,
    json: true,
    maxTokens: CHAT_MAX_TOKENS,
    temperature: 0.8,
    task: 'chat',
    hint: '口语回复',
  })
  const en = String(parsed?.en || '').trim()
  if (!en) throw new Error('AI 回复为空，请重试')
  return { en, zh: String(parsed?.zh || '').trim() }
}

/** 超过 6 轮时对旧轮次做一次摘要（只做一次，之后沿用 + 最近 4 轮） */
export async function summarizeChat(scene, targets, olderRounds) {
  const s = sceneOf(scene)
  const transcript = olderRounds
    .map((r) => `${r.role === 'user' ? 'User' : 'AI'}: ${r.content}`)
    .join('\n')
  const { content } = await api.complete({
    model: modelOf('text'),
    messages: [
      {
        role: 'system',
        content: 'Summarize this English chat in ≤40 English words. Keep: topic, which target words the user used correctly, and any misused words. Do not reply to the conversation.',
      },
      { role: 'user', content: `Topic: ${s.topic || 'free'}\n\n${transcript}` },
    ],
    maxTokens: 120,
    task: 'summary',
    hint: '对话摘要',
  })
  return String(content || '').trim()
}
