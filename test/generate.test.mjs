import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chat, PROVIDERS } from '../bin/lib/llm.mjs'
import { generateReport } from '../bin/generate.mjs'

const GEN_BIN = fileURLToPath(new URL('../bin/generate.mjs', import.meta.url))
// 宿主机可能预置 WORKLOG_* 环境变量，spawn 前剔除（与 add.test.mjs 同法）
function runCli(args, dir) {
  const env = { ...process.env }
  for (const k of Object.keys(env)) if (k.startsWith('WORKLOG_')) delete env[k]
  env.WORKLOG_DIR = dir
  return spawnSync(process.execPath, [GEN_BIN, ...args], { env, encoding: 'utf8', timeout: 30000 })
}

async function mockServer(handler) {
  const seen = []
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', async () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null
      seen.push({ url: req.url, headers: req.headers, body })
      const r = await handler(req, body)
      try {
        if (r.status) { res.statusCode = r.status; res.end(r.body || 'err'); return }
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify(r))
      } catch { /* 客户端已中止（如超时测试） */ }
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return { server, base: 'http://127.0.0.1:' + server.address().port, seen }
}

test('openai 协议请求体与响应', async () => {
  process.env.K = 'sekret'
  const { server, base, seen } = await mockServer(() => ({ choices: [{ message: { content: 'OK' } }] }))
  const out = await chat({ protocol: 'openai', base_url: base, api_key_env: 'K', model: 'm' }, 'sys', 'user')
  assert.equal(out, 'OK')
  assert.equal(seen[0].body.model, 'm')
  assert.equal(seen[0].body.messages[0].role, 'system')
  assert.match(seen[0].url, /\/chat\/completions$/)
  server.close()
})
test('anthropic 协议 x-api-key 头与响应拼接', async () => {
  process.env.K = 'sekret'
  const { server, base, seen } = await mockServer(() => ({ content: [{ type: 'text', text: 'OK2' }] }))
  const out = await chat({ protocol: 'anthropic', base_url: base, api_key_env: 'K', model: 'm' }, 'sys', 'user')
  assert.equal(out, 'OK2')
  assert.equal(seen[0].headers['x-api-key'], 'sekret')
  assert.match(seen[0].url, /\/v1\/messages$/)
  server.close()
})
test('失败重试后成功', async () => {
  process.env.K = 'k'
  let n = 0
  const { server, base, seen } = await mockServer(() => { n++; return n < 3 ? { status: 500, body: 'x' } : { choices: [{ message: { content: 'ok' } }] } })
  const out = await chat({ protocol: 'openai', base_url: base, api_key_env: 'K', model: 'm' }, 's', 'u', { retryDelays: [0, 0] })
  assert.equal(out, 'ok')
  assert.equal(seen.length, 3)
  server.close()
})
test('api 生成器组装 system+user', async () => {
  process.env.K = 'sekret'
  const { server, base, seen } = await mockServer(() => ({ choices: [{ message: { content: '# 日报' } }] }))
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-'))
  const cfg = { watch_dirs: [], ignore: [], max_files_per_dir: 40, generator: { type: 'api', protocol: 'openai', base_url: base, api_key_env: 'K', model: 'm' }, claude_args: [], deliver: [] }
  const r = await generateReport('2026-10-16', { config: cfg, worklogDir: dir, now: new Date(2026, 9, 16, 18, 0) })
  assert.equal(r.generatorType, 'api')
  assert.ok(seen[0].body.messages[0].content.includes('工作日报写作规则'))
  server.close()
})
test('PROVIDERS 预设含 deepseek 双协议', () => {
  assert.equal(PROVIDERS.deepseek.openai, 'https://api.deepseek.com/v1')
  assert.equal(PROVIDERS.deepseek.anthropic, 'https://api.deepseek.com/anthropic')
})
test('claude-cli 读回 skill 落盘的报告（stdout 只是回报语）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-'))
  fs.mkdirSync(path.join(dir, 'reports'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'reports', '2026-10-16.md'), '# 真报告')
  const seen = {}
  const cfg = { watch_dirs: [], ignore: [], max_files_per_dir: 40, generator: { type: 'claude-cli', model: 'sonnet' }, claude_args: [], deliver: [] }
  const r = await generateReport('2026-10-16', {
    config: cfg,
    worklogDir: dir,
    spawnImpl: (args, o) => { seen.args = args; seen.opts = o; return '已生成：/path/reports/2026-10-16.md' },
  })
  assert.equal(r.generatorType, 'claude-cli')
  assert.equal(r.report, '# 真报告')
  assert.equal(seen.opts.cwd, dir)
  assert.equal(seen.opts.env.WORKLOG_SKIP, '1')
  assert.ok(seen.args.join(' ').includes('/daily-report 2026-10-16'))
})
test('claude-cli 未落盘时退回 stdout', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-'))
  const cfg = { watch_dirs: [], ignore: [], max_files_per_dir: 40, generator: { type: 'claude-cli' }, claude_args: [], deliver: [] }
  const r = await generateReport('2026-10-16', { config: cfg, worklogDir: dir, spawnImpl: () => 'stdout 回报语' })
  assert.equal(r.generatorType, 'claude-cli')
  assert.equal(r.report, 'stdout 回报语')
})

test('请求超时（服务端延迟响应）抛错且重试满 3 次', async () => {
  process.env.K = 'k'
  // 服务端延迟 1000ms 才响应：注入 50ms 超时 → 每次尝试都在响应前中止
  const { server, base, seen } = await mockServer(async () => {
    await new Promise((r) => { const t = setTimeout(r, 1000); t.unref() })
    return { choices: [{ message: { content: 'late' } }] }
  })
  try {
    await assert.rejects(chat({ protocol: 'openai', base_url: base, api_key_env: 'K', model: 'm' }, 's', 'u', { timeoutMs: 50, retryDelays: [0, 0] }))
    assert.equal(seen.length, 3, '3 次尝试全部超时')
  } finally {
    server.close()
  }
})

test('CLI --date 缺值 exit 2', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-'))
  const r = runCli(['--date'], dir)
  assert.equal(r.status, 2)
  assert.match(r.stderr, /YYYY-MM-DD/)
  assert.equal(fs.readdirSync(dir).length, 0)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('CLI --date 非法日历日期 exit 2', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-'))
  for (const bad of ['2026-02-30', '2026-99-99']) {
    const r = runCli(['--date', bad], dir)
    assert.equal(r.status, 2, '日历非法日期应 exit 2: ' + bad)
  }
  assert.equal(fs.readdirSync(dir).length, 0)
  fs.rmSync(dir, { recursive: true, force: true })
})
