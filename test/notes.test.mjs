import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ensureSection, appendNote, sectionText } from '../bin/lib/notes.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

test('ensureSection 幂等追加节标题', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-'))
  ensureSection(dir, '2026-10-16')
  ensureSection(dir, '2026-10-16')
  const raw = fs.readFileSync(path.join(dir, 'notes.md'), 'utf8')
  assert.equal(raw.split('## 2026-10-16').length - 1, 1)
  fs.rmSync(dir, { recursive: true, force: true })
})
test('appendNote 加一行手记', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-'))
  appendNote(dir, '上午开会', new Date(2026, 9, 16, 10, 0))
  assert.equal(sectionText(dir, '2026-10-16').trim(), '- 上午开会')
  fs.rmSync(dir, { recursive: true, force: true })
})
test('appendNote 补写旧日期插入到对应节内而非文件末尾', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-'))
  appendNote(dir, '第一天手记', new Date(2026, 9, 16, 10, 0))
  appendNote(dir, '第二天手记', new Date(2026, 9, 17, 10, 0))
  appendNote(dir, '第一天补记', new Date(2026, 9, 16, 11, 0))
  assert.equal(sectionText(dir, '2026-10-16').trim(), '- 第一天手记\n- 第一天补记')
  assert.equal(sectionText(dir, '2026-10-17').trim(), '- 第二天手记')
  fs.rmSync(dir, { recursive: true, force: true })
})
