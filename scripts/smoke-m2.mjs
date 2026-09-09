// M2 API 层冒烟测试：假 fetch + 假设置，验证 endpoint 切换 / 鉴权 / JSON 加固 / token 记账 / 花费估算。
// 运行：npm run smoke
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { resetDb } from '../src/db/database.js'
import { createApiClient, ApiError, parseJsonContent } from '../src/api/client.js'
import { MODELS } from '../src/config.js'
import { estimateCost, monthStart } from '../src/api/usage.js'
import { usageSince } from '../src/db/repo.js'

async function main() {
  await resetDb()

  // —— endpoint 选择 ——
  const { resolveEndpoint } = await import('../src/api/client.js')
  assert.equal(
    resolveEndpoint({ endpointMode: 'worker', workerUrl: 'https://w.example.dev/' }),
    'https://w.example.dev/chat/completions',
    'worker 模式拼地址'
  )
  assert.equal(
    resolveEndpoint({ endpointMode: 'direct', workerUrl: '' }),
    'https://api.deepseek.com/chat/completions',
    'direct 模式直连官方'
  )
  assert.throws(() => resolveEndpoint({ endpointMode: 'worker', workerUrl: '' }), (e) => e.kind === 'config')
  assert.throws(() => resolveEndpoint({}), (e) => e.kind === 'config')

  // —— JSON 围栏剥离 ——
  assert.deepEqual(parseJsonContent('```json\n{"ok":1}\n```'), { ok: 1 })
  assert.deepEqual(parseJsonContent('{"ok":2}'), { ok: 2 })

  // —— 假 fetch：校验 URL/头/请求体，返回带 usage 的响应 ——
  let captured
  const okFetch = async (url, init) => {
    captured = { url, init }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: '```json\n{"words":[{"word":"hello"}]}\n```' } }],
        usage: { prompt_tokens: 100, prompt_cache_hit_tokens: 40, completion_tokens: 30 },
      }),
    }
  }

  const client = createApiClient({
    settings: () => ({ endpointMode: 'worker', workerUrl: 'https://w.example.dev', apiKey: 'sk-test' }),
    fetchFn: okFetch,
  })

  const { parsed, content } = await client.complete({
    model: MODELS.text,
    messages: [{ role: 'user', content: 'hi' }],
    json: true,
    task: 'ocr',
    maxTokens: 500,
  })
  assert.equal(captured.url, 'https://w.example.dev/chat/completions')
  assert.equal(captured.init.headers.Authorization, 'Bearer sk-test')
  const body = JSON.parse(captured.init.body)
  assert.deepEqual(body.response_format, { type: 'json_object' }, 'response_format=json_object')
  assert.equal(body.max_tokens, 500)
  assert.deepEqual(body.thinking, { type: 'disabled' }, '文本调用默认关闭思考链')
  assert.equal(parsed.words[0].word, 'hello')

  // —— token 记账：hit=40, miss=60 ——
  const rows = await usageSince(0)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].promptTokens, 60, 'miss=prompt_total-hit')
  assert.equal(rows[0].cacheHitTokens, 40)
  assert.equal(rows[0].completionTokens, 30)

  // —— 花费估算（deepseek 价：input2 / hit0.5 / out8，单位 ¥/1M）——
  const est = estimateCost(rows)
  const expect = (60 * 2 + 40 * 0.5 + 30 * 8) / 1e6
  assert.ok(Math.abs(est.totalYuan - expect) < 1e-9, `估算=${est.totalYuan} 期望=${expect}`)
  assert.equal(est.breakdown.length, 1)
  assert.equal(est.breakdown[0].model, MODELS.text)

  // —— 错误语义化 ——
  const errClient = createApiClient({
    settings: () => ({ endpointMode: 'direct', apiKey: 'sk-x' }),
    fetchFn: async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'Authentication Fails' } }),
    }),
  })
  await assert.rejects(errClient.complete({ messages: [] }), (e) => e.kind === 'auth' && /Authentication/.test(e.message))

  // 404 → model（R1：模型不存在提示）
  const notFound = createApiClient({
    settings: () => ({ endpointMode: 'direct', apiKey: 'sk-x' }),
    fetchFn: async () => ({ ok: false, status: 404, json: async () => ({ error: { message: 'Model Not Found' } }) }),
  })
  await assert.rejects(notFound.complete({ messages: [] }), (e) => e.kind === 'model')

  // 无 key → auth
  const noKey = createApiClient({ settings: () => ({ endpointMode: 'direct', apiKey: '' }) })
  await assert.rejects(noKey.complete({ messages: [] }), (e) => e.kind === 'auth' && /API Key/.test(e.message))

  // —— thinking 不支持(400)时自动去掉该参数重试一次 ——
  let calls = 0
  const retryClient = createApiClient({
    settings: () => ({ endpointMode: 'direct', apiKey: 'sk-x' }),
    fetchFn: async (url, init) => {
      calls++
      if (calls === 1) return { ok: false, status: 400, json: async () => ({ error: { message: 'unknown param thinking' } }) }
      const b = JSON.parse(init.body)
      assert.equal(b.thinking, undefined, '第二次请求不带 thinking')
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: '{"ok":1}' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
      }
    },
  })
  await retryClient.complete({ messages: [], json: true, task: 'ocr', hint: 'x' })
  assert.equal(calls, 2, '400 后应重试一次')

  console.log('✅ M2 smoke: API 层全部断言通过')
}

main().catch((e) => {
  console.error('❌ M2 smoke 失败:', e)
  process.exit(1)
})
