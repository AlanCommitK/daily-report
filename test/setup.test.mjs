import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadSettings, registerHooks, removeReportHooks } from '../bin/lib/settings.mjs'
import { buildSchTasks, buildCronLine } from '../bin/lib/scheduler.mjs'
import { runSetup } from '../bin/setup.mjs'
import { PROVIDERS } from '../bin/lib/llm.mjs'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const NOW = new Date(2026, 9, 16, 12, 0)
const CMD = 'node "C:/repo/daily-report/bin/capture/claude-code.mjs"'

test('registerHooks 幂等且备份', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-'))
  const p = path.join(d, 'settings.json')
  fs.writeFileSync(p, JSON.stringify({
    other: { keep: 1 },
    hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'keep-me' }] }] },
  }, null, 2))
  const hookCmds = { UserPromptSubmit: CMD, Stop: CMD, PostToolUse: CMD }
  registerHooks(p, hookCmds, NOW)
  registerHooks(p, hookCmds, NOW) // 第二次应全部跳过，不重复写入
  const s = JSON.parse(fs.readFileSync(p, 'utf8'))
  assert.deepEqual(s.other, { keep: 1 }, '无关键原样保留')
  for (const evt of ['UserPromptSubmit', 'Stop', 'PostToolUse']) {
    assert.equal(s.hooks[evt].length, 1, evt + ' 只有一份 capture')
    assert.equal(s.hooks[evt][0].hooks[0].command, CMD)
    assert.equal(s.hooks[evt][0].hooks[0].timeout, 10)
  }
  assert.equal(s.hooks.SessionStart.length, 1, '其他事件 hook 保留')
  const baks = fs.readdirSync(d).filter((f) => f.startsWith('settings.json.bak-'))
  assert.equal(baks.length, 1, '备份恰好一份（第二次无变更不备份）')
})

test('removeReportHooks 只删日报条目', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-'))
  const p = path.join(d, 'settings.json')
  const daily = { hooks: [{ type: 'command', command: CMD, timeout: 10 }] }
  const other = { hooks: [{ type: 'command', command: 'bash ~/other-hook.sh', timeout: 10 }] }
  fs.writeFileSync(p, JSON.stringify({ hooks: {
    UserPromptSubmit: [daily, other],
    Stop: [daily],
    PostToolUse: [daily],
    SessionStart: [other],
  } }, null, 2))
  removeReportHooks(p, NOW)
  const s = JSON.parse(fs.readFileSync(p, 'utf8'))
  assert.equal(s.hooks.UserPromptSubmit.length, 1)
  assert.equal(s.hooks.UserPromptSubmit[0].hooks[0].command, 'bash ~/other-hook.sh')
  assert.ok(!('Stop' in s.hooks), '清空的日报事件键移除')
  assert.ok(!('PostToolUse' in s.hooks))
  assert.equal(s.hooks.SessionStart.length, 1, '其他事件不动')
  assert.ok(fs.readdirSync(d).some((f) => f.startsWith('settings.json.bak-')), '变更前已备份')
})

test('buildSchTasks 参数正确', () => {
  const { args, command } = buildSchTasks('ClaudeDailyReport', 'C:\\repo\\bin\\run-daily.mjs', '18:00', [1, 2, 3, 4, 5], NOW)
  assert.equal(args[0], '/create')
  assert.ok(args.includes('/tn') && args.includes('ClaudeDailyReport'))
  assert.ok(args.includes('/sc') && args.includes('weekly'))
  assert.ok(args.includes('/d') && args.includes('MON,TUE,WED,THU,FRI'))
  assert.ok(args.includes('/st') && args.includes('18:00'))
  assert.ok(args.includes('/tr') && args.includes(command))
  assert.equal(command, 'node "C:\\repo\\bin\\run-daily.mjs"')
})

test('buildCronLine 星期映射（scriptPath 带引号，路径含空格不失效）', () => {
  assert.equal(buildCronLine('/repo/bin/run-daily.mjs', '18:00', [1, 2, 3, 4, 5]), '0 18 * * 1-5 node "/repo/bin/run-daily.mjs"')
  assert.equal(buildCronLine('/repo/bin/run-daily.mjs', '09:30', [7]), '30 9 * * 0 node "/repo/bin/run-daily.mjs"')
  assert.equal(buildCronLine('/Users/me/My Repos/daily-report/bin/run-daily.mjs', '08:05', [1]), '5 8 * * 1 node "/Users/me/My Repos/daily-report/bin/run-daily.mjs"')
})

