// 手动补录：node bin/add.mjs "文本" 把一条手记写进当天 notes.md 节，并向当天
// jsonl 追加一条 kind:'note' 行——run-daily 的"有活干"判定（jsonl 文件存在或
// notes.md 有当天节）据此看到这天。空/纯空白文本不做任何写入。

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { appendNote } from './lib/notes.mjs'
import { appendLine } from './lib/jsonl.mjs'
import { today, nowIso } from './lib/date.mjs'

export function addEntry(dir, text, now) {
  const s = String(text ?? '').trim()
  if (!s) return false
  const okNote = appendNote(dir, s, now)
  const okLine = appendLine(dir, today(now), {
    ts: nowIso(now), kind: 'note', cwd: '', session: '', turn: '', text: s,
  })
  return okNote && okLine
}

// CLI：node bin/add.mjs "文本"
export function main() {
  const text = process.argv[2]
  if (!text || !text.trim()) {
    console.error('用法: node bin/add.mjs "文本"')
    process.exit(1)
  }
  const dir = process.env.WORKLOG_DIR || path.join(process.env.USERPROFILE || process.env.HOME || '', '.worklog')
  if (!addEntry(dir, text, new Date())) {
    console.error('补录失败：无法写入 ' + dir)
    process.exit(1)
  }
  console.log('已补录: ' + text.trim())
}

// 直接执行时进 CLI 入口；被 import（测试）时不触发。
{
  const argv1 = process.argv[1]
  if (argv1) {
    let a = path.resolve(argv1)
    let b = fileURLToPath(import.meta.url)
    if (process.platform === 'win32') { a = a.toLowerCase(); b = b.toLowerCase() }
    if (a === b) main()
  }
}
