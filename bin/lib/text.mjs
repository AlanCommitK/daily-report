// 文本工具：截断与按空行分片（分片按 UTF-8 字节数衡量，供通知渠道分段用）。

export function limit(t, n) {
  if (t == null) return ''
  if (t.length <= n) return t
  return t.slice(0, n) + '…[截断]'
}

export function splitByBlankLines(t, maxBytes) {
  const paras = t.split(/\n{2,}/)
  const parts = []
  let cur = ''
  for (const p of paras) {
    const cand = cur ? cur + '\n\n' + p : p
    if (Buffer.byteLength(cand, 'utf8') <= maxBytes || !cur) { cur = cand; continue }
    parts.push(cur); cur = p
  }
  if (cur) parts.push(cur)
  return parts
}
