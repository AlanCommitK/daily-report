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
test('readLines 遇损坏行（非 JSON）不抛异常，返回 [] 或跳过坏行', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-'))
  fs.writeFileSync(path.join(dir, '2026-10-16.jsonl'), JSON.stringify({ a: 1 }) + '\n这不是JSON\n', 'utf8')
  let out
  assert.doesNotThrow(() => { out = readLines(dir, '2026-10-16') })
  assert.ok(Array.isArray(out))
  assert.ok(out.length === 0 || (out.length === 1 && out[0].a === 1), '整文件丢弃或仅保留好行')
  fs.rmSync(dir, { recursive: true, force: true })
})
test('appendLine 到不可写位置（父路径是文件）返回 false 且不抛异常', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-'))
  const blocker = path.join(dir, 'blocker')
  fs.writeFileSync(blocker, 'x')
  let out
  assert.doesNotThrow(() => { out = appendLine(blocker, '2026-10-16', { a: 1 }) })
  assert.equal(out, false)
  fs.rmSync(dir, { recursive: true, force: true })
})