// 回放式 io：按序吐预设答案（耗尽后吐默认值），并记录所有交互供断言。
function replayIO(answers, picks) {
  const log = []
  return {
    log,
    ask: (q, o) => { log.push('ask: ' + q); const a = answers.shift(); return (a === undefined || a === '') ? (o && o.default) ?? '' : a },
    pick: (options) => { log.push('pick: ' + options.join('/')); const v = picks.shift(); return v === undefined ? options[0] : v },
    say: (m) => { log.push('say: ' + m) },
  }
}

function setupEnv() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-'))
  return { dir: d, env: { USERPROFILE: d, HOME: d } }
}

test('runSetup 流程：检测 claude 存在 → 推荐 claude-cli', async () => {
  const { dir, env } = setupEnv()
  // 预先存在的 settings.json（含无关键）：注册前备份、无关键原样保留
  const sp = path.join(dir, '.claude', 'settings.json')
  fs.mkdirSync(path.dirname(sp), { recursive: true })
  fs.writeFileSync(sp, JSON.stringify({ permissions: { allow: ['Bash'] } }, null, 2))
  const io = replayIO(['y', 'y', '', '', '', '', '', '', '', ''], [])
  const created = []
  const spawnCalls = []
  const deps = {
    which: () => true,
    loadSettings,
    saveSettings: registerHooks,
    spawnSync: (cmd, args) => { spawnCalls.push([cmd, ...args]); return { status: cmd === 'schtasks' && args[0] === '/query' ? 1 : 0 } },
    writeFile: (p, c) => { created.push({ p, c }); fs.writeFileSync(p, c, 'utf8') },
    mkdir: (p) => fs.mkdirSync(p, { recursive: true }),
  }
  const actions = await runSetup({ io, now: NOW, env, platform: 'win32', deps })
  const cfg = actions.find((a) => a.type === 'config')
  assert.ok(cfg, '有 config 写入动作')
  assert.equal(cfg.content.generator.type, 'claude-cli')
  assert.equal(cfg.path, path.join(dir, '.worklog', 'config.json'))
  const hooks = actions.find((a) => a.type === 'hooks')
  assert.ok(hooks, '有 hooks 注册动作')
  const expectedCmd = 'node "' + fileURLToPath(new URL('../bin/capture/claude-code.mjs', import.meta.url)) + '"'
  for (const evt of ['UserPromptSubmit', 'Stop', 'PostToolUse']) {
    assert.equal(hooks.hookCmds[evt], expectedCmd)
  }
  const sch = actions.find((a) => a.type === 'schtasks')
  assert.ok(sch, '有 schtasks 动作')
  assert.ok(sch.args.includes('MON,TUE,WED,THU,FRI'))
  assert.equal(sch.command, 'node "' + fileURLToPath(new URL('../bin/run-daily.mjs', import.meta.url)) + '"')
  // settings.json 真实写入（注入 env 指向临时目录）：无关键保留、hooks 就位、备份为变更前原文
  const s = JSON.parse(fs.readFileSync(sp, 'utf8'))
  assert.deepEqual(s.permissions, { allow: ['Bash'] }, '无关键原样保留')
  assert.equal(s.hooks.UserPromptSubmit[0].hooks[0].command, expectedCmd)
  const baks = fs.readdirSync(path.join(dir, '.claude')).filter((f) => f.startsWith('settings.json.bak-'))
  assert.equal(baks.length, 1)
  const bak = JSON.parse(fs.readFileSync(path.join(dir, '.claude', baks[0]), 'utf8'))
  assert.deepEqual(bak.permissions, { allow: ['Bash'] })
  assert.ok(!bak.hooks, '备份是注册前的原文')
  // config.json 也真实写出且可被 loadConfig 读取
  assert.equal(JSON.parse(created[0].c).generator.type, 'claude-cli')
})

