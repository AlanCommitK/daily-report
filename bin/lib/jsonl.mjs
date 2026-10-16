// JSONL 流水读写：UTF-8 无 BOM，永不抛异常。

import fs from 'node:fs'
import path from 'node:path'

export function appendLine(dir, day, obj) {
  try {
    fs.mkdirSync(dir, { recursive: true })
    const line = JSON.stringify(obj) + '\n'
    fs.appendFileSync(path.join(dir, day + '.jsonl'), new TextEncoder().encode(line))
    return true
  } catch { return false }
}

export function readLines(dir, day) {
  try {
    const raw = fs.readFileSync(path.join(dir, day + '.jsonl'), 'utf8')
    return raw.split('\n').filter(Boolean).map((l) => JSON.parse(l))
  } catch { return [] }
}
