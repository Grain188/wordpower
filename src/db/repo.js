// 领域仓储：词条 / 复习 / 打卡 / usage / 干扰项 的读写入口。
// 页面组件只依赖本文件 + fsrs.js + lib/*，不直接碰 Dexie 表。

import { db } from './database.js'
import { emptyFsrs, schedule, speakingGrade, REVIEW } from './fsrs.js'
import { normalizeWord, isPlausibleWord, validCefr, validTheme } from '../lib/words.js'
import { dateKey, todayKey, endOfDay } from '../lib/dates.js'

const NOW = () => Date.now()

/* ============================================================
   词条
   ============================================================ */

/**
 * 批量导入（拍照 vision / 粘贴文本 共用，M3）。
 * 规则：
 *  - 本地去重：同 wordNorm 已存在 → duplicated（不写库、不调 API）；
 *  - 乱码/非拉丁过滤 → rejected（E3：少浪费一次 API）；
 *  - 新词以 ts-fsrs 空卡初始化排期（due=now）。
 * 返回 { added, duplicated, rejected }
 */
export async function importWords(entries, { source = 'photo' } = {}) {
  const added = []
  const duplicated = []
  const rejected = []
  const now = NOW()

  for (const raw of entries || []) {
    const word = String(raw?.word || '').trim()
    const norm = normalizeWord(word)
    if (!word || !isPlausibleWord(word)) {
      rejected.push({ word, reason: 'invalid' })
      continue
    }
    const existing = await db.words.where('wordNorm').equals(norm).first()
    if (existing) {
      duplicated.push({ wordNorm: norm, word, existingId: existing.id })
      continue
    }
    const rec = {
      wordNorm: norm,
      word,
      phonetic: String(raw.phonetic || '').trim(),
      pos: String(raw.pos || '').trim(),
      meaningZh: String(raw.meaningZh || raw.meaning || '').trim(),
      cefr: validCefr(raw.cefr),
      theme: validTheme(raw.theme || raw.theme_id),
      example: String(raw.example_sentence || raw.example || '').trim(),
      source,
      known: 0, // 导入确认里标「已掌握」的词不入库（跳过），这里只收学习中的词
      due: now,
      fsrs: emptyFsrs(now),
      lastReviewAt: null,
      createdAt: now,
      updatedAt: now,
    }
    const id = await db.words.add(rec)
    added.push({ ...rec, id })
  }
  return { added, duplicated, rejected }
}

export async function getWord(id) {
  return db.words.get(id)
}

/** D3：编辑词条静态信息（不改 fsrs 排期） */
export async function updateWordInfo(id, patch) {
  const clean = {}
  if (patch.word !== undefined) clean.word = patch.word
  if (patch.phonetic !== undefined) clean.phonetic = patch.phonetic
  if (patch.pos !== undefined) clean.pos = patch.pos
  if (patch.meaningZh !== undefined) clean.meaningZh = patch.meaningZh
  if (patch.cefr !== undefined) clean.cefr = validCefr(patch.cefr)
  if (patch.theme !== undefined) clean.theme = validTheme(patch.theme)
  if (patch.example !== undefined) clean.example = patch.example
  if (Object.keys(clean).length === 0) return null
  clean.updatedAt = NOW()
  await db.words.update(id, clean)
  return db.words.get(id)
}

/** 标熟 / 回退（known=1 不再进复习队列；回退=0 重新排入） */
export async function setKnown(id, known) {
  await db.words.update(id, { known: known ? 1 : 0, updatedAt: NOW() })
  return db.words.get(id)
}

export async function deleteWord(id) {
  await db.transaction('rw', db.words, db.reviews, async () => {
    await db.words.delete(id)
    await db.reviews.where('wordId').equals(id).delete()
  })
}