test('runSetup 流程：插件已装 → 跳过 hooks 注册', async () => {
  const { dir, env } = setupEnv()
  const sp = path.join(dir, '.claude', 'settings.json')
  fs.mkdirSync(path.dirname(sp), { recursive: true })
  fs.writeFileSync(sp, JSON.stringify({ enabledPlugins: { 'daily-report@marketplace': true } }, null, 2))
  const io = replayIO(['', '', '', '', '', '', '', '', ''], ['deepseek', 'openai'])
  const deps = {
    which: () => false,
    loadSettings,
    saveSettings: registerHooks,
    spawnSync: (cmd, args) => ({ status: cmd === 'schtasks' && args[0] === '/query' ? 1 : 0 }),
    writeFile: (p, c) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c, 'utf8') },
    mkdir: (p) => fs.mkdirSync(p, { recursive: true }),
  }
  const actions = await runSetup({ io, now: NOW, env, platform: 'win32', deps })
  assert.ok(!actions.some((a) => a.type === 'hooks'), '插件已装不注册 hooks')
  const s = JSON.parse(fs.readFileSync(sp, 'utf8'))
  assert.ok(!s.hooks, 'settings.json 未改动')
  assert.equal(fs.readdirSync(path.join(dir, '.claude')).filter((f) => f.includes('.bak-')).length, 0)
  assert.ok(!io.log.some((l) => l.startsWith('ask:') && l.includes('hooks 写入')), '未询问 hooks 注册')
  assert.ok(io.log.some((l) => l.startsWith('say:') && l.includes('无需注册')))
})

test('runSetup 流程：无 claude → 走 api 选 provider', async () => {
  const { dir, env } = setupEnv()
  const io = replayIO(['y', '', '', 'C:/work', '', '', '', '', '', '', ''], ['deepseek', 'openai'])
  const deps = {
    which: () => false,
    loadSettings,
    saveSettings: registerHooks,
    spawnSync: (cmd, args) => ({ status: cmd === 'schtasks' && args[0] === '/query' ? 1 : 0 }),
    writeFile: (p, c) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c, 'utf8') },
    mkdir: (p) => fs.mkdirSync(p, { recursive: true }),
  }
  const actions = await runSetup({ io, now: NOW, env, platform: 'win32', deps })
  const cfg = actions.find((a) => a.type === 'config')
  assert.equal(cfg.content.generator.type, 'api')
  assert.equal(cfg.content.generator.protocol, 'openai')
  assert.equal(cfg.content.generator.base_url, PROVIDERS.deepseek.openai, 'base_url 来自 PROVIDERS 预设')
  assert.equal(cfg.content.generator.model, 'deepseek-chat')
  assert.equal(cfg.content.generator.api_key_env, 'DAILY_REPORT_API_KEY')
  assert.deepEqual(cfg.content.watch_dirs, ['C:/work'])
  assert.deepEqual(cfg.content.deliver, [])
  // pick 与 ask 的交互顺序符合流程
  assert.equal(io.log.filter((l) => l.startsWith('pick: '))[0], 'pick: deepseek/openai/anthropic/qwen/glm/自定义')
  assert.equal(io.log.filter((l) => l.startsWith('pick: '))[1], 'pick: openai/anthropic')
})

// —— 输入最小校验（非法输入重问） ——

function baseDeps() {
  return {
    which: () => true,
    loadSettings,
    saveSettings: registerHooks,
    spawnSync: (cmd, args) => ({ status: cmd === 'schtasks' && args[0] === '/query' ? 1 : 0 }),
    writeFile: (p, c) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c, 'utf8') },
    mkdir: (p) => fs.mkdirSync(p, { recursive: true }),
  }
}

test('runSetup：非法时间重问后接受合法时间', async () => {
  const { dir, env } = setupEnv()
  const io = replayIO(['y', 'y', '', '', '', '', '', '', '25:99', '18:00', ''], [])
  const actions = await runSetup({ io, now: NOW, env, platform: 'win32', deps: baseDeps() })
  const sch = actions.find((a) => a.type === 'schtasks')
  assert.equal(sch.args[sch.args.indexOf('/st') + 1], '18:00', '最终写入合法时间')
  assert.ok(io.log.some((l) => l.startsWith('say:') && l.includes('时间格式应为')), '非法时间有提示')
})

