import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appendLine, readLines } from '../bin/lib/jsonl.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

test('appendLine 写 UTF-8 无 BOM 且可读回', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-'))
  appendLine(dir, '2026-10-16', { ts: '2026-10-16T09:00:00+08:00', kind: 'prompt', text: '你好' })
  const raw = fs.readFileSync(path.join(dir, '2026-10-16.jsonl'))
  assert.ok(!raw.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), '无 BOM')
  const lines = readLines(dir, '2026-10-16')
  assert.equal(lines.length, 1)
  assert.equal(lines[0].text, '你好')
  fs.rmSync(dir, { recursive: true, force: true })
})
test('readLines 文件不存在返回空数组', () => {
  assert.deepEqual(readLines(os.tmpdir(), '1999-01-01'), [])
})
