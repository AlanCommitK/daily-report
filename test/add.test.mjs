import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addEntry } from '../bin/add.mjs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const BIN = fileURLToPath(new URL('../bin/add.mjs', import.meta.url))
const NOW = new Date(2026, 9, 16, 18, 0)

function fixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dr-'))
}

// 宿主机可能预置 WORKLOG_* 环境变量（T4 审查教训），spawn 前剔除，保证 CLI 落到临时目录
function runCli(args, dir) {
  const env = { ...process.env }
  for (const k of Object.keys(env)) if (k.startsWith('WORKLOG_')) delete env[k]
  env.WORKLOG_DIR = dir
  return spawnSync(process.execPath, [BIN, ...args], { env, encoding: 'utf8' })
}

test('addEntry 把文本追加进当天 notes 节', () => {
  const dir = fixture()
  assert.equal(addEntry(dir, '上午开会写周报', NOW), true)
  const raw = fs.readFileSync(path.join(dir, 'notes.md'), 'utf8')
  assert.ok(raw.includes('## 2026-10-16'), '应有当天节标题：' + raw)
  assert.ok(raw.includes('- 上午开会写周报'), '节内应有手记行：' + raw)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('addEntry 向当天 jsonl 追加一条 kind=note 行', () => {
  const dir = fixture()
  addEntry(dir, '上午开会写周报', NOW)
  addEntry(dir, '下午写设计文档', NOW)
  const raw = fs.readFileSync(path.join(dir, '2026-10-16.jsonl'), 'utf8')
  const lines = raw.split('\n').filter(Boolean).map((l) => JSON.parse(l))
  assert.equal(lines.length, 2)
  const r = lines[0]
  assert.equal(r.kind, 'note')
  assert.equal(r.text, '上午开会写周报')
  assert.equal(r.cwd, '')
  assert.equal(r.session, '')
  assert.equal(r.turn, '')
  // ts 断言只钉不变前缀（带时区偏移后缀，跨时区机器一致）
  assert.ok(String(r.ts).startsWith('2026-10-16T18:00:00'), 'ts 应为注入时刻：' + r.ts)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('空文本/纯空白返回 false 且不写任何文件', () => {
  const dir = fixture()
  assert.equal(addEntry(dir, '', NOW), false)
  assert.equal(addEntry(dir, '   ', NOW), false)
  assert.equal(fs.readdirSync(dir).length, 0)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('CLI 无参数（或纯空白）打印用法退 1，不写任何文件', () => {
  const dir = fixture()
  for (const args of [[], ['   ']]) {
    const r = runCli(args, dir)
    assert.equal(r.status, 1, '参数 [' + args.join(' ') + '] 应退 1')
    assert.ok(r.stderr.trim().length > 0, '用法应打印到 stderr')
  }
  assert.equal(fs.readdirSync(dir).length, 0)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('CLI 传文本补录成功退 0（notes + jsonl 落盘）', () => {
  const dir = fixture()
  const r = runCli(['补录一条'], dir)
  assert.equal(r.status, 0, r.stderr)
  const raw = fs.readFileSync(path.join(dir, 'notes.md'), 'utf8')
  assert.ok(raw.includes('- 补录一条'), raw)
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
  assert.equal(files.length, 1)
  const line = JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf8').trim())
  assert.equal(line.kind, 'note')
  assert.equal(line.text, '补录一条')
  fs.rmSync(dir, { recursive: true, force: true })
})
