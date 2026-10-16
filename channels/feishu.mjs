// feishu 渠道：飞书机器人 webhook，post 富文本消息。
// 分片上限同为 4096 字节，但按"最终消息体字节数"（含 title 与 post 富文本包裹）
// 计量：在段落粒度上贪心打包，保证每个 POST 的 content JSON ≤ 4096 字节。
// 分片前先把 \r\n 归一化为 \n（段落切分只认 LF 空行）。

export async function send(cfg, reportText, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch
  // 与 smtp 对称：单次请求 30s 超时（opts.timeoutMs 可注入），防止网络黑洞挂死定时任务
  const timeoutMs = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 30000
  const text = reportText.replace(/\r\n/g, '\n')
  const title = text.split('\n', 1)[0].trim() || '工作日报'
  for (const seg of splitByPayload(text, title)) {
    const body = {
      msg_type: 'post',
      content: { post: { zh_cn: { title, content: seg.split(/\n{2,}/).map((p) => [{ tag: 'text', text: p }]) } } },
    }
    const res = await fetchImpl(cfg.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) throw new Error('feishu HTTP ' + res.status)
    // 飞书签名失败等错误以 HTTP 200 + body code 字段返回（如 19021），必须查 body 错误码
    const data = await res.json()
    const code = data.code ?? data.StatusCode
    if (code !== 0) throw new Error('feishu code ' + code + (data.msg ? '：' + data.msg : ''))
  }
}

// 按最终 content JSON 的 UTF-8 字节数打包段落，超过 4096 就开新片。
function splitByPayload(text, title) {
  const paras = text.split(/\n{2,}/)
  const size = (ps) => Buffer.byteLength(
    JSON.stringify({ post: { zh_cn: { title, content: ps.map((p) => [{ tag: 'text', text: p }]) } } }), 'utf8')
  const segs = []
  let cur = []
  for (const p of paras) {
    const cand = [...cur, p]
    if (cur.length && size(cand) > 4096) { segs.push(cur.join('\n\n')); cur = [p] } else cur = cand
  }
  if (cur.length) segs.push(cur.join('\n\n'))
  return segs
}
