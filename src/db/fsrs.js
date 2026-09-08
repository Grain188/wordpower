// ts-fsrs v5 封装：单词的 fsrs 状态以可序列化纯对象存进 words.fsrs，
// 这里做 Date ↔ number 转换与单一入口（所有评分都走 f.next 单档接口）。

import { fsrs, createEmptyCard, Rating, State } from 'ts-fsrs'

// 评分常量（对外语义化命名；值 = ts-fsrs Rating）
export const AGAIN = Rating.Again // 1
export const HARD = Rating.Hard // 2
export const GOOD = Rating.Good // 3
export const EASY = Rating.Easy // 4

// 状态常量（值 = ts-fsrs State）
export const NEW = State.New // 0
export const LEARNING = State.Learning // 1
export const REVIEW = State.Review // 2
export const RELEARNING = State.Relearning // 3

export const RATING_LABEL = { 1: '再学', 2: '困难', 3: '良好', 4: '简单' }
export const RATING_BUTTONS = [
  { rating: AGAIN, label: '重来', color: 'red' },
  { rating: HARD, label: '困难', color: 'yellow' },
  { rating: GOOD, label: '良好', color: 'blue' },
  { rating: EASY, label: '简单', color: 'green' },
]

// 算法参数：个人学习，采用默认（request_retention 0.9 / 不启用 fuzz）。
// 若日后想自定义记忆保留率，传 generatorParameters 到这里即可。
const f = fsrs()

/** 新词的初始排期（due=now，state=New，等首次学习） */
export function emptyFsrs(now = Date.now()) {
  return serializeCard(createEmptyCard(new Date(now)))
}

/** 按评分推进排期，返回新状态（纯对象） */
export function schedule(fsrsState, grade, now = Date.now()) {
  const { card } = f.next(deserializeCard(fsrsState), new Date(now), grade)
  return serializeCard(card)
}

/** 当前记忆可提取率 0..1（页面「快到期」提示用） */
export function retrievability(fsrsState, now = Date.now()) {
  if (!fsrsState || fsrsState.reps === 0) return 1
  return f.get_retrievability(deserializeCard(fsrsState), new Date(now))
}

/**
 * 口语加权：成功用出目标词视为强记忆证据，评分至少提到 Good（3）。
 * 策略注释：口语产出比"看到再认"更难，命中即按 Good 起步，不越级到 Easy。
 */
export function speakingGrade(current) {
  return Math.max(current || AGAIN, GOOD)
}

// —— 序列化适配（Card.due/last_review 是 Date → 存 ms 数字）——
export function serializeCard(card) {
  return {
    due: +card.due,
    last_review: card.last_review ? +card.last_review : null,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
  }
}

export function deserializeCard(s) {
  return {
    ...s,
    due: new Date(s.due),
    last_review: s.last_review ? new Date(s.last_review) : undefined,
  }
}

export function serializeLog(log) {
  return {
    rating: log.rating,
    state: log.state,
    due: +log.due,
    stability: log.stability,
    difficulty: log.difficulty,
    elapsed_days: log.elapsed_days,
    scheduled_days: log.scheduled_days,
    review: +log.review,
  }
}
