import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handlePayload } from '../bin/capture/claude-code.mjs'
import { today } from '../bin/lib/date.mjs'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MOD = fileURLToPath(new URL('../bin/capture/claude-code.mjs', import.meta.url))

const NOW = new Date(2026, 9, 16, 9, 0)
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-'))
  return { dir, opts: { worklogDir: dir, env: {}, now: NOW } }
}
function lines(dir) {
  try { return fs.readFileSync(path.join(dir, '2026-10-16.jsonl'), 'utf8').split('\n').filter(Boolean).map(JSON.parse) } catch { return [] }
}

test('UserPromptSubmit 记 prompt 并开 notes 节', () => {
  const { dir, opts } = setup()
  handlePayload({ hook_event_name: 'UserPromptSubmit', prompt: '写一个登录模块', prompt_id: 'abcdefgh1234', session_id: 'sess12345678', cwd: 'C:/work' }, opts)
  const ls = lines(dir)
  assert.equal(ls.length, 1)
  assert.equal(ls[0].kind, 'prompt')
  assert.equal(ls[0].turn, 'abcdefgh')
  assert.equal(ls[0].session, 'sess1234')
  assert.ok(fs.readFileSync(path.join(dir, 'notes.md'), 'utf8').includes('## 2026-10-16'))
})

test('/daily-report 轮次进 skipturns，后续 file 被跳过', () => {
  const { dir, opts } = setup()
  handlePayload({ hook_event_name: 'UserPromptSubmit', prompt: '/daily-report', prompt_id: 'skipme1234', session_id: 's1', cwd: 'C:/work' }, opts)
  handlePayload({ hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: 'C:/work/a.md' }, prompt_id: 'skipme1234', session_id: 's1', cwd: 'C:/work' }, opts)
  const skips = fs.readFileSync(path.join(dir, '2026-10-16.skipturns'), 'utf8')
  assert.ok(skips.includes('skipme1'))
  assert.equal(lines(dir).length, 0)
})

test('PostToolUse 仅四类写工具且排除 worklog 目录', () => {
  const { dir, opts } = setup()
  handlePayload({ hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: 'C:/work/b.md' }, prompt_id: 'p1', session_id: 's1', cwd: 'C:/work' }, opts)
  handlePayload({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'ls' }, prompt_id: 'p1', session_id: 's1', cwd: 'C:/work' }, opts)
  handlePayload({ hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(opts.worklogDir, 'x.md') }, prompt_id: 'p1', session_id: 's1', cwd: 'C:/work' }, opts)
  const ls = lines(dir)
  assert.equal(ls.length, 1)
  assert.equal(ls[0].kind, 'file')
  assert.equal(ls[0].tool, 'Write')
})

test('Stop 记 reply 且截断', () => {
  const { dir, opts } = setup()
  const long = 'x'.repeat(3000)
  handlePayload({ hook_event_name: 'Stop', last_assistant_message: long, prompt_id: 'p2', session_id: 's1', cwd: 'C:/work' }, opts)
  const ls = lines(dir)
  assert.equal(ls[0].kind, 'reply')
  assert.ok(ls[0].text.length <= 2000 + 10)
})

test('WORKLOG_SKIP=1 时静默跳过', () => {
  const { dir, opts } = setup()
  opts.env.WORKLOG_SKIP = '1'
  handlePayload({ hook_event_name: 'UserPromptSubmit', prompt: 'hi', prompt_id: 'p3', session_id: 's1', cwd: 'C:/work' }, opts)
  assert.equal(lines(dir).length, 0)
})

test('WORKLOG_REDACT=0 时跳过脱敏（与 capture.ps1 的 -ne "0" 一致）', () => {
  const { dir, opts } = setup()
  opts.env.WORKLOG_REDACT = '0'
  const secret = 'key=sk-abcdefghijklmnopqrstuvwxyz123456'
  handlePayload({ hook_event_name: 'UserPromptSubmit', prompt: secret, prompt_id: 'p4', session_id: 's1', cwd: 'C:/work' }, opts)
  const ls = lines(dir)
  assert.equal(ls.length, 1)
  assert.equal(ls[0].text, secret)
})

test('WORKLOG_MAX_PROMPT/REPLY 非数字回退默认 1200/2000 截断（不产出 NaN 垃圾行）', () => {
  const { dir, opts } = setup()
  opts.env.WORKLOG_MAX_PROMPT = 'abc'
  opts.env.WORKLOG_MAX_REPLY = 'abc'
  handlePayload({ hook_event_name: 'UserPromptSubmit', prompt: 'x'.repeat(1500), prompt_id: 'p6', session_id: 's1', cwd: 'C:/work' }, opts)
  handlePayload({ hook_event_name: 'Stop', last_assistant_message: 'y'.repeat(2500), prompt_id: 'p6', session_id: 's1', cwd: 'C:/work' }, opts)
  const ls = lines(dir)
  assert.equal(ls.length, 2)
  assert.equal(ls[0].text, 'x'.repeat(1200) + '…[截断]', 'prompt 按默认 1200 截断')
  assert.equal(ls[1].text, 'y'.repeat(2000) + '…[截断]', 'reply 按默认 2000 截断')
})

test('异常载荷不抛出（绝不失败）', () => {
  const { dir, opts } = setup()
  handlePayload({ hook_event_name: 'UnknownEvent' }, opts)
  handlePayload(null, opts)
  assert.equal(lines(dir).length, 0)
})

test('CLI 入口：stdin 载荷落盘，stdout 绝对静默，退出码 0', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-'))
  const payload = JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'e2e 你好', prompt_id: 'cli1', session_id: 's1', cwd: 'C:/work' })
  const r = runCli(payload, dir)
  assert.equal(r.status, 0)
  assert.equal(r.stdout, '', '不得向 stdout 写任何东西')
  const day = today(new Date())
  const ls = fs.readFileSync(path.join(dir, day + '.jsonl'), 'utf8').split('\n').filter(Boolean).map(JSON.parse)
  assert.equal(ls.length, 1)
  assert.equal(ls[0].kind, 'prompt')
  assert.equal(ls[0].text, 'e2e 你好')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('CLI 入口：损坏 JSON 或空 stdin 不失败，退出码 0', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-'))
  for (const input of ['not-json{', '']) {
    const r = runCli(input, dir)
    assert.equal(r.status, 0)
    assert.equal(r.stdout, '')
  }
  fs.rmSync(dir, { recursive: true, force: true })
})

// 宿主机可能预置 WORKLOG_* 环境变量（会劫持数据目录），spawn 前剔除（与 add.test.mjs 同法）
function runCli(input, dir) {
  const env = { ...process.env }
  for (const k of Object.keys(env)) if (k.startsWith('WORKLOG_')) delete env[k]
  env.WORKLOG_DIR = dir
  return spawnSync(process.execPath, [MOD], { input, env, encoding: 'utf8', timeout: 30000 })
}
