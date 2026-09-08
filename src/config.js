// config.js —— 全局唯一配置点
// 硬性要求：模型名「写死在配置文件」，改动只允许发生在本文件。

/** AI 供应商模型（按需求写死） */
export const MODELS = {
  vision: 'deepseek-v4-flash-vision-exp', // 图片 OCR + 词条提取
  text: 'deepseek-v4-flash', // 归档打标 / 干扰项生成 / 口语陪练
}

/** 直连官方网关（DeepSeek 不带 CORS 头，浏览器直连会被同源策略拦截 —— 见 README） */
export const DEFAULT_BASE_URL = 'https://api.deepseek.com'

export const CHAT_PATH = '/chat/completions'

/** 请求超时：vision 大图/弱网更宽容 */
export const REQUEST_TIMEOUT_MS = 90000

/**
 * 官方计价表（单位：¥ / 百万 tokens），改动只改这里。
 * deepseek-chat 公开价：输入缓存未命中 ¥2 / 缓存命中 ¥0.5 / 输出 ¥8。
 * vision-exp 若官方后续单独计价，覆盖对应行即可；未公布前按文本同价保守估算。
 */
export const PRICING = [
  { model: MODELS.text, input: 2.0, cacheHitInput: 0.5, output: 8.0 },
  { model: MODELS.vision, input: 2.0, cacheHitInput: 0.5, output: 8.0 },
]

/** 查单价；未知模型按文本模型价兜底 */
export function priceOf(model) {
  return (
    PRICING.find((p) => p.model === model) ||
    PRICING.find((p) => p.model === MODELS.text)
  )
}
