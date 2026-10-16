// wecom 渠道：企业微信机器人 webhook，markdown 消息，逐片 POST。
// 分片阈值 4096 字节（UTF-8），按空行边界（splitByBlankLines）。
// 分片前先把 \r\n 归一化为 \n（splitByBlankLines 只认 LF 空行，CRLF 文本会整段不切）。

import { splitByBlankLines } from '../bin/lib/text.mjs'

export async function send(cfg, reportText, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch
  const text = reportText.replace(/\r\n/g, '\n')
  for (const seg of splitByBlankLines(text, 4096)) {
    const res = await fetchImpl(cfg.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ msgtype: 'markdown', markdown: { content: seg } }),
    })
    if (!res.ok) throw new Error('wecom HTTP ' + res.status)
    const data = await res.json()
    if (data.errcode !== 0) throw new Error('wecom errcode ' + data.errcode + (data.errmsg ? '：' + data.errmsg : ''))
  }
}
