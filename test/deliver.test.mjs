// 投递层测试：四个渠道 + 编排。webhook 走本地 mock HTTP server，smtp 注入 spawn，绝不碰真实网络/邮件。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { send as copySend } from '../channels/copy.mjs'
import { send as wecomSend } from '../channels/wecom.mjs'
import { send as feishuSend } from '../channels/feishu.mjs'
import { send as smtpSend } from '../channels/smtp.mjs'
import { deliver } from '../bin/deliver.mjs'
import http from 'node:http'
import { once } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

async function hookServer(onBody) {
  const seen = []
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      seen.push(body)
      onBody(body)
      res.end('{"errcode":0}')
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return { server, url: 'http://127.0.0.1:' + server.address().port + '/hook', seen }
}

test('copy 复制文件', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-'))
  const src = path.join(d, '2026-10-16.md')
  fs.writeFileSync(src, '# 日报')
  await copySend({ type: 'copy', to: path.join(d, 'out') }, '# 日报', { reportPath: src })
  assert.equal(fs.readFileSync(path.join(d, 'out', '2026-10-16.md'), 'utf8'), '# 日报')
})
test('wecom markdown 请求体与 4096 分片', async () => {
  const { server, url, seen } = await hookServer(() => {})
  const long = Array.from({ length: 30 }, (_, i) => '段落' + i + ' ' + 'x'.repeat(200)).join('\n\n')
  await wecomSend({ type: 'wecom', url }, long, {})
  assert.ok(seen.length > 1)
  assert.equal(seen[0].msgtype, 'markdown')
  for (const s of seen) assert.ok(Buffer.byteLength(JSON.stringify(s.markdown.content), 'utf8') <= 4096)
  server.close()
})
test('feishu post 富文本分片', async () => {
  const { server, url, seen } = await hookServer(() => {})
  const long = '# 工作日报 2026-10-16\n\n' + Array.from({ length: 30 }, (_, i) => '段落' + i + ' ' + 'x'.repeat(200)).join('\n\n')
  await feishuSend({ type: 'feishu', url }, long, {})
  assert.ok(seen.length > 1)
  assert.equal(seen[0].msg_type, 'post')
  assert.ok(JSON.stringify(seen[0].content.post.zh_cn.title).includes('工作日报'))
  for (const s of seen) assert.ok(Buffer.byteLength(JSON.stringify(s.content), 'utf8') <= 4096)
  server.close()
})
test('smtp 用 curl 传参（不真发）', async () => {
  process.env.P = 'pw'
  let argv
  await smtpSend({ type: 'smtp', host: 'smtp.example.com', port: 465, user: 'me@example.com', password_env: 'P', to: ['a@b.c'], from: 'me@example.com' }, '日报内容', { spawn: (cmd, args) => { argv = args; return { status: 0 } } })
  assert.ok(argv.includes('smtps://smtp.example.com:465'))
  assert.ok(argv.includes('me@example.com:pw'))
  assert.ok(argv.includes('--mail-rcpt'))
  assert.ok(argv.includes('a@b.c'))
  assert.ok(argv.includes('--upload-file'))
})
test('deliver 失败不阻塞', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-'))
  const r = await deliver('# x', null, [
    { type: 'copy', to: d },
    { type: 'wecom', url: 'http://127.0.0.1:1/h' },
    { type: 'smtp', host: 'h', user: 'u', to: ['a@b'], from: 'f' },
  ], { spawn: () => { throw new Error('nope') } })
  assert.equal(r.ok.length, 1)
  assert.equal(r.failed.length, 2)
  assert.ok(fs.existsSync(d))
})

// —— 以下为补充测试：控制器裁决的 CRLF 归一化，以及渠道契约其余分支 ——

test('wecom CRLF 文本先归一化再分片', async () => {
  const { server, url, seen } = await hookServer(() => {})
  const long = Array.from({ length: 30 }, (_, i) => '段落' + i + ' ' + 'x'.repeat(200)).join('\r\n\r\n')
  await wecomSend({ type: 'wecom', url }, long, {})
  assert.ok(seen.length > 1)
  for (const s of seen) assert.ok(Buffer.byteLength(JSON.stringify(s.markdown.content), 'utf8') <= 4096)
  server.close()
})

test('wecom errcode 非 0 抛错', async () => {
  const server = http.createServer((req, res) => { req.resume(); req.on('end', () => res.end('{"errcode":40001,"errmsg":"invalid webhook"}')) })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const url = 'http://127.0.0.1:' + server.address().port + '/h'
  await assert.rejects(wecomSend({ type: 'wecom', url }, 'x', {}), /40001/)
  server.close()
})

test('copy 无 reportPath 时把报告文本落盘', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-'))
  await copySend({ type: 'copy', to: path.join(d, 'out') }, '# 日报', {})
  assert.equal(fs.readFileSync(path.join(d, 'out', '日报.txt'), 'utf8'), '# 日报')
})

test('smtp starttls 走 smtp:// 且保留 --ssl-reqd', async () => {
  process.env.P = 'pw'
  let argv
  await smtpSend({ type: 'smtp', host: 'h', port: 587, starttls: true, user: 'u', password_env: 'P', to: ['a@b'], from: 'f' }, 'x', { spawn: (cmd, args) => { argv = args; return { status: 0 } } })
  assert.ok(argv.includes('smtp://h:587'))
  assert.ok(argv.includes('--ssl-reqd'))
})

test('smtp curl 非零退出抛 stderr', async () => {
  process.env.P = 'pw'
  await assert.rejects(
    smtpSend({ type: 'smtp', host: 'h', user: 'u', password_env: 'P', to: ['a@b'], from: 'f' }, 'x', { spawn: () => ({ status: 1, stderr: 'auth failed' }) }),
    /auth failed/
  )
})
