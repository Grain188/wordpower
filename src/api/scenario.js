// api/scenario.js —— 错词情景对话：情景卡生成（一次文本调用，按词组缓存）
import { api, parseJsonContent, modelOf } from './client.js'
import { getScenarioCache, putScenarioCache, deleteScenarioCache } from '../db/repo.js'
import { normalizeWord } from '../lib/words.js'

/** 情景卡生成输出上限（模型带 reasoning，需留思考链余量） */
export const SCENARIO_GEN_TOKENS = 800
/** 情景对话每轮回复上限（思考链 + bilingual JSON） */
export const SCENARIO_REPLY_TOKENS = 512
/** 一局最长 AI 轮数 */
export const SCENARIO_MAX_ROUNDS = 12

export function scenarioGroupKey(words) {
  return words
    .map((w) => normalizeWord(w?.word))
    .sort()
    .join(',')
}

/** 生词带释义/词性给模型：让场景按"语义"构思而非泛泛 */
const GEN_PROMPT = (words) => {
  const list = words
    .map((w) => `${w.word}（${w.meaningZh || '?'}${w.pos ? `，${w.pos}` : ''}）`)
    .join('；')
  return `把以下英文生词/词组编进一段连贯的生活情景剧情，用于"口语对演练习"（用户扮演当事人，AI 扮演 NPC）。
生词（含中文释义，构思场景请以语义为准，选贴切的地点/人物/事件，不要套通用场景）：
${list}

要求：
1. 让每个词在剧情里承担符合语义的戏份；所有词编进同一段连贯剧情（时间地点人物自洽、有起因经过），严禁清单罗列。
2. 明确角色扮演：给"你"和"NPC"各有代入感的身份，剧情围绕两人目标与冲突推进。
3. opening_line 是 NPC 开场白（英文 ≤40 词），自然带出第一个目标词。

不需要思考过程，直接只输出 JSON：
{"title":"中文情景标题","scene_brief_cn":"30 字中文简介","your_role":"英文角色","npc_role":"英文角色","npc_persona":"英文人设一句","opening_line":"英文开场白 ≤40 词"}`
}

/** 若模型没给 beats，用本地按词生成的节拍兜底（每词一句"自然说出"） */
function localBeats(norms) {
  return norms.map((w) => ({ beat_cn: `自然说出 ${w}`, must_use: w }))
}