/** 复习队列：due <= 今日末 且未掌握。order: due asc（先到期先练） */
export async function dueWords({ limit } = {}) {
  const end = endOfDay().getTime()
  const rows = await db.words.where('due').belowOrEqual(end).toArray()
  const due = rows
    .filter((w) => !w.known)
    // 默认顺序：先到期、同类内"单词优先于词组"（词组靠后，复习/Boss/口语选词一致）
    .sort((a, b) => {
      const ka = /\s/.test(a.wordNorm || a.word || '') ? 1 : 0
      const kb = /\s/.test(b.wordNorm || b.word || '') ? 1 : 0
      return ka - kb || a.due - b.due
    })
  return typeof limit === 'number' ? due.slice(0, limit) : due
}

export async function countDueToday() {
  const end = endOfDay().getTime()
  const rows = await db.words.where('due').belowOrEqual(end).toArray()
  return rows.reduce((n, w) => (w.known ? n : n + 1), 0)
}

export async function allWords() {
  return db.words.orderBy('wordNorm').toArray()
}

/** 统计：总词 / 今日到期 / 已掌握 / 掌握率 */
export async function getStats() {
  const total = await db.words.count()
  const knownCount = await db.words.where('known').equals(1).count()
  const dueToday = await countDueToday()
  // 掌握口径（单一，注释清楚）：
  //   手动标熟(known=1) 或 FSRS 进入 Review 且本次排期 >=21 天（稳定长时记忆）
  let mastered = knownCount
  if (total > knownCount) {
    const actives = await db.words.where('known').equals(0).toArray()
    mastered += actives.filter(
      (w) => w.fsrs && w.fsrs.state === REVIEW && (w.fsrs.scheduled_days || 0) >= 21
    ).length
  }
  return {
    total,
    knownCount,
    dueToday,
    mastered,
    masteryRate: total ? Math.round((mastered / total) * 100) : 0,
  }
}

/* ============================================================
   复习 + 打卡
   ============================================================ */

/**
 * 记录一次评分复习（boss / 翻卡后考 / speaking 直录）。
 * fsrsBefore 快照保存进 reviews 行 —— 口语加权需要从"今天的复习前状态"重排。
 * 打卡口径（A1 修正）：wordsReviewed 按「当天该词的首次评分」+1 —— 同一单词同一天的
 * 巩固重练（FSRS relearning 步骤本来就该在同一天多次练）不再重复计数，热力/圆环不虚增。
 */
export async function recordReview(wordId, grade, mode = 'review') {
  const day = todayKey()
  let updated = null
  await db.transaction('rw', db.words, db.reviews, db.checkins, async () => {
    const word = await db.words.get(wordId)
    if (!word) return
    const firstToday =
      (await db.reviews.where('date').equals(day).and((r) => r.wordId === wordId).count()) === 0
    const before = word.fsrs
    const next = schedule(before, grade)
    await db.words.update(wordId, {
      fsrs: next,
      due: next.due,
      lastReviewAt: NOW(),
      updatedAt: NOW(),
    })
    await db.reviews.add({
      wordId,
      wordNorm: word.wordNorm,
      date: day,
      ts: NOW(),
      mode,
      rating: grade,
      fsrsBefore: before,
    })
    if (firstToday) await bumpCheckin(day, { wordsReviewed: 1 })
    updated = { ...word, fsrs: next, due: next.due, lastReviewAt: NOW() }
  })
  return updated
}

/**
 * 口语命中加权（A4）：
 *  - 今天已有评分（boss/review）→ 若 <Good，用 fsrsBefore 以 Good 重排并改写该行（不重复加行/不重复打卡）；
 *  - 今天还没有评分 且 该词已到期 → 直接按 Good 记一条 speaking 评分；
 *  - 未到期 → 只记 spokenHits 打卡，不改排期（避免"预习"污染算法）。
 * 返回 { action, rating }：'upgraded' | 'recorded' | 'hit-only' | 'noop'
 */
