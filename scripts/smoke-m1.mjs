// M1 数据层冒烟测试：真实 IndexedDB（fake-indexeddb）跑通 建库→导入→去重→复习→口语加权→打卡→干扰项→usage。
// 运行：npm run smoke
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { db, resetDb } from '../src/db/database.js'
import * as repo from '../src/db/repo.js'
import { GOOD, HARD } from '../src/db/fsrs.js'
import { todayKey } from '../src/lib/dates.js'

async function main() {
  await resetDb()

  // —— 导入：正常词入库、重复词去重、乱码过滤（E3）——
  const r1 = await repo.importWords(
    [
      { word: 'Apple', phonetic: '/ˈæp.əl/', pos: 'n.', meaningZh: '苹果', cefr: 'A1', theme: 'daily', example_sentence: 'An apple a day.' },
      { word: '  banana ', meaningZh: '香蕉', pos: 'n.', cefr: 'A1' },
      { word: '苹果', meaningZh: '中文行应被滤掉' },
      { word: 'apple2', meaningZh: '含数字应被滤掉' },
    ],
    { source: 'photo' }
  )
  assert.equal(r1.added.length, 2, '正常词应入库')
  assert.equal(r1.rejected.length, 2, '乱码/非拉丁应被滤掉')
  const r2 = await repo.importWords([{ word: 'apple' }], { source: 'paste' })
  assert.equal(r2.duplicated.length, 1, '同词去重（apple 已存在）')
  assert.equal((await repo.getStats()).total, 2, '总词数=2')

  // —— 今日到期 ——
  assert.equal((await repo.dueWords()).length, 2, '两个新词都到期')
  assert.equal(await repo.countDueToday(), 2)

  const apple = r1.added.find((a) => a.wordNorm === 'apple')
  const banana = r1.added.find((a) => a.wordNorm === 'banana')

  // —— 复习评分（Boss 先学后考落库）——
  const up = await repo.recordReview(apple.id, GOOD, 'boss')
  assert.ok(up.fsrs.reps === 1 && up.fsrs.state !== 0, 'Good 评分推进排期')
  const rows = await db.reviews.toArray()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].rating, GOOD)

  // —— 口语加权：今天评了 Hard 的词，口语命中 → upgraded（从 fsrsBefore 以 Good 重排）——
  await repo.recordReview(banana.id, HARD, 'boss')
  const spokenBanana = await repo.recordSpeakingHit(banana.id)
  assert.equal(spokenBanana.action, 'upgraded')
  const bananaRows = (await db.reviews.toArray()).filter((r) => r.wordId === banana.id)
  assert.equal(bananaRows.length, 1, '升级不重复加行')
  assert.equal(bananaRows[0].rating, GOOD)
  assert.equal(bananaRows[0].upgradedBy, 'speaking')

  // —— 口语：今日未评分且到期的词 → 直接记 Good speaking 评分 ——
  const cherry = (await repo.importWords([{ word: 'cherry', meaningZh: '樱桃', pos: 'n.', cefr: 'A2' }])).added[0]
  const sp = await repo.recordSpeakingHit(cherry.id)
  assert.equal(sp.action, 'recorded')

  // —— 打卡：wordsReviewed=3（apple+banana+cherry），spokenHits=2 ——
  const today = await repo.checkinOf(todayKey())
  assert.equal(today.wordsReviewed, 3)
  assert.equal(today.spokenHits, 2)
  assert.equal(await repo.getStreak(), 1, '今天有打卡 → streak=1')

  // —— 干扰项缓存 ——
  await repo.saveDistractors('cherry', {
    dueDate: todayKey(),
    options: [{ text: '樱桃', correct: true, origin: 'api' }],
    example: 'The cherry is sweet.',
  })
  assert.equal((await repo.getDistractors('cherry')).options.length, 1)

  // —— usage 记账 ——
  await repo.recordUsage({ task: 'ocr', model: 'deepseek-v4-flash-vision-exp', promptTokens: 100, completionTokens: 50 })
  const usages = await repo.usageSince(0)
  assert.equal(usages.length, 1)
  assert.equal(usages[0].promptTokens, 100)

  // —— 标熟 / 删除 ——
  await repo.setKnown(cherry.id, 1)
  assert.equal((await repo.getWord(cherry.id)).known, 1)
  assert.equal((await repo.dueWords()).length, 2, 'known 词不进复习队列')
  await repo.deleteWord(apple.id)
  const stats = await repo.getStats()
  assert.equal(stats.total, 2, '删除后 total=2')
  assert.equal(stats.knownCount, 1)

  console.log('✅ M1 smoke: 数据层全部断言通过')
}

main().catch((e) => {
  console.error('❌ M1 smoke 失败:', e)
  process.exit(1)
})
