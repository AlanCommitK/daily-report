import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildMaterial, renderMaterial } from '../bin/collect.mjs'
import { appendLine } from '../bin/lib/jsonl.mjs'
import { appendNote } from '../bin/lib/notes.mjs'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function fixtureWithAllSources() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-'))
  const work = path.join(dir, 'work')
  fs.mkdirSync(path.join(work, 'proj'), { recursive: true })
  const repo = path.join(work, 'proj')
  execFileSync('git', ['init', '-q'], { cwd: repo })
  execFileSync('git', ['config', 'user.email', 't@t.com'], { cwd: repo })
  execFileSync('git', ['config', 'user.name', 'tester'], { cwd: repo })
  fs.writeFileSync(path.join(repo, 'a.txt'), 'v1')
  const env = { ...process.env, GIT_AUTHOR_DATE: '2026-10-15T10:00:00', GIT_COMMITTER_DATE: '2026-10-15T10:00:00' }
  execFileSync('git', ['add', '-A'], { cwd: repo })
  execFileSync('git', ['commit', '-qm', 'fix: login'], { cwd: repo, env })
  appendLine(dir, '2026-10-15', { ts: '2026-10-15T09:00:00+08:00', kind: 'prompt', cwd: repo, session: 's1', turn: 't1', text: '写登录模块' })
  appendNote(dir, '上午开会', new Date(2026, 9, 15, 10, 0))
  fs.writeFileSync(path.join(repo, 'b.txt'), 'x')
  const nowSec = new Date(2026, 9, 15, 14, 0).getTime() / 1000
  fs.utimesSync(path.join(repo, 'b.txt'), nowSec, nowSec)
  return { dir, work }
}

test('四路素材齐全', () => {
  const { dir, work } = fixtureWithAllSources()
  const m = buildMaterial('2026-10-15', { worklogDir: dir, watchDirs: [work], maxFilesPerDir: 40, ignore: [], now: new Date(2026, 9, 16, 18, 0) })
  const titles = m.sections.map((s) => s.title).join(' ')
  assert.ok(titles.includes('流水'))
  assert.ok(titles.includes('git'))
  assert.ok(titles.includes('文件'))
  assert.ok(titles.includes('手记'))
  assert.ok(m.meta.hasLog && m.meta.hasNote && m.meta.hasFiles)
  const markdown = renderMaterial(m)
  assert.ok(markdown.includes('fix: login'))
  assert.ok(markdown.includes('写登录模块'))
})
test('空素材日各标记为 false', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-'))
  const m = buildMaterial('2026-10-01', { worklogDir: dir, watchDirs: [], maxFilesPerDir: 40, ignore: [], now: new Date(2026, 9, 16, 18, 0) })
  assert.ok(!m.meta.hasLog && !m.meta.hasNote && !m.meta.hasFiles)
  assert.equal(m.sections.length, 0)
})