export async function recordSpeakingHit(wordId) {
  const day = todayKey()
  const word = await db.words.get(wordId)
  if (!word) return { action: 'noop', rating: null }
  const todayRows = await db.reviews
    .where('date')
    .equals(day)
    .filter((r) => r.wordId === wordId && r.mode !== 'speaking')
    .toArray()

  // 兜底打卡（无论哪种分支，口语成功都算"开口练习"）
  await bumpCheckin(day, { spokenHits: 1 })

  if (todayRows.length) {
    const best = Math.max(...todayRows.map((r) => r.rating))
    if (best >= speakingGrade(1)) return { action: 'noop', rating: best } // 已 Good+，无需再改
    // 从"今天的复习前状态"以 Good 重排
    const base = todayRows.sort((a, b) => a.ts - b.ts)[0]
    const next = schedule(base.fsrsBefore, speakingGrade(1))
    await db.transaction('rw', db.words, db.reviews, async () => {
      await db.words.update(wordId, { fsrs: next, due: next.due, lastReviewAt: NOW(), updatedAt: NOW() })
      await db.reviews.update(base.id, {
        rating: speakingGrade(1),
        upgradedBy: 'speaking',
        ts: NOW(),
      })
    })
    return { action: 'upgraded', rating: speakingGrade(1) }
  }

  if (word.due <= NOW() && !word.known) {
    await recordReview(wordId, speakingGrade(1), 'speaking')
    return { action: 'recorded', rating: speakingGrade(1) }
  }
  return { action: 'hit-only', rating: null }
}

/* ============================================================
   打卡 / streak
   ============================================================ */

async function bumpCheckin(date, delta = {}) {
  const row = (await db.checkins.where('date').equals(date).first()) || {
    date,
    wordsReviewed: 0,
    spokenHits: 0,
    bossWon: 0,
  }
  for (const [k, v] of Object.entries(delta)) row[k] = (row[k] || 0) + v
  await db.checkins.put(row)
  return row
}

export { bumpCheckin }

