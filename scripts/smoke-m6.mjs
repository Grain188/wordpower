// M6 冒烟：Boss 战本地选项构造器（buildLocalOptions）纯逻辑验证
import assert from 'node:assert/strict'
import { buildLocalOptions } from '../src/api/distractors.js'

const pool = [
  { wordNorm: 'banana', meaningZh: '香蕉', pos: 'n.' },
  { wordNorm: 'cherry', meaningZh: '樱桃', pos: 'n.' },
  { wordNorm: 'grape', meaningZh: '葡萄', pos: 'n.' },
  { wordNorm: 'happy', meaningZh: '快乐的', pos: 'adj.' },
  { wordNorm: 'quick', meaningZh: '迅速的', pos: 'adj.' },
]

const target = { wordNorm: 'apple', meaningZh: '苹果', pos: 'n.' }
const opts = buildLocalOptions(target, pool)
assert.ok(opts, '词库足够应返回选项')
assert.equal(opts.length, 4, '默认 4 个选项')
assert.equal(opts.filter((o) => o.correct).length, 1, '恰好 1 个正确项')
assert.equal(new Set(opts.map((o) => o.text)).size, 4, '选项文本不重复')
assert.ok(opts.every((o) => o.text !== '苹果' || o.correct), '正确项文本=苹果')

// 只有 2 个干扰项 → 3 选项题仍可玩
const small = pool.slice(0, 2)
const three = buildLocalOptions(target, small)
assert.ok(three, '2 干扰项可出 3 选项题')
assert.equal(three.length, 3)
assert.equal(three.filter((o) => o.correct).length, 1)

// 干扰项 <2 → null（Boss 会提示先导入更多词）
const one = [pool[0]]
assert.equal(buildLocalOptions(target, one), null)

console.log('✅ M6 smoke: 选项构造器断言通过')
