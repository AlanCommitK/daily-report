// 交互式安装器：检测环境 → 采集方式（插件已装则跳过 hooks 注册）→ 生成器 →
// 监听目录 → 投递渠道 → 计划任务 → 写 config.json 到数据目录。
// runSetup 为纯流程：io 与全部副作用（which/读写/spawn）注入，返回写入动作列表供测试断言；
// main() 用 node:readline 接真实 stdin/stdout。

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import readline from 'node:readline'
import { PROVIDERS } from './lib/llm.mjs'
import { loadSettings, registerHooks } from './lib/settings.mjs'
import { buildSchTasks, buildCronLine } from './lib/scheduler.mjs'

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const CAPTURE_SCRIPT = path.join(REPO_ROOT, 'bin', 'capture', 'claude-code.mjs')
const RUN_DAILY_SCRIPT = path.join(REPO_ROOT, 'bin', 'run-daily.mjs')
const TASK_NAME = 'ClaudeDailyReport'

const DEFAULT_MODELS = {
  deepseek: 'deepseek-chat',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-sonnet-4-5',
  qwen: 'qwen-plus',
  glm: 'glm-4-flash',
}

function worklogDir(env) {
  return env.WORKLOG_DIR || path.join(env.USERPROFILE || env.HOME || '', '.worklog')
}
function settingsPath(env) {
  return path.join(env.USERPROFILE || env.HOME || '', '.claude', 'settings.json')
}
function isYes(ans) { return /^(y|yes|是)$/i.test(String(ans).trim()) }
function parseWeekdays(ans) {
  const days = String(ans).split(',').map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7)
  return days.length ? [...new Set(days)].sort((a, b) => a - b) : null
}