/** 连续打卡天数：从今天（今天还没打卡则从昨天）向前数连续有打卡的天数 */
export async function getStreak() {
  const keys = await db.checkins.orderBy('date').keys()
  const set = new Set(keys)
  let cursor = new Date()
  if (!set.has(dateKey(cursor))) cursor.setDate(cursor.getDate() - 1) // 今天未打卡不算断
  let streak = 0
  while (set.has(dateKey(cursor))) {
    streak++
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

export async function checkinOf(date) {
  return db.checkins.where('date').equals(date).first()
}

export async function allCheckins() {
  return db.checkins.toArray()
}

/** 近 N 天打卡情况（热力日历喂数据用） */
export async function checkinsSince(daysAgo) {
  const from = new Date()
  from.setDate(from.getDate() - daysAgo)
  const fromKey = dateKey(from)
  const rows = await db.checkins.toArray()
  return rows.filter((r) => r.date >= fromKey)
}

/* ============================================================
   干扰项缓存（答错词 → API 批量生成的明日题）
   ============================================================ */

export async function saveDistractors(wordNorm, { dueDate, options, example }) {
  await db.distractors.put({
    word: wordNorm,
    dueDate,
    options,
    example: example || '',
    updatedAt: NOW(),
  })
}

export async function getDistractors(wordNorm) {
  return db.distractors.where('word').equals(wordNorm).first()
}

export async function clearDistractors() {
  return db.distractors.clear()
}

/* ============================================================
   最近导入标记（生词本 chip 逐个弹入动画的数据源）
   ============================================================ */
let recentImported = []
export function noteImported(ids) {
  recentImported = [...ids]
}
export function takeRecentImported() {
  const r = recentImported
  recentImported = []
  return r
}

/* ============================================================
   API usage 记账
   ============================================================ */

/** task: 'ocr' | 'annotate' | 'distractor' | 'chat' | 'summary' */
export async function recordUsage({ task, model, promptTokens = 0, cacheHitTokens = 0, completionTokens = 0 }) {
  return db.usage.add({
    ts: NOW(),
    task,
    model,
    promptTokens: Math.max(0, Math.round(promptTokens)),
    cacheHitTokens: Math.max(0, Math.round(cacheHitTokens)),
    completionTokens: Math.max(0, Math.round(completionTokens)),
  })
}

/** 本月累计 token（按月切分文件桶防止单表过大，估算面板直接聚合） */
export async function usageSince(sinceMs) {
  const rows = await db.usage.where('ts').aboveOrEqual(sinceMs).toArray()
  return rows
}

/* ============================================================
   口语对话记录（回合制整场保存；热力日历只读 checkins）
   ============================================================ */

/**
 * 保存一场口语会话。
 * record: { scene, targetWordIds, summary?, rounds:[{role:'user'|'ai', content, zh?, used?}],
 *           stats:{rounds, usedCount, targetCount, feedback?}, doneAt }
 */
export async function saveChatSession(record) {
  return db.chat_sessions.add({
    ...record,
    startedAt: record.startedAt || Date.now(),
    createdAt: Date.now(),
  })
}

export async function recentChatSessions(limit = 20) {
  const rows = await db.chat_sessions.orderBy('startedAt').reverse().limit(limit).toArray()
  return rows
}

/* ============================================================
   情景对话（错词编剧情）：今日错词 / 按词组缓存情景卡
   ============================================================ */

/** 今天的错词（boss 评分 AGAIN 的词）→ 词记录数组（自动入口的"今日情景"取 3-5 个） */
export async function todayWrongWords() {
  const rows = await db.reviews
    .where('date')
    .equals(todayKey())
    .filter((r) => r.rating === 1)
    .toArray()
  const ids = [...new Set(rows.map((r) => r.wordId))]
  if (!ids.length) return []
  const words = await db.words.bulkGet(ids)
  return words.filter((w) => w && !w.known)
}

/** 按 id 取词（生词本多选 → 编情景） */
export async function wordsByIds(ids) {
  if (!ids?.length) return []
  const words = await db.words.bulkGet(ids)
  return words.filter(Boolean)
}

export async function getScenarioCache(groupKey) {
  return db.scenarioCache.where('groupKey').equals(groupKey).first()
}

export async function deleteScenarioCache(groupKey) {
  return db.scenarioCache.where('groupKey').equals(groupKey).delete()
}

export async function putScenarioCache(groupKey, payload) {
  await db.scenarioCache.put({ groupKey, payload, createdAt: Date.now() })
  return payload
}

/* ============================================================
   JSON 备份（E2）：全量导出/导入。导入用 bulkPut 保留原主键，
   使 reviews.wordId / chat_sessions.targetWordIds 的关联不断裂。
   ============================================================ */

export const BACKUP_TABLES = ['words', 'checkins', 'reviews', 'distractors', 'chat_sessions', 'usage', 'scenarioCache']

export async function exportSnapshot() {
  const out = {}
  for (const t of BACKUP_TABLES) out[t] = await db.table(t).toArray()
  return {
    app: 'wordpower',
    version: 1,
    exportedAt: new Date().toISOString(),
    tables: out,
  }
}

/** @returns {{ok:boolean, counts:Object<string,number>}} */
export async function importSnapshot(data) {
  const t = data?.tables
  if (!data || data.app !== 'wordpower' || !t) throw new Error('不是有效的词力备份文件')
  const counts = {}
  await db.transaction('rw', ...BACKUP_TABLES.map((n) => db.table(n)), async () => {
    for (const name of BACKUP_TABLES) {
      const rows = Array.isArray(t[name]) ? t[name] : []
      await db.table(name).clear()
      if (rows.length) await db.table(name).bulkPut(rows)
      counts[name] = rows.length
    }
  })
  return { ok: true, counts }
}
