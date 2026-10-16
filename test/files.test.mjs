import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scanDayChanges } from '../bin/lib/files.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

test('只聚合当天 mtime 的文件并排除 ignore 目录', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-'))
  const proj = path.join(d, 'proj')
  fs.mkdirSync(path.join(proj, 'node_modules'), { recursive: true })
  fs.writeFileSync(path.join(proj, 'today.txt'), 'x')
  fs.writeFileSync(path.join(proj, 'old.txt'), 'x')
  fs.writeFileSync(path.join(proj, 'node_modules', 'pkg.js'), 'x')
  const nowSec = new Date(2026, 9, 16, 12, 0).getTime() / 1000
  fs.utimesSync(path.join(proj, 'today.txt'), nowSec, nowSec)
  fs.utimesSync(path.join(proj, 'node_modules', 'pkg.js'), nowSec, nowSec)
  const oldSec = new Date(2026, 8, 1).getTime() / 1000
  fs.utimesSync(path.join(proj, 'old.txt'), oldSec, oldSec)
  const out = scanDayChanges([d], '2026-10-16', 40, ['node_modules'], new Date(2026, 9, 16, 18, 0))
  const files = Object.values(out).flat()
  assert.ok(files.some((f) => f.endsWith('today.txt')))
  assert.ok(!files.some((f) => f.endsWith('old.txt')))
  assert.ok(!files.some((f) => f.endsWith('pkg.js')))
})
test('排除点目录与点文件', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-'))
  const proj = path.join(d, 'proj')
  fs.mkdirSync(path.join(proj, '.hidden'), { recursive: true })
  fs.writeFileSync(path.join(proj, '.hidden', 'inside.txt'), 'x')
  fs.writeFileSync(path.join(proj, '.dotfile'), 'x')
  const nowSec = new Date(2026, 9, 16, 12, 0).getTime() / 1000
  fs.utimesSync(path.join(proj, '.hidden', 'inside.txt'), nowSec, nowSec)
  fs.utimesSync(path.join(proj, '.dotfile'), nowSec, nowSec)
  const out = scanDayChanges([d], '2026-10-16', 40, [], new Date(2026, 9, 16, 18, 0))
  const files = Object.values(out).flat()
  assert.ok(!files.some((f) => String(f).endsWith('inside.txt')))
  assert.ok(!files.some((f) => String(f).endsWith('.dotfile')))
})
