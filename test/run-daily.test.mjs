import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideTodo, runDailyMain } from '../bin/run-daily.mjs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const BIN = fileURLToPath(new URL('../bin/run-daily.mjs', import.meta.url))
function runCli(args, dir) {
  return spawnSync(process.execPath, [BIN, ...args], {
    env: { ...process.env, WORKLOG_DIR: dir }, encoding: 'utf8',
  })
}

const NOW = new Date(2026, 9, 16, 18, 0)
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-'))
  return { dir, opts: { worklogDir: dir, watchDirs: [], days: 7, maxCatchup: 3, now: NOW } }
}
function touch(f, ms) {
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, 'x')
  fs.utimesSync(f, ms / 1000, ms / 1000)
}

test('当天恒生成（即使已有报告）', () => {
  const { dir, opts } = fixture()
  touch(path.join(dir, 'reports', '2026-10-16.md'), NOW.getTime())
  const { todo } = decideTodo(opts)
  assert.ok(todo.includes('2026-10-16'))
})
test('素材三无跳过', () => {
  const { opts } = fixture()
  const { todo, skipped } = decideTodo(opts)
  assert.ok(!todo.includes('2026-10-13'))
  assert.ok(Object.keys(skipped).includes('2026-10-13'))
})
test('历史缺报告补生成', () => {
  const { dir, opts } = fixture()
  touch(path.join(dir, '2026-10-13.jsonl'), new Date(2026, 9, 13, 12, 0).getTime())
  const { todo } = decideTodo(opts)
  assert.ok(todo.includes('2026-10-13'))
})
test('素材新于报告才重生成（手改保护）', () => {
  const { dir, opts } = fixture()
  touch(path.join(dir, '2026-10-14.jsonl'), new Date(2026, 9, 14, 10, 0).getTime())
  touch(path.join(dir, 'reports', '2026-10-14.md'), new Date(2026, 9, 14, 18, 0).getTime())
  const { todo } = decideTodo(opts)
  assert.ok(!todo.includes('2026-10-14'))
})
test('maxCatchup 截断（今天 + 最近 2 个补生成）', () => {
  const { dir, opts } = fixture()
  for (const d of ['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13']) touch(path.join(dir, d + '.jsonl'), new Date(2026, 9, 10, 12, 0).getTime())
  const { todo } = decideTodo(opts)
  assert.equal(todo.length, 3)
  assert.ok(todo.includes('2026-10-16'))
  assert.ok(todo.includes('2026-10-13'))
  assert.ok(!todo.includes('2026-10-10'))
})
test('dry-run 不写报告', async () => {
  const { dir } = fixture()
  await runDailyMain({ worklogDir: dir, date: '2026-10-16', dryRun: true, now: NOW, deps: { generateReport: async () => ({ report: '# x', generatorType: 'api' }) } })
  assert.ok(!fs.existsSync(path.join(dir, 'reports', '2026-10-16.md')))
})
test('非法日历日期 exit 2 且不产生 NaN 文件', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-'))
  for (const bad of ['2026-13-01', '2026-02-30']) {
    const r = runCli(['--date', bad], dir)
    assert.equal(r.status, 2, '日历非法日期应 exit 2: ' + bad)
  }
  assert.equal(fs.readdirSync(dir).length, 0)
})
test('--date 缺值 exit 2', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-'))
  const r = runCli(['--date'], dir)
  assert.equal(r.status, 2)
  assert.equal(fs.readdirSync(dir).length, 0)
})
