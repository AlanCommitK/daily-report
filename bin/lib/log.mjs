// 运行日志：追加 "[YYYY-MM-DD HH:MM:SS] 消息" 一行到 run.log，永不抛异常。
// 返回写入的整行，调用方可用同一行打到控制台（时间戳与日志一致）。

import fs from 'node:fs'
import path from 'node:path'

export function logRun(dir, msg, now = new Date()) {
  // 与 lib/date.mjs 的 today() 一致：字符串日期按本地正午解析，避免 UTC 边界偏移
  const d = now instanceof Date ? now
    : typeof now === 'string' && now ? new Date(now + 'T12:00:00') : new Date()
  const p = (n) => String(n).padStart(2, '0')
  const ts = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
    ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds())
  const line = '[' + ts + '] ' + msg
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.appendFileSync(path.join(dir, 'run.log'), line + '\n', 'utf8')
  } catch {}
  return line
}
