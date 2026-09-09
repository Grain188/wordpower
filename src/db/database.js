import Dexie from 'dexie'

/**
 * IndexedDB 库（Dexie v4）。
 * 建表策略：只索引查询路径；体积大的字段（fsrs 快照、rounds）整存 JSON。
 */
export const db = new Dexie('wordpower')

db.version(1).stores({
  // 词条：wordNorm 唯一（本地去重键）。
  // 注意：known 不进复合索引——Dexie 复合范围是字典序，[0,0]~[end,0] 挡不住
  // "due<end 但 known=1" 的行，会漏过滤；到期查询用 due 单索引 + JS 层过滤 known。
  words:
    '++id, &wordNorm, cefr, theme, pos, source, known, due, createdAt',
  // 干扰项/例句缓存：答错词才 API 生成，答对词本地抽词（省 token ②）
  distractors: '&word, dueDate',
  // 打卡：&date = 'YYYY-MM-DD'
  checkins: '&date',
  // 复习/口语评分明细：热力日历 + 口语加权依据
  reviews: '++id, wordId, date, mode',
  // 口语对话记录
  chat_sessions: '++id, startedAt, scene',
  // API token 记账（本月花费估算）
  usage: '++id, ts, task, model',
})

// v2：情景对话 —— 情景卡缓存（同一组词不重复生成，省 token）
db.version(2).stores({
  words: '++id, &wordNorm, cefr, theme, pos, source, known, due, createdAt',
  distractors: '&word, dueDate',
  checkins: '&date',
  reviews: '++id, wordId, date, mode',
  chat_sessions: '++id, startedAt, scene',
  usage: '++id, ts, task, model',
  scenarioCache: '&groupKey, createdAt',
})

export async function resetDb() {
  await db.delete()
  await db.open()
}