function sanitize(scenario, words) {
  const s = scenario || {}
  const norms = words.map((w) => normalizeWord(w?.word))
  const title = String(s.title || '').trim() || '情景练习'
  const aiBeats = Array.isArray(s.beats) ? s.beats.filter((b) => b && b.must_use) : []
  return {
    title,
    scene_brief_cn: String(s.scene_brief_cn || '').trim(),
    your_role: String(s.your_role || 'yourself').trim(),
    npc_role: String(s.npc_role || 'a friend').trim(),
    npc_persona: String(s.npc_persona || 'friendly').trim(),
    opening_line: String(s.opening_line || '').trim(),
    target_words: norms, // 以实际传入的词为准，防模型丢词
    // 模型给的不够就补本地节拍，保证每个词都有出场时机
    beats:
      aiBeats.length >= norms.length
        ? aiBeats.slice(0, norms.length + 2)
        : localBeats(norms),
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
            content: GEN_PROMPT(
              words.map((w) => ({
                word: w.word,
                meaningZh: w.meaningZh || '',
                pos: w.pos || '',
              }))
            ),
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

/** 语义场景表：AI 不可用时按词义（中文释义+词形）挑一个贴切场景，而不是万年咖啡馆 */
const SCENE_THEMES = [
  {
    match: ['旅行', '旅游', '机场', '航班', '飞机', '酒店', '预订', '度假', '出差', '行李', '签证', '旅程', '码头', '火车'],
    title: '机场出发 · 错词练习',
    brief: '你在机场准备出发，和地勤核对行程，把生词自然聊进对话。',
    you: 'a traveler checking in for a flight',
    npc: 'the airport staff member',
    persona: 'efficient but friendly',
  },
  {
    match: ['工作', '职业', '面试', '会议', '办公室', '同事', '老板', '简历', '职位', '项目', '升职', '辞职', '加班', '团队', '任务'],
    title: '入职第一课 · 错词练习',
    brief: '你第一天到新部门报到，和负责人当面聊清任务与要求。',
    you: 'a new employee on the first day',
    npc: 'the team lead',
    persona: 'busy, direct but fair',
  },
  {
    match: ['学校', '大学', '学习', '考试', '课程', '作业', '老师', '学生', '课堂', '毕业', '论文', '图书馆', '读书', '笔记'],
    title: '开学第一天 · 错词练习',
    brief: '新学期刚开始，你和同桌/老师聊选课与学习安排。',
    you: 'a student starting a new term',
    npc: 'a friendly classmate',
    persona: 'curious and encouraging',
  },
  {
    match: ['购物', '商店', '买', '卖', '钱', '便宜', '贵', '价格', '打折', '付款', '收银', '结账', '商品'],
    title: '血拼时刻 · 错词练习',
    brief: '你在店里挑东西，和店员讨价还价、结账。',
    you: 'a shopper with a budget',
    npc: 'a shop assistant',
    persona: 'polite but a little pushy',
  },
  {
    match: ['食物', '吃', '喝', '餐厅', '饭店', '菜', '菜单', '点餐', '饿', '味道', '咖啡馆', '早餐', '晚餐'],
    title: '点餐进行时 · 错词练习',
    brief: '你第一次来这家店，和服务员点餐并确认细节。',
    you: 'a customer ordering a meal',
    npc: 'a waiter',
    persona: 'cheerful, wants you to order quickly',
  },
  {
    match: ['健康', '医生', '医院', '生病', '疼痛', '药', '锻炼', '身体', '感冒', '预约', '挂号', '治疗'],
    title: '看医生 · 错词练习',
    brief: '你不舒服去看医生，把症状和习惯讲清楚。',
    you: 'a patient describing symptoms',
    npc: 'the doctor',
    persona: 'calm and reassuring',
  },
  {
    match: ['银行', '账户', '贷款', '信用卡', '存钱', '取钱', '转账', '汇率', '存折'],
    title: '银行办业务 · 错词练习',
    brief: '你在银行窗口办一笔业务，和柜员核对信息。',
    you: 'a customer at the bank counter',
    npc: 'the bank clerk',
    persona: 'formal but patient',
  },
]

/** 本地兜底情景卡：AI 不可用时按词义挑场景（可对话），不再一律咖啡馆 */
export function buildFallbackScenario(words) {
  const norms = words.map((w) => normalizeWord(w?.word))
  const first = norms[0] || 'conversation'
  // 按"词+中文释义"里命中的关键词给每个主题打分
  let best = null
  let bestScore = 0
  for (const t of SCENE_THEMES) {
    let score = 0
    for (const w of words) {
      const text = `${w.word || ''} ${w.meaningZh || ''}`
      if (t.match.some((k) => text.includes(k))) score++
    }
    if (score > bestScore) {
      bestScore = score
      best = t
    }
  }
  const t = best || SCENE_THEMES[0]
  if (!best) {
    // 完全没命中 → 中性"新邻居"场景
    return {
      title: '错词练习小剧场',
      scene_brief_cn: '你刚搬到新城市，一位老住户带你认路，边聊边把生词说出来。',
      your_role: 'someone new in town',
      npc_role: 'a friendly neighbor',
      npc_persona: 'warm and talkative',
      opening_line: `Hi there! You just moved in, right? I noticed you are practicing "${first}" — try to use it naturally while we chat.`,
      target_words: norms,
      beats: norms.map((w) => ({ beat_cn: `自然说出 ${w}`, must_use: w })),
    }
  }
  return {
    title: t.title,
    scene_brief_cn: t.brief,
    your_role: t.you,
    npc_role: t.npc,
    npc_persona: t.persona,
    opening_line: `Hello! Let's take it step by step — and remember to use "${first}" naturally when you answer.`,
    target_words: norms,
    beats: norms.map((w) => ({ beat_cn: `自然说出 ${w}`, must_use: w })),
  }
}

/** 取情景卡：同一组词已生成过 → 直接返回缓存；force=true 强制重生成；AI 失败 → 语义兜底卡（不缓存） */
export async function getOrCreateScenario(words, { force = false } = {}) {
  const key = scenarioGroupKey(words)
  if (force) await deleteScenarioCache(key).catch(() => {})
  else {
    const cached = await getScenarioCache(key)
    if (cached?.payload) return cached.payload
  }
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
