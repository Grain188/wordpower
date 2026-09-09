// 情景对话冒烟：语义兜底场景选择（不再万年咖啡馆）+ 词表 key 稳定
import assert from 'node:assert/strict'
import { buildFallbackScenario, scenarioGroupKey } from '../src/api/scenario.js'

const travel = buildFallbackScenario([{ word: 'boarding', meaningZh: '登机' }, { word: 'luggage', meaningZh: '行李' }])
assert.ok(travel.title.includes('机场'), '旅行词 → 机场场景')
assert.ok(!travel.scene_brief_cn.includes('咖啡馆'), '不再拿咖啡馆凑数')

const work = buildFallbackScenario([{ word: 'interview', meaningZh: '面试' }, { word: 'deadline', meaningZh: '截止日期' }])
assert.ok(work.title.includes('入职'), '工作词 → 职场场景')

const generic = buildFallbackScenario([{ word: 'zephyr', meaningZh: '和风' }, { word: 'epoch', meaningZh: '时代' }])
assert.ok(!generic.scene_brief_cn.includes('机场') && !generic.scene_brief_cn.includes('入职'), '无关词 → 中性新邻居场景')

assert.equal(scenarioGroupKey([{ word: 'apple' }, { word: 'banana' }]), 'apple,banana', 'key 与顺序无关')

console.log('✅ scenario smoke: 语义兜底场景断言通过')