export async function runSetup(opts = {}) {
  const io = opts.io || {}
  const say = (m) => { if (io.say) io.say(m) }
  const now = opts.now instanceof Date ? opts.now : new Date()
  const env = opts.env || {}
  const platform = opts.platform || process.platform
  const d = opts.deps || {}
  const spawn = d.spawnSync || spawnSync
  const deps = {
    which: d.which || ((p) => { const r = spawn(p === 'win32' ? 'where' : 'which', ['claude']); return !!(r && r.status === 0) }),
    loadSettings: d.loadSettings || loadSettings,
    saveSettings: d.saveSettings || registerHooks,
    spawnSync: spawn,
    writeFile: d.writeFile || ((p, content) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content, 'utf8') }),
    mkdir: d.mkdir || ((p) => fs.mkdirSync(p, { recursive: true })),
  }
  const actions = []

  // 1. node 版本与数据目录
  const nodeMajor = Number(String(process.versions.node).split('.')[0])
  if (!(nodeMajor >= 18)) {
    say('当前 Node 版本 ' + process.versions.node + ' 低于 18，请先升级 Node（https://nodejs.org）。')
    return actions
  }
  const dir = worklogDir(env)
  deps.mkdir(dir)
  say('数据目录: ' + dir)

  // 2. 采集方式：插件已装（enabledPlugins 含 daily-report）→ hooks 由插件提供，无需注册；
  //    否则询问是否写入 settings.json（克隆安装用户），跳过则素材只剩 git/文件变更/手记。
  const sp = settingsPath(env)
  const settings = deps.loadSettings(sp)
  const ep = settings && settings.enabledPlugins
  const hasPlugin = !!ep && (Array.isArray(ep)
    ? ep.some((e) => String(e).includes('daily-report'))
    : typeof ep === 'object' && Object.keys(ep).some((k) => String(k).includes('daily-report')))
  if (hasPlugin) {
    say('检测到 daily-report 插件已启用，采集 hooks 由插件提供，无需注册。')
  } else {
    const ans = await io.ask('是否把采集 hooks 写入 ' + sp + '？（克隆安装选是，插件安装选否）', { default: 'y' })
    if (isYes(ans)) {
      const cmd = 'node "' + CAPTURE_SCRIPT + '"'
      const hookCmds = { UserPromptSubmit: cmd, Stop: cmd, PostToolUse: cmd }
      deps.saveSettings(sp, hookCmds, now)
      actions.push({ type: 'hooks', path: sp, hookCmds })
      say('已注册采集 hooks（UserPromptSubmit/Stop/PostToolUse），原文件已备份为 settings.json.bak-<时间戳>。')
    } else {
      say('跳过采集 hooks（素材将来自 git 提交/文件变更/手记）。')
    }
  }

  // 3. 生成器：检测到 claude CLI 则推荐 claude-cli（登录态零配置），否则走 api（provider 预设）。
  let generator
  if (deps.which(platform)) {
    const ans = await io.ask('检测到 claude CLI，使用它生成日报？', { default: 'y' })
    if (isYes(ans)) {
      generator = { type: 'claude-cli' }
      const model = String(await io.ask('claude 模型名（回车用默认）', { default: '' })).trim()
      if (model) generator.model = model
      say('生成器: claude-cli' + (model ? '（模型 ' + model + '）' : ''))
    }
  }
  if (!generator) {
    const prov = await io.pick([...Object.keys(PROVIDERS), '自定义'])
    let baseUrl, protocol
    if (prov === '自定义') {
      baseUrl = String(await io.ask('base_url（如 https://api.example.com/v1）', { default: '' })).trim()
      protocol = await io.pick(['openai', 'anthropic'])
    } else {
      const urls = PROVIDERS[prov]
      const protocols = Object.keys(urls)
      protocol = protocols.length === 1 ? protocols[0] : await io.pick(protocols)
      baseUrl = urls[protocol]
    }
    const model = String(await io.ask('模型名', { default: DEFAULT_MODELS[prov] || '' })).trim()
    const apiKeyEnv = String(await io.ask('API key 环境变量名（密钥只从环境变量读取）', { default: 'DAILY_REPORT_API_KEY' })).trim()
    generator = { type: 'api', protocol, base_url: baseUrl, api_key_env: apiKeyEnv || 'DAILY_REPORT_API_KEY', model }
    say('生成器: api（' + prov + ' / ' + protocol + ' / ' + model + '）')
  }

  // 4. watch_dirs 逐项询问（回车结束）
  const watchDirs = []
  for (;;) {
    const v = String(await io.ask('要监听的工作目录（逐项输入，回车结束）', { default: '' })).trim()
    if (!v) break
    watchDirs.push(v)
  }
  say('watch_dirs: ' + (watchDirs.length ? watchDirs.join(', ') : '（未配置，素材无文件变更来源）'))

  // 5. 投递渠道逐项询问（回车跳过）
  const deliver = []
  const copyTo = String(await io.ask('copy 渠道：日报存档目录（回车跳过）', { default: '' })).trim()
  if (copyTo) { deliver.push({ type: 'copy', to: copyTo }); say('渠道 copy -> ' + copyTo) }
  const smtpHost = String(await io.ask('smtp 渠道：邮件服务器地址（回车跳过）', { default: '' })).trim()
  if (smtpHost) {
    const port = Number(String(await io.ask('smtp 端口', { default: '465' })).trim() || '465')
    const user = String(await io.ask('smtp 用户名（邮箱）', { default: '' })).trim()
    const passwordEnv = String(await io.ask('smtp 密码环境变量名', { default: 'WORKLOG_SMTP_PASS' })).trim() || 'WORKLOG_SMTP_PASS'
    const to = String(await io.ask('收件人（逗号分隔多个）', { default: '' })).split(',').map((s) => s.trim()).filter(Boolean)
    const from = String(await io.ask('发件人（回车同用户名）', { default: user })).trim() || user
    deliver.push({ type: 'smtp', host: smtpHost, port, user, password_env: passwordEnv, to, from })
    say('渠道 smtp -> ' + smtpHost)
  }
  const wecomUrl = String(await io.ask('wecom 渠道：群机器人 webhook url（回车跳过）', { default: '' })).trim()
  if (wecomUrl) { deliver.push({ type: 'wecom', url: wecomUrl }); say('渠道 wecom') }
  const feishuUrl = String(await io.ask('feishu 渠道：群机器人 webhook url（回车跳过）', { default: '' })).trim()
  if (feishuUrl) { deliver.push({ type: 'feishu', url: feishuUrl }); say('渠道 feishu') }
  say('投递渠道共 ' + deliver.length + ' 个（不配则仅本地留档 reports/）')

  // 6. 计划任务：Windows schtasks / mac·Linux crontab；时间默认 18:00、工作日默认周一至五；已存在询问覆盖
  const time = String(await io.ask('定时任务运行时间', { default: '18:00' })).trim() || '18:00'
  const weekdays = parseWeekdays(String(await io.ask('运行星期 1-7（1=周一，7=周日，逗号分隔）', { default: '1,2,3,4,5' }))) || [1, 2, 3, 4, 5]
  if (platform === 'win32') {
    const { args, command } = buildSchTasks(TASK_NAME, RUN_DAILY_SCRIPT, time, weekdays, now)
    const q = deps.spawnSync('schtasks', ['/query', '/tn', TASK_NAME])
    let createArgs = args
    if (q && q.status === 0) {
      const ans = await io.ask('计划任务 ' + TASK_NAME + ' 已存在，覆盖？', { default: 'y' })
      if (isYes(ans)) createArgs = [...args, '/f']
      else { createArgs = null; say('保留已有计划任务。') }
    }
    if (createArgs) {
      const r = deps.spawnSync('schtasks', createArgs)
      const ok = !!(r && r.status === 0)
      actions.push({ type: 'schtasks', name: TASK_NAME, args: createArgs, command, ok })
      say(ok ? '计划任务已创建: schtasks ' + createArgs.join(' ') : '计划任务创建失败（' + (r && r.stderr ? String(r.stderr).trim() : '退出码 ' + (r && r.status)) + '），可手动执行: schtasks ' + createArgs.join(' '))
    }
  } else if (platform === 'darwin' || platform === 'linux') {
    const line = buildCronLine(RUN_DAILY_SCRIPT, time, weekdays)
    const cur = deps.spawnSync('crontab', ['-l'])
    const curLines = (cur && cur.status === 0 && cur.stdout ? String(cur.stdout) : '').split('\n').filter(Boolean)
    const i = curLines.findIndex((l) => l.includes('run-daily.mjs'))
    if (i !== -1 && curLines[i] === line) {
      say('crontab 已有相同任务行，跳过。')
      actions.push({ type: 'cron', line, skipped: true })
    } else {
      let next = null
      if (i !== -1) {
        const ans = await io.ask('crontab 已有 daily-report 任务行，覆盖？', { default: 'y' })
        if (isYes(ans)) next = [...curLines.slice(0, i), line, ...curLines.slice(i + 1)]
        else say('保留已有 crontab 行。')
      } else {
        next = [...curLines, line]
      }
      if (next) {
        const r = deps.spawnSync('crontab', ['-'], { input: next.join('\n') + '\n' })
        const ok = !!(r && r.status === 0)
        actions.push({ type: 'cron', line, ok })
        say(ok ? 'crontab 已写入: ' + line : 'crontab 写入失败，可手动追加: ' + line)
      }
    }
  } else {
    say('当前平台不支持自动创建计划任务，请自行定时运行: node ' + RUN_DAILY_SCRIPT)
  }

  // 7. 写 config.json 到数据目录
  const cfg = { watch_dirs: watchDirs, generator, claude_args: [], deliver }
  const cfgPath = path.join(dir, 'config.json')
  deps.writeFile(cfgPath, JSON.stringify(cfg, null, 2) + '\n')
  actions.push({ type: 'config', path: cfgPath, content: cfg })
  say('配置已写入: ' + cfgPath)
  say('安装完成。立即生成一次: node ' + RUN_DAILY_SCRIPT)
  return actions
}

export async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const ask = (question, { default: dflt } = {}) => new Promise((resolve) => {
    const hint = dflt ? ' [' + dflt + ']' : ''
    rl.question(question + hint + ' ', (a) => resolve(a === '' ? (dflt ?? '') : a))
  })
  const pick = (options) => new Promise((resolve) => {
    const menu = options.map((o, i) => (i + 1) + ') ' + o).join('  ')
    rl.question(menu + '\n选择 [1-' + options.length + '] ', (a) => {
      const n = Number(a)
      resolve(options[Number.isInteger(n) && n >= 1 && n <= options.length ? n - 1 : 0])
    })
  })
  await runSetup({ io: { ask, pick, say: (m) => console.log(m) }, now: new Date(), env: process.env, platform: process.platform })
  rl.close()
}

// 直接执行时进 CLI 入口；被 import（测试 / 其他模块）时不触发。
{
  const argv1 = process.argv[1]
  if (argv1) {
    let a = path.resolve(argv1)
    let b = fileURLToPath(import.meta.url)
    if (process.platform === 'win32') { a = a.toLowerCase(); b = b.toLowerCase() }
    if (a === b) main().catch((e) => { console.error(e.message || e); process.exit(1) })
  }
}
