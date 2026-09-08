// M8 冒烟：JSON 备份导出→清库→导入 回环，验证主键保留使 reviews.wordId 关联不丢
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { resetDb } from '../src/db/database.js'
import * as repo from '../src/db/repo.js'
import { GOOD } from '../src/db/fsrs.js'

async function main() {
  await resetDb()

  const { added } = await repo.importWords([
    { word: 'apple', meaningZh: '苹果', pos: 'n.', cefr: 'A1' },
    { word: 'banana', meaningZh: '香蕉', pos: 'n.' },
  ])
  await repo.recordReview(added[0].id, GOOD, 'boss')
  await repo.saveDistractors('apple', { dueDate: '2099-01-01', options: [{ text: 'a', correct: true }] })

  const snap = await repo.exportSnapshot()
  assert.equal(snap.tables.words.length, 2)
  assert.equal(snap.tables.reviews.length, 1)

  await resetDb() // 清库
  assert.equal(await repo.getStats().then((s) => s.total), 0)

  const { counts } = await repo.importSnapshot(snap)
  assert.equal(counts.words, 2)
  assert.equal(counts.reviews, 1)

  // 主键保留：review.wordId 能指回 words 表里的词
  const words = await repo.allWords()
  const reviews = snap.tables.reviews
  for (const r of reviews) {
    assert.ok(words.some((w) => w.id === r.wordId), '复习记录关联的词存在')
  }
  assert.equal((await repo.getDistractors('apple')).options.length, 1)

  // 非法文件被拒
  await assert.rejects(repo.importSnapshot({ foo: 1 }))

  console.log('✅ M8 smoke: 备份回环断言通过')
}

main().catch((e) => {
  console.error('❌ M8 smoke 失败:', e)
  process.exit(1)
})
