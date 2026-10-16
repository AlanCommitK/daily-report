// LLM 客户端（零依赖，仅用内置 fetch）：OpenAI 兼容与 Anthropic 兼容双协议。
// 失败自动重试 2 次（间隔默认 2s/4s，opts.retryDelays 可注入），全败抛最后一次错误。
// 密钥只从环境变量读取（cfg.api_key_env 指定变量名）。

export const PROVIDERS = {
  deepseek: { openai: 'https://api.deepseek.com/v1', anthropic: 'https://api.deepseek.com/anthropic' },
  openai: { openai: 'https://api.openai.com/v1' },
  anthropic: { anthropic: 'https://api.anthropic.com' },
  qwen: { openai: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  glm: { openai: 'https://open.bigmodel.cn/api/paas/v4' },
}

export async function chat(cfg, system, user, opts = {}) {
  const key = process.env[cfg.api_key_env] || ''
  if (!key) throw new Error(`环境变量 ${cfg.api_key_env} 未设置`)
  const fetchImpl = opts.fetchImpl || globalThis.fetch
  const base = String(cfg.base_url).replace(/\/+$/, '')
  let lastErr
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (cfg.protocol === 'anthropic') {
        const res = await fetchImpl(base + '/v1/messages', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: cfg.model, max_tokens: 4096, system, messages: [{ role: 'user', content: user }] }),
        })
        if (!res.ok) throw new Error('HTTP ' + res.status)
        const j = await res.json()
        return (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('')
      }
      const res = await fetchImpl(base + '/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
        body: JSON.stringify({ model: cfg.model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const j = await res.json()
      return j.choices?.[0]?.message?.content || ''
    } catch (e) {
      lastErr = e
      if (attempt < 2) await new Promise((r) => setTimeout(r, (opts.retryDelays || [2000, 4000])[attempt]))
    }
  }
  throw lastErr
}
