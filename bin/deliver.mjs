// 投递编排：按 config.deliver 数组逐渠道发送（copy/smtp/wecom/feishu）。
// 单渠道失败不阻塞其余，失败收集进返回 {ok:[name], failed:[{name, error}]}，本模块永不抛。
// CLI：node bin/deliver.mjs <报告路径>（读 WORKLOG_DIR（默认 ~/.worklog）的 config.json 投递）。

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig } from './lib/config.mjs'
import { send as copySend } from '../channels/copy.mjs'
import { send as smtpSend } from '../channels/smtp.mjs'
import { send as wecomSend } from '../channels/wecom.mjs'
import { send as feishuSend } from '../channels/feishu.mjs'

const SENDERS = { copy: copySend, smtp: smtpSend, wecom: wecomSend, feishu: feishuSend }

export async function deliver(report, reportPath, channelsCfg, opts = {}) {
  const ok = []
  const failed = []
  const list = Array.isArray(channelsCfg) ? channelsCfg : []
  for (const ch of list) {
    const type = ch && ch.type
    const send = SENDERS[type]
    if (!send) { failed.push({ name: type, error: new Error('未知渠道类型：' + type) }); continue }
    try {
      await send(ch, report, { ...opts, reportPath })
      ok.push(type)
    } catch (error) {
      failed.push({ name: type, error })
    }
  }
  return { ok, failed }
}

// CLI：node bin/deliver.mjs <报告路径>
export async function main() {
  const args = process.argv.slice(2)
  const reportPath = args.find((a) => !a.startsWith('-'))
  if (!reportPath) {
    console.error('用法: node bin/deliver.mjs <报告路径>')
    process.exit(2)
  }
  const dir = process.env.WORKLOG_DIR || path.join(process.env.USERPROFILE || process.env.HOME || '', '.worklog')
  const cfg = loadConfig(dir)
  const report = fs.readFileSync(reportPath, 'utf8')
  const r = await deliver(report, reportPath, cfg.deliver, {})
  for (const name of r.ok) console.log('投递成功: ' + name)
  for (const f of r.failed) console.error('投递失败: ' + f.name + ' — ' + (f.error && f.error.message))
}

// 直接执行时进 CLI 入口；被 import（测试 / run-daily）时不触发。
{
  const argv1 = process.argv[1]
  if (argv1) {
    let a = path.resolve(argv1)
    let b = fileURLToPath(import.meta.url)
    if (process.platform === 'win32') { a = a.toLowerCase(); b = b.toLowerCase() }
    if (a === b) main().catch((e) => { console.error(e.message || e); process.exit(1) })
  }
}
