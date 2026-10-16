import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildMaterial, renderMaterial } from '../bin/collect.mjs'
import { appendLine } from '../bin/lib/jsonl.mjs'
import { appendNote } from '../bin/lib/notes.mjs'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const BIN = fileURLToPath(new URL('../bin/collect.mjs', import.meta.url))
// 宿主机可能预置 WORKLOG_* 环境变量，spawn 前剔除（与 add.test.mjs 同法）
function runCli(args, dir) {
  const env = { ...process.env }
  for (const k of Object.keys(env)) if (k.startsWith('WORKLOG_')) delete env[k]
  env.WORKLOG_DIR = dir
  return spawnSync(process.execPath, [BIN, ...args], { env, encoding: 'utf8', timeout: 30000 })
}

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

test('CLI 非法日历日期 exit 2（round-trip 校验）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-'))
  for (const bad of ['2026-02-30', '2026-99-99']) {
    const r = runCli([bad], dir)
    assert.equal(r.status, 2, '日历非法日期应 exit 2: ' + bad)
    assert.match(r.stderr, /YYYY-MM-DD/)
  }
  assert.equal(fs.readdirSync(dir).length, 0)
  fs.rmSync(dir, { recursive: true, force: true })
})
