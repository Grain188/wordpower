// lib/scenarioIntent.js —— 跨页意图：生词本多选 → 「用它们编个情景聊聊」→ 听说页接收
let pendingWords = null

export function setScenarioWords(words) {
  pendingWords = words || null
}

/** 听说页挂载时消费一次 */
export function takeScenarioWords() {
  const p = pendingWords
  pendingWords = null
  return p
}
