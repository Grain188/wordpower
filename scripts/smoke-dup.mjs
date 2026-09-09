// 相似词扫描冒烟（findDupGroups 纯函数）
import assert from 'node:assert/strict'
import { findDupGroups, corePhrase } from '../src/lib/words.js'

assert.equal(corePhrase('a course of action'), 'course of action', '去首冠词')
assert.equal(corePhrase('the best time'), 'best time')

const words = [
  { id: 1, word: 'a course of action', wordNorm: 'a course of action', meaningZh: '行动方案' },
  { id: 2, word: 'a losing course of action', wordNorm: 'a losing course of action', meaningZh: '注定失败的行动方案' },
  { id: 3, word: 'look up', wordNorm: 'look up', meaningZh: '查找' },
  { id: 4, word: 'lookup', wordNorm: 'lookup', meaningZh: '查找' },
  { id: 5, word: 'banana', wordNorm: 'banana', meaningZh: '香蕉' },
]
const groups = findDupGroups(words)
assert.equal(groups.length, 2, '应找到 2 组')
const flat = groups.map((g) => g.map((w) => w.id).sort()).sort((a, b) => a[0] - b[0])
assert.deepEqual(flat[0], [1, 2], '核心词组互相包含成组')
assert.deepEqual(flat[1], [3, 4], '中文释义相同成组')
assert.ok(!groups.some((g) => g.some((w) => w.id === 5)), 'banana 不应入组')

console.log('✅ dup smoke: 相似扫描断言通过')