test('runSetup：smtp 端口非法重问、空走默认', async () => {
  const { dir, env } = setupEnv()
  const io = replayIO(['y', 'y', '', '', '', 'smtp.example.com', 'abc', '', 'me@x.com', '', 'a@b.c', '', '', '', '', ''], [])
  const actions = await runSetup({ io, now: NOW, env, platform: 'win32', deps: baseDeps() })
  const cfg = actions.find((a) => a.type === 'config')
  assert.equal(cfg.content.deliver[0].type, 'smtp')
  assert.equal(cfg.content.deliver[0].port, 465, '非法输入后空输入回退默认 465')
  assert.deepEqual(cfg.content.deliver[0].to, ['a@b.c'])
  assert.ok(io.log.some((l) => l.startsWith('say:') && l.includes('端口应为')), '非法端口有提示')
})

test('runSetup：有 smtp host 无收件人重问', async () => {
  const { dir, env } = setupEnv()
  const io = replayIO(['y', 'y', '', '', '', 'smtp.example.com', '', 'me@x.com', '', '', '', 'a@b.c', '', '', '', ''], [])
  const actions = await runSetup({ io, now: NOW, env, platform: 'win32', deps: baseDeps() })
  const cfg = actions.find((a) => a.type === 'config')
  assert.equal(cfg.content.deliver[0].type, 'smtp')
  assert.deepEqual(cfg.content.deliver[0].to, ['a@b.c'], '空收件人重问后接受')
  const hints = io.log.filter((l) => l.startsWith('say:') && l.includes('收件人不能为空'))
  assert.equal(hints.length, 2, '两次空输入各提示一次')
})

test('runSetup：自定义 provider base_url/model 非空（空则重问）', async () => {
  const { dir, env } = setupEnv()
  const io = replayIO(['y', '', 'https://api.x.com/v1', '', 'my-model', '', '', '', '', '', '', '', ''], ['自定义', 'openai'])
  const actions = await runSetup({ io, now: NOW, env, platform: 'win32', deps: { ...baseDeps(), which: () => false } })
  const cfg = actions.find((a) => a.type === 'config')
  assert.equal(cfg.content.generator.type, 'api')
  assert.equal(cfg.content.generator.base_url, 'https://api.x.com/v1')
  assert.equal(cfg.content.generator.model, 'my-model')
  assert.equal(cfg.content.generator.protocol, 'openai')
  assert.ok(io.log.some((l) => l.startsWith('say:') && l.includes('base_url 不能为空')), '空 base_url 有提示')
  assert.ok(io.log.some((l) => l.startsWith('say:') && l.includes('模型名不能为空')), '空模型名有提示')
})

test('runSetup：hooks 无实际变更时不声称已备份（二次运行）', async () => {
  const { dir, env } = setupEnv()
  // 预先存在的 settings.json（含无关键）：注册前备份、无关键原样保留
  const sp = path.join(dir, '.claude', 'settings.json')
  fs.mkdirSync(path.dirname(sp), { recursive: true })
  fs.writeFileSync(sp, JSON.stringify({ permissions: { allow: ['Bash'] } }, null, 2))
  // 第一次运行注册 hooks（真实 registerHooks 写盘 + 备份）
  const io1 = replayIO(['y', 'y', '', '', '', '', '', '', '', ''], [])
  await runSetup({ io: io1, now: NOW, env, platform: 'win32', deps: baseDeps() })
  assert.ok(io1.log.some((l) => l.startsWith('say:') && l.includes('已备份')), '首次注册声称备份')
  // 第二次运行：hooks 已存在且命令相同 → 无备份写入，文案不得声称已备份
  const io2 = replayIO(['y', 'y', '', '', '', '', '', '', '', ''], [])
  await runSetup({ io: io2, now: NOW, env, platform: 'win32', deps: baseDeps() })
  assert.ok(io2.log.some((l) => l.startsWith('say:') && l.includes('无变更')), '二次运行提示无变更')
  assert.ok(!io2.log.some((l) => l.startsWith('say:') && l.includes('已备份')), '二次运行不得声称已备份')
  const baks = fs.readdirSync(path.join(dir, '.claude')).filter((f) => f.startsWith('settings.json.bak-'))
  assert.equal(baks.length, 1, '备份仍只有首次那一份')
})
